<?php

namespace App\Services\Cro;

use App\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Beden Seçimi (CRO) görünüm özellikleri: "Renk seçenekleri" (Trendyol tarzı küçük görseller, aktif renk çerçeveli,
 * popüler renkler önde + "Popüler" etiketi, stoksuz renk soluk/sonda/gizli) ve "Az kalan numara" uyarısı (Son 2).
 * Ayarlar tenant.settings['variant_select_ui']; mağaza betiği (widget/variant.js) ayarı ve ürün verisini genel uçlardan okur.
 */
class VariantUiService
{
    public const OOS_MODES = ['dim', 'end', 'hide'];

    /** ranking = Akıllı Kategori Sıralaması puanı (beden katmanı + stok + satış + ilgi…); popular = yalnız satış adedi; theme = temanın sırası */
    public const SORTS = ['ranking', 'popular', 'theme'];

    /** Görsel oranı: portrait = 3:4 dikey kutu (Trendyol), square = kare, original = fotoğrafın kendi oranı (kırpılmaz) */
    public const ASPECTS = ['portrait', 'square', 'original'];

    public const DEFAULTS = [
        'colors' => [
            'enabled' => false,
            'selector' => '#productDetailRelated',
            'sort' => 'ranking',
            'active_first' => false,
            'popular_badge' => true,
            'popular_count' => 2,
            'popular_min_sales' => 5,
            'popular_days' => 30,
            'badge_text' => 'Popüler',
            'show_label' => true,
            'label_text' => 'Renk',
            'show_names' => false,
            'out_of_stock' => 'dim',
            'thumb_width' => 64,
            'aspect' => 'portrait',
            'radius' => 10,
            'accent' => '#f27a1a',
            'max_visible' => 0,
            'popular_first' => true,
            'arrows' => true,
            'count_text' => '{n} Farklı Seçenek',
        ],
        // Mobil seçim paneli (Trendyol uygulaması gibi alttan açılan beden seçimi)
        'sheet' => [
            'enabled' => false,
            'page_row' => true,
            'breakpoint' => 768,
            'title_text' => 'Beden',
            'keep_size_on_color' => true,
            'notify' => true,
            'similar' => true,
            'similar_count' => 10,
            'fit_advice' => true,
            'fit_min' => 5,
        ],
        // Ürün sayfası düzeni: tema rozetlerini gizle, güven bandına üst boşluk, ek gizlenecek seçiciler
        'page' => [
            'hide_badges' => false,
            'trust_margin' => 0,
            'hide_extra' => '',
            // Temanın tüm sayfayı karartan "Lütfen seçim yapınız" katmanı yerine hafif uyarı
            'light_alert' => true,
            // Masaüstü fotoğraf görüntüleyicisi açıkken kaydırma: sayfa kaymaz, fotoğraf değişir
            'lightbox_wheel' => true,
        ],
        // A/B: ziyaretçilerin share%'ü seçim panelini görür (A), kalanı görmez (B)
        'ab' => [
            'enabled' => false,
            'share' => 50,
        ],
        'low_stock' => [
            'enabled' => false,
            'threshold' => 3,
            'text' => 'Son {n}',
            'color' => '#d93025',
        ],
    ];

    public static function settings(?Tenant $tenant): array
    {
        $saved = ($tenant?->settings ?? [])['variant_select_ui'] ?? [];
        $out = self::DEFAULTS;
        foreach (['colors', 'low_stock', 'sheet', 'ab', 'page'] as $g) {
            foreach ((array) ($saved[$g] ?? []) as $k => $v) {
                if (array_key_exists($k, $out[$g])) {
                    $out[$g][$k] = $v;
                }
            }
        }

        return $out;
    }

