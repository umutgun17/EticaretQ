<?php

namespace App\Services\Ranking;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Kategori Sıralaması — bir kategorinin ürün havuzunu çok-sinyalli skorla sıralar.
 * Tüm sinyaller havuz İÇİNDE normalize edilir (percentile/log) → her kategori kendi
 * içinde yarışır. Çarpanlar: beden-kırığı kapsaması, stok-0 cezası. Keşif slotu:
 * her N sırada 1 yeni ürün (sistem yeniyi gömmesin) — aralık/yaş penceresi tenant
 * ayarından (settings['category_ranking_discovery']) gelir. Ticimax'a YAZMAZ —
 * yazma kararı/işi komut katmanında.
 */
class CategoryRanker
{
    protected array $signals = [];
    protected int $tenantId = 0;
    protected ?array $weights = null;
    protected ?array $discovery = null;
    protected ?array $season = null;

    /** Son rank() çağrısındaki manuel sabitlemelerin çözüm raporu (panel/komut için). */
    public array $lastPins = [];

    /**
     * Tenant'ın etkin ağırlıkları. Öncelik: aktif A/B testinin o anki varyantı →
     * settings['category_ranking_weights'] override'ı → config varsayılanları.
     * Gecelik cron da burayı kullandığı için varyant geçişi ekstra iş istemez
     * (geçiş, dönem sınırından sonraki ilk gece yazımıyla vitrine yansır).
     */
    public static function effectiveWeights(Tenant $tenant): array
    {
        $s = $tenant->settings ?? [];
        $ab = $s['category_ranking_ab'] ?? null;
        if (is_array($ab) && ($ab['enabled'] ?? false)) {
            $v = static::abActiveVariant($ab);

            return static::normalizeWeights($ab[$v === 'A' ? 'variant_a' : 'variant_b'] ?? null);
        }

        return static::normalizeWeights($s['category_ranking_weights'] ?? null);
    }

    /** Aktif varyant: started_at'ten bu yana geçen tam dönem sayısı çift=A, tek=B. */
    public static function abActiveVariant(array $ab): string
    {
        $start = \Illuminate\Support\Carbon::parse($ab['started_at'] ?? now());
        $period = max(1, (int) ($ab['period_days'] ?? 7));
        $n = (int) floor(max(0, $start->diffInDays(now(), false)) / $period);

        return $n % 2 === 0 ? 'A' : 'B';
    }

    /** A/B durumu (panel için): aktif varyant + sonraki geçiş zamanı. */
    public static function abStatus(Tenant $tenant): ?array
    {
        $ab = ($tenant->settings ?? [])['category_ranking_ab'] ?? null;
        if (! is_array($ab) || ! ($ab['enabled'] ?? false)) {
            return null;
        }
        $start = \Illuminate\Support\Carbon::parse($ab['started_at']);
        $period = max(1, (int) ($ab['period_days'] ?? 7));
        $elapsed = (int) floor(max(0, $start->diffInDays(now(), false)) / $period);

        return [
            'enabled' => true,
            'started_at' => $ab['started_at'],
            'period_days' => $period,
            'variant_a' => static::normalizeWeights($ab['variant_a'] ?? null),
            'variant_b' => static::normalizeWeights($ab['variant_b'] ?? null),
            'active_variant' => $elapsed % 2 === 0 ? 'A' : 'B',
            'next_switch_at' => $start->copy()->addDays(($elapsed + 1) * $period)->toIso8601String(),
        ];
    }

    /**
     * Bilinmeyen anahtar yok sayılır, eksik anahtar varsayılandan gelir, toplam 1.0'a
     * normalize. Girdi yüzde (0-100) ya da oran (0-1) olabilir — eksik anahtarların
     * varsayılanları girdiyle AYNI ölçeğe çevrilir (ölçek karışması satışı %98 yapar).
     */
    public static function normalizeWeights(?array $override): array
    {
        $defaults = config('category_ranking.weights');
        if (! is_array($override)) {
            return $defaults;
        }
        $given = [];
        foreach ($defaults as $k => $d) {
            if (isset($override[$k]) && is_numeric($override[$k])) {
                $given[$k] = max(0.0, (float) $override[$k]);
            }
        }
        if (! $given || array_sum($given) <= 0) {
            return $defaults;
        }
        $scale = max($given) > 1 ? 100.0 : 1.0; // yüzde mi oran mı?

        $w = [];
        $sum = 0.0;
        foreach ($defaults as $k => $d) {
            $v = $given[$k] ?? (float) $d * $scale;
            $w[$k] = $v;
            $sum += $v;
        }
        foreach ($w as $k => $v) {
            $w[$k] = round($v / $sum, 4);
        }

        return $w;
    }

    /**
     * Keşif slotu ayarları. Öncelik: settings['category_ranking_discovery'] →
     * config varsayılanları. Panelden yönetilir; gecelik cron da burayı okur.
     */
    public static function effectiveDiscovery(Tenant $tenant): array
    {
        return static::normalizeDiscovery(($tenant->settings ?? [])['category_ranking_discovery'] ?? null);
    }

