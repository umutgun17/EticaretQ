<?php

namespace App\Services\Badge;

use App\Models\Channel;
use App\Models\Tenant;
use App\Services\GoogleAnalyticsService;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Ürün Rozetleri haritasını GERÇEK veriden üretir ve önbelleğe yazar (badges:build, 15 dk).
 * Anahtar = mağazadaki ürün kartı ID'si (Ticimax UrunKartiID = products.platform_product_id;
 * liste kartında .detailLink[data-id], detayda productDetailModel.productId).
 *
 * Çıktı: {built_at, counts:{typeId:n}, b:{pid:["typeId" | "typeId:değer"]}, p:{pid:{s24,s7,v7,sz:[…]}}}
 *  b = rozetler (öncelik sırası korunur; değer {n}/{rate}/{count} yer tutucuları için)
 *  p = ürün detay sosyal kanıt sayıları (yalnız eşiği geçenler)
 */
class BadgeBuilder
{
    public const CACHE_TTL = 86400 * 2;

    public static function cacheKey(int $tenantId): string
    {
        return "badge:map:{$tenantId}";
    }

    public static function cached(int $tenantId): ?array
    {
        $v = Cache::get(self::cacheKey($tenantId));

        return is_array($v) ? $v : null;
    }

    public function build(Tenant $tenant): array
    {
        $t0 = microtime(true);
        $tid = (int) $tenant->id;
        $s = TenantBadgeSettings::get($tid);
        $rules = $s['rules'];

        // Kart evreni: platform id → {id, stock, created}
        $products = DB::table('products')->where('tenant_id', $tid)->where('is_active', true)
            ->whereNotNull('platform_product_id')
            ->get(['id', 'platform_product_id', 'stock_quantity', 'platform_created_at']);
        $byDb = [];
        $stock = [];
        foreach ($products as $p) {
            $pid = (string) $p->platform_product_id;
            $byDb[(int) $p->id] = $pid;
            $stock[$pid] = (int) $p->stock_quantity;
        }

        $b = [];
        $counts = [];
        $notes = [];
        $catHit = [];
        $exclusive = array_values((array) ($rules['exclusive'] ?? []));
        $exclHit = [];
        // Kategori tipleri önce çözülür ki "Yeni" bastırma kuralı sıradan bağımsız çalışsın
        $types = $s['types'];
        usort($types, fn ($a, $c) => (in_array($a['kind'], ['category', 'tag'], true) ? 0 : 1) <=> (in_array($c['kind'], ['category', 'tag'], true) ? 0 : 1));
        $order = array_flip(array_column($s['types'], 'id'));
        foreach ($types as $type) {
            if (! $type['enabled']) {
                continue;
            }
            try {
                $hits = $this->resolve($tid, $type, $byDb, $stock, $products);
            } catch (\Throwable $e) {
                $notes[] = "{$type['id']}: ".$e->getMessage();
                Log::warning('badge build type failed', ['tenant' => $tid, 'type' => $type['id'], 'e' => $e->getMessage()]);
                continue;
            }
            $n = 0;
            foreach ($hits as $pid => $val) {
                $pid = (string) $pid;
                if ($rules['hide_out_of_stock'] && isset($stock[$pid]) && $stock[$pid] <= 0) {
                    continue;
                }
                if ($type['kind'] === 'category' || $type['kind'] === 'tag') {
                    $catHit[$pid] = true;
                } elseif ($type['kind'] === 'new' && ! empty($rules['new_skip_category']) && isset($catHit[$pid])) {
                    continue;
                }
                if (in_array($type['kind'], $exclusive, true) || in_array($type['id'], $exclusive, true)) {
                    if (isset($exclHit[$pid])) {
                        continue;
                    }
                    $exclHit[$pid] = true;
                }
                $b[$pid][] = $val === null || $val === '' ? $type['id'] : $type['id'].':'.$val;
                $n++;
            }
            $counts[$type['id']] = $n;
        }

        // Rozetleri panel sırasına (= öncelik) diz
        foreach ($b as $pid => $list) {
            usort($list, fn ($x, $y) => ($order[explode(':', $x, 2)[0]] ?? 99) <=> ($order[explode(':', $y, 2)[0]] ?? 99));
            $b[$pid] = $list;
        }

        // Ürün detay sosyal kanıt sayıları
        $p = [];
        if ($rules['proof_enabled']) {
            try {
                $this->proof($tid, $rules, $byDb, $stock, $p);
            } catch (\Throwable $e) {
                $notes[] = 'proof: '.$e->getMessage();
                Log::warning('badge proof failed', ['tenant' => $tid, 'e' => $e->getMessage()]);
            }
        }

        $out = [
            'built_at' => now()->toIso8601String(),
            'duration_ms' => (int) round((microtime(true) - $t0) * 1000),
            'counts' => $counts,
            'badged' => count($b),
            'proof' => count($p),
            'notes' => $notes,
            'b' => $b,
            'p' => (object) $p,
        ];
        Cache::put(self::cacheKey($tid), $out, self::CACHE_TTL);

        return $out;
    }

