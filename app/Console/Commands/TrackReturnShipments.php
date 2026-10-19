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

/**
 * İade gönderilerinin kargo durumunu tenant'ın kargo sağlayıcısından (Sürat / DHL-MNG)
 * otomatik takip eder ve statüyü ilerletir:
 *   AwaitingShipment → InTransit (kabul/yola çıktı) → Received (merchant'a teslim).
 * Received'da received_at = now() (7 gün personel inceleme sayacı başlar) + müşteriye SMS.
 *
 * ⛔ CANLI ORTAM KURALI: sağlayıcı dry_run iken canlı sorgu yapılmaz (queryShipment status=null döner) →
 * statü ilerletilmez. Yalnızca İADE tipi (iptalde kargo yok).
 */
class TrackReturnShipments extends Command
{
    protected $signature = 'returns:track-shipments
                            {--tenant= : Belirli tenant ID}
                            {--limit=200 : İşlenecek azami kayıt}
                            {--backfill : Statüsü ZATEN ilerlemiş kayıtların eksik teslim bilgisini sağlayıcıdan doldur (statü/received_at değişmez)}';

    protected $description = 'İade kargolarını tenant\'ın kargo sağlayıcısı üzerinden otomatik takip eder ve statüleri ilerletir';

    /**
     * Sağlayıcının teslim tarihini Carbon'a çevirir. Sürat gün.ay.yıl saat:dk[:sn] döner,
     * DHL ISO benzeri; biçim tanınmazsa null → çağıran now()'a düşer (statü ilerlemesi
     * ASLA tarih biçimine takılmaz). Gelecek/absürt tarihler de reddedilir.
     *
     * ⚠️ SAAT DİLİMİ: uygulama UTC saklar, kargo firmaları TÜRKİYE saati döner (canlı kanıt:
     * #69 Sürat "Teslim Edildi 15:07:22", cron aynı teslimi 12:08 UTC'de yakalamıştı = +3 sa).
     * Dönüştürmeden yazılırsa teslim saati panelde 3 saat ileri görünür ve received_at'e
     * bağlı SLA sayacı geç başlar → Europe/Istanbul kabul edilip UTC'ye çevrilir.
     */
    public static function parseDeliveredAt(?string $raw): ?\Illuminate\Support\Carbon
    {
        $raw = trim((string) $raw);
        if ($raw === '' || mb_strtolower(str_replace(' ', '', $raw)) === 'teslimedilmedi') {
            return null;
        }

        // Sürat: hareket zamanı "2026-08-01T15:07:22.000" / TeslimTarihi "01/08/2026" (saatsiz).
        $raw = preg_replace('/\.\d+$/', '', $raw);

        foreach (['Y-m-d\TH:i:s', 'Y-m-d H:i:s', 'd.m.Y H:i:s', 'd.m.Y H:i', 'd/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y', 'd.m.Y'] as $fmt) {
            try {
                $c = \Illuminate\Support\Carbon::createFromFormat($fmt, $raw, 'Europe/Istanbul');
                if ($c && $c->year > 2020) {
                    // Saatsiz biçim (Sürat'ın TeslimTarihi'si "01/08/2026") → createFromFormat
                    // eksik saati O ANKİ saatle doldurur; gün başına sabitlenir ki uydurma
                    // saat gösterilmesin (panel 00:00'ı görünce yalnız tarihi yazar).
                    if (! str_contains($fmt, 'H')) {
                        $c = $c->startOfDay();
                    }
                    $c = $c->setTimezone(config('app.timezone', 'UTC'));
                    if ($c->lessThan(now()->addDay())) {
                        return $c;
                    }
                }
            } catch (\Throwable) {
                // sıradaki biçimi dene
            }
        }

        return null;
    }

