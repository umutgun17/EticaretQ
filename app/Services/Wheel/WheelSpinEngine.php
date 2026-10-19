<?php

namespace App\Services\Wheel;

use App\Models\WheelSlice;
use Illuminate\Support\Collection;

/**
 * Çark sonucunu SUNUCUDA belirleyen ağırlıklı seçim motoru.
 *
 * ⚠️ Para/marj-kritik: kazanan dilim ASLA client tarafından belirlenmez. Frontend yalnızca
 * sunucunun döndürdüğü dilim indeksine animasyon yapar. Dilim ağırlıkları (olasılıklar)
 * client'a hiç gönderilmez.
 *
 * Seçim: her dilime `weight` atanır; toplam ağırlık üzerinden tek tip rastgele bir nokta
 * seçilir ve ilgili dilime düşer. weight=0 ya da stoğu dolmuş dilimler elenir.
 */
class WheelSpinEngine
{
    /**
     * Verilen dilimler arasından ağırlıklı rastgele bir tane seç.
     *
     * @param  Collection<int,WheelSlice>  $slices
     */
    public function pick(Collection $slices): ?WheelSlice
    {
        $eligible = $slices->filter(fn (WheelSlice $s) => $s->isSelectable())->values();

        if ($eligible->isEmpty()) {
            return null;
        }

        $totalWeight = (int) $eligible->sum(fn (WheelSlice $s) => max(0, (int) $s->weight));
        if ($totalWeight <= 0) {
            return null;
        }

        // 1..totalWeight arasında kriptografik olarak güçlü rastgele nokta
        $point = random_int(1, $totalWeight);

        $cursor = 0;
        foreach ($eligible as $slice) {
            $cursor += max(0, (int) $slice->weight);
            if ($point <= $cursor) {
                return $slice;
            }
        }

        // Teorik olarak ulaşılmaz; güvenli geri dönüş
        return $eligible->last();
    }
}