    /** @return array<string,string|null> platform_product_id → yer tutucu değeri (yoksa null) */
    protected function resolve(int $tid, array $type, array $byDb, array $stock, $products): array
    {
        $prm = $type['params'];

        switch ($type['kind']) {
            case 'category':
                return array_fill_keys($this->categoryCards($tid, (int) $prm['category_id']), null);

            case 'tag':
                $cards = $this->tagCards($tid, (int) $prm['tag_id']);
                $pct = (int) ($prm['cart_pct'] ?? 0);
                if ($pct <= 0 || ! $cards) {
                    return array_fill_keys($cards, null);
                }
                // Sepet fiyatı: indirimli (yoksa liste) fiyat × (100−pct)/100 → "474,95"
                $rows = DB::table('products')->where('tenant_id', $tid)->whereIn('platform_product_id', $cards)->get(['platform_product_id', 'price', 'discounted_price']);
                $out = array_fill_keys($cards, null);
                foreach ($rows as $r) {
                    $cur = (float) ($r->discounted_price ?? 0) > 0 && (float) $r->discounted_price < (float) $r->price ? (float) $r->discounted_price : (float) $r->price;
                    if ($cur > 0) {
                        $out[(string) $r->platform_product_id] = number_format(round($cur * (100 - $pct) / 100, 2), 2, ',', '.');
                    }
                }

                return $out;

            case 'bestseller':
                $rows = $this->sales($tid, now()->subDays($prm['days']));
                arsort($rows);
                $out = [];
                foreach ($rows as $dbId => $q) {
                    if ($q < $prm['min_qty'] || count($out) >= $prm['top']) {
                        break;
                    }
                    if (isset($byDb[$dbId])) {
                        $out[$byDb[$dbId]] = (string) $q;
                    }
                }

                return $out;

            case 'popular':
                $views = $this->views($tid, $prm['days']);
                arsort($views);
                $out = [];
                foreach ($views as $pid => $v) {
                    if ($v < $prm['min_views'] || count($out) >= $prm['top']) {
                        break;
                    }
                    $out[$pid] = (string) $v;
                }

                return $out;

            case 'new':
                $since = now()->subDays($prm['days']);
                $out = [];
                foreach ($products as $p) {
                    if ($p->platform_created_at && $p->platform_created_at >= $since && (int) $p->stock_quantity > 0) {
                        $out[(string) $p->platform_product_id] = null;
                    }
                }

                return $out;

            case 'low_stock':
                $out = [];
                foreach ($stock as $pid => $q) {
                    if ($q >= 1 && $q <= $prm['threshold']) {
                        $out[$pid] = (string) $q;
                    }
                }

                return $out;

            case 'top_rated':
                $rows = DB::table('product_review_summaries')->where('tenant_id', $tid)
                    ->where('avg_rate', '>=', $prm['min_rate'])->where('rate_count', '>=', $prm['min_count'])
                    ->get(['product_id', 'avg_rate', 'rate_count']);
                $out = [];
                foreach ($rows as $r) {
                    if (isset($byDb[(int) $r->product_id])) {
                        $out[$byDb[(int) $r->product_id]] = number_format((float) $r->avg_rate, 1, ',', '').'|'.(int) $r->rate_count;
                    }
                }

                return $out;
        }

        return [];
    }

