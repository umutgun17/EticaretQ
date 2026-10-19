<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Filter\FacetCatalog;
use App\Services\Filter\FilterEngine;
use App\Services\Filter\TenantFilterSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Filtre storefront API — /w/{slug}/filter/* (FilterWidgetCors ile korunur).
 *
 * config : widget davranışı (şablon, tema, seçiciler, facet listesi, kurallar)
 * list   : kategori sayfası için ürünler + facet sayımları (URL yolu ile kategori çözülür)
 * event  : kullanım olayları (view/apply/clear/click/atc/conversion)
 */
class PublicFilterController extends Controller
{
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantFilterSettings::get($tenant->id);

        return response()->json([
            'template' => $s['template'],
            'mode' => $s['mode'],
            'theme' => $s['theme'],
            'rules' => $s['rules'],
            'selectors' => $s['selectors'],
            'facets' => array_values(array_filter(FacetCatalog::effective($tenant->id, $s['facets']), fn ($f) => $f['enabled'])),
            'sorts' => array_map(fn ($k) => ['key' => $k, 'label' => FilterEngine::SORT_LABELS[$k]], FilterEngine::SORTS),
            'shop_url' => rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/'),
            // Widget'ın "bu sayfa bir kategori mi" sorusunu tek istekle cevaplaması için
            'category_paths' => Cache::remember("filter:paths:{$tenant->id}", 600, fn () => DB::table('platform_categories')
                ->where('tenant_id', $tenant->id)->where('is_active', true)->where('product_count', '>', 0)
                ->pluck('url')->map(fn ($u) => strtolower((string) $u))->values()->all()),
        ])->header('Cache-Control', 'no-store');
    }

    /** GET w/{slug}/filter/list?path=/kadin-spor-ayakkabi&color[]=Siyah&size[]=37&price_min=..&sort=..&page=.. */
    public function list(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $engine = FilterEngine::forTenant($tenant);
        $category = $engine->resolveCategory($request->query('path'), $request->filled('category_id') ? (int) $request->query('category_id') : null);
        if (! $category) {
            return response()->json(['error' => 'category_not_found', 'total' => 0, 'products' => [], 'facets' => []], 404);
        }

        // kapsam: ikinci kategoriyle kesişim (kampanya sayfasında segment daraltması; widget ?kapsam=/unisex-cocuk)
        $category = $engine->withScope($category, mb_substr((string) $request->query('scope', ''), 0, 200));
        // native: Ticimax'ın kendi ?filtre= parametresi (td-135|455 → Cinsiyet: Kadın) — id taşımayan segment daraltması
        $category = $engine->withNativeScope($category, mb_substr((string) $request->query('native', ''), 0, 300));

        $filters = $this->parseFilters($request);
        $sort = (string) $request->query('sort', '');
        $page = max(1, (int) $request->query('page', 1));
        $idsOnly = filter_var($request->query('ids_only', false), FILTER_VALIDATE_BOOLEAN);
        $key = 'filter:list:'.$tenant->id.':'.md5(json_encode([$category['id'], $category['scope']['id'] ?? 0, $category['scope']['specs'] ?? null, $filters, $sort, $page, $idsOnly]));

        $result = Cache::remember($key, 60, fn () => $engine->list($category, $filters, $sort, $page, null, $idsOnly));

        return response()->json($result);
    }

    public function event(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['ok' => false], 404);
        }
        if (! $request->isJson() && $request->getContent() !== '') {
            $decoded = json_decode($request->getContent(), true);
            if (is_array($decoded)) {
                $request->merge($decoded);
            }
        }
        $type = (string) $request->input('type', '');
        if (! in_array($type, ['view', 'apply', 'clear', 'click', 'atc', 'conversion', 'sort'], true)) {
            return response()->json(['ok' => false], 422);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $isTest = $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;

        DB::table('filter_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'category_path' => mb_substr((string) $request->input('category', ''), 0, 200) ?: null,
            'facet' => mb_substr((string) $request->input('facet', ''), 0, 48) ?: null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 120) ?: null,
            'product_id' => $request->filled('product_id') ? (int) $request->input('product_id') : null,
            'value_num' => $type === 'conversion' && $request->filled('amount') ? (float) $request->input('amount') : null,
            'platform_order_id' => $type === 'conversion' ? mb_substr((string) $request->input('order_id', ''), 0, 64) ?: null : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }

    public static function parseFilters(Request $request): array
    {
        $arr = fn ($k) => array_values(array_filter(array_map(fn ($v) => mb_substr(trim((string) $v), 0, 80), (array) $request->query($k, [])), fn ($v) => $v !== ''));
        $filters = [
            'color' => array_slice($arr('color'), 0, 10),
            'size' => array_slice($arr('size'), 0, 15),
            'brand' => array_slice($arr('brand'), 0, 10),
            'category' => array_slice(array_values(array_filter($arr('category'), fn ($v) => ctype_digit($v) || str_starts_with($v, '/'))), 0, 10), // id veya URL yolu (/unisex-cocuk)
            'price_min' => $request->filled('price_min') ? max(0, (float) $request->query('price_min')) : null,
            'price_max' => $request->filled('price_max') ? max(0, (float) $request->query('price_max')) : null,
            'discount' => filter_var($request->query('discount', false), FILTER_VALIDATE_BOOLEAN),
            'new' => filter_var($request->query('new', false), FILTER_VALIDATE_BOOLEAN),
            'rating' => $request->filled('rating') ? (float) $request->query('rating') : null,
            'spec' => [],
        ];
        $spec = $request->query('spec', []);
        if (is_array($spec)) {
            $n = 0;
            foreach ($spec as $key => $vals) {
                if (++$n > 8) {
                    break;
                }
                $key = mb_substr(trim((string) $key), 0, 60);
                $vals = array_slice(array_values(array_filter(array_map(fn ($v) => mb_substr(trim((string) $v), 0, 80), (array) $vals))), 0, 10);
                if ($key !== '' && $vals) {
                    $filters['spec'][$key] = $vals;
                }
            }
        }

        return $filters;
    }

    protected function resolveTenant(string $slug): ?Tenant
    {
        return Tenant::where('slug', $slug)->where('is_active', true)->first();
    }
}
