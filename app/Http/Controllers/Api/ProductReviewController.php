<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductReview;
use App\Models\ProductReviewSummary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductReviewController extends Controller
{
    /**
     * List products that have review summaries (paginated)
     */
    public function index(Request $request): JsonResponse
    {
        $query = ProductReviewSummary::with(['product' => function ($q) {
            $q->withoutGlobalScopes()->select(
                'id', 'name', 'brand', 'category', 'images', 'sku', 'is_active', 'metadata'
            );
        }])
            ->orderByDesc('rate_count');

        // Search by product name, SKU, or barcode
        // When searching, show all products (including rate_count=0)
        // When not searching, only show products with reviews
        if ($request->filled('search')) {
            $search = $this->escapeLike($request->search);
            $query->where(function ($q) use ($search) {
                $q->whereHas('product', function ($pq) use ($search) {
                    $pq->withoutGlobalScopes()->where(function ($inner) use ($search) {
                        $inner->where('name', 'ilike', "%{$search}%")
                              ->orWhere('sku', 'ilike', "%{$search}%");
                    });
                })->orWhereHas('product', function ($pq) use ($search) {
                    $pq->withoutGlobalScopes()->whereHas('variants', function ($vq) use ($search) {
                        $vq->where('barcode', $search)
                            ->orWhere('sku', 'ilike', "%{$search}%");
                    });
                });
            });
        }

        // When not searching, only show products with reviews
        if (! $request->filled('search')) {
            $query->where('rate_count', '>', 0);
        }

        // Filter by min rating
        if ($request->filled('min_rate')) {
            $query->where('avg_rate', '>=', (float) $request->min_rate);
        }

        // Sorting
        $allowedSorts = ['avg_rate', 'rate_count', 'comment_count', 'last_synced_at'];
        $sortBy = in_array($request->sort_by, $allowedSorts) ? $request->sort_by : 'rate_count';
        $sortDir = $request->sort_dir === 'asc' ? 'asc' : 'desc';
        $query->orderBy($sortBy, $sortDir);

        $perPage = min((int) ($request->per_page ?? 25), 100);

        return response()->json($query->paginate($perPage));
    }

    /**
     * Overall review statistics
     */
    public function stats(): JsonResponse
    {
        // Resolve tenant: user's own tenant, or super admin's selected tenant via header
        $tenantId = auth()->user()->tenant_id
            ?: (request()->hasHeader('X-Tenant-Id') ? (int) request()->header('X-Tenant-Id') : null);

        // Use DISTINCT ON to avoid double-counting when multiple products share same trendyol_content_id
        $tenantFilter = $tenantId ? 'AND tenant_id = ?' : '';
        $bindings = $tenantId ? [$tenantId] : [];

        $uniqueStats = \Illuminate\Support\Facades\DB::selectOne("
            SELECT
                count(*) FILTER (WHERE rate_count > 0) as total_products,
                coalesce(sum(rate_count), 0) as total_reviews,
                coalesce(sum(comment_count), 0) as total_comments,
                round(avg(avg_rate) FILTER (WHERE rate_count > 0), 2) as avg_rating,
                coalesce(sum(rate_five), 0) as total_five,
                coalesce(sum(rate_four), 0) as total_four,
                coalesce(sum(rate_three), 0) as total_three,
                coalesce(sum(rate_two), 0) as total_two,
                coalesce(sum(rate_one), 0) as total_one
            FROM (
                SELECT DISTINCT ON (trendyol_content_id) *
                FROM product_review_summaries
                WHERE trendyol_content_id IS NOT NULL {$tenantFilter}
                ORDER BY trendyol_content_id, rate_count DESC
            ) unique_summaries
        ", $bindings);

        $totalProducts = (int) $uniqueStats->total_products;
        $totalReviews = (int) $uniqueStats->total_reviews;
        $totalComments = (int) $uniqueStats->total_comments;
        $avgRating = (float) ($uniqueStats->avg_rating ?? 0);

        $ratingDistribution = [
            5 => (int) $uniqueStats->total_five,
            4 => (int) $uniqueStats->total_four,
            3 => (int) $uniqueStats->total_three,
            2 => (int) $uniqueStats->total_two,
            1 => (int) $uniqueStats->total_one,
        ];

        $topRated = ProductReviewSummary::with(['product' => function ($q) {
            $q->withoutGlobalScopes()->select('id', 'name', 'images');
        }])
            ->where('rate_count', '>=', 10)
            ->orderByDesc('avg_rate')
            ->limit(5)
            ->get();

        $mostReviewed = ProductReviewSummary::with(['product' => function ($q) {
            $q->withoutGlobalScopes()->select('id', 'name', 'images');
        }])
            ->orderByDesc('rate_count')
            ->limit(5)
            ->get();

        return response()->json([
            'total_products' => $totalProducts,
            'total_reviews' => $totalReviews,
            'total_comments' => $totalComments,
            'avg_rating' => round($avgRating, 2),
            'rating_distribution' => $ratingDistribution,
            'top_rated' => $topRated,
            'most_reviewed' => $mostReviewed,
        ]);
    }

    /**
     * Single product review detail with paginated reviews
     */
    public function show(int $productId, Request $request): JsonResponse
    {
        // Tenant kapsamı KORUNMALI: withoutGlobalScopes() cross-tenant katalog okuması
        // açıyordu (başka tenant'ın ürün adı/marka/görsel/metadata'sı ID ile okunabiliyordu).
        $product = Product::with('reviewSummary')
            ->findOrFail($productId);

        // Query by trendyol_content_id so all products sharing the same content see all reviews
        $contentId = $product->reviewSummary?->trendyol_content_id;
        $query = ProductReview::query()
            ->when($contentId, fn ($q) => $q->where('trendyol_content_id', $contentId), fn ($q) => $q->where('product_id', $productId))
            ->orderByDesc('reviewed_at')
            ->orderByDesc('id');

        // Filter by rating
        if ($request->filled('rate')) {
            $query->where('rate', (int) $request->rate);
        }

        // Filter: only with images
        if ($request->boolean('has_images')) {
            $query->whereRaw("jsonb_array_length(images) > 0");
        }

        // Filter: only with comments
        if ($request->boolean('has_comment')) {
            $query->whereNotNull('comment')->where('comment', '!=', '');
        }

        $perPage = min((int) ($request->per_page ?? 20), 50);
        $reviews = $query->paginate($perPage);

        return response()->json([
            'product' => [
                'id' => $product->id,
                'name' => $product->name,
                'brand' => $product->brand,
                'images' => $product->images,
                'metadata' => $product->metadata,
            ],
            'summary' => $product->reviewSummary,
            'reviews' => $reviews,
        ]);
    }
}
