<?php

namespace App\Enums;

/**
 * Çevirme sonucu üretilen kupon kodunun durumu.
 *
 * Şimdilik yalnızca `display` modu var (kod bizim tarafta üretilir, ekranda gösterilir →
 * issued). İleride Ticimax HediyeCekiKodu entegrasyonu (CANLI yazma, dry-run ile) eklenince
 * `pending`/`failed` anlam kazanır.
 */
enum WheelCouponStatus: string
{
    case None = 'none';         // Ödülsüz (kaybeden) ya da kupon gerekmiyor
    case Pending = 'pending';   // Üretim bekliyor (Ticimax dry-run / async)
    case Issued = 'issued';     // Kod üretildi, müşteriye gösterildi
    case Failed = 'failed';     // Üretim başarısız
    case Redeemed = 'redeemed'; // Müşteri kullandı
    case Expired = 'expired';   // Süresi doldu, Ticimax'ta pasifleştirildi (kazı kazan 30 dk)

    public function label(): string
    {
        return match ($this) {
            self::None => '—',
            self::Pending => 'Bekliyor',
            self::Issued => 'Verildi',
            self::Failed => 'Başarısız',
            self::Redeemed => 'Kullanıldı',
            self::Expired => 'Süresi doldu',
        };
    }
}
