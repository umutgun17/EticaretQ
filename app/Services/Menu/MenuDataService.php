<?php

namespace App\Services\Menu;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Menü veri motoru: segmentler (kök kategoriler) → kartlar (yaprak kategoriler) + satış hızı,
 * sezon çarpanı, otomatik temsil görseli, popüler ürünler, sanal kategoriler. Widget config'i buradan üretilir.
 * Kaynak: platform_categories (ağaç), products.category_path (ürün↔kategori), orders/order_items (satış).
 */
class MenuDataService
{
    /** Pazaryeri kaynakları satış hızına katılmaz (menü site davranışını yansıtır). */
    public const MARKETPLACES = ['PAZARAMA', 'Temu', 'N11', 'AMAZON', 'Trendyol', 'Hepsiburada', 'Ciceksepeti', 'Ticimax Panel'];

    public const SKIP_NAMES = ['kategorisiz', 'uncategorized', 'diğer', 'diger'];

    /** Tam veri (segment → kartlar) — 15 dk cache; ayar değişince TenantMenuSettings::forget temizler. */
    public static function build(int $tenantId, bool $fresh = false): array
    {
        $key = "menu:data:{$tenantId}";
        if ($fresh) {
            Cache::forget($key);
        }

        return Cache::remember($key, 900, fn () => static::compute($tenantId));
    }

