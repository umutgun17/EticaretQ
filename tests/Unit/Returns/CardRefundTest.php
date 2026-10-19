<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\Payment\IyzicoRefundService;
use App\Services\Returns\Payment\PaymentRefundManager;
use App\Services\Returns\Payment\PaytrRefundService;
use PHPUnit\Framework\TestCase;

/**
 * Faz 4 — karta iade (iyzico/PayTR) saf birim testleri (DB/ağ YOK). İmza/payload doğruluğu PARA-KRİTİK:
 * yanlış token / yanlış alan sırası → sağlayıcı reddeder veya yanlış tutar iade edilir.
 */
class CardRefundTest extends TestCase
{
    // ── PayTR ──

    public function test_paytr_token_matches_documented_formula(): void
    {
        $svc = new PaytrRefundService();
        $cfg = ['merchant_id' => 'MID123', 'merchant_key' => 'KEYabc', 'merchant_salt' => 'SALTxyz'];

        $req = $svc->buildRequest($cfg, '628560_639173936282235467', 149.9);

        // PayTR: return_amount nokta ondalıklı 2 hane.
        $this->assertSame('149.90', $req['return_amount']);
        $this->assertSame('628560_639173936282235467', $req['merchant_oid']);

        // paytr_token = base64( HMAC-SHA256( merchant_id + merchant_oid + return_amount + merchant_salt, key ) )
        $expected = base64_encode(hash_hmac('sha256', 'MID123628560_639173936282235467149.90SALTxyz', 'KEYabc', true));
        $this->assertSame($expected, $req['paytr_token']);
    }

    public function test_paytr_token_changes_with_amount(): void
    {
        $svc = new PaytrRefundService();
        $cfg = ['merchant_id' => 'M', 'merchant_key' => 'K', 'merchant_salt' => 'S'];

        $a = $svc->buildRequest($cfg, 'OID', 100.0)['paytr_token'];
        $b = $svc->buildRequest($cfg, 'OID', 100.01)['paytr_token'];

        $this->assertNotSame($a, $b);
    }

    public function test_paytr_is_configured(): void
    {
        $svc = new PaytrRefundService();
        $this->assertFalse($svc->isConfigured(['merchant_id' => 'M']));
        $this->assertTrue($svc->isConfigured(['merchant_id' => 'M', 'merchant_key' => 'K', 'merchant_salt' => 'S']));
    }

    public function test_paytr_refund_fails_without_merchant_oid(): void
    {
        $svc = new PaytrRefundService();
        $res = $svc->refund(['merchant_id' => 'M', 'merchant_key' => 'K', 'merchant_salt' => 'S'],
            ['payment' => ['odeme_siparis_id' => ''], 'amount' => 100.0], true);

        $this->assertFalse($res['success']);
        $this->assertStringContainsString('merchant_oid', $res['error']);
    }

    // ── iyzico ──

    public function test_iyzico_build_request_shape(): void
    {
        $svc = new IyzicoRefundService();
        $req = $svc->buildRequest([
            'payment' => ['odeme_siparis_id' => 'CONV-1'],
            'amount' => 250.5,
            'currency' => 'TRY',
            'ip' => '1.2.3.4',
        ]);

        $this->assertSame('CONV-1', $req['conversationId']);
        $this->assertSame('250.50', $req['price']);
        $this->assertSame('TRY', $req['currency']);
        $this->assertSame('1.2.3.4', $req['ip']);
        // Ticimax paymentTransactionId vermez → null (canlıda retrievePayment gerekir).
        $this->assertNull($req['paymentTransactionId']);
    }

    public function test_iyzico_auth_headers_v2(): void
    {
        $svc = new IyzicoRefundService();
        $cfg = ['api_key' => 'APIK', 'secret_key' => 'SECRET'];
        $body = '{"price":"10.00"}';

        $headers = $svc->authHeaders($cfg, '/payment/refund', $body, 'RND123');

        $this->assertSame('RND123', $headers['x-iyzi-rnd']);
        $expectedSig = hash_hmac('sha256', 'RND123/payment/refund' . $body, 'SECRET');
        $expectedAuth = 'IYZWSv2 ' . base64_encode('apiKey:APIK&randomKey:RND123&signature:' . $expectedSig);
        $this->assertSame($expectedAuth, $headers['Authorization']);
    }

