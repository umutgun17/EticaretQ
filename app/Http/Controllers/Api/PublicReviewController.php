<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductReview;
use App\Models\ProductReviewSummary;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Services\ReviewFilterService;
use App\Services\WidgetPresetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class PublicReviewController extends Controller
{
    /**
     * GET /w/{slug}/reviews/product/{barcode}
     * Detail page: filtered summary + paginated reviews for a product by barcode.
     */
    public function product(Request $request, string $slug, string $barcode): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // Sanitize barcode: alphanumeric only
        $barcode = preg_replace('/[^a-zA-Z0-9\-_]/', '', $barcode);
        if (! $barcode || mb_strlen($barcode) > 50) {
            return response()->json(['error' => 'invalid_barcode'], 400);
        }

        $product = $this->findProductByBarcode($tenant->id, $barcode);
        if (! $product) {
            return response()->json(['error' => 'product_not_found'], 404);
        }

        return $this->buildProductResponse($request, $tenant, $product);
    }

    /**
     * GET /w/{slug}/reviews/product-id/{id}
     * Detail page: filtered summary + paginated reviews for a product by Ticimax ID.
     */
    public function productById(Request $request, string $slug, string $id): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // Sanitize ID: numeric only
        if (! ctype_digit($id) || strlen($id) > 10) {
            return response()->json(['error' => 'invalid_id'], 400);
        }

        $product = Product::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('platform_product_id', $id)
            ->first();

        if (! $product) {
            return response()->json(['error' => 'product_not_found'], 404);
        }

        return $this->buildProductResponse($request, $tenant, $product);
    }

    /**
     * GET /w/{slug}/reviews/batch?ids=1,2,3
     * Listing page: batch summaries for multiple products by Ticimax IDs (max 20).
     */
    public function batch(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $settings = $tenant->settings ?? [];
        if (! filter_var($settings['review_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['error' => 'widget_disabled'], 403);
        }

        $idsParam = $request->query('ids', '');
        $ids = array_filter(array_map('trim', explode(',', $idsParam)));
        // Sanitize: only numeric IDs, max 20 per request
        $ids = array_filter($ids, fn ($id) => ctype_digit($id) && strlen($id) <= 10);
        $ids = array_slice($ids, 0, 20);

        if (empty($ids)) {
            return response()->json(['products' => []]);
        }

        $filter = ReviewFilterService::fromSettings($settings);

        // Cache batch results for 1 hour
        $cacheKey = 'widget:batch:' . $tenant->id . ':' . md5(implode(',', $ids));
        $results = Cache::remember($cacheKey, 3600, function () use ($tenant, $ids, $filter) {
            $products = Product::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->whereIn('platform_product_id', $ids)
                ->select(['id', 'platform_product_id'])
                ->with(['reviewSummary' => fn ($q) => $q->withoutGlobalScopes()])
                ->get();

            $results = [];
            foreach ($products as $product) {
                if (! $product->reviewSummary) {
                    continue;
                }

                $filtered = $filter->filterSummary($product->reviewSummary);
                if (! $filtered) {
                    continue;
                }

                $results[$product->platform_product_id] = [
                    'avg_rate' => $filtered['avg_rate'],
                    'rate_count' => $filtered['rate_count'],
                ];
            }

            return $results;
        });

        return response()->json(['products' => $results])
            ->header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    }

    /**
     * GET /w/{slug}/reviews/config
     * Returns widget selector configuration for the tenant's platform.
     */
    public function config(string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $settings = $tenant->settings ?? [];
        if (! filter_var($settings['review_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['error' => 'widget_disabled'], 403);
        }

        $cacheKey = 'widget:config:' . $tenant->id;

        $config = Cache::remember($cacheKey, 3600, function () use ($settings) {
            $platform = $settings['review_widget_platform'] ?? 'ticimax';

            return [
                'platform' => $platform,
                'selectors' => WidgetPresetService::resolveSelectors($settings),
            ];
        });

        return response()->json($config)
            ->header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    }

    private function resolveTenant(string $slug): ?Tenant
    {
        // Sanitize slug
        $slug = preg_replace('/[^a-zA-Z0-9\-_]/', '', $slug);
        if (! $slug || mb_strlen($slug) > 50) {
            return null;
        }

        return Cache::remember('widget:tenant:' . $slug, 600, function () use ($slug) {
            return Tenant::where('slug', $slug)->where('is_active', true)->first();
        });
    }

    private function findProductByBarcode(int $tenantId, string $barcode): ?Product
    {
        return Cache::remember("widget:product:{$tenantId}:{$barcode}", 3600, function () use ($tenantId, $barcode) {
            // Try direct product barcode
            $product = Product::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('barcode', $barcode)
                ->select(['id', 'tenant_id', 'barcode'])
                ->first();

            if ($product) {
                return $product;
            }

            // Try variant barcode → parent product
            $variant = ProductVariant::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('barcode', $barcode)
                ->select(['id', 'product_id'])
                ->first();

            if ($variant) {
                return Product::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('id', $variant->product_id)
                    ->select(['id', 'tenant_id', 'barcode'])
                    ->first();
            }

            return null;
        });
    }

    private function buildProductResponse(Request $request, Tenant $tenant, Product $product): JsonResponse
    {
        $settings = $tenant->settings ?? [];
        if (! filter_var($settings['review_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['error' => 'widget_disabled'], 403);
        }

        // Cache summary for 1 hour
        $summary = Cache::remember(
            "widget:summary:{$tenant->id}:{$product->id}",
            3600,
            fn () => ProductReviewSummary::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->where('product_id', $product->id)
                ->first()
        );

        if (! $summary) {
            return response()->json(['error' => 'no_reviews'], 404);
        }

        $filter = ReviewFilterService::fromSettings($settings);
        $filtered = $filter->filterSummary($summary);

        if (! $filtered) {
            return response()->json(['error' => 'no_reviews'], 404);
        }

        // Determine which reviews to exclude
        $counts = $filter->getExcludeCounts($summary);
        $excludedIds = [];
        if ($counts['exclude_one'] > 0 || $counts['exclude_two'] > 0) {
            $excludedIds = Cache::remember(
                "widget:excluded:{$tenant->id}:{$product->id}",
                3600,
                fn () => $filter->getExcludedReviewIds(
                    $product->id,
                    $tenant->id,
                    $counts['exclude_one'],
                    $counts['exclude_two'],
                )
            );
        }

        // Paginate reviews
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(20, max(1, (int) $request->query('per_page', 10)));

        // Star filter (1-5)
        $starFilter = $request->query('star');
        $starFilter = ($starFilter && in_array((int) $starFilter, [1, 2, 3, 4, 5])) ? (int) $starFilter : null;

        // Photo filter
        $photoFilter = $request->query('photo') === '1';

        // Search — sanitize and escape wildcards
        $search = $request->query('q', '');
        $search = mb_substr(trim($search ?? ''), 0, 100);
        // Escape PostgreSQL LIKE wildcards
        $search = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);

        // Sort: newest (default), oldest, highest, lowest, most_liked
        $sort = $request->query('sort', 'newest');
        $allowedSorts = ['newest', 'oldest', 'highest', 'lowest', 'most_liked'];
        if (! in_array($sort, $allowedSorts)) {
            $sort = 'newest';
        }

        // Query by trendyol_content_id so products sharing same content see all reviews
        $contentId = $summary->trendyol_content_id;
        $reviewsQuery = ProductReview::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->when($contentId, fn ($q) => $q->where('trendyol_content_id', $contentId), fn ($q) => $q->where('product_id', $product->id))
            ->when(! empty($excludedIds), fn ($q) => $q->whereNotIn('id', $excludedIds))
            ->when($starFilter, fn ($q) => $q->where('rate', $starFilter))
            ->when($photoFilter, fn ($q) => $q->whereNotNull('images')->where('images', '!=', '[]'))
            ->when($search !== '', fn ($q) => $q->where('comment', 'ilike', '%' . $search . '%'));

        // Sorting
        match ($sort) {
            'oldest' => $reviewsQuery->orderBy('reviewed_at'),
            'highest' => $reviewsQuery->orderByDesc('rate')->orderByDesc('reviewed_at'),
            'lowest' => $reviewsQuery->orderBy('rate')->orderByDesc('reviewed_at'),
            'most_liked' => $reviewsQuery->orderByDesc('like_count')->orderByDesc('reviewed_at'),
            default => $reviewsQuery->orderByDesc('reviewed_at'),
        };

        $total = $reviewsQuery->count();
        $lastPage = max(1, (int) ceil($total / $perPage));

        // Clamp page to valid range — prevent huge OFFSET
        $page = min($page, $lastPage);

        $reviews = $reviewsQuery
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get(['id', 'rate', 'user_full_name', 'comment', 'comment_date_text', 'reviewed_at', 'images', 'like_count', 'seller_reply']);

        // Count photos — use cached summary if no exclusions, otherwise query
        $photoCount = Cache::remember(
            "widget:photos:{$tenant->id}:{$product->id}",
            3600,
            fn () => ProductReview::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->when($contentId, fn ($q) => $q->where('trendyol_content_id', $contentId), fn ($q) => $q->where('product_id', $product->id))
                ->when(! empty($excludedIds), fn ($q) => $q->whereNotIn('id', $excludedIds))
                ->whereNotNull('images')
                ->where('images', '!=', '[]')
                ->count()
        );

        $filtered['photo_count'] = $photoCount;
        $filtered['ai_summary'] = $summary->ai_summary;

        return response()->json([
            'summary' => $filtered,
            'reviews' => $reviews,
            'pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => $lastPage,
            ],
        ])->header('Cache-Control', 'public, max-age=300, s-maxage=300');
    }
}
