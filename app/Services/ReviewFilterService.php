<?php

namespace App\Services;

use App\Models\ProductReview;
use App\Models\ProductReviewSummary;

class ReviewFilterService
{
    public function __construct(
        private int $negativeReduction = 65,
        private bool $autoFullHide = true,
        private float $autoFullHideThreshold = 2.5,
    ) {}

    public static function fromSettings(array $settings): self
    {
        return new self(
            negativeReduction: (int) ($settings['review_negative_reduction'] ?? 65),
            autoFullHide: filter_var($settings['review_auto_full_hide'] ?? true, FILTER_VALIDATE_BOOLEAN),
            autoFullHideThreshold: (float) ($settings['review_auto_full_hide_threshold'] ?? 2.5),
        );
    }

    /**
     * Filter a review summary, returning adjusted stats or null if nothing to show.
     */
    public function filterSummary(ProductReviewSummary $summary): ?array
    {
        $reduction = $this->negativeReduction;

        // Auto full hide: if product avg is below threshold, hide all negatives
        if ($this->autoFullHide && (float) $summary->avg_rate < $this->autoFullHideThreshold) {
            $reduction = 100;
        }

        $keptOne = (int) round($summary->rate_one * (1 - $reduction / 100));
        $keptTwo = (int) round($summary->rate_two * (1 - $reduction / 100));

        $newTotal = $summary->rate_five + $summary->rate_four + $summary->rate_three + $keptTwo + $keptOne;

        if ($newTotal === 0) {
            return null;
        }

        $newAvg = (5 * $summary->rate_five + 4 * $summary->rate_four + 3 * $summary->rate_three + 2 * $keptTwo + 1 * $keptOne) / $newTotal;

        return [
            'avg_rate' => round($newAvg, 2),
            'rate_count' => $newTotal,
            'rate_five' => $summary->rate_five,
            'rate_four' => $summary->rate_four,
            'rate_three' => $summary->rate_three,
            'rate_two' => $keptTwo,
            'rate_one' => $keptOne,
        ];
    }

    /**
     * Get review IDs that should be excluded (least liked / oldest negatives first).
     */
    public function getExcludedReviewIds(int $productId, int $tenantId, int $excludeOne, int $excludeTwo): array
    {
        $ids = [];

        if ($excludeOne > 0) {
            $ids = array_merge($ids, ProductReview::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('product_id', $productId)
                ->where('rate', 1)
                ->orderBy('like_count')
                ->orderBy('reviewed_at')
                ->limit($excludeOne)
                ->pluck('id')
                ->all());
        }

        if ($excludeTwo > 0) {
            $ids = array_merge($ids, ProductReview::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('product_id', $productId)
                ->where('rate', 2)
                ->orderBy('like_count')
                ->orderBy('reviewed_at')
                ->limit($excludeTwo)
                ->pluck('id')
                ->all());
        }

        return $ids;
    }

    /**
     * Calculate how many reviews to exclude per rating.
     */
    public function getExcludeCounts(ProductReviewSummary $summary): array
    {
        $reduction = $this->negativeReduction;

        if ($this->autoFullHide && (float) $summary->avg_rate < $this->autoFullHideThreshold) {
            $reduction = 100;
        }

        $keptOne = (int) round($summary->rate_one * (1 - $reduction / 100));
        $keptTwo = (int) round($summary->rate_two * (1 - $reduction / 100));

        return [
            'exclude_one' => $summary->rate_one - $keptOne,
            'exclude_two' => $summary->rate_two - $keptTwo,
        ];
    }
}