    // ── OdemeTipi → sağlayıcı eşlemesi ──

    public function test_map_provider(): void
    {
        $mgr = new PaymentRefundManager(new IyzicoRefundService(), new PaytrRefundService(), new \App\Services\Returns\ReturnRulesService());
        $cfg = ['odeme_tipi_map' => ['17' => 'paytr', '14' => 'iyzico']];

        $this->assertSame('paytr', $mgr->mapProvider(17, $cfg));
        $this->assertSame('iyzico', $mgr->mapProvider(14, $cfg));
        $this->assertNull($mgr->mapProvider(99, $cfg)); // eşleşmeyen
        $this->assertNull($mgr->mapProvider(17, ['odeme_tipi_map' => ['17' => 'havale']])); // geçersiz sağlayıcı
        $this->assertNull($mgr->mapProvider(17, [])); // boş eşleme
    }

    // ── PosReferansID ayracı (iyzico vs PayTR — ikisi de OdemeTipi=17) ──

    public function test_resolve_provider_by_pos_referans_id(): void
    {
        $mgr = new PaymentRefundManager(new IyzicoRefundService(), new PaytrRefundService(), new \App\Services\Returns\ReturnRulesService());

        // iyzico: PosReferansID numerik+dolu (canlı 630247: 4073597601)
        $this->assertSame('iyzico', $mgr->resolveProvider(
            ['odeme_tipi' => 17, 'pos_referans_id' => '4073597601', 'odeme_siparis_id' => '630247_639177438564007618'], []));

        // PayTR: PosReferansID boş (canlı 630164)
        $this->assertSame('paytr', $mgr->resolveProvider(
            ['odeme_tipi' => 17, 'pos_referans_id' => '', 'odeme_siparis_id' => '630164_639177329698150903'], []));

        // PosReferansID numerik değil (örn başarısız ödeme hata metni) → iyzico sayılmaz, OdemeSiparisID varsa PayTR'a düşer
        $this->assertSame('paytr', $mgr->resolveProvider(
            ['odeme_tipi' => 17, 'pos_referans_id' => 'Ödeme Başarısız', 'odeme_siparis_id' => '628560_x'], []));

        // Hiçbir referans yok → belirlenemez (pending_manual)
        $this->assertNull($mgr->resolveProvider(['odeme_tipi' => 17, 'pos_referans_id' => '', 'odeme_siparis_id' => ''], []));

        // Açık override map varsa PosReferansID'yi geçersiz kılar (zorlama)
        $this->assertSame('iyzico', $mgr->resolveProvider(
            ['odeme_tipi' => 17, 'pos_referans_id' => '', 'odeme_siparis_id' => 'X'], ['odeme_tipi_map' => ['17' => 'iyzico']]));
    }

    // ── iyzico planRefund (çok-kalemli otomatik dağıtım, 2026-07-07) ──

    public function test_plan_refund_prefers_exact_matching_item_and_clamps_to_paid_price(): void
    {
        $svc = new IyzicoRefundService();
        // Gerçek saha verisi (sipariş 634677): Ticimax hesabı 40.50, iyzico kalem tahsilatı 40.4959463.
        $txns = [
            ['id' => 'T-KUCUK', 'paid_price' => 29.50405373],
            ['id' => 'T-ESLESEN', 'paid_price' => 40.4959463],
        ];

        $res = $svc->planRefund(40.50, $txns);
        $this->assertTrue($res['ok']);
        $this->assertCount(1, $res['plan']);
        $this->assertSame('T-ESLESEN', $res['plan'][0]['id']);
        // Tavan kırpma: 40.50 istenen ama kalem tahsilatı 40.50'den küçük → paidPrice'a kırpılır.
        $this->assertSame(40.50, $res['plan'][0]['price']); // min(40.50, round(40.4959,2)=40.50)
    }

