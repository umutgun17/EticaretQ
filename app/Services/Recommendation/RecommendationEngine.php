<?php

namespace App\Services\Recommendation;

use App\Services\Recommendation\Sources\CandidateSource;
use App\Services\Recommendation\Sources\CategoryTopSource;
use App\Services\Recommendation\Sources\CoPurchaseSource;
use App\Services\Recommendation\Sources\EmbeddingSimilarSource;
use App\Services\Recommendation\Sources\GlobalTopSource;
use App\Services\Recommendation\Sources\RecentSalesSource;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Merkezi Ürün Öneri Motoru.
 *
 * Yüzeyden bağımsız çekirdek: bağlam (RecContext) alır, config'teki pipeline'a
 * göre aday kaynaklarını sırayla koşturur (birlikte-alım → benzerlik → kategori
 * → çok-satan), havuz dolana kadar doldurur, kart çıktısını üretir.
 *
 * Yüzeyler (sepete-ekleme, checkout, ana sayfa, e-posta, WhatsApp...) yalnız
 * bağlam kurar; motor yüzey TANIMAZ. Yeni yüzey = bağlam kur + pipeline seç
 * (config/rec.php 'pipelines'). Yeni strateji = CandidateSource implement et,
 * buradaki registry'ye ekle.
 *
 * Giriş kapıları:
 *   forAnchor()    — tek tetikleyici ürün (sepete-ekleme, ürün detay yüzeyi)
 *   forCart()      — sepet satırları (checkout)
 *   forCustomer()  — kişi-bazlı, anchor'sız (e-posta, WhatsApp, ana sayfa "sana özel")
 */
class RecommendationEngine
{
    /** @var array<string, CandidateSource> */
    protected array $sources = [];

    public function __construct()
    {
        foreach ([
            new CoPurchaseSource,
            new EmbeddingSimilarSource,
            new CategoryTopSource('category_top'),
            new CategoryTopSource('category_mix'),
            new GlobalTopSource,
            new RecentSalesSource,
        ] as $src) {
            $this->sources[$src->key()] = $src;
        }
    }

    /* ============================================================
     * Giriş kapıları
     * ============================================================ */

    /**
     * Tek tetikleyici ürün (platform id'lerle). Sepete-ekleme yüzeyi.
     *
     * @return array{items: array, size: ?string, customer_id: ?int, source_id: ?int}
     */
    public function forAnchor(
        int $tenantId,
        ?string $platformProductId,
        ?string $platformVariantId = null,
        ?string $platformMemberId = null,
        int $limit = 4,
        string $surface = 'atc'
    ): array {
        $anchor = $this->resolveAnchor($tenantId, $platformProductId, $platformVariantId, null);
        if (! $anchor) {
            return ['items' => [], 'size' => null, 'customer_id' => null, 'source_id' => null];
        }

        $ctx = new RecContext($tenantId, $surface, $limit);
        $ctx->anchors = [$anchor];
        $this->applyCustomer($ctx, $platformMemberId);
        $ctx->excludeIds = array_merge($ctx->anchorIds(), $ctx->excludeIds);
        $ctx->excludeModels = $this->modelKeysOf($tenantId, $ctx->anchorIds());

        $items = $this->applyPins($ctx, $this->run($ctx, $this->pipeline($surface, ['copurchase', 'category_top', 'global_top'])));

        return [
            'items' => array_map(fn ($p) => $this->present($p, $ctx), $items),
            'size' => $anchor['size'],
            'customer_id' => $ctx->customerId,
            'source_id' => (int) $anchor['id'],
        ];
    }

