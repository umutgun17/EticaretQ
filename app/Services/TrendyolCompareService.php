<?php

namespace App\Services;

use App\Models\Channel;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Site (Ticimax) katalogu ile Trendyol katalogunun (trendyol_products, Seller API)
 * urun bazli kiyasi. Iki fiyat kaynagi vardir:
 *  - seller_price : Seller API salePrice (saticinin girdigi fiyat, kampanya ONCESI)
 *  - buyer_price  : Apify vitrin taramasi products.trendyol_price (kampanya/indirim dahil,
 *                   musterinin gordugu son fiyat). Kiyasta ONCELIKLI kaynak budur.
 * trendyol_price_effective = COALESCE(buyer_price, seller_price)
 */
class TrendyolCompareService
{
    public const VIEWS = [
        'all', 'cheaper_on_trendyol', 'cheaper_on_site', 'missing_on_site', 'missing_on_trendyol',
        'fewer_images_on_site', 'fewer_images_on_trendyol', 'stock_diff', 'variant_diff', 'content_diff', 'campaign',
        'match_conflict',
    ];

    /** Vitrin (Apify) fiyati bu kadar gunden eskiyse guvenilmez sayilir, satici fiyatina dusulur. */
    public const BUYER_PRICE_MAX_AGE_DAYS = 7;

    protected ?string $siteBase = null;

    public function __construct(protected int $tenantId)
    {
        $t = DB::table('tenants')->where('id', $tenantId)->value('settings');
        $st = is_string($t) ? (json_decode($t, true) ?: []) : (array) $t;
        $base = $st['storefront_url'] ?? $st['shop_url'] ?? null;
        $this->siteBase = $base ? rtrim((string) $base, '/') : null;
    }

    /** Site urun linki mutlak: products.url goreli ("/slug-123") ise tenant storefront_url ile birlestirilir. */
    protected function siteUrlExpr(string $alias = 'p'): string
    {
        if (! $this->siteBase) {
            return "{$alias}.url";
        }
        $base = DB::getPdo()->quote($this->siteBase);

        return "CASE WHEN {$alias}.url IS NULL OR {$alias}.url = '' THEN NULL WHEN {$alias}.url LIKE 'http%' THEN {$alias}.url WHEN {$alias}.url LIKE '/%' THEN {$base} || {$alias}.url ELSE {$base} || '/' || {$alias}.url END";
    }

    protected function buyerFresh(): string
    {
        return "(p.trendyol_price IS NOT NULL AND p.trendyol_price_synced_at > now() - interval '" . self::BUYER_PRICE_MAX_AGE_DAYS . " days')";
    }

    protected function tyEffExpr(): string
    {
        return 'CASE WHEN ' . $this->buyerFresh() . ' THEN p.trendyol_price ELSE ty.ty_seller_price END';
    }

