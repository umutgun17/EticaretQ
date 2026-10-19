<?php

namespace App\Services\Returns;

/**
 * Müşteriye telefonda söylenen / şubede okunan kodlar (iade kargo kodu, kupon kodu) için
 * karışıklığa yol açmayan karakter seti. Hariç tutulanlar ve sebepleri:
 *   0/O/Q · 1/I/L · 2/Z · 5/S · 6/G · 8/B (görsel/işitsel ikizler),
 *   U/V (el yazısı+telefonda karışır), W/X (Türkçe söylenişi zor).
 */
final class ReadableCode
{
    public const ALPHABET = 'ACDEFHJKMNPRTVY3479';

    public static function generate(int $length): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= self::ALPHABET[random_int(0, $max)];
        }

        return $out;
    }

    /**
     * Yalnız rakamlardan kod (tenant önekli kısa iade kodları: tba48291037).
     * Rakamda görsel/işitsel ikiz sorunu yok; düşük segment müşteri/kargo personeli
     * için en az hatalı giriş bu format.
     */
    public static function digits(int $length): string
    {
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= (string) random_int(0, 9);
        }

        return $out;
    }
}