    /** Doğrulama kuralları (PUT /cro/variant/settings içindeki "ui" alanı). */
    public static function rules(): array
    {
        return [
            'ui' => 'sometimes|array',
            'ui.colors' => 'sometimes|array',
            'ui.colors.enabled' => 'sometimes|boolean',
            'ui.colors.selector' => 'sometimes|string|max:200',
            'ui.colors.sort' => 'sometimes|in:'.implode(',', self::SORTS),
            'ui.colors.active_first' => 'sometimes|boolean',
            'ui.colors.popular_badge' => 'sometimes|boolean',
            'ui.colors.popular_count' => 'sometimes|integer|between:1,5',
            'ui.colors.popular_min_sales' => 'sometimes|integer|between:1,500',
            'ui.colors.popular_days' => 'sometimes|integer|in:7,14,30,60,90',
            'ui.colors.badge_text' => 'sometimes|string|max:20',
            'ui.colors.show_label' => 'sometimes|boolean',
            'ui.colors.label_text' => 'sometimes|string|max:20',
            'ui.colors.show_names' => 'sometimes|boolean',
            'ui.colors.out_of_stock' => 'sometimes|in:'.implode(',', self::OOS_MODES),
            'ui.colors.thumb_width' => 'sometimes|integer|between:44,110',
            'ui.colors.aspect' => 'sometimes|in:'.implode(',', self::ASPECTS),
            'ui.colors.radius' => 'sometimes|integer|between:0,24',
            'ui.colors.accent' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'ui.colors.max_visible' => 'sometimes|integer|between:0,30',
            'ui.colors.popular_first' => 'sometimes|boolean',
            'ui.colors.arrows' => 'sometimes|boolean',
            'ui.colors.count_text' => 'sometimes|nullable|string|max:40',
            'ui.sheet' => 'sometimes|array',
            'ui.sheet.enabled' => 'sometimes|boolean',
            'ui.sheet.page_row' => 'sometimes|boolean',
            'ui.sheet.breakpoint' => 'sometimes|integer|between:480,1200',
            'ui.sheet.title_text' => 'sometimes|string|max:20',
            'ui.sheet.keep_size_on_color' => 'sometimes|boolean',
            'ui.sheet.notify' => 'sometimes|boolean',
            'ui.sheet.similar' => 'sometimes|boolean',
            'ui.sheet.similar_count' => 'sometimes|integer|between:3,20',
            'ui.sheet.fit_advice' => 'sometimes|boolean',
            'ui.sheet.fit_min' => 'sometimes|integer|between:3,100',
            'ui.page' => 'sometimes|array',
            'ui.page.hide_badges' => 'sometimes|boolean',
            'ui.page.trust_margin' => 'sometimes|integer|between:0,60',
            'ui.page.light_alert' => 'sometimes|boolean',
            'ui.page.lightbox_wheel' => 'sometimes|boolean',
            'ui.page.hide_extra' => ['sometimes', 'nullable', 'string', 'max:300', 'regex:/^[^{}<>;]*$/'],
            'ui.ab' => 'sometimes|array',
            'ui.ab.enabled' => 'sometimes|boolean',
            'ui.ab.share' => 'sometimes|integer|between:5,95',
            'ui.low_stock' => 'sometimes|array',
            'ui.low_stock.enabled' => 'sometimes|boolean',
            'ui.low_stock.threshold' => 'sometimes|integer|between:1,20',
            'ui.low_stock.text' => 'sometimes|string|max:20',
            'ui.low_stock.color' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ];
    }

    public static function save(Tenant $tenant, array $ui): void
    {
        $settings = $tenant->settings ?? [];
        $cur = self::settings($tenant);
        foreach (['colors', 'low_stock', 'sheet', 'ab', 'page'] as $g) {
            foreach ((array) ($ui[$g] ?? []) as $k => $v) {
                if (array_key_exists($k, $cur[$g])) {
                    $cur[$g][$k] = is_string($v) ? strip_tags($v) : $v;
                }
            }
        }
        $settings['variant_select_ui'] = $cur;
        $tenant->update(['settings' => $settings]);
    }

