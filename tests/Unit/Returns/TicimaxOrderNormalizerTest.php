<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\RefundCalculator;
use App\Services\Returns\TicimaxOrderNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * Ticimax alan yorumunu PARA-KRİTİK kurallarla kilitler (canlı veriyle doğrulandı):
 *  - `Tutar` = birim NET (KDV hariç), indirimler ZATEN uygulanmış → unit_price = Tutar+Kdv (nihai).
 *  - `ToplamIndirim`/`IndirimTutari` indirim MİKTARIDIR ama Tutar'a yansımıştır → tekrar çıkarılmaz
 *    (line_discount = 0). Aksi halde net 0'a düşer (eski bug).
 *  - Kargo (`KargoTutari`) satırda DEĞİL, ayrı → varsayılan iade dışı.
 *  - Vade farkı = OdenenTutar − SiparisToplamTutari; satıra DAĞITILMIŞ → varsayılan iade dışı.
 */
class TicimaxOrderNormalizerTest extends TestCase
{
    private function item(array $over = []): array
    {
        return array_merge([
            'ID' => '1001',
            'UrunAdi' => 'Test Ürün',
            'StokKodu' => 'SKU1',
            'Adet' => 1,
            'Tutar' => 0.0,        // birim NET (KDV hariç)
            'KdvTutari' => 0.0,    // birim KDV
            'ToplamIndirim' => 0.0,
        ], $over);
    }