    /**
     * Sepetin tamamı (platform id / barkod satırları). Checkout yüzeyi.
     *
     * @param  array<int, array{p?: string, v?: string, q?: int, b?: string}>  $lines
     * @return array{items: array, sizes: array, customer_id: ?int, source_ids: array}
     */
    public function forCart(
        int $tenantId,
        array $lines,
        ?string $platformMemberId = null,
        int $limit = 6,
        string $surface = 'checkout'
    ): array {
        $anchors = [];
        foreach (array_slice($lines, 0, 40) as $ln) {
            $anchor = $this->resolveAnchor(
                $tenantId,
                isset($ln['p']) ? trim((string) $ln['p']) : null,
                isset($ln['v']) ? trim((string) $ln['v']) : null,
                isset($ln['b']) ? trim((string) $ln['b']) : null,
                max(1, min(50, (int) ($ln['q'] ?? 1)))
            );
            if ($anchor) {
                $anchors[] = $anchor;
            }
        }
        if (empty($anchors)) {
            return ['items' => [], 'sizes' => [], 'customer_id' => null, 'source_ids' => []];
        }

        $ctx = new RecContext($tenantId, $surface, $limit);
        $ctx->anchors = $anchors;
        $this->applyCustomer($ctx, $platformMemberId);
        $ctx->excludeIds = array_merge($ctx->anchorIds(), $ctx->excludeIds);
        $ctx->excludeModels = $this->modelKeysOf($tenantId, $ctx->anchorIds());
        $ctx->cartMix = $this->cartMixEnabled($tenantId);
        if (! $ctx->cartMix) {
            $items = $this->applyPins($ctx, $this->run($ctx, $this->pipeline($surface, ['copurchase', 'category_mix', 'global_top'])));
        } else {
            // Üye tanınıyorsa geçmiş alımları da (yarım ağırlıklı) anchor olur: birlikte-alım +
            // kategori karışımı sepetteki ürünlerin yanında müşterinin önceki siparişlerinden de beslenir.
            if ($ctx->customerId) {
                $inCart = array_flip($ctx->anchorIds());
                foreach ($this->anchorsFromPurchases($tenantId, $ctx->customerId) as $h) {
                    if (! isset($inCart[$h['id']])) {
                        $h['history'] = true;
                        $h['qty'] = 0;
                        $ctx->anchors[] = $h;
                    }
                }
            }

            // Geniş havuz → çeşitlendir: birlikte-alımı güçlü tek kategori (ör. küpe) şeridi doldurmasın,
            // sepetteki her kategori temsil edilsin, aynı seriden (Motify 0.1/0.3/0.7) tek ürün.
            $limit = $ctx->limit;
            $ctx->limit = min(24, $limit * 2);
            $pool = $this->run($ctx, $this->pipeline($surface, ['copurchase', 'category_mix', 'global_top']));
            $ctx->limit = $limit;
            $items = $this->applyPins($ctx, $this->diversify($ctx, $pool, $limit));
        }

        return [
            'items' => array_map(fn ($p) => $this->present($p, $ctx), $items),
            'sizes' => $ctx->anchorSizes(),
            'customer_id' => $ctx->customerId,
            'source_ids' => $ctx->anchorIds(),
        ];
    }

    /**
     * "Sana Özel" kulakçığı — ziyaretçinin o ana kadarki sinyalleriyle kademeli öneri (yalnız bu yüzey).
     * Sinyal sırası: sepet > gezilen ürünler > üyenin önceki siparişleri > bulunduğu kategori > genel çok satanlar.
     * Aynı seriden tek ürün, kategoriler harmanlanır (diversify); bakılan/sepetteki/alınan ürünler önerilmez.
     *
     * @param  string[]  $viewedPids  platform ürün id'leri, en yeni önce
     * @param  array<int, array{p?: string, v?: string, q?: int, b?: string}>  $cartLines
     * @return array{items: array, mode: string, category: ?string, customer_id: ?int}
     */
    public function forVisitor(
        int $tenantId,
        array $viewedPids,
        array $cartLines,
        ?string $platformMemberId,
        ?string $currentPid,
        ?string $currentCategory,
        int $limit = 4,
        bool $useHistory = true
    ): array {
        $ctx = new RecContext($tenantId, 'foryou', $limit);
        $ctx->cartMix = true;

        $cart = [];
        foreach (array_slice($cartLines, 0, 40) as $ln) {
            $a = $this->resolveAnchor($tenantId, $ln['p'] ?? null, $ln['v'] ?? null, $ln['b'] ?? null, max(1, min(50, (int) ($ln['q'] ?? 1))));
            if ($a) {
                $cart[] = $a;
            }
        }
        $current = $currentPid ? $this->resolveAnchor($tenantId, $currentPid, null, null) : null;
        $viewed = [];
        foreach (array_slice($viewedPids, 0, 12) as $pid) {
            $a = $this->resolveAnchor($tenantId, (string) $pid, null, null);
            if ($a && ! ($current && $a['id'] === $current['id'])) {
                $a['history'] = true; // yarım ağırlık (CoPurchaseSource)
                $viewed[] = $a;
            }
        }
        $this->applyCustomer($ctx, $platformMemberId);
        $hist = [];
        if ($useHistory && $ctx->customerId) {
            foreach ($this->anchorsFromPurchases($tenantId, $ctx->customerId) as $h) {
                $h['history'] = true;
                $hist[] = $h;
            }
        }

        $category = $currentCategory ?: ($current['category'] ?? null);
        $mode = $cart ? 'cart' : ($viewed ? 'viewed' : ($hist ? 'history' : ($category ? 'category' : 'bestseller')));

        // Ürün sayfasındaki ürün de sinyaldir (gezilenlere eklenmemiş olsa bile)
        $anchors = array_merge($cart, $viewed, $hist);
        if ($current && in_array($mode, ['cart', 'viewed', 'history'], true)) {
            $c = $current;
            $c['history'] = true;
            $anchors[] = $c;
        }
        $ctx->anchors = $anchors;
        $exclude = array_merge($ctx->anchorIds(), $ctx->excludeIds, $current ? [$current['id']] : []);
        $ctx->excludeIds = array_values(array_unique($exclude));
        $ctx->excludeModels = $this->modelKeysOf($tenantId, array_merge($ctx->anchorIds(), $current ? [$current['id']] : []));

        if ($anchors) {
            $ctx->limit = min(24, $limit * 3);
            $pool = $this->run($ctx, $this->pipeline('foryou', ['copurchase', 'embedding', 'category_mix', 'recent_top', 'global_top']));
            $ctx->limit = $limit;
            $items = $this->diversify($ctx, $pool, $limit);
        } else {
            // Sinyalsiz: bulunduğu kategorinin (varsa) son N gün çok satanları, kalanı katalog geneli
            $ctx->anchors = $category ? [['id' => 0, 'brand' => null, 'category' => $category, 'size' => null, 'qty' => 1]] : [];
            $ctx->limit = min(24, $limit * 2);
            $pool = $this->run($ctx, ['recent_top', 'global_top']);
            $ctx->limit = $limit;
            $ctx->anchors = [];
            // Aynı seriden (Motify 0.2 / 0.3) tek ürün
            $items = [];
            $families = [];
            foreach ($pool as $p) {
                $fam = self::seriesKey((string) $p->name);
                if ($fam !== null && isset($families[$fam])) {
                    continue;
                }
                if ($fam !== null) {
                    $families[$fam] = true;
                }
                $items[] = $p;
                if (count($items) >= $limit) {
                    break;
                }
            }
        }

        return [
            'items' => array_map(fn ($p) => $this->present($p, $ctx), $items),
            'mode' => $mode,
            'category' => $category,
            'customer_id' => $ctx->customerId,
        ];
    }