    /** Sınırlar sunucuda uygulanır: aralık 2-50, yaş 1-1000 gün. */
    public static function normalizeDiscovery(?array $override): array
    {
        $cfg = config('category_ranking');
        $d = [
            'mode' => in_array($cfg['discovery_mode'] ?? 'bonus', ['bonus', 'slot'], true) ? $cfg['discovery_mode'] : 'bonus',
            'interval' => (int) $cfg['discovery_slot_interval'],
            'max_age_days' => (int) $cfg['discovery_new_max_age_days'],
            'require_no_sales' => (bool) ($cfg['discovery_require_no_sales'] ?? false),
            'bonus_max' => (float) ($cfg['discovery_novelty_bonus_max'] ?? 0.08),
            'guarantee_within' => (int) ($cfg['discovery_guarantee_within'] ?? 12),
            'guarantee_position' => (int) ($cfg['discovery_guarantee_position'] ?? 8),
        ];
        if (! is_array($override)) {
            return $d;
        }
        if (isset($override['mode']) && in_array($override['mode'], ['bonus', 'slot'], true)) {
            $d['mode'] = $override['mode'];
        }
        if (isset($override['bonus_max']) && is_numeric($override['bonus_max'])) {
            $d['bonus_max'] = max(0.0, min(0.30, round((float) $override['bonus_max'], 3)));
        }
        if (isset($override['guarantee_within']) && is_numeric($override['guarantee_within'])) {
            $d['guarantee_within'] = max(0, min(50, (int) $override['guarantee_within']));
        }
        if (isset($override['guarantee_position']) && is_numeric($override['guarantee_position'])) {
            $d['guarantee_position'] = max(1, min(50, (int) $override['guarantee_position']));
        }
        $d['guarantee_position'] = min($d['guarantee_position'], max(1, $d['guarantee_within']));
        if (isset($override['interval']) && is_numeric($override['interval'])) {
            $d['interval'] = max(2, min(50, (int) $override['interval']));
        }
        if (isset($override['max_age_days']) && is_numeric($override['max_age_days'])) {
            $d['max_age_days'] = max(1, min(1000, (int) $override['max_age_days']));
        }
        if (array_key_exists('require_no_sales', $override)) {
            $d['require_no_sales'] = filter_var($override['require_no_sales'], FILTER_VALIDATE_BOOL);
        }

        return $d;
    }

    /**
     * Manuel ilk sıralar (2026-10-02, firma isteği): kategori başına stok kodu listesi —
     * settings['category_ranking_pins'][kategori id] = ['TBA9060', ...]. Liste sırası = vitrin sırası.
     */
    public static function effectivePins(Tenant $tenant, int $categoryId): array
    {
        $all = ($tenant->settings ?? [])['category_ranking_pins'] ?? [];

        return static::normalizePins(is_array($all) ? ($all[(string) $categoryId] ?? $all[$categoryId] ?? []) : []);
    }

    /** Stok kodu listesini temizler: trim + büyük harf, boş/tekrar atılır, en fazla 60 kod. */
    public static function normalizePins($codes): array
    {
        if (is_string($codes)) {
            $codes = preg_split('/[\s,;]+/u', $codes) ?: [];
        }
        $out = [];
        foreach ((array) $codes as $c) {
            $c = mb_strtoupper(trim((string) $c));
            if ($c !== '' && mb_strlen($c) <= 60 && ! in_array($c, $out, true)) {
                $out[] = $c;
            }
        }

        return array_slice($out, 0, 60);
    }

    /** Sezon ayarı: settings['category_ranking_season'] → config varsayılanları; 'active' bugünün sezonu. */
    public static function effectiveSeason(Tenant $tenant, ?\DateTimeInterface $at = null): array
    {
        return static::normalizeSeason(($tenant->settings ?? [])['category_ranking_season'] ?? null, $at);
    }

    public static function normalizeSeason(?array $override, ?\DateTimeInterface $at = null): array
    {
        $cfg = config('category_ranking.season') ?? [];
        $d = [
            'enabled' => (bool) ($cfg['enabled'] ?? false),
            'mode' => ($cfg['mode'] ?? 'tier') === 'soft' ? 'soft' : 'tier',
            'soft_multiplier' => (float) ($cfg['soft_multiplier'] ?? 0.35),
            'winter' => $cfg['winter'] ?? ['10-01', '03-15'],
            'summer' => $cfg['summer'] ?? ['04-15', '08-31'],
            'exclude_category_ids' => array_map('intval', $cfg['exclude_category_ids'] ?? []),
            'mix' => array_merge(['interval' => 3, 'within' => 48, 'min_tier' => 4, 'min_sales' => 5], $cfg['mix'] ?? []),
        ];
        $mmdd = fn ($v) => is_string($v) && preg_match('/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/', $v);
        if (is_array($override)) {
            if (array_key_exists('enabled', $override)) {
                $d['enabled'] = filter_var($override['enabled'], FILTER_VALIDATE_BOOL);
            }
            if (in_array($override['mode'] ?? null, ['tier', 'soft'], true)) {
                $d['mode'] = $override['mode'];
            }
            if (isset($override['soft_multiplier']) && is_numeric($override['soft_multiplier'])) {
                $d['soft_multiplier'] = max(0.05, min(1.0, (float) $override['soft_multiplier']));
            }
            if (isset($override['mix']) && is_array($override['mix'])) {
                foreach (['interval' => [0, 20], 'within' => [0, 200], 'min_tier' => [1, 5], 'min_sales' => [0, 1000]] as $k => [$lo, $hi]) {
                    if (isset($override['mix'][$k]) && is_numeric($override['mix'][$k])) {
                        $d['mix'][$k] = max($lo, min($hi, (int) $override['mix'][$k]));
                    }
                }
            }
            if (isset($override['exclude_category_ids']) && is_array($override['exclude_category_ids'])) {
                $d['exclude_category_ids'] = array_values(array_unique(array_map('intval', $override['exclude_category_ids'])));
            }
            foreach (['winter', 'summer'] as $k) {
                $v = $override[$k] ?? null;
                if (is_array($v) && count($v) === 2 && $mmdd($v[0] ?? null) && $mmdd($v[1] ?? null)) {
                    $d[$k] = [$v[0], $v[1]];
                }
            }
        }
        $today = ($at ?? now())->format('m-d');
        $within = fn (array $w) => $w[0] <= $w[1]
            ? ($today >= $w[0] && $today <= $w[1])
            : ($today >= $w[0] || $today <= $w[1]); // yıl dönümünü aşan pencere (kış)
        $d['active'] = $within($d['winter']) ? 'winter' : ($within($d['summer']) ? 'summer' : null);

        return $d;
    }

