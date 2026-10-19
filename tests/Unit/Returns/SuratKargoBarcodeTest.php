<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\SuratKargoService;
use PHPUnit\Framework\TestCase;

/**
 * Paket üzerindeki 11 haneli barkod KargoObjId'nin son 11 hanesidir (canlı doğrulama 06.08.2026:
 * tba52822376 → KargoObjId 3120000101254037867, paketteki barkod 01254037867).
 */
class SuratKargoBarcodeTest extends TestCase
{
    public function test_barcode_is_last_eleven_digits_of_kargo_obj_id(): void
    {
        $this->assertSame('01254037867', SuratKargoService::barcodeFromObjId(3120000101254037867));
        $this->assertSame('01256262000', SuratKargoService::barcodeFromObjId('3120000101256262000'));
    }

    public function test_invalid_or_short_obj_id_yields_null(): void
    {
        $this->assertNull(SuratKargoService::barcodeFromObjId(null));
        $this->assertNull(SuratKargoService::barcodeFromObjId(''));
        $this->assertNull(SuratKargoService::barcodeFromObjId('12345678901'));   // tam 11 hane: önek yok → güvenilmez
        $this->assertNull(SuratKargoService::barcodeFromObjId('31200001abc4037867'));
    }
}
