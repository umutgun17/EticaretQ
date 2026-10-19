<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\ReturnRequest;
use App\Services\Returns\CargoProviderFactory;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnErpProcessor;
use App\Services\Returns\ReturnNotifier;
use App\Services\Returns\ReturnRulesService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Kargo kodu üretilemeden Pending'de takılan iade taleplerini yeniden dener (2026-09-10).
 *
 * OLAY: 6-7 Eylül'de Sürat SOAP servisi aralıklı "Internal Server Error" verdi. Submit anındaki
 * tek deneme başarısız olunca talep KODSUZ Pending'de kaldı; müşteriye yalnız "talebiniz alındı"
 * SMS'i gitti. public_code ile kargo kodu aynı string olduğundan (OzelKargoTakipNo = public_code)
 * müşteriler talep numarasını kargo kodu sanıp şubeye gitti → "kod geçersiz". 5 müşteri mağdur
 * oldu ve 10 güne kadar kimse fark etmedi — yeniden deneyen hiçbir mekanizma yoktu.
 *
 * Bu komut o boşluğu kapatır: SuratKargoService içindeki anlık 3 denemeyi de aşan kesintilerde
 * (sağlayıcı saatlerce kapalıysa) talebi arka planda takip eder ve servis düzelir düzelmez kodu
 * üretip müşteriye normal `cargo_code` SMS'ini gönderir.
 *
 * Kapsam: type=return|defect, status=pending, cargo_tracking_code NULL, metadata.cargo_error dolu.
 * Kusur bildirimi (defect) yönetici onayında kod aldığı için DefectReview'daki talepler hariçtir —
 * yalnız onay sonrası kod üretimi düşenler (pending) yeniden denenir.
 *
 * Güvenlik sınırları:
 *   • İade penceresi (deadline) geçmiş talep denenmez — süresi dolmuş iadeye kod verilmez.
 *   • metadata.cargo_retry.count azami denemeye ulaşınca bırakılır (`giving_up`) → sonsuz döngü
 *     ve gereksiz SOAP yükü olmaz; talep panelde kırmızı rozetle personele kalır.
 *   • Mükerrer gönderi koruması SuratKargoService::sendLive içindedir (yeniden denemeden önce
 *     kodun sağlayıcıda kaydı sorulur).
 */
class RetryReturnCargo extends Command
{
    protected $signature = 'returns:retry-cargo
                            {--tenant= : Belirli tenant ID}
                            {--id=* : Yalnız bu talep ID(leri)}
                            {--max-attempts=24 : Bir talep için azami yeniden deneme}
                            {--no-sms : Kod üret ama müşteriye SMS gönderme}
                            {--limit=50 : İşlenecek azami kayıt}';

    protected $description = 'Kargo kodu üretilemeden Pending\'de kalan iade taleplerine kodu yeniden üretmeyi dener';