    protected static function compute(int $tenantId): array
    {
        $s = TenantMenuSettings::get($tenantId);
        $rules = $s['rules'];
        $ov = $s['overrides'];

        $cats = DB::table('platform_categories')->where('tenant_id', $tenantId)->where('is_active', true)
            ->orderBy('depth')->orderByDesc('product_count')
            ->get(['platform_category_id', 'parent_platform_id', 'name', 'url', 'path', 'depth', 'product_count', 'children_count', 'is_assignable']);
        $byId = [];
        $byParent = [];
        foreach ($cats as $c) {
            $byId[(int) $c->platform_category_id] = $c;
            $byParent[(int) $c->parent_platform_id][] = $c;
        }

        $sales = static::salesByPath($tenantId);      // path => [q7, q30, rev30]
        // Ürün sayıları: Ticimax'ın product_count'u stoksuz ürünleri de sayar, mağaza ise stoksuzları listelemez
        // (ör. Futbol Ayakkabısı: 5 ürün → sayfada 0). Kartta gösterilen sayı = aktif + STOKLU ürün (crm:sync-stock 5 dk'da bir).
        $dbCounts = [];      // aktif (görsel/eşleme var mı?)
        $stockCounts = [];   // aktif + stoklu (kartta gösterilen)
        foreach (DB::select('select category_path, count(*) n, count(*) filter (where stock_quantity > 0) s from products where tenant_id = ? and is_active and category_path is not null group by 1', [$tenantId]) as $r) {
            $parts = array_map('trim', explode('>', (string) $r->category_path));
            for ($i = 1; $i <= count($parts); $i++) {
                $k = implode(' > ', array_slice($parts, 0, $i));
                $dbCounts[$k] = ($dbCounts[$k] ?? 0) + (int) $r->n;
                $stockCounts[$k] = ($stockCounts[$k] ?? 0) + (int) $r->s;
            }
        }
        // Ticimax kategori sayfası ikincil atamalı ürünleri de listeler (çoklu kategori, 1+1/Fırsat aynaları) → birincil yol eksik sayar
        // (14 Eki: Kadın Spor Ayakkabı menüde 200, sayfada ~320). Kural açıksa sayı = atanmış + aktif + stoklu + görselli.
        $assigned = [];
        if (! empty($rules['count_assigned'])) {
            foreach (DB::select("select x.platform_category_id c, count(distinct p.id) n from product_platform_categories x join products p on p.id = x.product_id and p.tenant_id = x.tenant_id
                where x.tenant_id = ? and p.is_active and p.stock_quantity > 0 and p.images is not null and jsonb_typeof(p.images::jsonb) = 'array' and jsonb_array_length(p.images::jsonb) > 0
                group by 1", [$tenantId]) as $r) {
                $assigned[(int) $r->c] = (int) $r->n;
            }
        }
        $countOf = fn ($c, $fallback) => $assigned ? (int) ($assigned[(int) $c->platform_category_id] ?? 0) : (int) ($stockCounts[$c->path] ?? $fallback);
        $season = static::seasonByPath($tenantId);    // path => factor
        $images = static::imagesByPath($tenantId);    // path => image url

        // Segmentler: ürünü olan kök kategoriler. Kampanya/vitrin kökleri (is_assignable=false: "Sepette %50", "Fırsat"…)
        // sekme olmaz — bunlar sanal kategori kartı/çipi olarak {seg}?kapsam= ile her segmentin içinde gösterilir.
        $roots = array_values(array_filter($byParent[0] ?? [], function ($r) {
            return (int) $r->product_count > 0 && ! empty($r->is_assignable) && ! in_array(mb_strtolower($r->name), self::SKIP_NAMES, true);
        }));
        // gizli/sıralı segmentler
        $hiddenSeg = array_map('strtolower', $ov['segments_hidden'] ?? []);
        $roots = array_values(array_filter($roots, fn ($r) => ! in_array(strtolower($r->url), $hiddenSeg, true)));
        if (! empty($ov['segments_order'])) {
            $order = array_flip(array_map('strtolower', $ov['segments_order']));
            usort($roots, fn ($a, $b) => ($order[strtolower($a->url)] ?? 999) <=> ($order[strtolower($b->url)] ?? 999));
        }
        $allRoots = $roots; // panel için gizliler dahil listelenir (aşağıda ayrıca)
        $roots = array_slice($roots, 0, max(1, min(6, (int) $rules['segments_max'])));

        $hidden = array_map('strtolower', $ov['hidden'] ?? []);
        $pinned = array_map('strtolower', $ov['pinned'] ?? []);
        $labels = $ov['labels'] ?? [];
        $imgOv = $ov['images'] ?? [];
        $minP = (int) $rules['hide_min_products'];

        $segments = [];
        foreach ($roots as $root) {
            $rid = (int) $root->platform_category_id;
            $leaves = [];
            // yaprak = kökün altındaki en derin ürünlü düğümler (Kadın > Ayakkabı > Spor Ayakkabı); alt öğesi olmayan 1. seviye de yaprak
            foreach ($byParent[$rid] ?? [] as $lvl1) {
                $kids = array_filter($byParent[(int) $lvl1->platform_category_id] ?? [], fn ($k) => (int) $k->product_count > 0);
                if ($kids) {
                    foreach ($kids as $k) {
                        $leaves[] = [$k, $lvl1];
                    }
                } elseif ((int) $lvl1->product_count > 0) {
                    $leaves[] = [$lvl1, null];
                }
            }
            $tiles = [];
            $seen = [];
            foreach ($leaves as [$leaf, $group]) {
                $url = strtolower($leaf->url);
                if (isset($seen[$url]) || in_array($url, $hidden, true)) {
                    continue;
                }
                $seen[$url] = true;
                $sl = $sales[$leaf->path] ?? [0, 0, 0];
                $sf = $season[$leaf->path] ?? 1.0;
                $tiles[] = [
                    'id' => (int) $leaf->platform_category_id,
                    'name' => $leaf->name,
                    'label' => $labels[$leaf->url] ?? static::shortLabel($leaf->name, $root->name, $group?->name),
                    'url' => $leaf->url,
                    'path' => $leaf->path,
                    'group' => $group?->name,
                    'group_url' => $group?->url,
                    'count' => $countOf($leaf, 0),
                    'ticimax_count' => (int) $leaf->product_count,
                    'q7' => (int) $sl[0],
                    'q30' => (int) $sl[1],
                    'rev30' => (int) $sl[2],
                    'season' => round($sf, 2),
                    'img' => $imgOv[$leaf->url] ?? ($images[$leaf->path] ?? null),
                    'img_auto' => $images[$leaf->path] ?? null,
                    'pinned' => in_array($url, $pinned, true),
                    'db_count' => (int) ($dbCounts[$leaf->path] ?? 0),
                    // widget gizler, panel gösterir: Ticimax sayısı eşiğin altında VEYA Yunbi'de hiç ürün yok (görsel de üretilemez)
                    'small' => $countOf($leaf, 0) < $minP || (int) ($dbCounts[$leaf->path] ?? 0) === 0,
                ];
            }
            // aynı etiketli gölge kategoriler (Kadın > Ayakkabı > Spor Ayakkabı vs Kadın > Ayakkabı-2475 > Spor Ayakkabı): ürünü çok olan kalır
            $best = [];
            foreach ($tiles as $t) {
                $k = mb_strtolower($t['label']);
                if (! isset($best[$k]) || $t['count'] > $tiles[$best[$k]]['count']) {
                    $best[$k] = array_search($t, $tiles, true);
                }
            }
            $keep = array_flip(array_values($best));
            $tiles = array_values(array_filter($tiles, fn ($t, $i) => isset($keep[$i]), ARRAY_FILTER_USE_BOTH));
            $segments[] = [
                'id' => $rid,
                'name' => $root->name,
                'url' => $root->url,
                'count' => $countOf($root, $root->product_count),
                'q30' => (int) (($sales[$root->path] ?? [0, 0, 0])[1]),
                'tiles' => $tiles,
            ];
        }

        return [
            'segments' => $segments,
            'all_roots' => array_map(fn ($r) => ['id' => (int) $r->platform_category_id, 'name' => $r->name, 'url' => $r->url, 'count' => $countOf($r, $r->product_count), 'hidden' => in_array(strtolower($r->url), $hiddenSeg, true)],
                array_values(array_filter($byParent[0] ?? [], fn ($r) => (int) $r->product_count > 0 && ! in_array(mb_strtolower($r->name), self::SKIP_NAMES, true)))),
            'products' => static::popularProducts($tenantId, array_map(fn ($s) => $s['name'], $segments), (int) $rules['products_count']),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /** Kök adını baştan at: "Kadın Spor Ayakkabı" → "Spor Ayakkabı"; Çocuk altında "Kız Çocuk Bot" kalır (ayırt edici). */
    public static function shortLabel(string $name, string $root, ?string $group): string
    {
        $n = trim($name);
        foreach ([$root.' ', $root.'-'] as $p) {
            if (mb_stripos($n, $p) === 0) {
                $n = trim(mb_substr($n, mb_strlen($p)));
            }
        }

        return $n !== '' ? $n : $name;
    }

    /** Kategori yoluna göre satış: [q7, q30, ciro30] — yol öneki eşleşmesi (alt kategoriler üst toplama katılır). */
    public static function salesByPath(int $tenantId): array
    {
        $mp = "'".implode("','", self::MARKETPLACES)."'";
        $rows = DB::select("
            select p.category_path,
                   sum(case when o.order_date > now() - interval '7 days' then oi.quantity else 0 end) q7,
                   sum(oi.quantity) q30, sum(oi.total_price) rev30
            from order_items oi
            join orders o on o.id = oi.order_id
            join products p on p.id = oi.product_id
            where o.tenant_id = ? and o.order_date > now() - interval '30 days'
              and coalesce(o.order_source,'') not in ($mp) and p.category_path is not null
            group by p.category_path", [$tenantId]);
        $out = [];
        foreach ($rows as $r) {
            $parts = array_map('trim', explode('>', (string) $r->category_path));
            // her önek (Kadın | Kadın > Ayakkabı | Kadın > Ayakkabı > Spor) toplamı alır
            for ($i = 1; $i <= count($parts); $i++) {
                $k = implode(' > ', array_slice($parts, 0, $i));
                $out[$k] = [($out[$k][0] ?? 0) + (int) $r->q7, ($out[$k][1] ?? 0) + (int) $r->q30, ($out[$k][2] ?? 0) + (float) $r->rev30];
            }
        }

        return $out;
    }

    /**
     * Sezon çarpanı (ivme): geçen yıl (bu ay + gelecek ay) satışının, (önceki 2 ay) satışına oranının karekökü.
     * Eylül'de bot için (Eyl+Eki)/(Tem+Ağu) ≈ 8 → 2.5 (tavan): "sezon başlıyor"; sandalet 0.07 → 0.5 (taban).
     * 12 ayda 300 adedin altında satan kategoriye dokunulmaz (gürültü). Aylık cache.
     */
    public static function seasonByPath(int $tenantId): array
    {
        return Cache::remember("menu:season:{$tenantId}:".now()->format('Y-m'), 86400, function () use ($tenantId) {
            $mp = "'".implode("','", self::MARKETPLACES)."'";
            $rows = DB::select("
                select p.category_path, to_char(o.order_date, 'YYYY-MM') m, sum(oi.quantity) q
                from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
                where o.tenant_id = ? and o.order_date > now() - interval '15 months' and o.order_date < now() - interval '1 month'
                  and coalesce(o.order_source,'') not in ($mp) and p.category_path is not null
                group by 1, 2", [$tenantId]);
            $byPath = [];
            foreach ($rows as $r) {
                $parts = array_map('trim', explode('>', (string) $r->category_path));
                for ($i = 1; $i <= count($parts); $i++) {
                    $k = implode(' > ', array_slice($parts, 0, $i));
                    $byPath[$k][$r->m] = ($byPath[$k][$r->m] ?? 0) + (int) $r->q;
                }
            }
            $ly = now()->subYear();
            $win = [$ly->format('Y-m'), $ly->copy()->addMonth()->format('Y-m')];
            $prev = [$ly->copy()->subMonth()->format('Y-m'), $ly->copy()->subMonths(2)->format('Y-m')];
            // Mağaza geneli ivme ile normalize: okula dönüş gibi herkesi kaldıran dalga sezon sayılmaz, kategorinin GÖRELİ yükselişi sayılır
            $allA = 0; $allB = 0;
            foreach ($byPath as $path => $months) {
                if (substr_count($path, ' > ') === 0) { // kök seviyeleri toplamı = mağaza
                    $allA += ($months[$win[0]] ?? 0) + ($months[$win[1]] ?? 0);
                    $allB += ($months[$prev[0]] ?? 0) + ($months[$prev[1]] ?? 0);
                }
            }
            $storeRatio = ($allA + 10) / ($allB + 10);
            $out = [];
            foreach ($byPath as $path => $months) {
                if (array_sum($months) < 300) {
                    continue;
                }
                $a = ($months[$win[0]] ?? 0) + ($months[$win[1]] ?? 0);
                $b = ($months[$prev[0]] ?? 0) + ($months[$prev[1]] ?? 0);
                if ($a + $b < 40) {
                    continue;
                }
                $ratio = (($a + 5) / ($b + 5)) / max(0.1, $storeRatio);
                $out[$path] = round(max(0.5, min(2.5, sqrt($ratio))), 2);
            }

            return $out;
        });
    }

    /**
     * Kategori yolu → temsil görseli. Öncelik: MenuImagePicker seçimi (Akıllı Sıralama üst ürünleri + görsel puanı);
     * yoksa son 30 günde en çok satan ürün (stoklu önce; stoksuz da olur — kategori boş görünmesin).
     */
    public static function imagesByPath(int $tenantId): array
    {
        return Cache::remember("menu:images:{$tenantId}", 3600, function () use ($tenantId) {
            $picked = [];
            foreach (DB::table('menu_category_images')->where('tenant_id', $tenantId)->whereNotNull('image_url')->get(['category_path', 'image_url']) as $r) {
                $picked[$r->category_path] = $r->image_url;
            }
            $auto = static::autoImagesByPath($tenantId);

            return $picked + $auto;
        });
    }

    /** Seçici çalışmamışsa: 30 günde en çok satan (stoklu önce), sonra performans puanı; stoksuz ürün de kabul. */
    public static function autoImagesByPath(int $tenantId): array
    {
        return (function () use ($tenantId) {
            $mp = "'".implode("','", self::MARKETPLACES)."'";
            $rows = DB::select("
                with sales as (
                    select oi.product_id, sum(oi.quantity) q from order_items oi join orders o on o.id = oi.order_id
                    where o.tenant_id = ? and o.order_date > now() - interval '30 days' and coalesce(o.order_source,'') not in ($mp) group by 1)
                select distinct on (p.category_path) p.category_path, p.images
                from products p left join sales s on s.product_id = p.id
                where p.tenant_id = ? and p.is_active and p.category_path is not null
                  and p.images is not null and p.images::text <> '[]' and p.images::text <> 'null'
                order by p.category_path, (case when p.stock_quantity > 0 then 1 else 0 end) desc, s.q desc nulls last, p.performance_score desc nulls last, p.id desc", [$tenantId, $tenantId]);
            $out = [];
            foreach ($rows as $r) {
                $imgs = json_decode((string) $r->images, true);
                if (! is_array($imgs) || ! $imgs) {
                    continue;
                }
                $f = $imgs[0];
                $u = is_array($f) ? ($f['url'] ?? $f['src'] ?? reset($f)) : $f;
                if (is_string($u) && $u !== '') {
                    $out[$r->category_path] = $u;
                    // üst yollar için de ilk bulunan (en çok satan yaprak) görsel
                    $parts = array_map('trim', explode('>', (string) $r->category_path));
                    for ($i = 1; $i < count($parts); $i++) {
                        $k = implode(' > ', array_slice($parts, 0, $i));
                        $out[$k] ??= $u;
                    }
                }
            }

            return $out;
        })();
    }

    /** Segment (kök adı) → son 14 günün en çok satan stoklu ürünleri. */
    public static function popularProducts(int $tenantId, array $rootNames, int $limit = 6): array
    {
        $limit = max(2, min(12, $limit));
        $mp = "'".implode("','", self::MARKETPLACES)."'";
        $rows = DB::select("
            select split_part(p.category_path, ' > ', 1) root, p.platform_product_id pid, p.name, p.url, p.price, p.discounted_price, p.images, sum(oi.quantity) q
            from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
            where o.tenant_id = ? and o.order_date > now() - interval '14 days' and coalesce(o.order_source,'') not in ($mp)
              and p.is_active and p.stock_quantity > 0 and p.images is not null and p.images::text <> '[]'
            group by 1,2,3,4,5,6,7 order by 1, q desc", [$tenantId]);
        $out = [];
        foreach ($rows as $r) {
            if (! in_array($r->root, $rootNames, true) || count($out[$r->root] ?? []) >= $limit) {
                continue;
            }
            $imgs = json_decode((string) $r->images, true);
            $f = is_array($imgs) && $imgs ? $imgs[0] : null;
            $img = is_array($f) ? ($f['url'] ?? $f['src'] ?? null) : $f;
            if (! $img) {
                continue;
            }
            $price = (float) $r->price;
            $d = (float) ($r->discounted_price ?? 0);
            $out[$r->root][] = ['pid' => (string) $r->pid, 'name' => $r->name, 'url' => $r->url, 'price' => $price, 'dprice' => $d > 0 && $d < $price ? $d : null, 'img' => $img, 'q' => (int) $r->q];
        }

        return $out;
    }
}
