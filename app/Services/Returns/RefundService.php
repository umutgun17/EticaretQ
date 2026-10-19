<?php

namespace App\Services\Returns;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\RefundMethod;
use App\Models\Channel;
use App\Models\ReturnRefund;
use App\Models\ReturnRequest;
use App\Models\User;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Faz 4 — Para iadesi orkestrasyonu. Yönetici PARA onayından (ManagerApproved) SONRA tetiklenir.
 *
 * İKİ YÖNTEM:
 *  - store_credit → Ticimax HediyeCekiOlustur ile ANINDA tek-kullanımlık indirim kuponu (dış anahtar
 *    GEREKMEZ). İade tutarı kadar TUTAR (TL) indirim kuponu açılır, müşteriye kod gider.
 *  - original (karta iade) → iyzico/PayTR API'sinden DAİMA OTOMATİK (kullanıcı kararı 2026-07-07:
 *    manuel yol YOK). Sağlayıcı reddederse/çözülemezse iade BAŞARISIZ döner → çağıran (approveManager)
 *    onayı geri alır ve hata panelde gösterilir; sorun giderilince tekrar denenir. Çok-kalemli iyzico
 *    iadesi kalemlere otomatik dağıtılır (planRefund); yarım kalırsa retry kaldığı yerden devam eder.
 *
 * GÜVENLİK:
 *  - İdempotent: aynı talep için tek ReturnRefund satırı (idempotency_key unique). Başarılı/dry_run
 *    kupon varsa tekrar çağrı yeni kupon AÇMAZ (çift iade guard).
 *  - Tutar tavanı: approved_amount > 0 olmalı; kupon değeri = approved_amount (yöneticinin onayladığı).
 *  - ⛔ dry_run iken Ticimax'a GERÇEK kupon YAZILMAZ; payload loglanır, ReturnRefund `dry_run` açılır,
 *    akış test için Refunded'a ilerletilir (SMS de dry-run). Canlı: refund.dry_run=false.
 *  - Her işlem append-only audit (ReturnRequestEvent) + müşteriye `refunded` SMS.
 */
class RefundService
{
    public const ST_PROCESSING = 'processing';
    public const ST_SUCCEEDED = 'succeeded';
    public const ST_FAILED = 'failed';
    public const ST_DRY_RUN = 'dry_run';
    public const ST_PENDING_MANUAL = 'pending_manual';

    public function __construct(
        private readonly ReturnAuditLogger $audit,
        private readonly ReturnNotifier $notifier,
        private readonly \App\Services\Returns\Payment\PaymentRefundManager $cardRefund,
        private readonly ReturnErpProcessor $erp,
        private readonly ShortageService $shortage,
    ) {}

    /**
     * EKSİK/HATALI ÜRÜN (personel başlattı) — para sonrası ayrışan davranış:
     *  - KISMİ kapsam: Ticimax sipariş statüsüne DOKUNULMAZ (kalan ürünler kargoya verilecek);
     *  - TAM kapsam: iptal gibi → mevcut ödeme-sonrası statü yazımı (IadeOdemeYapildi) uygulanır;
     *  - müşteriye 'refunded' yerine ÖZÜR SMS'i + özel kupon (ShortageService::afterSettled).
     * true dönerse çağıran genel statü/SMS adımlarını atlar.
     */
    private function settleShortage(ReturnRequest $r, ReturnRefund $refund, bool $dryRun): bool
    {
        if ($r->type !== \App\Enums\ReturnType::Shortage) {
            return false;
        }
        // Teslimat sonrası (stage=delivered) bildirimde Ticimax'a HİÇ yazılmaz (kullanıcı kararı 2026-09-25).
        // Geri dönen sipariş (stage=returned): statü afterSettled içinde İptal yapılır (IadeOdemeYapildi DEĞİL).
        $preShip = data_get($r->metadata, 'shortage.stage', ShortageService::STAGE_PRE_SHIP) === ShortageService::STAGE_PRE_SHIP;
        if ($preShip && (bool) data_get($r->metadata, 'shortage.is_full', false)) {
            $this->applyTicimaxRefundStatus($r, $dryRun);
        }
        $this->shortage->afterSettled($r, (float) $refund->amount, $dryRun);

        return true;
    }

