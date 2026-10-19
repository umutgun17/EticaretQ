<?php

namespace App\Services\Recommendation\Sources;

/**
 * Kaynakların ortak SQL parçaları: aday kolon seti, beden-stok filtresi, exclude listesi.
 */
trait BuildsCandidateSql
{
    /** Widget kartı için gereken ürün kolonları (tüm kaynaklar aynı seti döndürür). */
    protected function candidateColumns(): string
    {
        return 'p.id, p.platform_product_id, p.name, p.url, p.brand, p.category,
                p.price, p.discounted_price, p.images, p.performance_score, p.sku';
    }

    /** Her adayın sağlaması gereken taban koşullar. */
    protected function baseCandidateSql(): string
    {
        return "p.is_active = true AND coalesce(p.url, '') <> '' AND p.price > 0";
    }

    /**
     * Beden filtresi: istenen bedenlerden BİRİ stokta VEYA ürün bedensiz (aksesuar).
     * Boş beden listesi = yalnız stok kontrolü. Bağlamalar $bindings'e sz0..szN olarak eklenir.
     *
     * @param  string[]  $sizes
     */
    protected function sizeFilterSql(array $sizes, array &$bindings): string
    {
        $sizes = array_values(array_filter(array_map('strval', $sizes), fn ($s) => $s !== ''));
        if (empty($sizes)) {
            return 'p.stock_quantity > 0';
        }

        $ph = [];
        foreach ($sizes as $i => $s) {
            $key = 'sz'.$i;
            $ph[] = ':'.$key;
            $bindings[$key] = $s;
        }
        $in = implode(', ', $ph);

        return "(
            EXISTS (
                SELECT 1 FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active = true
                  AND v.stock_quantity > 0 AND v.attributes->>'Beden' IN ({$in})
            )
            OR (
                p.stock_quantity > 0 AND NOT EXISTS (
                    SELECT 1 FROM product_variants v2
                    WHERE v2.product_id = p.id AND coalesce(v2.attributes->>'Beden', '') <> ''
                )
            )
        )";
    }

    /** @param int[] $excludeIds */
    protected function excludeSql(array $excludeIds): string
    {
        return implode(',', array_map('intval', $excludeIds)) ?: '0';
    }
}
