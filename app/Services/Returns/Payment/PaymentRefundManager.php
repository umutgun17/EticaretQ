<?php

namespace App\Services\Returns\Payment;

use App\Models\Channel;
use App\Models\ReturnRefund;
use App\Models\ReturnRequest;
use App\Services\TicimaxService;

/**
 * Karta iade (Faz 4 original) orkestratörü. Siparişin Ticimax ödeme bloğundan sağlayıcıyı ve iade
 * referansını çözer, ilgili sağlayıcı servisini çağırır.
 *
 * ⛔ SAĞLAYICI AYRIMI (2026-06-22 canlı keşif): iyzico ve PayTR Ticimax'ta AYNI `OdemeTipi=17` ile
 * görünür → OdemeTipi tek başına ayırt EDEMEZ. Ayraç = `PosReferansID`: iyzico onaylı ödemede buraya
 * numerik bir paymentId yazar (örn 4073597601); PayTR boş bırakır. Dolayısıyla:
 *   - PosReferansID numerik+dolu → iyzico (paymentId=PosReferansID; canlıda retrievePayment ile
 *     paymentTransactionId çözülür)
 *   - PosReferansID boş         → PayTR (merchant_oid=OdemeSiparisID yeterli)
 * `odeme_tipi_map` (config) tanımlıysa ZORLAYICI override olarak öne geçer (özel durumlar için).
 *
 * Sağlayıcı belirlenemezse / yanlış sağlayıcıya gidip reddedilirse → resolved=false → iade BAŞARISIZ
 * döner, onay verilmez ve hata panelde gösterilir (FAIL-CLOSED: yanlış iade değil, başarısız iade;
 * manuel yol YOK — kullanıcı kararı 2026-07-07). ⛔ Tüm canlı çağrılar dry-run aware.
 */
class PaymentRefundManager
{
    public function __construct(
        private readonly IyzicoRefundService $iyzico,
        private readonly PaytrRefundService $paytr,
        private readonly \App\Services\Returns\ReturnRulesService $rules,
    ) {}

    /**
     * İadeyi yürüt. Önce Ticimax ödeme bloğunu okur → sağlayıcı + referans → dispatch.
     *
     * @param  array  $extra  Ek bağlam: skip_txns (önceki denemede iade edilmiş iyzico kalemleri —
     *                        yarım kalan çok-kalemli iadede kaldığı yerden devam).
     * @return array{resolved:bool, provider:?string, result:?array, error:?string, payment:?array}
     */
    /** Fallback'te denenecek en fazla aday ödeme satırı sayısı. */
    private const MAX_CANDIDATES = 4;