    /**
     * Para iadesi FİİLEN tamamlanınca Ticimax sipariş statüsü yazılır (kullanıcı kararı 2026-07-21
     * — personel/yönetici onayında değil, ödeme sonrası): kapsam TAM ise 'IadeOdemeYapildi',
     * KISMİ ise 'KismiIadeYapildi'. İPTAL ödemeleri de dahil (kullanıcı kararı 2026-08-07 —
     * 'Iptal' statüsünün üzerine yazılır). Refund dry-run ise Ticimax'a yazılmaz.
     */
    private function applyTicimaxRefundStatus(ReturnRequest $r, bool $dryRun): void
    {
        if ($dryRun) {
            return;
        }

        $ticimax = $this->erp->ticimaxReturnStatus($r);
        // Ürün kırılımı: onaylı kalemler panelde 'İade Edildi' görünsün (best-effort).
        // İPTAL kalemlerine dokunulmaz — onlar iptal otomasyonunda 'İptal Edildi' işaretlendi.
        if ($r->type !== \App\Enums\ReturnType::Cancel) {
            $ticimax['payload']['item_status'] = $this->erp->ticimaxItemStatuses($r, 'refunded');
        }
        $meta = $r->metadata ?? [];
        $meta['ticimax_return'] = $ticimax;
        $r->metadata = $meta;
        $r->save();

        $this->audit->log($r, 'ticimax_return_status', [
            'actor_type' => ReturnActorType::System,
            'payload' => array_filter([
                'ticimax' => ($ticimax['success'] ?? false) ? (($ticimax['dry_run'] ?? false) ? 'dry-run' : 'evet') : 'başarısız',
                'ticimax_error' => $ticimax['error'] ?? null,
            ]),
        ]);
    }

    /**
     * Para iadesini yürüt. Yalnızca ManagerApproved (ilk) veya Refunding (retry) durumundan çağrılabilir.
     *
     * @return array{success:bool, idempotent?:bool, dry_run?:bool, pending_manual?:bool, status:string, refund?:array, error?:?string}
     */
    public function refund(ReturnRequest $r, ?User $actor = null): array
    {
        if (! in_array($r->status, [ReturnStatus::ManagerApproved, ReturnStatus::Refunding], true)) {
            return [
                'success' => false,
                'status' => $r->status->value,
                'error' => 'Bu talep para iadesine uygun değil (önce yönetici onayı gerekir).',
            ];
        }

        // İdempotent guard: zaten başarılı/dry-run kupon üretildiyse tekrar açma.
        $done = $r->refunds()->whereIn('status', [self::ST_SUCCEEDED, self::ST_DRY_RUN])->latest('id')->first();
        if ($done) {
            return [
                'success' => true,
                'idempotent' => true,
                'dry_run' => $done->status === self::ST_DRY_RUN,
                'status' => $r->status->value,
                'refund' => $this->view($done),
                'error' => null,
            ];
        }

        $method = $r->refund_method ?? RefundMethod::StoreCredit;

        return match ($method) {
            RefundMethod::StoreCredit => $this->storeCredit($r, $actor),
            RefundMethod::Original => $this->original($r, $actor),
            RefundMethod::BankTransfer => $this->bankTransfer($r, $actor),
            // Kapıda ödeme iptali: ödenmiş para yok → para hareketi olmadan kapatılır.
            RefundMethod::None => $this->noPayoutResult($r, $actor),
        };
    }

    // ───────────────────────── bank_transfer (kapıda ödeme iadesi — manuel havale) ─────────────────────────

