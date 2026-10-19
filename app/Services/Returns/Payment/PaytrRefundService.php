<?php

namespace App\Services\Returns\Payment;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PayTR karta iade — `POST https://www.paytr.com/odeme/iade`.
 *
 * İade referansı = `merchant_oid` (PayTR'a ödeme anında gönderilen sipariş no). TB'de Ticimax ödeme
 * bloğundaki `OdemeSiparisID` bu değerdir (örn "628560_639173936282235467").
 *
 * İmza: paytr_token = base64( HMAC-SHA256( merchant_id + merchant_oid + return_amount + merchant_salt,
 *       merchant_key ) ). Yanıt JSON: {status:'success'|'error', err_msg?, ...}.
 *
 * ⛔ dry_run iken HTTP isteği YAPILMAZ; payload (token dahil — token türetilmiş, sır değil) loglanır.
 */
class PaytrRefundService implements PaymentRefundProvider
{
    public function key(): string
    {
        return 'paytr';
    }

    public function isConfigured(array $cfg): bool
    {
        return ! empty($cfg['merchant_id']) && ! empty($cfg['merchant_key']) && ! empty($cfg['merchant_salt']);
    }

    /**
     * İmzalı iade isteği gövdesini kurar (saf — test edilebilir).
     *
     * @return array{merchant_id:string, merchant_oid:string, return_amount:string, paytr_token:string}
     */
    public function buildRequest(array $cfg, string $merchantOid, float $amount): array
    {
        // PayTR tutarı nokta ondalıklı, 2 hane (kuruş): "149.90".
        $returnAmount = number_format($amount, 2, '.', '');
        $merchantId = (string) ($cfg['merchant_id'] ?? '');
        $hashStr = $merchantId . $merchantOid . $returnAmount . (string) ($cfg['merchant_salt'] ?? '');
        $token = base64_encode(hash_hmac('sha256', $hashStr, (string) ($cfg['merchant_key'] ?? ''), true));

        return [
            'merchant_id' => $merchantId,
            'merchant_oid' => $merchantOid,
            'return_amount' => $returnAmount,
            'paytr_token' => $token,
        ];
    }

    /**
     * PayTR durum sorgusu (SALT-OKUNUR) — `POST /odeme/durum-sorgu`. Token formülü iade ile aynı
     * (merchant_id + merchant_oid + merchant_salt). İki iş görür: (1) merchant_oid gerçekten başarılı
     * bir PayTR ödemesi mi (yanlış satır seçimini iade DENEMEDEN eler), (2) `returns[]` ile bu ödemeye
     * daha önce yapılmış iadelerin toplamı (panelden manuel iade → çift iade guard'ı; canlı kanıt
     * SiparisID 644125 / talep #50: 794,45 TL panelden iade edilmişken modül tekrar deneyecekti).
     *
     * @return array{found:?bool, payment_amount:float, refunded_total:float, error:?string, response:?array}
     *         found=null → sorgu yapılamadı (ağ/kimlik) — çağıran ESKİ davranışla devam etmeli.
     */
    public function queryStatus(array $cfg, string $merchantOid): array
    {
        $base = ['found' => null, 'payment_amount' => 0.0, 'refunded_total' => 0.0, 'error' => null, 'response' => null];
        if ($merchantOid === '' || ! $this->isConfigured($cfg)) {
            return $base;
        }

        $merchantId = (string) ($cfg['merchant_id'] ?? '');
        $token = base64_encode(hash_hmac(
            'sha256',
            $merchantId . $merchantOid . (string) ($cfg['merchant_salt'] ?? ''),
            (string) ($cfg['merchant_key'] ?? ''),
            true
        ));

        try {
            $res = Http::asForm()->timeout(15)->post(
                (string) ($cfg['status_endpoint'] ?? 'https://www.paytr.com/odeme/durum-sorgu'),
                ['merchant_id' => $merchantId, 'merchant_oid' => $merchantOid, 'paytr_token' => $token]
            );
            $json = is_array($res->json()) ? $res->json() : ['raw' => $res->body()];
            $base['response'] = $json;

            if (($json['status'] ?? '') === 'success') {
                $refunded = 0.0;
                foreach ((array) ($json['returns'] ?? []) as $ret) {
                    $refunded += (float) ($ret['return_amount'] ?? 0);
                }

                return ['found' => true, 'payment_amount' => (float) ($json['payment_total'] ?? ($json['payment_amount'] ?? 0)), 'refunded_total' => round($refunded, 2)] + $base;
            }

            // err 004: "merchant_oid ile basarili odeme bulunamadi" → bu oid PayTR'de başarılı ödeme değil.
            $msg = mb_strtolower((string) ($json['err_msg'] ?? ''));
            if (str_contains($msg, 'bulunamadi') || str_contains($msg, 'bulunamadı')) {
                return ['found' => false] + $base;
            }

            return ['error' => 'PayTR durum sorgusu hata döndü: ' . ($json['err_msg'] ?? 'bilinmeyen')] + $base;
        } catch (\Throwable $e) {
            return ['error' => 'PayTR durum sorgusu başarısız: ' . $e->getMessage()] + $base;
        }
    }

    public function refund(array $cfg, array $ctx, bool $dryRun): array
    {
        $merchantOid = (string) ($ctx['payment']['odeme_siparis_id'] ?? '');
        $amount = round((float) ($ctx['amount'] ?? 0), 2);

        $base = ['success' => false, 'dry_run' => $dryRun, 'provider' => 'paytr', 'configured' => $this->isConfigured($cfg), 'txn_id' => null, 'error' => null, 'request' => [], 'response' => null];

        if ($merchantOid === '') {
            return ['error' => 'PayTR merchant_oid (Ticimax OdemeSiparisID) bulunamadı.'] + $base;
        }
        if ($amount <= 0) {
            return ['error' => 'İade tutarı geçersiz.'] + $base;
        }

        $request = $this->buildRequest($cfg, $merchantOid, $amount);
        $base['request'] = $request;

        if ($dryRun) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info('[Refund][PayTR][DRY-RUN] iade isteği gönderilmedi', ['merchant_oid' => $merchantOid, 'return_amount' => $request['return_amount']]);

            return ['success' => true] + $base;
        }

        if (! $this->isConfigured($cfg)) {
            return ['error' => 'PayTR kimlikleri (merchant_id/key/salt) tanımlı değil.'] + $base;
        }

        try {
            $res = Http::asForm()->timeout(30)->post((string) ($cfg['endpoint'] ?? 'https://www.paytr.com/odeme/iade'), $request);
            $json = is_array($res->json()) ? $res->json() : ['raw' => $res->body()];
            $base['response'] = $json;
            $ok = ($json['status'] ?? '') === 'success';

            return [
                'success' => $ok,
                'txn_id' => $ok ? ($json['reference_no'] ?? $merchantOid) : null,
                'error' => $ok ? null : $this->describeError((string) ($json['err_msg'] ?? 'bilinmeyen hata')),
            ] + $base;
        } catch (\Throwable $e) {
            return ['error' => 'PayTR iade isteği başarısız: ' . $e->getMessage()] + $base;
        }
    }

    /**
     * PayTR hata mesajını personelin anlayacağı açıklamayla zenginleştirir (saf, unit-testli).
     *
     * "iade yapilamiyor, daha sonra tekrar deneyin" = PayTR'nin GEÇİCİ ret mesajı; canlı desen
     * (2026-08-11: #75/#181/#223/#236 — öğlen üst üste redler, öğleden sonra aynı iadeler değişmeden
     * geçti) kök sebebin PayTR bakiye yetersizliği olduğunu gösterdi: PayTR iadeleri firmanın
     * bekleyen hakediş bakiyesinden öder; yoğun iade saatlerinde bakiye eriyince bu mesaj döner,
     * satışlar biriktikçe kendiliğinden düzelir. Açıklama olmadan personel 10 kez üst üste deniyordu.
     */
    public function describeError(string $errMsg): string
    {
        $base = 'PayTR iade reddetti: ' . $errMsg;
        $lower = mb_strtolower($errMsg);
        if (str_contains($lower, 'daha sonra tekrar deneyin') || str_contains($lower, 'iade yapilamiyor') || str_contains($lower, 'iade yapılamıyor')) {
            return $base . ' — Bu PayTR\'nin GEÇİCİ ret mesajıdır: PayTR bakiyesi şu an bu iadeyi karşılamıyor olabilir '
                . '(iadeler PayTR\'deki hakediş bakiyesinden ödenir). Üst üste denemek işe yaramaz; '
                . 'satışlar biriktikçe bakiye dolar — 1-2 saat sonra tekrar deneyin.';
        }

        return $base;
    }
}
