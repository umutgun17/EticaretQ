<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Sepet Önerisi → satış atıfı (SearchAttributeConversions deseni).
 *
 * Ticimax checkout SPA'sı tema script'lerini yüklemediğinden client-side purchase
 * yakalanamaz; atıf sunucuda yapılır: öneri etkileşimi (click veya atc — IP + ürün)
 * ile senkronlanan siparişler eşleştirilir. Aynı IP, önerilen ürün siparişte,
 * etkileşimden sonraki 24 saat içinde → rec_events'e type=conversion yazılır
 * (platform_order_id dedup, sipariş başına 1; value = KALEM tutarı — önerinin
 * getirdiği ek ciroyu ölçtüğümüz için sipariş toplamı değil, önerilen ürünün
 * kalem tutarı sayılır).
 *
 * Saat dilimi: rec_events.created_at=UTC, orders.order_date=TR(+3).
 */
class RecAttributeConversions extends Command
{
    protected $signature = 'rec:attribute-conversions
        {--tenant= : Yalnız bu tenant (boş = etkileşim verisi olan tüm tenantlar)}
        {--days=2 : Kaç günlük sipariş taransın}
        {--dry : Yazma, yalnız raporla}';

    protected $description = 'Sepet önerisi tıklama/ekleme olaylarını siparişlerle eşleştirip rec_events\'e conversion yazar';

