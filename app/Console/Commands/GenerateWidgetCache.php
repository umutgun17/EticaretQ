<?php

namespace App\Console\Commands;

use App\Models\Product;
use App\Models\Tenant;
use App\Services\ReviewFilterService;
use Illuminate\Console\Command;

class GenerateWidgetCache extends Command
{
    protected $signature = 'widget:generate-cache';
    protected $description = 'Generate static JSON cache files for the review widget';

    public function handle(): int
    {
        $tenants = Tenant::where('is_active', true)
            ->whereNotNull('slug')
            ->get();

        foreach ($tenants as $tenant) {
            $settings = $tenant->settings ?? [];
            if (! filter_var($settings['review_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                continue;
            }

            $this->generateBatchCache($tenant, $settings);
        }

        return self::SUCCESS;
    }

    private function generateBatchCache(Tenant $tenant, array $settings): void
    {
        $filter = ReviewFilterService::fromSettings($settings);

        $products = Product::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->whereHas('reviewSummary', fn ($q) => $q->withoutGlobalScopes())
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
                'avg_rate' => round($filtered['avg_rate'], 2),
                'rate_count' => $filtered['rate_count'],
            ];
        }

        $dir = public_path('widget/data');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $json = json_encode(['products' => $results, 'generated_at' => now()->toIso8601String()]);
        file_put_contents("{$dir}/{$tenant->slug}.json", $json);

        $this->info("Generated cache for {$tenant->slug}: " . count($results) . ' products');
    }
}
