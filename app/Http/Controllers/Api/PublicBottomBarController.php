<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\BottomBar\TenantBottomBarSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Mobil Alt Bar storefront API — /w/{slug}/bottombar/config|event (BottomBarCors). */
class PublicBottomBarController extends Controller
{
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantBottomBarSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];

        return response()->json([
            'theme' => $s['theme'],
            'rules' => $s['rules'],
            'items' => array_values(array_filter($s['items'], fn ($i) => $i['enabled'])),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'whatsapp' => (string) ($ts['whatsapp_number'] ?? ''),
            'categories' => self::categoryTree($tenant->id, (int) $s['rules']['sheet_levels']),
            'category_paths' => Cache::remember("filter:paths:{$tenant->id}", 600, fn () => DB::table('platform_categories')
                ->where('tenant_id', $tenant->id)->where('is_active', true)->where('product_count', '>', 0)
                ->pluck('url')->map(fn ($u) => strtolower((string) $u))->values()->all()),
        ])->header('Cache-Control', 'no-store');
    }

    /** Kategori alt sayfası için ağaç: kök → alt (ürünü olanlar), ürün sayısına göre. */
    public static function categoryTree(int $tenantId, int $levels = 2): array
    {
        $levels = max(1, min(3, $levels));

        return Cache::remember("bottombar:tree:{$tenantId}:{$levels}", 600, function () use ($tenantId, $levels) {
            $rows = DB::table('platform_categories')->where('tenant_id', $tenantId)->where('is_active', true)->where('product_count', '>', 0)
                ->where('depth', '<', $levels)->orderBy('depth')->orderByDesc('product_count')
                ->get(['platform_category_id', 'parent_platform_id', 'name', 'url', 'depth', 'product_count']);
            $byParent = [];
            foreach ($rows as $r) {
                $byParent[(int) $r->parent_platform_id][] = $r;
            }
            $build = function (int $parent, int $depth) use (&$build, &$byParent, $levels) {
                $out = [];
                foreach (array_slice($byParent[$parent] ?? [], 0, $depth === 0 ? 12 : 14) as $r) {
                    $node = ['id' => (int) $r->platform_category_id, 'name' => $r->name, 'url' => $r->url, 'count' => (int) $r->product_count];
                    if ($depth + 1 < $levels) {
                        $node['children'] = $build((int) $r->platform_category_id, $depth + 1);
                    }
                    $out[] = $node;
                }

                return $out;
            };

            return $build(0, 0);
        });
    }

    public function event(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
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
        if (! in_array($type, ['view', 'click', 'sheet_open', 'sheet_click'], true)) {
            return response()->json(['ok' => false], 422);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $isTest = $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;

        DB::table('bottombar_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'item' => mb_substr((string) $request->input('item', ''), 0, 32) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'page_type' => mb_substr((string) $request->input('page_type', ''), 0, 16) ?: null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
