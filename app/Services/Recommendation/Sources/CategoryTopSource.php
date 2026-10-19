<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;
use Illuminate\Support\Facades\DB;

/**
 * Kategori-lideri fallback kaynağı.
 *
 * İki mod (pipeline anahtarı belirler):
 *   category_top  — ilk anchor'ın kategorisinden en iyi performanslılar (tek-ürün akışı)
 *   category_mix  — anchor'lardaki kategori karışımı: toplam adedi çok olan kategori önce,
 *                   her kategori o kategorideki satırın bedeniyle filtrelenir
 *                   ("2 kadın + 3 kız çocuk → önce kız çocuktan 32, sonra kadından 37")
 */
class CategoryTopSource implements CandidateSource
{
    use BuildsCandidateSql;

    public function __construct(protected string $mode = 'category_top')
    {
    }

    public function key(): string
    {
        return $this->mode;
    }

    public function collect(RecContext $ctx, int $need, array $excludeIds): array
    {
        if (empty($ctx->anchors) && empty($ctx->boostCategories)) {
            return [];
        }

        if ($this->mode === 'category_mix') {
            return $this->collectMix($ctx, $need, $excludeIds);
        }

        $anchor = $ctx->anchors[0] ?? null;
        $category = $anchor['category'] ?? ($ctx->boostCategories[0] ?? null);
        if (! $category) {
            return [];
        }
        $sizes = $anchor && $anchor['size'] ? [$anchor['size']] : $ctx->sizePool();

        return $this->topOfCategory($ctx, $category, $sizes, $excludeIds, $need, $anchor['size'] ?? null);
    }

    protected function collectMix(RecContext $ctx, int $need, array $excludeIds): array
    {
        // Kategori karışımı: anchor'lardan kategori→(toplam adet, satır bedeni) haritası.
        // Anchor yoksa (salt kişi-bazlı akış) müşterinin sık kategorileri kullanılır.
        $byCat = [];
        foreach ($ctx->anchors as $a) {
            $cat = (string) ($a['category'] ?? '');
            if ($cat === '') {
                continue;
            }
            $byCat[$cat] ??= ['count' => 0, 'size' => $a['size']];
            $byCat[$cat]['count'] += (int) $a['qty'];
            $byCat[$cat]['size'] = $byCat[$cat]['size'] ?? $a['size'];
        }
        if (empty($byCat)) {
            foreach ($ctx->boostCategories as $cat) {
                $byCat[$cat] = ['count' => 1, 'size' => null];
            }
        }
        uasort($byCat, fn ($a, $b) => $b['count'] <=> $a['count']);

        if (! $ctx->cartMix) {
            $items = [];
            $have = $excludeIds;
            foreach ($byCat as $cat => $info) {
                if (count($items) >= $need) {
                    break;
                }
                $sizes = $info['size'] !== null ? [$info['size']] : $ctx->preferredSizes;
                $more = $this->topOfCategory($ctx, (string) $cat, $sizes, $have, $need - count($items), $info['size']);
                foreach ($more as $m) {
                    $have[] = (int) $m->id;
                }
                $items = array_merge($items, $more);
            }

            return $items;
        }

        // Karışım modu (rec_cart_mix): her kategoriden aday çek, sonra sırayla birer birer harmanla (en kalabalık kategori
        // her turda önce) — tek kategori tüm şeridi doldurmasın (saat+küpe+kolye sepeti → karışık öneri).
        $lists = [];
        foreach ($byCat as $cat => $info) {
            $sizes = $info['size'] !== null ? [$info['size']] : $ctx->preferredSizes;
            $more = $this->topOfCategory($ctx, (string) $cat, $sizes, $excludeIds, $need, $info['size']);
            if ($more) {
                $lists[] = $more;
            }
        }

        $items = [];
        $seen = [];
        for ($i = 0; count($items) < $need && $lists; $i++) {
            $any = false;
            foreach ($lists as $list) {
                if (! isset($list[$i])) {
                    continue;
                }
                $any = true;
                $id = (int) $list[$i]->id;
                if (isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $items[] = $list[$i];
                if (count($items) >= $need) {
                    break;
                }
            }
            if (! $any) {
                break;
            }
        }

        return $items;
    }

    /** @param string[] $sizes  @param int[] $excludeIds */
    protected function topOfCategory(RecContext $ctx, string $category, array $sizes, array $excludeIds, int $limit, ?string $displaySize): array
    {
        if ($limit <= 0) {
            return [];
        }
        $bindings = ['tenant' => $ctx->tenantId, 'category' => $category];
        $sizeSql = $this->sizeFilterSql($sizes, $bindings);
        $exclude = $this->excludeSql($excludeIds);

        $rows = DB::select("
            SELECT {$this->candidateColumns()}, 0 AS together_count
            FROM products p
            WHERE p.tenant_id = :tenant
              AND {$this->baseCandidateSql()}
              AND p.id NOT IN ({$exclude})
              AND p.category = :category
              AND {$sizeSql}
            ORDER BY p.performance_score DESC NULLS LAST
            LIMIT {$limit}
        ", $bindings);

        foreach ($rows as $r) {
            $r->_score = 0.0;
            $r->_source = 'category';
            $r->_size = $displaySize;
        }

        return $rows;
    }
}