    /** Ürün adı (öncelikli) + yaprak kategori adlarından sezon: 'winter' | 'summer' | null. */
    protected function classifySeason(string $name, string $leaves): ?string
    {
        $cfg = config('category_ranking.season') ?? [];
        $match = function (string $text, array $kw): ?string {
            if ($text === '') {
                return null;
            }
            $w = ! empty($kw['winter']) && preg_match('/'.$kw['winter'].'/u', $text);
            $s = ! empty($kw['summer']) && preg_match('/'.$kw['summer'].'/u', $text);

            return $w === $s ? null : ($w ? 'winter' : 'summer'); // ikisi birden = dört mevsim
        };

        // Sıra: addaki sezon kelimesi (kürklü/keten) → addaki ürün tipi (Sandalet/Bot) → yaprak kategoriler.
        // Ad önce gelir: yanlış atamalar (sandalet ürünü Bot kategorisinde de) sezonu bozmasın.
        $lname = mb_strtolower($name);

        return $match($lname, $cfg['name_keywords'] ?? [])
            ?? $match($lname, $cfg['leaf_keywords'] ?? [])
            ?? $match($leaves, $cfg['leaf_keywords'] ?? []);
    }

    /** Önizleme simülasyonu için geçici sezon ayarı (null = tenant ayarına dön). */
    public function setSeason(?array $season): void
    {
        $this->season = $season === null ? null : static::normalizeSeason($season);
    }

    /** Önizleme simülasyonu için geçici ağırlık (null = tenant ayarına dön). */
    public function setWeights(?array $weights): void
    {
        $this->weights = $weights === null ? null : static::normalizeWeights($weights);
    }

    /** Önizleme simülasyonu için geçici keşif ayarı (null = tenant ayarına dön). */
    public function setDiscovery(?array $discovery): void
    {
        $this->discovery = $discovery === null ? null : static::normalizeDiscovery($discovery);
    }

