<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\ReturnRequest;
use App\Services\Returns\CargoProviderFactory;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnNotifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Süresi (tenant kuralı `shipment_expire_days`, varsayılan 14 gün — panelden ayarlanır)
 * içinde kargoya verilmeyen iade kodlarını pasifleştirir. Sağlayıcı tenant'a göre seçilir (Sürat / DHL-MNG):
 *   AwaitingShipment + kargo hareketi yok + süre dolmuş →
 *     (1) sağlayıcıdan son durum sorgulanır — yola çıktıysa/teslimse DOKUNULMAZ (takip cron'u ilerletir);
 *     (2) sağlayıcıdaki gönderi kaydı SİLİNİR/İPTAL edilir (Sürat GonderiSil / DHL cancelorder) → kod şubede geçmez;
 *     (3) talep kapatılır (CancelledByCustomer + metadata.expired) + müşteriye 'expired' SMS.
 *
 * Süre başlangıcı: kargo kodunun oluştuğu an (audit `cargo_created` event'i; yoksa talep created_at).
 * GonderiSil başarısız olursa talep AÇIK KALIR → ertesi gün yeniden denenir (idempotent:
 * "bulunamadı" yanıtı başarı sayılır).
 */
class ExpireReturnShipments extends Command
{
    protected $signature = 'returns:expire-shipments
                            {--tenant= : Belirli tenant ID}
                            {--days= : Süre (gün) — boşsa tenant kuralı shipment_expire_days}
                            {--limit=200 : İşlenecek azami kayıt}';

    protected $description = 'Süresi dolan (kargoya verilmemiş) iade kodlarını kargo sağlayıcısından siler ve talebi kapatır';

    public function handle(ReturnAuditLogger $audit, ReturnNotifier $notifier, \App\Services\Returns\ReturnRulesService $rules): int
    {
        $query = ReturnRequest::withoutGlobalScopes()
            ->with('tenant')
            ->whereIn('type', [ReturnType::Return->value, ReturnType::Defect->value])
            ->where('status', ReturnStatus::AwaitingShipment->value)
            ->whereNotNull('cargo_tracking_code');

        if ($tenantId = $this->option('tenant')) {
            $query->where('tenant_id', (int) $tenantId);
        }

        $requests = $query->limit((int) $this->option('limit'))->get();
        if ($requests->isEmpty()) {
            $this->info('Süresi kontrol edilecek iade gönderisi yok.');

            return 0;
        }

        $expired = 0;
        foreach ($requests as $r) {
            $cargo = CargoProviderFactory::forRequest($r);
            // Süre: --days > tenant kuralı (shipment_expire_days, panelden) > sağlayıcı config fallback.
            $days = (int) ($this->option('days')
                ?: ($r->tenant ? $rules->shipmentExpireDays($r->tenant) : $cargo->expireDays()));
            $days = max(1, $days);

            // Süre başlangıcı: kargo kodu oluşturma anı (audit) — yoksa talep oluşturma anı.
            $cargoCreatedAt = $r->events()
                ->where('action', 'cargo_created')
                ->latest('id')
                ->value('created_at') ?? $r->created_at;

            if ($cargoCreatedAt === null || now()->diffInDays($cargoCreatedAt, true) < $days) {
                continue; // süre henüz dolmadı
            }

            // GÜVENLİK: silmeden önce son durumu sorgula — kargo bu arada yola çıktıysa dokunma
            // (takip cron'u InTransit/Received'a ilerletir; expiry bir sonraki turda zaten eleyecek).
            $track = $cargo->queryShipment((string) $r->cargo_tracking_code);
            if (($track['in_transit'] ?? false) || ($track['delivered'] ?? false)) {
                $this->line("#{$r->id} {$r->public_code}: kargo hareket görmüş (".($track['status'] ?? '?').') — atlandı.');

                continue;
            }

            $cancel = $cargo->cancelShipment((string) $r->cargo_tracking_code);
            if (! $cancel['success']) {
                $this->warn("#{$r->id} {$r->public_code}: sağlayıcı iptali başarısız — {$cancel['error']} (yarın yeniden denenecek)");

                continue; // talep açık kalır, ertesi çalıştırmada tekrar denenir.
            }

            DB::transaction(function () use ($r, $audit, $cancel, $days, $cargo) {
                $from = $r->status;
                $meta = $r->metadata ?? [];
                $meta['expired'] = ['at' => now()->toIso8601String(), 'days' => $days, 'provider' => $cargo->providerKey(), 'provider_result' => $cancel['result']];
                $r->metadata = $meta;
                $r->shipment_status = 'expired';
                $r->status = ReturnStatus::CancelledByCustomer;
                $r->save();

                $audit->log($r, 'shipment_expired', [
                    'actor_type' => ReturnActorType::System,
                    'from_status' => $from->value,
                    'to_status' => ReturnStatus::CancelledByCustomer->value,
                    'payload' => array_filter([
                        'cargo_tracking_code' => $r->cargo_tracking_code,
                        'days' => $days,
                        'provider' => $cargo->providerKey(),
                        'provider_result' => $cancel['result'],
                        'dry_run' => ($cancel['dry_run'] ?? false) ? 'evet' : null,
                    ]),
                ]);
            });

            // Ürün kırılımı 'İade Talebi' işaretlenmişse Ticimax'ta 'İşlemde'ye geri çek (best-effort).
            if (($r->metadata['ticimax_item_status'] ?? null) === 'return_requested') {
                app(\App\Services\Returns\ReturnErpProcessor::class)->ticimaxItemStatuses($r, 'reverted');
            }

            // Sipariş statüsü bizim tarafımızdan yazıldıysa iade öncesine geri çek — VARSAYILAN
            // KAPALI (Ticimax statü-SMS otomasyonu müşteriye ikinci teslim SMS'i atabilir).
            $erp = app(\App\Services\Returns\ReturnErpProcessor::class);
            $req = $r->metadata['ticimax_return_requested'] ?? null;
            if ($erp->ticimaxRejectRevertEnabled($r) && is_array($req) && ($req['success'] ?? false) && ! ($req['dry_run'] ?? false)) {
                $revert = $erp->ticimaxRejectRevert($r);
                $meta = $r->metadata ?? [];
                $meta['ticimax_reject_revert'] = $revert;
                $r->metadata = $meta;
                $r->save();
                $audit->log($r, 'ticimax_reject_revert', [
                    'actor_type' => ReturnActorType::System,
                    'payload' => array_filter([
                        'durum' => $revert['payload']['durum'] ?? null,
                        'success' => ($revert['success'] ?? false) ? 'evet' : 'hayır',
                        'dry_run' => ($revert['dry_run'] ?? false) ? 'evet' : null,
                        'error' => $revert['error'] ?? null,
                    ]),
                ]);
            }

            // Müşteriye bilgilendirme: kod artık geçersiz, yeni talep açabilir.
            $notifier->notify($r, 'expired', ['expire_days' => $days]);

            $expired++;
            $this->line("#{$r->id} {$r->public_code}: süresi doldu → sağlayıcı kaydı silindi, talep kapatıldı.");
        }

        $this->info("Süre kontrolü tamam. Pasifleştirilen: {$expired}/{$requests->count()}.");

        return 0;
    }

}