    public function handle(ReturnAuditLogger $audit, ReturnNotifier $notifier): int
    {
        if ($this->option('backfill')) {
            return $this->backfill();
        }

        $query = ReturnRequest::withoutGlobalScopes()
            ->with('tenant')
            ->whereIn('type', [ReturnType::Return->value, ReturnType::Defect->value])
            ->whereIn('status', [ReturnStatus::AwaitingShipment->value, ReturnStatus::InTransit->value])
            ->whereNotNull('cargo_tracking_code');

        if ($tenantId = $this->option('tenant')) {
            $query->where('tenant_id', (int) $tenantId);
        }

        $requests = $query->limit((int) $this->option('limit'))->get();
        if ($requests->isEmpty()) {
            $this->info('Takip edilecek iade gönderisi yok.');

            return 0;
        }

        $advanced = 0;
        foreach ($requests as $r) {
            $cargo = CargoProviderFactory::forRequest($r);
            $res = $cargo->queryShipment((string) $r->cargo_tracking_code);

            if (! $res['success'] || $res['status'] === null) {
                // dry-run / yapılandırılmamış / hata → ilerletme yok.
                continue;
            }

            $target = null;
            if ($res['delivered'] && $r->status->canTransitionTo(ReturnStatus::Received)) {
                $target = ReturnStatus::Received;
            } elseif ($res['in_transit'] && $r->status === ReturnStatus::AwaitingShipment) {
                $target = ReturnStatus::InTransit;
            }

            if (! $target) {
                continue;
            }

            $from = $r->status;
            $meta = $r->metadata ?? [];

            // Taşıyıcının KENDİ takip numarası + hazır takip linki (bizim tba… kodumuzdan farklı) —
            // panelde "kargo takip" bağlantısı bununla açılır; ilk görüldüğü anda saklanır.
            $carrier = array_filter([
                'tracking_no' => $res['carrier_tracking_no'] ?? null,
                'tracking_url' => $res['tracking_url'] ?? null,
                'barcode' => $res['cargo_barcode'] ?? null,   // paket üzerindeki 11 haneli barkod
            ], fn ($v) => $v !== null && $v !== '');
            if ($carrier) {
                $meta['cargo_carrier'] = array_merge($meta['cargo_carrier'] ?? [], $carrier);
            }

            if ($target === ReturnStatus::Received) {
                // Kargo firmasının TESLİM ANI cron koşum anından farklıdır (cron 30 dk'da bir) →
                // sağlayıcı tarih verdiyse onu kullan; personel listede gerçek teslim saatini görür.
                $delivered = self::parseDeliveredAt($res['delivered_at'] ?? null);
                $r->received_at = $delivered ?? now();

                $meta['delivery'] = array_filter([
                    'delivered_at' => optional($delivered)->format('Y-m-d H:i:s'),
                    'delivered_at_raw' => $res['delivered_at'] ?? null,
                    'received_by' => $res['received_by'] ?? null,
                    'delivered_place' => $res['delivered_place'] ?? null,
                    'provider' => $cargo->providerKey(),
                ], fn ($v) => $v !== null && $v !== '');
            }

            $r->metadata = $meta;
            $r->status = $target;
            $r->save();

            $audit->log($r, 'auto_transition', [
                'actor_type' => ReturnActorType::System,
                'from_status' => $from->value,
                'to_status' => $target->value,
                'payload' => array_filter([
                    'source' => $cargo->providerKey(),
                    'status' => $res['status'],
                    'teslim_alan' => $target === ReturnStatus::Received ? ($res['received_by'] ?? null) : null,
                    'teslim_tarihi' => $target === ReturnStatus::Received ? ($res['delivered_at'] ?? null) : null,
                ], fn ($v) => $v !== null && $v !== ''),
            ]);

            // Her statü geçişinde müşteriye bilgilendirme SMS'i (kullanıcı kararı 2026-07-07):
            // kargoya verildi → in_transit, depoya ulaştı → received.
            if ($target === ReturnStatus::Received) {
                $notifier->notify($r, 'received');
            } elseif ($target === ReturnStatus::InTransit) {
                $notifier->notify($r, 'in_transit');
            }

            $advanced++;
            $this->line("#{$r->id} {$r->public_code}: {$from->value} → {$target->value}");
        }

        $this->info("Takip tamam. İlerletilen: {$advanced}/{$requests->count()}.");

        return 0;
    }

    /**
     * GERİYE DÖNÜK doldurma: teslim bilgisi (tarih/saat, teslim alan) kayıt altına alınmaya
     * 2026-08-03'te başlandı; daha önce depoya ulaşmış talepler panelde boş görünüyordu.
     * Statüye ve received_at'e DOKUNMAZ (SLA sayaçları kaymasın) — yalnız metadata doldurur.
     */
    private function backfill(): int
    {
        $query = ReturnRequest::withoutGlobalScopes()
            ->with('tenant')
            ->whereIn('type', [ReturnType::Return->value, ReturnType::Defect->value])
            ->whereIn('status', [
                ReturnStatus::Received->value, ReturnStatus::StaffApproved->value,
                ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value,
                ReturnStatus::Refunded->value, ReturnStatus::Completed->value,
            ])
            ->whereNotNull('cargo_tracking_code');

        if ($tenantId = $this->option('tenant')) {
            $query->where('tenant_id', (int) $tenantId);
        }

        $requests = $query->limit((int) $this->option('limit'))->get()
            ->filter(fn ($r) => empty($r->metadata['delivery']));

        if ($requests->isEmpty()) {
            $this->info('Teslim bilgisi eksik kayıt yok.');

            return 0;
        }

        $filled = 0;
        foreach ($requests as $r) {
            $cargo = CargoProviderFactory::forRequest($r);
            $res = $cargo->queryShipment((string) $r->cargo_tracking_code);
            if (! ($res['success'] ?? false)) {
                $this->line("#{$r->id} {$r->public_code}: sorgulanamadı — " . ($res['error'] ?? '?'));

                continue;
            }

            $meta = $r->metadata ?? [];
            $carrier = array_filter([
                'tracking_no' => $res['carrier_tracking_no'] ?? null,
                'tracking_url' => $res['tracking_url'] ?? null,
                'barcode' => $res['cargo_barcode'] ?? null,   // paket üzerindeki 11 haneli barkod
            ], fn ($v) => $v !== null && $v !== '');
            if ($carrier) {
                $meta['cargo_carrier'] = array_merge($meta['cargo_carrier'] ?? [], $carrier);
            }

            $delivered = self::parseDeliveredAt($res['delivered_at'] ?? null);
            $delivery = array_filter([
                'delivered_at' => optional($delivered)->format('Y-m-d H:i:s'),
                'delivered_at_raw' => $res['delivered_at'] ?? null,
                'received_by' => $res['received_by'] ?? null,
                'delivered_place' => $res['delivered_place'] ?? null,
                'provider' => $cargo->providerKey(),
                'backfilled' => true,
            ], fn ($v) => $v !== null && $v !== '');

            if (! isset($delivery['delivered_at']) && ! isset($delivery['received_by'])) {
                $this->line("#{$r->id} {$r->public_code}: sağlayıcıda teslim bilgisi yok, atlandı.");
                if ($carrier) {
                    $r->metadata = $meta;
                    $r->save();
                }

                continue;
            }

            $meta['delivery'] = $delivery;
            $r->metadata = $meta;
            $r->save();
            $filled++;
            $this->line("#{$r->id} {$r->public_code}: " . ($delivery['delivered_at'] ?? '-') . ' · ' . ($delivery['received_by'] ?? '-'));
        }

        $this->info("Backfill tamam. Dolan: {$filled}/{$requests->count()}.");

        return 0;
    }
}