    public function test_plan_refund_splits_full_amount_across_items(): void
    {
        $svc = new IyzicoRefundService();
        $txns = [
            ['id' => 'A', 'paid_price' => 29.50],
            ['id' => 'B', 'paid_price' => 40.50],
        ];

        $res = $svc->planRefund(70.00, $txns);
        $this->assertTrue($res['ok']);
        $this->assertCount(2, $res['plan']);
        $total = array_sum(array_column($res['plan'], 'price'));
        $this->assertEqualsWithDelta(70.00, $total, 0.001);
    }

    public function test_plan_refund_skips_already_refunded_items_on_retry(): void
    {
        $svc = new IyzicoRefundService();
        $txns = [
            ['id' => 'A', 'paid_price' => 29.50],
            ['id' => 'B', 'paid_price' => 40.50],
        ];

        // İlk denemede B iade edilmiş; retry yalnız kalan 29.50'yi A'dan ister.
        $res = $svc->planRefund(29.50, $txns, ['B']);
        $this->assertTrue($res['ok']);
        $this->assertCount(1, $res['plan']);
        $this->assertSame('A', $res['plan'][0]['id']);
        $this->assertSame(29.50, $res['plan'][0]['price']);
    }

    public function test_plan_refund_rejects_amount_exceeding_collectable_total(): void
    {
        $svc = new IyzicoRefundService();
        $txns = [['id' => 'A', 'paid_price' => 29.50]];

        // Fazla iade FAIL-CLOSED: toplam tahsilatı aşan tutar reddedilir.
        $res = $svc->planRefund(100.00, $txns);
        $this->assertFalse($res['ok']);
        $this->assertSame([], $res['plan']);
        $this->assertStringContainsString('aşıyor', $res['error']);

        // Tüm kalemler zaten iade edilmişse de plan çıkmaz.
        $res2 = $svc->planRefund(10.00, $txns, ['A']);
        $this->assertFalse($res2['ok']);
    }

    // ── Aynı siparişin önceki taleplerindeki iadeler (2026-10-03, talep #2254) ──

    public function test_prior_refunds_reduce_item_ceiling_so_second_request_avoids_refunded_item(): void
    {
        $svc = new IyzicoRefundService();
        // Saha verisi (sipariş 679757): bot kalemi 1. talepte tamamen iade edildi; 2. talep 670,44.
        $txns = [
            ['id' => '3435436589', 'paid_price' => 825.93341137],
            ['id' => '3435436635', 'paid_price' => 223.4815765],
            ['id' => '3435436637', 'paid_price' => 223.4815765],
            ['id' => '3435436636', 'paid_price' => 446.95343557],
        ];

        $adj = $svc->applyPriorRefunds($txns, ['3435436589' => 825.93]);
        $res = $svc->planRefund(670.44, $adj);
        $this->assertTrue($res['ok']);
        $this->assertNotContains('3435436589', array_column($res['plan'], 'id'));
        $this->assertEqualsWithDelta(670.44, array_sum(array_column($res['plan'], 'price')), 0.05);

        // Kısmi iade edilmiş kalemde yalnız kalan kullanılabilir; tutarı bilinmeyen (null) kalem tamamen düşer.
        $adj2 = $svc->applyPriorRefunds($txns, ['3435436636' => 400.00, '3435436635' => null]);
        $this->assertEqualsWithDelta(46.95, $adj2[3]['paid_price'], 0.001);
        $this->assertSame(0.0, $adj2[1]['paid_price']);
    }

