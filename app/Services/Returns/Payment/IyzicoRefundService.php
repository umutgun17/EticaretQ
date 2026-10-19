<?php

namespace App\Services\Returns\Payment;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * iyzico karta iade — `POST {base_url}/payment/refund` (CreateRefundRequest).
 *
 * Gövde: { locale, conversationId, paymentTransactionId, price, currency, ip }.
 * Kimlik: IYZWSv2 HMAC-SHA256. signature = hmac_sha256( randomKey + uriPath + requestBody, secretKey );
 *   Authorization: "IYZWSv2 " . base64( "apiKey:{k}&randomKey:{r}&signature:{s}" ); header x-iyzi-rnd: randomKey.
 *
 * iyzico iadesi **paymentTransactionId** (kalem işlem no) ister; bu, ödeme anındaki iyzico yanıtında döner
 * ve Ticimax ödeme bloğunda DOĞRUDAN yok. Çözüm: Ticimax `PosReferansID` = iyzico **paymentId** → canlıda
 * `retrievePayment` (POST /payment/detail, paymentId ile) çağrılır → `itemTransactions[]` (id + paidPrice).
 * İade tutarı `planRefund` ile kalemlere dağıtılır (birebir eşleşen kalem öncelikli, kalan greedy;
 * kalem tavanı paidPrice — kuruş farkı kırpılır, asla aşılmaz) ve kalem başına /payment/refund çağrılır.
 * Çok-kalemli iadede bir kalem reddedilirse o ana kadarki iadeler kalıcıdır (partial) → retry succeeded
 * kalemleri atlayıp kalanı tamamlar. paymentTransactionId hiç çözülemezse iade başarısız döner (yanlış iade önlenir).
 *
 * ⛔ dry_run iken HİÇBİR HTTP isteği YAPILMAZ (retrievePayment dahil); payload loglanır (secretKey loglanmaz).
 */
class IyzicoRefundService implements PaymentRefundProvider
{
    public function key(): string
    {
        return 'iyzico';
    }

    public function isConfigured(array $cfg): bool
    {
        return ! empty($cfg['api_key']) && ! empty($cfg['secret_key']);
    }

    /**
     * Refund istek gövdesi (saf — test edilebilir).
     *
     * @return array{locale:string, conversationId:string, paymentTransactionId:?string, price:string, currency:string, ip:string}
     */
    public function buildRequest(array $ctx): array
    {
        $payment = (array) ($ctx['payment'] ?? []);

        return [
            'locale' => 'tr',
            'conversationId' => (string) ($payment['odeme_siparis_id'] ?? ($ctx['public_code'] ?? '')),
            // Ticimax doğrudan vermiyor; manager çözebilirse ctx'e koyar, aksi halde null.
            'paymentTransactionId' => $ctx['payment_transaction_id'] ?? null,
            'price' => number_format(round((float) ($ctx['amount'] ?? 0), 2), 2, '.', ''),
            'currency' => (string) ($ctx['currency'] ?? 'TRY'),
            'ip' => (string) ($ctx['ip'] ?? '127.0.0.1'),
        ];
    }

    /**
     * IYZWSv2 HMAC-SHA256 yetkilendirme başlıkları (saf — test edilebilir; secretKey başlığa girmez).
     *
     * @return array{Authorization:string, 'x-iyzi-rnd':string}
     */
    public function authHeaders(array $cfg, string $uriPath, string $requestBody, ?string $randomKey = null): array
    {
        $randomKey = $randomKey ?: ((string) (now()->timestamp * 1000) . Str::random(8));
        $signature = hash_hmac('sha256', $randomKey . $uriPath . $requestBody, (string) ($cfg['secret_key'] ?? ''));
        $authParams = 'apiKey:' . (string) ($cfg['api_key'] ?? '') . '&randomKey:' . $randomKey . '&signature:' . $signature;

        return [
            'Authorization' => 'IYZWSv2 ' . base64_encode($authParams),
            'x-iyzi-rnd' => $randomKey,
        ];
    }

