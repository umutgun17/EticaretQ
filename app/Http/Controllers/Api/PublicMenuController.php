<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Menu\MenuDataService;
use App\Services\Menu\TenantMenuSettings;
use App\Services\Recommendation\RecommendationEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Akıllı Menü storefront API — /w/{slug}/menu/config|personal|event (menu-cors). */
class PublicMenuController extends Controller
{
    /** Widget config: tema + kurallar + segmentler/kartlar (gizli/küçükler ayıklanmış) + sanal kategoriler + popüler ürünler. */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantMenuSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $data = MenuDataService::build($tenant->id);
        $segments = array_map(function ($seg) use ($s) {
            $tiles = array_values(array_filter($seg['tiles'], fn ($t) => ! $t['small']));
            $seg['tiles'] = array_map(fn ($t) => [
                'id' => $t['id'], 'label' => $t['label'], 'name' => $t['name'], 'url' => $t['url'], 'group' => $t['group'], 'group_url' => $t['group_url'],
                'count' => $t['count'], 'q7' => $t['q7'], 'q30' => $t['q30'], 'season' => $t['season'], 'img' => $t['img'], 'pinned' => $t['pinned'], 'path' => $t['path'] ?? null,
            ], $tiles);
            // panelden elle sıra (catalog modunda)
            $order = $s['overrides']['order'][$seg['url']] ?? null;
            if (is_array($order) && $order) {
                $idx = array_flip(array_map('strtolower', $order));
                usort($seg['tiles'], fn ($a, $b) => ($idx[strtolower($a['url'])] ?? 999) <=> ($idx[strtolower($b['url'])] ?? 999));
            }

            return $seg;
        }, $data['segments']);

        $virtual = array_values(array_filter($s['virtual'], fn ($v) => $v['enabled']));
        $virtual = self::withPriceCounts($tenant->id, $virtual, $segments);