    public function test_refunded_by_txn_parses_single_multi_and_partial_payloads(): void
    {
        $m = \App\Services\Returns\Payment\PaymentRefundManager::class;

        // Tek kalem başarı: `last` doğrudan iyzico yanıtı.
        $this->assertSame(['T1' => 825.93], $m::refundedByTxn([
            'last' => ['status' => 'success', 'price' => 825.93, 'paymentTransactionId' => 'T1'],
            'progress' => ['succeeded_txns' => ['T1'], 'refunded_total' => 825.93],
        ]));

        // Çok kalem: başarısız adım sayılmaz; önceki denemede geçen (tutarı bilinmeyen) kalem null.
        $this->assertSame(['A' => 100.0, 'ESKI' => null], $m::refundedByTxn([
            'last' => [
                ['txn' => 'A', 'price' => '100.00', 'response' => ['status' => 'success']],
                ['txn' => 'B', 'price' => '50.00', 'response' => ['status' => 'failure']],
            ],
            'progress' => ['succeeded_txns' => ['ESKI', 'A'], 'refunded_total' => 180.0],
        ]));

        $this->assertSame([], $m::refundedByTxn(['dry_run' => true]));
    }

    // ── Ödeme satırı seçimi (rankPaymentsBySuccess) ──

    public function test_rank_payments_skips_failed_attempt_row(): void
    {
        // Canlı vaka SiparisID 642295 (IADE-ACFK9AD7): iki satır da Onaylandi=1 ama ilki başarısız
        // deneme — eski sıralama onu seçip PayTR'ye yanlış merchant_oid gönderdi (err 005).
        $failed = ['id' => 779051, 'odeme_tipi' => 17, 'onaylandi' => 1,
            'pos_referans_id' => 'Ödeme Başarısız - Lütfen Yeniden Deneyiniz(  )',
            'odeme_siparis_id' => '642295_639203946695539891'];
        $success = ['id' => 779052, 'odeme_tipi' => 17, 'onaylandi' => 1,
            'pos_referans_id' => '4119778034',
            'odeme_siparis_id' => '642295_639203948287819268'];

        $ranked = \App\Services\TicimaxService::rankPaymentsBySuccess([$failed, $success]);

        $this->assertSame(779052, $ranked[0]['id']);
        $this->assertSame('iyzico', (new PaymentRefundManager(new IyzicoRefundService(), new PaytrRefundService(), new \App\Services\Returns\ReturnRulesService()))
            ->resolveProvider($ranked[0], []));
    }

    public function test_rank_payments_prefers_clean_paytr_row_over_failure_text(): void
    {
        // PayTR başarılı satırı PosReferansID BOŞ + Onaylandi=0 olabilir (canlı 634672) — hata metinli
        // satır Onaylandi=1 olsa bile temiz satır kazanmalı.
        $failedIyzico = ['id' => 2, 'onaylandi' => 1, 'pos_referans_id' => 'Ödeme Başarısız', 'odeme_siparis_id' => 'X_1'];
        $paytr = ['id' => 1, 'onaylandi' => 0, 'pos_referans_id' => null, 'odeme_siparis_id' => '634672000639186105441189394'];

        $ranked = \App\Services\TicimaxService::rankPaymentsBySuccess([$failedIyzico, $paytr]);

        $this->assertSame(1, $ranked[0]['id']);
    }

    public function test_rank_payments_single_row_and_paytr_multi_attempt(): void
    {
        // Tek satır aynen döner.
        $only = [['id' => 5, 'onaylandi' => 0, 'pos_referans_id' => null, 'odeme_siparis_id' => 'A']];
        $this->assertSame(5, \App\Services\TicimaxService::rankPaymentsBySuccess($only)[0]['id']);

        // İki temiz satır (çoklu PayTR denemesi): Onaylandi eşitse SONRAKİ deneme (id büyük) tercih.
        $r = \App\Services\TicimaxService::rankPaymentsBySuccess([
            ['id' => 10, 'onaylandi' => 1, 'pos_referans_id' => '', 'odeme_siparis_id' => 'A_1'],
            ['id' => 11, 'onaylandi' => 1, 'pos_referans_id' => '', 'odeme_siparis_id' => 'A_2'],
        ]);
        $this->assertSame(11, $r[0]['id']);
    }

