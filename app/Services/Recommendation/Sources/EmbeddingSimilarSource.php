<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;
use Illuminate\Support\Facades\DB;

/**
 * İçerik-benzerliği kaynağı (pgvector, products.embedding, HNSW).
 *
 * Anchor ürünlerin embedding'lerine kosinüs-yakın ürünleri getirir — birlikte-alım
 * verisi olmayan/yeni ürünlerde ve kişi-bazlı akışlarda (e-posta/WhatsApp) güçlü
 * bir keşif katmanı. Beden filtresi post-filter olduğundan HNSW komşuluğu geniş
 * tutulur (ef_search, bkz. ProductCategorizer dersi).
 */
class EmbeddingSimilarSource implements CandidateSource
{
    use BuildsCandidateSql;

    public function key(): string
    {
        return 'embedding';
    }

    public function collect(RecContext $ctx, int $need, array $excludeIds): array
    {
        if ($need <= 0 || empty($ctx->anchors)) {
            return [];
        }

        // En fazla 3 anchor'dan komşu topla (maliyet kontrolü); en yüksek adetli önce
        $anchors = $ctx->anchors;
        usort($anchors, fn ($a, $b) => ($b['qty'] ?? 1) <=> ($a['qty'] ?? 1));
        $anchors = array_slice($anchors, 0, 3);

        DB::statement('SET hnsw.ef_search = 200');

        $pool = [];
        foreach ($anchors as $anchor) {
            $bindings = ['tenant' => $ctx->tenantId, 'anchor' => (int) $anchor['id'], 'anchor2' => (int) $anchor['id']];
            $sizes = $anchor['size'] !== null ? [$anchor['size']] : $ctx->preferredSizes;
            $sizeSql = $this->sizeFilterSql($sizes, $bindings);
            $exclude = $this->excludeSql(array_merge($excludeIds, array_keys($pool)));

            $rows = DB::select("
                SELECT {$this->candidateColumns()},
                       (p.embedding <=> (SELECT embedding FROM products WHERE id = :anchor)) AS distance
                FROM products p
                WHERE p.tenant_id = :tenant
                  AND p.embedding IS NOT NULL
                  AND {$this->baseCandidateSql()}
                  AND p.id NOT IN ({$exclude})
                  AND {$sizeSql}
                  AND EXISTS (SELECT 1 FROM products a WHERE a.id = :anchor2 AND a.embedding IS NOT NULL)
                ORDER BY distance ASC
                LIMIT {$need}
            ", $bindings);

            foreach ($rows as $r) {
                // skor = benzerlik (1-mesafe); copurchase skorlarının altında kalsın diye 0.5 tavanlı
                $r->_score = max(0.0, min(0.5, 1 - (float) $r->distance));
                $r->_source = 'similar';
                $r->_size = $anchor['size'];
                $pool[(int) $r->id] = $r;
            }
            if (count($pool) >= $need) {
                break;
            }
        }

        $items = array_values($pool);
        usort($items, fn ($a, $b) => $b->_score <=> $a->_score);

        return array_slice($items, 0, $need);
    }
}