        return response()->json([
            'theme' => $s['theme'],
            'rules' => $s['rules'],
            'virtual' => $virtual,
            'segments' => $segments,
            'products' => $s['rules']['show_products'] ? $data['products'] : [],
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'store_name' => (string) ($tenant->name ?? ''),
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'category_paths' => Cache::remember("filter:paths:{$tenant->id}", 600, fn () => DB::table('platform_categories')
                ->where('tenant_id', $tenant->id)->where('is_active', true)->where('product_count', '>', 0)
                ->pluck('url')->map(fn ($u) => strtolower((string) $u))->values()->all()),
            'generated_at' => $data['generated_at'],
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * Segment başına sanal kategori sayısı → counts {segUrl: n}. Hedef url = urls[segUrl] yoksa url'de {seg} yerine segment yolu.
     * Sayılan küme = Akıllı Filtre'nin o sayfada göstereceği küme: yol kategorisi (alt ağacıyla) ∩ [kat=/kapsam= kategori ağacı]
     * ∩ [filtre=td-… özellik değerleri]; aktif + stoklu + görselli (Ticimax listesi görselsizi göstermez).
     */
    protected static function scopeCounts(int $tenantId, array $v, array $segments): array
    {
        // ver: atama yazan komutlar (catalog:pick-opportunity, ranking) artırır → sayılar anında tazelenir
        $ver = (int) Cache::get("menu:scopecount:ver:{$tenantId}", 0);
        $ck = "menu:scopecount:{$tenantId}:{$ver}:".md5(json_encode([$v['url'], $v['urls'] ?? null]).'|'.implode(',', array_column($segments, 'url')));

        return Cache::remember($ck, 600, function () use ($tenantId, $v, $segments) {
            $subtree = function (string $path) use ($tenantId) {
                return DB::table('platform_categories')->where('tenant_id', $tenantId)
                    ->where(function ($q) use ($path) {
                        $q->where('path', $path)->orWhere('path', 'like', str_replace(['%', '_'], ['\%', '\_'], $path).' > %');
                    })->pluck('platform_category_id')->map(fn ($x) => (int) $x)->all();
            };
            $catByUrl = function (string $url) use ($tenantId) {
                $p = '/'.trim(strtolower((string) parse_url($url, PHP_URL_PATH)), '/');

                return DB::table('platform_categories')->where('tenant_id', $tenantId)->where('is_active', true)
                    ->whereRaw('lower(url) = ?', [$p])->first(['platform_category_id', 'path']);
            };
            $inCats = fn ($ids) => fn ($s) => $s->select(DB::raw(1))->from('product_platform_categories as ppc')
                ->whereColumn('ppc.product_id', 'p.id')->where('ppc.tenant_id', $tenantId)->whereIn('ppc.platform_category_id', $ids ?: [-1]);
            $out = [];
            foreach ($segments as $seg) {
                $target = $v['urls'][strtolower((string) $seg['url'])] ?? str_replace('{seg}', (string) $seg['url'], (string) $v['url']);
                $cat = $catByUrl($target);
                if (! $cat) {
                    continue;
                }
                parse_str((string) parse_url($target, PHP_URL_QUERY), $qs);
                $q = DB::table('products as p')->where('p.tenant_id', $tenantId)->where('p.is_active', true)->where('p.stock_quantity', '>', 0)
                    ->whereNotNull('p.images')->whereRaw("jsonb_typeof(p.images::jsonb) = 'array' and jsonb_array_length(p.images::jsonb) > 0")
                    ->whereExists($inCats($subtree((string) $cat->path)));
                $scopeUrl = (string) ($qs['kapsam'] ?? $qs['kat'] ?? '');
                if ($scopeUrl !== '' && str_starts_with($scopeUrl, '/')) {
                    $sc = $catByUrl($scopeUrl);
                    if (! $sc) {
                        continue;
                    }
                    $q->whereExists($inCats($subtree((string) $sc->path)));
                }
                if (! empty($qs['filtre'])) {
                    $nf = \App\Services\Filter\NativeFilter::resolve($tenantId, (string) $qs['filtre']);
                    if (! $nf) {
                        continue;
                    }
                    foreach ($nf['specs'] as $k => $vals) {
                        $q->whereIn(DB::raw('p.specifications->>'.DB::getPdo()->quote($k)), $vals);
                    }
                }
                $out[$seg['url']] = (int) $q->count();
            }

            return ['counts' => $out];
        });
    }

    /**
     * Sanal kategori URL'sinde min=/max= varsa (Ticimax fiyat filtresi) gerçek ürün sayısını ekler:
     * {seg} içerenlerde segment başına (counts: {segUrl: n}), sabit yolda toplam (count). Satış fiyatı (indirimli varsa o) esas; Ticimax listesi stoksuzu da gösterdiğinden aktif ürün sayılır.
     */
    protected static function withPriceCounts(int $tenantId, array $virtual, array $segments): array
    {
        foreach ($virtual as &$v) {
            if (! empty($v['auto_price'])) {
                $v['bands'] = self::autoPriceBands($tenantId, $segments);

                continue;
            }
            $perSeg = ! empty($v['urls']) || (str_contains($v['url'], '{seg}') && preg_match('/[?&](kapsam|kat)=\{seg\}/', $v['url']));
            if ($perSeg) {
                // Segment başına hedef (urls haritası veya {seg} şablonu): kampanya kategorisi ∩ segment (kat=/kapsam=)
                // veya kampanya ∩ Ticimax native özellik filtresi (filtre=td-135|455) — sayı Akıllı Filtre sayacıyla aynı küme
                $v = $v + self::scopeCounts($tenantId, $v, $segments);

                continue;
            }
            if (! preg_match('/[?&]min=(\d+)/', $v['url'], $mn) && ! preg_match('/[?&]max=(\d+)/', $v['url'], $mx)) {
                continue;
            }
            $min = isset($mn[1]) ? (int) $mn[1] : 0;
            $max = preg_match('/[?&]max=(\d+)/', $v['url'], $mx2) ? (int) $mx2[1] : 999999;
            $ck = "menu:pricecount:{$tenantId}:".md5($v['url']);
            $data = Cache::remember($ck, 600, function () use ($tenantId, $min, $max, $segments, $v) {
                $priceExpr = "case when coalesce(discounted_price,0) > 0 and discounted_price < price then discounted_price else price end";
                if (str_contains($v['url'], '{seg}')) {
                    $out = [];
                    foreach ($segments as $seg) {
                        $root = $seg['name'];
                        $out[$seg['url']] = (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)
                            ->where(function ($q) use ($root) { $q->where('category_path', $root)->orWhere('category_path', 'like', $root.' > %'); })
                            ->whereRaw("($priceExpr) between ? and ?", [$min, $max])->count();
                    }

                    return ['counts' => $out];
                }

                return ['count' => (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)->whereRaw("($priceExpr) between ? and ?", [$min, $max])->count()];
            });
            $v = $v + $data;
        }
        unset($v);

        return $virtual;
    }

    /**
     * Segment başına otomatik fiyat bandı: aktif ürünlerin satış fiyatları içinde, "x99" uçlu (299, 599…) ve
     * medyana göre ölçeklenen genişlikte (200/300/500/1000 TL) en çok ürünü kapsayan aralık. Kadın'da 599–899,
     * Çocuk'ta 299–599 çıkabilir; firma/ sezon değiştikçe kendiliğinden kayar. 1 saat cache.
     */
    public static function autoPriceBands(int $tenantId, array $segments): array
    {
        return Cache::remember("menu:priceband:{$tenantId}:".md5(json_encode(array_column($segments, 'url'))), 3600, function () use ($tenantId, $segments) {
            $out = [];
            foreach ($segments as $seg) {
                $root = $seg['name'];
                $prices = DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)
                    ->where(function ($q) use ($root) { $q->where('category_path', $root)->orWhere('category_path', 'like', $root.' > %'); })
                    ->selectRaw('case when coalesce(discounted_price,0) > 0 and discounted_price < price then discounted_price else price end as p')
                    ->pluck('p')->map(fn ($x) => (float) $x)->filter(fn ($x) => $x > 0)->sort()->values()->all();
                $n = count($prices);
                if ($n < 10) {
                    continue;
                }
                $median = $prices[(int) floor($n / 2)];
                $w = $median < 800 ? 200 : ($median < 2000 ? 300 : ($median < 5000 ? 500 : 1000));
                $step = $w >= 500 ? 500 : 100;
                $best = null;
                $maxP = $prices[$n - 1];
                for ($min = $step - 1; $min <= $maxP; $min += $step) {
                    $max = $min + $w;
                    $c = 0;
                    foreach ($prices as $x) {
                        if ($x >= $min && $x <= $max) {
                            $c++;
                        } elseif ($x > $max) {
                            break;
                        }
                    }
                    if (! $best || $c > $best['count']) {
                        $best = ['min' => $min, 'max' => $max, 'count' => $c];
                    }
                }
                if ($best && $best['count'] >= 5) {
                    $out[$seg['url']] = $best + ['share' => round($best['count'] / $n * 100)];
                }
            }

            return $out;
        });
    }

    /** Üye için kişisel ürün satırı (öneri motoru forCustomer). ?member=<platform member id> */
    public function personal(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['items' => []], 404);
        }
        $member = trim((string) $request->query('member', ''));
        if ($member === '' || mb_strlen($member) > 64) {
            return response()->json(['items' => []]);
        }
        $limit = max(2, min(12, (int) $request->query('limit', 6)));
        $data = Cache::remember("menu:personal:v2:{$tenant->id}:{$member}:{$limit}", 900, function () use ($tenant, $member, $limit) {
            $engine = app(RecommendationEngine::class);
            $out = ['items' => [], 'categories' => [], 'last_segment' => null, 'sizes' => []];
            try {
                $r = $engine->forCustomer($tenant->id, $member, $limit, 'menu');
                $out['items'] = array_map(fn ($p) => [
                    'pid' => $p['pid'] ?? null, 'name' => $p['name'] ?? '', 'url' => $p['url'] ?? '', 'img' => $p['image'] ?? null,
                    'price' => $p['price'] ?? null, 'dprice' => $p['discounted'] ?? $p['discounted_price'] ?? $p['dprice'] ?? null, // motor present() 'discounted' döndürür 'size' => $p['size'] ?? null,
                ], $r['items'] ?? []);
                $out['sizes'] = $r['sizes'] ?? [];
                $cid = $r['customer_id'] ?? $engine->resolveCustomerId($tenant->id, $member);
            } catch (\Throwable $e) {
                $cid = null;
                try {
                    $cid = $engine->resolveCustomerId($tenant->id, $member);
                } catch (\Throwable $e2) {
                }
            }
            // Satın alma geçmişi → kategori yolları (en yeni önce) + en son alışverişin segmenti: sekme ve kart sırası bunlara göre öne alınır
            if ($cid) {
                $rows = DB::select("select p.category_path, max(o.order_date) d from orders o join order_items oi on oi.order_id = o.id join products p on p.id = oi.product_id
                    where o.tenant_id = ? and o.customer_id = ? and coalesce(o.paid_amount, 0) > 0 and o.order_date > now() - interval '365 days' and p.category_path is not null
                    group by p.category_path order by d desc limit 12", [$tenant->id, $cid]);
                $out['categories'] = array_map(fn ($r) => $r->category_path, $rows);
                $out['last_segment'] = $rows ? trim(explode('>', $rows[0]->category_path)[0]) : null;
            }

            return $out;
        });

        return response()->json($data)->header('Cache-Control', 'no-store');
    }

