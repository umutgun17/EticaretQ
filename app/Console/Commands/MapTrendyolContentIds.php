<?php

namespace App\Console\Commands;

use App\Models\Channel;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MapTrendyolContentIds extends Command
{
    protected $signature = 'trendyol:map-content-ids
                            {--dry-run : Sadece rapor goster, DB guncelleme}
                            {--delay=2 : Istekler arasi bekleme (saniye)}
                            {--skip-detail : Sadece search API ile contentId topla, detail API cagirma}
                            {--retry-errors : Sadece daha once eslesmemis contentId leri tekrar dene}';

    protected $description = 'Trendyol public API ile tum seller urunlerini tarayip barkod bazli contentId eslestirir';

    protected int $matched = 0;
    protected int $unmatched = 0;
    protected int $updated = 0;
    protected int $errors = 0;

    protected string $userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    protected function tokenSimilarity(string $a, string $b): float
    {
        $tokensA = array_unique(preg_split('/\s+/', mb_strtolower(trim($a))));
        $tokensB = array_unique(preg_split('/\s+/', mb_strtolower(trim($b))));
        $common = count(array_intersect($tokensA, $tokensB));
        $union = count(array_unique(array_merge($tokensA, $tokensB)));

        return $union > 0 ? $common / $union : 0;
    }

    protected function browserHeaders(): array
    {
        return [
            'User-Agent' => $this->userAgent,
            'Accept' => 'application/json, text/plain, */*',
            'Accept-Language' => 'tr-TR,tr;q=0.9,en-US;q=0.8',
            'Referer' => 'https://www.trendyol.com/',
            'Origin' => 'https://www.trendyol.com',
            'Sec-Fetch-Dest' => 'empty',
            'Sec-Fetch-Mode' => 'cors',
            'Sec-Fetch-Site' => 'same-site',
            'Sec-Ch-Ua' => '"Google Chrome";v="131", "Chromium";v="131"',
            'Sec-Ch-Ua-Mobile' => '?0',
            'Sec-Ch-Ua-Platform' => '"Windows"',
        ];
    }

    public function handle(): int
    {
        $trendyolChannel = Channel::withoutGlobalScopes()
            ->where('type', 'trendyol-product')
            ->where('is_active', true)
            ->first();

        if (! $trendyolChannel) {
            $this->error('Aktif trendyol-product kanali bulunamadi.');
            return 1;
        }

        // Ticimax kanali Trendyol kanaliyla AYNI tenant'tan secilmeli; aksi halde
        // iki farkli tenant'in kanallari eslesip contentId'ler yanlis tenant'in
        // urunlerine yazilir.
        $ecommerceChannel = Channel::withoutGlobalScopes()
            ->where('type', 'ticimax-ecommerce')
            ->where('tenant_id', $trendyolChannel->tenant_id)
            ->where('is_active', true)
            ->first();

        if (! $ecommerceChannel) {
            $this->error('Ayni tenant\'ta aktif ticimax-ecommerce kanali bulunamadi.');
            return 1;
        }

        $sellerId = $trendyolChannel->credentials['seller_id'] ?? '';
        $isDryRun = $this->option('dry-run');
        $delay = (int) $this->option('delay');
        $skipDetail = $this->option('skip-detail');
        $retryErrors = $this->option('retry-errors');

        $this->info($isDryRun ? 'DRY RUN modu' : 'Eslestirme baslatiliyor...');

        // Step 1: Trendyol public search API ile tüm contentId'leri topla
        $this->info('Adim 1: Trendyol seller urunleri taraniyor (mid=' . $sellerId . ')...');
        $trendyolProducts = $this->fetchAllSellerProducts($sellerId, $delay);

        if (empty($trendyolProducts)) {
            $this->error('Trendyol\'dan urun cekilemedi.');
            return 1;
        }

        $this->info(count($trendyolProducts) . ' urun bulundu.');

        // Keep all products for URL/image data (before filtering)
        $allTrendyolProducts = $trendyolProducts;

        // If retry-errors, filter to only contentIds not yet mapped
        if ($retryErrors) {
            $mappedContentIds = collect(DB::select("SELECT DISTINCT (metadata->>'trendyol_content_id')::int as cid FROM products WHERE metadata->>'trendyol_content_id' IS NOT NULL"))
                ->pluck('cid')
                ->toArray();

            $before = count($trendyolProducts);
            $trendyolProducts = array_values(array_filter(
                $trendyolProducts,
                fn ($p) => ! in_array($p['contentId'], $mappedContentIds)
            ));
            $this->info("--retry-errors: " . count($trendyolProducts) . " eslesmemis contentId (onceki: {$before})");

            if (empty($trendyolProducts)) {
                $this->info('Tum contentId\'ler zaten eslesmis, yeni eslesme gerekli degil.');
                // Still continue to update URLs/images for existing matches
            }
        }

        // Step 2: Build barcode→contentId map via detail API
        if (! $skipDetail && ! empty($trendyolProducts)) {
            $this->info('Adim 2: Urun detaylari cekilip barkod eslestiriliyor...');
            $barcodeMap = $this->fetchBarcodeMap($trendyolProducts, $delay);
        } else {
            $this->info('Adim 2: Detail API atlandi' . ($skipDetail ? ' (--skip-detail)' : ' (urun yok)'));
            $barcodeMap = [];
        }

        // Step 3: Build local barcode → product_id map (raw query, memory-efficient)
        $this->info('Adim 3: Ticimax barkod indexi olusturuluyor...');
        $barcodeToProducts = [];
        $rows = DB::table('product_variants as v')
            ->join('products as p', 'v.product_id', '=', 'p.id')
            ->where('p.channel_id', $ecommerceChannel->id)
            ->whereNotNull('v.barcode')
            ->where('v.barcode', '!=', '')
            ->select('v.barcode', 'p.id as product_id')
            ->get();

        foreach ($rows as $row) {
            $barcodeToProducts[$row->barcode][] = $row->product_id;
        }
        $this->info(count($barcodeToProducts) . ' benzersiz barkod indexlendi.');

        // Build contentId → Trendyol data lookup (from ALL products, not filtered)
        $trendyolDataMap = []; // contentId → [url, images]
        foreach ($allTrendyolProducts as $tp) {
            $trendyolDataMap[$tp['contentId']] = [
                'url' => $tp['url'] ?? '',
                'images' => $tp['images'] ?? [],
            ];
        }

        // Step 4: Match barcodes
        $this->info('Adim 4: Eslestirme yapiliyor...');
        $productContentMap = []; // product_id → contentId

        foreach ($barcodeMap as $barcode => $contentId) {
            if (isset($barcodeToProducts[$barcode])) {
                foreach ($barcodeToProducts[$barcode] as $productId) {
                    $productContentMap[$productId] = $contentId;
                }
            }
        }

        $barcodeMatched = count($productContentMap);
        $this->info($barcodeMatched . ' urun barkod ile eslesti.');

        // Load existing mappings FIRST — prevents re-matching already mapped products
        $existingMapped = DB::select("SELECT id, (metadata->>'trendyol_content_id')::text as cid FROM products WHERE metadata->>'trendyol_content_id' IS NOT NULL");
        $usedContentIds = []; // contentIds already assigned (existing + barcode)
        foreach ($existingMapped as $row) {
            $cid = (int) $row->cid;
            if (! isset($productContentMap[$row->id])) {
                $productContentMap[$row->id] = $cid;
            }
            $usedContentIds[$cid] = true;
        }
        foreach ($productContentMap as $cid) {
            $usedContentIds[$cid] = true;
        }

        // ProductCode → SKU matching for remaining unmapped products
        // Group ALL contentIds per productCode (multiple colors share same code)
        $productCodeGroups = []; // productCode → [contentId => name, ...]
        foreach ($trendyolProducts as $tp) {
            $code = $tp['productCode'] ?? null;
            if ($code && $code !== '-') {
                $productCodeGroups[$code][$tp['contentId']] = $tp['name'] ?? '';
            }
        }

        $skuRows = DB::table('product_variants as v')
            ->join('products as p', 'v.product_id', '=', 'p.id')
            ->where('p.channel_id', $ecommerceChannel->id)
            ->whereNotNull('v.sku')
            ->where('v.sku', '!=', '')
            ->select('v.sku', 'p.id as product_id', 'p.name as product_name')
            ->get();

        $codeMatched = 0;
        foreach ($skuRows as $row) {
            if (isset($productContentMap[$row->product_id]) || ! isset($productCodeGroups[$row->sku])) {
                continue;
            }

            $candidates = $productCodeGroups[$row->sku];

            // Filter out already-used contentIds
            $available = array_filter($candidates, fn ($name, $cid) => ! isset($usedContentIds[$cid]), ARRAY_FILTER_USE_BOTH);

            if (empty($available)) {
                continue;
            }

            if (count($available) === 1) {
                $cid = array_key_first($available);
                $productContentMap[$row->product_id] = $cid;
                $usedContentIds[$cid] = true;
                $codeMatched++;
            } else {
                // Multiple contentIds — match by token similarity (Jaccard)
                $localName = $row->product_name ?? '';
                $bestId = null;
                $bestScore = -1;

                foreach ($available as $cid => $tName) {
                    $score = $this->tokenSimilarity($localName, $tName);
                    if ($score > $bestScore) {
                        $bestScore = $score;
                        $bestId = $cid;
                    }
                }

                if ($bestId !== null) {
                    $productContentMap[$row->product_id] = $bestId;
                    $usedContentIds[$bestId] = true;
                    $codeMatched++;
                }
            }
        }

        if ($codeMatched > 0) {
            $this->info("+ {$codeMatched} urun productCode/SKU ile eslesti.");
        }

        // Phase 3: Reuse matching — allow same contentId for products with different barcodes
        // Uses $productCodeGroups (built from post-detail-API $trendyolProducts) which has productCodes
        $reuseMatched = 0;
        foreach ($skuRows as $row) {
            if (isset($productContentMap[$row->product_id]) || ! isset($productCodeGroups[$row->sku])) {
                continue;
            }

            $candidates = $productCodeGroups[$row->sku]; // includes already-used contentIds
            $localName = $row->product_name ?? '';
            $bestId = null;
            $bestScore = -1;

            foreach ($candidates as $cid => $tName) {
                $score = $this->tokenSimilarity($localName, $tName);
                if ($score > $bestScore) {
                    $bestScore = $score;
                    $bestId = $cid;
                }
            }

            if ($bestId !== null) {
                $productContentMap[$row->product_id] = $bestId;
                $reuseMatched++;
            }
        }

        if ($reuseMatched > 0) {
            $this->info("+ {$reuseMatched} urun contentId reuse ile eslesti (farkli barkod, ayni urun).");
        }

        $this->matched = $barcodeMatched + $codeMatched + $reuseMatched;

        // Step 5: Update DB
        if (! $isDryRun && ! empty($productContentMap)) {
            $this->info('Adim 5: DB guncelleniyor...');
            $bar = $this->output->createProgressBar(count($productContentMap));
            $imgFilled = 0;

            foreach ($productContentMap as $productId => $contentId) {
                $trendyolData = $trendyolDataMap[$contentId] ?? [];
                $trendyolUrl = $trendyolData['url'] ?? '';
                $trendyolImages = $trendyolData['images'] ?? [];

                // Get current metadata and merge new values
                $currentMetadata = DB::table('products')->where('id', $productId)->value('metadata');
                $metadata = json_decode($currentMetadata, true) ?? [];
                $metadata['trendyol_content_id'] = (int) $contentId;
                if ($trendyolUrl) {
                    $metadata['trendyol_url'] = $trendyolUrl;
                }

                $updateData = [
                    'metadata' => json_encode($metadata),
                    'updated_at' => now(),
                ];

                // Fill empty images from Trendyol
                if (! empty($trendyolImages)) {
                    $currentImages = DB::table('products')->where('id', $productId)->value('images');
                    $current = json_decode($currentImages, true) ?? [];
                    if (empty($current)) {
                        $updateData['images'] = json_encode($trendyolImages);
                        $imgFilled++;
                    }
                }

                DB::table('products')
                    ->where('id', $productId)
                    ->update($updateData);
                $this->updated++;
                $bar->advance();
            }

            $bar->finish();
            $this->newLine();

            if ($imgFilled > 0) {
                $this->info("{$imgFilled} urunun bos resimleri Trendyol'dan dolduruldu.");
            }

            // Save state
            $settings = $trendyolChannel->settings ?? [];
            $settings['content_id_map_at'] = now()->toISOString();
            $settings['content_id_map_count'] = $this->matched;
            $settings['content_id_map_source'] = 'public_api';
            $trendyolChannel->update(['settings' => $settings]);
        }

        // Unmatched count
        $totalLocal = DB::table('products')->where('channel_id', $ecommerceChannel->id)->count();
        $this->unmatched = $totalLocal - $this->matched;

        // Report
        $uniqueContentIds = count(array_unique($productContentMap));
        $this->newLine();
        $this->info('Sonuc:');
        $this->table(
            ['Metrik', 'Adet'],
            [
                ['Trendyol urun (public API)', count($trendyolProducts)],
                ['Trendyol barkod', count($barcodeMap)],
                ['Ticimax toplam urun', $totalLocal],
                ['Eslesen urun', $this->matched],
                ['Benzersiz contentId', $uniqueContentIds],
                ['Eslesmeyenler', $this->unmatched],
                ['DB guncellenen', $this->updated],
                ['API hatalari', $this->errors],
            ]
        );

        if ($isDryRun) {
            $this->warn('DRY RUN — Degisiklik yapilmadi.');
        }

        Log::info('trendyol:map-content-ids tamamlandi', [
            'trendyol_products' => count($trendyolProducts),
            'barcodes' => count($barcodeMap),
            'matched' => $this->matched,
            'unique_content_ids' => $uniqueContentIds,
            'unmatched' => $this->unmatched,
            'updated' => $this->updated,
            'errors' => $this->errors,
            'dry_run' => $isDryRun,
        ]);

        return 0;
    }

    protected function fetchAllSellerProducts(string $sellerId, int $delay): array
    {
        $products = [];
        $page = 1;
        $totalPages = 1;

        while ($page <= $totalPages) {
            try {
                $response = Http::withHeaders($this->browserHeaders())
                ->withOptions(['curl' => [CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1]])
                ->timeout(15)
                ->get('https://apigw.trendyol.com/discovery-web-searchgw-service/v2/api/infinite-scroll/sr', [
                    'mid' => $sellerId,
                    'pi' => $page,
                ]);

                if ($response->status() === 429) {
                    $this->warn("  429 rate limited, 60s bekleniyor...");
                    sleep(60);
                    continue;
                }

                if ($response->failed()) {
                    $this->warn("  Sayfa {$page} hata: " . $response->status());
                    $this->errors++;
                    $page++;
                    sleep($delay);
                    continue;
                }

                $data = $response->json();
                $result = $data['result'] ?? [];
                $pageProducts = $result['products'] ?? [];
                $totalCount = $result['totalCount'] ?? 0;

                if ($page === 1 && count($pageProducts) > 0) {
                    $totalPages = (int) ceil($totalCount / count($pageProducts));
                }

                foreach ($pageProducts as $p) {
                    $contentId = $p['id'] ?? null;
                    if ($contentId) {
                        // Collect images from search API
                        $images = [];
                        if (! empty($p['images'])) {
                            foreach ($p['images'] as $img) {
                                $images[] = 'https://cdn.dsmcdn.com/mnresize/600/800/' . $img;
                            }
                        } elseif (! empty($p['image'])) {
                            $images[] = 'https://cdn.dsmcdn.com/mnresize/600/800/' . $p['image'];
                        }

                        $products[] = [
                            'contentId' => (int) $contentId,
                            'name' => $p['name'] ?? '',
                            'productGroupId' => $p['productGroupId'] ?? null,
                            'productCode' => $p['productCode'] ?? null,
                            'url' => $p['url'] ?? '',
                            'images' => $images,
                        ];
                    }
                }

                $this->output->write("\r  Sayfa {$page}/{$totalPages} — " . count($products) . ' urun');

            } catch (\Exception $e) {
                $this->warn("  Sayfa {$page} exception: " . $e->getMessage());
                $this->errors++;
            }

            $page++;

            if ($page <= $totalPages) {
                usleep($delay * 1000000);
            }
        }

        $this->newLine();

        return $products;
    }

    protected function fetchBarcodeMap(array &$trendyolProducts, int $delay): array
    {
        $barcodeMap = []; // barcode → contentId
        $productCodeMap = []; // will be added to trendyolProducts by reference
        $total = count($trendyolProducts);
        $processed = 0;

        foreach ($trendyolProducts as &$tp) {
            $processed++;
            $contentId = $tp['contentId'];

            try {
                $response = Http::withHeaders($this->browserHeaders())
                ->withOptions(['curl' => [CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1]])
                ->timeout(15)
                ->get("https://apigw.trendyol.com/discovery-web-productgw-service/api/productDetail/{$contentId}");

                if ($response->status() === 429) {
                    $this->warn("\n  429 rate limited, 60s bekleniyor...");
                    sleep(60);
                    // retry
                    $response = Http::withHeaders($this->browserHeaders())
                    ->withOptions(['curl' => [CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1]])
                    ->timeout(15)
                    ->get("https://apigw.trendyol.com/discovery-web-productgw-service/api/productDetail/{$contentId}");
                }

                if ($response->failed()) {
                    $this->errors++;
                    $this->output->write("\r  [{$processed}/{$total}] contentId={$contentId} — HATA " . $response->status());
                    sleep($delay);
                    continue;
                }

                $data = $response->json();
                $result = $data['result'] ?? $data;

                // Get productCode
                $productCode = $result['productCode'] ?? null;
                if ($productCode && $productCode !== '-') {
                    $tp['productCode'] = $productCode;
                }

                // Get all barcodes from allVariants
                $allVariants = $result['allVariants'] ?? $result['variants'] ?? [];
                $barcodeCount = 0;

                foreach ($allVariants as $variant) {
                    $barcode = $variant['barcode'] ?? null;
                    if ($barcode && $barcode !== '-') {
                        $barcodeMap[$barcode] = $contentId;
                        $barcodeCount++;
                    }
                }

                $this->output->write("\r  [{$processed}/{$total}] contentId={$contentId} — {$barcodeCount} barkod");

            } catch (\Exception $e) {
                $this->errors++;
                $this->output->write("\r  [{$processed}/{$total}] contentId={$contentId} — EXCEPTION");
            }

            if ($processed < $total) {
                usleep($delay * 1000000);
            }
        }

        $this->newLine();
        $this->info(count($barcodeMap) . ' benzersiz barkod toplandi.');

        return $barcodeMap;
    }
}
