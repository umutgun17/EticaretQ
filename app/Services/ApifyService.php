<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Apify aktorlerini senkron calistiran ince istemci.
 *
 * Trendyol'un yorum/urun public endpoint'leri Cloudflare arkasinda oldugu icin
 * (sunucu-tarafi 403/556), veri Apify uzerinden cekiliyor. Aktorler Trendyol'a
 * ozel scraping boru hattini (endpoint takibi + Cloudflare gecisi) kendileri
 * sürdürüyor; biz sadece calistirip dataset item'larini aliyoruz.
 */
class ApifyService
{
    protected string $token;
    protected string $baseUrl;
    protected int $runTimeout;

    // fatihtahta yorum sirasi (newest|oldest). 'oldest' = eski gecmis bosluklarini
    // doldurmak icin (yeniler zaten DB'de).
    public string $reviewSort = 'newest';

    public function __construct()
    {
        $this->token = (string) config('apify.token');
        $this->baseUrl = rtrim((string) config('apify.base_url'), '/');
        $this->runTimeout = (int) config('apify.run_timeout', 240);
    }

    public function isAvailable(): bool
    {
        return $this->token !== '';
    }

    /**
     * Uygulama tarafi butce freni: Apify aylik kullanimi APIFY_BUDGET_USD'yi
     * gectiyse yeni aktor calismasi baslatilmaz. Kullanici harcamayi kademeli
     * kontrol etmek istiyor (2026-07-06: "5 dolari gecince dur").
     * Kullanim sorgusu 60 sn cache'lenir (her aktorden once API'ye gitmemek icin).
     */
    public function budgetExceeded(): bool
    {
        $budget = config('apify.monthly_budget_usd');
        if (! $budget || ! $this->isAvailable()) {
            return false;
        }

        $usage = \Illuminate\Support\Facades\Cache::remember('apify_monthly_usage_usd', 60, function () {
            try {
                $r = Http::timeout(15)
                    ->withQueryParameters(['token' => $this->token])
                    ->get("{$this->baseUrl}/users/me/limits");

                return (float) $r->json('data.current.monthlyUsageUsd', 0);
            } catch (\Throwable) {
                return 0.0; // kullanim okunamazsa engelleme (Apify kendi hard limitine sahip)
            }
        });

        if ($usage >= (float) $budget) {
            Log::warning('ApifyService: BUTCE FRENI aktif — yeni aktor calismasi baslatilmadi', [
                'monthly_usage_usd' => $usage,
                'budget_usd' => (float) $budget,
            ]);

            return true;
        }

        return false;
    }

    /**
     * Bir aktoru senkron calistirir ve dataset item'larini dizi olarak dondurur.
     *
     * @return array<int,array>|null  Basarisizlikta null.
     */
    public function runActorSync(string $actor, array $input): ?array
    {
        if (! $this->isAvailable()) {
            Log::warning('ApifyService: APIFY_TOKEN tanimli degil.');
            return null;
        }

        if ($this->budgetExceeded()) {
            return null;
        }

        $url = "{$this->baseUrl}/acts/{$actor}/run-sync-get-dataset-items";
        $maxAttempts = 3;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $response = Http::timeout($this->runTimeout + 20)
                    ->connectTimeout(20)
                    ->withQueryParameters([
                        'token' => $this->token,
                        'timeout' => $this->runTimeout,
                    ])
                    ->post($url, $input);

                // Izin onaylanmamis — retry anlamsiz, hemen don.
                if ($response->status() === 403) {
                    $body = $response->json();
                    Log::error('ApifyService: aktor izni onaylanmamis', [
                        'actor' => $actor,
                        'approval_url' => $body['error']['data']['approvalUrl'] ?? null,
                        'message' => $body['error']['message'] ?? null,
                    ]);
                    return null;
                }

                if ($response->successful()) {
                    $items = $response->json();
                    return is_array($items) ? $items : null;
                }

                // Aktorun kendisi cokmus (or. caa_software 0-yorum KeyError, exit 91).
                // Ayni girdiyle tekrar denemek ayni sonucu verir — retry yakma.
                if (str_contains($response->body(), 'run-failed')) {
                    Log::warning('ApifyService: aktor calismasi FAILED (deterministik, retry yok)', [
                        'actor' => $actor,
                        'status' => $response->status(),
                        'body' => mb_substr($response->body(), 0, 300),
                    ]);
                    return null;
                }

                // Gecici hata (5xx, timeout vb.) — tekrar dene.
                Log::warning('ApifyService: aktor calismasi basarisiz', [
                    'actor' => $actor,
                    'status' => $response->status(),
                    'attempt' => $attempt,
                    'body' => mb_substr($response->body(), 0, 300),
                ]);
            } catch (\Throwable $e) {
                Log::warning('ApifyService: aktor calismasi istisna', [
                    'actor' => $actor,
                    'attempt' => $attempt,
                    'message' => $e->getMessage(),
                ]);
            }