    /** "Son baktığın ürünler" için güncel fiyat: ids = Ticimax ürün kartı id'leri (URL sonundaki -123). Cihazda saklanan fiyat bayatlar / eski sürüm "Fiyat" yazısı kaydetmişti. */
    public function prices(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['items' => []], 404);
        }
        $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $request->query('ids', ''))), fn ($x) => $x > 0)));
        $ids = array_slice($ids, 0, 12);
        if (! $ids) {
            return response()->json(['items' => []]);
        }
        $items = [];
        foreach (DB::table('products')->where('tenant_id', $tenant->id)->whereIn('platform_product_id', array_map('strval', $ids))
            ->get(['platform_product_id', 'price', 'discounted_price', 'is_active', 'stock_quantity']) as $r) {
            $price = (float) $r->price;
            $d = (float) ($r->discounted_price ?? 0);
            $items[(string) $r->platform_product_id] = ['price' => round($price, 2), 'dprice' => $d > 0 && $d < $price ? round($d, 2) : null, 'stock' => (bool) $r->is_active && (int) $r->stock_quantity > 0];
        }

        return response()->json(['items' => (object) $items])->header('Cache-Control', 'public, max-age=300');
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
        if (! in_array($type, ['open', 'tab', 'tile', 'virtual', 'product', 'recent', 'search', 'close', 'error', 'more', 'all', 'footer'], true)) {
            return response()->json(['ok' => false], 422);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $isTest = $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;

        DB::table('menu_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'segment' => mb_substr((string) $request->input('segment', ''), 0, 60) ?: null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 200) ?: null,
            'position' => is_numeric($request->input('pos')) ? (int) $request->input('pos') : null,
            'source' => mb_substr((string) $request->input('source', ''), 0, 24) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