    /**
     * HAVALE İLE İADE: kapıda ödemeli siparişte para nakit/kapıda kartla tahsil edildiği için
     * otomatikleştirilebilir bir kart işlemi YOKTUR. Yönetici para onayı verdiğinde iade
     * `pending_manual` olarak açılır (talep Refunding'de bekler), finans ekibi müşterinin
     * IBAN'ına havaleyi yapar ve panelden "Havale Yapıldı" ile {@see markBankTransferPaid}
     * çağrılarak talep kapanır. Böylece para hareketi DAİMA insan eliyle teyit edilir.
     */
    private function bankTransfer(ReturnRequest $r, ?User $actor): array
    {
        $amount = round((float) $r->approved_amount, 2);
        if ($amount <= 0) {
            return ['success' => false, 'status' => $r->status->value, 'error' => 'Onaylanan iade tutarı 0 — havale açılamaz.'];
        }

        $bank = (array) data_get($r->metadata, 'bank_account', []);
        if (trim((string) ($bank['iban'] ?? '')) === '') {
            return ['success' => false, 'status' => $r->status->value,
                'error' => 'Havale bilgisi (IBAN) yok — talep detayından banka/ad soyad/IBAN girilmeli.'];
        }

        /** @var ReturnRefund $refund */
        $refund = ReturnRefund::firstOrNew(['idempotency_key' => 'refund:bank_transfer:' . $r->id]);
        $refund->fill([
            'tenant_id' => $r->tenant_id,
            'return_request_id' => $r->id,
            'provider' => 'bank_transfer',
            'currency' => $r->currency ?? 'TRY',
            'amount' => $amount,
            'status' => self::ST_PENDING_MANUAL,
            'error_message' => null,
            'request_payload' => ['bank_account' => $bank],
        ]);
        $refund->attempts = (int) ($refund->attempts ?? 0) + 1;

        DB::transaction(function () use ($r, $refund) {
            if ($r->status === ReturnStatus::ManagerApproved) {
                $r->status = ReturnStatus::Refunding;
                $r->save();
            }
            $refund->save();
        });

        $this->audit->log($r, 'refund_bank_transfer_opened', [
            'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
            'actor_id' => $actor?->id,
            'to_status' => $r->status->value,
            'amount' => $amount,
            'payload' => ['method' => 'bank_transfer', 'iban' => $bank['iban'] ?? null, 'bank_name' => $bank['bank_name'] ?? null],
        ]);

        return [
            'success' => true,
            'pending_manual' => true,
            'dry_run' => false,
            'status' => $r->status->value,
            'refund' => $this->view($refund),
            'error' => null,
        ];
    }

