<?php

namespace App\Services\Returns;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;

/**
 * Public (müşteri) iade akışı için kısa ömürlü, şifreli erişim token'ı.
 *
 * Sipariş doğrulaması (order_no + email/telefon) BAŞARILI olduktan sonra üretilir.
 * Sonraki adımlar (preview/submit) bu token ile yapılır — müşteri email/telefonu
 * tekrar tekrar göndermez ve serbest yeniden-sorgu engellenir.
 *
 * Token, uygulama anahtarı ile şifreli olduğundan kurcalanamaz; içinde son kullanma
 * zamanı (exp) taşır.
 */
class ReturnAccessToken
{
    private const TTL_SECONDS = 1800; // 30 dk

    public function issue(int $tenantId, string $orderNo, ?string $platformOrderId): string
    {
        return Crypt::encryptString(json_encode([
            't' => $tenantId,
            'no' => $orderNo,
            'pid' => $platformOrderId,
            'exp' => time() + self::TTL_SECONDS,
            'nonce' => bin2hex(random_bytes(8)),
        ]));
    }

    /**
     * @return array{tenant_id:int, order_no:string, platform_order_id:?string}|null
     */
    public function verify(string $token, int $expectedTenantId): ?array
    {
        try {
            $data = json_decode(Crypt::decryptString($token), true);
        } catch (DecryptException) {
            return null;
        }

        if (! is_array($data)) {
            return null;
        }
        if (($data['exp'] ?? 0) < time()) {
            return null;
        }
        if ((int) ($data['t'] ?? 0) !== $expectedTenantId) {
            return null;
        }

        return [
            'tenant_id' => (int) $data['t'],
            'order_no' => (string) ($data['no'] ?? ''),
            'platform_order_id' => $data['pid'] ?? null,
        ];
    }
}