    public function refund(ReturnRequest $r, float $amount, array $extra = []): array
    {
        $cfg = $this->config($r);
        $dryRun = (bool) ($cfg['dry_run'] ?? true);

        $payments = $this->fetchPayments($r);
        if (! $payments) {
            return ['resolved' => false, 'provider' => null, 'result' => null, 'payment' => null,
                'error' => 'Siparişin Ticimax ödeme bilgisi okunamadı (karta iade için ödeme referansı gerekli). Lütfen tekrar deneyin.'];
        }

        // ÇOK-ADAYLI FALLBACK (2026-08-05, talep #50 dersi): sıralamanın seçtiği satır "başarılı ödeme
        // bulunamadı" tipi KESİN bir hatayla düşerse sıradaki aday satıra geçilir — aday hangi
        // sağlayıcıya çözülüyorsa (PayTR/iyzico) o denenir, yani kanallar arası yedek de kapsanır.
        // Belirsiz hatalarda (ağ, bakiye, kimlik) fallback YOK: aynı satır panelden tekrar denenmeli.
        $lastFailure = null;
        $trace = [];
        foreach (array_slice($payments, 0, self::MAX_CANDIDATES) as $payment) {
            // Tutar<=0 satırlar iade/düzeltme kaydıdır (örn. panelden karta iade -794,45) — aday değil.
            if (isset($payment['tutar']) && (float) $payment['tutar'] <= 0) {
                $trace[] = ['payment_id' => $payment['id'] ?? null, 'skip' => 'tutar<=0'];

                continue;
            }

            $providerKey = $this->resolveProvider($payment, $cfg);
            if (! $providerKey) {
                $trace[] = ['payment_id' => $payment['id'] ?? null, 'skip' => 'sağlayıcı çözülemedi'];

                continue;
            }

            $service = $providerKey === 'iyzico' ? $this->iyzico : $this->paytr;
            $providerCfg = (array) ($cfg[$providerKey] ?? []);

            // PayTR ÖN-DOĞRULAMA (salt-okunur durum sorgusu, yalnız canlı modda): oid başarılı bir
            // ödeme değilse iade hiç denenmeden sıradaki adaya geçilir; başarılıysa önceki iadeler
            // toplamıyla ÇİFT İADE guard'ı uygulanır (talep #50: 794,45 panelden iade edilmişti).
            if ($providerKey === 'paytr' && ! $dryRun) {
                $st = $this->paytr->queryStatus($providerCfg, (string) ($payment['odeme_siparis_id'] ?? ''));
                if (($st['found'] ?? null) === false) {
                    $trace[] = ['payment_id' => $payment['id'] ?? null, 'skip' => 'PayTR durum-sorgu: başarılı ödeme değil'];

                    continue;
                }
                if (($st['found'] ?? null) === true) {
                    $already = (float) ($st['refunded_total'] ?? 0);
                    $payTotal = (float) ($st['payment_amount'] ?? 0);
                    if ($already >= $amount - 0.01 || ($payTotal > 0 && $already + $amount > $payTotal + 0.01)) {
                        $err = sprintf(
                            'ÇİFT İADE GUARD: PayTR kaydında bu ödemeye daha önce %.2f TL iade yapılmış görünüyor (ödeme %.2f TL; muhtemelen panelden manuel iade). Otomatik iade DURDURULDU — talep manuel incelenmeli.',
                            $already,
                            $payTotal
                        );
                        $this->log()->warning('[Refund][Fallback] çift iade guard tetiklendi', ['request' => $r->id, 'payment_id' => $payment['id'] ?? null, 'already_refunded' => $already, 'amount' => $amount]);

                        return ['resolved' => true, 'provider' => $providerKey, 'payment' => $payment, 'error' => $err,
                            'result' => ['success' => false, 'dry_run' => false, 'provider' => $providerKey, 'txn_id' => null, 'error' => $err, 'request' => [], 'response' => ['guard' => 'double_refund', 'paytr_status' => $st['response'] ?? null]]];
                    }
                }
                // found=null (sorgu yapılamadı) → eski davranış: iade denemesine engel olma.
            }

            $ctx = [
                'payment' => $payment,
                'amount' => $amount,
                'currency' => $r->currency ?? ($payment['para_birimi'] ?? 'TRY'),
                'order_no' => (string) $r->order_no,
                'public_code' => (string) $r->public_code,
                'ip' => request()?->ip() ?? '127.0.0.1',
                // iyzico paymentId = Ticimax PosReferansID → canlıda retrievePayment ile paymentTransactionId çözülür.
                'payment_id' => (string) ($payment['pos_referans_id'] ?? ''),
                'payment_transaction_id' => null,
                'skip_txns' => (array) ($extra['skip_txns'] ?? []),
                'prior_refunds' => $providerKey === 'iyzico' ? $this->priorIyzicoRefunds($r) : [],
                'installment_fee' => $this->installmentFeeCtx($r),
            ];

            $result = $service->refund($providerCfg, $ctx, $dryRun);
            $outcome = ['resolved' => true, 'provider' => $providerKey, 'result' => $result, 'payment' => $payment, 'error' => $result['error'] ?? null];

            if (($result['success'] ?? false) || ! $this->isPaymentNotFound((string) ($result['error'] ?? ''))) {
                if ($trace) {
                    $this->log()->info('[Refund][Fallback] aday geçişleri', ['request' => $r->id, 'trace' => $trace, 'used_payment_id' => $payment['id'] ?? null]);
                }

                return $outcome;
            }

            // "Başarılı ödeme bulunamadı" sınıfı kesin hata → sıradaki adaya geç.
            $trace[] = ['payment_id' => $payment['id'] ?? null, 'skip' => 'not_found: ' . ($result['error'] ?? '')];
            $lastFailure = $outcome;
        }

        if ($trace) {
            $this->log()->info('[Refund][Fallback] hiçbir aday başarılı olmadı', ['request' => $r->id, 'trace' => $trace]);
        }

        return $lastFailure ?? ['resolved' => false, 'provider' => null, 'result' => null, 'payment' => $payments[0],
            'error' => 'Karta iade sağlayıcısı belirlenemedi (PosReferansID/OdemeSiparisID yok). Sipariş ödeme kaydı kontrol edilmeli.'];
    }

