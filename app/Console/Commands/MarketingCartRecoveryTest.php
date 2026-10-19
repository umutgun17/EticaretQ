<?php

namespace App\Console\Commands;

use App\Models\MarketingJourney;
use App\Models\Order;
use App\Services\Marketing\CartRecoveryAutomation;
use App\Services\Marketing\CartRecoveryCoupon;
use App\Services\Marketing\UnifiedSender;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Sepet kurtarma mesajını YALNIZCA verilen test adresine gönderir (gerçek müşterilere
 * DOKUNMAZ). Gerçek şablon + kupon + takip ile, kendine önizleme/test amaçlı.
 *
 *   php artisan marketing:cart-recovery-test --tenant=1 --email=umutgun17@gmail.com --channel=email
 *   php artisan marketing:cart-recovery-test --tenant=1 --phone=+90543... --channel=sms   (gerçek 100₺ kupon üretir)
 */
class MarketingCartRecoveryTest extends Command
{
    protected $signature = 'marketing:cart-recovery-test
        {--tenant= : Tenant ID (zorunlu)}
        {--email= : Test e-posta adresi}
        {--phone= : Test telefon (sms/whatsapp için)}
        {--channel=email : email|sms|whatsapp}';

    protected $description = 'Sepet kurtarma mesajını sadece test adresine gönderir (canlı müşterilere değil)';

    public function handle(CartRecoveryAutomation $auto, CartRecoveryCoupon $couponSvc, UnifiedSender $sender): int
    {
        $tenantId = (int) $this->option('tenant');
        $channel = (string) $this->option('channel');
        $email = (string) $this->option('email');
        $phone = (string) $this->option('phone');
        $to = $channel === 'email' ? $email : $phone;

        if (! $tenantId || $to === '') {
            $this->error('--tenant ve (kanal e-posta ise --email / değilse --phone) zorunlu.');

            return self::FAILURE;
        }

        // Gerçekçi içerik için son terk siparişini örnek al (gönderim YİNE sadece test adresine)
        $order = Order::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('status', 0)->where('payment_status', 0)
            ->latest('order_date')->first();
        if (! $order) {
            $this->error('Örnek terk siparişi bulunamadı.');

            return self::FAILURE;
        }

        // Geçici test journey (cart_recovery_test → gerçek akışı kirletmez), sonunda silinir
        $journey = MarketingJourney::create([
            'tenant_id' => $tenantId,
            'automation' => 'cart_recovery_test',
            'order_id' => $order->id,
            'recipient_email' => $email ?: 'test@example.com',
            'recipient_phone' => $phone ?: null,
            'status' => 'active',
            'entered_at' => now(),
            'meta' => ['test' => true],
        ]);

        try {
            $needsCoupon = $channel !== 'email';
            if ($needsCoupon) {
                $code = $couponSvc->ensureFor($journey, $auto->couponAmount($tenantId),
                    (int) (\App\Models\Tenant::find($tenantId)->settings['cart_recovery_coupon_valid_hours'] ?? 48));
                if (! $code) {
                    $this->warn('Kupon üretilemedi (Ticimax?) — mesaj kuponsuz gidecek.');
                }
                $journey->refresh();
            }

            $step = [
                'channel' => $channel,
                'template' => $channel === 'email' ? 'cart_recovery_1' : null,
                'coupon' => $needsCoupon,
            ];
            $token = $channel === 'email' ? Str::random(40) : null;
            $message = $auto->buildMessage($tenantId, $channel, $step, $journey, $order, $token);

            $this->info("Gönderiliyor → kanal={$channel} alıcı={$to}" . ($journey->meta['coupon_code'] ?? null ? " kupon={$journey->meta['coupon_code']}" : ''));

            $log = $sender->send($tenantId, $channel, $to, $message, [
                'source' => 'cart_recovery_test',
                'source_type' => 'test',
                'tracking_token' => $token,
                'skip_gates' => true, // test: consent/suppression atla, ama yalnızca bu adrese
            ]);

            $this->table(['Alan', 'Değer'], [
                ['status', $log->status],
                ['provider', $log->provider ?? '-'],
                ['error', $log->error ?? '-'],
                ['coupon', $journey->meta['coupon_code'] ?? '-'],
            ]);

            return $log->status === 'sent' ? self::SUCCESS : self::FAILURE;
        } finally {
            $journey->delete(); // test journey'i temizle
        }
    }
}
