<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Hero\TenantHeroSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Bugüne Özel" Hero Ürün kulakçığı storefront API — /w/{slug}/hero/config|event (HeroCors). */
class PublicHeroController extends Controller
{
    public const EVENT_TYPES = ['view', 'open', 'close', 'click', 'atc', 'coupon', 'error'];

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantHeroSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $day = now('Europe/Istanbul')->format('Y-m-d');
        // Ürün fiyat/stok verisi 60 sn önbellek: sayfa başına bir istek gelir, DB'ye dakikada bir iner.
        $payload = Cache::remember("hero:config:{$tenant->id}:{$day}", 60, function () use ($tenant, $s, $ts, $day) {
            $set = TenantHeroSettings::activeSet($s['sets'], $day);
            $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
            $products = $set ? self::resolveProducts($tenant->id, $set['products'], $shop) : [];
            if ($products && $s['rules']['best_color'] !== false) {
                $products = self::applyBestColor($tenant->id, $products, $shop);
            }
            // Stoksuz ürün kulakçıkta gösterilmez (gerçek veri ilkesi)
            $products = array_values(array_filter($products, fn ($p) => $p['in_stock']));
            // Set rozeti (örn. "Kadın · Çocuk") otomatik Kadın/Erkek/Çocuk rozetini ezer
            if ($set && ($set['badge'] ?? '') !== '') {
                $products = array_map(function ($p) use ($set) {
                    $p['segment'] = $set['badge'];

                    return $p;
                }, $products);
            }

            return [
                'set' => $set ? [
                    'id' => $set['id'],
                    'title' => $set['title'] !== '' ? $set['title'] : $s['rules']['title'],
                    'subtitle' => $set['subtitle'] !== '' ? $set['subtitle'] : $s['rules']['subtitle'],
                    'eyebrow' => (string) ($set['eyebrow'] ?? ''),
                    'badge' => (string) ($set['badge'] ?? ''),
                    'coupon' => $set['coupon'],
                    'coupon_text' => $set['coupon_text'],
                    'start_date' => $set['start_date'],
                    'end_date' => $set['end_date'],
                ] : null,
                'products' => $products,
                'ends_at' => self::endsAt($s['rules']['timer_mode'], $set),
            ];
        });

        // Setin kendi kulakçık metni varsa kulakçık + şerit + eyebrow onu gösterir (widget değişikliği gerekmez)
        $theme = $s['theme'];
        $rules = $s['rules'];
        if (! empty($payload['set']['eyebrow'])) {
            $theme['tab_text'] = $payload['set']['eyebrow'];
            $rules['eyebrow'] = $payload['set']['eyebrow'];
        }

