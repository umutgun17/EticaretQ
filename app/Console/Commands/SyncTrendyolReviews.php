<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\Product;
use App\Models\ProductReview;
use App\Models\ProductReviewSummary;
use App\Services\ApifyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SyncTrendyolReviews extends Command
{
    protected $signature = 'trendyol:sync-reviews
                            {--mode=incremental : Sync modu: full veya incremental}
                            {--limit=0 : Islenecek max contentId (0=hepsi)}
                            {--full : Puan degismese de tum eslesmis urunleri tara}
                            {--content-ids= : Sadece bu contentId\'leri isle (virgullu liste; cursor/settings\'e dokunmaz)}
                            {--channel= : Sadece bu Trendyol kanal ID islensin}
                            {--delay=0 : Istekler arasi bekleme suresi (saniye)}
                            {--max-file= : JSON contentId=>adet haritasi — urun basina yalniz yeni yorum kadar cek (maliyet = yeni yorum)}
                            {--sort=newest : Yorum sirasi newest veya oldest (oldest = eski gecmis boslugu)}
                            {--extra-map= : JSON contentId=>productId — urune bagli olmayan 2. ilanlar; yorum o urune yazilir, ozet degismez}';

    protected $description = 'Trendyol urun yorumlarini Apify uzerinden senkronize eder';

    protected int $skippedUnchanged = 0;
    protected int $skippedNoReviews = 0;

    protected int $productsProcessed = 0;
    protected int $contentIdsProcessed = 0;
    protected int $reviewsCreated = 0;
    protected int $reviewsSkipped = 0;
    protected int $summariesUpserted = 0;
    protected int $rateLimitHits = 0;

    // Cache: contentId → summary data (avoid re-fetching same contentId)
    protected array $processedContentIds = [];

    // --max-file: contentId → istenecek en yeni yorum sayisi
    protected array $maxPerCid = [];

    // --extra-map: ayni urunun 2.+ Trendyol ilanlari (ozet yazilmaz)
    protected array $secondaryCids = [];

    // Adaptive delay: starts at configured value, increases on 429
    protected int $currentDelay = 5;

    // Sayfa ust siniri (urun basina Apify cagri sayisi). caa bazi urunlerde
    // totalPages=500+ donduruyor; incremental'da yeni yorum bitince zaten durulur.
    protected int $maxPages = 15;

    public function handle(ApifyService $service): int
    {
        if (! $service->isAvailable()) {
            $this->error('APIFY_TOKEN tanimli degil (.env).');
            return 1;
        }

        // Coklu-tenant: tum aktif Trendyol kanallari sirayla islenir. Eski tekil
        // ->first() yalnizca en dusuk id'li kanali isliyordu — diger tenant'larin
        // yorumlari hic senkron olmuyordu.
        $channels = Channel::withoutGlobalScopes()
            ->where('type', 'trendyol-product')
            ->where('is_active', true)
            ->orderBy('id')
            ->get();

        if ($channelId = $this->option('channel')) {
            $channels = $channels->where('id', (int) $channelId)->values();
        }

        if ($channels->isEmpty()) {
            $this->error('Aktif trendyol-product kanali bulunamadi.');
            return 1;
        }

        foreach ($channels as $trendyolChannel) {
            if ($service->budgetExceeded()) {
                $this->warn('BUTCE FRENI (APIFY_BUDGET_USD) asildi — kalan kanallar sonraki calismaya birakildi.');
                break;
            }

            $this->info("Tenant #{$trendyolChannel->tenant_id} — Trendyol kanal #{$trendyolChannel->id} isleniyor...");
            $this->syncChannel($service, $trendyolChannel);
        }

        return 0;
    }

    protected function syncChannel(ApifyService $service, Channel $trendyolChannel): void
    {
        // Sayaclar ve contentId onbellegi kanal (tenant) basina sifirlanir ki
        // rapor kanala ait olsun.
        $this->skippedUnchanged = 0;
        $this->skippedNoReviews = 0;
        $this->productsProcessed = 0;
        $this->contentIdsProcessed = 0;
        $this->reviewsCreated = 0;
        $this->reviewsSkipped = 0;
        $this->summariesUpserted = 0;
        $this->processedContentIds = [];

        $mode = $this->option('mode');
        $limit = (int) $this->option('limit');
        $full = (bool) $this->option('full');
        $this->currentDelay = (int) $this->option('delay');
        $service->reviewSort = $this->option('sort') === 'oldest' ? 'oldest' : 'newest';

        $this->info("Trendyol yorum sync (Apify) — mod: {$mode}" . ($full ? ' [full]' : ''));

        // --content-ids: hedefli calisma (or. yeni kesfedilen urunler) — cursor ve
        // settings'e dokunulmaz ki gece cron'unun artimli akisi bozulmasin.
        $onlyCids = array_values(array_filter(array_map(
            'intval',
            preg_split('/[,\s]+/', (string) $this->option('content-ids'), -1, PREG_SPLIT_NO_EMPTY)
        )));

        if ($file = $this->option('max-file')) {
            $this->maxPerCid = array_map('intval', (array) json_decode((string) @file_get_contents($file), true));
            $this->info('--max-file: ' . count($this->maxPerCid) . ' contentId icin yorum adedi tanimli.');
        }

        $settings = $trendyolChannel->settings ?? [];
        $cursor = ($mode === 'incremental' && empty($onlyCids)) ? ($settings['reviews_sync_cursor'] ?? 0) : 0;

        // Get products with contentId from metadata OR from existing review summaries.
        // select ZORUNLU: tum kolonlar (ozellikle embedding vektoru) yuklenince
        // 3K+ urun 128M CLI limitini asip komutu sessizce OOM'a goturuyor —
        // gece cron'u bu yuzden gunlerce sonuc tablosuz olmustu.
        $allProducts = Product::withoutGlobalScopes()
            ->select(['id', 'tenant_id', 'metadata', 'trendyol_rating', 'trendyol_price_synced_at'])
            ->where('tenant_id', $trendyolChannel->tenant_id)
            ->where(function ($q) {
                $q->whereRaw("metadata->>'trendyol_content_id' IS NOT NULL")
                  ->orWhereHas('reviewSummary', function ($sq) {
                      $sq->whereNotNull('trendyol_content_id');
                  });
            })
            ->where('id', '>', $cursor)
            ->orderBy('id')
            ->with('reviewSummary')
            ->get();

        if ($allProducts->isEmpty()) {
            if ($mode === 'incremental' && $cursor > 0) {
                $settings['reviews_sync_cursor'] = 0;
                $trendyolChannel->update(['settings' => $settings]);
                $this->info('Tum urunler tarandi, cursor sifirlandi.');
            } else {
                $this->info('Islenecek urun bulunamadi.');
            }
            return;
        }

        // Group products by contentId (metadata OR review summary)
        $contentIdGroups = [];
        foreach ($allProducts as $product) {
            $cid = (int) ($product->metadata['trendyol_content_id'] ?? 0);
            if (! $cid && $product->reviewSummary) {
                $cid = (int) $product->reviewSummary->trendyol_content_id;
            }
            if (! $cid) {
                continue;
            }
            if (! isset($contentIdGroups[$cid])) {
                $contentIdGroups[$cid] = [];
            }
            $contentIdGroups[$cid][] = $product;
        }

        // --extra-map: bir model Trendyol'da birden cok ilana (contentId) karsilik
        // gelebiliyor; metadata tek cid tuttugu icin 2. ilanlar hic islenmiyordu.
        if ($file = $this->option('extra-map')) {
            foreach ((array) json_decode((string) @file_get_contents($file), true) as $cid => $pid) {
                $cid = (int) $cid;
                if (isset($contentIdGroups[$cid])) {
                    continue;
                }
                $p = Product::withoutGlobalScopes()
                    ->select(['id', 'tenant_id', 'metadata', 'trendyol_rating', 'trendyol_price_synced_at'])
                    ->where('tenant_id', $trendyolChannel->tenant_id)
                    ->with('reviewSummary')
                    ->find((int) $pid);
                if ($p) {
                    $contentIdGroups[$cid] = [$p];
                    $this->secondaryCids[$cid] = true;
                }
            }
            $this->info('--extra-map: ' . count($this->secondaryCids) . ' ek ilan eklendi.');
        }

        if (! empty($onlyCids)) {
            $contentIdGroups = array_intersect_key($contentIdGroups, array_flip($onlyCids));
            $this->info('--content-ids filtresi: ' . count($contentIdGroups) . '/' . count($onlyCids) . ' contentId eslesti.');
        }

        $totalContentIds = count($contentIdGroups);
        $this->info("Toplam {$allProducts->count()} urun, {$totalContentIds} benzersiz contentId");

        // Apply limit if set
        if ($limit > 0) {
            $contentIdGroups = array_slice($contentIdGroups, 0, $limit, true);
        }

        $targetCount = count($contentIdGroups);
        $processed = 0;

        foreach ($contentIdGroups as $contentId => $products) {
            // Butce freni: asilinca kalan urunleri deneme, cursor'u koruyup temiz cik.
            if ($service->budgetExceeded()) {
                $this->warn("\n  BUTCE FRENI (APIFY_BUDGET_USD) asildi — kalan " . ($targetCount - $processed) . " contentId sonraki calismaya birakildi.");
                break;
            }

            $processed++;
            $primaryProduct = $products[0];
            $this->contentIdsProcessed++;

            $this->output->write("\r  [{$processed}/{$targetCount}] contentId={$contentId}");

            // Maliyet dusurme: fiyat taramasindan gelen guncel puan (trendyol_rating)
            // en son yorum-sync'indeki ortalamayla (avg_rate) ayniysa yorum degismemistir
            // → pahali yorum aktorunu hic cagirma.
            if ($mode === 'incremental' && ! $full && $this->reviewsUnchanged($primaryProduct)) {
                $this->skippedUnchanged++;
                $this->output->write(" — puan ayni, atlandi");
                $cursor = end($products)->id;
                continue;
            }

            // caa_software aktoru 0-yorumlu urunlerde cokuyor (KeyError: averageRating,
            // exit 91). Fiyat taramasi calismis ve Trendyol puani bos/0 ise urunun hic
            // yorumu yok demektir → aktoru bosuna cagirma.
            if (! $full && $this->hasNoReviewsOnTrendyol($primaryProduct)) {
                $this->skippedNoReviews++;
                $this->output->write(" — Trendyol'da yorum yok, atlandi");
                $cursor = end($products)->id;
                continue;
            }

            $result = $this->syncProductReviews($service, $primaryProduct, $contentId, $mode);

            if ($result === 'rate_limited') {
                // We already waited inside syncProductReviews.
                // Retry this contentId once after waiting.
                $this->output->write(" — tekrar deneniyor...");
                $result = $this->syncProductReviews($service, $primaryProduct, $contentId, $mode);

                if ($result === 'rate_limited') {
                    // Still rate limited — save cursor and stop this run
                    $this->warn("\n  Hala rate limited, kayit edip sonraki calismada devam edecek.");
                    break;
                }
            }

            if ($result === 'success') {
                $this->productsProcessed++;

                // Copy summary to other products with same contentId
                $cachedData = $this->processedContentIds[$contentId] ?? null;
                for ($i = 1; $i < count($products); $i++) {
                    $this->copySummaryFromCache($products[$i], $contentId, $cachedData);
                    $this->productsProcessed++;
                }
            }

            // Update cursor to last product in this group
            $cursor = end($products)->id;

            // Surec oldurulurse (OOM/LVE kill) kaldigi yerden devam edebilsin diye
            // cursor'u periyodik kaydet (normalde yalniz calisma sonunda yazilir).
            if ($processed % 25 === 0 && empty($onlyCids)) {
                $settings['reviews_sync_cursor'] = $cursor;
                $trendyolChannel->update(['settings' => $settings]);
            }

            // Delay between contentIds (with jitter)
            if ($processed < $targetCount) {
                $jitter = rand(0, (int) ($this->currentDelay * 0.3 * 1000));
                usleep($this->currentDelay * 1000000 + $jitter * 1000);
            }
        }

        // Save state (--content-ids hedefli calismada cursor/settings korunur)
        if (empty($onlyCids)) {
            $settings['reviews_sync_cursor'] = $cursor;
            $settings['reviews_synced_at'] = now()->toISOString();
            $trendyolChannel->update(['settings' => $settings]);
        }

        // Report
        $this->newLine(2);
        $this->info('Sonuc:');
        $this->table(
            ['Metrik', 'Adet'],
            [
                ['Islenen contentId', $this->contentIdsProcessed],
                ['Atlanan (puan degismedi)', $this->skippedUnchanged],
                ['Atlanan (TY\'de yorum yok)', $this->skippedNoReviews],
                ['Islenen urun', $this->productsProcessed],
                ['Yeni yorum', $this->reviewsCreated],
                ['Atlanan yorum (duplicate)', $this->reviewsSkipped],
                ['Ozet guncellenen', $this->summariesUpserted],
            ]
        );

        Log::info('trendyol:sync-reviews tamamlandi', [
            'mode' => $mode,
            'tenant_id' => $trendyolChannel->tenant_id,
            'channel_id' => $trendyolChannel->id,
            'content_ids_processed' => $this->contentIdsProcessed,
            'products_processed' => $this->productsProcessed,
            'reviews_created' => $this->reviewsCreated,
            'summaries_upserted' => $this->summariesUpserted,
            'rate_limit_hits' => $this->rateLimitHits,
            'cursor' => $cursor,
        ]);
    }

    /**
     * Fiyat taramasindan gelen guncel Trendyol ortalama puani, en son yorum
     * sync'indeki ortalamayla (2 ondalik) ayniysa yorumlar degismemis sayilir.
     * (maximedupre reviewCount dondurmediginden puan sinyali kullaniliyor.)
     */
    protected function reviewsUnchanged(Product $product): bool
    {
        $summary = $product->reviewSummary;

        // Ozet yoksa, hic yorum-sync olmadiysa veya guncel puan bilinmiyorsa: tara.
        if (! $summary || $product->trendyol_rating === null || $summary->reviews_synced_rating === null) {
            return false;
        }

        // Ikisi de ayni kaynaktan (maximedupre, 3 ondalik) → tam karsilastirma.
        return round((float) $product->trendyol_rating, 3) === round((float) $summary->reviews_synced_rating, 3);
    }

    /**
     * Fiyat taramasi bu urunu gormus (trendyol_price_synced_at dolu) ama puan
     * bos/0 ise Trendyol'da hic yorum yoktur; DB'de de yorum yoksa aktoru cagirmak
     * hem bosa maliyet hem caa_software'in 0-yorum crash'ine (exit 91) yem olur.
     */
    protected function hasNoReviewsOnTrendyol(Product $product): bool
    {
        if ($product->trendyol_price_synced_at === null) {
            return false; // fiyat taramasi gormemis, bilemeyiz
        }

        if ((float) $product->trendyol_rating > 0) {
            return false;
        }

        $summary = $product->reviewSummary;

        return ! $summary || (int) $summary->rate_count === 0;
    }

    /**
     * @return string 'success'|'failed'|'rate_limited'
     */
    protected function syncProductReviews(ApifyService $service, Product $product, int $contentId, string $mode): string
    {
        $page = 0;
        $totalPages = 1;
        $summaryData = null;

        while ($page < $totalPages) {
            $response = $service->getProductReviews($contentId, $page, 30, $this->maxPerCid[$contentId] ?? null);

            // Rate limited — return signal to caller
            if (is_array($response) && isset($response['retry_after'])) {
                $retryAfter = $response['retry_after'];
                $this->rateLimitHits++;

                // Increase delay for future requests
                $this->currentDelay = min($this->currentDelay + 3, 15);

                // Wait the Retry-After duration + small buffer
                $waitTime = $retryAfter + 30;
                $this->warn("\n  429 Rate Limited! Retry-After: {$retryAfter}s — {$waitTime}s bekleniyor (delay arttirildi: {$this->currentDelay}s)");
                sleep($waitTime);

                return 'rate_limited';
            }

            if ($response === null) {
                $this->warn(" — API hatasi");
                return 'failed';
            }

            $result = $response['result'] ?? $response;
            $summary = $result['contentSummary'] ?? [];
            $reviewsData = $result['productReviews'] ?? [];
            $aiSummary = $result['aiSummary'] ?? null;

            // First page: upsert summary and check for changes
            if ($page === 0) {
                $summaryData = ['contentSummary' => $summary, 'aiSummary' => $aiSummary];
                if (! isset($this->secondaryCids[$contentId])) {
                    $this->upsertSummary($product, $contentId, $summary, $aiSummary);
                }

                $rateCount = (int) ($summary['totalRatingCount'] ?? 0);

                // Incremental: skip if rate_count hasn't changed
                if ($mode === 'incremental' && $product->reviewSummary && $product->reviewSummary->rate_count === $rateCount) {
                    $this->output->write(" — degisiklik yok ({$rateCount})");
                    $this->processedContentIds[$contentId] = $summaryData;
                    return 'success';
                }
            }

            $reviews = $reviewsData['content'] ?? [];

            if (empty($reviews) && $page === 0) {
                $this->output->write(" — yorum yok");
                $this->processedContentIds[$contentId] = $summaryData;
                return 'success';
            }

            $newBefore = $this->reviewsCreated;
            foreach ($reviews as $review) {
                $this->processReview($product, $contentId, $review);
            }
            $newInPage = $this->reviewsCreated - $newBefore;

            // Sayfa ust siniri: 541 sayfali urunlerde her sayfa ayri Apify cagrisi
            // olacagindan hard cap ile korunur.
            $totalPages = min((int) ($reviewsData['totalPages'] ?? 1), $this->maxPages);
            $page++;

            // Bu sayfada yeni yorum yoksa gerisi zaten DB'de → dur (backfill yapma,
            // "en yeni tarihe gelince dur" kurali). caa yorumlari tarih-azalan sirali.
            if ($newInPage === 0) {
                break;
            }

            if ($page < $totalPages) {
                $pageDelay = max(1, (int) ($this->currentDelay * 0.6));
                usleep($pageDelay * 1000000);
            }
        }

        $this->output->write(" — {$page} sayfa OK");

        // Cache for other products with same contentId
        $this->processedContentIds[$contentId] = $summaryData;

        return 'success';
    }

    protected function copySummaryFromCache(Product $product, int $contentId, ?array $summaryData): void
    {
        if ($summaryData) {
            $this->upsertSummary($product, $contentId, $summaryData['contentSummary'] ?? $summaryData, $summaryData['aiSummary'] ?? null);
        }
    }

    protected function upsertSummary(Product $product, int $contentId, array $summary, ?string $aiSummary = null): void
    {
        $values = [
            'tenant_id' => $product->tenant_id,
            'trendyol_content_id' => $contentId,
            'last_synced_at' => now(),
            // Gate icin: yorumlarin senkronize edildigi andaki guncel puan (maximedupre kaynakli).
            'reviews_synced_rating' => $product->trendyol_rating,
        ];

        // maximedupre ozet sayilarini her zaman dondurmuyor (reviewCount NULL
        // gorulmustu) — anahtar yoksa yazma ki mevcut degerler sifirlanmasin
        // (insert'te DB default'u 0 devreye girer).
        if (isset($summary['averageRating'])) {
            $values['avg_rate'] = $summary['averageRating'];
        }
        if (isset($summary['totalRatingCount'])) {
            $values['rate_count'] = (int) $summary['totalRatingCount'];
        }
        if (isset($summary['totalCommentCount'])) {
            $values['comment_count'] = (int) $summary['totalCommentCount'];
        } elseif (isset($summary['totalRatingCount'])) {
            $values['comment_count'] = (int) $summary['totalRatingCount'];
        }

        // AI ozeti sadece verildiyse yaz (mevcut ozeti ezme).
        if ($aiSummary !== null) {
            $values['ai_summary'] = $aiSummary;
        }

        // Yildiz dagilimi (ratingCounts) yalnizca gelirse guncelle; gelmezse mevcut
        // degerleri koru (caa_software dagilimi dondurmuyor → sifirlanmasin).
        $ratingCounts = $summary['ratingCounts'] ?? [];
        if (! empty($ratingCounts)) {
            $buckets = ['rate_five' => 0, 'rate_four' => 0, 'rate_three' => 0, 'rate_two' => 0, 'rate_one' => 0];
            foreach ($ratingCounts as $item) {
                $count = (int) ($item['count'] ?? 0);
                match ((int) ($item['rate'] ?? 0)) {
                    5 => $buckets['rate_five'] = $count,
                    4 => $buckets['rate_four'] = $count,
                    3 => $buckets['rate_three'] = $count,
                    2 => $buckets['rate_two'] = $count,
                    1 => $buckets['rate_one'] = $count,
                    default => null,
                };
            }
            $values = array_merge($values, $buckets);
        }

        ProductReviewSummary::updateOrCreate(
            ['product_id' => $product->id],
            $values
        );

        $this->summariesUpserted++;
    }

    protected function processReview(Product $product, int $contentId, array $review): void
    {
        $platformReviewId = ! empty($review['id'])
            ? (string) $review['id']
            : md5("{$contentId}|" . ($review['userFullName'] ?? '') . '|' . ($review['comment'] ?? ''));

        $userName = $review['userFullName'] ?? '';
        $comment = $review['comment'] ?? '';
        $images = $review['mediaFiles'] ?? [];

        $sellerReply = null;
        if (! empty($review['sellerReply'])) {
            $sellerReply = is_array($review['sellerReply'])
                ? ($review['sellerReply']['comment'] ?? $review['sellerReply']['text'] ?? null)
                : $review['sellerReply'];
        }

        $reviewedAt = null;
        if (! empty($review['commentDateISOtype'])) {
            try {
                $reviewedAt = \Carbon\Carbon::parse($review['commentDateISOtype']);
            } catch (\Exception $e) {
                // ignore
            }
        }

        try {
            // Dedup tenant içinde platform_review_id ile (product_id degil) —
            // ayni contentId'yi paylasan urunlerde duplicate engellenir. Tenant
            // filtresi sart: iki tenant ayni Trendyol urununu satarsa ayni
            // platform_review_id iki tenant'ta da mesru olarak var olabilir.
            $result = ProductReview::updateOrCreate(
                [
                    'tenant_id' => $product->tenant_id,
                    'platform_review_id' => $platformReviewId,
                ],
                [
                    'product_id' => $product->id,
                    'trendyol_content_id' => $contentId,
                    'rate' => (int) ($review['rate'] ?? 0),
                    'user_full_name' => $userName ?: null,
                    'comment' => $comment ?: null,
                    'comment_date_text' => $review['lastModifiedDate'] ?? null,
                    'reviewed_at' => $reviewedAt,
                    'images' => $images,
                    'like_count' => (int) ($review['reviewLikeCount'] ?? 0),
                    'seller_reply' => $sellerReply,
                ]
            );

            if ($result->wasRecentlyCreated) {
                $this->reviewsCreated++;
            } else {
                $this->reviewsSkipped++;
            }
        } catch (\Exception $e) {
            $this->reviewsSkipped++;
            Log::debug('trendyol:sync-reviews yorum kayit hatasi', [
                'product_id' => $product->id,
                'platform_review_id' => $platformReviewId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