    /**
     * Mağaza betiği için ürün verisi. Satış ADETİ ve stok MİKTARI dışarı verilmez:
     * yalnız sıra, popüler listesi, stoksuz renkler, renk adları ve eşiğin altındaki numaraların adedi.
     *
     * @param  string[]  $ids  sayfadaki renk ürünlerinin platform kimlikleri
     */
    public static function data(Tenant $tenant, array $ids, ?string $pid): array
    {
        $s = self::settings($tenant);
        $ids = array_values(array_unique(array_filter(array_map(fn ($x) => preg_replace('/\D/', '', (string) $x), $ids))));
        $pid = $pid !== null ? preg_replace('/\D/', '', $pid) : null;
        if ($pid && ! in_array($pid, $ids, true)) {
            $ids[] = $pid;
        }
        $ids = array_slice($ids, 0, 40);
        sort($ids);
        // Ayar değişince anahtar da değişir (ayarlar anahtarın parçası)
        $key = "variant:ui:data:{$tenant->id}:".md5(implode(',', $ids).'|'.$pid.'|'.json_encode($s));

        return Cache::remember($key, 600, function () use ($tenant, $ids, $pid, $s) {
            $c = $s['colors'];
            $products = $ids ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('platform_product_id', $ids)
                ->get(['id', 'platform_product_id', 'stock_quantity', 'is_active', 'url', 'images'])->keyBy('platform_product_id') : collect();

            // Renk adı + stoklu numara sayısı (varyantlardan)
            $color = [];
            $inStock = [];
            if ($products->isNotEmpty()) {
                foreach (DB::table('product_variants')->whereIn('product_id', $products->pluck('id'))->get(['product_id', 'attributes', 'stock_quantity', 'is_active']) as $v) {
                    $a = json_decode((string) $v->attributes, true) ?: [];
                    $p = $products->firstWhere('id', $v->product_id);
                    if (! $p) {
                        continue;
                    }
                    $k = $p->platform_product_id;
                    if (! empty($a['Renk']) && empty($color[$k])) {
                        $color[$k] = (string) $a['Renk'];
                    }
                    if ($v->is_active && (int) $v->stock_quantity > 0) {
                        $inStock[$k] = ($inStock[$k] ?? 0) + 1;
                    }
                }
            }

            // Son N günün ödenmiş satışları (Ticimax: ödenmemiş deneme siparişleri ve iptaller hariç)
            $sold = [];
            if ($ids) {
                $days = (int) $c['popular_days'];
                foreach (DB::select(
                    "select oi.platform_product_id pid, sum(oi.quantity) adet from order_items oi join orders o on o.id = oi.order_id
                     where o.tenant_id = ? and o.payment_status = 1 and o.status <> 8 and o.order_date >= now() - (? || ' days')::interval
                       and oi.platform_product_id in (".implode(',', array_fill(0, count($ids), '?')).') group by 1',
                    array_merge([$tenant->id, $days], $ids)
                ) as $r) {
                    $sold[(string) $r->pid] = (int) $r->adet;
                }
            }

            $oos = [];
            foreach ($ids as $id) {
                $p = $products->get($id);
                if ($p && (! $p->is_active || (int) $p->stock_quantity <= 0 || ($inStock[$id] ?? 0) === 0)) {
                    $oos[] = $id;
                }
            }

            $rank = $ids;
            if ($c['sort'] === 'ranking') {
                // Kategori sıralamasıyla aynı mantık: önce beden katmanı (tam numara > eksik > stoksuz), sonra puan
                $map = self::rankMap($tenant);
                usort($rank, fn ($a, $b) => (($map[$b]['t'] ?? -1) <=> ($map[$a]['t'] ?? -1)) ?: (($map[$b]['s'] ?? 0) <=> ($map[$a]['s'] ?? 0)));
            } else {
                // Satış adedi (eşitlikte sayfadaki sıra korunur)
                usort($rank, fn ($a, $b) => ($sold[$b] ?? 0) <=> ($sold[$a] ?? 0));
            }
            // Popüler = sıranın en üstündeki stoklu renkler; en az satış şartıyla (az satan modelde etiket çıkmaz)
            $popRank = $c['sort'] === 'theme' ? $ids : $rank;
            if ($c['sort'] === 'theme') {
                usort($popRank, fn ($a, $b) => ($sold[$b] ?? 0) <=> ($sold[$a] ?? 0));
            }
            $popular = [];
            foreach ($popRank as $id) {
                if (count($popular) >= (int) $c['popular_count']) {
                    break;
                }
                if (($sold[$id] ?? 0) >= (int) $c['popular_min_sales'] && ! in_array($id, $oos, true)) {
                    $popular[] = $id;
                }
            }

            // Az kalan numaralar (yalnız eşiğin altındakiler, adetle) — sayfadaki ürün için
            $low = [];
            if ($pid && ($p = $products->get($pid)) && $s['low_stock']['enabled']) {
                $th = (int) $s['low_stock']['threshold'];
                foreach (DB::table('product_variants')->where('product_id', $p->id)->where('is_active', true)->get(['attributes', 'stock_quantity']) as $v) {
                    $a = json_decode((string) $v->attributes, true) ?: [];
                    $n = (int) $v->stock_quantity;
                    if (! empty($a['Beden']) && $n > 0 && $n <= $th) {
                        $low[(string) $a['Beden']] = $n;
                    }
                }
            }

            // Popüler renkler en başa (sıralamanın kendi içinde)
            if ($c['popular_first'] && $c['popular_badge'] && $popular && $c['sort'] !== 'theme') {
                $rank = array_values(array_merge(array_values(array_intersect($rank, $popular)), array_values(array_diff($rank, $popular))));
            }

            $cur = $pid ? $products->get($pid) : null;
            $images = $cur ? (is_string($cur->images) ? json_decode($cur->images, true) : (array) $cur->images) : [];

            return [
                'order' => $c['sort'] === 'theme' ? $ids : $rank,
                'popular' => $c['popular_badge'] ? $popular : [],
                'oos' => $oos,
                'color' => (object) $color,
                'low' => (object) $low,
                'current' => $cur ? ['id' => $pid, 'url' => $cur->url, 'image' => $images[0] ?? null] : null,
                'fit' => ($s['sheet']['fit_advice'] && $cur) ? self::fitFor($tenant, (int) $cur->id, (int) $s['sheet']['fit_min']) : null,
            ];
        });
    }

    /**
     * Renk sıralaması için Akıllı Kategori Sıralaması puanları: her model (stok kodunun model kısmı) kendi
     * renkleri arasında puanlanır. platform_product_id → ['t' => beden katmanı, 's' => puan]. Sinyal kurulumu
     * ~1 sn → 30 dk önbellek (variant:rank komutu da tazeler).
     */
    public static function rankMap(Tenant $tenant, bool $fresh = false): array
    {
        $key = "variant:rank:{$tenant->id}";
        if (! $fresh && is_array($m = Cache::get($key))) {
            return $m;
        }
        $ranker = new \App\Services\Ranking\CategoryRanker();
        $ranker->buildSignals($tenant);
        $groups = [];
        foreach (DB::table('products')->where('tenant_id', $tenant->id)->where('is_active', true)->where('sku', 'like', '%|%|%')
            ->get(['id', 'sku']) as $p) {
            $groups[explode('|', (string) $p->sku)[1] ?? ''][] = (int) $p->id;
        }
        $map = [];
        foreach ($groups as $model => $pids) {
            if ($model === '' || count($pids) < 2) {
                continue;
            }
            foreach ($ranker->rank($pids) as $r) {
                $map[(string) $r['ppid']] = ['t' => (int) $r['tier'], 's' => round((float) $r['score'], 5)];
            }
        }
        Cache::put($key, $map, 1800);

        return $map;
    }

    /** Kalıp tavsiyesi metinleri (yorumlardaki ifadelerin çoğunluğu) */
    public const FIT_TEXT = [
        'buyuk' => 'Kullanıcıların çoğu 1 numara büyük almanızı öneriyor.',
        'kucuk' => 'Kullanıcıların çoğu 1 numara küçük almanızı öneriyor.',
        'tam' => 'Kullanıcıların çoğu kalıbının tam olduğunu söylüyor.',
    ];

    /**
     * Ürün yorumlarından (Trendyol, product_reviews) kalıp tavsiyesi — model (stok kodu) düzeyinde toplanır:
     * "bir numara büyük alın / dar kalıp" → büyük, "küçük alın / geniş kalıp" → küçük, "tam kalıp" → kendi numaran.
     * En az $min ifade ve %50 çoğunluk yoksa tavsiye verilmez. Harita 24 saat önbellekte (~1,5 sn).
     */
    public static function fitFor(Tenant $tenant, int $productId, int $min): ?array
    {
        $map = Cache::remember("variant:fit:{$tenant->id}", 86400, function () use ($tenant) {
            $b = '(bir|1|yarım) (numara|beden) büyük al|büyük alın|büyük almanız|büyük alınmalı|dar kalıp|kalıbı dar|küçük kalıp|kalıbı küçük|küçük geldi|dar geldi|ayağımı sıktı|sıkıyor';
            $k = '(bir|1|yarım) (numara|beden) küçük al|küçük alın|küçük almanız|geniş kalıp|kalıbı geniş|büyük kalıp|kalıbı büyük|büyük geldi|bol geldi';
            $t = 'tam kalıp|kalıbı tam|standart kalıp|kendi numaranızı|kendi numaramı aldım|numaranızı alın|tam oldu|tam geldi';
            $models = [];
            foreach (DB::select("select split_part(p.sku, '|', 2) model,
                    count(*) filter (where lower(r.comment) ~ ?) b, count(*) filter (where lower(r.comment) ~ ?) k, count(*) filter (where lower(r.comment) ~ ?) t
                    from product_reviews r join products p on p.id = r.product_id where r.tenant_id = ? and p.sku like '%|%' group by 1", [$b, $k, $t, $tenant->id]) as $r) {
                $models[(string) $r->model] = [(int) $r->b, (int) $r->k, (int) $r->t];
            }
            $prod = [];
            foreach (DB::table('products')->where('tenant_id', $tenant->id)->where('sku', 'like', '%|%')->get(['id', 'sku']) as $p) {
                $m = explode('|', (string) $p->sku)[1] ?? '';
                if (isset($models[$m])) {
                    $prod[(int) $p->id] = $models[$m];
                }
            }

            return $prod;
        });
        [$b, $k, $t] = $map[$productId] ?? [0, 0, 0];
        $all = $b + $k + $t;
        if ($all < $min) {
            return null;
        }
        $top = max($b, $k, $t);
        if ($top / $all < 0.5) {
            return null;
        }
        $key = $top === $b ? 'buyuk' : ($top === $k ? 'kucuk' : 'tam');

        return ['key' => $key, 'text' => self::FIT_TEXT[$key], 'mentions' => $all];
    }

    /**
     * Seçilen numara stokta değilse: aynı kategoride, o numarası stokta olan benzer ürünler
     * (Akıllı sıralama puanına göre; renk haritası olmayan üründe ürün performans puanı).
     */
    public static function similar(Tenant $tenant, string $pid, string $size, int $limit): array
    {
        $pid = preg_replace('/\D/', '', $pid);
        $size = mb_substr(trim($size), 0, 12);
        if ($pid === '' || $size === '') {
            return [];
        }

        return Cache::remember("variant:similar:{$tenant->id}:{$pid}:".md5($size).":{$limit}", 900, function () use ($tenant, $pid, $size, $limit) {
            $cur = DB::table('products')->where('tenant_id', $tenant->id)->where('platform_product_id', $pid)->first(['id', 'category', 'category_path', 'sku']);
            // Kategori: ürün kategorisi boşsa kategori yolunun son kırılımı (ör. "Erkek > … > Erkek Spor Ayakkabı")
            $cat = $cur ? trim((string) ($cur->category ?: (last(explode('>', (string) $cur->category_path)) ?: ''))) : '';
            if (! $cur || $cat === '' || $cat === 'Kategorisiz') {
                return [];
            }
            $model = explode('|', (string) $cur->sku)[1] ?? '';
            $rows = DB::select("select p.platform_product_id pid, p.name, p.url, p.images, p.price, p.discounted_price, p.performance_score, p.sku
                from products p
                where p.tenant_id = ? and p.is_active and p.stock_quantity > 0 and p.id <> ?
                  and (p.category = ? or p.category_path like ?)
                  and exists (select 1 from product_variants v where v.product_id = p.id and v.is_active and v.stock_quantity > 0 and v.attributes->>'Beden' = ?)
                limit 200", [$tenant->id, $cur->id, $cat, '%> '.$cat, $size]);
            $map = self::rankMap($tenant);
            $out = [];
            foreach ($rows as $r) {
                if ($model !== '' && (explode('|', (string) $r->sku)[1] ?? '') === $model) {
                    continue; // aynı modelin başka rengi renk şeridinde zaten var
                }
                $imgs = is_string($r->images) ? json_decode($r->images, true) : (array) $r->images;
                $m = $map[(string) $r->pid] ?? null;
                $out[] = [
                    'id' => (string) $r->pid,
                    'name' => (string) $r->name,
                    'url' => (string) $r->url,
                    'image' => $imgs[0] ?? null,
                    'price' => (float) $r->price,
                    'sale' => $r->discounted_price !== null && (float) $r->discounted_price > 0 && (float) $r->discounted_price < (float) $r->price ? (float) $r->discounted_price : null,
                    '_k' => $m ? [$m['t'], $m['s']] : [3, ((float) $r->performance_score) / 100],
                ];
            }
            usort($out, fn ($a, $b) => ($b['_k'][0] <=> $a['_k'][0]) ?: ($b['_k'][1] <=> $a['_k'][1]));
            $out = array_slice($out, 0, $limit);
            foreach ($out as &$o) {
                unset($o['_k']);
            }

            return $out;
        });
    }

    /**
     * Stoksuz numarada "Benzer Ürünler" butonu: ürünün en alt kategorisi + ?beden= (Yunbi Akıllı Filtre okur).
     * Unisex ürün iki cinsiyet kategorisindeyse numaraya göre seçilir (≥40 Erkek, ≤38 Kadın), yoksa birincil kategori.
     */
    public static function categoryUrl(Tenant $tenant, string $pid, string $size): ?string
    {
        $pid = preg_replace('/\D/', '', $pid);
        $size = mb_substr(trim($size), 0, 12);
        if ($pid === '' || $size === '') {
            return null;
        }
        $url = Cache::remember("variant:caturl:{$tenant->id}:{$pid}:".md5($size), 3600, function () use ($tenant, $pid, $size) {
            $rows = DB::select("select c.path, c.depth, c.url, c.product_count, pc.is_primary
                from product_platform_categories pc
                join platform_categories c on c.tenant_id = pc.tenant_id and c.platform_category_id = pc.platform_category_id
                where pc.tenant_id = ? and pc.platform_product_id = ? and c.is_active and coalesce(c.url, '') <> '' and c.depth > 0
                order by c.depth desc", [$tenant->id, $pid]);
            if (! $rows) {
                return '';
            }
            $deep = array_values(array_filter($rows, fn ($r) => (int) $r->depth === (int) $rows[0]->depth));
            $n = is_numeric(str_replace(',', '.', $size)) ? (float) str_replace(',', '.', $size) : null;
            $want = $n === null ? null : ($n >= 40 ? 'Erkek' : ($n <= 38 ? 'Kadın' : null));
            usort($deep, function ($a, $b) use ($want) {
                $ga = $want !== null && str_starts_with((string) $a->path, $want);
                $gb = $want !== null && str_starts_with((string) $b->path, $want);

                return ($gb <=> $ga) ?: (((int) $b->is_primary) <=> ((int) $a->is_primary)) ?: ((int) $b->product_count <=> (int) $a->product_count);
            });

            return (string) $deep[0]->url;
        });

        return $url === '' ? null : $url.(str_contains($url, '?') ? '&' : '?').'beden='.rawurlencode($size);
    }

    /** Panel önizlemesi: en çok satan, en az 4 renkli bir model (gerçek görsellerle). */
    public static function previewSample(Tenant $tenant): ?array
    {
        // Örnek model seçimi ağır sorgu (~5 sn) → 6 saat önbellek; popülerlik verisi her istekte taze
        $row = Cache::remember("variant:ui:preview:{$tenant->id}", 21600, fn () => DB::selectOne(
            "with m as (
                select split_part(p.sku, '|', 2) model, count(*) renk, array_agg(p.platform_product_id order by p.platform_product_id) ids
                from products p where p.tenant_id = ? and p.is_active and p.stock_quantity > 0 and p.sku like '%|%|%'
                  and jsonb_array_length(coalesce(p.images, '[]'::jsonb)) > 0
                group by 1 having count(*) between 4 and 8)
             select m.model, m.ids, coalesce(sum(oi.quantity), 0) adet from m
             left join order_items oi on oi.platform_product_id = any(m.ids) and oi.tenant_id = ? and oi.created_at >= now() - interval '30 days'
             group by m.model, m.ids order by adet desc limit 1",
            [$tenant->id, $tenant->id]
        ));
        if (! $row) {
            return null;
        }
        $ids = array_map('strval', explode(',', trim((string) $row->ids, '{}')));
        $data = self::data($tenant, $ids, $ids[0]);
        $items = [];
        foreach (DB::table('products')->where('tenant_id', $tenant->id)->whereIn('platform_product_id', $ids)->get(['platform_product_id', 'images', 'name']) as $p) {
            $imgs = is_string($p->images) ? json_decode($p->images, true) : (array) $p->images;
            $items[(string) $p->platform_product_id] = ['id' => (string) $p->platform_product_id, 'image' => $imgs[0] ?? null, 'name' => $p->name];
        }

        return ['model' => $row->model, 'items' => array_values(array_filter(array_map(fn ($id) => $items[$id] ?? null, $ids))), 'data' => $data];
    }
}
