<?php

namespace App\Console\Commands;

use App\Enums\WheelCouponStatus;
use App\Models\Channel;
use App\Models\Order;
use App\Models\WheelSpin;
use App\Services\TicimaxService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Kazı Kazan kuponlarının 30 DAKİKALIK süresini Ticimax tarafında da uygular.
 *
 * Ticimax hediye çeki GÜN bazlı çalışır (bitiş saati yok sayılır, gün sonuna kadar yaşar).
 * Widget kuponu 30 dk sonra gizler ama kodu kopyalayan müşteri saatler sonra da kullanabilirdi
 * → "sana özel 30 dakika" sözü boşa düşerdi. Bu komut süresi dolan, kullanılmamış kazı kazan
 * kuponlarını SetHediyeCekiKullanildi ile pasifleştirir ve yerelde `expired` işaretler.
 *
 * Güvenlik: yerelde o kodla HERHANGİ bir sipariş (ödenmiş/ödenmemiş) varsa DOKUNMAZ —
 * sipariş senkronu (wheel:sync-redemptions) ödenmiş çıkınca redeemed yapar.
 * Yalnız kazı kazan (variant=scratch); çark kuponlarına (24 saat) dokunmaz.
 *
 *   php artisan wheel:expire-scratch-coupons [--tenant=] [--dry-run]
 */
class ExpireScratchCoupons extends Command
{
    protected $signature = 'wheel:expire-scratch-coupons
        {--tenant= : Yalnız bu tenant}
        {--limit=300 : Tek çalışmada azami kupon}
        {--dry-run : Ticimax\'a yazma, ne yapılacağını göster}';

    protected $description = 'Kazı Kazan: süresi dolan kullanılmamış kuponları Ticimax\'ta pasifleştirir';

    public function handle(): int
    {
        $tenant = $this->option('tenant') ? (int) $this->option('tenant') : null;
        $dry = (bool) $this->option('dry-run');

        // Süre dolmuş + en fazla 2 gün geriye (eski birikim/yarış için güvenli üst sınır).
        $spins = WheelSpin::withoutGlobalScopes()
            ->where('variant', 'scratch')
            ->where('coupon_provider', 'ticimax')
            ->where('coupon_status', WheelCouponStatus::Issued)
            ->whereNotNull('coupon_code')
            ->whereNotNull('coupon_expires_at')
            ->where('coupon_expires_at', '<', now())
            ->where('coupon_expires_at', '>', now()->subDays(2))
            ->when($tenant, fn ($q) => $q->where('tenant_id', $tenant))
            ->orderBy('coupon_expires_at')
            ->limit((int) $this->option('limit'))
            ->get();

        if ($spins->isEmpty()) {
            return self::SUCCESS; // her dakika çalışır; boş turda sessiz
        }

        $services = [];
        $expired = 0; $skippedOrder = 0; $failed = 0;

        foreach ($spins as $spin) {
            // Sipariş var mı? (ödenmemiş dahil: Ticimax rezervasyonu düşmüş olabilir)
            $hasOrder = Order::withoutGlobalScopes()
                ->where('tenant_id', $spin->tenant_id)
                ->where('coupon_code', $spin->coupon_code)
                ->exists();
            if ($hasOrder) {
                $skippedOrder++;
                continue; // sync-redemptions karar versin
            }

            $ticimaxId = (int) ($spin->metadata['ticimax_id'] ?? 0);
            if ($dry) {
                $this->line("DRY spin={$spin->id} code={$spin->coupon_code} ticimax_id={$ticimaxId} expired_at={$spin->coupon_expires_at}");
                continue;
            }

            $ok = false;
            if ($ticimaxId > 0) {
                $service = $services[$spin->tenant_id] ??= $this->serviceFor($spin->tenant_id);
                if ($service) {
                    $res = $service->markGiftVoucherUsed($ticimaxId);
                    $ok = (bool) ($res['success'] ?? false);
                    if (! $ok) {
                        Log::warning('[wheel] scratch kupon pasifleştirilemedi', [
                            'spin_id' => $spin->id, 'code' => $spin->coupon_code, 'error' => $res['error'] ?? '?',
                        ]);
                    }
                }
            }

            if ($ok || $ticimaxId <= 0) {
                // ticimax_id yoksa (push başarısız kalmış) Ticimax'ta çek de yok → yerelde expired yeter.
                $meta = $spin->metadata ?? [];
                $meta['expired_by'] = 'scratch-expire';
                $meta['expired_at'] = now()->toIso8601String();
                $meta['ticimax_deactivated'] = $ok;
                $spin->update(['coupon_status' => WheelCouponStatus::Expired, 'metadata' => $meta]);
                $expired++;
            } else {
                $failed++; // sonraki dakikada tekrar denenir (2 gün penceresi)
            }
        }

        $this->info("[expire-scratch] süresi doldu={$expired} siparişli-atlandı={$skippedOrder} hata={$failed}");
        Log::info('wheel:expire-scratch-coupons', ['expired' => $expired, 'skipped_order' => $skippedOrder, 'failed' => $failed]);

        return self::SUCCESS;
    }

    private function serviceFor(int $tenantId): ?TicimaxService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'like', 'ticimax%')
            ->where('is_active', true)
            ->orderByRaw("CASE WHEN type = 'ticimax-ecommerce' THEN 0 ELSE 1 END")
            ->first();
        if (! $channel) {
            return null;
        }
        $s = TicimaxService::fromChannel($channel);

        return $s->isAvailable() ? $s : null;
    }
}
