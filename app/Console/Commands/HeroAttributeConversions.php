<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * "Bugüne Özel" Hero Ürün kulakçığı → satış atıfı (sunucu tarafı).
 * search:attribute-conversions ile aynı desen: çekmecedeki ürün tıklaması/sepete ekleme (IP + ürün)
 * ↔ 24 saat içinde aynı IP'den gelen, o ürünü içeren ÖDENMİŞ sipariş. hero_events'e type=conversion
 * (platform_order_id ile dedup, sipariş başına 1). created_at = sipariş anının UTC karşılığı.
 */
class HeroAttributeConversions extends Command
{
    protected $signature = 'hero:attribute-conversions
        {--tenant= : Yalnız bu tenant}
        {--days=2 : Kaç günlük sipariş taransın}
        {--dry : Yazma, yalnız raporla}';

    protected $description = 'Hero kulakçığı tıklama/sepet olaylarını siparişlerle eşleştirip hero_events\'e conversion yazar (IP + ürün + 24s)';

    public function handle(): int
    {
        $days = max(1, min(90, (int) $this->option('days')));
        $windowH = (int) config('search.attribution.window_hours', 24);
        $offsetH = (int) config('search.attribution.order_tz_offset_hours', 3);
        $dry = (bool) $this->option('dry');

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('hero_events')->whereIn('type', ['click', 'atc'])->where('is_test', false)->distinct()->pluck('tenant_id')->all();

        $grandNew = 0;
        foreach ($tenantIds as $tid) {
            if (! $dry) {
                $voided = DB::delete("
                    DELETE FROM hero_events e USING orders o
                    WHERE e.tenant_id = ? AND e.type = 'conversion'
                      AND o.tenant_id = e.tenant_id AND o.platform_order_id = e.platform_order_id
                      AND coalesce(o.paid_amount, 0) <= 0
                ", [$tid]);
                if ($voided > 0) {
                    $this->line("tenant {$tid}: {$voided} conversion silindi (ödenmemiş sipariş)");
                }
            }
            $orderSince = now()->addHours($offsetH)->subDays($days)->format('Y-m-d H:i:s');
            $clickSince = now()->subDays($days)->subHours($windowH)->format('Y-m-d H:i:s');

            $rows = DB::select("
                WITH clicks AS (
                    SELECT e.product_id, e.session_id, e.set_id, e.ip_address,
                           e.created_at + make_interval(hours => ?) AS click_local
                    FROM hero_events e
                    WHERE e.tenant_id = ? AND e.is_test = false AND e.type IN ('click','atc')
                      AND e.product_id IS NOT NULL AND coalesce(e.ip_address, '') <> ''
                      AND e.created_at >= ?
                ),
                matched AS (
                    SELECT DISTINCT ON (o.id)
                           o.platform_order_id, o.total_amount, o.order_date,
                           c.product_id, c.session_id, c.set_id
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    JOIN clicks c ON c.ip_address = o.ip_address
                                 AND oi.product_id = c.product_id
                                 AND o.order_date >= c.click_local
                                 AND o.order_date <= c.click_local + make_interval(hours => ?)
                    WHERE o.tenant_id = ? AND o.order_date >= ?
                      AND coalesce(o.platform_order_id, '') <> ''
                      AND coalesce(o.paid_amount, 0) > 0
                    ORDER BY o.id, c.click_local DESC
                )
                SELECT m.* FROM matched m
                WHERE NOT EXISTS (
                    SELECT 1 FROM hero_events x
                    WHERE x.tenant_id = ? AND x.type = 'conversion' AND x.platform_order_id = m.platform_order_id
                )
            ", [$offsetH, $tid, $clickSince, $windowH, $tid, $orderSince, $tid]);

            if (! $rows) {
                $this->line("tenant {$tid}: yeni eşleşme yok");

                continue;
            }
            foreach ($rows as $r) {
                $this->line(sprintf('tenant %d: sipariş %s → %.2f ₺ (ürün #%s, set %s)%s', $tid, $r->platform_order_id, $r->total_amount, $r->product_id, $r->set_id, $dry ? ' [DRY]' : ''));
                if ($dry) {
                    $grandNew++;

                    continue;
                }
                DB::table('hero_events')->insert([
                    'tenant_id' => $tid,
                    'session_id' => $r->session_id,
                    'type' => 'conversion',
                    'set_id' => $r->set_id,
                    'product_id' => $r->product_id,
                    'value_num' => $r->total_amount,
                    'platform_order_id' => $r->platform_order_id,
                    'is_test' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime($r->order_date) - $offsetH * 3600),
                ]);
                $grandNew++;
            }
        }
        $this->info(($dry ? '[DRY] ' : '')."toplam yeni conversion: {$grandNew}");

        return self::SUCCESS;
    }
}