    public function handle(ReturnAuditLogger $audit, ReturnNotifier $notifier, ReturnErpProcessor $erp, ReturnRulesService $rules): int
    {
        $query = ReturnRequest::withoutGlobalScopes()
            ->with('tenant')
            ->whereIn('type', [ReturnType::Return->value, ReturnType::Defect->value])
            ->where('status', ReturnStatus::Pending->value)
            ->whereNull('cargo_tracking_code');

        if ($ids = array_filter((array) $this->option('id'))) {
            $query->whereIn('id', $ids);
        } else {
            // Elle seçilmediyse yalnız kod üretimi DÜŞMÜŞ talepler (yeni submit'ler değil).
            $query->whereRaw("metadata::text ilike ?", ['%cargo_error%']);
        }

        if ($tenantId = $this->option('tenant')) {
            $query->where('tenant_id', (int) $tenantId);
        }

        $requests = $query->orderBy('id')->limit((int) $this->option('limit'))->get();
        if ($requests->isEmpty()) {
            $this->info('Yeniden denenecek kodsuz iade talebi yok.');

            return 0;
        }

        $maxAttempts = max(1, (int) $this->option('max-attempts'));
        $ok = $failed = $skipped = 0;

        foreach ($requests as $r) {
            $meta = $r->metadata ?? [];
            $tries = (int) ($meta['cargo_retry']['count'] ?? 0);

            if ($tries >= $maxAttempts) {
                $skipped++;
                $this->line("#{$r->id} {$r->public_code} — azami deneme aşıldı ({$tries}), bırakıldı");
                continue;
            }

            // İade penceresi dolmuşsa kod üretme (süresi geçmiş iadeye gönderi açılmaz).
            $deadline = ($r->eligibility_snapshot ?? [])['deadline'] ?? null;
            if ($deadline && strtotime((string) $deadline) < strtotime(now()->toDateString())) {
                $skipped++;
                $this->warn("#{$r->id} {$r->public_code} — iade penceresi dolmuş ({$deadline}), atlandı");
                continue;
            }

            $cargo = CargoProviderFactory::forRequest($r)->createReturnShipment($r);

            if (! ($cargo['success'] ?? false)) {
                $failed++;
                $meta['cargo_retry'] = [
                    'count' => $tries + 1,
                    'last_at' => now()->toIso8601String(),
                    'last_error' => $cargo['error'] ?? null,
                    'giving_up' => ($tries + 1) >= $maxAttempts,
                ];
                $meta['cargo_error'] = ['error' => $cargo['error'] ?? 'bilinmeyen', 'at' => now()->toIso8601String()];
                $r->metadata = $meta;
                $r->save();
                $this->error("#{$r->id} {$r->public_code} — başarısız ({$tries}. deneme): " . ($cargo['error'] ?? '?'));
                continue;
            }

            $from = $r->status;
            DB::transaction(function () use ($r, $cargo, $audit, $from, $tries, $meta) {
                $r->cargo_provider = $cargo['provider'];
                $r->cargo_tracking_code = $cargo['tracking_code'];
                $r->cargo_label_url = $cargo['label_url'];
                $r->shipment_status = ($cargo['dry_run'] ?? false) ? 'dry_run' : 'created';
                $r->status = ReturnStatus::AwaitingShipment;

                $meta['cargo_retry'] = [
                    'count' => $tries + 1,
                    'last_at' => now()->toIso8601String(),
                    'resolved_at' => now()->toIso8601String(),
                ];
                unset($meta['cargo_error']);
                $r->metadata = $meta;
                $r->save();

                $audit->log($r, 'cargo_created', [
                    'actor_type' => ReturnActorType::System,
                    'from_status' => $from->value,
                    'to_status' => ReturnStatus::AwaitingShipment->value,
                    'payload' => array_filter([
                        'cargo_tracking_code' => $cargo['tracking_code'],
                        'not' => 'Otomatik yeniden denemeyle üretildi (returns:retry-cargo, ' . ($tries + 1) . '. deneme).',
                    ]),
                ]);
            });

            // Ticimax 'İade Talebi Alındı' — public akışla birebir (best-effort).
            if ($r->tenant) {
                $ticimax = $erp->ticimaxReturnRequested($r);
                $meta = $r->metadata ?? [];
                $meta['ticimax_return_requested'] = $ticimax;
                $r->metadata = $meta;
                $r->save();
            }

            if (! $this->option('no-sms')) {
                $notifier->notify($r, 'cargo_code', [
                    'tracking_code' => $r->cargo_tracking_code,
                    'expire_days' => $r->tenant ? $rules->shipmentExpireDays($r->tenant) : 14,
                ]);
            }

            $ok++;
            $this->info("#{$r->id} {$r->public_code} — KOD ÜRETİLDİ: {$r->cargo_tracking_code}" . ($this->option('no-sms') ? ' (SMS yok)' : ' + SMS'));
        }

        $this->line("Özet: {$ok} üretildi, {$failed} başarısız, {$skipped} atlandı.");

        return 0;
    }
}