    /**
     * Havale FİİLEN yapıldı: personel/yönetici panelden işaretler → talep kapanır.
     * Para hareketi modül dışında (banka) gerçekleştiği için tutar + açıklama ZORUNLU;
     * denetim izi (kim, ne zaman, hangi referansla) audit'e yazılır.
     */
    public function markBankTransferPaid(ReturnRequest $r, ?User $actor, float $amount, string $note, ?string $txn = null): array
    {
        if ($r->refund_method !== RefundMethod::BankTransfer) {
            return ['success' => false, 'status' => $r->status->value, 'error' => 'Bu talebin iade yöntemi havale değil.'];
        }
        if (! in_array($r->status, [ReturnStatus::ManagerApproved, ReturnStatus::Refunding], true)) {
            return ['success' => false, 'status' => $r->status->value, 'error' => 'Bu talep havale kapanışına uygun değil (önce yönetici para onayı gerekir).'];
        }

        $cap = round((float) ($r->approved_amount ?? $r->requested_amount), 2);
        $amount = round($amount, 2);
        if ($amount <= 0 || $amount > $cap + 0.01) {
            return ['success' => false, 'status' => $r->status->value,
                'error' => sprintf('Havale tutarı 0 ile onaylanan tutar (%.2f) arasında olmalı.', $cap)];
        }

        /** @var ReturnRefund $refund */
        $refund = ReturnRefund::firstOrNew(['idempotency_key' => 'refund:bank_transfer:' . $r->id]);
        if ($refund->exists && $refund->status === self::ST_SUCCEEDED) {
            return ['success' => true, 'idempotent' => true, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
        }

        $bank = (array) data_get($r->metadata, 'bank_account', []);

        DB::transaction(function () use ($r, $refund, $amount, $note, $txn, $bank) {
            $refund->fill([
                'tenant_id' => $r->tenant_id,
                'return_request_id' => $r->id,
                'provider' => 'bank_transfer',
                'currency' => $r->currency ?? 'TRY',
                'amount' => $amount,
                'status' => self::ST_SUCCEEDED,
                'error_message' => null,
                'request_payload' => ['bank_account' => $bank],
            ]);
            $refund->provider_txn_id = $txn !== null && $txn !== '' ? $txn : $refund->provider_txn_id;
            $refund->response_payload = ['manual' => true, 'source' => 'panel:mark-transferred', 'note' => $note];
            $refund->processed_at = now();
            $refund->save();

            $r->refunded_amount = $amount;
            if ($r->status === ReturnStatus::ManagerApproved) {
                $r->status = ReturnStatus::Refunding;
            }
            if ($r->status->canTransitionTo(ReturnStatus::Refunded)) {
                $r->status = ReturnStatus::Refunded;
            }
            $r->save();
        });

        $this->audit->log($r, 'refund', [
            'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
            'actor_id' => $actor?->id,
            'to_status' => $r->status->value,
            'amount' => $amount,
            'payload' => array_filter([
                'method' => 'bank_transfer',
                'iban' => $bank['iban'] ?? null,
                'bank_name' => $bank['bank_name'] ?? null,
                'txn' => $txn,
                'note' => $note,
            ], fn ($v) => $v !== null && $v !== ''),
        ]);

        // Para FİİLEN müşteriye gitti → Ticimax sipariş statüsü (IadeOdemeYapildi/KismiIadeYapildi).
        $this->applyTicimaxRefundStatus($r, dryRun: false);

        $this->notifier->notify($r, 'refunded', ['amount' => $amount]);

        return ['success' => true, 'dry_run' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
    }

    // ───────────────────────── none (kapıda ödeme iptali — para hareketi yok) ─────────────────────────

    /** refund() içinden RefundMethod::None geldiğinde: parasız kapanış + standart yanıt. */
    private function noPayoutResult(ReturnRequest $r, ?User $actor): array
    {
        $closed = $this->closeWithoutRefund($r, $actor, 'Kapıda ödeme iptali — tahsilat yapılmadığı için iade edilecek tutar yok.');

        return [
            'success' => $closed['success'],
            'no_payout' => true,
            'dry_run' => false,
            'status' => $r->status->value,
            'error' => $closed['error'] ?? null,
        ];
    }

    /**
     * PARASIZ KAPANIŞ (kapıda ödeme iptali) — kullanıcı kararı 2026-09-01.
     *
     * Kapıda ödemeli sipariş iptal edildiğinde müşteri hiç ödeme yapmamıştır: iade edilecek para
     * yoktur, dolayısıyla yönetici PARA onayı da anlamsızdır. ERP iptali (Nebim+Ticimax) başarıyla
     * işlendikten SONRA talep doğrudan Completed'a çekilir, tutarlar 0'lanır ve denetim kaydı düşülür.
     *
     * ⛔ Ticimax sipariş statüsü YAZILMAZ: sipariş ERP iptalinde zaten 'İptal Edildi' oldu; üzerine
     * 'İade Ödemesi Yapıldı' yazmak yanlış olur (hiçbir ödeme yapılmadı).
     *
     * @return array{success:bool, error:?string}
     */
    public function closeWithoutRefund(ReturnRequest $r, ?User $actor, string $reason, bool $notify = true): array
    {
        if ($r->status->isTerminal()) {
            return ['success' => true, 'error' => null]; // zaten kapalı — idempotent
        }
        // ⛔ PARA GÜVENLİĞİ: yalnızca "iade edilecek para yok" olarak işaretlenmiş talepler
        // (kapıda ödeme iptali) parasız kapatılabilir. Kartlı/havaleli hiçbir talep bu yoldan
        // geçemez — onların kapanışı gerçek para hareketiyle olur.
        if ($r->refund_method !== RefundMethod::None) {
            return ['success' => false, 'error' => 'Parasız kapanış yalnızca iade gerektirmeyen (kapıda ödeme iptali) taleplerde yapılabilir.'];
        }
        if ($r->type !== \App\Enums\ReturnType::Cancel) {
            return ['success' => false, 'error' => 'Parasız kapanış yalnızca iptal taleplerinde yapılabilir.'];
        }
        if (! in_array($r->status, [ReturnStatus::Processing, ReturnStatus::ManagerApproved, ReturnStatus::Refunding], true)) {
            return ['success' => false, 'error' => 'Parasız kapanış yalnızca ERP iptali işlenmiş talepte yapılabilir (durum: ' . $r->status->value . ').'];
        }

        $from = $r->status;

        // Durum ATAMASI doğrudan yapılır: Processing → Completed geçişi durum makinesinde tanımlı;
        // ManagerApproved/Refunding'den kapanış ise yalnızca bu metodun kapsamındadır (eski,
        // para onayına düşmüş kapıda ödeme iptallerinin temizliği) — genel geçişe açılmaz.
        DB::transaction(function () use ($r) {
            $r->approved_amount = 0;
            $r->refunded_amount = 0;
            $r->status = ReturnStatus::Completed;
            $r->save();
        });

        $this->audit->log($r, 'closed_without_refund', [
            'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
            'actor_id' => $actor?->id,
            'from_status' => $from->value,
            'to_status' => ReturnStatus::Completed->value,
            'amount' => 0,
            'payload' => ['reason' => $reason],
        ]);

        if ($notify) {
            $this->notifier->notify($r, 'cancel_completed_cod');
        }

        return ['success' => true, 'error' => null];
    }

    // ───────────────────────── store_credit (Ticimax indirim kuponu) ─────────────────────────

    private function storeCredit(ReturnRequest $r, ?User $actor): array
    {
        $amount = round((float) $r->approved_amount, 2);
        if ($amount <= 0) {
            return ['success' => false, 'status' => $r->status->value, 'error' => 'Onaylanan iade tutarı 0 — kupon üretilemez.'];
        }

        $cfg = $this->config($r);
        $scCfg = (array) ($cfg['store_credit'] ?? []);
        $dryRun = (bool) ($cfg['dry_run'] ?? true);
        $key = 'refund:store_credit:' . $r->id;

        // Tek satır (retry'lerde aynı kayıt + aynı kupon kodu yeniden kullanılır → çift kupon olmaz).
        /** @var ReturnRefund $refund */
        $refund = ReturnRefund::firstOrNew(['idempotency_key' => $key]);
        $code = $refund->coupon_code ?: $this->generateCode($r, (string) ($scCfg['code_prefix'] ?? 'IADE'));
        $payload = $this->buildVoucherRequest($code, $amount, $scCfg);

        $refund->fill([
            'tenant_id' => $r->tenant_id,
            'return_request_id' => $r->id,
            'provider' => 'store_credit',
            'currency' => $r->currency ?? 'TRY',
            'amount' => $amount,
            'coupon_code' => $code,
            'status' => self::ST_PROCESSING,
            'request_payload' => $payload,
        ]);
        $refund->attempts = (int) ($refund->attempts ?? 0) + 1;

        // Niyeti kaydet: ManagerApproved → Refunding (retry zaten Refunding).
        DB::transaction(function () use ($r, $refund) {
            if ($r->status === ReturnStatus::ManagerApproved) {
                $r->status = ReturnStatus::Refunding;
                $r->save();
            }
            $refund->save();
        });

        // ── DRY-RUN: Ticimax'a GERÇEK kupon yazma — payload logla, akışı test için tamamla ──
        if ($dryRun) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info('[Refund][DRY-RUN] store_credit kuponu yazılmadı', ['return_id' => $r->id, 'payload' => $payload]);

            $refund->status = self::ST_DRY_RUN;
            $refund->response_payload = ['dry_run' => true];
            $refund->processed_at = now();
            $refund->save();

            $this->finalize($r, $refund, $actor, dryRun: true);

            return ['success' => true, 'dry_run' => true, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
        }

        // ── CANLI: Ticimax HediyeCekiOlustur ──
        $service = $this->ticimaxService($r);
        if (! $service) {
            $refund->status = self::ST_FAILED;
            $refund->error_message = 'Ticimax kanalı bulunamadı.';
            $refund->save();

            return ['success' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => $refund->error_message];
        }

        $res = $service->createGiftVoucher($payload);

        if (! ($res['success'] ?? false)) {
            $refund->status = self::ST_FAILED;
            $refund->error_message = (string) ($res['error'] ?? 'Hediye çeki oluşturulamadı.');
            $refund->save();

            $this->audit->log($r, 'refund_failed', [
                'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
                'actor_id' => $actor?->id,
                'payload' => ['method' => 'store_credit', 'error' => $refund->error_message, 'attempts' => $refund->attempts],
            ]);

            // Talep Refunding'de kalır → refund endpoint'inden tekrar denenebilir.
            return ['success' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => $refund->error_message];
        }

        $refund->status = self::ST_SUCCEEDED;
        $refund->provider_txn_id = isset($res['id']) ? (string) $res['id'] : null;
        $refund->coupon_code = $res['code'] ?: $code; // Ticimax kendi kodunu döndürürse onu kullan
        $refund->response_payload = ['ticimax_id' => $res['id'] ?? null, 'code' => $res['code'] ?? null];
        $refund->processed_at = now();
        $refund->save();

        $this->finalize($r, $refund, $actor, dryRun: false);

        return ['success' => true, 'dry_run' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
    }

    /**
     * Başarılı (veya dry-run) kupon sonrası: talebi Refunded'a çek, refunded_amount yaz, audit + SMS.
     */
    private function finalize(ReturnRequest $r, ReturnRefund $refund, ?User $actor, bool $dryRun): void
    {
        DB::transaction(function () use ($r, $refund) {
            $r->refunded_amount = (float) $refund->amount;
            if ($r->status->canTransitionTo(ReturnStatus::Refunded)) {
                $r->status = ReturnStatus::Refunded;
            }
            $r->save();
        });

        $this->audit->log($r, 'refund', [
            'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
            'actor_id' => $actor?->id,
            'from_status' => ReturnStatus::Refunding->value,
            'to_status' => $r->status->value,
            'amount' => (float) $refund->amount,
            'payload' => [
                'method' => 'store_credit',
                'coupon_code' => $refund->coupon_code,
                'provider_txn_id' => $refund->provider_txn_id,
                'dry_run' => $dryRun,
            ],
        ]);

        if ($this->settleShortage($r, $refund, $dryRun)) {
            return;
        }

        // Ödeme tamamlandı → Ticimax 'IadeOdemeYapildi' (dry-run'da yazılmaz).
        $this->applyTicimaxRefundStatus($r, $dryRun);

        // Müşteriye kupon/iade bildirimi (dry-run iken SMS de dry-run).
        $this->notifier->notify($r, 'refunded', [
            'amount' => (float) $refund->amount,
            'coupon_code' => $refund->coupon_code,
        ]);
    }

    /** HediyeCekiOlustur (WebHediyeCekiOlusturRequest) payload — TUTAR (TL) indirim, tek kullanım. */
    private function buildVoucherRequest(string $code, float $amount, array $scCfg): array
    {
        $validDays = max(1, (int) ($scCfg['valid_days'] ?? 180));

        return [
            'Kod' => $code,
            'IndirimTipi' => (int) ($scCfg['indirim_tipi_tutar'] ?? 0), // 0 = TUTAR (TL). 1 = yüzde (KULLANMA!)
            'IndirimDegeri' => $amount,
            'MinimumUrunTutari' => 0,
            'MinTutarKosuldaGecerli' => false,
            // DAİMA ücretsiz kargo (kullanıcı kararı 12 Ağu, koşulsuz — iptal/iade, kargo ödenmiş/ödenmemiş
            // fark etmez): kupon sepeti 0'a/eşiğin altına düşürünce site ek kargo bedeli çıkarmasın.
            'KargoUcretsiz' => true,
            // Panel "hediye çekini ödeme olarak kaydet" — ⛔ KAPALI (kullanıcı kararı 17 Ağu, geri alındı).
            // 12 Ağu'da AÇILMIŞTI (kupon sepetin tamamını karşılayınca 0 TL ödeme tamamlanabilsin diye) ama
            // canlıda ters tepti: sepet kupondan BÜYÜKSE Ticimax kuponu sipariş oluşurken "onaylı ödeme"
            // (OdemeTipi 20, Onaylandi=1) olarak yazıyor, kalan tutar için kart adımı TAM tutarı istiyor /
            // tamamlanamıyor → stok düşmemiş, kalanı ödenmemiş yarım siparişler oluşuyor; kupon hakkı
            // tükenmiyor, iptal olan denemelerde RemainingUse ARTIYOR (1→3). 5 günde 10 yarım sipariş,
            // 0 tamamlanan kupon+kart siparişi. Kapalıyken bilinen sınır: kupon ≥ sepet ise 0 TL sipariş
            // tamamlanamıyor (müşteri sepete ürün ekler) — daha küçük sorun.
            'HediyeCekiniOdemeOlarakKaydet' => false,
            'KullanimSayisi' => 1,
            'UyeMaksimumKullanimSayisi' => 1,
            // Ticimax gün bazında çalışır (Türkiye TZ) — başlangıç gün başı / bitiş gün sonu.
            'TarihBaslagic' => now()->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'TarihBitis' => now()->addDays($validDays)->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'WebAktif' => true,
            'MobilAktif' => true,
            'AndroidAktif' => true,
            'IOSAktif' => true,
            'GrupAdi' => (string) ($scCfg['grup_adi'] ?? 'İade Bakiyesi'),
            'IndirimliUrunleKullanilabilir' => true,
            'BaskaKampanyalarlaBilestirilebilir' => true,
            'SepetteKosulsuzGoster' => false,
        ];
    }

    // ───────────────────────── original (karta iade — iyzico/PayTR) ─────────────────────────

    /**
     * Karta iade: siparişin Ticimax ödeme bloğundan sağlayıcı (iyzico/PayTR) + iade referansı çözülür
     * ({@see PaymentRefundManager}). Sağlayıcı belirlenemez/kimlik yoksa → `pending_manual` (personel
     * ödeme panelinden manuel iade); talep ManagerApproved'da bekler. Çözülürse store_credit ile aynı
     * yaşam döngüsü: Refunding → (dry-run/canlı) → Refunded + audit + SMS. İdempotent.
     */
    private function original(ReturnRequest $r, ?User $actor): array
    {
        $amount = round((float) $r->approved_amount, 2);
        if ($amount <= 0) {
            return ['success' => false, 'status' => $r->status->value, 'error' => 'Onaylanan iade tutarı 0 — iade yapılamaz.'];
        }

        $key = 'refund:original:' . $r->id;
        /** @var ReturnRefund $refund */
        $refund = ReturnRefund::firstOrNew(['idempotency_key' => $key]);

        // Yarım kalan çok-kalemli iyzico iadesi: önceki denemede iade edilmiş kalemler atlanır,
        // yalnızca KALAN tutar istenir (çift iade imkânsız — kalem bazında skip).
        $prevTxns = (array) data_get($refund->response_payload, 'progress.succeeded_txns', []);
        $prevRefunded = round((float) data_get($refund->response_payload, 'progress.refunded_total', 0), 2);
        $remaining = round($amount - $prevRefunded, 2);
        if ($prevRefunded > 0 && $remaining <= 0.05) {
            // Kalan yok denecek kadar az (kuruş toleransı) — tamamlanmış say.
            $refund->status = self::ST_SUCCEEDED;
            $refund->processed_at = $refund->processed_at ?? now();
            $refund->save();
            $this->finalizeOriginal($r, $refund, $actor, (string) $refund->provider, false);

            return ['success' => true, 'dry_run' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
        }

        $dispatch = $this->cardRefund->refund($r, $remaining, ['skip_txns' => $prevTxns]);

        // Sağlayıcı çözülemedi (ödeme okunamadı / referans yok / kimlik yok) → BAŞARISIZ
        // (⛔ manuel yol YOK — kullanıcı kararı 2026-07-07: karta iade daima API'den otomatik;
        // çözülemezse onay verilmez, hata panelde gösterilir, sorun giderilip tekrar denenir).
        if (! ($dispatch['resolved'] ?? false)) {
            $refund->fill([
                'tenant_id' => $r->tenant_id,
                'return_request_id' => $r->id,
                'provider' => 'original',
                'currency' => $r->currency ?? 'TRY',
                'amount' => $amount,
                'status' => self::ST_FAILED,
                'error_message' => $dispatch['error'] ?? 'Karta iade sağlayıcısı çözülemedi.',
            ]);
            $refund->attempts = (int) ($refund->attempts ?? 0) + 1;
            $refund->save();

            $this->audit->log($r, 'refund_failed', [
                'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
                'actor_id' => $actor?->id,
                'payload' => ['method' => 'original', 'error' => $refund->error_message, 'attempts' => $refund->attempts],
            ]);

            return ['success' => false, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => $refund->error_message];
        }

        $provider = (string) ($dispatch['provider']);
        $result = (array) ($dispatch['result'] ?? []);
        $dryRun = (bool) ($result['dry_run'] ?? false);

        $refund->fill([
            'tenant_id' => $r->tenant_id,
            'return_request_id' => $r->id,
            'provider' => $provider,
            'currency' => $r->currency ?? 'TRY',
            'amount' => $amount,
            'status' => self::ST_PROCESSING,
            'request_payload' => $result['request'] ?? null,
            // Önceki başarısız denemeden kalan hata mesajını temizle (firstOrNew aynı satırı tekrar kullanır).
            'error_message' => null,
        ]);
        $refund->attempts = (int) ($refund->attempts ?? 0) + 1;

        DB::transaction(function () use ($r, $refund) {
            if ($r->status === ReturnStatus::ManagerApproved) {
                $r->status = ReturnStatus::Refunding;
                $r->save();
            }
            $refund->save();
        });

        // Bu denemede iade edilen + önceki denemelerden gelen kümülatif ilerleme.
        $thisRefunded = round((float) ($result['refunded_total'] ?? 0), 2);
        $allTxns = array_values(array_unique(array_merge($prevTxns, (array) ($result['succeeded_txns'] ?? []))));
        $totalRefunded = round($prevRefunded + $thisRefunded, 2);

        if (! ($result['success'] ?? false)) {
            $partial = $totalRefunded > 0;
            $refund->status = self::ST_FAILED;
            $refund->error_message = (string) ($result['error'] ?? 'Karta iade başarısız.');
            $refund->response_payload = [
                'last' => $result['response'] ?? null,
                // Kısmi ilerleme kalıcı kaydedilir → retry kaldığı yerden devam eder.
                'progress' => ['succeeded_txns' => $allTxns, 'refunded_total' => $totalRefunded],
            ];
            $refund->save();

            $this->audit->log($r, 'refund_failed', [
                'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
                'actor_id' => $actor?->id,
                'payload' => array_filter([
                    'method' => $provider,
                    'error' => $refund->error_message,
                    'attempts' => $refund->attempts,
                    'partial_refunded' => $partial ? $totalRefunded : null,
                ]),
            ]);

            return [
                'success' => false,
                'partial' => $partial,
                'status' => $r->status->value,
                'refund' => $this->view($refund),
                'error' => $refund->error_message,
            ];
        }

        // Başarı: fiilen iade edilen tutar (kuruş kırpması nedeniyle onaylanandan sapabilir) kaydedilir.
        $actual = $totalRefunded > 0 ? $totalRefunded : $amount;
        $refund->amount = $actual;
        $refund->status = $dryRun ? self::ST_DRY_RUN : self::ST_SUCCEEDED;
        $refund->provider_txn_id = $result['txn_id'] ?? null;
        $refund->response_payload = $dryRun ? ['dry_run' => true] : [
            'last' => $result['response'] ?? null,
            'progress' => ['succeeded_txns' => $allTxns, 'refunded_total' => $actual],
        ];
        $refund->processed_at = now();
        $refund->save();

        $this->finalizeOriginal($r, $refund, $actor, $provider, $dryRun);

        return ['success' => true, 'dry_run' => $dryRun, 'status' => $r->status->value, 'refund' => $this->view($refund), 'error' => null];
    }

    /** Başarılı/dry-run karta iade sonrası: Refunded + refunded_amount + audit + SMS. */
    private function finalizeOriginal(ReturnRequest $r, ReturnRefund $refund, ?User $actor, string $provider, bool $dryRun): void
    {
        DB::transaction(function () use ($r, $refund) {
            $r->refunded_amount = (float) $refund->amount;
            if ($r->status->canTransitionTo(ReturnStatus::Refunded)) {
                $r->status = ReturnStatus::Refunded;
            }
            $r->save();
        });

        $this->audit->log($r, 'refund', [
            'actor_type' => $actor ? ReturnActorType::Manager : ReturnActorType::System,
            'actor_id' => $actor?->id,
            'from_status' => ReturnStatus::Refunding->value,
            'to_status' => $r->status->value,
            'amount' => (float) $refund->amount,
            'payload' => [
                'method' => $provider,
                'provider_txn_id' => $refund->provider_txn_id,
                'dry_run' => $dryRun,
            ],
        ]);

        if ($this->settleShortage($r, $refund, $dryRun)) {
            return;
        }

        // Ödeme tamamlandı → Ticimax 'IadeOdemeYapildi' (dry-run'da yazılmaz).
        $this->applyTicimaxRefundStatus($r, $dryRun);

        // Karta iadede kupon kodu YOK → genel iade mesajı (ReturnNotifier amount'ı kullanır).
        $this->notifier->notify($r, 'refunded', ['amount' => (float) $refund->amount]);
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    /** refund config (varsayılan + tenant ayarı). */
    private function config(ReturnRequest $r): array
    {
        $cfg = (array) config('returns.integrations.refund', []);
        $tenantCfg = $r->tenant?->settings['returns_integrations']['refund'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return $cfg;
    }

    private function ticimaxService(ReturnRequest $r): ?TicimaxService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->first();

        if (! $channel) {
            return null;
        }

        $service = TicimaxService::fromChannel($channel);

        return $service->isAvailable() ? $service : null;
    }

    /** Tenant içinde benzersiz, okunabilir kupon kodu: IADE-XXXXXX (ReadableCode karakter seti). */
    private function generateCode(ReturnRequest $r, string $prefix): string
    {
        $base = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $prefix)) ?: 'IADE';

        do {
            $code = $base . '-' . ReadableCode::generate(6);
        } while (
            ReturnRefund::withoutGlobalScopes()
                ->where('tenant_id', $r->tenant_id)
                ->where('coupon_code', $code)
                ->exists()
        );

        return $code;
    }

    /** UI/yanıt için ReturnRefund özeti. */
    private function view(ReturnRefund $refund): array
    {
        return [
            'id' => $refund->id,
            'provider' => $refund->provider,
            'status' => $refund->status,
            'amount' => (float) $refund->amount,
            'currency' => $refund->currency,
            'coupon_code' => $refund->coupon_code,
            'provider_txn_id' => $refund->provider_txn_id,
            'attempts' => (int) $refund->attempts,
            'error_message' => $refund->error_message,
            'processed_at' => optional($refund->processed_at)->format('Y-m-d H:i:s'),
        ];
    }
}
