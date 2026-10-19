<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\ReturnRequest;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnErpProcessor;
use App\Services\Returns\ReturnNotifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * İPTAL otomasyonunu YENİDEN dener (Nebim ModelType 34 + Ticimax iptal).
 *
 * İptal otomasyonu normalde talep anında (PublicReturnController::autoProcessCancel) çalışır;
 * ERP/bağlantı hatasında talep Pending'de kalır ve panelde yeniden deneme yolu yoktur — bu komut
 * o boşluğu kapatır. Başarı → Pending → Processing (yalnızca yönetici PARA onayı kalır),
 * autoProcessCancel ile birebir aynı yan etkiler (audit + 'cancel_processing' bildirimi).
 *
 * Kullanım:  php artisan returns:retry-cancel 96 [--dry-run]
 */
class RetryCancelProcess extends Command
{
    protected $signature = 'returns:retry-cancel
        {id : İade talebi ID veya public_code (ör. 96 / TBP71770262)}
        {--dry-run : Yalnızca ModelType 34 önizlemesini göster, ERP\'ye yazma}';

    protected $description = 'Başarısız kalan iptal otomasyonunu yeniden dener (Nebim + Ticimax)';

    public function handle(ReturnErpProcessor $erp, ReturnAuditLogger $audit, ReturnNotifier $notifier): int
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
        if ($r->type !== ReturnType::Cancel) {
            $this->error("Talep {$r->public_code} bir İPTAL talebi değil ({$r->type->value}).");

            return self::FAILURE;
        }
        if ($r->status !== ReturnStatus::Pending) {
            $this->error("Talep {$r->public_code} Pending değil ({$r->status->value}) — otomasyon zaten işlemiş olabilir.");

            return self::FAILURE;
        }

        $this->line("Talep: {$r->public_code} · sipariş {$r->order_no} (SiparisID {$r->platform_order_id})");

        // Önizleme bilgilendirme amaçlı — Nebim ZATEN işlenmişse üretilemez (fatura guard'ı /
        // sıfırlanmış adetler); o durumda resume akışı adım adım kendisi karar verir.
        $preview = $erp->nebimFor($r)->previewModelType34($r);
        if ($preview['success']) {
            $this->line('Kapsam: ' . (($preview['is_full'] ?? false) ? 'TAM iptal' : 'KISMİ iptal')
                . ' · tutar: ' . number_format((float) $preview['amount'], 2, ',', '.') . ' TL'
                . ' · satır: ' . count($preview['payload']['Lines'] ?? []));
        } else {
            $this->warn('Nebim önizlemesi üretilemedi (' . ($preview['error'] ?? '?') . ') — Nebim zaten işlenmiş olabilir, adım adım kontrol edilecek.');
        }

        if ($this->option('dry-run')) {
            $this->warn('--dry-run: ERP\'ye yazılmadı.');

            return self::SUCCESS;
        }

        // Adım-idempotent devam: yapılmış adımları (Nebim/Ticimax) canlıdan doğrulayıp atlar.
        $result = $erp->processCancelResume($r);

        if (! $result['success']) {
            $meta = $r->metadata ?? [];
            $meta['erp_error'] = ['error' => $result['error'] ?? 'bilinmeyen', 'at' => now()->toIso8601String()];
            $r->metadata = $meta;
            $r->save();

            $audit->log($r, 'cancel_process_failed', [
                'actor_type' => ReturnActorType::System,
                'payload' => ['error' => $result['error'] ?? null, 'retry' => true],
            ]);

            $this->error('Başarısız: ' . ($result['error'] ?? '?'));

            return self::FAILURE;
        }

        DB::transaction(function () use ($r, $result, $audit) {
            $from = $r->status;
            $r->nebim_result = $result['nebim'];
            $meta = $r->metadata ?? [];
            $meta['ticimax_cancel'] = $result['ticimax'];
            unset($meta['erp_error']);
            $r->metadata = $meta;
            $r->status = ReturnStatus::Processing;
            $r->save();

            $audit->log($r, 'cancel_process', [
                'actor_type' => ReturnActorType::System,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::Processing->value,
                'payload' => array_filter([
                    'nebim_order_number' => $result['nebim']['order_number'] ?? null,
                    'nebim_kapsam' => ($result['nebim']['is_full'] ?? false) ? 'tam' : 'kısmi',
                    'nebim_dry_run' => ($result['nebim']['dry_run'] ?? false) ? 'evet' : 'hayır',
                    'nebim_atlandi' => ($result['nebim']['skipped'] ?? false) ? 'evet (zaten işlenmişti)' : null,
                    'ticimax_yontem' => $result['ticimax']['method'] ?? null,
                    'ticimax_dry_run' => ($result['ticimax']['dry_run'] ?? false) ? 'evet' : 'hayır',
                    'ticimax_atlandi' => ($result['ticimax']['skipped'] ?? false) ? 'evet (zaten işlenmişti)' : null,
                    'yeniden_deneme' => 'evet',
                ]),
            ]);
        });

        // KAPIDA ÖDEME: tahsilat yapılmadığı için iade edilecek para yok → para onayına düşmeden
        // otomatik kapanır (public akışın autoProcessCancel'ıyla birebir aynı davranış).
        // Bu özellikten ÖNCE açılmış talepler 'original' ile kayıtlıdır; canlı ödeme bloğundan
        // teyit edilip yöntem düzeltilir (kartlı siparişlere DOKUNULMAZ — fail-closed).
        if ($r->refund_method !== \App\Enums\RefundMethod::None) {
            $cod = app(\App\Services\Returns\Payment\CodDetector::class)->forRequest($r);
            if ($cod['cod']) {
                $meta = $r->metadata ?? [];
                $meta['cod'] = ['is_cod' => true, 'fee' => (float) $cod['fee'], 'method_code' => $cod['method_code'], 'detected_at' => now()->toIso8601String()];
                $r->metadata = $meta;
                $r->refund_method = \App\Enums\RefundMethod::None;
                $r->save();
            }
        }

        if ($r->refund_method === \App\Enums\RefundMethod::None) {
            $closed = app(\App\Services\Returns\RefundService::class)->closeWithoutRefund(
                $r,
                null,
                'Kapıda ödeme iptali — tahsilat yapılmadığı için iade edilecek tutar yok.'
            );
            if ($closed['success']) {
                $this->info("Başarılı → {$r->public_code} kapıda ödeme iptali olduğu için kapatıldı (iade yok).");

                return self::SUCCESS;
            }
        }

        $notifier->notify($r, 'cancel_processing');

        $this->info("Başarılı → {$r->public_code} artık Processing (yönetici para onayı bekliyor).");

        return self::SUCCESS;
    }
}