    public function test_rank_payments_demotes_abandoned_onaylandi5_rows(): void
    {
        // Canlı vaka SiparisID 644125 (tba37406032 / talep #50): terk edilmiş denemeler Onaylandi=5 +
        // PosReferansID BOŞ (hata-metni filtresi yakalamaz) — eski "büyük Onaylandi önce" kuralı bunları
        // gerçek başarının (Onaylandi=1) önüne koydu → PayTR err 005 → 8 başarısız onay denemesi.
        $rows = [
            ['id' => 781015, 'odeme_tipi' => 17, 'onaylandi' => 5, 'pos_referans_id' => '', 'odeme_siparis_id' => '644125_639207218186906427', 'tutar' => 1183.80],
            ['id' => 781016, 'odeme_tipi' => 25, 'onaylandi' => 2, 'pos_referans_id' => '6 - Müşteri ödeme yapmaktan vazgeçti ve ödeme sayfasından ayrıldı.', 'odeme_siparis_id' => '644125000639207218756906921', 'tutar' => 1183.80],
            ['id' => 781017, 'odeme_tipi' => 17, 'onaylandi' => 5, 'pos_referans_id' => '', 'odeme_siparis_id' => '644125_639207218907551072', 'tutar' => 1183.80],
            ['id' => 781019, 'odeme_tipi' => 25, 'onaylandi' => 1, 'pos_referans_id' => '', 'odeme_siparis_id' => '644125000639207219372355985', 'tutar' => 1183.80],
        ];

        $ranked = \App\Services\TicimaxService::rankPaymentsBySuccess($rows);

        $this->assertSame(781019, $ranked[0]['id'], 'Gerçek başarılı satır (Onaylandi=1) önce gelmeli');
        // Hata metinli satır en sonda.
        $this->assertSame(781016, $ranked[3]['id']);
    }

    public function test_rank_payments_demotes_negative_amount_refund_rows(): void
    {
        // Panelden karta iade Ticimax'a NEGATİF tutarlı ödeme satırı yazar (canlı 644125: -794.45,
        // Onaylandi=1!) — asla iade referansı adayı olmamalı.
        $rows = [
            ['id' => 785549, 'odeme_tipi' => 25, 'onaylandi' => 1, 'pos_referans_id' => '', 'odeme_siparis_id' => '', 'tutar' => -794.45],
            ['id' => 781019, 'odeme_tipi' => 25, 'onaylandi' => 1, 'pos_referans_id' => '', 'odeme_siparis_id' => '644125000639207219372355985', 'tutar' => 1183.80],
        ];

        $ranked = \App\Services\TicimaxService::rankPaymentsBySuccess($rows);

        $this->assertSame(781019, $ranked[0]['id']);
    }

    // ── Fallback tetikleyicisi (isPaymentNotFound) ──

    public function test_is_payment_not_found_matches_only_definitive_errors(): void
    {
        $mgr = new PaymentRefundManager(new IyzicoRefundService(), new PaytrRefundService(), new \App\Services\Returns\ReturnRulesService());

        // Kesin "bulunamadı" sınıfı → fallback sıradaki adaya geçebilir.
        $this->assertTrue($mgr->isPaymentNotFound('PayTR iade reddetti: merchant_oid ile basarili odeme bulunamadi'));
        $this->assertTrue($mgr->isPaymentNotFound('iyzico ödeme detayı alınamadı: Kayıt bulunamadı Lütfen tekrar deneyin.'));
        $this->assertTrue($mgr->isPaymentNotFound('PayTR merchant_oid (Ticimax OdemeSiparisID) bulunamadı.'));

        // Belirsiz hatalar → fallback YOK (aynı satır tekrar denenmeli; yanlış satıra kayma riski).
        $this->assertFalse($mgr->isPaymentNotFound('PayTR iade reddetti: iade tutarı bakiyeyi aşıyor'));
        $this->assertFalse($mgr->isPaymentNotFound('PayTR iade isteği başarısız: cURL error 28 timeout'));
        $this->assertFalse($mgr->isPaymentNotFound(''));
    }

