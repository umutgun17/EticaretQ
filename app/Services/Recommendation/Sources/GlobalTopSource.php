<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;
use Illuminate\Support\Facades\DB;

/**
 * Son fallback: katalog genelinde en iyi performanslılar (beden filtresinden geçen).
 * Havuz her zaman dolsun diye pipeline'ın sonunda durur.
 */
class GlobalTopSource implements CandidateSource
{
    use BuildsCandidateSql;

    public function key(): string
    {
        return 'global_top';
    }

    public function collect(RecContext $ctx, int $need, array $excludeIds): array
    {
        if ($need <= 0) {
            return [];
        }

        // Eski davranışla birebir: ilk anchor'ın bedeni esas (yoksa kişi bedenleri)
        $primarySize = $ctx->anchors[0]['size'] ?? null;
        $sizes = $primarySize !== null ? [$primarySize] : $ctx->preferredSizes;

        $bindings = ['tenant' => $ctx->tenantId];
        $sizeSql = $this->sizeFilterSql($sizes, $bindings);
        $exclude = $this->excludeSql($excludeIds);

        $rows = DB::select("
            SELECT {$this->candidateColumns()}, 0 AS together_count
            FROM products p
            WHERE p.tenant_id = :tenant
              AND {$this->baseCandidateSql()}
              AND p.id NOT IN ({$exclude})
              AND {$sizeSql}
            ORDER BY p.performance_score DESC NULLS LAST
            LIMIT {$need}
        ", $bindings);

        foreach ($rows as $r) {
            $r->_score = 0.0;
            $r->_source = 'top';
            $r->_size = $primarySize;
        }

        return $rows;
    }
}
