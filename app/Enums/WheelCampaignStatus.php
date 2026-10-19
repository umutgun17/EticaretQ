<?php

namespace App\Enums;

/**
 * Çark kampanyası yaşam döngüsü.
 *
 *   draft → active ⇄ paused → ended
 *
 * Yalnızca `active` durumdaki ve tarih aralığı içindeki kampanya widget'ta çevrilebilir.
 */
enum WheelCampaignStatus: string
{
    case Draft = 'draft';      // Hazırlanıyor, sitede görünmez
    case Active = 'active';    // Yayında
    case Paused = 'paused';    // Geçici durduruldu
    case Ended = 'ended';      // Bitti / arşiv

    public function label(): string
    {
        return match ($this) {
            self::Draft => 'Taslak',
            self::Active => 'Yayında',
            self::Paused => 'Duraklatıldı',
            self::Ended => 'Bitti',
        };
    }

    /** Widget'ta gösterilip çevrilebilir mi (tarih kontrolü ayrı). */
    public function isLive(): bool
    {
        return $this === self::Active;
    }
}