    public function handle(): int
    {
        $days = max(1, min(90, (int) $this->option('days')));
        $windowH = (int) config('rec.attribution.window_hours', 24);
        $offsetH = (int) config('rec.attribution.order_tz_offset_hours', 3);
        $dry = (bool) $this->option('dry');

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('rec_events')->whereIn('type', ['click', 'atc'])->where('is_test', false)
                ->distinct()->pluck('tenant_id')->all();

        $grandNew = 0;
        foreach ($tenantIds as $tid) {
            // Ödemesi düşmüş (paid<=0) siparişlerin conversion'ını geri al — kendini onarır
            if (! $dry) {
                $voided = DB::delete("
                    DELETE FROM rec_events e USING orders o
                    WHERE e.tenant_id = ? AND e.type = 'conversion'
                      AND o.tenant_id = e.tenant_id AND o.platform_order_id = e.platform_order_id
                      AND coalesce(o.paid_amount, 0) <= 0
                ", [$tid]);
                if ($voided > 0) {
                    $this->line("tenant {$tid}: {$voided} conversion silindi (ödenmemiş sipariş)");
                }
            }

            $orderSince = now()->addHours($offsetH)->subDays($days)->format('Y-m-d H:i:s');

            // 1) KESİN atıf: "Sana Özel Teklif" kuponu siparişte kullanıldıysa (orders.coupon_code)
            $couponRows = DB::select("
                SELECT ro.id AS offer_id, ro.product_id, ro.session_id, ro.customer_id, ro.coupon_code,
                       o.platform_order_id, o.customer_id AS order_customer_id, o.order_date, o.discount_amount,
                       coalesce((SELECT sum(oi.total_price) FROM order_items oi
                                  WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id AND oi.product_id = ro.product_id), 0) AS item_total
                FROM rec_offers ro
                JOIN orders o ON o.tenant_id = ro.tenant_id
                             AND upper(coalesce(o.coupon_code, '')) = upper(ro.coupon_code)
                             AND o.order_date >= ro.created_at + make_interval(hours => ?) - interval '5 minutes'
                WHERE ro.tenant_id = ? AND ro.is_test = false AND ro.mode = 'coupon'
                  AND coalesce(ro.coupon_code, '') <> '' AND ro.status = 'issued'
                  AND coalesce(o.platform_order_id, '') <> '' AND coalesce(o.paid_amount, 0) > 0
                  AND o.order_date >= ?
            ", [$offsetH, $tid, $orderSince]);
            foreach ($couponRows as $c) {
                $this->line(sprintf('tenant %d: KUPON %s → sipariş %s (%.2f ₺ ürün, %.2f ₺ indirim)%s',
                    $tid, $c->coupon_code, $c->platform_order_id, $c->item_total, $c->discount_amount, $dry ? ' [DRY]' : ''));
                $grandNew++;
                if ($dry) {
                    continue;
                }
                DB::table('rec_offers')->where('id', $c->offer_id)->update([
                    'status' => 'converted', 'platform_order_id' => $c->platform_order_id,
                    'order_value' => $c->item_total, 'updated_at' => now(),
                ]);
                $exists = DB::table('rec_events')->where('tenant_id', $tid)->where('type', 'conversion')
                    ->where('platform_order_id', $c->platform_order_id)->where('product_id', $c->product_id)->exists();
                if (! $exists) {
                    DB::table('rec_events')->insert([
                        'tenant_id' => $tid, 'type' => 'conversion', 'surface' => 'checkout',
                        'product_id' => $c->product_id, 'source_product_id' => null,
                        'session_id' => $c->session_id, 'customer_id' => $c->customer_id ?: $c->order_customer_id,
                        'value' => $c->item_total, 'platform_order_id' => $c->platform_order_id, 'is_test' => false,
                        'created_at' => date('Y-m-d H:i:s', strtotime($c->order_date) - $offsetH * 3600), 'updated_at' => now(),
                    ]);
                }
            }
            // Süresi dolmuş, kullanılmamış kuponlar → expired (raporda ayrışsın)
            if (! $dry) {
                DB::table('rec_offers')->where('tenant_id', $tid)->where('status', 'issued')
                    ->whereNotNull('expires_at')->where('expires_at', '<', now()->subHours(2))->update(['status' => 'expired', 'updated_at' => now()]);
            }

            // 2) IP + ürün + 24s penceresi (mevcut yöntem)
            $eventSince = now()->subDays($days)->subHours($windowH)->format('Y-m-d H:i:s');

            $rows = DB::select("
                WITH hits AS (
                    SELECT re.id AS event_id, re.product_id, re.source_product_id, re.session_id, re.customer_id,
                           re.surface,
                           re.created_at + make_interval(hours => ?) AS hit_local,
                           re.ip_address
                    FROM rec_events re
                    WHERE re.tenant_id = ? AND re.is_test = false AND re.type IN ('click', 'atc')
                      AND re.product_id IS NOT NULL AND coalesce(re.ip_address, '') <> ''
                      AND re.created_at >= ?
                ),
                matched AS (
                    SELECT DISTINCT ON (o.id, h.product_id)
                           o.platform_order_id, o.customer_id AS order_customer_id, o.order_date,
                           oi.total_price AS item_total,
                           h.product_id, h.source_product_id, h.session_id, h.customer_id, h.surface
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    JOIN hits h ON h.ip_address = o.ip_address
                               AND oi.product_id = h.product_id
                               AND o.order_date >= h.hit_local
                               AND o.order_date <= h.hit_local + make_interval(hours => ?)
                    WHERE o.tenant_id = ? AND o.order_date >= ?
                      AND coalesce(o.platform_order_id, '') <> ''
                      AND coalesce(o.paid_amount, 0) > 0
                    ORDER BY o.id, h.product_id, h.hit_local DESC
                )
                SELECT m.* FROM matched m
                WHERE NOT EXISTS (
                    SELECT 1 FROM rec_events x
                    WHERE x.tenant_id = ? AND x.type = 'conversion'
                      AND x.platform_order_id = m.platform_order_id
                      AND x.product_id = m.product_id
                )
            ", [$offsetH, $tid, $eventSince, $windowH, $tid, $orderSince, $tid]);

            if (! $rows) {
                $this->line("tenant {$tid}: yeni eşleşme yok");

                continue;
            }

            foreach ($rows as $r) {
                $this->line(sprintf('tenant %d: sipariş %s → %.2f ₺ (önerilen ürün #%s, kaynak #%s)%s',
                    $tid, $r->platform_order_id, $r->item_total,
                    $r->product_id, $r->source_product_id ?: '-', $dry ? ' [DRY]' : ''));
                $grandNew++;
                if ($dry) {
                    continue;
                }
                DB::table('rec_events')->insert([
                    'tenant_id' => $tid,
                    'type' => 'conversion',
                    'surface' => $r->surface ?: 'atc',
                    'product_id' => $r->product_id,
                    'source_product_id' => $r->source_product_id,
                    'session_id' => $r->session_id,
                    'customer_id' => $r->customer_id ?: $r->order_customer_id,
                    'value' => $r->item_total,
                    'platform_order_id' => $r->platform_order_id,
                    'is_test' => false,
                    // created_at = sipariş anının UTC karşılığı (analitik filtreleri hizalı)
                    'created_at' => date('Y-m-d H:i:s', strtotime($r->order_date) - $offsetH * 3600),
                    'updated_at' => now(),
                ]);
            }
        }

        $this->info("Toplam yeni conversion: {$grandNew}".($dry ? ' [DRY]' : ''));

        return self::SUCCESS;
    }
}