    /** Kategorideki kart ID'leri: Ticimax canlı (yeni açılan kartlar dahil) ∪ DB kategori eşlemesi. */
    protected function categoryCards(int $tid, int $categoryId): array
    {
        $ids = DB::table('product_platform_categories')->where('tenant_id', $tid)
            ->where('platform_category_id', (string) $categoryId)->pluck('platform_product_id')
            ->map(fn ($v) => (string) $v)->all();

        $ch = Channel::withoutGlobalScopes()->where('tenant_id', $tid)->where('type', 'ticimax-ecommerce')->where('is_active', true)->first();
        if ($ch) {
            $tm = TicimaxService::fromChannel($ch);
            if ($tm->isAvailable()) {
                $page = 1;
                do {
                    $res = $tm->getProductCards(['KategoriID' => $categoryId, 'Aktif' => 1], $page, 100);
                    if (! ($res['success'] ?? false)) {
                        break;
                    }
                    $cards = $res['data']['SelectUrunResult']['UrunKarti'] ?? [];
                    if (isset($cards['ID'])) {
                        $cards = [$cards];
                    }
                    foreach ($cards as $c) {
                        if (! empty($c['ID'])) {
                            $ids[] = (string) $c['ID'];
                        }
                    }
                    $page++;
                } while (count($cards) === 100 && $page <= 20);
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Ticimax etiketindeki kart ID'leri — UrunServis SelectUrunEtiket (canlı). Servis tek çağrıda en çok 100 satır
     * döndürüyor (14 Eki gözlemi); 100 gelirse ürün bazlı tamamlama: DB'de aynı model ailesi (SKU 2. parça) kartları tek tek sorgulanır.
     */
    protected function tagCards(int $tid, int $tagId): array
    {
        $ch = Channel::withoutGlobalScopes()->where('tenant_id', $tid)->where('type', 'ticimax-ecommerce')->where('is_active', true)->first();
        if (! $ch) {
            return [];
        }
        $creds = $ch->credentials ?? [];
        $wsdl = preg_replace('/[^\/]+\.svc(\?wsdl)?$/i', '', (string) ($creds['wsdl_url'] ?? '')).'UrunServis.svc?wsdl';
        $client = new \SoapClient($wsdl, ['cache_wsdl' => WSDL_CACHE_MEMORY, 'connection_timeout' => 20]);
        $sel = function (int $card) use ($client, $creds, $tagId) {
            $r = json_decode(json_encode($client->SelectUrunEtiket(['UyeKodu' => $creds['auth_code'] ?? '', 'EtiketID' => $tagId, 'UrunKartiID' => $card])), true);
            $l = $r['SelectUrunEtiketResult']['UrunEtiket'] ?? [];

            return isset($l['EtiketID']) ? [$l] : (is_array($l) ? $l : []);
        };
        $ids = [];
        foreach ($sel(-1) as $row) {
            if (! empty($row['UrunKartiID'])) {
                $ids[(string) $row['UrunKartiID']] = true;
            }
        }
        if (count($ids) >= 100) {
            // Sayfa sınırı: etiketli kartların model ailelerindeki diğer kartları tek tek doğrula
            $known = DB::table('products')->where('tenant_id', $tid)->whereIn('platform_product_id', array_keys($ids))->pluck('sku')->all();
            $models = array_values(array_unique(array_filter(array_map(fn ($sku) => explode('|', (string) $sku)[1] ?? '', $known))));
            if ($models) {
                $cands = DB::table('products')->where('tenant_id', $tid)->where('is_active', true)->whereNotNull('platform_product_id')
                    ->where(function ($q) use ($models) {
                        foreach ($models as $m) {
                            $q->orWhere('sku', 'like', '%|'.str_replace(['%', '_'], ['\%', '\_'], $m).'|%');
                        }
                    })->pluck('platform_product_id')->map(fn ($v) => (string) $v)->all();
                foreach (array_diff($cands, array_keys($ids)) as $card) {
                    if ($sel((int) $card)) {
                        $ids[$card] = true;
                    }
                    if (count($ids) > 2000) {
                        break;
                    }
                }
            }
        }

        return array_keys($ids);
    }

    /** Ödenmiş, iptal olmayan siparişlerde ürün (DB id) başına adet. */
    protected function sales(int $tid, $since): array
    {
        return DB::table('order_items as oi')->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->where('o.tenant_id', $tid)->where('o.order_date', '>=', \Carbon\Carbon::parse($since)->setTimezone('Europe/Istanbul')->format('Y-m-d H:i:s')) // order_date TR yerel saatle tutulur, uygulama UTC
            ->where('o.payment_status', 1)->where('o.status', '<>', 8)->whereNotNull('oi.product_id')
            ->groupBy('oi.product_id')->selectRaw('oi.product_id, sum(oi.quantity) q')
            ->pluck('q', 'oi.product_id')->map(fn ($v) => (int) $v)->all();
    }

    /** GA4 itemsViewed (son N gün) → platform_product_id başına toplam (varyant satırları karta toplanır). */
    protected function views(int $tid, int $days): array
    {
        return array_map(fn ($x) => $x[0], $this->ga4($tid, $days));
    }

    /** GA4 ürün istatistikleri → platform_product_id => [views, add_to_carts] (varyant satırları karta toplanır). */
    protected function ga4(int $tid, int $days): array
    {
        return Cache::remember("badge:ga4:{$tid}:{$days}", 3 * 3600, function () use ($tid, $days) {
            $tenant = Tenant::find($tid);
            $ga = $tenant ? GoogleAnalyticsService::fromTenant($tenant) : null;
            if (! $ga || ! $ga->isAvailable()) {
                return [];
            }
            $rows = $ga->getProductStats(now()->subDays($days)->format('Y-m-d'), now()->format('Y-m-d')) ?? [];
            $platform = DB::table('products')->where('tenant_id', $tid)->whereNotNull('platform_product_id')
                ->pluck('platform_product_id', 'platform_product_id')->all();
            $variant = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('p.tenant_id', $tid)->whereNotNull('v.platform_variant_id')
                ->pluck('p.platform_product_id', 'v.platform_variant_id')->all();
            $out = [];
            foreach ($rows as $r) {
                $id = (string) ($r['item_id'] ?? '');
                $pid = $platform[$id] ?? $variant[$id] ?? null;
                if ($pid) {
                    $k = (string) $pid;
                    $out[$k] = [($out[$k][0] ?? 0) + (int) $r['views'], ($out[$k][1] ?? 0) + (int) ($r['add_to_carts'] ?? 0)];
                }
            }

            return $out;
        });
    }

    /** Kategori içi satış sırası (7g): ürün → en iyi (en düşük) sıra + kategori adı. Kampanya/kök kategoriler (depth 0) hariç. */
    protected function categoryRanks(int $tid, array $byDb, array $rules): array
    {
        $sales = $this->sales($tid, now()->subDays(7));
        if (! $sales) {
            return [];
        }
        $rows = DB::table('product_platform_categories as ppc')
            ->join('platform_categories as pc', fn ($j) => $j->on('pc.tenant_id', '=', 'ppc.tenant_id')->on('pc.platform_category_id', '=', 'ppc.platform_category_id'))
            ->where('ppc.tenant_id', $tid)->where('pc.depth', '>=', 1)->where('pc.is_active', true)
            ->whereIn('ppc.product_id', array_keys($sales))
            ->get(['ppc.product_id', 'pc.platform_category_id', 'pc.name', 'pc.depth']);
        $byCat = [];
        $meta = [];
        foreach ($rows as $r) {
            $byCat[$r->platform_category_id][(int) $r->product_id] = $sales[(int) $r->product_id] ?? 0;
            $meta[$r->platform_category_id] = [$r->name, (int) $r->depth];
        }
        $best = [];
        $max = max(1, (int) $rules['proof_rank_max']);
        $minQty = max(1, (int) $rules['proof_rank_min_qty']);
        foreach ($byCat as $cat => $list) {
            if (count($list) < 8) { // sıralama anlamlı olsun: kategoride en az 8 satan ürün
                continue;
            }
            arsort($list);
            $rank = 0;
            foreach ($list as $dbId => $q) {
                $rank++;
                if ($rank > $max || $q < $minQty) {
                    break;
                }
                $pid = $byDb[$dbId] ?? null;
                if (! $pid) {
                    continue;
                }
                $cur = $best[$pid] ?? null;
                // daha iyi sıra; eşitse daha derin (daha özgül) kategori
                if (! $cur || $rank < $cur['r'] || ($rank === $cur['r'] && $meta[$cat][1] > $cur['d'])) {
                    $best[$pid] = ['r' => $rank, 'c' => $meta[$cat][0], 'd' => $meta[$cat][1]];
                }
            }
        }

        return array_map(fn ($x) => ['r' => $x['r'], 'c' => $x['c']], $best);
    }

    protected function proof(int $tid, array $rules, array $byDb, array $stock, array &$p): void
    {
        $put = function (string $pid, string $k, $v) use (&$p, $stock, $rules) {
            if ($rules['hide_out_of_stock'] && isset($stock[$pid]) && $stock[$pid] <= 0) {
                return;
            }
            $p[$pid][$k] = $v;
        };
        if ($rules['proof_sold_24h']) {
            foreach ($this->sales($tid, now()->subDay()) as $dbId => $q) {
                if ($q >= (int) $rules['proof_sold_24h_min'] && isset($byDb[$dbId])) {
                    $put($byDb[$dbId], 's24', $q);
                }
            }
        }
        if ($rules['proof_sold_7d']) {
            foreach ($this->sales($tid, now()->subDays(7)) as $dbId => $q) {
                if ($q >= (int) $rules['proof_sold_7d_min'] && isset($byDb[$dbId])) {
                    $put($byDb[$dbId], 's7', $q);
                }
            }
        }
        if (! empty($rules['proof_sold_30d'])) {
            foreach ($this->sales($tid, now()->subDays(30)) as $dbId => $q) {
                if ($q >= (int) $rules['proof_sold_30d_min'] && isset($byDb[$dbId])) {
                    $put($byDb[$dbId], 's30', $q);
                }
            }
        }
        if (! empty($rules['proof_rank'])) {
            foreach ($this->categoryRanks($tid, $byDb, $rules) as $pid => $rk) {
                $put((string) $pid, 'rk', $rk);
            }
        }
        if (! empty($rules['proof_cart'])) {
            // Sepetindeki kişi: ödeme adımına gelip ÖDEMEYİ TAMAMLAMAMIŞ denemeler (Ticimax payment_status=0, status=0) —
            // son N saatte, farklı kişi; aynı kişi o ürünü sonradan ödediyse düşülür. Saat karşılaştırması DB'de (TR saati).
            $h = max(1, min(72, (int) ($rules['proof_cart_hours'] ?? 24)));
            $rows = DB::select("with u as (
                    select coalesce(o.customer_id::text, nullif(lower(o.customer_email), ''), o.platform_customer_id) who, o.order_date, oi.product_id
                    from orders o join order_items oi on oi.order_id = o.id
                    where o.tenant_id = ? and o.payment_status = 0 and o.status = 0 and o.order_date > now() - make_interval(hours => ?) and oi.product_id is not null),
                paid as (
                    select coalesce(o.customer_id::text, nullif(lower(o.customer_email), ''), o.platform_customer_id) who, oi.product_id, o.order_date
                    from orders o join order_items oi on oi.order_id = o.id
                    where o.tenant_id = ? and o.payment_status = 1 and o.order_date > now() - make_interval(hours => ?) - interval '1 day')
                select u.product_id, count(distinct u.who) n from u
                where u.who is not null and not exists (select 1 from paid p where p.who = u.who and p.product_id = u.product_id and p.order_date >= u.order_date - interval '2 hours')
                group by u.product_id having count(distinct u.who) >= ?", [$tid, $h, $tid, $h, max(1, (int) $rules['proof_cart_min'])]);
            foreach ($rows as $r) {
                if (isset($byDb[(int) $r->product_id])) {
                    $put($byDb[(int) $r->product_id], 'ct', (int) $r->n);
                }
            }
        }
        if (! empty($rules['proof_fav'])) {
            // Favoriye ekleyen FARKLI müşteri sayısı (tüm zamanlar)
            $favs = DB::table('product_favorites')->where('tenant_id', $tid)->whereNotNull('platform_product_id')
                ->groupBy('platform_product_id')->selectRaw('platform_product_id pid, count(distinct coalesce(platform_customer_id, customer_id::text)) n')
                ->havingRaw('count(distinct coalesce(platform_customer_id, customer_id::text)) >= ?', [(int) $rules['proof_fav_min']])->get();
            foreach ($favs as $f) {
                $put((string) $f->pid, 'fv', (int) $f->n);
            }
        }
        if (! empty($rules['proof_atc'])) {
            foreach ($this->ga4($tid, 7) as $pid => $x) {
                if ($x[1] >= (int) $rules['proof_atc_min']) {
                    $put((string) $pid, 'a7', $x[1]);
                }
            }
        }
        if ($rules['proof_views']) {
            foreach ($this->views($tid, 7) as $pid => $v) {
                if ($v >= (int) $rules['proof_views_min']) {
                    $put((string) $pid, 'v7', $v);
                }
            }
        }
        if ($rules['proof_sizes']) {
            // Bedeni azalan (1..N adet) ama kartın diğer bedenleri stoklu olan ürünler
            $max = max(1, (int) $rules['proof_sizes_max_stock']);
            $rows = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('p.tenant_id', $tid)->where('p.is_active', true)->where('v.is_active', true)
                ->whereRaw("coalesce(v.attributes->>'Beden', v.attributes->>'beden', '') <> ''")
                ->groupBy('p.platform_product_id')
                ->selectRaw("p.platform_product_id pid,
                    array_to_json(array_agg(coalesce(v.attributes->>'Beden', v.attributes->>'beden') order by coalesce(v.attributes->>'Beden', v.attributes->>'beden')) filter (where v.stock_quantity between 1 and ?)) low,
                    count(*) filter (where v.stock_quantity > ?) ok", [$max, $max])
                ->havingRaw('count(*) filter (where v.stock_quantity between 1 and ?) between 1 and 3', [$max])
                ->havingRaw('count(*) filter (where v.stock_quantity > ?) >= 2', [$max])
                ->get();
            foreach ($rows as $r) {
                $sizes = json_decode((string) $r->low, true) ?: [];
                usort($sizes, fn ($a, $b) => is_numeric($a) && is_numeric($b) ? $a <=> $b : strcmp($a, $b));
                if ($sizes) {
                    $put((string) $r->pid, 'sz', array_values($sizes));
                }
            }
        }
    }

    /** Panel önizlemesi: tip başına örnek ürünler (ad, görsel, değer). */
    public function samples(int $tid, array $map, int $per = 8): array
    {
        $want = [];
        foreach ($map['b'] ?? [] as $pid => $list) {
            foreach ($list as $entry) {
                [$typeId, $val] = array_pad(explode(':', $entry, 2), 2, null);
                if (count($want[$typeId] ?? []) < $per * 10) {
                    $want[$typeId][$pid] = $val;
                }
            }
        }
        $pids = [];
        foreach ($want as $list) {
            $pids = array_merge($pids, array_keys($list));
        }
        $rows = DB::table('products')->where('tenant_id', $tid)->whereIn('platform_product_id', array_map('strval', array_unique($pids)))
            ->get(['platform_product_id', 'name', 'images', 'url', 'stock_quantity'])->keyBy('platform_product_id');
        $out = [];
        foreach ($want as $typeId => $list) {
            // Önce katalogda bilinen (ad+görsel) kartlar; yeni açılıp henüz senkronlanmamışlar sona
            uksort($list, fn ($a, $c) => (isset($rows[(string) $a]) ? 0 : 1) <=> (isset($rows[(string) $c]) ? 0 : 1));
            $list = array_slice($list, 0, $per, true);
            foreach ($list as $pid => $val) {
                $r = $rows[(string) $pid] ?? null;
                $imgs = $r ? json_decode((string) $r->images, true) : null;
                $img = is_array($imgs) ? ($imgs[0]['url'] ?? $imgs[0] ?? null) : null;
                $out[$typeId][] = [
                    'pid' => (string) $pid,
                    'name' => $r->name ?? ('#'.$pid),
                    'image' => is_string($img) ? $img : null,
                    'url' => $r->url ?? null,
                    'value' => $val,
                    'badges' => $map['b'][$pid] ?? [],
                ];
            }
        }

        return $out;
    }
}
