<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Birlikte-alım matrisini kurar (Sepet Önerisi motoru).
 *
 * Kaynak: ödenmiş (paid_amount>0), çoklu-ürünlü siparişler. Her sipariş içindeki
 * ürün çiftleri sayılır; ürün başına en güçlü top_partners partner saklanır.
 * Tablo tenant başına DELETE+INSERT ile tazelenir (tek transaction, kısa pencere).
 */
class RecBuildCopurchases extends Command
{
    protected $signature = 'rec:build-copurchases
        {--tenant= : Yalnız bu tenant (boş = rec_cart_enabled veya cart_enabled açık tüm tenantlar)}
        {--days= : Kaç günlük sipariş penceresi (varsayılan config rec.copurchase.days)}';

    protected $description = 'Ödenmiş siparişlerden ürün birlikte-alım matrisini (rec_copurchases) kurar';

    public function handle(): int
    {
        $days = (int) ($this->option('days') ?: config('rec.copurchase.days', 365));
        $days = max(30, min(1095, $days));
        $topN = max(10, min(200, (int) config('rec.copurchase.top_partners', 60)));
        $minTogether = max(1, (int) config('rec.copurchase.min_together', 2));

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('tenants')->where('is_active', true)
                ->whereRaw("(coalesce(settings->>'rec_cart_enabled','') IN ('1','true') OR coalesce(settings->>'cart_enabled','') IN ('1','true'))")
                ->pluck('id')->all();

        if (empty($tenantIds)) {
            $this->info('Aktif rec tenant yok.');

            return self::SUCCESS;
        }

        foreach ($tenantIds as $tid) {
            $start = microtime(true);

            DB::transaction(function () use ($tid, $days, $topN, $minTogether) {
                DB::delete('DELETE FROM rec_copurchases WHERE tenant_id = ?', [$tid]);

                // Çift sayımı + ürün başına top-N (her iki yön de yazılır: a→b ve b→a)
                DB::insert("
                    INSERT INTO rec_copurchases (tenant_id, product_id, rec_product_id, together_count, last_together_at, built_at)
                    SELECT ?, product_id, rec_product_id, together_count, last_together_at, now()
                    FROM (
                        SELECT a.product_id,
                               b.product_id AS rec_product_id,
                               count(DISTINCT a.order_id) AS together_count,
                               max(o.order_date) AS last_together_at,
                               row_number() OVER (PARTITION BY a.product_id ORDER BY count(DISTINCT a.order_id) DESC, max(o.order_date) DESC) AS rn
                        FROM order_items a
                        JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
                        JOIN orders o ON o.id = a.order_id
                        WHERE o.tenant_id = ?
                          AND coalesce(o.paid_amount, 0) > 0
                          AND o.order_date >= now() - make_interval(days => ?)
                          AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
                        GROUP BY a.product_id, b.product_id
                        HAVING count(DISTINCT a.order_id) >= ?
                    ) t
                    WHERE t.rn <= ?
                ", [$tid, $tid, $days, $minTogether, $topN]);
            });

            $count = DB::table('rec_copurchases')->where('tenant_id', $tid)->count();
            $products = DB::table('rec_copurchases')->where('tenant_id', $tid)->distinct()->count('product_id');
            $this->info(sprintf(
                'tenant %d: %d çift (%d ürün için) — %.1fs',
                $tid, $count, $products, microtime(true) - $start
            ));
        }

        return self::SUCCESS;
    }
}