        return response()->json([
            'theme' => $theme,
            'rules' => $rules,
            'set' => $payload['set'],
            'products' => $payload['products'],
            'ends_at' => $payload['ends_at'],
            'now' => (int) round(microtime(true) * 1000),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'platform' => (string) ($ts['platform'] ?? (str_contains(strtolower((string) ($ts['shop_url'] ?? '')), 'ikas') ? 'ikas' : 'ticimax')),
        ])->header('Cache-Control', 'public, max-age=60');
    }

    /** Sayaç bitişi (ms, epoch): midnight → bugün 23:59:59 TR; set_end → set bitiş günü 23:59:59; off → null. */
    public static function endsAt(string $mode, ?array $set): ?int
    {
        if ($mode === 'off' || $mode === 'zero') { // zero: flash.js sabit 00:00:00 gösterir, süre dolmaz
            return null;
        }
        $tz = 'Europe/Istanbul';
        if ($mode === 'set_end' && $set && $set['end_date']) {
            return \Carbon\Carbon::createFromFormat('Y-m-d', $set['end_date'], $tz)->endOfDay()->getTimestamp() * 1000;
        }

        return now($tz)->endOfDay()->getTimestamp() * 1000;
    }

    /**
     * Ürün kartları (sıra korunur): fiyat, indirim %, thumb görsel, gerçek stok, stoklu varyantlar (beden çipleri).
     * Görsel: Ticimax 'buyuk' (2 MB) → 'thumb' (400×600 ~40 KB).
     */
    public static function resolveProducts(int $tenantId, array $ids, string $shopUrl = ''): array
    {
        if (! $ids) {
            return [];
        }
        $rows = DB::table('products')->where('tenant_id', $tenantId)->whereIn('id', $ids)
            ->get(['id', 'platform_product_id', 'name', 'url', 'price', 'discounted_price', 'images', 'stock_quantity', 'is_active', 'trendyol_rating', 'brand', 'sku', 'category', 'category_path']);
        $variants = DB::table('product_variants')->where('tenant_id', $tenantId)->whereIn('product_id', $ids)->where('is_active', true)
            ->orderBy('id')->get(['product_id', 'platform_variant_id', 'attributes', 'stock_quantity', 'price', 'discounted_price']);
        $byProduct = [];
        foreach ($variants as $v) {
            $byProduct[(int) $v->product_id][] = $v;
        }
        $siblings = self::colorSiblings($tenantId, $rows, $shopUrl);
        $map = [];
        foreach ($rows as $r) {
            $imgs = json_decode((string) $r->images, true);
            $imgs = is_array($imgs) ? array_values(array_filter(array_map(fn ($f) => is_array($f) ? ($f['url'] ?? $f['src'] ?? null) : $f, $imgs))) : [];
            $imgs = array_map([self::class, 'thumb'], array_slice($imgs, 0, 3));
            $price = (float) $r->price;
            $d = (float) ($r->discounted_price ?? 0);
            $dprice = $d > 0 && $d < $price ? $d : null;
            $vs = $byProduct[(int) $r->id] ?? [];
            $colors = [];
            foreach ($vs as $v) {
                $a = json_decode((string) $v->attributes, true) ?: [];
                if (! empty($a['Renk'])) {
                    $colors[$a['Renk']] = true;
                }
            }
            $multiColor = count($colors) > 1;
            $vout = [];
            $vstock = 0;
            foreach ($vs as $v) {
                $a = json_decode((string) $v->attributes, true) ?: [];
                $parts = [];
                foreach ($a as $k => $val) {
                    if ($k === 'Renk' && ! $multiColor) {
                        continue;
                    }
                    if ($val !== null && $val !== '') {
                        $parts[] = (string) $val;
                    }
                }
                $label = $parts ? implode(' / ', $parts) : 'Standart';
                $st = (int) $v->stock_quantity;
                $vstock += max(0, $st);
                $vout[] = ['vid' => (string) $v->platform_variant_id, 'label' => mb_substr($label, 0, 24), 'stock' => max(0, $st), 'sort' => self::sizeSort($label)];
            }
            usort($vout, fn ($x, $y) => $x['sort'] <=> $y['sort'] ?: strcmp($x['label'], $y['label']));
            $vout = array_map(fn ($v) => ['vid' => $v['vid'], 'label' => $v['label'], 'stock' => $v['stock']], $vout);
            $stock = $vs ? $vstock : max(0, (int) $r->stock_quantity);
            $url = (string) $r->url;
            if ($url !== '' && ! preg_match('~^https?://~', $url) && $shopUrl !== '') {
                $url = $shopUrl.'/'.ltrim($url, '/');
            }
            $map[(int) $r->id] = [
                'id' => (int) $r->id,
                'pid' => (string) $r->platform_product_id,
                'name' => $r->name,
                'brand' => $r->brand,
                'sku' => $r->sku,
                'url' => $url,
                'price' => $price,
                'dprice' => $dprice,
                'discount_pct' => $dprice ? (int) round(($price - $dprice) / $price * 100) : 0,
                'img' => $imgs[0] ?? null,
                'imgs' => $imgs,
                'stock' => $stock,
                'in_stock' => (bool) $r->is_active && $stock > 0 && ! empty($imgs),
                'active' => (bool) $r->is_active,
                'rating' => $r->trendyol_rating !== null ? round((float) $r->trendyol_rating, 1) : null,
                'variants' => array_values(array_filter($vout, fn ($v) => $v['stock'] > 0)),
                'color' => count($colors) === 1 ? array_key_first($colors) : null,
                'colors' => $siblings[(int) $r->id] ?? [],
                'segment' => self::segment((string) $r->category_path, (string) $r->category, (string) $r->name),
            ];
        }
        $out = [];
        foreach ($ids as $id) {
            if (isset($map[(int) $id])) {
                $out[] = $map[(int) $id];
            }
        }

        return $out;
    }

    /**
     * Renk seçenekleri (minimal düzen): aynı model koduna (SKU 2. segment, ör. NEBIMV3|V2QNT-0|…) sahip
     * aktif+stoklu+görselli kardeş ürünler — her biri bir renk (varyant Renk özniteliği). Mevcut ürün ilk sırada.
     * Tonny'de renkler ayrı ürün kartıdır; aynı ürünün varyantlarında birden çok Renk varsa onlar da eklenir.
     */
    public static function colorSiblings(int $tenantId, $rows, string $shopUrl): array
    {
        $models = [];
        foreach ($rows as $r) {
            $seg = explode('|', (string) $r->sku)[1] ?? '';
            if ($seg !== '') {
                $models[(int) $r->id] = $seg;
            }
        }
        if (! $models) {
            return [];
        }
        $sibs = DB::table('products as p')
            ->leftJoin('product_variants as v', fn ($j) => $j->on('v.product_id', '=', 'p.id')->where('v.is_active', true)->where('v.stock_quantity', '>', 0))
            ->where('p.tenant_id', $tenantId)->where('p.is_active', true)->where('p.stock_quantity', '>', 0)
            ->whereNotNull('p.images')->where('p.images', '<>', '[]')
            ->whereIn(DB::raw("split_part(p.sku, '|', 2)"), array_values(array_unique($models)))
            ->groupBy('p.id', 'p.sku', 'p.name', 'p.url', 'p.price', 'p.discounted_price', 'p.images', 'p.stock_quantity')
            ->orderByDesc('p.stock_quantity')
            ->get(['p.id', 'p.sku', 'p.name', 'p.url', 'p.price', 'p.discounted_price', 'p.images', 'p.stock_quantity', DB::raw("string_agg(distinct v.attributes->>'Renk', '|') as renk")]);
        $byModel = [];
        foreach ($sibs as $sb) {
            $seg = explode('|', (string) $sb->sku)[1] ?? '';
            $imgs = json_decode((string) $sb->images, true);
            $first = is_array($imgs) && $imgs ? (is_array($imgs[0]) ? ($imgs[0]['url'] ?? $imgs[0]['src'] ?? null) : $imgs[0]) : null;
            if (! $first) {
                continue;
            }
            $names = array_values(array_filter(array_unique(explode('|', (string) $sb->renk))));
            $name = $names ? $names[0] : self::colorFromName((string) $sb->name);
            $url = (string) $sb->url;
            if ($url !== '' && ! preg_match('~^https?://~', $url) && $shopUrl !== '') {
                $url = $shopUrl.'/'.ltrim($url, '/');
            }
            $price = (float) $sb->price;
            $d = (float) ($sb->discounted_price ?? 0);
            $hex = self::colorHex($name);
            $byModel[$seg][] = ['id' => (int) $sb->id, 'name' => $name ?: 'Renk', 'hex' => $hex[0], 'hex2' => $hex[1], 'img' => self::thumb($first), 'url' => $url,
                'price' => $price, 'dprice' => $d > 0 && $d < $price ? $d : null, 'stock' => (int) $sb->stock_quantity];
        }
        $out = [];
        foreach ($models as $pid => $seg) {
            $list = $byModel[$seg] ?? [];
            usort($list, fn ($a, $b) => ($b['id'] === $pid) <=> ($a['id'] === $pid) ?: $b['stock'] <=> $a['stock']);
            // aynı renk adı iki kez olmasın
            $seen = [];
            $list = array_values(array_filter($list, function ($c) use (&$seen) {
                $k = mb_strtolower($c['name']);
                if (isset($seen[$k])) {
                    return false;
                }
                $seen[$k] = true;

                return true;
            }));
            $out[$pid] = array_slice($list, 0, 12);
        }

        return $out;
    }

    /** "Siyah Turuncu" → [#111111, #f97316]; tek kelime → [hex, null]; bilinmeyen → [null,null]. */
    public static function colorHex(?string $name): array
    {
        $map = \App\Services\Filter\FilterEngine::COLOR_HEX + ['turuncu' => '#f97316', 'oranj' => '#fb923c', 'sax' => '#0ea5e9', 'leopar' => '#b08850', 'süet' => '#8b6b4a', 'suet' => '#8b6b4a', 'acı' => '#5c3a21', 'çok' => null, 'renkli' => null];
        $words = preg_split('/\s+/', mb_strtolower(trim((string) $name)));
        $hex = [];
        foreach ($words as $w) {
            if (isset($map[$w]) && $map[$w]) {
                $hex[] = $map[$w];
            }
        }
        if (str_contains(mb_strtolower((string) $name), 'çok renkli')) {
            return ['multi', null];
        }

        return [$hex[0] ?? null, $hex[1] ?? null];
    }

    /** Ürün adından renk tahmini (Renk özniteliği yoksa): bilinen renk kelimelerinin ardışık dizisi. */
    protected static function colorFromName(string $name): string
    {
        $map = \App\Services\Filter\FilterEngine::COLOR_HEX + ['turuncu' => 1, 'oranj' => 1, 'sax' => 1, 'leopar' => 1, 'süet' => 1];
        $found = [];
        foreach (preg_split('/\s+/', $name) as $w) {
            if (isset($map[mb_strtolower($w)])) {
                $found[] = $w;
            }
        }

        return implode(' ', array_slice($found, 0, 2));
    }

    /**
     * Modelin en çok satan (90g, ödenmiş) + en çok tıklanan (hero 30g) rengi: setteki ürün yerine o renk kartı gösterilir.
     * Dönüş: [setProductId => ['id','name','color','sales','clicks']] (yalnız farklı bir renk seçildiyse veya bilgi için).
     */
    public static function bestColorMap(int $tenantId, array $cards): array
    {
        $ids = [];
        foreach ($cards as $c) {
            foreach ($c['colors'] ?? [] as $col) {
                $ids[] = $col['id'];
            }
        }
        $ids = array_values(array_unique($ids));
        if (! $ids) {
            return [];
        }
        $sales = DB::table('order_items as oi')->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->where('o.tenant_id', $tenantId)->where('o.order_date', '>', now()->subDays(90))->where('o.paid_amount', '>', 0)
            ->whereIn('oi.product_id', $ids)->groupBy('oi.product_id')->selectRaw('oi.product_id, sum(oi.quantity) q')->pluck('q', 'product_id')->all();
        $clicks = DB::table('hero_events')->where('tenant_id', $tenantId)->where('is_test', false)->whereIn('type', ['click', 'atc'])
            ->where('created_at', '>', now()->subDays(30))->whereIn('product_id', $ids)->groupBy('product_id')->selectRaw('product_id, count(*) c')->pluck('c', 'product_id')->all();
        $out = [];
        foreach ($cards as $c) {
            $cols = $c['colors'] ?? [];
            if (count($cols) < 2) {
                continue;
            }
            $best = null;
            $bestScore = -1;
            foreach ($cols as $col) {
                $score = (float) ($sales[$col['id']] ?? 0) * 1.0 + (float) ($clicks[$col['id']] ?? 0) * 0.5 + min(1, $col['stock'] / 1000) * 0.01;
                if ($score > $bestScore) {
                    $best = $col;
                    $bestScore = $score;
                }
            }
            if ($best) {
                $out[$c['id']] = ['id' => $best['id'], 'color' => $best['name'], 'sales' => (int) ($sales[$best['id']] ?? 0), 'clicks' => (int) ($clicks[$best['id']] ?? 0), 'changed' => $best['id'] !== $c['id']];
            }
        }

        return $out;
    }

    /** Set ürünlerini en çok satan renk kartıyla değiştirir (sıra korunur, renk listesi aynı model). */
    public static function applyBestColor(int $tenantId, array $products, string $shopUrl): array
    {
        $map = self::bestColorMap($tenantId, $products);
        $ids = [];
        $changed = false;
        foreach ($products as $p) {
            $ids[] = isset($map[$p['id']]) && $map[$p['id']]['changed'] ? $map[$p['id']]['id'] : $p['id'];
            $changed = $changed || (isset($map[$p['id']]) && $map[$p['id']]['changed']);
        }
        if (! $changed) {
            return $products;
        }
        $fresh = self::resolveProducts($tenantId, $ids, $shopUrl);

        return $fresh ?: $products;
    }

    /**
     * Foto üzerindeki hedef kitle rozeti: kategori yolunun kökü (Kadın/Erkek/Çocuk).
     * Bulunamazsa ürün adından tahmin edilir; hiçbiri tutmazsa null (rozet çizilmez).
     */
    public static function segment(string $path, string $category, string $name): ?string
    {
        $hay = mb_strtolower($path.' '.$category.' '.$name);
        // Kullanıcı kararı (11 Eyl): 'Bebek' ayrımı YOK — bebe ürünleri de 'Çocuk' rozeti taşır.
        $root = mb_strtolower(trim(explode('>', $path)[0] ?? ''));
        foreach (['kadın' => 'Kadın', 'erkek' => 'Erkek', 'çocuk' => 'Çocuk', 'unisex' => 'Unisex'] as $k => $v) {
            if ($root === $k) {
                return $v;
            }
        }
        foreach (['çocuk' => 'Çocuk', 'kadın' => 'Kadın', 'erkek' => 'Erkek'] as $k => $v) {
            if (mb_strpos($hay, $k) !== false) {
                return $v;
            }
        }

        return null;
    }

    public static function thumb(?string $u): ?string
    {
        if (! $u) {
            return $u;
        }

        return preg_replace('~/mnresize/\d+/\d+/~', '/mnresize/300/400/', preg_replace('~/UrunResimleri/buyuk/~i', '/UrunResimleri/thumb/', $u));
    }

    /** Beden sıralaması: sayısal küçükten büyüğe, harf bedenleri XS→XXL, diğerleri sona. */
    protected static function sizeSort(string $label): int
    {
        $first = trim(explode('/', $label)[0]);
        if (preg_match('/^(\d+(?:[.,]\d)?)/', $first, $m)) {
            return (int) round((float) str_replace(',', '.', $m[1]) * 10);
        }
        $letters = ['XXS' => 1, 'XS' => 2, 'S' => 3, 'M' => 4, 'L' => 5, 'XL' => 6, 'XXL' => 7, '2XL' => 7, '3XL' => 8, 'XXXL' => 8, '4XL' => 9];
        $u = strtoupper($first);

        return isset($letters[$u]) ? 5000 + $letters[$u] : 9000;
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
        if (! in_array($type, self::EVENT_TYPES, true)) {
            return response()->json(['ok' => false], 422);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $isTest = $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;
        $pid = (int) $request->input('product_id', 0);

        DB::table('hero_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'source' => mb_substr((string) $request->input('source', ''), 0, 16) ?: null,
            'set_id' => mb_substr((string) $request->input('set_id', ''), 0, 24) ?: null,
            'product_id' => $pid > 0 ? $pid : null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'ip_address' => in_array($type, ['click', 'atc'], true) ? mb_substr((string) $request->ip(), 0, 45) : null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'page_type' => mb_substr((string) $request->input('page_type', ''), 0, 16) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
