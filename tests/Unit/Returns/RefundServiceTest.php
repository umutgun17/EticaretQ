<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\RefundService;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnNotifier;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Faz 4 — para iadesi kupon payload'ı (PARA-KRİTİK). DB'ye DOKUNMADAN: yalnız HediyeCekiOlustur
 * isteğinin TUTAR (TL) indirim olarak kurulduğunu doğrular. IndirimTipi=1 (yüzde) olursa 100 TL'lik
 * iade 100 TL'lik DEĞİL %100'lük kupon açar → felaket; bu test o regresyonu yakalar.
 *
 * Tam akış (durum geçişleri, idempotency, dry-run) DB gerektirdiğinden sentetik veriyle uçtan uca
 * dry-run doğrulamada (canlı yazma yok) ayrıca kontrol edilir.
 */
class RefundServiceTest extends TestCase
{
    private function service(): RefundService
    {
        $audit = new ReturnAuditLogger();
        $manager = new \App\Services\Returns\Payment\PaymentRefundManager(
            new \App\Services\Returns\Payment\IyzicoRefundService(),
            new \App\Services\Returns\Payment\PaytrRefundService(),
            new \App\Services\Returns\ReturnRulesService(),
        );

        $notifier = new ReturnNotifier($audit);
        $shortage = new \App\Services\Returns\ShortageService(
            new \App\Services\Returns\ReturnRulesService(),
            new \App\Services\Returns\RefundCalculator(),
            $audit,
            $notifier,
            new \App\Services\Returns\Payment\CodDetector(),
            new \App\Services\Returns\TicimaxOrderNormalizer(),
        );

        return new RefundService($audit, $notifier, $manager, new \App\Services\Returns\ReturnErpProcessor(), $shortage);
    }

    private function build(string $code, float $amount, array $scCfg): array
    {
        $m = new ReflectionMethod(RefundService::class, 'buildVoucherRequest');
        $m->setAccessible(true);

        return $m->invoke($this->service(), $code, $amount, $scCfg);
    }

    public function test_voucher_is_amount_discount_not_percent(): void
    {
        $req = $this->build('IADE-ABC123', 149.90, ['valid_days' => 180, 'indirim_tipi_tutar' => 0]);

        // ⛔ PARA-KRİTİK: 0 = TUTAR (TL). 1 olsaydı yüzde indirim olurdu.
        $this->assertSame(0, $req['IndirimTipi']);
        $this->assertSame(149.90, $req['IndirimDegeri']);
        $this->assertSame('IADE-ABC123', $req['Kod']);
    }

    public function test_voucher_is_single_use_and_unconditional(): void
    {
        $req = $this->build('IADE-XYZ', 50.0, []);

        $this->assertSame(1, $req['KullanimSayisi']);
        $this->assertSame(1, $req['UyeMaksimumKullanimSayisi']);
        $this->assertSame(0, $req['MinimumUrunTutari']);
        $this->assertFalse($req['MinTutarKosuldaGecerli']);
        // Boş config'de bile TUTAR (0) varsayılanına düşmeli — asla yüzde değil.
        $this->assertSame(0, $req['IndirimTipi']);
    }

    public function test_voucher_validity_window_matches_config_days(): void
    {
        $req = $this->build('IADE-DATE', 10.0, ['valid_days' => 30]);

        $start = strtotime($req['TarihBaslagic']);
        $end = strtotime($req['TarihBitis']);
        $days = (int) round(($end - $start) / 86400);

        $this->assertSame(30, $days);
        $this->assertGreaterThan($start, $end);
    }

    public function test_voucher_group_name_from_config(): void
    {
        $req = $this->build('IADE-G', 10.0, ['grup_adi' => 'İade Bakiyesi']);

        $this->assertSame('İade Bakiyesi', $req['GrupAdi']);
    }

    public function test_voucher_is_not_recorded_as_payment(): void
    {
        // 12 Ağu'da açılmıştı (0 TL sipariş için), 17 Ağu'da GERİ ALINDI: bayrak açıkken sepet kupondan
        // büyükse Ticimax kuponu onaylı ödeme yazıp kalanı tahsil edemiyor → stoksuz yarım siparişler +
        // kupon hakkı tükenmiyor/artıyor. Bayrak DAİMA kapalı gitmeli.
        $req = $this->build('IADE-P', 10.0, []);

        $this->assertFalse($req['HediyeCekiniOdemeOlarakKaydet']);
    }

    public function test_voucher_always_has_free_shipping(): void
    {
        // Kullanıcı kararı 12 Ağu (koşulsuz): kupon sepeti eşiğin altına düşürünce ek kargo çıkmasın.
        $this->assertTrue($this->build('IADE-K1', 10.0, [])['KargoUcretsiz']);
    }
}