    /**
     * Aynı siparişin DİĞER taleplerinde iyzico'dan iade edilmiş kalemler: [paymentTransactionId => tutar|null].
     * iyzico ödeme detayı kalem bazında iade edilen tutarı vermediği için kaynak kendi `return_refunds`
     * kayıtlarımızdır (panelden yapılan modül dışı iadeler burada GÖRÜNMEZ — onları iyzico reddeder).
     *
     * @return array<string,float|null>
     */
    public function priorIyzicoRefunds(ReturnRequest $r): array
    {
        if (! $r->platform_order_id) {
            return [];
        }

        $siblingIds = ReturnRequest::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('platform_order_id', $r->platform_order_id)
            ->where('id', '!=', $r->id)
            ->pluck('id');
        if ($siblingIds->isEmpty()) {
            return [];
        }

        $prior = [];
        $rows = ReturnRefund::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('provider', 'iyzico')
            ->whereIn('return_request_id', $siblingIds)
            ->get(['response_payload']);
        foreach ($rows as $row) {
            foreach (self::refundedByTxn((array) $row->response_payload) as $txn => $amt) {
                if ($amt === null || (array_key_exists($txn, $prior) && $prior[$txn] === null)) {
                    $prior[$txn] = null;
                } else {
                    $prior[$txn] = round(($prior[$txn] ?? 0) + $amt, 2);
                }
            }
        }

        return $prior;
    }

    /**
     * Bir `return_refunds.response_payload` kaydından kalem bazında iade edilen tutarlar (saf — test edilebilir).
     * `last` tek yanıt (tek kalem) ya da [{txn, price, response}] listesidir; yalnız status=success sayılır.
     * `progress.succeeded_txns` içinde olup tutarı `last`ta bulunmayan kalem (önceki denemede iade edilmiş) → null.
     *
     * @return array<string,float|null>
     */
    public static function refundedByTxn(array $payload): array
    {
        $out = [];
        $last = $payload['last'] ?? null;
        if (is_array($last)) {
            $steps = array_is_list($last)
                ? $last
                : [['txn' => $last['paymentTransactionId'] ?? null, 'price' => $last['price'] ?? null, 'response' => $last]];
            foreach ($steps as $s) {
                $txn = (string) ($s['txn'] ?? '');
                if ($txn === '' || ($s['response']['status'] ?? '') !== 'success' || ! is_numeric($s['price'] ?? null)) {
                    continue;
                }
                $out[$txn] = round(($out[$txn] ?? 0) + (float) $s['price'], 2);
            }
        }
        foreach ((array) data_get($payload, 'progress.succeeded_txns', []) as $txn) {
            $txn = (string) $txn;
            if ($txn !== '' && ! array_key_exists($txn, $out)) {
                $out[$txn] = null;
            }
        }

        return $out;
    }