    /**
     * Kişi-bazlı öneri — anchor'sız akışlar (e-posta, WhatsApp, ana sayfa "sana özel").
     *
     * Müşterinin son alımları anchor yapılır (birlikte-alım genişlemesi), bedenleri
     * alım geçmişinden çıkarılır (37 alan kadına 37 stokta olanlar), aldıkları
     * öneriden düşülür. $customerId iç id VEYA platform member id verilebilir.
     *
     * @return array{items: array, sizes: array, customer_id: ?int, source_ids: array}
     */
    public function forCustomer(
        int $tenantId,
        int|string $customer,
        int $limit = 8,
        string $surface = 'customer'
    ): array {
        $customerId = is_int($customer)
            ? $customer
            : $this->resolveCustomerId($tenantId, (string) $customer);
        if (! $customerId) {
            return ['items' => [], 'sizes' => [], 'customer_id' => null, 'source_ids' => []];
        }

        $ctx = new RecContext($tenantId, $surface, $limit);
        $ctx->customerId = $customerId;

        [$bought, $brands, $categories] = $this->customerHistory($tenantId, $customerId);
        $ctx->excludeIds = $bought;
        $ctx->boostBrands = $brands;
        $ctx->boostCategories = $categories;
        $ctx->preferredSizes = $this->customerSizes($tenantId, $customerId);
        $ctx->anchors = $this->anchorsFromPurchases($tenantId, $customerId);

        $items = $this->run($ctx, $this->pipeline($surface, ['copurchase', 'embedding', 'category_mix', 'global_top']));

        return [
            'items' => array_map(fn ($p) => $this->present($p, $ctx), $items),
            'sizes' => $ctx->preferredSizes,
            'customer_id' => $customerId,
            'source_ids' => $ctx->anchorIds(),
        ];
    }

