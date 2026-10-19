<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\Builder;

/**
 * Site (Ticimax) fiyati ile Trendyol alici-fiyatinin kiyaslamasi.
 *
 * Site fiyati = COALESCE(discounted_price, price). Trendyol fiyati Apify
 * (maximedupre) taramasindan gelir (products.trendyol_price).
 * "fark" = site - trendyol; pozitifse Trendyol daha ucuz demektir.
 */
class PriceComparisonController extends Controller
{
    /**
     * Kiyaslanabilir urunlerin listesi (sayfali).
     */
    public function index(Request $request): JsonResponse
    {
        $siteExpr = 'COALESCE(products.discounted_price, products.price)';
        $diffExpr = "({$siteExpr} - products.trendyol_price)";

        $query = $this->baseQuery()
            ->selectRaw("products.id, products.name, products.brand, products.sku, products.images, products.url,
                products.price, products.discounted_price, products.currency,
                products.trendyol_price, products.trendyol_original_price, products.trendyol_in_stock,
                products.trendyol_rating, products.trendyol_product_url, products.trendyol_price_synced_at,
                {$siteExpr} AS site_price,
                {$diffExpr} AS price_diff,
                CASE WHEN {$siteExpr} > 0 THEN round(({$diffExpr} / {$siteExpr} * 100)::numeric, 1) ELSE NULL END AS price_diff_pct");

        // Sadece Trendyol'da siteden ucuz olanlar
        if ($request->boolean('cheaper_on_trendyol')) {
            $query->whereRaw("{$diffExpr} > 0");
        }

        // Sadece stokta olanlar (opsiyonel)
        if ($request->boolean('in_stock_only')) {
            $query->where('products.trendyol_in_stock', true);
        }

        if ($request->filled('search')) {
            $search = str_replace(['%', '_'], ['\%', '\_'], $request->search);
            $query->where(function ($q) use ($search) {
                $q->where('products.name', 'ilike', "%{$search}%")
                  ->orWhere('products.sku', 'ilike', "%{$search}%")
                  ->orWhere('products.barcode', $request->search);
            });
        }

        // Siralama: varsayilan en buyuk fark (Trendyol'da en ucuz) once
        $sort = $request->sort_by === 'diff_pct' ? 'price_diff_pct' : 'price_diff';
        $dir = $request->sort_dir === 'asc' ? 'asc' : 'desc';
        $query->orderByRaw("{$sort} {$dir} NULLS LAST");

        $perPage = min((int) ($request->per_page ?? 25), 100);

        return response()->json($query->paginate($perPage));
    }

    /**
     * Ozet istatistikler.
     */
    public function stats(Request $request): JsonResponse
    {
        $siteExpr = 'COALESCE(discounted_price, price)';
        $diffExpr = "({$siteExpr} - trendyol_price)";

        $row = $this->baseQuery()
            ->selectRaw("
                count(*) AS total_compared,
                count(*) FILTER (WHERE {$diffExpr} > 0) AS cheaper_on_trendyol,
                count(*) FILTER (WHERE {$diffExpr} < 0) AS cheaper_on_site,
                count(*) FILTER (WHERE {$diffExpr} = 0) AS equal_price,
                max({$diffExpr}) AS max_gap,
                max(trendyol_price_synced_at) AS last_synced_at
            ")
            ->first();

        return response()->json([
            'total_compared' => (int) ($row->total_compared ?? 0),
            'cheaper_on_trendyol' => (int) ($row->cheaper_on_trendyol ?? 0),
            'cheaper_on_site' => (int) ($row->cheaper_on_site ?? 0),
            'equal_price' => (int) ($row->equal_price ?? 0),
            'max_gap' => $row->max_gap !== null ? (float) $row->max_gap : null,
            'last_synced_at' => $row->last_synced_at,
        ]);
    }

    /**
     * Kiyaslanabilir urunler: her iki fiyat da dolu, tenant'a gore filtreli.
     */
    protected function baseQuery(): Builder
    {
        $query = Product::query()
            ->whereNotNull('trendyol_price')
            ->where(function ($q) {
                $q->whereNotNull('price')->orWhereNotNull('discounted_price');
            });

        // Product tenant-scoped degil; BelongsToTenant ile ayni mantikta filtrele.
        if ($tenantId = $this->resolveTenantId()) {
            $query->where('products.tenant_id', $tenantId);
        }

        return $query;
    }

    protected function resolveTenantId(): ?int
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return (int) $user->tenant_id;
        }
        if (request()->hasHeader('X-Tenant-Id')) {
            return (int) request()->header('X-Tenant-Id');
        }
        return null;
    }
}