    /** Tenant başına bir kez: tüm sinyalleri toplu SQL ile çek (ürün başına sorgu YOK). */
    public function buildSignals(Tenant $tenant): void
    {
        $tid = $tenant->id;
        $this->tenantId = $tid;
        $this->weights = $this->weights ?? static::effectiveWeights($tenant);
        $this->discovery = $this->discovery ?? static::effectiveDiscovery($tenant);
        $cfg = config('category_ranking');

        $sales = DB::select("
            select oi.product_id,
                   sum(oi.quantity) as q90,
                   sum(oi.quantity) filter (where o.order_date > now() - make_interval(days => ?)) as q14
            from order_items oi
            join orders o on o.id = oi.order_id
            where oi.tenant_id = ? and oi.product_id is not null
              and o.order_date > now() - make_interval(days => ?)
              and (o.status > 0 or o.payment_status = 1 or o.paid_amount > 0)
              and o.status <> 8 -- İptal (arama-atıf modülüyle aynı eşleme) satış DEĞİLDİR
            group by oi.product_id
        ", [$cfg['trend_window_days'], $tid, $cfg['sales_window_days']]);

        $ga4 = DB::select('
            select product_id, views, add_to_carts, purchases
            from product_ga4_cache where tenant_id = ?
        ', [$tid]);

        $favs = DB::select('
            select product_id, count(*) as c
            from product_favorites
            where tenant_id = ? and favorited_at > now() - make_interval(days => ?)
            group by product_id
        ', [$tid, $cfg['favorites_window_days']]);

        $reviews = DB::select('
            select product_id, avg_rate, rate_count
            from product_review_summaries where tenant_id = ?
        ', [$tid]);

        // Ürün başına stoklu sayısal bedenler + toplam stok
        $sizes = DB::select("
            select product_id,
                   sum(stock_quantity) as total_stock,
                   array_agg(distinct (attributes->>'Beden')::int)
                       filter (where stock_quantity > 0 and attributes->>'Beden' ~ '^[0-9]+$') as stocked_sizes,
                   (select jsonb_object_agg(sz, q) from (
                        select (v2.attributes->>'Beden')::int sz, sum(v2.stock_quantity) q
                        from product_variants v2
                        where v2.product_id = product_variants.product_id and v2.stock_quantity > 0
                          and v2.attributes->>'Beden' ~ '^[0-9]+$'
                        group by 1) x) as size_stock
            from product_variants
            where tenant_id = ?
            group by product_id
        ", [$tid]);

        $products = DB::select('
            select id, name, sku, platform_product_id, platform_created_at, stock_quantity, is_active
            from products where tenant_id = ?
        ', [$tid]);

        $s = [];
        foreach ($products as $p) {
            // sku = "NEBIMV3|MODEL|RENK[|...]" → model = stok kodu (renkler aynı modeli paylaşır)
            $skuParts = explode('|', (string) $p->sku);
            $s[(int) $p->id] = [
                'name' => $p->name,
                'model' => mb_strtoupper(trim($skuParts[1] ?? '')),
                'color' => mb_strtoupper(trim($skuParts[2] ?? '')),
                'ppid' => (int) $p->platform_product_id,
                'created' => $p->platform_created_at,
                'card_stock' => (float) $p->stock_quantity,
                'active' => (bool) $p->is_active,
                'q90' => 0.0, 'q14' => 0.0, 'views' => 0.0, 'atc' => 0.0, 'purch' => 0.0,
                'favs' => 0.0, 'avg_rate' => null, 'rate_count' => 0,
                'stock' => null, 'sizes' => [], 'size_stock' => [],
            ];
        }
        foreach ($sales as $r) {
            if (isset($s[(int) $r->product_id])) {
                $s[(int) $r->product_id]['q90'] = (float) $r->q90;
                $s[(int) $r->product_id]['q14'] = (float) ($r->q14 ?? 0);
            }
        }
        foreach ($ga4 as $r) {
            if (isset($s[(int) $r->product_id])) {
                $s[(int) $r->product_id]['views'] = (float) $r->views;
                $s[(int) $r->product_id]['atc'] = (float) $r->add_to_carts;
                $s[(int) $r->product_id]['purch'] = (float) $r->purchases;
            }
        }
        foreach ($favs as $r) {
            if (isset($s[(int) $r->product_id])) {
                $s[(int) $r->product_id]['favs'] = (float) $r->c;
            }
        }
        foreach ($reviews as $r) {
            if (isset($s[(int) $r->product_id])) {
                $s[(int) $r->product_id]['avg_rate'] = (float) $r->avg_rate;
                $s[(int) $r->product_id]['rate_count'] = (int) $r->rate_count;
            }
        }
        foreach ($sizes as $r) {
            if (isset($s[(int) $r->product_id])) {
                $s[(int) $r->product_id]['stock'] = (float) $r->total_stock;
                $s[(int) $r->product_id]['sizes'] = $this->parsePgIntArray($r->stocked_sizes);
                $ss = is_string($r->size_stock ?? null) ? json_decode($r->size_stock, true) : ($r->size_stock ?? null);
                $s[(int) $r->product_id]['size_stock'] = is_array($ss) ? array_map('floatval', $ss) : [];
            }
        }

        // Sezon sınıfı (yaprak kategori adları + ürün adı): 'winter' | 'summer' | null (dört mevsim)
        $this->season = $this->season ?? static::effectiveSeason($tenant);
        $leafRows = DB::select('
            select x.product_id, string_agg(lower(pc.name), \' | \') as leaves
            from product_platform_categories x
            join platform_categories pc on pc.tenant_id = x.tenant_id
                 and pc.platform_category_id = x.platform_category_id
                 and pc.children_count = 0 and pc.is_assignable and pc.is_active
            where x.tenant_id = ? and x.product_id is not null
            group by x.product_id
        ', [$tid]);
        $leaves = [];
        foreach ($leafRows as $r) {
            $leaves[(int) $r->product_id] = (string) $r->leaves;
        }
        foreach ($s as $pid => &$row) {
            $row['season'] = $this->classifySeason((string) $row['name'], $leaves[$pid] ?? '');
        }
        unset($row);

        // Bayesian ortalama için tenant geneli yorum ortalaması
        $rates = array_filter(array_map(fn ($x) => $x['avg_rate'], $s), fn ($v) => $v !== null);
        $this->signals = [
            'products' => $s,
            'global_avg_rate' => $rates ? array_sum($rates) / count($rates) : 4.0,
        ];
    }

    /**
     * Kategori havuzunu sıralar.
     *
     * @param  array<int>  $productIds  havuz (products.id) — aktif ürünler
     * @return array<int, array{product_id:int, ppid:int, name:string, score:float, signals:array, discovery:bool}>
     */
    /**
     * Kategori kökünden (path'in ilk parçası) çekirdek beden aralığı: [min,max] | null.
     * "Erkek > Erkek Ayakkabı > ..." → erkek → [40,46]; "Çocuk > Kız Çocuk > ..." → çocuk → [19,35].
     * Alt dalda 'bebek' geçiyorsa bebek aralığı öncelikli.
     */
    public static function sizeRangeForPath(?string $path): ?array
    {
        if (! $path) {
            return null;
        }
        $ranges = config('category_ranking.size_ranges') ?? [];
        $lower = mb_strtolower($path);
        $root = trim(mb_strtolower(explode('>', $path)[0]));
        if (isset($ranges['bebek']) && str_contains($lower, 'bebek')) {
            return $ranges['bebek'];
        }
        foreach ($ranges as $key => $range) {
            if ($key !== 'bebek' && str_starts_with($root, $key)) {
                return $range;
            }
        }

        return null;
    }

    /**
     * @param  string|null  $categoryPath  kategori path'i — çekirdek beden aralığı buradan (cinsiyet/yaş) türetilir
     * @param  array<string>  $pins  manuel ilk sıralar: stok kodları (sırayla). Her kodun stoklu renkleri
     *                               içinden en çok satanı o sıraya sabitlenir; kalan havuz aynı algoritmayla devam eder.
     */
    public function rank(array $productIds, ?string $categoryPath = null, array $pins = [], ?int $categoryId = null): array
    {
        $this->lastPins = [];
        $cfg = config('category_ranking');
        $range = static::sizeRangeForPath($categoryPath);
        $inRange = fn (int $sz) => $range === null || ($sz >= $range[0] && $sz <= $range[1]);
        $w = $this->weights ?? $cfg['weights'];
        $disc = $this->discovery ?? static::normalizeDiscovery(null);
        $all = $this->signals['products'];
        $season = $this->season ?? static::normalizeSeason(null);
        // Hariç kategoriler (2026-10-04 kullanıcı: "Kadın Sandalet ve Terlik" [468] sezon kuralı dışında)
        $seasonExcluded = $categoryId !== null && in_array($categoryId, $season['exclude_category_ids'], true);
        $activeSeason = $season['enabled'] && ! $seasonExcluded ? $season['active'] : null;
        $globalAvg = $this->signals['global_avg_rate'];

        $pool = [];
        foreach ($productIds as $pid) {
            if (isset($all[$pid]) && $all[$pid]['active']) {
                $pool[$pid] = $all[$pid];
            }
        }
        if (count($pool) < 2) {
            return [];
        }

        // Havuz-içi normalizasyon referansları
        $maxQ90 = max(1e-9, max(array_column($pool, 'q90')));
        $maxEng = max(1e-9, max(array_map(fn ($p) => $p['views'] + 3 * $p['atc'], $pool)));
        $maxFav = max(1e-9, max(array_column($pool, 'favs')));
        // Çekirdek stok: aralık varsa yalnız aralıktaki bedenlerin stoğu (unisex ürünün kadın
        // bedenleri erkek kategorisinde derinlik sayılmaz); beden verisi yoksa kart stoğu.
        $coreStockOf = function (array $p) use ($range, $cfg, $inRange): float {
            $total = (float) ($p['stock'] ?? $p['card_stock']);
            if ($range === null || ! ($cfg['core_stock_depth'] ?? true) || $p['sizes'] === []) {
                return $total;
            }
            $sum = 0.0;
            foreach ($p['size_stock'] as $sz => $q) {
                if ($inRange((int) $sz)) {
                    $sum += (float) $q;
                }
            }

            return $sum;
        };
        $maxStock = max(1e-9, max(array_map($coreStockOf, $pool)));

        // Kategorinin yaygın bedenleri: havuzun ≥%25'inde stoklu olan bedenler — aralık varsa
        // yalnız aralık içinden; aralıkta yaygın beden çıkmazsa aralıkta görülen tüm bedenler.
        $sizeFreq = [];
        $sized = 0;
        foreach ($pool as $p) {
            if ($p['sizes']) {
                $sized++;
                foreach (array_unique($p['sizes']) as $sz) {
                    if ($inRange((int) $sz)) {
                        $sizeFreq[$sz] = ($sizeFreq[$sz] ?? 0) + 1;
                    }
                }
            }
        }
        $expectedSizes = [];
        if ($sized >= 4) {
            foreach ($sizeFreq as $sz => $c) {
                if ($c / $sized >= $cfg['size_coverage_min_share']) {
                    $expectedSizes[] = $sz;
                }
            }
            if ($range !== null && ! $expectedSizes && $sizeFreq) {
                $expectedSizes = array_keys($sizeFreq);
            }
        }
        sort($expectedSizes);

        $now = now();
        $scored = [];
        foreach ($pool as $pid => $p) {
            $stockQty = $p['stock'] ?? $p['card_stock'];
            $coreStock = $coreStockOf($p);

            $sales = log(1 + $p['q90']) / log(1 + $maxQ90);
            $engagement = ($p['views'] + 3 * $p['atc']) / $maxEng;
            // İvme: sabit tempo=0.5, tempoyu ≥2× katlayan=1.0 (eski hali sabit tempoda
            // doyuyordu — hızlanan ile sabit ayırt edilemiyordu, 2026-07-06 düzeltmesi)
            $pace = $p['q90'] > 0 ? ($p['q14'] * ($cfg['sales_window_days'] / $cfg['trend_window_days'])) / $p['q90'] : 0.0;
            $trend = min(1.0, $pace / 2);
            $favorites = log(1 + $p['favs']) / log(1 + $maxFav);
            $bayes = (($cfg['review_bayes_c'] * $globalAvg) + (($p['avg_rate'] ?? 0) * $p['rate_count']))
                / ($cfg['review_bayes_c'] + $p['rate_count']);
            $reviews = max(0.0, min(1.0, $bayes / 5.0));
            $conversion = $p['views'] > 20 ? min(1.0, ($p['purch'] / $p['views']) * 20) : 0.0; // ~%5 dönüşüm → 1.0
            $ageDays = $p['created'] ? $now->diffInDays($p['created'], true) : 365;
            $freshness = exp(-$ageDays / $cfg['freshness_tau_days']);
            $stockDepth = log(1 + max(0, $coreStock)) / log(1 + $maxStock);

            $score = $w['sales'] * $sales
                + $w['engagement'] * $engagement
                + $w['trend'] * $trend
                + $w['favorites'] * $favorites
                + $w['reviews'] * $reviews
                + $w['conversion'] * $conversion
                + $w['freshness'] * $freshness
                + $w['stock'] * $stockDepth;

            // Beden-kırığı çarpanı
            $coverage = 1.0;
            if ($expectedSizes && $p['sizes'] !== []) {
                $coverage = count(array_intersect($expectedSizes, $p['sizes'])) / count($expectedSizes);
                $score *= $cfg['size_coverage_floor'] + (1 - $cfg['size_coverage_floor']) * $coverage;
            } elseif ($expectedSizes && $stockQty > 0) {
                // beden verisi yok ama kategori bedenli → nötr davran
                $coverage = 1.0;
            }

            if ($stockQty <= 0) {
                $score *= $cfg['out_of_stock_multiplier'];
            }

            // KATMAN (2026-09-27, kullanıcı kararı: "ilk sıralar en değerli yerimiz, bedeni olan
            // ürünler olmalı"): skor yalnız katman İÇİNDE yarışır. 3 = çekirdek bedenlerin en az
            // yarısı stokta; 2 = stoklu ama çekirdek kapsaması zayıf; 1 = stoklu ama kendi
            // cinsiyet aralığında hiç beden yok (unisex ürünün yalnız kadın bedeni Erkek'te);
            // 0 = stoksuz. Kapama = coverage_tiering:false.
            // 4 = TAM BEDEN: çekirdek bedenlerden en fazla coverage_full_max_missing (1) eksik
            // (2026-09-27 kullanıcı: "ilk sıralarda 40-44 tam, en fazla 1 eksik; kırık stoklu görünmesin").
            $tier = 3;
            $missing = $expectedSizes && $p['sizes'] !== [] ? count(array_diff($expectedSizes, $p['sizes'])) : null;
            if (! empty($cfg['coverage_tiering'] ?? true)) {
                if ($stockQty <= 0) {
                    $tier = 0;
                } elseif ($range !== null && $p['sizes'] !== [] && $coreStock <= 0) {
                    $tier = 1;
                } elseif ($expectedSizes && $p['sizes'] !== [] && $coverage < (float) ($cfg['coverage_tier_min'] ?? 0.5)) {
                    $tier = 2;
                } elseif ($missing !== null && $missing <= (int) ($cfg['coverage_full_max_missing'] ?? 1)) {
                    $tier = $missing === 0 ? 5 : 4; // 2026-10-01: tam beden (5) 1-eksikli (4) ÖNÜNDE — firma "ön sıralarda 37/38 yok" geri bildirimi
                }
            }

            // SEZON (2026-10-04): aktif sezonun tersi olan ürün. 'tier' modunda sezona uygun tüm stoklu
            // ürünlerin arkasına iner (band), 'soft' modunda skoru kırpılır. Geçiş döneminde etkisiz.
            $offSeason = $activeSeason !== null && ($p['season'] ?? null) !== null && $p['season'] !== $activeSeason;
            if ($offSeason && $season['mode'] === 'soft') {
                $score *= $season['soft_multiplier'];
            }
            $band = $tier <= 0 ? 0 : (($offSeason && $season['mode'] === 'tier') ? $tier : $tier + 10);

            // Yeni = yaş penceresi içinde VE stoklu. Satış şartı yalnız require_no_sales
            // açıkken uygulanır (varsayılan kapalı — satan yeni ürün de slotta kalır).
            $isNew = $ageDays <= $disc['max_age_days'] && $stockQty > 0
                && $coverage >= (float) ($cfg['discovery_min_coverage'] ?? 0)
                && (empty($cfg['discovery_require_full_tier']) || $missing === null || $tier >= 4)
                && ! $offSeason // sezon dışı yeni ürün keşif/bonusla öne çekilmez
                && (! $disc['require_no_sales'] || $p['q90'] == 0);

            // YENİLİK BONUSU (2026-09-27, kullanıcı kararı "her 4'te 1 kaba, daha güzel bir şey"):
            // slot yerine yeni ürün skoruna yaşıyla doğrusal azalan bonus (ilk gün bonus_max,
            // max_age_days'te 0). YALNIZ tier 3'e (kendi cinsiyet aralığında çekirdek bedenlerin
            // ≥%50'si stokta) işler ve katmanı aşamaz — bedeni zayıf yeni ürün bonusla bedeni
            // tam satan ürünün önüne geçemez. Satış geldikçe bonusun payı doğal olarak erir.
            $noveltyBonus = 0.0;
            if (($disc['mode'] ?? 'bonus') === 'bonus' && $isNew && $tier >= 3 && $disc['max_age_days'] > 0) {
                $noveltyBonus = (float) $disc['bonus_max'] * max(0.0, 1 - $ageDays / $disc['max_age_days']);
                $score += $noveltyBonus;
            }

            $scored[] = [
                'product_id' => $pid,
                'ppid' => $p['ppid'],
                'name' => $p['name'],
                'model' => $p['model'],
                'color' => $p['color'],
                'pinned' => false,
                'score' => round($score, 6),
                'tier' => $tier,
                'band' => $band,
                'season' => $p['season'] ?? null,
                'off_season' => $offSeason,
                'is_new' => $isNew,
                'signals' => [
                    'sales' => round($sales, 3), 'engagement' => round($engagement, 3),
                    'trend' => round($trend, 3), 'favorites' => round($favorites, 3),
                    'reviews' => round($reviews, 3), 'conversion' => round($conversion, 3),
                    'freshness' => round($freshness, 3), 'stock' => round($stockDepth, 3),
                    'size_coverage' => round($coverage, 2), 'q90' => $p['q90'], 'stock_qty' => $stockQty,
                    'core_stock' => $coreStock, 'core_range' => $range, 'tier' => $tier,
                    'novelty_bonus' => round($noveltyBonus, 3), 'age_days' => (int) $ageDays, 'missing_sizes' => $missing,
                ],
            ];
        }

        usort($scored, fn ($a, $b) => ($b['band'] <=> $a['band'])
            ?: ($b['score'] <=> $a['score'])
            ?: ($a['product_id'] <=> $b['product_id']));

        // Manuel sabitlenenler havuzdan ÇIKARILIR (çiftlenmez); algoritma kalanla devam eder.
        $pinned = $pins ? $this->extractPins($scored, static::normalizePins($pins)) : [];

        $gap = (int) ($cfg['color_spread_gap'] ?? 0);
        if ($gap > 0) {
            $scored = $this->spreadColors($scored, $gap, array_column($pinned, 'model'));
        }

        $rest = ($disc['mode'] ?? 'bonus') === 'bonus'
            ? $this->applyDiscoveryGuarantee($scored, (int) $disc['guarantee_within'], (int) $disc['guarantee_position'])
            : $this->injectDiscoverySlots($scored, (int) $disc['interval']);

        if ($activeSeason !== null && (int) $season['mix']['interval'] > 0) {
            $rest = $this->applySeasonMix($rest, $activeSeason, $season['mix'], count($pinned), $pinned, $gap);
        }

        return array_merge($pinned, $rest);
    }

    /**
     * SEZON KARIŞIMI: ilk $mix['within'] sırada (sabitlenenler dahil, mutlak sıra) her k. konumda
     * sezon ürünü sayısı floor(k/interval)'dan azsa, listede daha aşağıdaki en iyi UYGUN sezon ürünü
     * (stoklu, katman ≥ min_tier, satış ≥ min_sales) bu konuma terfi eder. Renk dağıtma korunur:
     * son $gap konumda aynı modeli olan aday atlanır. Yalnız terfi — kimse aşağı itilmez, sırası kayar.
     */
    protected function applySeasonMix(array $rest, string $active, array $mix, int $offset, array $pinned, int $gap): array
    {
        $interval = (int) $mix['interval'];
        $within = (int) $mix['within'];
        $eligible = fn (array $r) => ($r['season'] ?? null) === $active && $r['tier'] >= (int) $mix['min_tier']
            && $r['signals']['stock_qty'] > 0 && $r['signals']['q90'] >= (int) $mix['min_sales'];
        $count = count(array_filter($pinned, fn ($r) => ($r['season'] ?? null) === $active));
        $models = array_column($pinned, 'model');

        for ($i = 0; $i < count($rest) && $offset + $i < $within; $i++) {
            $pos = $offset + $i + 1;
            if (($rest[$i]['season'] ?? null) !== $active && $count < intdiv($pos, $interval)) {
                $recent = $gap > 0 ? array_slice(array_merge($models, array_column(array_slice($rest, 0, $i), 'model')), -$gap) : [];
                for ($j = $i + 1; $j < count($rest); $j++) {
                    if ($eligible($rest[$j]) && ($rest[$j]['model'] === '' || ! in_array($rest[$j]['model'], $recent, true))) {
                        $row = $rest[$j];
                        $row['season_mix'] = true;
                        array_splice($rest, $j, 1);
                        array_splice($rest, $i, 0, [$row]);
                        break;
                    }
                }
            }
            if (($rest[$i]['season'] ?? null) === $active) {
                $count++;
            }
        }

        return $rest;
    }

    /**
     * RENK DAĞITMA (2026-10-02, firma: "aynı ürünün renkleri 1-2-3. sırada"): aynı modelin (stok kodu)
     * iki rengi arasında en az $gap başka ürün olur. Yalnız AYNI BANT (beden katmanı + sezon) içinde yer değiştirir —
     * beden katmanı kuralı asla delinmez; katmanda araya girecek başka model kalmadıysa renk
     * yerinde kalır. Stoksuz katman (0) dağıtılmaz. $seedModels = baştaki sabitlenmiş modeller.
     */
    protected function spreadColors(array $scored, int $gap, array $seedModels = []): array
    {
        $lastPos = [];
        $offset = count($seedModels);
        foreach ($seedModels as $i => $m) {
            if ($m !== '') {
                $lastPos[$m] = $i;
            }
        }
        $ok = function (array $r, int $pos) use (&$lastPos, $gap): bool {
            return $r['model'] === '' || ! isset($lastPos[$r['model']]) || $pos - $lastPos[$r['model']] > $gap;
        };

        $out = [];
        $pending = [];
        $n = count($scored);
        $i = 0;
        while ($i < $n || $pending) {
            $pos = $offset + count($out);
            $tier = $pending ? $pending[0]['band'] : $scored[$i]['band'];
            $pick = null;
            foreach ($pending as $k => $r) {
                if ($ok($r, $pos)) {
                    $pick = $r;
                    array_splice($pending, $k, 1);
                    break;
                }
            }
            while ($pick === null && $i < $n && $scored[$i]['band'] === $tier) {
                $r = $scored[$i++];
                if ($tier <= 0 || $ok($r, $pos)) {
                    $pick = $r;
                } else {
                    $pending[] = $r;
                }
            }
            $pick ??= array_shift($pending); // katmanda uygun model kalmadı → sıradaki renk yerinde
            $out[] = $pick;
            if ($pick['model'] !== '') {
                $lastPos[$pick['model']] = $pos;
            }
        }

        return $out;
    }

    /**
     * Stok kodu → o kodun bu kategorideki STOKLU renkleri içinden en çok satanı (satış penceresi adedi;
     * eşitlikte algoritma sırası). "KOD|RENK" yazılırsa doğrudan o renk. Seçilenler $scored'dan
     * çıkarılır ve sırayla döner; bulunamayan/stoksuz kodlar atlanır, $lastPins'e raporlanır.
     */
    protected function extractPins(array &$scored, array $codes): array
    {
        $pinned = [];
        foreach ($codes as $code) {
            [$model, $color] = array_pad(explode('|', $code, 2), 2, null);
            $best = null;
            $found = 0;
            foreach ($scored as $i => $r) {
                if ($r['model'] !== $model || ($color !== null && $r['color'] !== $color)) {
                    continue;
                }
                $found++;
                if ($r['signals']['stock_qty'] <= 0) {
                    continue;
                }
                // $scored algoritma sırasında → eşit satışta ilk gelen (daha iyi katman/skor) kalır
                if ($best === null || $r['signals']['q90'] > $scored[$best]['signals']['q90']) {
                    $best = $i;
                }
            }
            if ($best === null) {
                $this->lastPins[] = ['code' => $code, 'status' => $found ? 'out_of_stock' : 'not_found', 'colors' => $found];

                continue;
            }
            $row = $scored[$best];
            $row['pinned'] = true;
            $row['discovery'] = false;
            unset($scored[$best]);
            $pinned[] = $row;
            $this->lastPins[] = [
                'code' => $code, 'status' => 'ok', 'colors' => $found, 'position' => count($pinned),
                'product_id' => $row['product_id'], 'name' => $row['name'],
                'q90' => $row['signals']['q90'], 'stock_qty' => $row['signals']['stock_qty'],
                'missing_sizes' => $row['signals']['missing_sizes'],
            ];
        }
        $scored = array_values($scored);

        return $pinned;
    }

    /**
     * Bonus modunda tek garanti: ilk $within sırada hiç (tier 3) yeni ürün yoksa en iyi
     * skorlu tier-3 yeni ürün $position'a terfi eder (yalnız terfi; tier 3 dışı ürün
     * ASLA çekilmez — bedeni zayıf yeni ürün ilk sayfaya bonusla/garantiyle giremez).
     */
    protected function applyDiscoveryGuarantee(array $scored, int $within, int $position): array
    {
        foreach ($scored as &$r) {
            $r['discovery'] = false;
        }
        unset($r);
        if ($within < 1 || count($scored) < $within) {
            return $scored;
        }
        foreach (array_slice($scored, 0, $within) as $r) {
            if ($r['is_new'] && $r['tier'] >= 3) {
                return $scored; // doğal yolla zaten ilk sayfada
            }
        }
        foreach ($scored as $i => $r) {
            if ($r['is_new'] && $r['tier'] >= 3) {
                $r['discovery'] = true;
                array_splice($scored, $i, 1);
                array_splice($scored, max(0, min($position, $within) - 1), 0, [$r]);
                break;
            }
        }

        return $scored;
    }

    /**
     * Her N. sıraya (8, 16, ...) henüz yerleşmemiş en iyi YENİ ürünü çeker.
     * Yalnız TERFİ eder: doğal skoru zaten yüksek olan yeni ürün kendi sırasında
     * yerleşir, slot onu aşağı İTMEZ.
     */
    protected function injectDiscoverySlots(array $scored, int $interval): array
    {
        if ($interval < 2 || ! array_filter($scored, fn ($r) => $r['is_new'])) {
            foreach ($scored as &$r) {
                $r['discovery'] = false;
            }

            return $scored;
        }

        // Aday listesi skor sırasında; işaretçiyle ilerlenir (her slot için havuzu
        // baştan taramak 5.000'lik kategoride aralık 4 ile O(n²) oluyordu).
        $newIdxs = [];
        foreach ($scored as $i => $r) {
            if ($r['is_new']) {
                $newIdxs[] = $i;
            }
        }

        $placed = [];
        $out = [];
        $pos = 0;
        $baseIdx = 0;
        $newPtr = 0;
        $total = count($scored);

        while (count($out) < $total) {
            $pos++;

            if ($pos % $interval === 0) {
                // Slot: sıradaki en iyi yerleşmemiş YENİ ürün (base'de daha aşağıdaysa terfi)
                while ($newPtr < count($newIdxs) && isset($placed[$scored[$newIdxs[$newPtr]]['product_id']])) {
                    $newPtr++;
                }
                $next = $newPtr < count($newIdxs) ? $scored[$newIdxs[$newPtr]] : null;
                if ($next) {
                    $next['discovery'] = true;
                    $out[] = $next;
                    $placed[$next['product_id']] = true;

                    continue;
                }
            }

            while ($baseIdx < $total && isset($placed[$scored[$baseIdx]['product_id']])) {
                $baseIdx++;
            }
            if ($baseIdx < $total) {
                $row = $scored[$baseIdx++];
                $row['discovery'] = false;
                $out[] = $row;
                $placed[$row['product_id']] = true;
            }
        }

        return $out;
    }

    /** Postgres int array literal "{36,37,38}" → [36,37,38]. */
    protected function parsePgIntArray($raw): array
    {
        if (is_array($raw)) {
            return array_map('intval', $raw);
        }
        if (! is_string($raw) || $raw === '' || $raw === '{}') {
            return [];
        }

        return array_map('intval', explode(',', trim($raw, '{}')));
    }
}
