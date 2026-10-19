<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Models\ReturnRefund;
use App\Models\ReturnRequest;
use App\Services\Returns\ReturnAuditLogger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * MODÜL DIŞINDA (ödeme sağlayıcı paneli / Ticimax "karta iade") yapılmış bir para iadesini talebe
 * işler: refund satırı succeeded + talep Refunded + audit + personel notu. SMS GÖNDERİLMEZ (para
 * zaten müşteride; ek mesaj kafa karıştırır) ve Ticimax'a YAZILMAZ (panel iadesi zaten oradan yapıldı).
 *
 * Doğuş sebebi (2026-08-05, talep #50 tba37406032): modül PayTR iadesi yanlış ödeme satırı seçimiyle
 * 8 kez düştü; personel 794,45 TL'yi Ticimax panelinden iade etti → talep modülde staff_approved'da
 * asılı kaldı ve her yeni onay denemesi ÇİFT İADE riskiydi. Bu komut o boşluğu kapatır.
 *
 * Kullanım:  php artisan returns:mark-refunded tba37406032 --amount=794.45 \
 *              --txn=621706441990 --note="..." [--provider=paytr] [--dry-run]
 */
class MarkReturnRefunded extends Command
{
    protected $signature = 'returns:mark-refunded
        {id : İade talebi ID veya public_code}
        {--amount= : Fiilen iade edilen tutar (zorunlu)}
        {--txn= : Sağlayıcı işlem/referans no (ör. PayTR return_ref_num)}
        {--provider=paytr : Sağlayıcı anahtarı (paytr|iyzico|manual)}
        {--note= : Personel notu olarak düşülecek açıklama (zorunlu — kanıt/kaynak yazın)}
        {--dry-run : Yalnızca yapılacakları göster, yazma}';

    protected $description = 'Modül dışında yapılmış para iadesini talebe işler (Refunded + audit; SMS/Ticimax yazması YOK)';

    public function handle(ReturnAuditLogger $audit): int
    {
        $key = (string) $this->argument('id');
        $r = ReturnRequest::withoutGlobalScopes()
            ->when(ctype_digit($key), fn ($q) => $q->where('id', (int) $key))
            ->when(! ctype_digit($key), fn ($q) => $q->whereRaw('UPPER(public_code) = UPPER(?)', [$key]))
            ->first();

        if (! $r) {
            $this->error("Talep bulunamadı: {$key}");

            return self::FAILURE;
        }

        $amount = round((float) $this->option('amount'), 2);
        $note = trim((string) $this->option('note'));
        $provider = strtolower(trim((string) $this->option('provider'))) ?: 'manual';
        $txn = trim((string) $this->option('txn'));

        if ($amount <= 0) {
            $this->error('--amount zorunlu ve > 0 olmalı (fiilen iade edilen tutar).');

            return self::FAILURE;
        }
        if ($note === '') {
            $this->error('--note zorunlu: iadenin nerede/nasıl yapıldığının kanıtını yazın (denetim izi).');

            return self::FAILURE;
        }
        if ($r->status->isTerminal()) {
            $this->error("Talep {$r->public_code} zaten kapalı ({$r->status->value}).");

            return self::FAILURE;
        }
        if ($amount > round((float) $r->requested_amount, 2) + 0.01) {
            $this->error(sprintf('Tutar (%.2f) talep tutarını (%.2f) aşıyor — yazılmadı.', $amount, (float) $r->requested_amount));

            return self::FAILURE;
        }

        $this->table(['Alan', 'Değer'], [
            ['Talep', "#{$r->id} {$r->public_code} (tenant {$r->tenant_id})"],
            ['Mevcut durum', $r->status->value],
            ['İşlenecek tutar', number_format($amount, 2, ',', '.') . ' ' . ($r->currency ?? 'TRY')],
            ['Sağlayıcı / txn', $provider . ($txn !== '' ? " / {$txn}" : '')],
        ]);

        if ($this->option('dry-run')) {
            $this->info('DRY-RUN: hiçbir şey yazılmadı.');

            return self::SUCCESS;
        }

        $fromStatus = $r->status->value;

        DB::transaction(function () use ($r, $amount, $provider, $txn, $note) {
            /** @var ReturnRefund $refund */
            $refund = ReturnRefund::firstOrNew(['idempotency_key' => 'refund:original:' . $r->id]);
            $refund->fill([
                'tenant_id' => $r->tenant_id,
                'return_request_id' => $r->id,
                'provider' => $provider,
                'currency' => $r->currency ?? 'TRY',
                'amount' => $amount,
                'status' => 'succeeded',
                'error_message' => null,
            ]);
            $refund->provider_txn_id = $txn !== '' ? $txn : $refund->provider_txn_id;
            $refund->response_payload = [
                'last' => ['manual' => true, 'source' => 'returns:mark-refunded', 'note' => $note],
                'progress' => ['succeeded_txns' => array_values(array_filter([$txn])), 'refunded_total' => $amount],
            ];
            $refund->processed_at = now();
            $refund->save();

            $r->refunded_amount = $amount;
            $r->status = ReturnStatus::Refunded;
            $r->save();
        });

        $audit->log($r, 'refund', [
            'actor_type' => ReturnActorType::System,
            'from_status' => $fromStatus,
            'to_status' => ReturnStatus::Refunded->value,
            'amount' => $amount,
            'payload' => ['method' => $provider, 'provider_txn_id' => $txn ?: null, 'dry_run' => false, 'manual' => true, 'source' => 'returns:mark-refunded'],
        ]);
        $audit->log($r, 'staff_note', [
            'actor_type' => ReturnActorType::System,
            'payload' => ['note' => '[Manuel iade kaydı] ' . $note],
        ]);

        $this->info("Talep {$r->public_code}: {$fromStatus} → refunded olarak işlendi (SMS/Ticimax yazması yapılmadı).");

        return self::SUCCESS;
    }
}