            if ($attempt < $maxAttempts) {
                sleep(3 * $attempt);
            }
        }

        return null;
    }

    /**
     * Bir aktoru ASENKRON calistirir: run baslatir, bitene kadar bekler (poll),
     * sonra dataset item'larini dondurur. run-sync'in ~300sn limiti olmadigindan
     * buyuk batch'ler (onlarca URL) icin gereklidir.
     *
     * @return array<int,array>|null
     */
    public function runActorAsync(string $actor, array $input, int $maxWaitSeconds = 600): ?array
    {
        if ($this->budgetExceeded()) {
            return null;
        }

        try {
            // 1) Run baslat
            $start = Http::timeout(30)
                ->withQueryParameters(['token' => $this->token])
                ->post("{$this->baseUrl}/acts/{$actor}/runs", $input);

            if ($start->status() === 403) {
                Log::error('ApifyService: aktor izni onaylanmamis (async)', ['actor' => $actor]);
                return null;
            }
            if (! $start->successful()) {
                Log::warning('ApifyService: async run baslatilamadi', [
                    'actor' => $actor, 'status' => $start->status(),
                ]);
                return null;
            }

            $run = $start->json('data');
            $runId = $run['id'] ?? null;
            $datasetId = $run['defaultDatasetId'] ?? null;
            if (! $runId || ! $datasetId) {
                return null;
            }

            // 2) Bitene kadar poll
            $deadline = time() + $maxWaitSeconds;
            $status = $run['status'] ?? 'RUNNING';
            while (! in_array($status, ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'], true)) {
                if (time() > $deadline) {
                    Log::warning('ApifyService: async run zaman asimi', ['actor' => $actor, 'run' => $runId]);
                    return null;
                }
                sleep(5);
                $poll = Http::timeout(30)
                    ->withQueryParameters(['token' => $this->token])
                    ->get("{$this->baseUrl}/actor-runs/{$runId}");
                $status = $poll->json('data.status', 'RUNNING');
            }

            if ($status !== 'SUCCEEDED') {
                Log::warning('ApifyService: async run basarisiz', ['actor' => $actor, 'status' => $status]);
                // Yine de kismi dataset'i almayi dene.
            }

            // 3) Dataset item'larini cek
            $items = Http::timeout(60)
                ->withQueryParameters(['token' => $this->token, 'clean' => 'true', 'format' => 'json'])
                ->get("{$this->baseUrl}/datasets/{$datasetId}/items")
                ->json();

            return is_array($items) ? $items : null;
        } catch (\Throwable $e) {
            Log::error('ApifyService: async run istisna', ['actor' => $actor, 'message' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * contentId'den kanonik olmayan ama gecerli bir Trendyol urun URL'i kurar.
     * Trendyol -p-{contentId} son ekiyle urunu cozer; slug onemli degildir.
     */
    public function buildProductUrl(int $contentId): string
    {
        return "https://www.trendyol.com/x/x-p-{$contentId}";
    }

    /**
     * Tek bir urun icin fiyat/stok/puan bilgisini ceker (yorumsuz, ucuz).
     * maximedupre~trendyol-scraper 'product' satirini dondurur.
     */
    public function fetchProduct(int $contentId, ?string $productUrl = null): ?array
    {
        $actor = (string) config('apify.actors.product');
        $url = $productUrl ?: $this->buildProductUrl($contentId);

        // Aktor 0.2.43 (2026-07-23) semasi: target zorunlu, startUrls yerine
        // productUrls; include* bayraklari nesnelere tasindi.
        $items = $this->runActorSync($actor, [
            'target' => 'product_urls',
            'productUrls' => [['url' => $url]],
            'maxProductsPerSource' => 1,
        ]);

        if ($items === null) {
            return null;
        }

        foreach ($items as $item) {
            if (($item['recordType'] ?? null) === 'product') {
                return $item;
            }
        }

        return null;
    }

    /**
     * Coklu urunu tek aktor calismasinda ceker (baslangic ucretini amorti eder).
     *
     * @param  array<int,string>  $urls  Trendyol urun URL'leri
     * @return array<int|string,array>|null  productId => product satiri; basarisizlikta null
     */
    public function fetchProductsBatch(array $urls): ?array
    {
        if (empty($urls)) {
            return [];
        }

        $actor = (string) config('apify.actors.product');

        // Buyuk batch'ler run-sync'in ~300sn limitini asabildiginden async calisir.
        // 40'lik batch'ler nadiren 15 dk'yi da asiyor (2026-07-06'da 3 kez) —
        // timeout'ta para odenmis ama veri alinmamis oluyor; sinir genis tutuldu.
        $items = $this->runActorAsync($actor, [
            'target' => 'product_urls',
            'productUrls' => array_map(fn ($u) => ['url' => $u], array_values($urls)),
            'maxProductsPerSource' => 1,
        ], 2400);

        if ($items === null) {
            return null;
        }

        $byId = [];
        foreach ($items as $item) {
            if (($item['recordType'] ?? null) === 'product' && ! empty($item['productId'])) {
                $byId[(string) $item['productId']] = $item;
            }
        }

        return $byId;
    }

    /**
     * Magaza vitrinini (sr?mid=sellerId) tarayip guncel urun listesini dondurur.
     * Listing satirlari barkod ICERMEZ — productId(=contentId), isim, url, fiyat,
     * puan gelir. Barkod eslestirmesi icin yeni cid'lere fetchProductsBatch gerekir.
     *
     * @return array<int,array>|null  product satirlari; basarisizlikta null
     */
    public function discoverSellerProducts(string $sellerId, int $maxProducts = 4000, ?callable $onPage = null): ?array
    {
        $actor = (string) config('apify.actors.product');

        // Aktor tek calismada listing sayfalamasi YAPMIYOR (maxProducts kac olursa
        // olsun 1 sayfa ~24 urun donuyor; coklu listing URL de guvenilmez —
        // 2026-07-13 testinde 2 URL'den yalniz biri islendi). Bu yuzden pi=1..N
        // sayfalarini ayri calismalarla geziyoruz; 2 ardisik sayfa yeni urun
        // getirmeyince (vitrin sonu) dururuz.
        $byId = [];
        $emptyStreak = 0;
        $failStreak = 0;
        $maxPages = 150;

        for ($page = 1; $page <= $maxPages; $page++) {
            if ($this->budgetExceeded()) {
                Log::warning('ApifyService: kesif butce frenine takildi', ['page' => $page]);
                break;
            }

            // Tek sayfa hatasi (or. aktor TIMED-OUT) tum kesfi kesmesin: sayfayi
            // 3 kez dene, olmuyorsa ATLA ve devam et; ancak 3 ARDISIK sayfa
            // basarisizsa vazgec (2026-07-13: sayfa 22 TIMED-OUT ile koptu).
            $items = null;
            for ($attempt = 1; $attempt <= 3 && $items === null; $attempt++) {
                if ($attempt > 1) {
                    sleep(10);
                }
                // Yeni semada maxProductsPerSource varsayilani 4 — listing
                // sayfasinin tamami (~24 urun) icin acikca yuksek verilmeli.
                $items = $this->runActorSync($actor, [
                    'target' => 'search_urls',
                    'searchUrls' => [['url' => "https://www.trendyol.com/sr?mid={$sellerId}&pi={$page}"]],
                    'maxProductsPerSource' => 100,
                ]);
            }

            if ($items === null) {
                $failStreak++;
                Log::warning('ApifyService: kesif sayfasi 3 denemede basarisiz, atlaniyor', [
                    'page' => $page, 'fail_streak' => $failStreak,
                ]);
                if ($failStreak >= 3) {
                    // ilk sayfalardan beri hic veri yoksa toptan hata
                    if (empty($byId)) {
                        return null;
                    }
                    Log::warning('ApifyService: 3 ardisik sayfa basarisiz, eldekiyle devam', ['page' => $page]);
                    break;
                }
                continue;
            }
            $failStreak = 0;

            $newOnPage = 0;
            foreach ($items as $item) {
                if (($item['recordType'] ?? null) !== 'product' || empty($item['productId'])) {
                    continue;
                }
                $cid = (string) $item['productId'];
                if (! isset($byId[$cid])) {
                    $byId[$cid] = $item;
                    $newOnPage++;
                }
            }

            if ($onPage) {
                $onPage($page, $newOnPage, count($byId));
            }

            $emptyStreak = $newOnPage === 0 ? $emptyStreak + 1 : 0;
            if ($emptyStreak >= 2 || count($byId) >= $maxProducts) {
                break;
            }
        }

        return array_values($byId);
    }

    /**
     * Bir contentId icin yorum sayfasini ceker (caa_software aktoru).
     * Ham dataset item'larini dondurur; sekil dogrulamasi cagirana birakilir.
     *
     * @return array<int,array>|null
     */
    public function fetchReviewsRaw(int $contentId, int $page = 0, int $pageSize = 30): ?array
    {
        $actor = (string) config('apify.actors.reviews');

        return $this->runActorSync($actor, [
            'productId' => (string) $contentId,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    /**
     * Yorumlari, SyncTrendyolReviews'in bekledigi sekle normalize ederek dondurur:
     *   ['result' => ['contentSummary' => [...], 'productReviews' => ['content' => [...], 'totalPages' => N]]]
     *
     * KAYNAK DEGISTI (2026-07-06): caa_software ($0.075/run) yerine maximedupre
     * ($0.0005/yorum + $0.001/run) — ayni aktor fiyat taramasinda da kullaniliyor.
     * maximedupre sayfalama desteklemez: tek calismada en yeni maxReviewsPerProduct
     * yorumu doner → totalPages hep 1, page>0 istekleri bos doner (komutun
     * yeni-yorum-bitince-dur mantigi tek sayfada isler).
     *
     * DIKKAT: maximedupre urun satirinda reviewCount NULL donebiliyor; ozet
     * sayilari yoksa contentSummary'ye HIC konmaz ki upsertSummary mevcut
     * rate_count/comment_count'u sifirlamasin.
     *
     * Yorum satiri alan adlari (dokumante: reviewText, reviewDate, reviewerName,
     * isVerifiedPurchase, helpfulCount, images, productId) processReview'in
     * bekledigi adlara cevrilir; bilinmeyen varyantlar icin savunmaci ?? zinciri
     * kullanilir. GERCEK SEKIL ILK UCRETLI CAGRIDA DOGRULANMALI (kredi bitince
     * test yapilamadi, 2026-07-06).
     *
     * @return array|null  Basarisizlikta null.
     */
    public function getProductReviews(int $contentId, int $page = 0, int $pageSize = 30, ?int $maxReviews = null): ?array
    {
        if ($page > 0) {
            return ['result' => [
                'contentSummary' => [],
                'productReviews' => ['content' => [], 'totalPages' => 1],
            ]];
        }

        $maxReviews = max(1, $maxReviews ?? (int) config('apify.max_reviews_per_product', 100));

        if ((string) config('apify.actors.reviews_newest') !== '') {
            return $this->getProductReviewsNewest($contentId, $maxReviews);
        }

        $actor = (string) config('apify.actors.product');

        $input = [
            'target' => 'product_urls',
            'productUrls' => [['url' => $this->buildProductUrl($contentId)]],
            'maxProductsPerSource' => 1,
            'reviews' => ['enabled' => true, 'maxPerProduct' => $maxReviews],
        ];
        // fatihtahta urun basina en fazla 40 yorum veriyor; tam gecmis (backfill)
        // icin APIFY_ACTOR_REVIEWS_NEWEST bos birakilip bu yol kullanilir.
        // Buyuk cekimde sync zaman asimi 3x retry = 3x ucret → async.
        $items = $maxReviews > 200
            ? $this->runActorAsync($actor, $input, 3600)
            : $this->runActorSync($actor, $input);

        if ($items === null) {
            return null;
        }

        $summary = [];
        $reviews = [];

        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            if (($item['recordType'] ?? null) === 'product') {
                $summary = $this->summaryFromProductRow($item);
                continue;
            }

            // Yorum satiri: recordType 'review' (0.2.43+) veya reviewText/comment
            // tasiyan product-disi her item (eski format).
            if (($item['recordType'] ?? null) !== 'review'
                && ! isset($item['reviewText']) && ! isset($item['comment'])) {
                continue;
            }

            $reviews[] = $this->normalizeMaxiReview($item);
        }

        // Stop-at-known mantigi en-yeni-once sirali bekler; tarih varsa garantile.
        usort($reviews, function ($a, $b) {
            return strcmp((string) ($b['commentDateISOtype'] ?? ''), (string) ($a['commentDateISOtype'] ?? ''));
        });

        return ['result' => [
            'contentSummary' => $summary,
            'productReviews' => [
                'content' => $reviews,
                'totalPages' => 1,
            ],
        ]];
    }

    /**
     * fatihtahta aktoru: yorumlar EN YENI ONCE (reviewSort=newest) gelir, boylece
     * yalniz yeni yorum sayisi kadar istemek yeterli (maliyet = yeni yorum).
     * Sekil 2026-10-15 canli testle dogrulandi: product satiri
     * metrics.rating.{average_rating,total_count,comment_count}; review satiri
     * review_id, rating, comment, created_at(ms), reviewer.name,
     * metrics.likes_count, media.files[].url. review_id = Trendyol yorum id'si
     * (maximedupre ile ayni) → duplicate kontrolu bozulmaz.
     */
    protected function getProductReviewsNewest(int $contentId, int $maxReviews): ?array
    {
        $input = [
            'startUrls' => [['url' => $this->buildProductUrl($contentId)]],
            'getReviews' => true,
            'maxReviews' => $maxReviews,
            'reviewSort' => $this->reviewSort,
            'limit' => 10, // aktor minimumu; tek urun URL'inde 1 urun doner
        ];
        $actor = (string) config('apify.actors.reviews_newest');

        // Buyuk cekimler run-sync'in ~300 sn sinirini asabilir; sync zaman asiminda
        // 3 kez yeniden denenip 3 kez UCRETLENIR → async (poll) ile tek calisma.
        $items = $maxReviews > 200
            ? $this->runActorAsync($actor, $input, 3600)
            : $this->runActorSync($actor, $input);

        if ($items === null) {
            return null;
        }

        $summary = [];
        $reviews = [];

        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            if (($item['type'] ?? null) === 'product') {
                $rating = $item['metrics']['rating'] ?? [];
                if (isset($rating['average_rating'])) {
                    $summary['averageRating'] = (float) $rating['average_rating'];
                }
                if (isset($rating['total_count'])) {
                    $summary['totalRatingCount'] = (int) $rating['total_count'];
                }
                if (isset($rating['comment_count'])) {
                    $summary['totalCommentCount'] = (int) $rating['comment_count'];
                }
                continue;
            }

            if (($item['type'] ?? null) !== 'review') {
                continue;
            }

            $row = $this->normalizeMaxiReview([
                'id' => $item['review_id'] ?? $item['id'] ?? null,
                'reviewerName' => $item['reviewer']['name'] ?? null,
                'reviewText' => $item['comment'] ?? null,
                'rating' => $item['rating'] ?? 0,
                'images' => array_values(array_filter(array_map(
                    fn ($f) => is_array($f) ? ($f['url'] ?? null) : null,
                    $item['media']['files'] ?? []
                ))),
                'helpfulCount' => $item['metrics']['likes_count'] ?? 0,
                'reviewDate' => $item['created_at'] ?? null,
            ]);
            $reviews[] = $row;
        }

        usort($reviews, function ($a, $b) {
            return strcmp((string) ($b['commentDateISOtype'] ?? ''), (string) ($a['commentDateISOtype'] ?? ''));
        });

        return ['result' => [
            'contentSummary' => $summary,
            'productReviews' => [
                'content' => $reviews,
                'totalPages' => 1,
            ],
        ]];
    }

    /**
     * maximedupre urun satirindan ozet cikarir. Sayi alanlari yoksa anahtar
     * eklenmez (upsertSummary mevcut degeri korur).
     */
    protected function summaryFromProductRow(array $item): array
    {
        $summary = [];

        if (isset($item['rating']) && $item['rating'] !== null) {
            $summary['averageRating'] = (float) $item['rating'];
        }

        $rateCount = $item['ratingCount'] ?? $item['reviewCount'] ?? $item['totalRatingCount'] ?? null;
        if ($rateCount !== null) {
            $summary['totalRatingCount'] = (int) $rateCount;
        }

        $commentCount = $item['commentCount'] ?? $item['totalCommentCount'] ?? null;
        if ($commentCount !== null) {
            $summary['totalCommentCount'] = (int) $commentCount;
        }

        return $summary;
    }

    /**
     * maximedupre yorum satirini processReview'in bekledigi eski API sekline cevirir.
     */
    protected function normalizeMaxiReview(array $item): array
    {
        $rawDate = $item['reviewDate'] ?? $item['createdAt'] ?? $item['date'] ?? null;
        $iso = null;
        $dateText = null;

        if (is_numeric($rawDate)) {
            // Epoch: 13 hane ms, 10 hane sn.
            $carbon = $rawDate > 20000000000
                ? \Carbon\Carbon::createFromTimestampMs((int) $rawDate)
                : \Carbon\Carbon::createFromTimestamp((int) $rawDate);
            $iso = $carbon->toIso8601String();
            $dateText = $carbon->format('d.m.Y');
        } elseif (is_string($rawDate) && $rawDate !== '') {
            try {
                $carbon = \Carbon\Carbon::parse($rawDate);
                $iso = $carbon->toIso8601String();
                $dateText = $carbon->format('d.m.Y');
            } catch (\Throwable) {
                $dateText = $rawDate; // parse edilemedi, ham metni sakla
            }
        }

        return [
            'id' => $item['id'] ?? $item['reviewId'] ?? null,
            'userFullName' => $item['reviewerName'] ?? $item['userFullName'] ?? null,
            'comment' => $item['reviewText'] ?? $item['comment'] ?? $item['text'] ?? null,
            'rate' => $item['rating'] ?? $item['rate'] ?? $item['reviewRating'] ?? 0,
            'mediaFiles' => $item['images'] ?? $item['mediaFiles'] ?? $item['mediaUrls'] ?? [],
            'reviewLikeCount' => $item['helpfulCount'] ?? $item['likesCount'] ?? 0,
            'commentDateISOtype' => $iso,
            'lastModifiedDate' => $dateText,
        ];
    }
}