    /** Kuruş toleransı: Ticimax hesabı ile iyzico kalem tahsilatı arasındaki yuvarlama farkı sınırı. */
    public const AMOUNT_TOLERANCE = 0.05;

    /**
     * İade tutarını iyzico işlem kalemlerine PLANLAR (saf — test edilebilir, HTTP yok).
     * Kural (2026-07-07 kullanıcı kararı: karta iade DAİMA otomatik, manuel yol yok):
     *  1. Tutarla birebir (±tolerans) eşleşen kalem varsa ÖNCE o kullanılır (doğru kaleme iade).
     *  2. Kalanı büyükten küçüğe kalemlere dağıtılır (greedy); her kalemde tavan = paidPrice
     *     (müşterinin o kaleme fiilen ödediği) — kuruş farkları tavana KIRPILIR, asla aşılmaz.
     *  3. $skipIds: önceki denemede başarıyla iade edilen kalemler (yarım kalan çok-kalemli
     *     iadede kaldığı yerden devam) atlanır.
     *  4. Toplam tahsilat tutarı karşılamıyorsa plan başarısız (yanlış/fazla iade yapılmaz).
     *
     * @param  array<int,array{id:string,paid_price:float}>  $txns
     * @return array{ok:bool, plan:array<int,array{id:string,price:float}>, error:?string}
     */
    public function planRefund(float $amount, array $txns, array $skipIds = []): array
    {
        $amount = round($amount, 2);
        $avail = array_values(array_filter($txns, fn ($t) => ! in_array((string) $t['id'], array_map('strval', $skipIds), true)
            && round((float) $t['paid_price'], 2) > 0));

        if ($amount <= 0) {
            return ['ok' => false, 'plan' => [], 'error' => 'İade tutarı geçersiz.'];
        }
        if (! $avail) {
            return ['ok' => false, 'plan' => [], 'error' => 'İade yapılabilecek iyzico işlem kalemi kalmadı (tümü daha önce iade edilmiş olabilir).'];
        }

        // Birebir eşleşen kalem öne, kalanlar tutar büyükten küçüğe.
        usort($avail, function ($a, $b) use ($amount) {
            $ea = abs(round((float) $a['paid_price'], 2) - $amount) <= self::AMOUNT_TOLERANCE ? 0 : 1;
            $eb = abs(round((float) $b['paid_price'], 2) - $amount) <= self::AMOUNT_TOLERANCE ? 0 : 1;

            return $ea <=> $eb ?: (float) $b['paid_price'] <=> (float) $a['paid_price'];
        });

        $remaining = $amount;
        $plan = [];
        foreach ($avail as $t) {
            if ($remaining <= self::AMOUNT_TOLERANCE) {
                break;
            }
            $take = round(min($remaining, round((float) $t['paid_price'], 2)), 2);
            if ($take <= 0) {
                continue;
            }
            $plan[] = ['id' => (string) $t['id'], 'price' => $take];
            $remaining = round($remaining - $take, 2);
        }

        if ($remaining > self::AMOUNT_TOLERANCE) {
            return ['ok' => false, 'plan' => [], 'error' => sprintf(
                'İade tutarı (%.2f) iyzico tahsilat kalemlerinin kalan toplamını aşıyor (karşılanamayan: %.2f). Fazla iade engellendi.',
                $amount, $remaining
            )];
        }

        return ['ok' => true, 'plan' => $plan, 'error' => null];
    }

    /**
     * AYNI SİPARİŞİN ÖNCEKİ TALEPLERİNDE iade edilmiş tutarları kalem tavanından düşer (saf — test edilebilir).
     * (2026-10-03, talep #2254: 2. parça iade, 1. talepte tamamı iade edilmiş en büyük kaleme planlanıp
     * iyzico 5093 ile reddediliyordu.) $prior: [paymentTransactionId => iade edilen tutar | null];
     * null = tutar bilinmiyor → kalem tamamen tüketilmiş sayılır (temkinli: fazla iade yerine plan dışı).
     *
     * @param  array<int,array{id:string,paid_price:float}>  $txns
     * @param  array<string,float|null>  $prior
     * @return array<int,array{id:string,paid_price:float}>
     */
    public function applyPriorRefunds(array $txns, array $prior): array
    {
        foreach ($txns as &$t) {
            $id = (string) $t['id'];
            if (! array_key_exists($id, $prior)) {
                continue;
            }
            $t['paid_price'] = $prior[$id] === null
                ? 0.0
                : max(0.0, round((float) $t['paid_price'] - (float) $prior[$id], 2));
        }
        unset($t);

        return $txns;
    }

