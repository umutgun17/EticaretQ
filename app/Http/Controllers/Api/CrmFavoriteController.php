<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductFavorite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CrmFavoriteController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $mode = $request->get('mode', 'grouped');
        $perPage = min((int) ($request->per_page ?? 30), 100);

        if ($mode === 'detailed') {
            return $this->indexDetailed($request, $perPage);
        }

        return $this->indexGrouped($request, $perPage);
    }

    protected function indexGrouped(Request $request, int $perPage): JsonResponse
    {
        $query = ProductFavorite::query()
            ->select([
                'platform_product_id',
                DB::raw("MAX(product_name) as product_name"),
                DB::raw("MAX(product_sku) as product_sku"),
                DB::raw("MAX(product_image) as product_image"),
                DB::raw("MAX(product_url) as product_url"),
                DB::raw("MAX(stock_quantity) as stock_quantity"),
                DB::raw("MAX(product_id) as product_id"),
                DB::raw("COUNT(*) as favorite_count"),
                DB::raw("MAX(favorited_at) as last_favorited_at"),
            ])
            ->groupBy('platform_product_id');

        $this->applyFilters($query, $request, true);

        // Sorting
        $allowedSorts = ['favorite_count', 'product_name', 'stock_quantity', 'last_favorited_at'];
        $sortBy = in_array($request->sort_by, $allowedSorts) ? $request->sort_by : 'favorite_count';
        $sortDir = $request->sort_dir === 'asc' ? 'asc' : 'desc';
        $query->orderByRaw("{$sortBy} {$sortDir} NULLS LAST");

        $paginated = $query->paginate($perPage);

        // Enrich with product main stock (sum of all variants)
        $productIds = collect($paginated->items())->pluck('product_id')->filter()->unique()->values()->all();
        if (! empty($productIds)) {
            $productStocks = Product::withoutGlobalScopes()
                ->whereIn('id', $productIds)
                ->pluck('stock_quantity', 'id')
                ->toArray();

            $paginated->getCollection()->transform(function ($item) use ($productStocks) {
                $item->product_stock = $item->product_id
                    ? (int) ($productStocks[$item->product_id] ?? 0)
                    : null;

                return $item;
            });
        }

        return response()->json($paginated);
    }

    protected function indexDetailed(Request $request, int $perPage): JsonResponse
    {
        $query = ProductFavorite::with(['customer:id,name,surname,email,phone', 'product:id,stock_quantity']);

        $this->applyFilters($query, $request, false);

        // Sorting
        $allowedSorts = ['favorited_at', 'product_name', 'stock_quantity'];
        $sortBy = in_array($request->sort_by, $allowedSorts) ? $request->sort_by : 'favorited_at';
        $sortDir = $request->sort_dir === 'asc' ? 'asc' : 'desc';
        $query->orderByRaw("{$sortBy} {$sortDir} NULLS LAST");

        return response()->json($query->paginate($perPage));
    }

    public function stats(Request $request): JsonResponse
    {
        $base = ProductFavorite::query();

        // Apply period filter
        $period = $request->get('period');
        if ($period) {
            $dateFrom = match ($period) {
                'today' => today(),
                '7d' => now()->subDays(7),
                '30d' => now()->subDays(30),
                '90d' => now()->subDays(90),
                '180d' => now()->subDays(180),
                '365d' => now()->subDays(365),
                default => null,
            };
            if ($dateFrom) {
                $base->where('favorited_at', '>=', $dateFrom);
            }
        }

        $total = (clone $base)->count();
        $uniqueProducts = (clone $base)->distinct('platform_product_id')->count('platform_product_id');
        $uniqueCustomers = (clone $base)->distinct('platform_customer_id')->count('platform_customer_id');
        $today = (clone $base)->whereDate('favorited_at', today())->count();
        $last7 = (clone $base)->where('favorited_at', '>=', now()->subDays(7))->count();
        $last30 = (clone $base)->where('favorited_at', '>=', now()->subDays(30))->count();
        $outOfStock = (clone $base)
            ->where('stock_quantity', '<=', 0)
            ->distinct('platform_product_id')
            ->count('platform_product_id');
        $inStockPct = $uniqueProducts > 0
            ? round((($uniqueProducts - $outOfStock) / $uniqueProducts) * 100)
            : 0;

        return response()->json([
            'total_favorites' => $total,
            'unique_products' => $uniqueProducts,
            'unique_customers' => $uniqueCustomers,
            'today' => $today,
            'last_7_days' => $last7,
            'last_30_days' => $last30,
            'in_stock_pct' => $inStockPct,
            'out_of_stock_count' => $outOfStock,
        ]);
    }

    public function chart(Request $request): JsonResponse
    {
        $days = min((int) ($request->days ?? 30), 365);

        $data = ProductFavorite::query()
            ->select([
                DB::raw("DATE(favorited_at) as date"),
                DB::raw("COUNT(*) as total"),
                DB::raw("COUNT(DISTINCT platform_product_id) as unique_products"),
                DB::raw("COUNT(DISTINCT platform_customer_id) as unique_customers"),
            ])
            ->where('favorited_at', '>=', now()->subDays($days))
            ->whereNotNull('favorited_at')
            ->groupBy(DB::raw('DATE(favorited_at)'))
            ->orderBy('date', 'asc')
            ->get();

        return response()->json(['data' => $data]);
    }

    public function topProducts(Request $request): JsonResponse
    {
        $limit = min((int) ($request->limit ?? 10), 50);
        $period = $request->get('period', '30d');

        $query = ProductFavorite::query()
            ->select([
                'platform_product_id',
                DB::raw("MAX(product_name) as product_name"),
                DB::raw("MAX(product_image) as product_image"),
                DB::raw("MAX(product_url) as product_url"),
                DB::raw("MAX(product_sku) as product_sku"),
                DB::raw("MAX(stock_quantity) as stock_quantity"),
                DB::raw("MAX(product_id) as product_id"),
                DB::raw("COUNT(*) as favorite_count"),
            ])
            ->groupBy('platform_product_id')
            ->orderByDesc('favorite_count')
            ->limit($limit);

        $days = match ($period) {
            '7d' => 7,
            '90d' => 90,
            'all' => null,
            default => 30,
        };

        if ($days !== null) {
            $query->where('favorited_at', '>=', now()->subDays($days));
        }

        $results = $query->get();

        // Enrich with product main stock
        $productIds = $results->pluck('product_id')->filter()->unique()->values()->all();
        if (! empty($productIds)) {
            $productStocks = Product::withoutGlobalScopes()
                ->whereIn('id', $productIds)
                ->pluck('stock_quantity', 'id')
                ->toArray();

            $results->transform(function ($item) use ($productStocks) {
                $item->product_stock = $item->product_id
                    ? (int) ($productStocks[$item->product_id] ?? 0)
                    : null;

                return $item;
            });
        }

        return response()->json($results);
    }

    protected function applyFilters($query, Request $request, bool $isGrouped): void
    {
        // Search
        if ($search = $request->get('search') ? $this->escapeLike($request->get('search')) : null) {
            if ($isGrouped) {
                $query->havingRaw("MAX(product_name) ILIKE ? OR MAX(product_sku) ILIKE ?", ["%{$search}%", "%{$search}%"]);
            } else {
                $query->where(function ($q) use ($search) {
                    $q->where('product_name', 'ilike', "%{$search}%")
                      ->orWhere('product_sku', 'ilike', "%{$search}%");
                });
            }
        }

        // Period preset
        $period = $request->get('period');
        if ($period) {
            $dateFrom = match ($period) {
                'today' => today(),
                '7d' => now()->subDays(7),
                '30d' => now()->subDays(30),
                '90d' => now()->subDays(90),
                '180d' => now()->subDays(180),
                '365d' => now()->subDays(365),
                default => null,
            };
            if ($dateFrom) {
                $query->where('favorited_at', '>=', $dateFrom);
            }
        }

        // Custom date range
        if ($dateFrom = $request->get('date_from')) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
                $query->where('favorited_at', '>=', $dateFrom . ' 00:00:00');
            }
        }
        if ($dateTo = $request->get('date_to')) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
                $query->where('favorited_at', '<=', $dateTo . ' 23:59:59');
            }
        }

        // Stock filter
        $stock = $request->get('stock');
        if ($stock === 'in_stock') {
            if ($isGrouped) {
                $query->havingRaw("MAX(stock_quantity) > 0");
            } else {
                $query->where('stock_quantity', '>', 0);
            }
        } elseif ($stock === 'out_of_stock') {
            if ($isGrouped) {
                $query->havingRaw("MAX(stock_quantity) <= 0");
            } else {
                $query->where('stock_quantity', '<=', 0);
            }
        }

        // has_product filter
        if ($request->has('has_product')) {
            $hasProduct = filter_var($request->get('has_product'), FILTER_VALIDATE_BOOLEAN);
            if ($isGrouped) {
                if ($hasProduct) {
                    $query->havingRaw("MAX(product_id) IS NOT NULL");
                } else {
                    $query->havingRaw("MAX(product_id) IS NULL");
                }
            } else {
                if ($hasProduct) {
                    $query->whereNotNull('product_id');
                } else {
                    $query->whereNull('product_id');
                }
            }
        }
    }
}
