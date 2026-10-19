<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * "Sana Özel" kulakçığı → satış atıfı (sunucu tarafı).
 *
 * 1) KESİN: olayın sepet kimliği (ikas'ta sepet id = sipariş id → orders.platform_order_id) ile aynı siparişte
 *    önerilen ürün varsa, olaydan sonraki 7 gün içinde → conversion (sipariş+ürün başına 1; value = KALEM tutarı).
 * 2) YEDEK: sepet eşleşmeyen olaylarda üye (customers.id) + ürün + 24 saat.
 * Ödemesi düşen siparişlerin conversion'ı geri alınır. created_at = sipariş anının UTC karşılığı.
 */
class ForYouAttributeConversions extends Command
{
    protected $signature = 'foryou:attribute-conversions
        {--tenant= : Yalnız bu tenant}
        {--days=3 : Kaç günlük sipariş taransın}
        {--dry : Yazma, yalnız raporla}';

    protected $description = 'Sana Özel kulakçığı tıklama/sepet olaylarını siparişlerle eşleştirip foryou_events\'e conversion yazar';

    public function handle(): int
    {
        $days = max(1, min(90, (int) $this->option('days')));
        $offsetH = (int) config('rec.attribution.order_tz_offset_hours', 3);
        $dry = (bool) $this->option('dry');

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('foryou_events')->whereIn('type', ['click', 'atc'])->where('is_test', false)->distinct()->pluck('tenant_id')->all();

        $grand = 0;
        foreach ($tenantIds as $tid) {
            if (! $dry) {
                $voided = DB::delete("
                    DELETE FROM foryou_events e USING orders o
                    WHERE e.tenant_id = ? AND e.type = 'conversion'
                      AND o.tenant_id = e.tenant_id AND o.platform_order_id = e.platform_order_id
                      AND coalesce(o.paid_amount, 0) <= 0
                ", [$tid]);
                if ($voided > 0) {
                    $this->line("tenant {$tid}: {$voided} conversion silindi (ödenmemiş sipariş)");
                }
            }
            $orderSince = now()->addHours($offsetH)->subDays($days)->format('Y-m-d H:i:s');
            $eventSince = now()->subDays($days + 7)->format('Y-m-d H:i:s');

            $rows = DB::select("
                WITH hits AS (
                    SELECT e.id AS event_id, e.product_id, e.session_id, e.mode, e.cart_id, e.customer_id,
                           e.created_at + make_interval(hours => ?) AS hit_local
                    FROM foryou_events e
                    WHERE e.tenant_id = ? AND e.is_test = false AND e.type IN ('click', 'atc')
                      AND e.product_id IS NOT NULL AND e.created_at >= ?
                      AND (coalesce(e.cart_id, '') <> '' OR e.customer_id IS NOT NULL)
                ),
                matched AS (
                    SELECT DISTINCT ON (o.id, h.product_id)
                           o.platform_order_id, o.order_date, oi.total_price AS item_total,
                           h.product_id, h.session_id, h.mode,
                           CASE WHEN h.cart_id = o.platform_order_id THEN 'cart' ELSE 'customer' END AS how
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    JOIN hits h ON oi.product_id = h.product_id
                               AND o.order_date >= h.hit_local - interval '5 minutes'
                               AND (
                                    (coalesce(h.cart_id, '') <> '' AND h.cart_id = o.platform_order_id AND o.order_date <= h.hit_local + interval '7 days')
                                 OR (h.customer_id IS NOT NULL AND o.customer_id = h.customer_id AND o.order_date <= h.hit_local + interval '24 hours')
                               )
                    WHERE o.tenant_id = ? AND o.order_date >= ?
                      AND coalesce(o.platform_order_id, '') <> ''
                      AND coalesce(o.paid_amount, 0) > 0
                    ORDER BY o.id, h.product_id, (h.cart_id = o.platform_order_id) DESC, h.hit_local DESC
                )
                SELECT m.* FROM matched m
                WHERE NOT EXISTS (
                    SELECT 1 FROM foryou_events x
                    WHERE x.tenant_id = ? AND x.type = 'conversion'
                      AND x.platform_order_id = m.platform_order_id AND x.product_id = m.product_id
                )
            ", [$offsetH, $tid, $eventSince, $tid, $orderSince, $tid]);

            if (! $rows) {
                $this->line("tenant {$tid}: yeni eşleşme yok");

                continue;
            }
            foreach ($rows as $r) {
                $this->line(sprintf('tenant %d: sipariş %s → %.2f ₺ (ürün #%s, %s, %s)%s',
                    $tid, $r->platform_order_id, $r->item_total, $r->product_id, $r->mode ?: '-', $r->how, $dry ? ' [DRY]' : ''));
                $grand++;
                if ($dry) {
                    continue;
                }
                DB::table('foryou_events')->insert([
                    'tenant_id' => $tid,
                    'session_id' => $r->session_id,
                    'type' => 'conversion',
                    'mode' => $r->mode,
                    'source' => $r->how,
                    'product_id' => $r->product_id,
                    'value_num' => $r->item_total,
                    'platform_order_id' => $r->platform_order_id,
                    'is_test' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime($r->order_date) - $offsetH * 3600),
                ]);
            }
        }
        $this->info(($dry ? '[DRY] ' : '')."toplam yeni conversion: {$grand}");

        return self::SUCCESS;
    }
}
