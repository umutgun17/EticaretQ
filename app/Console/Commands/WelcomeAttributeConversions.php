<?php

namespace App\Console\Commands;

use App\Services\Welcome\TenantWelcomeSettings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * "Hoş geldin" hediyesi → satış atıfı.
 * 1) KESİN: ölçüm başlangıcından sonra hoş geldin kuponuyla verilen ödenmiş sipariş (orders.coupon_code) → conversion (source=coupon).
 * 2) YEDEK: kartı gören/kodu açan oturumun sepet kimliği (ikas: sepet id = sipariş id) ile 7 gün içinde kuponsuz sipariş → source=cart.
 * Sipariş başına 1; ödemesi düşenler geri alınır. created_at = sipariş anının UTC karşılığı.
 */
class WelcomeAttributeConversions extends Command
{
    protected $signature = 'welcome:attribute-conversions
        {--tenant= : Yalnız bu tenant}
        {--days=3 : Kaç günlük sipariş taransın}
        {--dry : Yazma, yalnız raporla}';

    protected $description = 'Hoş geldin kuponlu siparişleri ve kartı gören sepetlerin siparişlerini welcome_events\'e conversion olarak yazar';

    public function handle(): int
    {
        $days = max(1, min(365, (int) $this->option('days')));
        $offsetH = (int) config('rec.attribution.order_tz_offset_hours', 3);
        $dry = (bool) $this->option('dry');

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('tenants')->where('is_active', true)->whereRaw("coalesce(settings->>'welcome_enabled','') IN ('1','true')")->pluck('id')->all();

        $grand = 0;
        foreach ($tenantIds as $tid) {
            $r = TenantWelcomeSettings::get($tid)['rules'];
            $code = strtoupper($r['code']);
            $startedAt = $r['started_at'] ?: null;
            if (! $dry) {
                $voided = DB::delete("
                    DELETE FROM welcome_events e USING orders o
                    WHERE e.tenant_id = ? AND e.type = 'conversion'
                      AND o.tenant_id = e.tenant_id AND o.platform_order_id = e.platform_order_id
                      AND coalesce(o.paid_amount, 0) <= 0
                ", [$tid]);
                if ($voided > 0) {
                    $this->line("tenant {$tid}: {$voided} conversion silindi (ödenmemiş sipariş)");
                }
            }
            $orderSince = now()->addHours($offsetH)->subDays($days)->format('Y-m-d H:i:s');
            if ($startedAt && $startedAt > $orderSince) {
                $orderSince = date('Y-m-d H:i:s', strtotime($startedAt) + $offsetH * 3600);
            }

            // 1) Kuponlu siparişler
            $rows = DB::select("
                SELECT o.platform_order_id, o.order_date, o.total_amount, o.discount_amount, o.customer_id,
                       (SELECT e.session_id FROM welcome_events e WHERE e.tenant_id = o.tenant_id AND e.cart_id = o.platform_order_id AND e.is_test = false ORDER BY e.id DESC LIMIT 1) AS session_id
                FROM orders o
                WHERE o.tenant_id = ? AND o.order_date >= ? AND coalesce(o.paid_amount, 0) > 0
                  AND upper(coalesce(o.coupon_code, '')) = ? AND coalesce(o.platform_order_id, '') <> ''
                  AND NOT EXISTS (SELECT 1 FROM welcome_events x WHERE x.tenant_id = o.tenant_id AND x.type = 'conversion' AND x.platform_order_id = o.platform_order_id)
            ", [$tid, $orderSince, $code]);
            // 2) Kartı gören sepetin kuponsuz siparişi (7 gün)
            $rows2 = DB::select("
                SELECT DISTINCT ON (o.id) o.platform_order_id, o.order_date, o.total_amount, o.discount_amount, o.customer_id, e.session_id
                FROM welcome_events e
                JOIN orders o ON o.tenant_id = e.tenant_id AND o.platform_order_id = e.cart_id
                WHERE e.tenant_id = ? AND e.is_test = false AND e.type IN ('view', 'reveal', 'copy', 'remind')
                  AND coalesce(e.cart_id, '') <> '' AND e.created_at >= ?
                  AND o.order_date >= ? AND coalesce(o.paid_amount, 0) > 0
                  AND o.order_date <= e.created_at + make_interval(hours => ?) + interval '7 days'
                  AND upper(coalesce(o.coupon_code, '')) <> ?
                  AND NOT EXISTS (SELECT 1 FROM welcome_events x WHERE x.tenant_id = o.tenant_id AND x.type = 'conversion' AND x.platform_order_id = o.platform_order_id)
                ORDER BY o.id, e.id DESC
            ", [$tid, now()->subDays($days + 7)->format('Y-m-d H:i:s'), $orderSince, $offsetH, $code]);

            foreach ([['coupon', $rows], ['cart', $rows2]] as [$how, $list]) {
                foreach ($list as $o) {
                    $this->line(sprintf('tenant %d: sipariş %s → %.2f ₺ (%s%s)%s', $tid, $o->platform_order_id, $o->total_amount, $how, $how === 'coupon' ? ' '.$code : '', $dry ? ' [DRY]' : ''));
                    $grand++;
                    if ($dry) {
                        continue;
                    }
                    DB::table('welcome_events')->insert([
                        'tenant_id' => $tid,
                        'session_id' => $o->session_id,
                        'type' => 'conversion',
                        'source' => $how,
                        'customer_id' => $o->customer_id,
                        'value' => $how === 'coupon' ? $code : null,
                        'value_num' => $o->total_amount,
                        'discount' => $how === 'coupon' ? ($o->discount_amount ?: round((float) $o->total_amount * $r['percent'] / (100 - $r['percent']), 2)) : null,
                        'platform_order_id' => $o->platform_order_id,
                        'is_test' => false,
                        'created_at' => date('Y-m-d H:i:s', strtotime($o->order_date) - $offsetH * 3600),
                    ]);
                }
            }
            if (! $rows && ! $rows2) {
                $this->line("tenant {$tid}: yeni eşleşme yok");
            }
        }
        $this->info(($dry ? '[DRY] ' : '')."toplam yeni conversion: {$grand}");

        return self::SUCCESS;
    }
}
