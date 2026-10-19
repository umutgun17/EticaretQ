<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\TrendyolProduct;
use App\Services\TrendyolService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Trendyol Seller API katalogunu (barkod bazli) trendyol_products tablosuna kopyalar
 * ve site urunleriyle eslestirir. "Trendyol Kiyas" paneli bu tabloyu okur.
 *
 * Eslestirme sirasi: product_variants.barcode → products.barcode → stockCode/productMainId
 * (sitedeki sku "NEBIMV3|TBARZ1080|721" icinde model kodu gecer).
 */
class SyncTrendyolCatalog extends Command
{
    protected $signature = 'trendyol:sync-catalog
                            {--tenant= : Sadece bu tenant (bos=trendyol-product kanali olan tum tenantlar)}
                            {--max-pages=500 : Guvenlik siniri}
                            {--dry-run : DB\'ye yazma, sadece say}';

    protected $description = 'Trendyol Seller API urun katalogunu ceker, siteyle eslestirir (Trendyol Kiyas)';

    public function handle(): int
    {
        // 34k+ barkod x 200/sayfa upsert; CLI varsayilan 128M yetmiyor (25 Eyl OOM, 56. sayfada)
        if ((int) ini_get('memory_limit') > 0 && (int) ini_get('memory_limit') < 1024) {
            ini_set('memory_limit', '1024M');
        }
        \Illuminate\Support\Facades\DB::disableQueryLog();

        $channels = Channel::withoutGlobalScopes()
            ->where('type', 'trendyol-product')
            ->where('is_active', true)
            ->when($this->option('tenant'), fn ($q) => $q->where('tenant_id', (int) $this->option('tenant')))
            ->get();

        if ($channels->isEmpty()) {
            $this->warn('Aktif trendyol-product kanali yok.');
            return 0;
        }

        $exit = 0;
        foreach ($channels as $channel) {
            if (! $channel->tenant_id) {
                continue;
            }
            $ok = $this->syncChannel($channel);
            if (! $ok) {
                $exit = 1;
            }
        }

        return $exit;
    }

    protected function syncChannel(Channel $channel): bool
    {
        $tenantId = (int) $channel->tenant_id;
        $svc = TrendyolService::fromChannelForProducts($channel);
        $this->info("Tenant {$tenantId} / kanal #{$channel->id}" . ($svc->usesProductKey ? ' (2. anahtar: Urun API)' : ' (ana anahtar)'));

        if (! $svc->isAvailable()) {
            $this->warn('  Kimlik bilgileri eksik (seller_id/api_key/api_secret).');
            $this->writeStatus($channel, ['catalog_sync_error' => 'Kimlik bilgileri eksik']);
            return false;
        }

        $probe = $svc->probeProductAccess();
        if (! $probe['ok']) {
            $msg = $probe['status'] === 401
                ? 'API anahtarinda URUN yetkisi yok (401). Ayarlar > Kanallar > Trendyol ekranindan urun yetkili 2. anahtari (Urun API Key/Secret) girin.'
                : ($probe['message'] ?? 'Bilinmeyen hata');
            $this->error("  {$msg}");
            $this->writeStatus($channel, ['catalog_sync_error' => $msg, 'catalog_sync_error_at' => now()->toIso8601String()]);
            return false;
        }

        $this->line("  Trendyol toplam kayit (barkod): {$probe['total']}");
        $dry = (bool) $this->option('dry-run');
        $runStartedAt = now();

        // Eslestirme haritalari (tenant'in tum site urunleri; 44k varyant icin bellek ~ birkac MB)
        $variantMap = ProductVariant::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('barcode')
            ->pluck('product_id', 'barcode')   // barcode => product_id
            ->all();
        $variantIdMap = ProductVariant::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('barcode')
            ->pluck('id', 'barcode')
            ->all();
        $productBarcodeMap = Product::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('barcode')
            ->pluck('id', 'barcode')
            ->all();
        // Model kodu → product_id (sku'nun "|" ile ayrilmis 2. parcasi veya sku'nun kendisi)
        // Model|Renk → product_id (site sku "NEBIMV3|TBARZ1080|721"; Trendyol stockCode "TBARZ1080_721_38")
        $modelMap = [];
        $colorMap = [];
        // Sitede ayni model+renk icin mukerrer kayit olabiliyor → aktif, URL'li ve stoklu olan tercih edilir
        $ordered = Product::withoutGlobalScopes()->where('tenant_id', $tenantId)->whereNotNull('sku')
            ->select('id', 'sku')
            ->orderByRaw('is_active DESC, (url IS NOT NULL AND url <> \'\') DESC, coalesce(stock_quantity,0) DESC, id ASC')
            ->cursor();
        foreach ($ordered as $r) {
            foreach (self::modelCodes($r->sku) as $code) {
                $modelMap[$code] ??= $r->id;
            }
            $key = self::modelColorKey($r->sku);
            if ($key !== null) {
                $colorMap[$key] ??= $r->id;
            }
        }
        unset($ordered);
        // product_id|beden → variant_id (stok kodunun 3. parcasi = beden)
        $sizeMap = [];
        ProductVariant::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->select('id', 'product_id', 'attributes')->orderBy('id')->chunk(5000, function ($rows) use (&$sizeMap) {
                foreach ($rows as $v) {
                    $attrs = is_array($v->attributes) ? $v->attributes : (json_decode((string) $v->attributes, true) ?: []);
                    $size = self::normSize($attrs['Beden'] ?? $attrs['beden'] ?? $attrs['Size'] ?? null);
                    if ($size !== '') {
                        $sizeMap[$v->product_id . '|' . $size] ??= $v->id;
                    }
                }
            });
        $maps = compact('variantMap', 'variantIdMap', 'productBarcodeMap', 'modelMap', 'colorMap', 'sizeMap');
        unset($variantMap, $variantIdMap, $productBarcodeMap, $modelMap, $colorMap, $sizeMap);

        $stats = ['rows' => 0, 'inserted' => 0, 'updated' => 0, 'matched' => 0, 'unmatched' => 0, 'pages' => 0, 'by_type' => [], 'conflicts' => 0];
        $seenBarcodes = [];

        $total = $svc->eachSellerProduct(function (array $content, int $page, int $totalPages) use (
            &$stats, &$seenBarcodes, $tenantId, $channel, $dry, $maps, $runStartedAt
        ) {
            $stats['pages']++;
            $this->output->write("\r  sayfa " . ($page + 1) . "/{$totalPages}   ");

            $rows = [];
            foreach ($content as $item) {
                $barcode = trim((string) ($item['barcode'] ?? ''));
                if ($barcode === '') {
                    continue;
                }
                $stats['rows']++;
                $seenBarcodes[$barcode] = true;

                [$productId, $variantId, $matchType, $barcodeProductId, $conflict] = $this->matchItem($item, $maps);
                $productId ? $stats['matched']++ : $stats['unmatched']++;
                $stats['by_type'][$matchType ?? '-'] = ($stats['by_type'][$matchType ?? '-'] ?? 0) + 1;
                if ($conflict) {
                    $stats['conflicts']++;
                }

                $images = collect($item['images'] ?? [])->map(fn ($i) => is_array($i) ? ($i['url'] ?? null) : $i)->filter()->values()->all();
                $desc = (string) ($item['description'] ?? '');

                $rows[] = [
                    'tenant_id' => $tenantId,
                    'channel_id' => $channel->id,
                    'barcode' => $barcode,
                    'trendyol_id' => isset($item['id']) ? (string) $item['id'] : null,
                    'product_content_id' => isset($item['productContentId']) ? (int) $item['productContentId'] : null,
                    'product_main_id' => self::str($item['productMainId'] ?? null, 128),
                    'stock_code' => self::str($item['stockCode'] ?? null, 128),
                    'title' => self::str($item['title'] ?? null, 500),
                    'brand' => self::str($item['brand'] ?? null, 128),
                    'category_name' => self::str($item['categoryName'] ?? null, 255),
                    'pim_category_id' => isset($item['pimCategoryId']) ? (int) $item['pimCategoryId'] : null,
                    'color' => self::str($item['color'] ?? null, 128),
                    'size' => self::str($item['size'] ?? null, 64),
                    'gender' => self::str($item['gender'] ?? null, 32),
                    'quantity' => isset($item['quantity']) ? (int) $item['quantity'] : null,
                    'list_price' => self::dec($item['listPrice'] ?? null),
                    'sale_price' => self::dec($item['salePrice'] ?? null),
                    'vat_rate' => self::dec($item['vatRate'] ?? null),
                    'images' => json_encode($images),
                    'image_count' => count($images),
                    'attributes' => json_encode($item['attributes'] ?? []),
                    'description' => $desc !== '' ? mb_substr($desc, 0, 20000) : null,
                    'description_length' => mb_strlen(strip_tags($desc)),
                    'approved' => self::bool($item['approved'] ?? null),
                    'on_sale' => self::bool($item['onSale'] ?? null),
                    'archived' => self::bool($item['archived'] ?? null),
                    'locked' => self::bool($item['locked'] ?? null),
                    'blacklisted' => self::bool($item['blacklisted'] ?? null),
                    'rejected' => isset($item['rejectReasonDetails']) ? ! empty($item['rejectReasonDetails']) : null,
                    'has_active_campaign' => self::bool($item['hasActiveCampaign'] ?? null),
                    'product_url' => self::str($item['productUrl'] ?? null, 500),
                    'platform_created_at' => self::ms($item['createdDate'] ?? null),
                    'platform_updated_at' => self::ms($item['lastUpdateDate'] ?? null),
                    'product_id' => $productId,
                    'product_variant_id' => $variantId,
                    'barcode_product_id' => $barcodeProductId,
                    'match_conflict' => $conflict,
                    'match_type' => $matchType,
                    'last_seen_at' => $runStartedAt,
                    'is_missing' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            if ($dry || empty($rows)) {
                return;
            }

            $existing = TrendyolProduct::where('tenant_id', $tenantId)
                ->whereIn('barcode', array_column($rows, 'barcode'))->count();
            $stats['inserted'] += count($rows) - $existing;
            $stats['updated'] += $existing;

            $updateCols = array_diff(array_keys($rows[0]), ['tenant_id', 'barcode', 'created_at']);
            TrendyolProduct::upsert($rows, ['tenant_id', 'barcode'], array_values($updateCols));
            unset($rows);
            gc_collect_cycles();
        }, [], (int) $this->option('max-pages'));

        $this->newLine();

        if ($total === null) {
            $err = $svc->getLastError() ?? 'API hatasi';
            $this->error("  Tarama yarida kesildi: {$err}");
            $this->writeStatus($channel, ['catalog_sync_error' => $err, 'catalog_sync_error_at' => now()->toIso8601String()]);
            return false;
        }

        // Bu turda gorulmeyen kayitlar: Trendyol'dan kalkmis (silinmis) → is_missing
        $missing = 0;
        if (! $dry && $stats['rows'] > 0) {
            $missing = TrendyolProduct::where('tenant_id', $tenantId)
                ->where(fn ($q) => $q->whereNull('last_seen_at')->orWhere('last_seen_at', '<', $runStartedAt))
                ->update(['is_missing' => true]);

            // Urun metadata'sina contentId yaz (fiyat/yorum sync'leri bunu kullanir) — sadece bos olanlara
            $this->backfillContentIds($tenantId);
        }

        $this->table(['Metrik', 'Adet'], [
            ['Sayfa', $stats['pages']],
            ['Barkod satiri', $stats['rows']],
            ['Yeni', $stats['inserted']],
            ['Guncellenen', $stats['updated']],
            ['Siteyle eslesen', $stats['matched']],
            ['Eslesmeyen (sitede yok)', $stats['unmatched']],
            ['  stok kodu (model+renk)', $stats['by_type']['stock_code'] ?? 0],
            ['  barkod', ($stats['by_type']['variant_barcode'] ?? 0) + ($stats['by_type']['product_barcode'] ?? 0)],
            ['  model kodu (renksiz)', ($stats['by_type']['stock_model'] ?? 0) + ($stats['by_type']['main_id'] ?? 0)],
            ['Barkod/stok kodu CELISKISI', $stats['conflicts']],
            ['Trendyol\'dan kalkmis', $missing],
        ]);

        if (! $dry) {
            $this->writeStatus($channel, [
                'catalog_synced_at' => now()->toIso8601String(),
                'catalog_sync_error' => null,
                'catalog_rows' => $stats['rows'],
                'catalog_matched' => $stats['matched'],
                'catalog_unmatched' => $stats['unmatched'],
            ]);
        }

        Log::info('trendyol:sync-catalog tamamlandi', ['tenant' => $tenantId] + $stats + ['missing' => $missing]);

        return true;
    }

    /**
     * @return array{0:?int,1:?int,2:?string} [product_id, variant_id, match_type]
     */
    /**
     * Eslestirme sirasi (25 Eyl): 1) stok kodu MODEL_RENK_BEDEN → site sku NEBIMV3|MODEL|RENK + varyant bedeni
     * (en kesin; renk seviyesinde), 2) barkod, 3) model kodu (renksiz, zayif).
     * Barkod her zaman capraz kontrol: stok kodunun bulduguyla barkodun buldugu urun farkliysa match_conflict.
     * Donus: [product_id, variant_id, match_type, barcode_product_id, conflict]
     */
    protected function matchItem(array $item, array $maps): array
    {
        $barcode = trim((string) ($item['barcode'] ?? ''));
        $stockCode = (string) ($item['stockCode'] ?? '');

        $bcProduct = isset($maps['variantMap'][$barcode]) ? (int) $maps['variantMap'][$barcode]
            : (isset($maps['productBarcodeMap'][$barcode]) ? (int) $maps['productBarcodeMap'][$barcode] : null);
        $bcVariant = isset($maps['variantIdMap'][$barcode]) ? ((int) $maps['variantIdMap'][$barcode] ?: null) : null;

        // 1) Stok kodu: model|renk → urun, beden → varyant
        $parts = self::stockCodeParts($stockCode);
        if ($parts !== null) {
            $key = $parts['model'] . '|' . $parts['color'];
            if (isset($maps['colorMap'][$key])) {
                $scProduct = (int) $maps['colorMap'][$key];
                $scVariant = $maps['sizeMap'][$scProduct . '|' . $parts['size']] ?? null;
                if ($scVariant === null && $bcProduct === $scProduct) {
                    $scVariant = $bcVariant; // beden yazimi farkli ama barkod ayni urunu gosteriyor
                }
                $conflict = $bcProduct !== null && $bcProduct !== $scProduct;

                return [$scProduct, $scVariant ? (int) $scVariant : null, 'stock_code', $bcProduct, $conflict];
            }
        }

        // 2) Barkod
        if ($bcProduct !== null) {
            $type = isset($maps['variantMap'][$barcode]) ? 'variant_barcode' : 'product_barcode';

            return [$bcProduct, $bcVariant, $type, $bcProduct, false];
        }

        // 3) Model kodu (renk ayrimi yok)
        foreach ([$stockCode, $item['productMainId'] ?? null] as $i => $code) {
            foreach (self::modelCodes((string) $code) as $c) {
                if (isset($maps['modelMap'][$c])) {
                    return [(int) $maps['modelMap'][$c], null, $i === 0 ? 'stock_model' : 'main_id', null, false];
                }
            }
        }

        return [null, null, null, null, false];
    }

    /** "TBARZ1080_721_38" → [model=>tbarz1080, color=>721, size=>38]; uymuyorsa null */
    public static function stockCodeParts(?string $stockCode): ?array
    {
        $sc = mb_strtolower(trim((string) $stockCode));
        if ($sc === '' || ! preg_match('/^(.+)_([^_]+)_([^_]+)$/u', $sc, $m)) {
            return null;
        }

        return ['model' => trim($m[1]), 'color' => trim($m[2]), 'size' => self::normSize($m[3])];
    }

    /** Site sku "NEBIMV3|TBARZ1080|721" → "tbarz1080|721"; 3 parcali degilse null */
    public static function modelColorKey(?string $sku): ?string
    {
        $parts = array_values(array_filter(array_map('trim', explode('|', mb_strtolower(trim((string) $sku)))), fn ($p) => $p !== ''));
        if (count($parts) >= 3) {
            return $parts[1] . '|' . $parts[2];
        }
        if (count($parts) === 2 && ! str_starts_with($parts[0], 'nebim')) {
            return $parts[0] . '|' . $parts[1];
        }

        return null;
    }

    public static function normSize(?string $size): string
    {
        $s = mb_strtolower(trim((string) $size));
        $s = preg_replace('/\s+/u', '', $s);
        $s = str_replace([',', '.0'], ['.', ''], $s);

        return $s;
    }

    /** "NEBIMV3|TBARZ1080|721" → ["nebimv3|tbarz1080|721","tbarz1080"]; "TBARZ1080" → ["tbarz1080"] */
    public static function modelCodes(?string $sku): array
    {
        $sku = mb_strtolower(trim((string) $sku));
        if ($sku === '') {
            return [];
        }
        $codes = [$sku];
        $parts = array_values(array_filter(array_map('trim', preg_split('/[|\/\s]+/', $sku))));
        if (count($parts) > 1) {
            // Model kodu genelde harf+rakam icerir ve en uzun parcadir (NEBIMV3 kaynak, 721 renk)
            usort($parts, fn ($a, $b) => strlen($b) <=> strlen($a));
            foreach ($parts as $p) {
                if (preg_match('/[a-z]/', $p) && preg_match('/\d/', $p) && ! str_starts_with($p, 'nebim')) {
                    $codes[] = $p;
                    break;
                }
            }
        }

        return array_unique($codes);
    }

    protected function backfillContentIds(int $tenantId): void
    {
        $pairs = TrendyolProduct::where('tenant_id', $tenantId)
            ->whereNotNull('product_id')->whereNotNull('product_content_id')
            ->select('product_id', DB::raw('min(product_content_id) as cid'))
            ->groupBy('product_id')->pluck('cid', 'product_id');

        $done = 0;
        foreach ($pairs->chunk(500) as $chunk) {
            $products = Product::withoutGlobalScopes()->whereIn('id', $chunk->keys())
                ->whereRaw("coalesce(metadata->>'trendyol_content_id','') = ''")->get(['id', 'metadata']);
            foreach ($products as $p) {
                $meta = $p->metadata ?? [];
                $meta['trendyol_content_id'] = (int) $chunk[$p->id];
                $meta['trendyol_mapped_by'] = 'seller-api';
                Product::withoutGlobalScopes()->where('id', $p->id)->update(['metadata' => json_encode($meta)]);
                $done++;
            }
        }
        if ($done) {
            $this->line("  contentId backfill: {$done} urun");
        }
    }

    protected function writeStatus(Channel $channel, array $patch): void
    {
        $settings = $channel->settings ?? [];
        if (is_string($settings)) {
            $settings = json_decode($settings, true) ?? [];
        }
        $channel->settings = array_merge($settings, $patch);
        $channel->saveQuietly();
    }

    protected static function str($v, int $max): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        return mb_substr((string) $v, 0, $max);
    }

    protected static function dec($v): ?float
    {
        return is_numeric($v) ? round((float) $v, 2) : null;
    }

    protected static function bool($v): ?bool
    {
        return $v === null ? null : (bool) $v;
    }

    protected static function ms($v): ?Carbon
    {
        if (! is_numeric($v) || $v <= 0) {
            return null;
        }
        return Carbon::createFromTimestampMs((int) $v);
    }
}