    /**
     * Sepet önerisi çeşitlendirme: adaylar kategoriye göre gruplanır ve sırayla birer birer
     * alınır (grup sırası = havuzdaki ilk görünüş, yani skor). Sepette olup havuzda hiç adayı
     * olmayan kategori için kategori liderleri eklenir. Aynı seri (ad sürüm eki farkı) tek ürün.
     *
     * @param  array<int, object>  $pool
     * @return array<int, object>
     */
    protected function diversify(RecContext $ctx, array $pool, int $limit): array
    {
        $have = [];
        foreach ($pool as $p) {
            $have[(string) ($p->category ?? '')] = true;
        }
        $missing = [];
        foreach ($ctx->anchors as $a) {
            $cat = (string) ($a['category'] ?? '');
            if ($cat !== '' && empty($a['history']) && ! isset($have[$cat])) {
                $missing[$cat] = true;
            }
        }
        if ($missing) {
            $sub = clone $ctx;
            $sub->anchors = array_values(array_filter($ctx->anchors, fn ($a) => isset($missing[(string) ($a['category'] ?? '')])));
            $sub->limit = min(24, max(2, count($missing) * 2));
            $sub->excludeIds = array_merge($ctx->excludeIds, array_map(fn ($p) => (int) $p->id, $pool));
            $pool = array_merge($pool, $this->run($sub, ['category_mix']));
        }

        // Birlikte-alım adayı çıkmayan sepet kategorisi (ör. saat) için kategori düzeyi yakınlık:
        // o kategoriyle en sık birlikte alınan diğer kategorilerin liderleri de havuza girer.
        $cold = [];
        foreach ($ctx->anchors as $a) {
            if (empty($a['history']) && ! empty($a['category']) && ! $this->hasCopurchase($ctx->tenantId, (int) $a['id'])) {
                $cold[(string) $a['category']] = true;
            }
        }
        if ($cold) {
            $cartCats = [];
            foreach ($ctx->anchors as $a) {
                if (empty($a['history']) && ! empty($a['category'])) {
                    $cartCats[(string) $a['category']] = true;
                }
            }
            $aff = array_values(array_diff($this->categoryAffinity($ctx->tenantId, array_keys($cold)), array_keys($cartCats)));
            if ($aff) {
                $sub = clone $ctx;
                $sub->anchors = array_map(fn ($c) => ['id' => 0, 'brand' => null, 'category' => $c, 'size' => null, 'qty' => 1], array_slice($aff, 0, 3));
                $sub->limit = 6;
                $sub->excludeIds = array_merge($ctx->excludeIds, array_map(fn ($p) => (int) $p->id, $pool));
                $pool = array_merge($pool, $this->run($sub, ['category_mix']));
            }
        }

        $groups = [];
        foreach ($pool as $p) {
            $groups[(string) ($p->category ?? '')][] = $p;
        }
        $out = [];
        $families = [];
        while (count($out) < $limit && $groups) {
            foreach (array_keys($groups) as $cat) {
                while ($groups[$cat]) {
                    $p = array_shift($groups[$cat]);
                    $fam = self::seriesKey((string) $p->name);
                    if ($fam !== null && isset($families[$fam])) {
                        continue;
                    }
                    if ($fam !== null) {
                        $families[$fam] = true;
                    }
                    $out[] = $p;
                    break;
                }
                if (! $groups[$cat]) {
                    unset($groups[$cat]);
                }
                if (count($out) >= $limit) {
                    break;
                }
            }
        }

        return $out;
    }

    protected function hasCopurchase(int $tenantId, int $productId): bool
    {
        return DB::table('rec_copurchases')->where('tenant_id', $tenantId)->where('product_id', $productId)->exists();
    }

