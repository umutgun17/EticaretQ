<?php

namespace App\Console\Commands;

use App\Enums\RefundMethod;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\ReturnRequest;
use App\Services\Returns\Payment\CodDetector;
use App\Services\Returns\RefundService;
use Illuminate\Console\Command;

/**
 * KAPIDA ÖDEME İPTALLERİNİ PARASIZ KAPAT (birikmiş kuyruk temizliği).
 *
 * Kapıda ödemeli sipariş iptal edildiğinde müşteri hiç ödeme yapmamıştır → iade edilecek para
 * yoktur. Bu özellik canlıya alınmadan önce açılan iptal talepleri yönetici PARA onayı kuyruğunda
 * asılı kaldı ve her onay denemesi "Karta iade sağlayıcısı belirlenemedi" ile düştü (11 talep,
 * 2026-09-01 tespiti). Bu komut onları CANLI ödeme bloğundan teyit ederek kapatır.
 *
 * ⛔ Güvenlik: her talep için Ticimax ödeme bloğu TEK TEK okunur; kapıda ödeme OLMAYAN (kartlı)
 * hiçbir talebe dokunulmaz. Yalnızca ERP iptali İŞLENMİŞ talepler (processing/manager_approved/
 * refunding) kapatılır — Pending'de kalanlarda sipariş henüz iptal edilmemiş olabilir.
 * Varsayılan olarak müşteriye SMS GÖNDERİLMEZ (geçmiş talepler; --notify ile açılır).
 *
 * Kullanım:  php artisan returns:close-cod-cancels --dry-run
 *            php artisan returns:close-cod-cancels [--id=438 --id=447] [--notify]
 */
class CloseCodCancels extends Command
{
    protected $signature = 'returns:close-cod-cancels
        {--id=* : Yalnızca bu talep ID(ler)i}
        {--tenant= : Yalnızca bu tenant}
        {--notify : Müşteriye kapanış mesajı gönder (varsayılan: gönderme)}
        {--dry-run : Yalnızca ne yapılacağını göster, yazma}';

    protected $description = 'Kapıda ödemeli iptal taleplerini para onayı beklemeden parasız kapatır';

    public function handle(CodDetector $cod, RefundService $refunds): int
    {
        $dry = (bool) $this->option('dry-run');
        $ids = array_filter(array_map('intval', (array) $this->option('id')));

        $rows = ReturnRequest::withoutGlobalScopes()
            ->where('type', ReturnType::Cancel->value)
            ->whereIn('status', [
                ReturnStatus::Processing->value,
                ReturnStatus::ManagerApproved->value,
                ReturnStatus::Refunding->value,
            ])
            ->when($ids !== [], fn ($q) => $q->whereIn('id', $ids))
            ->when($this->option('tenant'), fn ($q) => $q->where('tenant_id', (int) $this->option('tenant')))
            ->orderBy('id')
            ->get();

        if ($rows->isEmpty()) {
            $this->info('İşlenecek iptal talebi yok.');

            return self::SUCCESS;
        }

        $table = [];
        $closed = 0;
        $skipped = 0;

        foreach ($rows as $r) {
            $info = $cod->forRequest($r);

            if (! $info['cod']) {
                $skipped++;
                $table[] = ["#{$r->id}", $r->order_no, $r->status->value, number_format((float) $r->requested_amount, 2, ',', '.'), 'ATLANDI — ' . $info['reason']];

                continue;
            }

            if ($dry) {
                $closed++;
                $table[] = ["#{$r->id}", $r->order_no, $r->status->value, number_format((float) $r->requested_amount, 2, ',', '.'), 'KAPATILACAK (kapıda ödeme)'];

                continue;
            }

            // Yöntem işaretlenmeden parasız kapanış yapılamaz (RefundService guard'ı).
            $r->refund_method = RefundMethod::None;
            $meta = $r->metadata ?? [];
            $meta['cod'] = ['is_cod' => true, 'fee' => (float) $info['fee'], 'method_code' => $info['method_code'], 'detected_at' => now()->toIso8601String()];
            $r->save();

            $res = $refunds->closeWithoutRefund(
                $r,
                null,
                'Kapıda ödeme iptali — tahsilat yapılmadığı için iade edilecek tutar yok (birikmiş kuyruk temizliği).',
                notify: (bool) $this->option('notify')
            );

            if ($res['success']) {
                $closed++;
                $table[] = ["#{$r->id}", $r->order_no, $r->status->value, number_format((float) $r->requested_amount, 2, ',', '.'), 'KAPATILDI'];
            } else {
                $skipped++;
                $table[] = ["#{$r->id}", $r->order_no, $r->status->value, number_format((float) $r->requested_amount, 2, ',', '.'), 'HATA — ' . $res['error']];
            }
        }

        $this->table(['Talep', 'Sipariş', 'Durum', 'Tutar', 'Sonuç'], $table);
        $this->info(($dry ? '[DRY-RUN] ' : '') . "Kapatılan: {$closed}, dokunulmayan: {$skipped}");

        return self::SUCCESS;
    }
}
