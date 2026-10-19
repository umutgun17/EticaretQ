<?php

namespace App\Console\Commands;

use App\Models\Product;
use App\Services\ApifyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Trendyol alici-fiyatlarini Apify (maximedupre) ile ceker ve products tablosuna
 * yazar. Site fiyati (products.price/discounted_price, Ticimax) ile kiyaslama
 * "Fiyat Kiyaslama" panelinde yapilir.
 *
 * Ayni tarama ortalama puani (trendyol_rating) da getirir; yorum sync'i bunun
 * degisimine bakarak sadece yorumu degisen urunleri isler (maliyet dusurme).
 */
class SyncTrendyolPrices extends Command
{
    protected $signature = 'trendyol:sync-prices
                            {--limit=0 : Islenecek max contentId (0=hepsi)}
                            {--batch=20 : Tek Apify calismasinda kac urun (baslangic ucretini amorti eder)}
                            {--missing-only : Sadece trendyol_price\'i hic olmayan urunleri tara (bosluk doldurma)}';

    protected $description = 'Trendyol urun fiyatlarini Apify uzerinden senkronize eder';

    protected int $contentIdsProcessed = 0;
    protected int $productsUpdated = 0;
    protected int $notFound = 0;
    protected int $runsFailed = 0;

    public function handle(ApifyService $apify): int
    {
        if (! $apify->isAvailable()) {
            $this->error('APIFY_TOKEN tanimli degil (.env).');
            return 1;
        }

        $limit = (int) $this->option('limit');
        $batchSize = max(1, (int) $this->option('batch'));

        // contentId -> [products] eslesmesi (metadata veya review ozeti uzerinden)
        $contentIdGroups = $this->buildContentIdGroups();

        if (empty($contentIdGroups)) {
            $this->info('Eslesmis (contentId olan) urun bulunamadi.');
            return 0;
        }

        if ($limit > 0) {
            $contentIdGroups = array_slice($contentIdGroups, 0, $limit, true);
        }

        $total = count($contentIdGroups);
        $this->info("Fiyat sync — {$total} benzersiz contentId, batch={$batchSize}");

        // contentId'leri batch'lere bol
        $contentIds = array_keys($contentIdGroups);
        $batches = array_chunk($contentIds, $batchSize);
        $processed = 0;

        foreach ($batches as $batch) {
            // Butce freni: asilinca kalan batch'leri deneme, temiz cik.
            if ($apify->budgetExceeded()) {
                $this->warn("\n  BUTCE FRENI (APIFY_BUDGET_USD) asildi — kalan " . ($total - $processed) . " contentId sonraki calismaya birakildi.");
                break;
            }

            // URL listesi: onceden kaydedilmis kanonik URL varsa onu kullan
            $urlByContentId = [];
            foreach ($batch as $cid) {
                $primary = $contentIdGroups[$cid][0];
                $urlByContentId[$cid] = $primary->trendyol_product_url ?: $apify->buildProductUrl((int) $cid);
            }

            $byId = $apify->fetchProductsBatch(array_values($urlByContentId));

            if ($byId === null) {
                $this->runsFailed++;
                $this->warn("\n  Batch basarisiz (Apify null dondu) — atlaniyor.");
                continue;
            }

            foreach ($batch as $cid) {
                $processed++;
                $this->contentIdsProcessed++;
                $this->output->write("\r  [{$processed}/{$total}] contentId={$cid}   ");

                $row = $byId[(string) $cid] ?? null;
                if (! $row) {
                    $this->notFound++;
                    continue;
                }

                $this->applyPriceToProducts($contentIdGroups[$cid], $row);
            }
        }

        $this->newLine(2);
        $this->info('Sonuc:');
        $this->table(['Metrik', 'Adet'], [
            ['Islenen contentId', $this->contentIdsProcessed],
            ['Guncellenen urun', $this->productsUpdated],
            ['Trendyol\'da bulunamayan', $this->notFound],
            ['Basarisiz batch', $this->runsFailed],
        ]);

        Log::info('trendyol:sync-prices tamamlandi', [
            'content_ids' => $this->contentIdsProcessed,
            'products_updated' => $this->productsUpdated,
            'not_found' => $this->notFound,
            'runs_failed' => $this->runsFailed,
        ]);

        return 0;
    }

    /**
     * @return array<int,array<int,Product>>  contentId => Product[]
     */
    protected function buildContentIdGroups(): array
    {
        $products = Product::withoutGlobalScopes()
            ->where(function ($q) {
                $q->whereRaw("metadata->>'trendyol_content_id' IS NOT NULL")
                  ->orWhereHas('reviewSummary', function ($sq) {
                      $sq->whereNotNull('trendyol_content_id');
                  });
            })
            ->when($this->option('missing-only'), fn ($q) => $q->whereNull('trendyol_price'))
            ->with('reviewSummary')
            ->orderBy('id')
            ->get();

        $groups = [];
        foreach ($products as $product) {
            $cid = (int) ($product->metadata['trendyol_content_id'] ?? 0);
            if (! $cid && $product->reviewSummary) {
                $cid = (int) $product->reviewSummary->trendyol_content_id;
            }
            if (! $cid) {
                continue;
            }
            $groups[$cid][] = $product;
        }

        return $groups;
    }

    /**
     * @param  array<int,Product>  $products
     * @param  array  $row  Apify product satiri
     */
    protected function applyPriceToProducts(array $products, array $row): void
    {
        $price = $this->toDecimal($row['price'] ?? null);
        $original = $this->toDecimal($row['originalPrice'] ?? null);
        $rating = $this->toDecimal($row['rating'] ?? null);
        $url = $row['productUrl'] ?? null;
        $promotions = ! empty($row['promotions']) && is_array($row['promotions']) ? $row['promotions'] : null;
        $discountPct = $this->toDecimal($row['discountPercent'] ?? null);

        // Stok: herhangi bir varyant stokta mi?
        $inStock = null;
        if (isset($row['inStock'])) {
            $inStock = (bool) $row['inStock'];
        } elseif (! empty($row['variants']) && is_array($row['variants'])) {
            $inStock = collect($row['variants'])->contains(fn ($v) => ! empty($v['inStock']));
        }

        foreach ($products as $product) {
            $product->forceFill([
                'trendyol_price' => $price,
                'trendyol_original_price' => $original,
                'trendyol_promotions' => $promotions,
                'trendyol_discount_percent' => $discountPct,
                'trendyol_in_stock' => $inStock,
                'trendyol_rating' => $rating,
                'trendyol_product_url' => $url ?: $product->trendyol_product_url,
                'trendyol_price_synced_at' => now(),
            ])->save();
            $this->productsUpdated++;
        }
    }

    protected function toDecimal($v): ?float
    {
        return is_numeric($v) ? round((float) $v, 3) : null;
    }
}
