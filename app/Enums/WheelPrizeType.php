<?php

namespace App\Enums;

/**
 * Çark dilimi ödül tipi.
 *
 * `None` = kaybeden dilim (kupon üretilmez). Diğerleri kazanan dilimdir;
 * kupon üretimi/gösterimi WheelCouponIssuer tarafından yapılır.
 */
enum WheelPrizeType: string
{
    case DiscountPercent = 'discount_percent';  // % indirim (prize_value = yüzde)
    case DiscountAmount = 'discount_amount';     // TL indirim (prize_value = tutar)
    case FreeShipping = 'free_shipping';         // Kargo bedava
    case Gift = 'gift';                          // Hediye ürün / promosyon
    case Custom = 'custom';                      // Serbest metin ödül
    case None = 'none';                          // Kaybeden dilim (ödül yok)

    public function label(): string
    {
        return match ($this) {
            self::DiscountPercent => 'Yüzde indirim',
            self::DiscountAmount => 'Tutar indirim',
            self::FreeShipping => 'Kargo bedava',
            self::Gift => 'Hediye',
            self::Custom => 'Özel',
            self::None => 'Kaybeden',
        };
    }

    /** Bu ödül bir kupon kodu gerektirir mi? */
    public function needsCoupon(): bool
    {
        return match ($this) {
            self::DiscountPercent, self::DiscountAmount, self::FreeShipping, self::Gift => true,
            self::Custom, self::None => false,
        };
    }

    public function isWinning(): bool
    {
        return $this !== self::None;
    }
}
