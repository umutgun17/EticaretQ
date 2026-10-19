<?php

namespace App\Services\Filter;

use App\Models\Tenant;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Filtre motoru — kategori sayfası için ürün listesi + facet sayımları.
 *
 * - Kategori: platform_categories.url (Ticimax kategori yolu) → kategori + alt kategorileri
 *   (path öneki) → product_platform_categories atamaları.
 * - Facet sayımları DISJUNCTIVE: bir facet'in sayıları, o facet'in kendi seçimi hariç tüm
 *   filtrelerle hesaplanır ("Siyah" seçiliyken Beyaz'ın sayısı görünmeye devam eder).
 * - Renk+Beden birlikte seçildiğinde AYNI varyantta eşleşir (siyah VE 37 stokta).
 * - Renk facet'i renk AİLESİ ile çalışır (ilk kelime): "Siyah Süet"/"Siyah Cilt" → Siyah;
 *   457 ham değer yerine ~30 anlamlı seçenek.
 */
class FilterEngine
{
    public const SORTS = ['recommended', 'price_asc', 'price_desc', 'newest', 'bestseller', 'rating', 'discount'];

    public const SORT_LABELS = [
        'recommended' => 'Önerilen', 'price_asc' => 'Fiyat: düşükten yükseğe', 'price_desc' => 'Fiyat: yüksekten düşüğe',
        'newest' => 'En yeni', 'bestseller' => 'Çok satanlar', 'rating' => 'Puana göre', 'discount' => 'İndirim oranı',
    ];

    /** Renk ailesi → swatch rengi (Türkçe moda/ayakkabı sözlüğü). */
    public const COLOR_HEX = [
        'siyah' => '#111111', 'beyaz' => '#ffffff', 'bej' => '#d9c4a3', 'kahve' => '#6b4a2b', 'kahverengi' => '#6b4a2b', 'taba' => '#a0522d',
        'vizon' => '#b9a08a', 'gri' => '#8a8f98', 'füme' => '#5b6069', 'fume' => '#5b6069', 'antrasit' => '#3b3f46', 'lacivert' => '#1e2a5a',
        'mavi' => '#2f6fd1', 'bebe' => '#a7c7f0', 'kırmızı' => '#c8102e', 'kirmizi' => '#c8102e', 'bordo' => '#6d1a2b', 'yeşil' => '#2e7d4f',
        'yesil' => '#2e7d4f', 'haki' => '#7a7d4c', 'pembe' => '#e6a2b8', 'pudra' => '#f2c9c3', 'lila' => '#b79ce0', 'mor' => '#6a3fa0',
        'sarı' => '#f2c230', 'sari' => '#f2c230', 'hardal' => '#d4a017', 'turuncu' => '#ee7a2c', 'oranj' => '#ee7a2c', 'altın' => '#d4af37',
        'altin' => '#d4af37', 'gold' => '#d4af37', 'gümüş' => '#c0c0c0', 'gumus' => '#c0c0c0', 'ekru' => '#f0e9d8', 'krem' => '#f3ecd9',
        'toprak' => '#b0713d', 'camel' => '#c19a6b', 'somon' => '#fa8072', 'turkuaz' => '#30b8b2', 'petrol' => '#1f5f6b', 'nar' => '#a4133c',
        'leopar' => '#c9a26b', 'zebra' => '#777777', 'kamuflaj' => '#5f6b3a', 'çok' => '#cccccc', 'multi' => '#cccccc', 'renkli' => '#cccccc',
        'nude' => '#e8c9b0', 'ten' => '#e8c9b0', 'açık' => '#d8d8d8', 'koyu' => '#444444', 'platin' => '#d6d6d6', 'bronz' => '#a97142',
        'kiremit' => '#b7410e', 'mint' => '#98e2c6', 'fuşya' => '#d3287f', 'fusya' => '#d3287f', 'mercan' => '#ff7f50', 'şampanya' => '#f7e7ce',
    ];

    protected int $tenantId;

    protected array $rules;

    public function __construct(protected Tenant $tenant, protected array $settings)
    {
        $this->tenantId = $tenant->id;
        $this->rules = $settings['rules'];
    }

    public static function forTenant(Tenant $tenant): self
    {
        return new self($tenant, TenantFilterSettings::get($tenant->id));
    }

    // ───────────────────────── kategori ─────────────────────────

    /** URL yolu (/kadin-spor-ayakkabi[?...]) veya platform kategori id'sinden kategori çöz. */
    public function resolveCategory(?string $path, ?int $platformId = null): ?array
    {
        $q = DB::table('platform_categories')->where('tenant_id', $this->tenantId)->where('is_active', true);
        if ($platformId) {
            $cat = (clone $q)->where('platform_category_id', $platformId)->first();
        } else {
            $p = '/'.trim(strtolower((string) parse_url((string) $path, PHP_URL_PATH)), '/');
            if ($p === '/') {
                return null;
            }
            $cat = (clone $q)->whereRaw('lower(url) = ?', [$p])->first()
                ?: (clone $q)->whereRaw('lower(url) = ?', [preg_replace('~-\d+$~', '', $p)])->first();
        }
        if (! $cat) {
            return null;
        }

        return $this->categoryInfo($cat);
    }

    /**
     * Kapsam: listeyi ikinci bir kategorinin (alt ağacıyla) ürünleriyle kesiştirir.
     * Kampanya kategorisi + segment (ör. /sepette-50-indirim?kapsam=/unisex-cocuk → yalnız Çocuk ürünleri).
     * Beden aralığı da kapsam kategorisinden türer (Çocuk → 18-38).
     */
    public function withScope(array $category, ?string $scopePath): array
    {
        $scopePath = trim((string) $scopePath);
        if ($scopePath === '' || ($category['all'] ?? false)) {
            return $category;
        }
        $scope = $this->resolveCategory($scopePath);
        if (! $scope || $scope['id'] === $category['id'] || ! $scope['ids']) {
            return $category;
        }
        $category['scope'] = ['id' => $scope['id'], 'name' => $scope['name'], 'path' => $scope['path'], 'url' => $scope['url'], 'ids' => $scope['ids']];

        return $category;
    }

    /**
     * Kategori filtresi değerleri platform id (2481) VEYA URL yolu (/unisex-cocuk) olabilir — menü sanal kartı
     * `{seg}` yer tutucusuyla segment yolunu gönderir (ör. /sepette-50-indirim?kat=/unisex-cocuk). Yollar id'ye çözülür;
     * ham değerler chip'lerde korunur (widget kaldırma eşleşmesi). Seçilen kategori mevcut ağacın dışındaysa
     * (kampanya ∩ segment) beden aralığı ondan türer (Çocuk → çocuk numaraları).
     */
    protected function normalizeCategoryFilter(array $category, array $filters): array
    {
        $raw = array_values(array_filter((array) ($filters['category'] ?? []), fn ($v) => $v !== '' && $v !== null));
        $filters['category_raw'] = $raw;
        $filters['category'] = $this->categoryFilterIds($raw);
        if ($filters['category'] && empty($category['scope'])) {
            $first = DB::table('platform_categories')->where('tenant_id', $this->tenantId)
                ->whereIn('platform_category_id', $filters['category'])->first(['platform_category_id', 'name', 'path', 'url']);
            if ($first && ! in_array((int) $first->platform_category_id, $category['ids'] ?? [], true)) {
                $category['size_scope'] = ['id' => (int) $first->platform_category_id, 'name' => $first->name, 'path' => $first->path, 'url' => $first->url];
            }
        }

        return [$category, $filters];
    }

    /** @return int[] */
    protected function categoryFilterIds(array $values): array
    {
        $ids = [];
        foreach ($values as $v) {
            $v = trim((string) $v);
            if ($v === '') {
                continue;
            }
            if (ctype_digit($v)) {
                $ids[] = (int) $v;

                continue;
            }
            $cat = $this->resolveCategory($v);
            if ($cat) {
                $ids[] = (int) $cat['id'];
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Ticimax native filtre (?filtre=td-135|455,419) → kapsam: ürün özelliği (Cinsiyet ∈ {Kadın, Unisex}).
     * Kampanya sayfasında segment daraltması Ticimax'ın sunucu tarafı filtresiyle yapılır (URL'de id yok);
     * Yunbi aynı kısıtı facet sayıları, beden aralığı ve id listesine uygular. `kapsam=` varsa o öncelikli.
     */
    public function withNativeScope(array $category, ?string $filtre): array
    {
        $filtre = trim((string) $filtre);
        if ($filtre === '' || ! empty($category['scope']) || ($category['all'] ?? false)) {
            return $category;
        }
        $nf = NativeFilter::resolve($this->tenantId, $filtre);
        if (! $nf) {
            return $category;
        }
        $category['scope'] = ['id' => 0, 'name' => $nf['label'], 'path' => $nf['label'], 'url' => null, 'ids' => [], 'specs' => $nf['specs'], 'native' => true];

        return $category;
    }

    protected function categoryInfo(object $cat): array
    {
        $ids = Cache::remember("filter:catids:{$this->tenantId}:{$cat->platform_category_id}", 600, function () use ($cat) {
            return DB::table('platform_categories')->where('tenant_id', $this->tenantId)
                ->where(function ($q) use ($cat) {
                    $q->where('platform_category_id', $cat->platform_category_id)
                        ->orWhere('path', 'like', str_replace(['%', '_'], ['\%', '\_'], $cat->path).' > %');
                })->pluck('platform_category_id')->map(fn ($v) => (int) $v)->all();
        });

        $children = DB::table('platform_categories')->where('tenant_id', $this->tenantId)->where('is_active', true)
            ->where('parent_platform_id', $cat->platform_category_id)->where('product_count', '>', 0)
            ->orderByDesc('product_count')->get(['platform_category_id', 'name', 'url', 'path'])
            ->map(fn ($c) => ['id' => (int) $c->platform_category_id, 'name' => $c->name, 'url' => $c->url, 'path' => $c->path])->all();

        return [
            'id' => (int) $cat->platform_category_id,
            'name' => $cat->name,
            'path' => $cat->path,
            'url' => $cat->url,
            'depth' => (int) $cat->depth,
            'ids' => $ids,
            'children' => $children,
        ];
    }

    /**
     * Tüm katalog için sözde kategori (panel önizlemesi): kategori kısıtı yok,
     * "alt kategori" facet'i kök kategorileri gösterir.
     */
    public function wholeCatalog(): array
    {
        $roots = DB::table('platform_categories')->where('tenant_id', $this->tenantId)->where('is_active', true)
            ->where(function ($q) { $q->whereNull('parent_platform_id')->orWhere('parent_platform_id', 0); })
            ->where('product_count', '>', 0)->orderByDesc('product_count')->get(['platform_category_id', 'name', 'url', 'path'])
            ->map(fn ($c) => ['id' => (int) $c->platform_category_id, 'name' => $c->name, 'url' => $c->url, 'path' => $c->path])->all();

        return ['id' => 0, 'name' => 'Tüm katalog', 'path' => '', 'url' => '/', 'depth' => -1, 'ids' => [], 'children' => $roots, 'all' => true];
    }

    /**
     * Tek bir başlığın, hiçbir filtre uygulanmadan tüm katalogdaki değerleri
     * (panelde "bu başlık sitede nasıl görünecek?" önizlemesi). Etkin olup olmadığına bakılmaz.
     */
    public function facetPreview(string $key, string $type): ?array
    {
        $category = $this->wholeCatalog();
        $filters = [];

        return match ($type) {
            'category' => $this->facetCategory($category, $filters),
            'price' => $this->facetPrice($category, $filters),
            'color' => $this->facetVariant($category, $filters, 'color'),
            'size' => $this->facetVariant($category, $filters, 'size'),
            'brand' => $this->facetColumn($category, $filters, 'brand', 'p.brand'),
            'flag' => $this->facetFlag($category, $filters, $key),
            'rating' => $this->facetRating($category, $filters),
            'spec' => $this->facetColumn($category, $filters, $key, 'p.specifications->>'.DB::getPdo()->quote(substr($key, 5))),
            default => null,
        };
    }

    // ───────────────────────── sorgu ─────────────────────────

    /**
     * @param array $filters {color:[], size:[], brand:[], category:[ids], price_min, price_max, discount:bool, new:bool, rating:int, spec:{key:[vals]}}
     */
    /** Sıralı platform ürün id listesi — native modda Ticimax'a verilir (ukids / StrProductIds). */
    public const IDS_CAP = 1500;

    public function list(array $category, array $filters, string $sort = 'recommended', int $page = 1, ?int $perPage = null, bool $idsOnly = false): array
    {
        $perPage = max(8, min(60, $perPage ?: (int) $this->rules['per_page']));
        $sort = in_array($sort, self::SORTS, true) ? $sort : (string) $this->rules['sort_default'];
        $page = max(1, $page);
        [$category, $filters] = $this->normalizeCategoryFilter($category, $filters);

        $q = $this->baseQuery($category, $filters);
        $total = (int) (clone $q)->count();
        $this->applySort($q, $sort, $category);

        if ($idsOnly) {
            $ids = $q->limit(self::IDS_CAP)->pluck('p.platform_product_id')->map(fn ($v) => (int) $v)->filter()->values()->all();
            $facets = $this->facets($category, $filters);

            return [
                'category' => ['id' => $category['id'], 'name' => $category['name'], 'path' => $category['path'], 'url' => $category['url']],
                'scope' => isset($category['scope']) ? ['id' => $category['scope']['id'], 'name' => $category['scope']['name'], 'url' => $category['scope']['url'], 'native' => ! empty($category['scope']['native'])] : null,
                'total' => $total,
                'ids' => $ids,
                'capped' => $total > self::IDS_CAP,
                'facets' => $facets,
                'applied' => $this->appliedChips($filters, $facets),
            ];
        }

        $rows = $q->offset(($page - 1) * $perPage)->limit($perPage)->get();

        $products = $this->present($rows->all(), $filters);
        $facets = $this->facets($category, $filters);

        return [
            'category' => ['id' => $category['id'], 'name' => $category['name'], 'path' => $category['path'], 'url' => $category['url']],
                'scope' => isset($category['scope']) ? ['id' => $category['scope']['id'], 'name' => $category['scope']['name'], 'url' => $category['scope']['url'], 'native' => ! empty($category['scope']['native'])] : null,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'has_more' => $page * $perPage < $total,
            'sort' => $sort,
            'sorts' => array_map(fn ($k) => ['key' => $k, 'label' => self::SORT_LABELS[$k]], self::SORTS),
            'products' => $products,
            'facets' => $facets,
            'applied' => $this->appliedChips($filters, $facets),
        ];
    }

    protected function effPrice(): string
    {
        return 'case when coalesce(p.discounted_price,0) > 0 and p.discounted_price < p.price then p.discounted_price else p.price end';
    }

    /** Ürün temel sorgusu; $exclude = disjunctive sayım için hariç tutulacak facet anahtarı. */
    protected function baseQuery(array $category, array $filters, ?string $exclude = null): Builder
    {
        $q = DB::table('products as p')->where('p.tenant_id', $this->tenantId)->where('p.is_active', true);
        if ($this->rules['hide_out_of_stock']) {
            $q->where('p.stock_quantity', '>', 0);
        }
        if ($this->rules['require_image'] ?? false) {
            // Mağaza (Ticimax) kategori listesi görselsiz ürünü göstermez → sayılar mağazayla tutsun
            $q->whereNotNull('p.images')->whereRaw("jsonb_typeof(p.images::jsonb) = 'array' and jsonb_array_length(p.images::jsonb) > 0");
        }

        // Kategori: sayfanın kategori ağacı; seçili (alt) kategori varsa onunla KESİŞİR (alt kategoride kesişim = alt ağaç;
        // ağaç dışı seçimde — kampanya sayfasında kat=/unisex-cocuk — kampanya ∩ segment)
        $catIds = $category['ids'];
        if (! ($category['all'] ?? false)) {
            $q->whereExists(function ($s) use ($catIds) {
                $s->select(DB::raw('1'))->from('product_platform_categories as ppc')
                    ->whereColumn('ppc.product_id', 'p.id')->where('ppc.tenant_id', $this->tenantId)
                    ->whereIn('ppc.platform_category_id', $catIds ?: [-1]);
            });
        }
        if ($exclude !== 'category' && ! empty($filters['category'])) {
            $selIds = $this->descendantIds($this->categoryFilterIds((array) $filters['category']));
            $q->whereExists(function ($s) use ($selIds) {
                $s->select(DB::raw('1'))->from('product_platform_categories as ppcf')
                    ->whereColumn('ppcf.product_id', 'p.id')->where('ppcf.tenant_id', $this->tenantId)
                    ->whereIn('ppcf.platform_category_id', $selIds ?: [-1]);
            });
        }
        // Native kapsam (withNativeScope): ürün özelliği değer kümesinde olmalı (Ticimax td filtresiyle aynı küme)
        foreach ((array) ($category['scope']['specs'] ?? []) as $specKey => $vals) {
            if ($vals) {
                $q->whereIn(DB::raw('p.specifications->>'.DB::getPdo()->quote($specKey)), array_values($vals));
            }
        }
        // Kapsam kategorisi (withScope): ürün ayrıca bu ağaçta da olmalı
        if (! empty($category['scope']['ids'])) {
            $scopeIds = $category['scope']['ids'];
            $q->whereExists(function ($s) use ($scopeIds) {
                $s->select(DB::raw('1'))->from('product_platform_categories as ppcs')
                    ->whereColumn('ppcs.product_id', 'p.id')->where('ppcs.tenant_id', $this->tenantId)
                    ->whereIn('ppcs.platform_category_id', $scopeIds);
            });
        }

        // Fiyat
        if ($exclude !== 'price') {
            if (isset($filters['price_min']) && $filters['price_min'] !== null) {
                $q->whereRaw('('.$this->effPrice().') >= ?', [(float) $filters['price_min']]);
            }
            if (isset($filters['price_max']) && $filters['price_max'] !== null) {
                $q->whereRaw('('.$this->effPrice().') <= ?', [(float) $filters['price_max']]);
            }
        }

        // Renk + Beden — aynı varyantta birlikte
        $colors = $exclude === 'color' ? [] : array_values(array_filter((array) ($filters['color'] ?? [])));
        $sizes = $exclude === 'size' ? [] : array_values(array_filter((array) ($filters['size'] ?? [])));
        if ($colors || $sizes) {
            $q->whereExists(function ($s) use ($colors, $sizes) {
                $s->select(DB::raw('1'))->from('product_variants as v')->whereColumn('v.product_id', 'p.id')->where('v.is_active', true)
                    ->whereRaw("jsonb_typeof(v.attributes) = 'object'");
                if ($this->rules['size_in_stock_only'] || $this->rules['hide_out_of_stock']) {
                    $s->where('v.stock_quantity', '>', 0);
                }
                if ($colors) {
                    $s->whereIn(DB::raw("lower(split_part(v.attributes->>'Renk', ' ', 1))"), array_map(fn ($c) => mb_strtolower($c), $colors));
                }
                if ($sizes) {
                    $s->whereIn(DB::raw("v.attributes->>'Beden'"), $sizes);
                }
            });
        }

        if ($exclude !== 'brand' && ! empty($filters['brand'])) {
            $q->whereIn('p.brand', (array) $filters['brand']);
        }
        if ($exclude !== 'discount' && ! empty($filters['discount'])) {
            $q->where('p.discounted_price', '>', 0)->whereColumn('p.discounted_price', '<', 'p.price');
        }
        if ($exclude !== 'new' && ! empty($filters['new'])) {
            $q->where('p.platform_created_at', '>=', now()->subDays(30));
        }
        if ($exclude !== 'rating' && ! empty($filters['rating'])) {
            $q->where('p.trendyol_rating', '>=', (float) $filters['rating']);
        }
        foreach ((array) ($filters['spec'] ?? []) as $key => $vals) {
            if ($exclude === 'spec:'.$key) {
                continue;
            }
            $vals = array_values(array_filter((array) $vals));
            if ($vals) {
                $q->whereIn(DB::raw('p.specifications->>'.DB::getPdo()->quote($key)), $vals);
            }
        }

        return $q;
    }

    protected function descendantIds(array $platformIds): array
    {
        $paths = DB::table('platform_categories')->where('tenant_id', $this->tenantId)->whereIn('platform_category_id', $platformIds)->pluck('path')->all();
        $q = DB::table('platform_categories')->where('tenant_id', $this->tenantId)->where(function ($w) use ($platformIds, $paths) {
            $w->whereIn('platform_category_id', $platformIds);
            foreach ($paths as $p) {
                $w->orWhere('path', 'like', str_replace(['%', '_'], ['\%', '\_'], $p).' > %');
            }
        });

        return $q->pluck('platform_category_id')->map(fn ($v) => (int) $v)->all();
    }

    protected function applySort(Builder $q, string $sort, array $category = []): void
    {
        $eff = $this->effPrice();
        match ($sort) {
            'price_asc' => $q->orderByRaw("($eff) asc, p.id desc"),
            'price_desc' => $q->orderByRaw("($eff) desc, p.id desc"),
            'newest' => $q->orderByRaw('p.platform_created_at desc nulls last, p.id desc'),
            'bestseller' => $q->orderByRaw("coalesce((p.performance_score_breakdown->>'sales')::numeric, 0) desc, p.performance_score desc nulls last, p.id desc"),
            'rating' => $q->orderByRaw('p.trendyol_rating desc nulls last, p.performance_score desc nulls last, p.id desc'),
            'discount' => $q->orderByRaw("case when coalesce(p.discounted_price,0) > 0 and p.discounted_price < p.price then 1 - p.discounted_price / nullif(p.price,0) else 0 end desc, p.id desc"),
            default => $this->applyRecommendedSort($q, $category),
        };
    }

    /**
     * "Önerilen" = mağazanın vitrin sırası. Sayfanın kategorisine yazılmış Sira (gecelik Akıllı Kategori
     * Sıralaması → Ticimax; aynası product_platform_categories.sira) önce gelir; sırası olmayan (9999)
     * ürünler performance_score ile arkaya dizilir. 2026-09-27: daha önce yalnız performance_score
     * kullanılıyordu → widget takeover modunda beden kapsaması/stok derinliği cezası olmayan, tek
     * bedeni kalmış ürünler ilk sıralara çıkıyordu (Tonny Black Erkek/Kadın Spor Ayakkabı şikâyeti).
     */
    protected function applyRecommendedSort(Builder $q, array $category): void
    {
        $catId = (int) ($category['id'] ?? 0);
        $fallback = 'p.performance_score desc nulls last, p.platform_created_at desc nulls last, p.id desc';
        if ($catId > 0) {
            $q->orderByRaw(
                'coalesce((select min(ppcr.sira) from product_platform_categories ppcr'
                .' where ppcr.product_id = p.id and ppcr.tenant_id = ? and ppcr.platform_category_id = ? and ppcr.sira < 9999), 9999) asc, '.$fallback,
                [$this->tenantId, $catId]
            );

            return;
        }
        $q->orderByRaw($fallback);
    }

    // ───────────────────────── facet sayımları ─────────────────────────

    public function facets(array $category, array $filters): array
    {
        $enabled = array_values(array_filter(FacetCatalog::effective($this->tenantId, $this->settings['facets']), fn ($f) => $f['enabled']));
        $out = [];
        foreach ($enabled as $f) {
            $data = match ($f['type']) {
                'category' => $this->facetCategory($category, $filters),
                'price' => $this->facetPrice($category, $filters),
                'color' => $this->facetVariant($category, $filters, 'color'),
                'size' => $this->facetVariant($category, $filters, 'size'),
                'brand' => $this->facetColumn($category, $filters, 'brand', 'p.brand'),
                'flag' => $this->facetFlag($category, $filters, $f['key']),
                'rating' => $this->facetRating($category, $filters),
                'spec' => $this->facetColumn($category, $filters, $f['key'], 'p.specifications->>'.DB::getPdo()->quote(substr($f['key'], 5))),
                default => null,
            };
            if ($data === null) {
                continue;
            }
            // Boş facet'ler (tek seçenek bile yok) gizlenir; tek değerli spec facet'i anlamsız
            if (in_array($f['type'], ['brand', 'spec', 'category'], true) && count($data['values'] ?? []) < 2) {
                continue;
            }
            $out[] = ['key' => $f['key'], 'label' => $f['label'], 'type' => $f['type'], 'collapsed' => $f['collapsed']] + $data;
        }

        return $out;
    }

    protected function facetCategory(array $category, array $filters): ?array
    {
        if (empty($category['children'])) {
            return null;
        }
        $base = $this->baseQuery($category, $filters, 'category');
        $hidden = array_map('intval', (array) ($this->rules['hidden_categories'] ?? []));
        $values = [];
        foreach ($category['children'] as $child) {
            if ($hidden && in_array((int) $child['id'], $hidden, true)) {
                continue; // panelden gizlenen alt kategori
            }
            $ids = $this->descendantIds([$child['id']]);
            $cnt = (int) (clone $base)->whereExists(function ($s) use ($ids) {
                $s->select(DB::raw('1'))->from('product_platform_categories as c2')->whereColumn('c2.product_id', 'p.id')->where('c2.tenant_id', $this->tenantId)->whereIn('c2.platform_category_id', $ids);
            })->count();
            if ($cnt > 0) {
                $values[] = ['value' => (string) $child['id'], 'label' => $child['name'], 'count' => $cnt, 'url' => $child['url']];
            }
        }

        return ['values' => $values];
    }

    protected function facetPrice(array $category, array $filters): array
    {
        $eff = $this->effPrice();
        $r = $this->baseQuery($category, $filters, 'price')->selectRaw("min($eff) mn, max($eff) mx, count(*) c")->first();
        $mn = (float) ($r->mn ?? 0);
        $mx = (float) ($r->mx ?? 0);
        $buckets = [];
        if ($this->rules['price_buckets'] && $mx > $mn && ($r->c ?? 0) >= 8) {
            // 4 eşit-adetli dilim (quantile) → "en çok ürün buralarda" mantığı
            $qs = DB::table(DB::raw('('.$this->baseQuery($category, $filters, 'price')->selectRaw("($eff) as ep")->toSql().') t'))
                ->mergeBindings($this->baseQuery($category, $filters, 'price'))
                ->selectRaw('percentile_cont(0.25) within group (order by ep) q1, percentile_cont(0.5) within group (order by ep) q2, percentile_cont(0.75) within group (order by ep) q3')->first();
            $edges = array_unique(array_map(fn ($v) => (int) (round($v / 50) * 50), [$mn, (float) $qs->q1, (float) $qs->q2, (float) $qs->q3, $mx]));
            sort($edges);
            for ($i = 0; $i < count($edges) - 1; $i++) {
                $lo = $edges[$i];
                $hi = $edges[$i + 1];
                $cnt = (int) $this->baseQuery($category, $filters, 'price')->whereRaw("($eff) >= ? and ($eff) ".($i === count($edges) - 2 ? '<=' : '<').' ?', [$lo, $hi])->count();
                if ($cnt > 0) {
                    $buckets[] = ['min' => $lo, 'max' => $hi, 'count' => $cnt];
                }
            }
        }

        return ['min' => floor($mn), 'max' => ceil($mx), 'buckets' => $buckets, 'currency' => 'TL'];
    }

    protected function facetVariant(array $category, array $filters, string $which): array
    {
        $ids = $this->baseQuery($category, $filters, $which)->select('p.id');
        $expr = $which === 'color' ? "split_part(v.attributes->>'Renk', ' ', 1)" : "v.attributes->>'Beden'";
        $v = DB::table('product_variants as v')->whereIn('v.product_id', $ids)->where('v.is_active', true)
            ->whereRaw("jsonb_typeof(v.attributes) = 'object'")->whereRaw("coalesce($expr, '') <> ''");
        if ($this->rules['size_in_stock_only'] || $this->rules['hide_out_of_stock']) {
            $v->where('v.stock_quantity', '>', 0);
        }
        // Renk seçiliyken beden sayıları o renklerin varyantlarından (aynı varyant mantığı)
        if ($which === 'size' && ! empty($filters['color'])) {
            $v->whereIn(DB::raw("lower(split_part(v.attributes->>'Renk', ' ', 1))"), array_map(fn ($c) => mb_strtolower($c), (array) $filters['color']));
        }
        if ($which === 'color' && ! empty($filters['size'])) {
            $v->whereIn(DB::raw("v.attributes->>'Beden'"), (array) $filters['size']);
        }
        $rows = $v->selectRaw("$expr as val, count(distinct v.product_id) as c")->groupBy('val')->get();

        $values = [];
        foreach ($rows as $r) {
            $val = (string) $r->val;
            $item = ['value' => $val, 'label' => $val, 'count' => (int) $r->c];
            if ($which === 'color') {
                $item['hex'] = self::COLOR_HEX[mb_strtolower($val)] ?? null;
            }
            $values[] = $item;
        }
        if ($which === 'size') {
            $values = $this->limitSizesToSegment($values, $category);
            usort($values, fn ($a, $b) => $this->sizeOrder($a['value']) <=> $this->sizeOrder($b['value']));
        } else {
            usort($values, fn ($a, $b) => $b['count'] <=> $a['count']);
        }

        return ['values' => $values];
    }

    /**
     * Segment beden aralığı (rules.size_ranges): kategori yolundaki kelimeye göre (cocuk/kadin/erkek…) sayısal
     * bedenleri [min,max] dışındaysa facet'ten düşürür. Aralık eşleşmezse (unisex, aksesuar) liste olduğu gibi kalır.
     */
    protected function limitSizesToSegment(array $values, array $category): array
    {
        $range = $this->sizeRangeFor($category);
        if (! $range) {
            return $values;
        }

        return array_values(array_filter($values, function ($v) use ($range) {
            $s = trim((string) $v['value']);
            if (! preg_match('/^\d+([.,]\d+)?$/', $s)) {
                return true; // harf bedenler / yaş grupları dokunulmaz
            }
            $n = (float) str_replace(',', '.', $s);

            return $n >= $range['min'] && $n <= $range['max'];
        }));
    }

    public function sizeRangeFor(array $category): ?array
    {
        $ranges = $this->rules['size_ranges'] ?? [];
        if (! is_array($ranges) || ! $ranges) {
            return null;
        }
        foreach (['scope', 'size_scope'] as $sk) {
            // Kapsam / ağaç dışı seçili kategori beden aralığını belirler: "Sepette %50" + Çocuk → çocuk numaraları
            if (! empty($category[$sk]) && is_array($category[$sk])) {
                $fromScope = $this->sizeRangeFor($category[$sk]);
                if ($fromScope) {
                    return $fromScope;
                }
            }
        }
        $hay = mb_strtolower(($category['path'] ?? '').' '.($category['url'] ?? '').' '.($category['name'] ?? ''));
        $hay = str_replace(['ç', 'ğ', 'ı', 'ö', 'ş', 'ü', 'â', 'î', 'û'], ['c', 'g', 'i', 'o', 's', 'u', 'a', 'i', 'u'], $hay);
        $tokens = preg_split('/[^a-z0-9]+/', $hay, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($ranges as $r) {
            if (! is_array($r)) {
                continue;
            }
            $min = (float) ($r['min'] ?? 0);
            $max = (float) ($r['max'] ?? 0);
            if ($max <= 0 || $max < $min) {
                continue;
            }
            $words = array_values(array_filter(array_map('trim', explode(',', mb_strtolower((string) ($r['tokens'] ?? ''))))));
            foreach ($words as $w) {
                if (in_array($w, $tokens, true)) {
                    return ['key' => (string) ($r['key'] ?? $w), 'label' => (string) ($r['label'] ?? $w), 'min' => $min, 'max' => $max];
                }
            }
        }

        return null;
    }

    protected function sizeOrder(string $s): array
    {
        $order = ['XXS' => 1, 'XS' => 2, 'S' => 3, 'M' => 4, 'L' => 5, 'XL' => 6, '2XL' => 7, 'XXL' => 7, '3XL' => 8, 'XXXL' => 8, '4XL' => 9];
        if (is_numeric($s)) {
            return [0, (float) $s, $s];
        }
        if (preg_match('/^(\d+)/', $s, $m)) {
            return [0, (float) $m[1], $s];
        }
        if (isset($order[strtoupper($s)])) {
            return [1, $order[strtoupper($s)], $s];
        }

        return [2, 0, $s];
    }

    protected function facetColumn(array $category, array $filters, string $key, string $expr): array
    {
        $rows = $this->baseQuery($category, $filters, $key)->selectRaw("$expr as val, count(*) as c")
            ->whereRaw("coalesce($expr, '') <> ''")->groupBy('val')->orderByDesc('c')->limit(60)->get();

        return ['values' => array_map(fn ($r) => ['value' => (string) $r->val, 'label' => (string) $r->val, 'count' => (int) $r->c], $rows->all())];
    }

    protected function facetFlag(array $category, array $filters, string $key): ?array
    {
        $q = $this->baseQuery($category, $filters, $key);
        $cnt = $key === 'discount'
            ? (int) $q->where('p.discounted_price', '>', 0)->whereColumn('p.discounted_price', '<', 'p.price')->count()
            : (int) $q->where('p.platform_created_at', '>=', now()->subDays(30))->count();
        if ($cnt === 0) {
            return null;
        }

        return ['values' => [['value' => '1', 'label' => $key === 'discount' ? 'İndirimli ürünler' : 'Son 30 günde eklenen', 'count' => $cnt]]];
    }

    protected function facetRating(array $category, array $filters): ?array
    {
        $rows = $this->baseQuery($category, $filters, 'rating')->whereNotNull('p.trendyol_rating')
            ->selectRaw('count(*) filter (where p.trendyol_rating >= 4.5) r45, count(*) filter (where p.trendyol_rating >= 4) r4, count(*) filter (where p.trendyol_rating >= 3) r3')->first();
        if (! $rows || (int) $rows->r3 === 0) {
            return null;
        }
        $values = [];
        foreach ([['4.5', '4,5 ve üzeri', (int) $rows->r45], ['4', '4 ve üzeri', (int) $rows->r4], ['3', '3 ve üzeri', (int) $rows->r3]] as [$v, $l, $c]) {
            if ($c > 0) {
                $values[] = ['value' => $v, 'label' => $l, 'count' => $c];
            }
        }

        return ['values' => $values];
    }

    protected function appliedChips(array $filters, array $facets): array
    {
        $labelOf = [];
        foreach ($facets as $f) {
            $labelOf[$f['key']] = $f['label'];
        }
        $chips = [];
        foreach (['color', 'size', 'brand'] as $k) {
            foreach ((array) ($filters[$k] ?? []) as $v) {
                $chips[] = ['facet' => $k, 'value' => (string) $v, 'label' => (string) $v];
            }
        }
        foreach ((array) ($filters['category_raw'] ?? $filters['category'] ?? []) as $v) {
            $ids = $this->categoryFilterIds([$v]);
            $name = $ids ? DB::table('platform_categories')->where('tenant_id', $this->tenantId)->where('platform_category_id', $ids[0])->value('name') : null;
            $chips[] = ['facet' => 'category', 'value' => (string) $v, 'label' => $name ?: (string) $v];
        }
        if (isset($filters['price_min']) || isset($filters['price_max'])) {
            $chips[] = ['facet' => 'price', 'value' => '1', 'label' => ($filters['price_min'] ?? '0').' – '.($filters['price_max'] ?? '∞').' TL'];
        }
        if (! empty($filters['discount'])) {
            $chips[] = ['facet' => 'discount', 'value' => '1', 'label' => 'İndirimli'];
        }
        if (! empty($filters['new'])) {
            $chips[] = ['facet' => 'new', 'value' => '1', 'label' => 'Yeni gelenler'];
        }
        if (! empty($filters['rating'])) {
            $chips[] = ['facet' => 'rating', 'value' => (string) $filters['rating'], 'label' => $filters['rating'].'+ puan'];
        }
        foreach ((array) ($filters['spec'] ?? []) as $key => $vals) {
            foreach ((array) $vals as $v) {
                $chips[] = ['facet' => 'spec:'.$key, 'value' => (string) $v, 'label' => ($labelOf['spec:'.$key] ?? $key).': '.$v];
            }
        }

        return $chips;
    }

    // ───────────────────────── sunum ─────────────────────────

    protected function present(array $rows, array $filters): array
    {
        if (! $rows) {
            return [];
        }
        $ids = array_map(fn ($r) => (int) $r->id, $rows);
        $stockCond = ($this->rules['size_in_stock_only'] || $this->rules['hide_out_of_stock']) ? 'and v.stock_quantity > 0' : '';
        $variants = DB::table('product_variants as v')->whereIn('v.product_id', $ids)->where('v.is_active', true)
            ->whereRaw("jsonb_typeof(v.attributes) = 'object' $stockCond")
            ->selectRaw("v.product_id, split_part(v.attributes->>'Renk', ' ', 1) as color, v.attributes->>'Beden' as size")
            ->get();
        $colorsBy = [];
        $sizesBy = [];
        foreach ($variants as $v) {
            if ($v->color !== null && $v->color !== '') {
                $colorsBy[$v->product_id][$v->color] = true;
            }
            if ($v->size !== null && $v->size !== '') {
                $sizesBy[$v->product_id][$v->size] = true;
            }
        }
        $base = rtrim((string) (($this->tenant->settings ?? [])['shop_url'] ?? ''), '/');

        $out = [];
        foreach ($rows as $r) {
            $images = is_string($r->images) ? (json_decode($r->images, true) ?: []) : (array) $r->images;
            $images = array_values(array_filter(array_map(fn ($i) => is_array($i) ? ($i['url'] ?? $i['src'] ?? null) : $i, $images), 'is_string'));
            $price = (float) $r->price;
            $disc = (float) ($r->discounted_price ?? 0);
            $hasDisc = $disc > 0 && $disc < $price;
            $url = (string) $r->url;
            if ($url !== '' && $base !== '' && ! preg_match('~^https?://~', $url)) {
                $url = $base.'/'.ltrim($url, '/');
            }
            $colors = array_keys($colorsBy[$r->id] ?? []);
            $sizes = array_keys($sizesBy[$r->id] ?? []);
            usort($sizes, fn ($a, $b) => $this->sizeOrder($a) <=> $this->sizeOrder($b));
            $out[] = [
                'id' => (int) $r->id,
                'name' => $r->name,
                'brand' => $r->brand,
                'url' => $url,
                'image' => $images[0] ?? null,
                'images' => array_slice($images, 0, 4),
                'price' => $price,
                'discounted_price' => $hasDisc ? $disc : null,
                'discount_pct' => $hasDisc && $price > 0 ? (int) round((1 - $disc / $price) * 100) : null,
                'rating' => $r->trendyol_rating !== null ? round((float) $r->trendyol_rating, 1) : null,
                'is_new' => $r->platform_created_at && strtotime($r->platform_created_at) >= strtotime('-30 days'),
                'colors' => array_map(fn ($c) => ['name' => $c, 'hex' => self::COLOR_HEX[mb_strtolower($c)] ?? null], array_slice($colors, 0, 6)),
                'color_count' => count($colors),
                'sizes' => $sizes,
                'in_stock' => (int) $r->stock_quantity > 0,
            ];
        }

        return $out;
    }
}