    public function refund(array $cfg, array $ctx, bool $dryRun): array
    {
        $amount = round((float) ($ctx['amount'] ?? 0), 2);
        $request = $this->buildRequest($ctx);
        $txnId = $request['paymentTransactionId'];

        $base = ['success' => false, 'dry_run' => $dryRun, 'provider' => 'iyzico', 'configured' => $this->isConfigured($cfg), 'txn_id' => null, 'error' => null, 'request' => $request, 'response' => null, 'partial' => false, 'succeeded_txns' => [], 'refunded_total' => 0.0];

        if ($amount <= 0) {
            return ['error' => 'İade tutarı geçersiz.'] + $base;
        }

        $paymentId = trim((string) ($ctx['payment']['pos_referans_id'] ?? ($ctx['payment_id'] ?? '')));

        if ($dryRun) {
            Log::channel(config('returns.log_channel', 'stack'))->info('[Refund][iyzico][DRY-RUN] iade isteği gönderilmedi', [
                'conversationId' => $request['conversationId'],
                'paymentId' => $paymentId,
                'paymentTransactionId' => $txnId,
                'price' => $request['price'],
                'note' => $txnId ? null : ($paymentId !== ''
                    ? 'paymentTransactionId yok — canlıda retrievePayment(paymentId) ile çözülecek.'
                    : 'paymentId (PosReferansID) yok — canlı iade engellenir.'),
            ]);

            return ['success' => true] + $base;
        }

        if (! $this->isConfigured($cfg)) {
            return ['error' => 'iyzico kimlikleri (api_key/secret_key) tanımlı değil.'] + $base;
        }

        // İade planı: paymentTransactionId dışarıdan verilmişse tek kalem; verilmemişse
        // retrievePayment(paymentId) → kalemler → planRefund (birebir eşleşme + greedy dağıtım + kırpma).
        if ($txnId) {
            $plan = [['id' => (string) $txnId, 'price' => $amount]];
        } else {
            if ($paymentId === '') {
                return ['error' => 'iyzico paymentId (Ticimax PosReferansID) yok — paymentTransactionId çözülemez. İade yapılamadı, ödeme bilgisi kontrol edilmeli.'] + $base;
            }
            $rp = $this->retrievePayment($cfg, $request['conversationId'], $paymentId);
            $base['response'] = $rp['response'] ?? null;
            if (! ($rp['success'] ?? false)) {
                return ['error' => 'iyzico ödeme detayı alınamadı: ' . ($rp['error'] ?? 'bilinmeyen') . ' Lütfen tekrar deneyin.'] + $base;
            }
            $txns = $rp['transactions'] ?? [];
            if (! $txns) {
                return ['error' => 'iyzico ödeme detayında işlem kalemi (paymentTransactionId) bulunamadı.'] + $base;
            }

            // VADE FARKI TELAFİSİ (2026-08-11): taksitli ödemede iyzico vade farkını kalem
            // tutarlarının üstüne ekler (paidPrice > price) ve biz istemedikçe İADE ETMEZ —
            // TAM iadede müşteri eksik alır. Kural açıkken (ctx.installment_fee, yalnız tam
            // iade/iptalde gelir) vade = paidPrice − price − kargo iade tutarına eklenir.
            // Retry'da güvenli: hedef sabittir (onaylanan+vade), kalan = hedef − iade edilen.
            $fee = (array) ($ctx['installment_fee'] ?? []);
            $feeTopup = 0.0;
            if (($fee['enabled'] ?? false)) {
                $feeTopup = $this->installmentFeeTopup((array) ($rp['response'] ?? []), (float) ($fee['shipping_cost'] ?? 0));
                if ($feeTopup > 0) {
                    $amount = round($amount + $feeTopup, 2);
                    $base['installment_fee_topup'] = $feeTopup;
                    Log::channel(config('returns.log_channel', 'stack'))->info('[Refund][iyzico] vade farkı iade tutarına eklendi', [
                        'conversationId' => $request['conversationId'],
                        'paymentId' => $paymentId,
                        'topup' => $feeTopup,
                        'amount' => $amount,
                    ]);
                }
            }

            // Aynı siparişin diğer taleplerinde iade edilmiş kalem tutarları tavandan düşülür.
            $txns = $this->applyPriorRefunds($txns, (array) ($ctx['prior_refunds'] ?? []));

            $planned = $this->planRefund($amount, $txns, (array) ($ctx['skip_txns'] ?? []));
            if (! $planned['ok']) {
                return ['error' => $planned['error']] + $base;
            }
            $plan = $planned['plan'];
        }

        // Planı sırayla uygula. Kalemlerden biri reddedilirse: o ana kadar İADE EDİLENLER kalıcıdır
        // (para hareketi geri alınamaz) → partial=true + succeeded_txns döner; tekrar denemede
        // başarılı kalemler atlanarak kalan tamamlanır.
        $succeeded = [];
        $refundedTotal = 0.0;
        $responses = [];

        foreach ($plan as $step) {
            $stepReq = $request;
            $stepReq['paymentTransactionId'] = $step['id'];
            $stepReq['price'] = number_format(round((float) $step['price'], 2), 2, '.', '');

            try {
                $uriPath = '/payment/refund';
                $body = json_encode($stepReq, JSON_UNESCAPED_UNICODE);
                $headers = $this->authHeaders($cfg, $uriPath, $body);
                $res = Http::withHeaders($headers + ['Content-Type' => 'application/json'])
                    ->timeout(30)
                    ->withBody($body, 'application/json')
                    ->post(rtrim((string) ($cfg['base_url'] ?? 'https://api.iyzipay.com'), '/') . $uriPath);
                $json = is_array($res->json()) ? $res->json() : ['raw' => $res->body()];
                $responses[] = ['txn' => $step['id'], 'price' => $stepReq['price'], 'response' => $json];

                if (($json['status'] ?? '') !== 'success') {
                    return [
                        'partial' => $succeeded !== [],
                        'succeeded_txns' => $succeeded,
                        'refunded_total' => round($refundedTotal, 2),
                        'request' => $stepReq,
                        'response' => $responses,
                        'error' => 'iyzico iade reddetti (kalem ' . $step['id'] . '): ' . ($json['errorMessage'] ?? 'bilinmeyen hata')
                            . ($succeeded !== [] ? sprintf(' — %.2f iade edildi, kalan tekrar denenebilir.', $refundedTotal) : ' Lütfen tekrar deneyin.'),
                    ] + $base;
                }

                $succeeded[] = $step['id'];
                $refundedTotal += (float) $step['price'];
            } catch (\Throwable $e) {
                return [
                    'partial' => $succeeded !== [],
                    'succeeded_txns' => $succeeded,
                    'refunded_total' => round($refundedTotal, 2),
                    'response' => $responses,
                    'error' => 'iyzico iade isteği başarısız: ' . $e->getMessage()
                        . ($succeeded !== [] ? sprintf(' — %.2f iade edildi, kalan tekrar denenebilir.', $refundedTotal) : ''),
                ] + $base;
            }
        }

        return [
            'success' => true,
            'txn_id' => implode(',', $succeeded),
            'succeeded_txns' => $succeeded,
            'refunded_total' => round($refundedTotal, 2),
            'response' => count($responses) === 1 ? $responses[0]['response'] : $responses,
        ] + $base;
    }

