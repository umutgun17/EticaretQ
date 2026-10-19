<?php

namespace App\Services\Recommendation\Sources;

use App\Services\Recommendation\RecContext;
use Illuminate\Support\Facades\DB;

/**
 * Son N günün çok satanları (ödenmiş sipariş adedi) — "Sana Özel" kulakçığının sinyalsiz ziyaretçi kaynağı.
 *
 * Bağlamda yalnız kategori taşıyan sözde anchor'lar (id=0) varsa o kategorilerle sınırlanır
 * (ürün/kategori sayfasına doğrudan gelen ziyaretçi: "yüzük bakıyorsa yüzüğün çok satanları"),
 * yoksa katalog geneli. performance_score'a dayanan global_top'tan farkı: pencere kısa ve gerçek adet.
 */
class RecentSalesSource implements CandidateSource
{
    use BuildsCandidateSql;

    public function key(): string
    {
        return 'recent_top';
    }

    public function collect(RecContext $ctx, int $need, array $excludeIds): array
    {
        if ($need <= 0) {
            return [];
        }
        $days = max(7, min(180, (int) config('rec.engine.recent_sales_days', 30)));
        $cats = [];
        foreach ($ctx->anchors as $a) {
            if ((int) ($a['id'] ?? 0) === 0 && ! empty($a['category'])) {
                $cats[(string) $a['category']] = true;
            }
        }

        $bindings = ['tenant' => $ctx->tenantId, 'days' => $days];
        $sizeSql = $this->sizeFilterSql($ctx->preferredSizes, $bindings);
        $exclude = $this->excludeSql($excludeIds);
        $catSql = '';
        if ($cats) {
            $ph = [];
            foreach (array_keys($cats) as $i => $c) {
                $ph[] = ':cat'.$i;
                $bindings['cat'.$i] = $c;
            }
            $catSql = ' AND p.category IN ('.implode(', ', $ph).')';
        }

        $rows = DB::select("
            SELECT {$this->candidateColumns()}, 0 AS together_count, sum(oi.quantity) AS sold
            FROM products p
            JOIN order_items oi ON oi.product_id = p.id
            JOIN orders o ON o.id = oi.order_id
            WHERE p.tenant_id = :tenant AND o.tenant_id = p.tenant_id
              AND coalesce(o.paid_amount, 0) > 0
              AND o.order_date >= now() - make_interval(days => :days)
              AND {$this->baseCandidateSql()}
              AND p.id NOT IN ({$exclude})
              AND {$sizeSql}{$catSql}
            GROUP BY p.id
            ORDER BY sold DESC, p.performance_score DESC NULLS LAST
            LIMIT {$need}
        ", $bindings);

        foreach ($rows as $r) {
            $r->_score = 0.0;
            $r->_source = 'sales';
            $r->_size = null;
        }

        return $rows;
    }
}
