<?php

namespace App\Services\Returns\Payment;

/**
 * Karta iade (Faz 4 original) sağlayıcı sözleşmesi — iyzico & PayTR ortak arayüzü.
 *
 * Her sağlayıcı kendi kimlik config'ini ($cfg) + siparişin Ticimax ödeme bloğundan türetilen
 * bağlamı ($ctx) alır. ⛔ $dryRun=true iken GERÇEK API isteği YAPILMAZ; istek payload'ı loglanır.
 */
interface PaymentRefundProvider
{
    /** Sağlayıcı anahtarı: 'iyzico' | 'paytr'. */
    public function key(): string;

    /** Bu sağlayıcı için canlı çağrı yapacak kimlikler tam mı? */
    public function isConfigured(array $cfg): bool;

    /**
     * İadeyi yürüt.
     *
     * @param  array  $cfg  Sağlayıcı kimlik/endpoint config'i (returns.integrations.refund.original.<key>)
     * @param  array  $ctx  ['payment'=>normalize Ticimax ödeme, 'amount'=>float, 'currency'=>string,
     *                       'order_no'=>string, 'public_code'=>string, 'ip'=>string]
     * @param  bool   $dryRun  true: API'ye istek gönderme, payload logla
     * @return array{success:bool, dry_run:bool, provider:string, configured:bool, txn_id:?string,
     *               error:?string, request:array, response:?array}
     */
    public function refund(array $cfg, array $ctx, bool $dryRun): array;
}