    /**
     * Vade farkı (taksit komisyonu) — iyzico ödeme detayından hesaplar (saf, unit-testli).
     *
     * iyzico üst seviye `paidPrice` müşterinin fiilen ödediği TOPLAMDIR (kargo + vade dahil);
     * `price` yalnız sepet kalemlerinin toplamıdır. Fark = kargo + vade. Kargo düşülünce vade kalır.
     * `installment` 1 ise vade OLAMAZ (fark tamamen kargodur) → 0 döner; böylece Ticimax kargo
     * alanıyla olası uyumsuzluk taksitsiz siparişte asla fazla iadeye yol açamaz.
     */
    public function installmentFeeTopup(array $paymentDetail, float $shippingCost): float
    {
        $installment = (int) ($paymentDetail['installment'] ?? 1);
        if ($installment <= 1) {
            return 0.0;
        }

        $paid = round((float) ($paymentDetail['paidPrice'] ?? 0), 2);
        $price = round((float) ($paymentDetail['price'] ?? 0), 2);
        if ($paid <= 0 || $price <= 0) {
            return 0.0;
        }

        $topup = round($paid - $price - max(0.0, round($shippingCost, 2)), 2);

        return $topup > 0.01 ? $topup : 0.0;
    }

    /**
     * iyzico ödeme detayı (retrievePayment) — POST {base_url}/payment/detail (paymentId ile sorgu).
     * SALT-OKUMA (iade DEĞİL) ama dış servise gider → yalnız canlı yolda (dry-run'da çağrılmaz) kullanılır.
     * Yanıttaki `itemTransactions[].paymentTransactionId` listesi döner (iade bunlardan biriyle yapılır).
     *
     * @return array{success:bool, transaction_ids:array<int,string>, response:?array, error:?string}
     */
    public function retrievePayment(array $cfg, string $conversationId, string $paymentId): array
    {
        $fail = fn (?array $resp, string $err) => ['success' => false, 'transaction_ids' => [], 'response' => $resp, 'error' => $err];

        if (! $this->isConfigured($cfg)) {
            return $fail(null, 'iyzico kimlikleri tanımlı değil.');
        }
        if (trim($paymentId) === '') {
            return $fail(null, 'paymentId boş.');
        }

        // paymentId ZORUNLU anahtar; conversationId yalnız izleme/echo amaçlı.
        $req = ['locale' => 'tr', 'conversationId' => $conversationId, 'paymentId' => $paymentId];

        try {
            $uriPath = '/payment/detail';
            $body = json_encode($req, JSON_UNESCAPED_UNICODE);
            $headers = $this->authHeaders($cfg, $uriPath, $body);
            $res = Http::withHeaders($headers + ['Content-Type' => 'application/json'])
                ->timeout(30)
                ->withBody($body, 'application/json')
                ->post(rtrim((string) ($cfg['base_url'] ?? 'https://api.iyzipay.com'), '/') . $uriPath);
            $json = is_array($res->json()) ? $res->json() : ['raw' => $res->body()];

            if (($json['status'] ?? '') !== 'success') {
                return $fail($json, 'iyzico ödeme detayı alınamadı: ' . ($json['errorMessage'] ?? 'bilinmeyen'));
            }

            $ids = [];
            $txns = [];
            foreach ((array) ($json['itemTransactions'] ?? []) as $it) {
                if (! empty($it['paymentTransactionId'])) {
                    $ids[] = (string) $it['paymentTransactionId'];
                    // paidPrice = müşterinin o kaleme fiilen ödediği (indirim dağıtılmış) tutar —
                    // iade tavanı budur (price alanı liste fiyatı olabilir, KULLANMA).
                    $txns[] = [
                        'id' => (string) $it['paymentTransactionId'],
                        'paid_price' => round((float) ($it['paidPrice'] ?? $it['price'] ?? 0), 2),
                    ];
                }
            }

            return ['success' => true, 'transaction_ids' => $ids, 'transactions' => $txns, 'response' => $json, 'error' => null];
        } catch (\Throwable $e) {
            return $fail(null, 'iyzico ödeme detayı isteği başarısız: ' . $e->getMessage());
        }
    }
}