    /**
     * Kategori yakınlığı: verilen kategorilerdeki ürünlerle birlikte en çok alınan DİĞER kategoriler
     * (rec_copurchases matrisinin kategori düzeyine toplanmışı), güçlüden zayıfa.
     *
     * @param  string[]  $categories
     * @return string[]
     */
    protected function categoryAffinity(int $tenantId, array $categories): array
    {
        sort($categories);

        return Cache::remember('rec:catAff:'.$tenantId.':'.md5(implode('|', $categories)), 3600, function () use ($tenantId, $categories) {
            $in = implode(',', array_fill(0, count($categories), '?'));
            $rows = DB::select("
                SELECT b.category, sum(rc.together_count) AS n
                FROM rec_copurchases rc
                JOIN products a ON a.id = rc.product_id
                JOIN products b ON b.id = rc.rec_product_id
                WHERE rc.tenant_id = ? AND a.category IN ({$in})
                  AND coalesce(b.category, '') <> '' AND b.category NOT IN ({$in})
                GROUP BY b.category
                HAVING sum(rc.together_count) >= 3
                ORDER BY n DESC
                LIMIT 5
            ", array_merge([$tenantId], $categories, $categories));

            return array_map(fn ($r) => (string) $r->category, $rows);
        });
    }

    /** "Motify 0.3 Steel Earring | Çelik Küpe" → "motify steel earring"; sürüm eki yoksa null. */
    public static function seriesKey(string $name): ?string
    {
        $base = trim(explode('|', $name)[0]);
        $tokens = preg_split('/\s+/u', mb_strtolower($base)) ?: [];
        $kept = array_filter($tokens, fn ($t) => ! preg_match('/^v?\d+([.,]\d+)?$/u', $t));
        if (count($kept) === count($tokens) || ! $kept) {
            return null;
        }

        return implode(' ', $kept);
    }

    /* ============================================================
     * Pipeline çekirdeği
     * ============================================================ */

    /** @param string[] $fallback */
    protected function pipeline(string $surface, array $fallback): array
    {
        $plan = config("rec.pipelines.{$surface}");

        return is_array($plan) && ! empty($plan) ? $plan : $fallback;
    }

    /**
     * Kaynakları sırayla koştur; havuz limit'e ulaşana kadar doldur.
     * Her kaynak, bağlam dışlamalarını + önceki kaynakların bulduklarını görmez.
     *
     * @param  string[]  $plan
     * @return array<int, object>
     */
    public function run(RecContext $ctx, array $plan): array
    {
        $items = [];
        foreach ($plan as $key) {
            if (count($items) >= $ctx->limit) {
                break;
            }
            $source = $this->sources[$key] ?? null;
            if (! $source) {
                continue;
            }
            $exclude = array_merge($ctx->excludeIds, array_map(fn ($i) => (int) $i->id, $items));
            $need = $ctx->limit - count($items);
            // Model filtresi adayları eleyeceği için fazladan iste (renk kardeşleri yoğun olabilir)
            $found = $source->collect($ctx, min(40, $need * 3), $exclude);
            $items = array_merge($items, $this->filterModels($ctx, $items, $found, $need));
        }

        return array_slice($items, 0, $ctx->limit);
    }

    /* ============================================================
     * Model (renk kardeşi) filtresi + panelden sabitlenen ürünler
     * ============================================================ */

    /**
     * Model anahtarı: aynı modelin renk varyantları ayrı ürün kartıdır (Ticimax/Nebim:
     * sku "NEBIMV3|TBMHH005|111" → TBMHH005; düz sku'da sku'nun kendisi). Sepetteki
     * ürünün renk kardeşleri ÖNERİLMEZ ve listede her modelden tek renk gösterilir.
     */
    public static function modelKey(?string $sku, ?string $name = null): ?string
    {
        $sku = trim((string) $sku);
        if ($sku !== '') {
            if (str_contains($sku, '|')) {
                $parts = array_values(array_filter(array_map('trim', explode('|', $sku)), fn ($x) => $x !== ''));
                $sku = $parts[1] ?? ($parts[0] ?? '');
            }
            if ($sku !== '') {
                return mb_strtoupper($sku);
            }
        }
        // sku yoksa ürün adının sonundaki model kodu (ör. "... Kahve Bot TBMHH005")
        if ($name && preg_match('/\b([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*)\s*$/u', trim($name), $m)) {
            return mb_strtoupper($m[1]);
        }

        return null;
    }

    /** @param int[] $productIds @return string[] */
    protected function modelKeysOf(int $tenantId, array $productIds): array
    {
        if (empty($productIds)) {
            return [];
        }
        $rows = DB::table('products')->where('tenant_id', $tenantId)->whereIn('id', $productIds)->get(['sku', 'name']);
        $keys = [];
        foreach ($rows as $r) {
            $k = self::modelKey($r->sku, $r->name);
            if ($k !== null) {
                $keys[] = $k;
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * Bulunan adaylardan: sepetteki modelin renk kardeşlerini at, aynı modelden ikinci rengi at.
     * @param object[] $have  @param object[] $found  @return object[]
     */
    protected function filterModels(RecContext $ctx, array $have, array $found, int $need): array
    {
        $seen = array_fill_keys($ctx->excludeModels, true);
        foreach ($have as $h) {
            $k = self::modelKey($h->sku ?? null, $h->name ?? null);
            if ($k !== null) {
                $seen[$k] = true;
            }
        }
        $out = [];
        foreach ($found as $f) {
            $k = self::modelKey($f->sku ?? null, $f->name ?? null);
            if ($k !== null) {
                if (isset($seen[$k])) {
                    continue;
                }
                $seen[$k] = true;
            }
            $out[] = $f;
            if (count($out) >= $need) {
                break;
            }
        }

        return $out;
    }

    /**
     * Panelden sabitlenen ürünler (tenants.settings.rec_pinned_products, JSON):
     *   [{id, mode: first|include, anchor: ?productId, surfaces: [atc, checkout]}]
     * first   → listenin başına (checkout'ta teklif ürünü olur)
     * include → listede mutlaka yer alır (motor ürünlerinin sonundan yer açılır)
     * anchor  → yalnız o ürün sepetteyken; boş = her sepette. Sepetteki/alınmış ürün ve
     * stoksuz ürün sabitlense de gösterilmez; aynı modelden zaten öneri varsa o düşer.
     * @param object[] $items @return object[]
     */
    protected function applyPins(RecContext $ctx, array $items): array
    {
        $pins = $this->pinsFor($ctx->tenantId);
        if (empty($pins)) {
            return $items;
        }
        $anchorIds = $ctx->anchorIds();
        $first = [];
        $include = [];
        foreach ($pins as $pin) {
            $pid = (int) ($pin['id'] ?? 0);
            if ($pid <= 0 || in_array($pid, $ctx->excludeIds, true)) {
                continue;
            }
            $surfaces = is_array($pin['surfaces'] ?? null) ? $pin['surfaces'] : ['atc', 'checkout'];
            if (! in_array($ctx->surface, $surfaces, true) && $ctx->surface !== 'generic') {
                continue;
            }
            $anchor = (int) ($pin['anchor'] ?? 0);
            if ($anchor > 0 && ! in_array($anchor, $anchorIds, true)) {
                continue;
            }
            if (($pin['mode'] ?? 'include') === 'first') {
                $first[] = $pid;
            } else {
                $include[] = $pid;
            }
        }
        $wanted = array_values(array_unique(array_merge($first, $include)));
        if (empty($wanted)) {
            return $items;
        }
        // Aktif + stoklu + fiyatlı olanlar (kartlarla aynı kolon seti)
        $rows = DB::select("
            SELECT p.id, p.platform_product_id, p.name, p.url, p.brand, p.category,
                   p.price, p.discounted_price, p.images, p.performance_score, p.sku
            FROM products p
            WHERE p.tenant_id = ? AND p.id IN (".implode(',', array_fill(0, count($wanted), '?')).")
              AND p.is_active = true AND coalesce(p.url, '') <> '' AND p.price > 0
              AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true AND v.stock_quantity > 0)
        ", array_merge([$ctx->tenantId], $wanted));
        $byId = [];
        foreach ($rows as $r) {
            $r->_source = 'pinned';
            $byId[(int) $r->id] = $r;
        }
        $pinnedFirst = array_values(array_filter(array_map(fn ($id) => $byId[$id] ?? null, $first)));
        $pinnedInc = array_values(array_filter(array_map(fn ($id) => $byId[$id] ?? null, $include)));
        if (! $pinnedFirst && ! $pinnedInc) {
            return $items;
        }
        // Sabitlenenlerin modelleri motor listesinden düşer (aynı modelden tek renk kuralı)
        $pinModels = [];
        foreach (array_merge($pinnedFirst, $pinnedInc) as $r) {
            $k = self::modelKey($r->sku ?? null, $r->name ?? null);
            if ($k !== null) {
                $pinModels[$k] = true;
            }
        }
        $pinIds = array_map(fn ($r) => (int) $r->id, array_merge($pinnedFirst, $pinnedInc));
        $engine = array_values(array_filter($items, function ($i) use ($pinIds, $pinModels) {
            if (in_array((int) $i->id, $pinIds, true)) {
                return false;
            }
            $k = self::modelKey($i->sku ?? null, $i->name ?? null);

            return $k === null || ! isset($pinModels[$k]);
        }));
        $limit = $ctx->limit;
        $room = max(0, $limit - count($pinnedFirst) - count($pinnedInc));
        $merged = array_merge($pinnedFirst, array_slice($engine, 0, $room), $pinnedInc);

        return array_slice($merged, 0, $limit);
    }

    /** Sepet önerisi karışım modu tenant bazında açılır (rec_cart_mix); kapalı tenant eski davranışta kalır. */
    protected function cartMixEnabled(int $tenantId): bool
    {
        return Cache::remember("rec:cartMix:{$tenantId}", 60, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $settings = is_string($raw) ? json_decode($raw, true) : (array) $raw;

            return filter_var($settings['rec_cart_mix'] ?? false, FILTER_VALIDATE_BOOLEAN);
        });
    }

    /** @return array<int, array> */
    protected function pinsFor(int $tenantId): array
    {
        return Cache::remember("rec:pins:{$tenantId}", 60, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $settings = is_string($raw) ? json_decode($raw, true) : (array) $raw;
            $pins = $settings['rec_pinned_products'] ?? null;
            if (is_string($pins)) {
                $pins = json_decode($pins, true);
            }

            return is_array($pins) ? array_values(array_filter($pins, 'is_array')) : [];
        });
    }

    /* ============================================================
     * Çözücüler (anchor / müşteri)
     * ============================================================ */

    /**
     * Platform ürün id + varyant id + barkod → anchor. Barkod EN GÜVENİLİR
     * (checkout SPA'sı varyant id'yi net vermez); sonra varyant, sonra ürün.
     *
     * @return ?array{id:int, brand:?string, category:?string, size:?string, qty:int}
     */
    /** ikas ürün/varyant kimlikleri UUID'dir (Ticimax sayısal). */
    protected const UUID_RE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    public function resolveAnchor(int $tenantId, ?string $pid, ?string $vid, ?string $barcode, int $qty = 1): ?array
    {
        $pid = $pid !== null ? trim($pid) : '';
        $vid = $vid !== null ? trim($vid) : '';
        $barcode = $barcode !== null ? trim($barcode) : '';

        if ($barcode !== '' && strlen($barcode) <= 64) {
            $row = DB::table('product_variants as v')
                ->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('v.tenant_id', $tenantId)
                ->where('v.barcode', $barcode)
                ->first(['p.id', 'p.brand', 'p.category', DB::raw("v.attributes->>'Beden' as beden")]);
            if ($row) {
                return $this->anchorRow($row, trim((string) $row->beden) ?: null, $qty);
            }
        }
        if ($vid !== '' && (preg_match('/^\d{1,18}$/', $vid) || preg_match(self::UUID_RE, $vid))) {
            $row = DB::table('product_variants as v')
                ->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('v.tenant_id', $tenantId)
                ->where('v.platform_variant_id', $vid)
                ->first(['p.id', 'p.brand', 'p.category', DB::raw("v.attributes->>'Beden' as beden")]);
            if ($row) {
                return $this->anchorRow($row, trim((string) $row->beden) ?: null, $qty);
            }
        }
        if ($pid !== '' && $pid !== '0' && (preg_match('/^\d{1,18}$/', $pid) || preg_match(self::UUID_RE, $pid))) {
            $row = DB::table('products')->where('tenant_id', $tenantId)
                ->where('platform_product_id', $pid)
                ->first(['id', 'brand', 'category']);
            if ($row) {
                return $this->anchorRow($row, null, $qty);
            }
        }

        return null;
    }

    protected function anchorRow(object $row, ?string $size, int $qty): array
    {
        return [
            'id' => (int) $row->id,
            'brand' => $row->brand ?? null,
            'category' => $row->category ?? null,
            'size' => $size,
            'qty' => $qty,
        ];
    }

    public function resolveCustomerId(int $tenantId, string $platformMemberId): ?int
    {
        if ($platformMemberId === '' || ! (preg_match('/^\d{1,18}$/', $platformMemberId) || preg_match(self::UUID_RE, $platformMemberId))) {
            return null;
        }
        $id = DB::table('customers')
            ->where('tenant_id', $tenantId)
            ->where('platform_customer_id', $platformMemberId)
            ->value('id');

        return $id ? (int) $id : null;
    }

    /** Üye girişli akışlarda bağlama müşteri profilini uygular (exclude + boost). */
    protected function applyCustomer(RecContext $ctx, ?string $platformMemberId): void
    {
        if (! $platformMemberId) {
            return;
        }
        $customerId = $this->resolveCustomerId($ctx->tenantId, $platformMemberId);
        if (! $customerId) {
            return;
        }
        $ctx->customerId = $customerId;
        [$bought, $brands, $categories] = $this->customerHistory($ctx->tenantId, $customerId);
        $ctx->excludeIds = array_merge($ctx->excludeIds, $bought);
        $ctx->boostBrands = $brands;
        $ctx->boostCategories = $categories;
    }

    /**
     * Üye geçmişi: son alınan ürünler (exclude) + marka/kategori tercihleri (boost).
     *
     * @return array{0: int[], 1: string[], 2: string[]}
     */
    public function customerHistory(int $tenantId, int $customerId): array
    {
        $days = (int) config('rec.offer.history_days', 180);

        $rows = DB::select('
            SELECT oi.product_id, p.brand, p.category
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE o.tenant_id = ? AND o.customer_id = ?
              AND coalesce(o.paid_amount, 0) > 0
              AND o.order_date >= now() - make_interval(days => ?)
              AND oi.product_id IS NOT NULL
            LIMIT 200
        ', [$tenantId, $customerId, $days]);

        $bought = [];
        $brands = [];
        $categories = [];
        foreach ($rows as $r) {
            $bought[] = (int) $r->product_id;
            if (! empty($r->brand)) {
                $brands[$r->brand] = true;
            }
            if (! empty($r->category)) {
                $categories[$r->category] = true;
            }
        }

        return [array_values(array_unique($bought)), array_keys($brands), array_keys($categories)];
    }

    /**
     * Müşterinin bilinen bedenleri — alım geçmişindeki varyantların Beden histogramı
     * (en sık 3 beden). E-posta/WhatsApp akışında "37 alan kadına 37 stokta" kuralı.
     *
     * @return string[]
     */
    public function customerSizes(int $tenantId, int $customerId): array
    {
        $days = (int) config('rec.engine.customer_size_days', 720);

        $rows = DB::select("
            SELECT pv.attributes->>'Beden' AS beden, count(*) AS n
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN product_variants pv ON pv.id = oi.product_variant_id
            WHERE o.tenant_id = ? AND o.customer_id = ?
              AND coalesce(o.paid_amount, 0) > 0
              AND o.order_date >= now() - make_interval(days => ?)
              AND coalesce(pv.attributes->>'Beden', '') <> ''
            GROUP BY 1
            ORDER BY n DESC
            LIMIT 3
        ", [$tenantId, $customerId, $days]);

        return array_values(array_map(fn ($r) => (string) $r->beden, $rows));
    }

    /**
     * Kişi-bazlı akış için anchor'lar: son ödenmiş alımların ürünleri (en yeni önce).
     *
     * @return array<int, array{id:int, brand:?string, category:?string, size:?string, qty:int}>
     */
    protected function anchorsFromPurchases(int $tenantId, int $customerId): array
    {
        $days = (int) config('rec.engine.customer_anchor_days', 365);
        $max = (int) config('rec.engine.customer_anchor_count', 6);

        $rows = DB::select("
            SELECT DISTINCT ON (oi.product_id)
                   oi.product_id AS id, p.brand, p.category,
                   pv.attributes->>'Beden' AS beden, o.order_date
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products p ON p.id = oi.product_id
            LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
            WHERE o.tenant_id = ? AND o.customer_id = ?
              AND coalesce(o.paid_amount, 0) > 0
              AND o.order_date >= now() - make_interval(days => ?)
            ORDER BY oi.product_id, o.order_date DESC
        ", [$tenantId, $customerId, $days]);

        usort($rows, fn ($a, $b) => strcmp((string) $b->order_date, (string) $a->order_date));

        return array_map(
            fn ($r) => $this->anchorRow($r, trim((string) $r->beden) ?: null, 1),
            array_slice($rows, 0, $max)
        );
    }

    /* ============================================================
     * Sunum
     * ============================================================ */

    /** Widget/kanal kartı + tek-tık sepete ekleme için eşleşen varyant. */
    public function present(object $p, RecContext $ctx): array
    {
        $size = $p->_size ?? ($ctx->anchorSizes()[0] ?? null);

        $images = json_decode((string) $p->images, true) ?: [];
        $image = is_array($images) && ! empty($images) ? (string) $images[0] : null;

        $price = (float) $p->price;
        $discounted = (float) ($p->discounted_price ?? 0);
        $hasDiscount = $discounted > 0 && $discounted < $price;

        // İstenen bedendeki stoklu varyant; yoksa kişi bedenleri; o da yoksa en stoklusu
        $variant = null;
        $trySizes = array_values(array_filter(array_merge([$size], $ctx->preferredSizes)));
        foreach ($trySizes as $s) {
            $variant = DB::table('product_variants')
                ->where('tenant_id', $ctx->tenantId)
                ->where('product_id', $p->id)
                ->where('is_active', true)
                ->where('stock_quantity', '>', 0)
                ->whereRaw("attributes->>'Beden' = ?", [$s])
                ->orderByDesc('stock_quantity')
                ->first(['platform_variant_id', 'stock_quantity', DB::raw("attributes->>'Beden' as beden")]);
            if ($variant) {
                $size = $s;
                break;
            }
        }
        if (! $variant) {
            $variant = DB::table('product_variants')
                ->where('tenant_id', $ctx->tenantId)
                ->where('product_id', $p->id)
                ->where('is_active', true)
                ->where('stock_quantity', '>', 0)
                ->orderByDesc('stock_quantity')
                ->first(['platform_variant_id', 'stock_quantity', DB::raw("attributes->>'Beden' as beden")]);
        }

        return [
            'id' => (int) $p->id,
            'pid' => (string) $p->platform_product_id,
            'name' => (string) $p->name,
            'url' => (string) $p->url,
            // Ticimax'ta yalnız /buyuk/ ve /thumb/ (400×600) boyutları var — kart için thumb yeterli
            'image' => $image ? str_replace('/buyuk/', '/thumb/', $image) : null,
            'price' => round($price, 2),
            'discounted' => $hasDiscount ? round($discounted, 2) : null,
            'size' => $size,
            'variant_id' => $variant ? (string) $variant->platform_variant_id : null,
            'low_stock' => $variant && (int) $variant->stock_quantity <= 3 ? (int) $variant->stock_quantity : null,
            'source' => (string) ($p->_source ?? 'copurchase'),
        ];
    }
}
