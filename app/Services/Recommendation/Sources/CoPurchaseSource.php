<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;
use Illuminate\Support\Facades\DB;

/**
 * Birlikte-alım kaynağı (rec_copurchases matrisi) — motorun ana stratejisi.
 *
 * Her anchor için matristen adaylar çekilir (anchor'ın KENDİ bedeniyle filtreli),
 * skor = birlikte-alım gücü + performans harmanı + üye marka/kategori boost'u.
 * Çok anchor'lı bağlamda (checkout sepeti, müşteri geçmişi) aynı aday birden çok
 * anchor'dan gelirse skorlar TOPLANIR (satır adedi ağırlıklı) + uyum bonusu.
 */
class CoPurchaseSource implements CandidateSource
{
    use BuildsCandidateSql;

    public function key(): string
    {
        return 'copurchase';
    }

    public function collect(RecContext $ctx, int $need, array $excludeIds): array
    {
        if (empty($ctx->anchors)) {
            return [];
        }

        $perAnchorLimit = count($ctx->anchors) > 1
            ? (int) config('rec.engine.copurchase_per_anchor', 12)
            : $need;

        $pool = [];
        foreach ($ctx->anchors as $anchor) {
            $cands = $this->forAnchor($ctx, (int) $anchor['id'], $anchor['size'], $excludeIds, $perAnchorLimit);

            // Satır adedi ağırlığı yalnız çok-anchor'lı akışta (tek anchor'da sıralamayı değiştirmez
            // ama davranış eski CartRecommender ile birebir kalsın diye tekte uygulanmaz)
            $lineWeight = count($ctx->anchors) > 1 ? 1 + log(1 + (int) $anchor['qty']) * 0.3 : 1.0;
            // Üyenin geçmiş alımından gelen anchor (sepette değil) yarım ağırlık
            if (! empty($anchor['history'])) {
                $lineWeight *= 0.5;
            }

            foreach ($cands as $c) {
                $key = (int) $c->id;
                if (isset($pool[$key])) {
                    $pool[$key]->_score += $c->_score * $lineWeight;
                    $pool[$key]->_hits++;
                } else {
                    $c->_score *= $lineWeight;
                    $c->_hits = 1;
                    $c->_size = $c->_size ?? $anchor['size'];
                    $pool[$key] = $c;
                }
            }
        }

        // Birden çok anchor'la uyumlu aday = küçük bonus (sepet bütünlüğü)
        foreach ($pool as $c) {
            if ($c->_hits > 1) {
                $c->_score *= (1 + 0.1 * min(3, $c->_hits - 1));
            }
        }

        $items = array_values($pool);
        usort($items, fn ($a, $b) => $b->_score <=> $a->_score);

        return array_slice($items, 0, $need);
    }

    /** @param int[] $excludeIds */
    protected function forAnchor(RecContext $ctx, int $anchorId, ?string $size, array $excludeIds, int $limit): array
    {
        $bindings = ['tenant' => $ctx->tenantId, 'source' => $anchorId];
        $sizeSql = $this->sizeFilterSql($size !== null ? [$size] : [], $bindings);
        $exclude = $this->excludeSql($excludeIds);

        $rows = DB::select("
            SELECT {$this->candidateColumns()}, rc.together_count
            FROM rec_copurchases rc
            JOIN products p ON p.id = rc.rec_product_id
            WHERE rc.tenant_id = :tenant AND rc.product_id = :source
              AND {$this->baseCandidateSql()}
              AND p.id NOT IN ({$exclude})
              AND {$sizeSql}
            ORDER BY rc.together_count DESC
            LIMIT 40
        ", $bindings);

        if (! $rows) {
            return [];
        }

        $wTogether = (float) config('rec.offer.w_together', 0.70);
        $wPerf = (float) config('rec.offer.w_performance', 0.30);
        $boost = (float) config('rec.offer.history_boost', 0.15);

        $maxTogether = max(array_map(fn ($r) => (int) $r->together_count, $rows));
        $maxPerf = max(1e-9, max(array_map(fn ($r) => (float) ($r->performance_score ?? 0), $rows)));

        $scored = [];
        foreach ($rows as $r) {
            $s = $wTogether * (log(1 + (int) $r->together_count) / log(1 + max(1, $maxTogether)))
               + $wPerf * ((float) ($r->performance_score ?? 0) / $maxPerf);
            if (($r->brand && in_array($r->brand, $ctx->boostBrands, true))
                || ($r->category && in_array($r->category, $ctx->boostCategories, true))) {
                $s *= (1 + $boost);
            }
            $r->_score = $s;
            $r->_source = 'copurchase';
            $scored[] = $r;
        }

        usort($scored, fn ($a, $b) => $b->_score <=> $a->_score);

        return array_slice($scored, 0, $limit);
    }
}
