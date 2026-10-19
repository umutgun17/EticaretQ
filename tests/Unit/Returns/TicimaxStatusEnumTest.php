<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\ReturnErpProcessor;
use PHPUnit\Framework\TestCase;

/**
 * Ticimax "Sipariş Durumu" etiketi → WebSiparisDurumlari enum dönüşümü
 * (red/süre dolumunda prev-status geri çekmesi bu eşleşmeye dayanır).
 */
class TicimaxStatusEnumTest extends TestCase
{
    public function test_turkce_etiketler_enum_degerine_cevrilir(): void
    {
        $this->assertSame('TeslimEdildi', ReturnErpProcessor::ticimaxStatusLabelToEnum('Teslim Edildi'));
        $this->assertSame('KargoyaVerildi', ReturnErpProcessor::ticimaxStatusLabelToEnum('Kargoya Verildi'));
        $this->assertSame('Onaylandi', ReturnErpProcessor::ticimaxStatusLabelToEnum('Onaylandı'));
        $this->assertSame('OdemeBekliyor', ReturnErpProcessor::ticimaxStatusLabelToEnum('Ödeme Bekliyor'));
        $this->assertSame('IadeTalepAlindi', ReturnErpProcessor::ticimaxStatusLabelToEnum('İade Talep Alındı'));
        $this->assertSame('IadeUlastiOdemeYapilacak', ReturnErpProcessor::ticimaxStatusLabelToEnum('İade Ulaştı Ödeme Yapılacak'));
        $this->assertSame('KismiIadeYapildi', ReturnErpProcessor::ticimaxStatusLabelToEnum('Kısmi İade Yapıldı'));
        $this->assertSame('TeslimEdilemedi', ReturnErpProcessor::ticimaxStatusLabelToEnum('Teslim Edilemedi'));
    }

    public function test_panel_etiketi_enum_adindan_farkli_durumlar_alias_ile_cevrilir(): void
    {
        // Canlı t1 örnekleri (2026-08-07): panel etiketi enum adıyla birebir örtüşmüyor.
        $this->assertSame('IadeTalepAlindi', ReturnErpProcessor::ticimaxStatusLabelToEnum('İade Talebi Alındı'));
        $this->assertSame('IadeOdemeYapildi', ReturnErpProcessor::ticimaxStatusLabelToEnum('İade Ödemesi Yapıldı'));
        $this->assertSame('Iptal', ReturnErpProcessor::ticimaxStatusLabelToEnum('İptal Edildi'));
        $this->assertSame('Iade', ReturnErpProcessor::ticimaxStatusLabelToEnum('İade Edildi'));
        $this->assertSame('TeslimOncesiIptal', ReturnErpProcessor::ticimaxStatusLabelToEnum('Teslimat Öncesi İptal'));
    }

    public function test_enum_adinin_kendisi_de_kabul_edilir(): void
    {
        $this->assertSame('TeslimEdildi', ReturnErpProcessor::ticimaxStatusLabelToEnum('TeslimEdildi'));
        $this->assertSame('Iptal', ReturnErpProcessor::ticimaxStatusLabelToEnum('Iptal'));
    }

    public function test_bilinmeyen_veya_bos_etiket_null_doner(): void
    {
        $this->assertNull(ReturnErpProcessor::ticimaxStatusLabelToEnum('Depoda Hazırlanıyor (özel)'));
        $this->assertNull(ReturnErpProcessor::ticimaxStatusLabelToEnum(''));
        $this->assertNull(ReturnErpProcessor::ticimaxStatusLabelToEnum(null));
        $this->assertNull(ReturnErpProcessor::ticimaxStatusLabelToEnum('   '));
    }
}
