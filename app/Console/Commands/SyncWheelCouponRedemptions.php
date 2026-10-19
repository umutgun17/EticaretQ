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
 * Ticimax'ta oluşturulmuş çark kuponlarının kullanım durumunu senkronize eder.
 *
 * BİRİNCİL (kesin): kupon kodu yerel siparişlerde (orders.coupon_code) eşleşirse →
 * redeemed, redeemed_at = sipariş tarihi, metadata.order_no/order_total. Raporda kesin
 * "ne zaman/ne tutar sipariş verildi" bilgisi buradan gelir.
 * İKİNCİL: sipariş henüz senkronlanmamışsa, SelectHediyeCeki RemainingUse<Quantity ile
 * "kullanıldı" işaretlenir (kesin tarih yoksa tespit anı). Böylece performans raporları çıkar.
 */
class SyncWheelCouponRedemptions extends Command
{
    protected $signature = 'wheel:sync-redemptions
                            {--tenant= : Sadece bu tenant}
                            {--limit=500 : Bu çalışmada kontrol edilecek max kupon}';

    protected $description = 'Çark (Ticimax) kuponlarının kullanım durumunu senkronize eder';

    protected int $checked = 0;
    protected int $redeemed = 0;

    public function handle(): int
    {
        $tenant = $this->option('tenant') ? (int) $this->option('tenant') : null;

        $base = WheelSpin::withoutGlobalScopes()
            ->where('coupon_provider', 'ticimax')
            ->where('coupon_status', WheelCouponStatus::Issued)
            ->where('is_test', false) // test kuponları redemption takibine girmez
            ->whereNotNull('coupon_code')
            ->when($tenant, fn ($q) => $q->where('tenant_id', $tenant));

        // ── BİRİNCİL: ödenmiş sipariş eşleşmesi — TÜM issued kuponlar, limitsiz ──
        // (Eski hali "orderBy(id)->limit(500)" ile HEP en eski 500'ü tarıyor, hiçbiri
        // çözülemediği için 19 Haziran'dan sonraki kuponları hiç kontrol etmiyordu.
        // Eşleşen id'ler tek sorguyla bulunur; sadece onlar güncellenir → ucuz.)
        // Kazı kazan kuponu süresi dolup `expired` işaretlendikten SONRA ödenmiş siparişi
        // senkronlanabilir (sipariş importu gecikir) → expired olanlar da birincil eşleşmeye girer.
        $matchedIds = WheelSpin::withoutGlobalScopes()
            ->where('coupon_provider', 'ticimax')
            ->whereIn('coupon_status', [WheelCouponStatus::Issued, WheelCouponStatus::Expired])
            ->where('is_test', false)
            ->whereNotNull('coupon_code')
            ->when($tenant, fn ($q) => $q->where('tenant_id', $tenant))
            ->whereExists(function ($q) {
                $q->selectRaw('1')
                    ->from('orders')
                    ->whereColumn('orders.tenant_id', 'wheel_spins.tenant_id')
                    ->whereColumn('orders.coupon_code', 'wheel_spins.coupon_code')
                    ->where('orders.payment_status', 1);
            })
            ->pluck('wheel_spins.id');

        foreach ($matchedIds->chunk(200) as $chunk) {
            $spins = WheelSpin::withoutGlobalScopes()->whereIn('id', $chunk)->get();

            foreach ($spins as $spin) {
                $this->checked++;

                // Yalnız ÖDENMİŞ sipariş (payment_status=1) gerçek kullanım sayılır;
                // birden fazla ödenmiş varsa en son tarihli alınır.
                $order = Order::withoutGlobalScopes()
                    ->where('tenant_id', $spin->tenant_id)
                    ->where('coupon_code', $spin->coupon_code)
                    ->where('payment_status', 1)
                    ->orderByDesc('order_date')
                    ->first();

                if (! $order) {
                    continue; // yarış: az önce vardı, şimdi yok — sonraki çalışmada
                }

                $meta = $spin->metadata ?? [];
                $meta['order_no'] = $order->order_no ?: $order->order_code;
                $meta['order_total'] = (float) $order->total_amount;
                unset($meta['ticimax_remaining_use'], $meta['ticimax_quantity']);

                $spin->update([
                    'coupon_status' => WheelCouponStatus::Redeemed,
                    'redeemed_at' => $order->order_date ?? $spin->redeemed_at ?? now(),
                    'metadata' => $meta,
                ]);

                $this->redeemed++;
            }
        }

        // ── İKİNCİL: Ticimax çek durumu — SADECE hâlâ kullanılabilir kuponlar, YENİDEN eskiye ──
        // Ticimax çeki bitiş GÜNÜNÜN sonuna (İstanbul 23:59) kadar yaşatır; günü geçince
        // SelectHediyeCeki "HediyeCekiBulunamadi" döner. Bu yüzden pencere = son kullanma günü
        // bugün veya sonrası olanlar; dünün çeklerini yoklamak sadece SOAP israfı + uyarı spamı.
        $todayStart = now('Europe/Istanbul')->startOfDay()->setTimezone(config('app.timezone'));
        $spins = (clone $base)
            ->where('coupon_expires_at', '>=', $todayStart)
            ->orderByDesc('id')
            ->limit((int) $this->option('limit'))
            ->get();

        // Tenant başına tek TicimaxService (SOAP client yeniden kullanılsın).
        $services = [];

        foreach ($spins as $spin) {
            $this->checked++;

            // Yerel ÖDENMEMİŞ sipariş varsa: Ticimax kupon ödenmemiş siparişe uygulanınca da
            // RemainingUse'u düşürür (rezervasyon) → "kullanıldı" gösterir ama GERÇEK kullanım
            // değil. Ödenmiş sipariş (primary) çıkana dek bekle; Ticimax ikincil kontrolünü atla.
            $hasUnpaidOrder = Order::withoutGlobalScopes()
                ->where('tenant_id', $spin->tenant_id)
                ->where('coupon_code', $spin->coupon_code)
                ->where('payment_status', 0)
                ->exists();

            if ($hasUnpaidOrder) {
                continue;
            }

            $service = $services[$spin->tenant_id] ??= $this->serviceFor($spin->tenant_id);

            if (! $service) {
                continue; // kanal yok → atla
            }

            $res = $service->getGiftVoucher($spin->coupon_code);

            if (! ($res['success'] ?? false)) {
                // Kupon Ticimax'ta bulunamadıysa logla, durumu değiştirme.
                Log::warning('wheel:sync-redemptions: çek okunamadı', [
                    'spin_id' => $spin->id,
                    'code' => $spin->coupon_code,
                    'error' => $res['error'] ?? '?',
                ]);

                continue;
            }

            $v = $res['voucher'];
            $quantity = (int) ($v['Quantity'] ?? 0);
            $remaining = (int) ($v['RemainingUse'] ?? 0);

            // Kullanım hakkı tükenmiş/azalmışsa → kullanılmış say.
            if ($quantity > 0 && $remaining < $quantity) {
                $meta = $spin->metadata ?? [];
                $meta['ticimax_remaining_use'] = $remaining;
                $meta['ticimax_quantity'] = $quantity;

                $spin->update([
                    'coupon_status' => WheelCouponStatus::Redeemed,
                    'redeemed_at' => $spin->redeemed_at ?? now(),
                    'metadata' => $meta,
                ]);

                $this->redeemed++;
            }
        }

        $this->info("Tamamlandı: {$this->checked} kontrol, {$this->redeemed} kullanılmış işaretlendi.");
        Log::info('wheel:sync-redemptions tamamlandı', [
            'checked' => $this->checked,
            'redeemed' => $this->redeemed,
        ]);

        return 0;
    }

    protected function serviceFor(int $tenantId): ?TicimaxService
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

        $service = TicimaxService::fromChannel($channel);

        return $service->isAvailable() ? $service : null;
    }
}