    // ── PayTR geçici ret açıklaması (describeError — 2026-08-11/12 bakiye tespiti) ──

    public function test_paytr_describe_error_explains_temporary_balance_rejection(): void
    {
        $svc = new PaytrRefundService();

        // Geçici ret (bakiye) mesajı → personele açıklama eklenir.
        $msg = $svc->describeError('iade yapilamiyor, daha sonra tekrar deneyin');
        $this->assertStringContainsString('PayTR iade reddetti: iade yapilamiyor', $msg);
        $this->assertStringContainsString('GEÇİCİ', $msg);
        $this->assertStringContainsString('1-2 saat sonra', $msg);

        // Diğer hatalar olduğu gibi kalır (ör. bulunamadı sınıfı — fallback tetikleyicisi bozulmamalı).
        $notFound = $svc->describeError('merchant_oid ile basarili odeme bulunamadi');
        $this->assertSame('PayTR iade reddetti: merchant_oid ile basarili odeme bulunamadi', $notFound);
        $this->assertStringNotContainsString('GEÇİCİ', $svc->describeError('iade tutarı bakiyeyi aşıyor'));
    }

    // ── Vade farkı telafisi (installmentFeeTopup — 2026-08-11 sistemik tespit) ──

    public function test_installment_fee_topup_single_installment_is_always_zero(): void
    {
        $svc = new IyzicoRefundService();

        // Tek çekimde paidPrice−price farkı KARGODUR, vade olamaz — Ticimax kargo alanı
        // 0 görünse bile ekleme yapılmaz (fazla iade imkânsız). Canlı örnek: #161 tba90720070.
        $detail = ['installment' => 1, 'price' => 779.97, 'paidPrice' => 879.97];
        $this->assertSame(0.0, $svc->installmentFeeTopup($detail, 0.0));
        $this->assertSame(0.0, $svc->installmentFeeTopup($detail, 100.0));
    }

    public function test_installment_fee_topup_computes_vade_without_shipping(): void
    {
        $svc = new IyzicoRefundService();

        // Canlı örnek #118 tbp70841298: 3 taksit, kargo 0 → vade 77.54.
        $detail = ['installment' => 3, 'price' => 1149.93, 'paidPrice' => 1227.47];
        $this->assertSame(77.54, $svc->installmentFeeTopup($detail, 0.0));
    }

    public function test_installment_fee_topup_subtracts_shipping_from_difference(): void
    {
        $svc = new IyzicoRefundService();

        // Taksitli + kargolu: fark = kargo + vade → kargo düşülür, yalnız vade eklenir.
        $detail = ['installment' => 3, 'price' => 1099.54, 'paidPrice' => 1249.54];
        $this->assertSame(50.0, $svc->installmentFeeTopup($detail, 100.0));

        // Fark kargoyu aşmıyorsa (vade yok / veri tutarsız) → 0, asla negatif değil.
        $detail2 = ['installment' => 2, 'price' => 500.0, 'paidPrice' => 580.0];
        $this->assertSame(0.0, $svc->installmentFeeTopup($detail2, 100.0));
    }

    public function test_installment_fee_topup_guards_missing_or_invalid_fields(): void
    {
        $svc = new IyzicoRefundService();

        $this->assertSame(0.0, $svc->installmentFeeTopup([], 0.0));
        $this->assertSame(0.0, $svc->installmentFeeTopup(['installment' => 3, 'price' => 0, 'paidPrice' => 100], 0.0));
        $this->assertSame(0.0, $svc->installmentFeeTopup(['installment' => 3, 'price' => 100, 'paidPrice' => 0], 0.0));
        // Kuruş düzeyi fark (yuvarlama artefaktı) eklenmez.
        $this->assertSame(0.0, $svc->installmentFeeTopup(['installment' => 3, 'price' => 100.0, 'paidPrice' => 100.01], 0.0));
    }
}
