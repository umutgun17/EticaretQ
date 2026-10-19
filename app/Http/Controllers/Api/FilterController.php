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

/** Akıllı Filtre paneli (CRO ürünü): ayarlar, facet kataloğu, kategori listesi, analitik, seçici testi. */
class FilterController extends Controller
{
    protected function tenant(): ?Tenant
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return $user->tenant;
        }
        $id = request()->header('X-Tenant-Id');

        return $id ? Tenant::find((int) $id) : null;
    }

    public function settings(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $s = TenantFilterSettings::get($tenant->id);
        $catalog = FacetCatalog::forTenant($tenant->id);

        return response()->json([
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/'),
            'enabled' => $s['enabled'],
            'domains' => $s['domains'],
            'template' => $s['template'],
            'mode' => $s['mode'],
            'theme' => $s['theme'],
            'rules' => $s['rules'],
            'selectors' => $s['selectors'],
            'facets' => FacetCatalog::effective($tenant->id, $s['facets']),
            'facets_customized' => $s['facets'] !== null,
            'catalog' => $catalog,
            'templates' => TenantFilterSettings::TEMPLATES,
            'modes' => TenantFilterSettings::MODES,
            'theme_presets' => TenantFilterSettings::THEME_PRESETS,
            'sorts' => FilterEngine::SORT_LABELS,
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'domains' => 'sometimes|nullable|string|max:500',
            'template' => 'sometimes|string|in:'.implode(',', TenantFilterSettings::TEMPLATES),
            'mode' => 'sometimes|string|in:'.implode(',', TenantFilterSettings::MODES),
            'theme' => 'sometimes|array',
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantFilterSettings::THEME_PRESETS),
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.radius' => 'sometimes|integer|between:0,24',
            'theme.chip' => 'sometimes|string|in:pill,square',
            'theme.swatch' => 'sometimes|string|in:circle,square',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'theme.drawer_width' => 'sometimes|integer|between:320,720',
            'rules' => 'sometimes|array',
            'rules.hide_out_of_stock' => 'sometimes|boolean',
            'rules.require_image' => 'sometimes|boolean',
            'rules.size_in_stock_only' => 'sometimes|boolean',
            'rules.show_counts' => 'sometimes|boolean',
            'rules.per_page' => 'sometimes|integer|between:8,60',
            'rules.sort_default' => 'sometimes|string|in:'.implode(',', FilterEngine::SORTS),
            'rules.show_more_limit' => 'sometimes|integer|between:3,30',
            'rules.sticky_apply' => 'sometimes|boolean',
            'rules.price_buckets' => 'sometimes|boolean',
            'rules.quick_add' => 'sometimes|boolean',
            'rules.hidden_categories' => 'sometimes|array|max:500',
            'rules.hidden_categories.*' => 'integer',
            'rules.size_ranges' => 'sometimes|array|max:8',
            'rules.size_ranges.*.key' => 'sometimes|nullable|string|max:30',
            'rules.size_ranges.*.label' => 'required_with:rules.size_ranges|string|max:40',
            'rules.size_ranges.*.tokens' => 'required_with:rules.size_ranges|string|max:160',
            'rules.size_ranges.*.min' => 'required_with:rules.size_ranges|numeric|between:0,99',
            'rules.size_ranges.*.max' => 'required_with:rules.size_ranges|numeric|between:0,99',
            'selectors' => 'sometimes|array',
            'selectors.hide' => 'sometimes|nullable|string|max:600',
            'selectors.mount' => 'sometimes|nullable|string|max:200',
            'selectors.hide_native' => 'sometimes|nullable|string|max:600',
            'selectors.mount_native' => 'sometimes|nullable|string|max:200',
            'selectors.css_native' => 'sometimes|nullable|string|max:2000',
            'facets' => 'sometimes|nullable|array|max:40',
            'facets.*.key' => 'required_with:facets|string|max:80',
            'facets.*.label' => 'sometimes|nullable|string|max:60',
            'facets.*.enabled' => 'sometimes|boolean',
            'facets.*.collapsed' => 'sometimes|boolean',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantFilterSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['filter_widget_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['filter_widget_domains'] = implode(',', $parts);
        }
        if (array_key_exists('template', $data)) {
            $s['filter_widget_template'] = $data['template'];
        }
        if (array_key_exists('mode', $data)) {
            $s['filter_mode'] = $data['mode'];
        }
        if (array_key_exists('theme', $data)) {
            $s['filter_widget_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['filter_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('selectors', $data)) {
            $s['filter_selectors'] = json_encode(array_merge($cur['selectors'], array_map('trim', $data['selectors'])));
        }
        if (array_key_exists('facets', $data)) {
            // null/boş → katalog varsayılanına dön
            $s['filter_facets'] = $data['facets'] ? json_encode(array_values($data['facets'])) : null;
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantFilterSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /** Facet kataloğunu yeniden hesapla (katalog değişince). */
    public function refreshCatalog(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        FacetCatalog::forget($tenant->id);

        return response()->json(FacetCatalog::forTenant($tenant->id));
    }

    /**
     * GET /cro/filter/facet-values?key=color — panelde başlığa tıklanınca gösterilen örnek alt seçenekler
     * (tüm katalog, filtre yok). Sitede kategoriye göre daralır; burada amaç "neler gelecek" hissi.
     */
    public function facetValues(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $key = (string) $request->query('key', '');
        $item = collect(FacetCatalog::forTenant($tenant->id)['facets'])->firstWhere('key', $key);
        if (! $item) {
            return response()->json(['error' => 'unknown_facet'], 404);
        }
        $limit = max(4, min(40, (int) $request->query('limit', 14)));

        $data = Cache::remember("filter:preview:{$tenant->id}:{$key}", 600, function () use ($tenant, $key, $item) {
            return FilterEngine::forTenant($tenant)->facetPreview($key, $item['type']);
        });

        $values = $data['values'] ?? [];
        $out = [
            'key' => $key,
            'label' => $item['label'],
            'type' => $item['type'],
            'total_values' => count($values),
            'values' => array_slice($values, 0, $limit),
        ];
        if ($item['type'] === 'price' && $data) {
            $out += ['min' => $data['min'], 'max' => $data['max'], 'buckets' => $data['buckets'], 'currency' => $data['currency']];
        }

        return response()->json($out);
    }

    /** Demo/önizleme için kategori listesi (ürünü olanlar). */
    public function categories(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $rows = DB::table('platform_categories')->where('tenant_id', $tenant->id)->where('is_active', true)->where('product_count', '>', 0)
            ->orderBy('path')->get(['platform_category_id', 'name', 'path', 'url', 'depth', 'product_count']);

        return response()->json(['data' => $rows]);
    }

    /** GET /cro/filter/analytics?range=30 */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('filter_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $filterSessions = (int) (clone $ev)->where('type', 'apply')->distinct()->count('session_id');
        $clickSessionsWithFilter = (int) DB::table('filter_events as a')->where('a.tenant_id', $tenant->id)->where('a.is_test', false)->where('a.created_at', '>=', $since)
            ->where('a.type', 'click')->whereExists(function ($q) use ($tenant, $since) {
                $q->select(DB::raw('1'))->from('filter_events as b')->whereColumn('b.session_id', 'a.session_id')->where('b.tenant_id', $tenant->id)->where('b.type', 'apply')->where('b.created_at', '>=', $since);
            })->distinct()->count('a.session_id');
        $clickSessionsNoFilter = (int) DB::table('filter_events as a')->where('a.tenant_id', $tenant->id)->where('a.is_test', false)->where('a.created_at', '>=', $since)
            ->where('a.type', 'click')->whereNotExists(function ($q) use ($tenant, $since) {
                $q->select(DB::raw('1'))->from('filter_events as b')->whereColumn('b.session_id', 'a.session_id')->where('b.tenant_id', $tenant->id)->where('b.type', 'apply')->where('b.created_at', '>=', $since);
            })->distinct()->count('a.session_id');

        $topFacets = (clone $ev)->where('type', 'apply')->selectRaw('facet, count(*) c, count(distinct session_id) s')->groupBy('facet')->orderByDesc('c')->limit(15)->get();
        $topValues = (clone $ev)->where('type', 'apply')->selectRaw('facet, value, count(*) c')->groupBy('facet', 'value')->orderByDesc('c')->limit(25)->get();
        $topCategories = (clone $ev)->where('type', 'view')->selectRaw('category_path, count(distinct session_id) s')->groupBy('category_path')->orderByDesc('s')->limit(15)->get();
        $conv = (clone $ev)->where('type', 'conversion')->selectRaw('count(*) c, coalesce(sum(value_num),0) rev')->first();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='apply') applies, count(*) filter (where type='click') clicks")
            ->groupBy('d')->orderBy('d')->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'filter_sessions' => $filterSessions,
            'filter_usage_rate' => $sessions > 0 ? round($filterSessions / $sessions * 100, 1) : 0,
            'click_rate_with_filter' => $filterSessions > 0 ? round($clickSessionsWithFilter / $filterSessions * 100, 1) : 0,
            'click_rate_without_filter' => ($sessions - $filterSessions) > 0 ? round($clickSessionsNoFilter / ($sessions - $filterSessions) * 100, 1) : 0,
            'conversions' => (int) ($conv->c ?? 0),
            'revenue' => round((float) ($conv->rev ?? 0), 2),
            'top_facets' => $topFacets,
            'top_values' => $topValues,
            'top_categories' => $topCategories,
            'daily' => $daily,
        ]);
    }

    /** GET /cro/filter/detect — mağazanın bir kategori sayfasında varsayılan seçicilerin var olup olmadığını dener. */
    public function detect(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $shop = rtrim((string) (($tenant->settings ?? [])['storefront_url'] ?? ($tenant->settings ?? [])['shop_url'] ?? ''), '/');
        $path = (string) $request->query('path', '');
        if ($path === '') {
            $path = (string) DB::table('platform_categories')->where('tenant_id', $tenant->id)->where('is_active', true)->where('depth', 2)->orderByDesc('product_count')->value('url');
        }
        if ($shop === '' || $path === '') {
            return response()->json(['error' => 'no_shop'], 422);
        }
        // GÜVENLİK (SSRF): kiracı ayarından gelen adres iç ağa/localhost'a işaret edemez
        if (! \App\Support\SafeUrl::isPublicHttpUrl($shop.$path)) {
            return response()->json(['error' => 'no_shop'], 422);
        }
        $ch = curl_init($shop.$path);
        curl_setopt_array($ch, [CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 20, CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YunbiFilter/1.0', CURLOPT_ENCODING => '']);
        $html = (string) curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $s = TenantFilterSettings::get($tenant->id);
        $found = [];
        $hideList = $s['mode'] === 'native' ? $s['selectors']['hide_native'] : $s['selectors']['hide'];
        foreach (array_map('trim', explode(',', (string) $hideList)) as $sel) {
            if ($sel === '') {
                continue;
            }
            $needle = str_starts_with($sel, '#') ? 'id="'.substr($sel, 1).'"' : substr($sel, 1);
            $found[] = ['selector' => $sel, 'found' => $needle !== '' && (str_starts_with($sel, '#') ? str_contains($html, $needle) : (bool) preg_match('/class="[^"]*\b'.preg_quote($needle, '/').'\b/', $html))];
        }
        $mountSpec = $s['mode'] === 'native' ? $s['selectors']['mount_native'] : $s['selectors']['mount'];
        $mount = preg_replace('/^(before|after|into):/', '', (string) $mountSpec);
        $mountFound = str_starts_with($mount, '#') ? str_contains($html, 'id="'.substr($mount, 1).'"') : (bool) preg_match('/class="[^"]*\b'.preg_quote(ltrim($mount, '.'), '/').'\b/', $html);

        return response()->json(['url' => $shop.$path, 'http' => $code, 'hide' => $found, 'mount' => ['selector' => $mountSpec, 'found' => $mountFound], 'mode' => $s['mode'],
            'ticimax_globals' => str_contains($html, 'var productsModel') && str_contains($html, 'ticimax.productlist'),
            'ticimax' => str_contains($html, 'ticimax'), 'widget_embedded' => str_contains($html, 'hub.yunbi.ai/widget/filter.js')]);
    }
}
