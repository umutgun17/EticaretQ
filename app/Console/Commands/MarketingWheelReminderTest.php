<?php

namespace App\Console\Commands;

use App\Models\WheelSpin;
use App\Services\Marketing\UnifiedSender;
use App\Services\Marketing\WheelCouponReminder;
use Illuminate\Console\Command;

/**
 * Çark hatırlatma SMS'ini YALNIZCA verilen test telefonuna gönderir (gerçek
 * çark katılımcılarına DOKUNMAZ). Sentetik örnek kupon ile gerçek şablon/format
 * önizlemesi — kendine test amaçlı.
 *
 *   php artisan marketing:wheel-reminder-test --tenant=1 --phone=+90543...
 */
class MarketingWheelReminderTest extends Command
{
    protected $signature = 'marketing:wheel-reminder-test
        {--tenant= : Tenant ID (zorunlu)}
        {--phone= : Test telefon numarası (zorunlu)}';

    protected $description = 'Çark hatırlatma SMS\'ini sadece test telefonuna gönderir (canlı katılımcılara değil)';

    public function handle(WheelCouponReminder $reminder, UnifiedSender $sender): int
    {
        $tenantId = (int) $this->option('tenant');
        $phone = trim((string) $this->option('phone'));

        if (! $tenantId || $phone === '') {
            $this->error('--tenant ve --phone zorunludur.');

            return self::FAILURE;
        }

        // Sentetik örnek kupon (gerçek müşteri kuponu sızdırılmaz) — kaydedilmez.
        $spin = new WheelSpin([
            'coupon_code' => 'TEST-'.strtoupper(substr(md5(uniqid()), 0, 5)),
            'prize_label' => '100 TL',
            'coupon_expires_at' => now()->addHours(2),
        ]);

        $message = $reminder->buildSms($tenantId, $spin, null);

        $this->info("Gönderiliyor → kanal=sms alıcı={$phone} kupon={$spin->coupon_code}");
        $this->line('Metin: '.$message['body']);

        $log = $sender->send($tenantId, 'sms', $phone, $message, [
            'source' => WheelCouponReminder::KEY, // panel gönderim listesinde görünsün
            'source_type' => 'test',              // ama sayaç/ciro hesaplarına dahil edilmez
            'skip_gates' => true,                 // test: pencere/cap atla, ama yalnızca bu numaraya
        ]);

        $this->table(['Alan', 'Değer'], [
            ['status', $log->status],
            ['provider', $log->provider ?? '-'],
            ['provider_id', $log->provider_message_id ?? '-'],
            ['error', $log->error ?? '-'],
        ]);

        return $log->status === 'sent' ? self::SUCCESS : self::FAILURE;
    }
}
