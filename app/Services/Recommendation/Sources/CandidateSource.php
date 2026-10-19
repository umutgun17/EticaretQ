<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;

/**
 * Aday kaynağı sözleşmesi — motorun takılabilir stratejileri.
 *
 * collect() aday ürün satırları döndürür (stdClass: products kolonları +
 * _score float, _source string, _size ?string). Motor kaynakları pipeline
 * sırasıyla koşturur; her kaynak yalnız İHTİYAÇ kadar aday üretir ve
 * $excludeIds (bağlam dışlamaları + önceki kaynakların bulduğu ürünler)
 * listesindekileri asla döndürmez.
 */
interface CandidateSource
{
    /** Pipeline'da kullanılan anahtar (config rec.pipelines.* içinde geçer). */
    public function key(): string;

    /**
     * @param  int[]  $excludeIds
     * @return array<int, object>
     */
    public function collect(RecContext $ctx, int $need, array $excludeIds): array;
}
