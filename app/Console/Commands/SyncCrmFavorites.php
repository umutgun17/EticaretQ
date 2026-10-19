<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductFavorite;
use App\Services\TicimaxService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;

class SyncCrmFavorites extends Command
{
    protected $signature = 'crm:sync-favorites
                            {--limit=200 : Sayfa basi kayit sayisi}
                            {--full : Tum gecmisi bastan cek}
                            {--days=7 : Incremental kac gun geriye}
                            {--channel= : Belirli kanal ID}';

    protected $description = 'Ticimax favori urunleri senkronize eder';

    protected int $totalNew = 0;
    protected int $totalUpdated = 0;

    public function handle(): int
    {
        $query = Channel::withoutGlobalScopes()
            ->where('is_active', true)
            ->where('type', 'like', '%-ecommerce');

        if ($channelId = $this->option('channel')) {
            $query->where('id', (int) $channelId);
        }

        $channels = $query->get();

        if ($channels->isEmpty()) {
            $this->error('Aktif e-ticaret kanali bulunamadi.');

            return 1;
        }

        foreach ($channels as $channel) {
            $this->info("Kanal #{$channel->id} ({$channel->type}, Tenant #{$channel->tenant_id}) isleniyor...");

            $this->syncFavorites($channel);

            $freshSettings = $channel->fresh()->settings ?? [];
            $freshSettings['favorites_synced_at'] = now()->toIso8601String();
            $channel->update(['settings' => $freshSettings]);
        }

        $this->info("Tamamlandi: {$this->totalNew} yeni, {$this->totalUpdated} guncellendi");
        Log::info('SyncCrmFavorites: completed', [
            'new' => $this->totalNew,
            'updated' => $this->totalUpdated,
        ]);

        return 0;
    }

    protected function syncFavorites(Channel $channel): void
    {
        if (! str_starts_with($channel->type, 'ticimax')) {
            $this->warn("  Kanal #{$channel->id}: Desteklenmeyen platform tipi ({$channel->type})");

            return;
        }

        $service = TicimaxService::fromChannel($channel);

        if (! $service->isAvailable()) {
            $this->warn("  Kanal #{$channel->id}: Ticimax servisi kullanilamiyor");

            return;
        }

        $limit = (int) $this->option('limit');
        $isFull = $this->option('full');
        $days = (int) $this->option('days');

        $filters = [];

        if (! $isFull) {
            $filters['BaslangicTarihi'] = now()->subDays($days)->format('Y-m-d\TH:i:s');
        }

        // Pre-load product lookup map (small: ~6K)
        $productMap = Product::withoutGlobalScopes()
            ->where('tenant_id', $channel->tenant_id)
            ->where('channel_id', $channel->id)
            ->pluck('id', 'platform_product_id')
            ->toArray();

        $page = 1;
        $processed = 0;

        while (true) {
            $result = $service->getFavorites($filters, $page, $limit);

            if (! $result['success']) {
                $this->error("  Sayfa {$page}: API hatasi — " . ($result['error'] ?? 'Bilinmeyen hata'));
                break;
            }

            $favorites = $result['data']['GetFavoriUrunlerResult']['Urunler']['WebFavoriUrunler'] ?? [];

            // Single result comes as associative array, not list
            if (! empty($favorites) && isset($favorites['FavoriUrunID'])) {
                $favorites = [$favorites];
            }

            if (empty($favorites)) {
                if ($page === 1) {
                    $this->info('  Hic favori bulunamadi.');
                }
                break;
            }

            // Batch-resolve customer IDs for this page (avoid loading 192K into memory)
            $customerIds = array_unique(array_filter(array_map(fn ($f) => (string) ($f['UyeID'] ?? 0), $favorites)));
            $customerMap = ! empty($customerIds)
                ? Customer::withoutGlobalScopes()
                    ->where('tenant_id', $channel->tenant_id)
                    ->where('channel_id', $channel->id)
                    ->whereIn('platform_customer_id', $customerIds)
                    ->pluck('id', 'platform_customer_id')
                    ->toArray()
                : [];

            foreach ($favorites as $fav) {
                $this->syncFavorite($fav, $channel, $customerMap, $productMap);
                $processed++;
            }

            $this->info("  Sayfa {$page}: " . count($favorites) . " favori islendi (toplam: {$processed})");

            $page++;

            if (empty($favorites)) {
                break;
            }

            usleep(300000); // 0.3s rate limit
        }
    }

    protected function syncFavorite(array $data, Channel $channel, array $customerMap, array $productMap): void
    {
        $platformFavId = (int) ($data['FavoriUrunID'] ?? 0);
        if ($platformFavId === 0) {
            return;
        }

        $platformCustomerId = (int) ($data['UyeID'] ?? 0);
        $platformProductId = (int) ($data['UrunKartiID'] ?? 0);

        $mapped = [
            'tenant_id' => $channel->tenant_id,
            'channel_id' => $channel->id,
            'customer_id' => $customerMap[(string) $platformCustomerId] ?? null,
            'product_id' => $productMap[(string) $platformProductId] ?? null,
            'platform_customer_id' => $platformCustomerId,
            'platform_product_id' => $platformProductId,
            'product_name' => trim($data['UrunAdi'] ?? ''),
            'product_sku' => trim($data['StokKodu'] ?? '') ?: null,
            'product_image' => trim($data['ResimUrl'] ?? '') ?: null,
            'product_url' => trim($data['UrunUrl'] ?? '') ?: null,
            'product_price' => (float) ($data['UrunFiyati'] ?? 0),
            'product_price_tax' => (float) ($data['UrunFiyatiKdv'] ?? 0),
            'currency' => trim($data['ParaBirimi'] ?? 'TL') ?: 'TL',
            'stock_quantity' => (float) ($data['ToplamStokAdedi'] ?? 0),
            'variant_count' => (int) ($data['VaryasyonSayisi'] ?? 0),
            'favorited_at' => $this->parseDate($data['EklemeTarihi'] ?? null),
        ];

        // platform_favorite_id Ticimax'ta mağaza-bazlı sayaçtır; tenant filtresi
        // olmadan başka tenant'ın aynı ID'li favorisi ezilir.
        $existing = ProductFavorite::withoutGlobalScopes()
            ->where('tenant_id', $channel->tenant_id)
            ->where('platform_favorite_id', $platformFavId)
            ->first();

        if ($existing) {
            $existing->update($mapped);
            $this->totalUpdated++;
        } else {
            $mapped['platform_favorite_id'] = $platformFavId;
            ProductFavorite::withoutGlobalScopes()->create($mapped);
            $this->totalNew++;
        }
    }

    protected function parseDate(?string $date): ?string
    {
        if (empty($date)) {
            return null;
        }

        try {
            $parsed = Carbon::parse($date);

            if ($parsed->year < 1900) {
                return null;
            }

            return $parsed->format('Y-m-d H:i:s');
        } catch (\Exception) {
            return null;
        }
    }
}