    public function test_indirimli_kalemde_unit_price_nihai_ve_line_discount_sifir(): void
    {
        // %50 kampanya: orijinal 989.95 → nihai birim 494.97; ToplamIndirim=494.975 (miktar)
        $raw = [
            'SiparisNo' => 'TB1',
            'Durum' => 7,
            'OdenenTutar' => 494.975,
            'SiparisToplamTutari' => 494.975,
            'KargoTutari' => 0,
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['Tutar' => 449.9772, 'KdvTutari' => 44.9977, 'ToplamIndirim' => 494.975, 'SatisAniSatisFiyat' => 899.95, 'SatisAniSatisFiyatKdv' => 90.0]),
            ]],
        ];

        $o = (new TicimaxOrderNormalizer())->normalize($raw);

        $this->assertSame(494.97, $o['items'][0]['unit_price']);   // KDV dahil nihai
        $this->assertSame(0.0, $o['items'][0]['line_discount']);   // indirim tekrar çıkarılmaz
        $this->assertSame(0.0, $o['order_discount']);
    }

    public function test_kargo_ucreti_iade_disinda(): void
    {
        // 1 ürün 499.95 + kargo 100; ödenen 599.95
        $raw = [
            'SiparisNo' => 'TB-KARGO',
            'Durum' => 7,
            'OdenenTutar' => 599.95,
            'SiparisToplamTutari' => 599.95, // mal+kargo
            'KargoTutari' => 100,
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['Tutar' => 454.5, 'KdvTutari' => 45.45]), // 499.95
            ]],
        ];

        $o = (new TicimaxOrderNormalizer())->normalize($raw);
        $this->assertSame(100.0, $o['shipping_cost']);

        $calc = (new RefundCalculator())->calculate(
            $o,
            [['line_id' => '1001', 'qty' => 1]],
            ['refund_shipping' => false, 'cap' => $o['paid_amount']]
        );
        $this->assertSame(499.95, $calc['total_refundable']); // kargo HARİÇ
    }

    public function test_vade_farki_hesaba_katilmaz_urun_tutari_iade_edilir(): void
    {
        // Politika: vade farkı hesaplanmaz/dağıtılmaz; iade = ürün (satır) tutarı.
        // Ödeme kuruluşu vade farkını otomatik algılar. SiparisToplamTutari güvenilmez
        // olduğundan (paid>SiparisToplam ama vade olmayabilir) iade hesabında KULLANILMAZ.
        $raw = [
            'SiparisNo' => 'TB-TAKSIT',
            'Durum' => 7,
            'OdenenTutar' => 1200.0,
            'SiparisToplamTutari' => 1000.0, // güvenilmez — yok sayılır
            'KargoTutari' => 0,
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['ID' => 'L1', 'Tutar' => 545.4545, 'KdvTutari' => 54.5455, 'Adet' => 2]), // birim 600, satır 1200
            ]],
        ];

        $o = (new TicimaxOrderNormalizer())->normalize($raw);
        $this->assertArrayNotHasKey('installment_surcharge', $o); // vade alanı yok
        $this->assertSame(0.0, $o['order_discount']);            // dağıtılmamış kupon yok

        // TAM iade = ürün/satır tutarı (1200), vade ÇIKARILMAZ
        $full = (new RefundCalculator())->calculate(
            $o, [['line_id' => 'L1', 'qty' => 2]], ['cap' => $o['paid_amount']]
        );
        $this->assertSame(1200.0, $full['total_refundable']);

        // 1 adet kısmi iade = birim ürün tutarı (600)
        $partial = (new RefundCalculator())->calculate(
            $o, [['line_id' => 'L1', 'qty' => 1]], ['cap' => $o['paid_amount']]
        );
        $this->assertSame(600.0, $partial['total_refundable']);
    }

    public function test_tam_iade_yuvarlamayi_odenen_tutara_sabitler(): void
    {
        // 2 kalem, birim KDV dahil 494.9749 → round 494.97; Σsatır 989.94 ama ödenen 989.95
        $raw = [
            'SiparisNo' => 'TB-ROUND',
            'Durum' => 7,
            'OdenenTutar' => 989.95,
            'SiparisToplamTutari' => 989.95,
            'KargoTutari' => 0,
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['ID' => 'A', 'Tutar' => 449.9772, 'KdvTutari' => 44.9977]),
                $this->item(['ID' => 'B', 'Tutar' => 449.9772, 'KdvTutari' => 44.9977]),
            ]],
        ];
        $o = (new TicimaxOrderNormalizer())->normalize($raw);
        $this->assertSame(989.94, $o['line_total']); // ham satır toplamı

        // TAM iade → ödenen tutara sabitlenir (989.95), kuruş farkı en büyük satıra eklenir
        $full = (new RefundCalculator())->calculate(
            $o,
            [['line_id' => 'A', 'qty' => 1], ['line_id' => 'B', 'qty' => 1]],
            ['cap' => $o['paid_amount']]
        );
        $this->assertSame(989.95, $full['total_refundable']);
        // satır iade tutarları da tam ödenen tutarı vermeli
        $this->assertSame(989.95, round(array_sum(array_column($full['lines'], 'refundable')), 2));

        // KISMİ iade mutabakat uygulamaz (tek kalem tam değil)
        $partial = (new RefundCalculator())->calculate(
            $o, [['line_id' => 'A', 'qty' => 1]], ['cap' => $o['paid_amount']]
        );
        $this->assertSame(494.97, $partial['total_refundable']);
    }

    public function test_dagitilmamis_kupon_kismi_iadede_fazla_iade_etmez(): void
    {
        // 2 ürün × 649.97 = 1299.94 mal; 65 TL hediye çeki satıra dağıtılmamış → ödenen 1234.95
        $raw = [
            'SiparisNo' => 'TB-KUPON',
            'Durum' => 7,
            'OdenenTutar' => 1234.95,
            'SiparisToplamTutari' => 1234.95,
            'KargoTutari' => 0,
            'HediyeCekiTutari' => 65,
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['ID' => 'K1', 'Tutar' => 590.88, 'KdvTutari' => 59.09]), // 649.97
                $this->item(['ID' => 'K2', 'Tutar' => 590.88, 'KdvTutari' => 59.09]),
            ]],
        ];
        $o = (new TicimaxOrderNormalizer())->normalize($raw);
        $this->assertSame(1299.94, $o['line_total']);
        $this->assertSame(64.99, $o['order_discount']); // dağıtılmamış kupon yakalandı

        // TAM iade = nakit ödenen (1234.95), kuponu fazladan iade etmez
        $full = (new RefundCalculator())->calculate(
            $o,
            [['line_id' => 'K1', 'qty' => 1], ['line_id' => 'K2', 'qty' => 1]],
            ['cap' => $o['paid_amount']]
        );
        $this->assertSame(1234.95, $full['total_refundable']);

        // KISMİ (1 ürün): birim nihai 649.97'den AZ olmalı (kupon payı düşülmüş) → fazla iade yok
        $partial = (new RefundCalculator())->calculate(
            $o, [['line_id' => 'K1', 'qty' => 1]], ['cap' => $o['paid_amount']]
        );
        $this->assertLessThan(649.97, $partial['total_refundable']);
        $this->assertEqualsWithDelta(617.48, $partial['total_refundable'], 0.02);
    }

    public function test_panel_iadesi_indirim_sayilmaz(): void
    {
        // TB9931547563 (#2955): 699.95 + 578.95, 100 TL hediye çeki, kart 1178.90; panelden −645.22
        // iade satırı OdenenTutar'ı 533.68'e düşürdü → fark (745.22) eskiden indirim sanılıyordu.
        $raw = [
            'SiparisNo' => 'TB-PANEL',
            'Durum' => 7,
            'OdenenTutar' => 533.68,
            'SiparisToplamTutari' => 599.95,
            'KargoTutari' => 0,
            'HediyeCekiTutari' => 100,
            'Odemeler' => ['WebSiparisOdeme' => [
                ['ID' => 1, 'Tutar' => 1178.90, 'Onaylandi' => 1, 'PosReferansID' => '4192634624'],
                ['ID' => 2, 'Tutar' => -665, 'Onaylandi' => 2, 'PosReferansID' => '5267 : iade tutarı büyük olamaz.'],
                ['ID' => 3, 'Tutar' => -645.22, 'Onaylandi' => 1, 'PosReferansID' => ''],
                ['ID' => 4, 'Tutar' => 1178.90, 'Onaylandi' => 2, 'PosReferansID' => 'Ödeme Başarısız - Lütfen Yeniden Deneyiniz'],
                ['ID' => 5, 'Tutar' => 1178.90, 'Onaylandi' => 5, 'PosReferansID' => ''],
            ]],
            'Urunler' => ['WebSiparisUrun' => [
                $this->item(['ID' => '1', 'Tutar' => 636.3182, 'KdvTutari' => 63.6318]),
                $this->item(['ID' => '2', 'Tutar' => 526.3182, 'KdvTutari' => 52.6318]),
            ]],
        ];

        $o = (new TicimaxOrderNormalizer())->normalize($raw);
        $this->assertSame(100.0, $o['order_discount']); // yalnız hediye çeki

        $calc = (new RefundCalculator())->calculate($o, [['line_id' => '1', 'qty' => 1]], ['cap' => null]);
        $this->assertEqualsWithDelta(645.22, $calc['total_refundable'], 0.01);

        // Ödeme bloğu yoksa eski davranış (OdenenTutar) korunur.
        unset($raw['Odemeler']);
        $this->assertSame(745.22, (new TicimaxOrderNormalizer())->normalize($raw)['order_discount']);
    }
}