    /**
     * Vade farkı telafisi bağlamı (yalnız iyzico servisi kullanır; PayTR yok sayar).
     * Kural `refund_installment_fee` açık + talep TAM iade/iptal ise enabled=true; iyzico servisi
     * canlıda ödeme detayından vade = paidPrice − price − kargo hesaplar ve iade tutarına ekler.
     * shipping_cost = hesap anındaki sipariş kargo bedeli (iyzico paidPrice kargoyu İÇERİR ama
     * price içermez; taksitsiz siparişte fark tamamen kargodur → vade 0 çıkar, ekleme olmaz).
     */
    public function installmentFeeCtx(ReturnRequest $r): array
    {
        $breakdown = (array) data_get($r->metadata, 'calculation.breakdown', []);
        $enabled = (bool) ($r->tenant ? ($this->rules->forTenant($r->tenant)['refund_installment_fee'] ?? false) : false);

        return [
            'enabled' => $enabled && (bool) ($breakdown['full_return'] ?? false),
            'shipping_cost' => max(0.0, (float) ($breakdown['shipping_cost'] ?? 0)),
        ];
    }

    /**
     * "Ödeme bulunamadı" sınıfı KESİN hata mı? (fallback tetikleyicisi — PayTR err 004/005
     * "basarili odeme bulunamadi", iyzico "Kayıt bulunamadı", boş merchant_oid mesajı.)
     */
    public function isPaymentNotFound(string $error): bool
    {
        $e = mb_strtolower($error);

        return str_contains($e, 'bulunamadi') || str_contains($e, 'bulunamadı');
    }

    private function log(): \Psr\Log\LoggerInterface
    {
        return \Illuminate\Support\Facades\Log::channel(config('returns.log_channel', 'stack'));
    }

    /**
     * Ödeme bloğundan sağlayıcıyı belirler. Öncelik: (1) açık `odeme_tipi_map` override, (2) PosReferansID
     * ayracı (iyzico=numerik dolu / PayTR=boş), (3) belirlenemezse null → pending_manual.
     */
    public function resolveProvider(array $payment, array $cfg): ?string
    {
        // 1) Açık override: config'te OdemeTipi→sağlayıcı tanımlıysa kazanır (özel durumlar/ileride).
        $override = $this->mapProvider((int) ($payment['odeme_tipi'] ?? 0), $cfg);
        if ($override) {
            return $override;
        }

        // 2) Değer-bazlı ayraç: iyzico onaylı ödemede PosReferansID = numerik paymentId; PayTR boş bırakır.
        $posRef = trim((string) ($payment['pos_referans_id'] ?? ''));
        if ($posRef !== '' && ctype_digit($posRef)) {
            return 'iyzico';
        }

        // 3) PosReferansID boş/numerik-değil → PayTR (merchant_oid = OdemeSiparisID gerekli).
        if (trim((string) ($payment['odeme_siparis_id'] ?? '')) !== '') {
            return 'paytr';
        }

        return null;
    }

    /** OdemeTipi (Ticimax) → sağlayıcı anahtarı ('iyzico'|'paytr'); eşleşme yoksa null. Açık override için. */
    public function mapProvider(int $odemeTipi, array $cfg): ?string
    {
        $map = (array) ($cfg['odeme_tipi_map'] ?? []);
        $val = $map[(string) $odemeTipi] ?? ($map[$odemeTipi] ?? null);
        $val = is_string($val) ? strtolower(trim($val)) : null;

        return in_array($val, ['iyzico', 'paytr'], true) ? $val : null;
    }

    /** original config (varsayılan + tenant ayarı). */
    public function config(ReturnRequest $r): array
    {
        $cfg = (array) config('returns.integrations.refund.original', []);
        $tenantCfg = $r->tenant?->settings['returns_integrations']['refund']['original'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return $cfg;
    }

    /** Siparişin Ticimax ödeme satırlarını (başarı olasılığına göre SIRALI, salt-okuma) getirir. */
    private function fetchPayments(ReturnRequest $r): array
    {
        $siparisId = (int) $r->platform_order_id;
        if ($siparisId <= 0) {
            return [];
        }

        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->first();
        if (! $channel) {
            return [];
        }

        $res = TicimaxService::fromChannel($channel)->getOrderPayment($siparisId);

        return ($res['success'] ?? false) ? (array) ($res['payments'] ?? [$res['payment']]) : [];
    }
}