    /** Trendyol tarafinin urun bazli ozeti (product_id'ye gore gruplu). */
    protected function tyAgg(): Builder
    {
        return DB::table('trendyol_products')
            ->where('tenant_id', $this->tenantId)
            ->where('is_missing', false)
            ->whereNotNull('product_id')
            ->groupBy('product_id')
            ->selectRaw("
                product_id,
                count(*)                                             AS ty_variant_count,
                count(*) FILTER (WHERE quantity > 0)                 AS ty_in_stock_variants,
                coalesce(sum(quantity),0)                            AS ty_quantity,
                coalesce(min(sale_price) FILTER (WHERE sale_price > 0 AND quantity > 0),
                         min(sale_price) FILTER (WHERE sale_price > 0)) AS ty_seller_price,
                max(sale_price)                                      AS ty_seller_price_max,
                coalesce(min(list_price) FILTER (WHERE list_price > 0 AND quantity > 0),
                         min(list_price) FILTER (WHERE list_price > 0)) AS ty_list_price,
                count(*) FILTER (WHERE sale_price <= 0 OR sale_price IS NULL) AS ty_zero_price_variants,
                max(image_count)                                     AS ty_image_count,
                bool_or(coalesce(has_active_campaign,false))         AS ty_campaign,
                bool_or(coalesce(on_sale,false))                     AS ty_on_sale,
                bool_or(coalesce(approved,false))                    AS ty_approved,
                bool_or(coalesce(archived,false))                    AS ty_archived,
                min(product_content_id)                              AS ty_content_id,
                min(title)                                           AS ty_title,
                min(product_url)                                     AS ty_url,
                min(product_main_id)                                 AS ty_main_id,
                max(description_length)                              AS ty_description_length,
                max(platform_updated_at)                             AS ty_updated_at,
                max(last_seen_at)                                    AS ty_seen_at,
                count(*) FILTER (WHERE product_variant_id IS NULL)   AS ty_unmatched_variants,
                count(*) FILTER (WHERE match_type = 'stock_code')    AS ty_stock_verified,
                count(*) FILTER (WHERE match_conflict)               AS ty_conflicts,
                min(stock_code)                                      AS ty_stock_code
            ");
    }

    /** Site tarafinin urun bazli ozeti (varyant sayilari dahil). */
    protected function siteAgg(): Builder
    {
        return DB::table('product_variants')
            ->where('tenant_id', $this->tenantId)
            ->groupBy('product_id')
            ->selectRaw('product_id, count(*) AS site_variant_count, count(*) FILTER (WHERE stock_quantity > 0) AS site_in_stock_variants');
    }

    /**
     * Eslesmis urunler icin ana sorgu. Donen sutunlar: p.* (secili) + ty_* + site_* + turetilmis farklar.
     */
    public function matchedQuery(): Builder
    {
        $site = 'coalesce(p.discounted_price, p.price)';
        $tyEff = $this->tyEffExpr();
        $siteImgs = "coalesce(jsonb_array_length(coalesce(p.images,'[]'::jsonb)),0)";

        return DB::query()
            ->fromSub($this->tyAgg(), 'ty')
            ->join('products as p', 'p.id', '=', 'ty.product_id')
            ->leftJoinSub($this->siteAgg(), 'sv', 'sv.product_id', '=', 'p.id')
            ->where('p.tenant_id', $this->tenantId)
            ->selectRaw("
                p.id, p.name, p.sku, p.barcode, p.brand, p.category, p.url, p.images, p.is_active, p.currency,
                ({$this->siteUrlExpr()}) AS site_url,
                p.price, p.discounted_price, p.stock_quantity AS site_stock,
                {$site} AS site_price,
                {$siteImgs} AS site_image_count,
                length(coalesce(p.description,'')) AS site_description_length,
                coalesce(sv.site_variant_count,0) AS site_variant_count,
                coalesce(sv.site_in_stock_variants,0) AS site_in_stock_variants,
                p.trendyol_price AS ty_buyer_price, p.trendyol_original_price AS ty_buyer_original_price,
                p.trendyol_promotions AS ty_promotions, p.trendyol_discount_percent AS ty_discount_percent,
                p.trendyol_price_synced_at AS ty_buyer_price_at, p.trendyol_rating AS ty_rating,
                ty.*,
                ({$tyEff}) AS ty_price,
                CASE WHEN {$this->buyerFresh()} THEN 'buyer' ELSE 'seller' END AS ty_price_source,
                ({$site} - ({$tyEff})) AS price_diff,
                CASE WHEN {$site} > 0 THEN round((({$site} - ({$tyEff})) / {$site} * 100)::numeric, 1) END AS price_diff_pct,
                (ty.ty_image_count - {$siteImgs}) AS image_diff,
                (ty.ty_variant_count - coalesce(sv.site_variant_count,0)) AS variant_diff,
                (lower(trim(p.name)) <> lower(trim(coalesce(ty.ty_title,'')))) AS title_differs
            ");
    }

    /** Verilen goruntuye gore filtre uygular. */
    public function applyView(Builder $q, string $view): Builder
    {
        $site = 'coalesce(p.discounted_price, p.price)';
        $tyEff = $this->tyEffExpr();
        $siteImgs = "coalesce(jsonb_array_length(coalesce(p.images,'[]'::jsonb)),0)";

        return match ($view) {
            'cheaper_on_trendyol' => $q->whereRaw("({$tyEff}) IS NOT NULL AND {$site} IS NOT NULL AND ({$tyEff}) < {$site}"),
            'cheaper_on_site' => $q->whereRaw("({$tyEff}) IS NOT NULL AND {$site} IS NOT NULL AND ({$tyEff}) > {$site}"),
            'fewer_images_on_site' => $q->whereRaw("ty.ty_image_count > {$siteImgs}"),
            'fewer_images_on_trendyol' => $q->whereRaw("ty.ty_image_count < {$siteImgs}"),
            'stock_diff' => $q->whereRaw('((coalesce(p.stock_quantity,0) <= 0 AND ty.ty_quantity > 0) OR (coalesce(p.stock_quantity,0) > 0 AND ty.ty_quantity <= 0))'),
            'variant_diff' => $q->whereRaw('(ty.ty_variant_count <> coalesce(sv.site_variant_count,0) OR ty.ty_unmatched_variants > 0)'),
            'content_diff' => $q->whereRaw("(lower(trim(p.name)) <> lower(trim(coalesce(ty.ty_title,''))) OR ty.ty_description_length > length(coalesce(p.description,'')) * 1.5 + 50 OR length(coalesce(p.description,'')) > ty.ty_description_length * 1.5 + 50)"),
            'campaign' => $q->where('ty.ty_campaign', true),
            default => $q,
        };
    }

    public function applySearch(Builder $q, ?string $search): Builder
    {
        if (! $search) {
            return $q;
        }
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';

        return $q->where(function ($w) use ($like, $search) {
            $w->where('p.name', 'ilike', $like)
              ->orWhere('p.sku', 'ilike', $like)
              ->orWhere('ty.ty_title', 'ilike', $like)
              ->orWhere('ty.ty_main_id', 'ilike', $like)
              ->orWhere('p.barcode', $search);
        });
    }

    /** Trendyol'da olup sitede eslesmeyen kayitlar — model (productMainId+renk) bazli gruplanmis. */
    public function missingOnSiteQuery(): Builder
    {
        return DB::table('trendyol_products')
            ->where('tenant_id', $this->tenantId)
            ->where('is_missing', false)
            ->whereNull('product_id')
            ->groupBy(DB::raw("coalesce(product_main_id, barcode), coalesce(color,'')"))
            ->selectRaw("
                coalesce(product_main_id, barcode) AS ty_main_id,
                coalesce(color,'') AS ty_color,
                min(title) AS ty_title, min(brand) AS ty_brand, min(category_name) AS ty_category,
                count(*) AS ty_variant_count, coalesce(sum(quantity),0) AS ty_quantity,
                coalesce(min(sale_price) FILTER (WHERE sale_price > 0 AND quantity > 0), min(sale_price) FILTER (WHERE sale_price > 0)) AS ty_seller_price,
                coalesce(min(list_price) FILTER (WHERE list_price > 0 AND quantity > 0), min(list_price) FILTER (WHERE list_price > 0)) AS ty_list_price,
                max(image_count) AS ty_image_count,
                (array_agg(images ORDER BY image_count DESC))[1] AS images,
                min(product_url) AS ty_url, min(product_content_id) AS ty_content_id,
                bool_or(coalesce(approved,false)) AS ty_approved, bool_or(coalesce(on_sale,false)) AS ty_on_sale,
                bool_or(coalesce(has_active_campaign,false)) AS ty_campaign,
                string_agg(DISTINCT coalesce(size,''), ', ' ORDER BY coalesce(size,'')) AS ty_sizes,
                string_agg(DISTINCT barcode, ', ') AS ty_barcodes,
                min(stock_code) AS ty_stock_code,
                max(platform_updated_at) AS ty_updated_at
            ");
    }

    /** Sitede aktif olup Trendyol katalogunda hic eslesmesi olmayan urunler. */
    public function missingOnTrendyolQuery(): Builder
    {
        $site = 'coalesce(p.discounted_price, p.price)';
        $siteImgs = "coalesce(jsonb_array_length(coalesce(p.images,'[]'::jsonb)),0)";

        return DB::table('products as p')
            ->where('p.tenant_id', $this->tenantId)
            ->where('p.is_active', true)
            ->whereNotExists(function ($s) {
                $s->selectRaw('1')->from('trendyol_products as tp')
                  ->whereColumn('tp.product_id', 'p.id')
                  ->where('tp.tenant_id', $this->tenantId)
                  ->where('tp.is_missing', false);
            })
            ->leftJoinSub($this->siteAgg(), 'sv', 'sv.product_id', '=', 'p.id')
            ->selectRaw("
                p.id, p.name, p.sku, p.barcode, p.brand, p.category, p.url, p.images, p.currency,
                ({$this->siteUrlExpr()}) AS site_url, p.trendyol_product_url AS ty_url,
                p.price, p.discounted_price, {$site} AS site_price, p.stock_quantity AS site_stock,
                {$siteImgs} AS site_image_count,
                coalesce(sv.site_variant_count,0) AS site_variant_count,
                coalesce(sv.site_in_stock_variants,0) AS site_in_stock_variants,
                p.specifications->>'Trendyol' AS site_trendyol_flag,
                p.platform_created_at
            ");
    }

    /**
     * Stok kodunun (MODEL_RENK) isaret ettigi site urunu ile barkodun isaret ettigi site urunu FARKLI olan
     * Trendyol kayitlari — elle kontrol icin her iki urune de link verilir. (stok kodu urunu, barkod urunu) bazinda gruplu.
     */
    public function matchConflictQuery(): Builder
    {
        $spUrl = $this->siteUrlExpr('sp');
        $bpUrl = $this->siteUrlExpr('bp');

        return DB::table('trendyol_products as t')
            ->join('products as sp', 'sp.id', '=', 't.product_id')
            ->join('products as bp', 'bp.id', '=', 't.barcode_product_id')
            ->where('t.tenant_id', $this->tenantId)
            ->where('t.is_missing', false)
            ->where('t.match_conflict', true)
            ->groupBy('t.product_id', 't.barcode_product_id', 'sp.name', 'sp.sku', 'sp.url', 'sp.images', 'sp.price', 'sp.discounted_price', 'sp.stock_quantity', 'sp.currency',
                'bp.name', 'bp.sku', 'bp.url', 'bp.images', 'bp.price', 'bp.discounted_price', 'bp.stock_quantity')
            ->selectRaw("
                t.product_id AS id, t.barcode_product_id,
                count(*) AS ty_variant_count, coalesce(sum(t.quantity),0) AS ty_quantity,
                min(t.title) AS ty_title, min(t.product_url) AS ty_url, min(t.product_main_id) AS ty_main_id,
                string_agg(DISTINCT t.stock_code, ', ' ORDER BY t.stock_code) AS ty_stock_codes,
                string_agg(DISTINCT t.barcode, ', ') AS ty_barcodes,
                (array_agg(t.images ORDER BY t.image_count DESC))[1] AS ty_images,
                coalesce(min(t.sale_price) FILTER (WHERE t.sale_price > 0), 0) AS ty_seller_price,
                sp.name, sp.sku, sp.images, sp.currency, ({$spUrl}) AS site_url,
                coalesce(sp.discounted_price, sp.price) AS site_price, sp.stock_quantity AS site_stock,
                bp.name AS barcode_name, bp.sku AS barcode_sku, bp.images AS barcode_images, ({$bpUrl}) AS barcode_site_url,
                coalesce(bp.discounted_price, bp.price) AS barcode_site_price, bp.stock_quantity AS barcode_site_stock
            ");
    }

    public function stats(): array
    {
        $base = fn () => $this->matchedQuery();
        $counts = [];
        foreach (['all', 'cheaper_on_trendyol', 'cheaper_on_site', 'fewer_images_on_site', 'fewer_images_on_trendyol', 'stock_diff', 'variant_diff', 'content_diff', 'campaign'] as $v) {
            $counts[$v] = (int) DB::query()->fromSub($this->applyView($base(), $v), 'x')->count();
        }
        // Sayaclar panelin varsayilan listesiyle (yalniz stoklu) tutarli; toplamlar ayrica verilir
        $counts['missing_on_site'] = (int) DB::query()->fromSub($this->missingOnSiteQuery()->havingRaw('coalesce(sum(quantity),0) > 0'), 'x')->count();
        $counts['missing_on_site_total'] = (int) DB::query()->fromSub($this->missingOnSiteQuery(), 'x')->count();
        $counts['missing_on_trendyol'] = (int) DB::query()->fromSub($this->missingOnTrendyolQuery()->where('p.stock_quantity', '>', 0), 'x')->count();
        $counts['missing_on_trendyol_total'] = (int) DB::query()->fromSub($this->missingOnTrendyolQuery(), 'x')->count();
        $counts['match_conflict'] = (int) DB::query()->fromSub($this->matchConflictQuery(), 'x')->count();

        $ty = DB::table('trendyol_products')->where('tenant_id', $this->tenantId)->where('is_missing', false)
            ->selectRaw("count(*) AS rows, count(*) FILTER (WHERE product_id IS NOT NULL) AS matched, count(*) FILTER (WHERE match_type = 'stock_code') AS stock_verified, count(*) FILTER (WHERE match_conflict) AS conflicts, max(last_seen_at) AS seen")->first();

        $buyer = DB::table('products')->where('tenant_id', $this->tenantId)
            ->selectRaw("count(*) FILTER (WHERE trendyol_price IS NOT NULL AND trendyol_price_synced_at > now() - interval '" . self::BUYER_PRICE_MAX_AGE_DAYS . " days') AS with_buyer_price, max(trendyol_price_synced_at) AS buyer_price_at")->first();

        $gap = DB::query()->fromSub($this->applyView($base(), 'cheaper_on_trendyol'), 'x')
            ->selectRaw('max(price_diff) AS max_gap, sum(price_diff) AS total_gap, avg(price_diff_pct) AS avg_pct')->first();

        $channel = Channel::withoutGlobalScopes()->where('tenant_id', $this->tenantId)->where('type', 'trendyol-product')->first();
        $settings = $channel?->settings ?? [];
        if (is_string($settings)) {
            $settings = json_decode($settings, true) ?? [];
        }

        return [
            'counts' => $counts,
            'ty_rows' => (int) ($ty->rows ?? 0),
            'ty_matched_rows' => (int) ($ty->matched ?? 0),
            'ty_stock_verified_rows' => (int) ($ty->stock_verified ?? 0),
            'ty_conflict_rows' => (int) ($ty->conflicts ?? 0),
            'site_base_url' => $this->siteBase,
            'catalog_synced_at' => $settings['catalog_synced_at'] ?? ($ty->seen ?? null),
            'catalog_sync_error' => $settings['catalog_sync_error'] ?? null,
            'catalog_sync_running' => (bool) ($settings['catalog_sync_running'] ?? false),
            'buyer_price_products' => (int) ($buyer->with_buyer_price ?? 0),
            'buyer_price_at' => $buyer->buyer_price_at ?? null,
            'max_gap' => $gap?->max_gap !== null ? (float) $gap->max_gap : null,
            'total_gap' => $gap?->total_gap !== null ? (float) $gap->total_gap : null,
            'avg_gap_pct' => $gap?->avg_pct !== null ? round((float) $gap->avg_pct, 1) : null,
            'has_channel' => (bool) $channel,
            'channel_id' => $channel?->id,
        ];
    }
}
