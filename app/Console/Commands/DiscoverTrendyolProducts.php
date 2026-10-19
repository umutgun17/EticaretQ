<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Services\ApifyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Trendyol magaza vitrinini Apify uzerinden tarayip YENI urunlerin contentId
 * eslestirmesini yapar. Eski trendyol:map-content-ids'in Apify muadili —
 * public API Cloudflare arkasina alindigi icin (403) o komut olu.
 *
 * Akis: vitrin kesfi (ucuz, barkodsuz) → bilinen cid'lerle fark al → SADECE yeni
 * cid'ler icin detay cek (variants[].barcode) → barkodla lokal urune esle →
 * metadata + fiyat alanlarini yaz → ayri JSON raporu kaydet →
 * istenirse (--sync-reviews) sadece bu yeni cid'ler icin yorum sync'i calistir.
 */
class DiscoverTrendyolProducts extends Command
{
    protected $signature = 'trendyol:discover-products
                            {--dry-run : Sadece rapor goster, DB guncelleme}
                            {--max-products=4000 : Vitrin kesfinde toplanacak max urun}
                            {--detail-batch=40 : Detay cekiminde tek Apify calismasina kac urun}
                            {--channel= : Sadece bu Trendyol kanal ID islensin}
                            {--sync-reviews : Eslesen yeni urunler icin yorum sync\'ini hemen calistir}';

    protected $description = 'Trendyol vitrininde yeni urunleri kesfedip contentId eslestirir (Apify)';

    public function handle(ApifyService $apify): int
    {
        if (! $apify->isAvailable()) {
            $this->error('APIFY_TOKEN tanimli degil (.env).');
            return 1;
        }

        if ($apify->budgetExceeded()) {
            $this->warn('BUTCE FRENI (APIFY_BUDGET_USD) asildi — kesif yapilmadi.');
            return 1;
        }

        // Coklu-tenant: her aktif Trendyol kanali islenir ve Ticimax kanali AYNI
        // tenant'tan eslestirilir. Eski tekil ->first() cifti, farkli tenant'larin
        // kanallarini eslestirip contentId'leri yanlis tenant'in urunlerine
        // yazabiliyordu.
        $trendyolChannels = Channel::withoutGlobalScopes()
            ->where('type', 'trendyol-product')
            ->where('is_active', true)
            ->orderBy('id')
            ->get();

        if ($channelId = $this->option('channel')) {
            $trendyolChannels = $trendyolChannels->where('id', (int) $channelId)->values();
        }

        if ($trendyolChannels->isEmpty()) {
            $this->error('Aktif trendyol-product kanali bulunamadi.');
            return 1;
        }

        $exit = 0;
        foreach ($trendyolChannels as $trendyolChannel) {
            if ($apify->budgetExceeded()) {
                $this->warn('BUTCE FRENI asildi — kalan kanallar sonraki calismaya birakildi.');
                break;
            }

            $ecommerceChannel = Channel::withoutGlobalScopes()
                ->where('type', 'ticimax-ecommerce')
                ->where('tenant_id', $trendyolChannel->tenant_id)
                ->where('is_active', true)
                ->first();

            if (! $ecommerceChannel) {
                $this->warn("Kanal #{$trendyolChannel->id} (tenant #{$trendyolChannel->tenant_id}): ayni tenant'ta aktif ticimax-ecommerce kanali yok, atlandi.");
                continue;
            }

            $this->info("Tenant #{$trendyolChannel->tenant_id} — Trendyol kanal #{$trendyolChannel->id} isleniyor...");
            $exit = max($exit, $this->processChannel($apify, $trendyolChannel, $ecommerceChannel));
        }

        return $exit;
    }

    protected function processChannel(ApifyService $apify, Channel $trendyolChannel, Channel $ecommerceChannel): int
    {
        $sellerId = $this->resolveSellerId($trendyolChannel);
        if ($sellerId === '') {
            $this->error('seller_id bulunamadi (kanal credentials).');
            return 1;
        }

        $isDryRun = (bool) $this->option('dry-run');

        // Adim 1: bilinen contentId'ler (metadata + yorum ozetleri)
        $knownCids = $this->knownContentIds($trendyolChannel->tenant_id);
        $this->info('Adim 1: ' . count($knownCids) . ' bilinen contentId (metadata + ozet).');

        // Adim 2: vitrin kesfi
        $this->info("Adim 2: Vitrin taraniyor (mid={$sellerId}, Apify, sayfa sayfa)...");
        $discovered = $apify->discoverSellerProducts(
            $sellerId,
            (int) $this->option('max-products'),
            fn ($page, $new, $total) => $this->output->write("\r  sayfa {$page}: +{$new} yeni, toplam {$total}   ")
        );
        $this->newLine();

        if ($discovered === null) {
            $this->error('Vitrin kesfi basarisiz (Apify null dondu).');
            return 1;
        }

        // productId → listing satiri (tekillestir)
        $listingByCid = [];
        foreach ($discovered as $row) {
            $listingByCid[(int) $row['productId']] = $row;
        }
        $this->info('  Vitrinde ' . count($listingByCid) . ' benzersiz urun bulundu.');

        // Adim 3: fark — vitrinde olup bizde olmayan cid'ler
        $newCids = array_values(array_diff(array_keys($listingByCid), $knownCids));
        $this->info('Adim 3: ' . count($newCids) . ' YENI contentId (bilinenlerde yok).');

        if (empty($newCids)) {
            $this->saveState($trendyolChannel, count($listingByCid), 0, 0, $isDryRun);
            $this->info('Yeni urun yok — eslestirme guncel.');
            return 0;
        }

        // Adim 4: yeni cid'lerin detaylari (barkod icin)
        $this->info('Adim 4: Yeni urunlerin detaylari cekiliyor (barkod)...');
        $detailByCid = [];
        $failedBatches = 0;
        foreach (array_chunk($newCids, max(1, (int) $this->option('detail-batch'))) as $i => $chunk) {
            if ($apify->budgetExceeded()) {
                $this->warn('  BUTCE FRENI asildi — kalan detay cekimi birakildi.');
                break;
            }
            $urls = array_map(
                fn ($cid) => $listingByCid[$cid]['productUrl'] ?? $apify->buildProductUrl((int) $cid),
                $chunk
            );
            $byId = $apify->fetchProductsBatch($urls);
            if ($byId === null) {
                $failedBatches++;
                $this->warn('  Batch ' . ($i + 1) . ' basarisiz — atlaniyor.');
                continue;
            }
            foreach ($byId as $cid => $row) {
                $detailByCid[(int) $cid] = $row;
            }
            $this->output->write("\r  " . count($detailByCid) . '/' . count($newCids) . ' detay alindi');
        }
        $this->newLine();

        // Adim 5: barkod → lokal urun eslestirme (sadece eslenmemis urunler)
        $this->info('Adim 5: Barkod eslestirmesi...');
        $barcodeToProducts = [];
        $rows = DB::table('product_variants as v')
            ->join('products as p', 'v.product_id', '=', 'p.id')
            ->where('p.channel_id', $ecommerceChannel->id)
            ->whereRaw("(p.metadata->>'trendyol_content_id') IS NULL")
            ->whereNotNull('v.barcode')
            ->where('v.barcode', '!=', '')
            ->select('v.barcode', 'p.id as product_id', 'p.name as product_name')
            ->get();
        foreach ($rows as $row) {
            $barcodeToProducts[trim($row->barcode)][] = $row;
        }

        $mapped = [];      // rapor: eslesen yeni urunler
        $unmatched = [];   // rapor: TY'de var ama lokalde barkod eslesmedi
        $mappedCids = [];

        foreach ($newCids as $cid) {
            $detail = $detailByCid[$cid] ?? null;
            $listing = $listingByCid[$cid];

            $hitProducts = [];
            if ($detail && ! empty($detail['variants']) && is_array($detail['variants'])) {
                foreach ($detail['variants'] as $variant) {
                    $barcode = trim((string) ($variant['barcode'] ?? ''));
                    if ($barcode !== '' && isset($barcodeToProducts[$barcode])) {
                        foreach ($barcodeToProducts[$barcode] as $p) {
                            $hitProducts[$p->product_id] = $p;
                        }
                    }
                }
            }

            if (empty($hitProducts)) {
                $unmatched[] = [
                    'content_id' => $cid,
                    'trendyol_name' => $listing['name'] ?? '',
                    'trendyol_url' => $listing['productUrl'] ?? '',
                    'detail_fetched' => $detail !== null,
                ];
                continue;
            }

            foreach ($hitProducts as $p) {
                $mapped[] = [
                    'content_id' => $cid,
                    'product_id' => $p->product_id,
                    'product_name' => $p->product_name,
                    'trendyol_name' => $listing['name'] ?? '',
                    'trendyol_url' => $listing['productUrl'] ?? '',
                ];
            }
            $mappedCids[$cid] = array_keys($hitProducts);

            if (! $isDryRun) {
                $this->persistMapping(array_values($hitProducts), $cid, $detail ?? $listing);
            }
        }

        // Adim 6: ayri kayit — JSON raporu
        $reportPath = null;
        if (! empty($mapped) || ! empty($unmatched)) {
            $report = [
                'run_at' => now()->toISOString(),
                'dry_run' => $isDryRun,
                'storefront_products' => count($listingByCid),
                'known_before' => count($knownCids),
                'new_content_ids' => count($newCids),
                'mapped' => $mapped,
                'unmatched' => $unmatched,
            ];
            // Rapor yazilamasa bile is (DB eslestirmeleri) kaybolmasin — 2026-07-13'te
            // root-sahipli klasor yuzunden burada Permission denied ile cokup
            // --sync-reviews adimina gelememisti.
            try {
                $dir = storage_path('app/trendyol');
                if (! is_dir($dir)) {
                    mkdir($dir, 0775, true);
                }
                $reportPath = $dir . '/discovery-t' . $trendyolChannel->tenant_id . '-' . now()->format('Ymd-His') . '.json';
                file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            } catch (\Throwable $e) {
                $reportPath = null;
                $this->warn('Rapor dosyasi yazilamadi: ' . $e->getMessage());
                Log::warning('trendyol:discover-products rapor yazilamadi', ['error' => $e->getMessage()]);
            }
        }

        if (! $isDryRun) {
            $this->saveState($trendyolChannel, count($listingByCid), count($newCids), count($mappedCids), false);
        }

        $this->newLine();
        $this->info('Sonuc:');
        $this->table(['Metrik', 'Adet'], [
            ['Vitrindeki urun', count($listingByCid)],
            ['Bilinen contentId', count($knownCids)],
            ['Yeni contentId', count($newCids)],
            ['Detayi alinan', count($detailByCid)],
            ['Eslesen yeni contentId', count($mappedCids)],
            ['Eslesen lokal urun', count($mapped)],
            ['Eslesmeyen (barkod yok)', count($unmatched)],
            ['Basarisiz detay batch', $failedBatches],
        ]);
        if ($reportPath) {
            $this->info("Rapor: {$reportPath}");
        }
        if ($isDryRun) {
            $this->warn('DRY RUN — degisiklik yapilmadi.');
        }

        Log::info('trendyol:discover-products tamamlandi', [
            'tenant_id' => $trendyolChannel->tenant_id,
            'channel_id' => $trendyolChannel->id,
            'storefront_products' => count($listingByCid),
            'new_content_ids' => count($newCids),
            'mapped_content_ids' => count($mappedCids),
            'mapped_products' => count($mapped),
            'unmatched' => count($unmatched),
            'failed_batches' => $failedBatches,
            'dry_run' => $isDryRun,
            'report' => $reportPath,
        ]);

        // Adim 7: istenirse sadece yeni cid'ler icin yorum sync'i
        if ($this->option('sync-reviews') && ! $isDryRun && ! empty($mappedCids)) {
            $cidList = implode(',', array_keys($mappedCids));
            $this->newLine();
            $this->info('Adim 7: Yeni urunlerin yorumlari cekiliyor...');
            $this->call('trendyol:sync-reviews', [
                '--mode' => 'incremental',
                '--content-ids' => $cidList,
                '--channel' => (string) $trendyolChannel->id,
            ]);
        }

        return 0;
    }

    protected function resolveSellerId(Channel $channel): string
    {
        $cred = $channel->credentials;
        if (is_array($cred) && ! empty($cred['seller_id'])) {
            return (string) $cred['seller_id'];
        }
        // credentials sifreli string olarak durabiliyor (decryptString + json)
        try {
            $raw = $channel->getRawOriginal('credentials');
            $dec = json_decode(Crypt::decryptString((string) $raw), true);
            return (string) ($dec['seller_id'] ?? '');
        } catch (\Throwable) {
            return '';
        }
    }

    /** @return array<int,int> */
    protected function knownContentIds(int $tenantId): array
    {
        $fromMeta = DB::table('products')
            ->where('tenant_id', $tenantId)
            ->whereRaw("metadata->>'trendyol_content_id' IS NOT NULL")
            ->selectRaw("DISTINCT (metadata->>'trendyol_content_id')::bigint as cid")
            ->pluck('cid');

        $fromSummary = DB::table('product_review_summaries')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('trendyol_content_id')
            ->distinct()
            ->pluck('trendyol_content_id');

        return array_values(array_unique(array_map('intval', [...$fromMeta, ...$fromSummary])));
    }

    /**
     * metadata'ya contentId/url yazar; detay satiri varsa fiyat alanlarini da
     * doldurur (ayni veri fiyat kiyas sayfasini besler, tekrar odememek icin).
     */
    protected function persistMapping(array $products, int $cid, array $row): void
    {
        $toDecimal = fn ($v) => is_numeric($v) ? round((float) $v, 3) : null;

        $inStock = null;
        if (isset($row['inStock'])) {
            $inStock = (bool) $row['inStock'];
        } elseif (! empty($row['variants']) && is_array($row['variants'])) {
            $inStock = collect($row['variants'])->contains(fn ($v) => ! empty($v['inStock']));
        }

        foreach ($products as $p) {
            $current = DB::table('products')->where('id', $p->product_id)->value('metadata');
            $metadata = json_decode($current, true) ?? [];
            $metadata['trendyol_content_id'] = $cid;
            if (! empty($row['productUrl'])) {
                $metadata['trendyol_url'] = $row['productUrl'];
            }
            $metadata['trendyol_mapped_at'] = now()->toISOString();
            $metadata['trendyol_mapped_by'] = 'discover-products';

            DB::table('products')->where('id', $p->product_id)->update([
                'metadata' => json_encode($metadata),
                'trendyol_price' => $toDecimal($row['price'] ?? null),
                'trendyol_original_price' => $toDecimal($row['originalPrice'] ?? null),
                'trendyol_discount_percent' => $toDecimal($row['discountPercent'] ?? null),
                'trendyol_promotions' => ! empty($row['promotions']) && is_array($row['promotions'])
                    ? json_encode($row['promotions'])
                    : null,
                'trendyol_in_stock' => $inStock,
                'trendyol_rating' => $toDecimal($row['rating'] ?? null),
                'trendyol_product_url' => $row['productUrl'] ?? null,
                'trendyol_price_synced_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    protected function saveState(Channel $channel, int $storefront, int $new, int $mapped, bool $dryRun): void
    {
        if ($dryRun) {
            return;
        }
        $settings = $channel->settings ?? [];
        $settings['content_id_map_at'] = now()->toISOString();
        $settings['content_id_map_source'] = 'apify_discover';
        $settings['content_id_last_storefront_count'] = $storefront;
        $settings['content_id_last_new_count'] = $new;
        $settings['content_id_last_mapped_count'] = $mapped;
        $channel->update(['settings' => $settings]);
    }
}
