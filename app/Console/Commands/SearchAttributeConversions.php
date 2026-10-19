<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Sunucu-taraflı arama→satış atıfı.
 *
 * Ticimax'ın yeni checkout'u (checkout-ui.prod.ticimax.net) tema script'lerini
 * yüklemediğinden widget'ın client-side purchase yakalaması yapısal olarak çalışamaz.
 * Bu komut atıfı sunucuda yapar: arama tıklaması (IP + ürün) ile senkronlanan
 * siparişleri eşleştirir — aynı IP, tıklanan ürün siparişte, tıklamadan sonraki
 * attribution penceresi (24s) içinde. Eşleşen sipariş search_events'e
 * type=conversion olarak yazılır (platform_order_id ile dedup, sipariş başına 1).
 *
 * Saat dilimi: search_queries/search_events created_at=UTC, orders.order_date=TR(+3).
 * Karşılaştırma tıklama saatine offset eklenerek yapılır; conversion'ın created_at'i
 * sipariş anının UTC karşılığıdır (analitik tarih filtreleri arama verisiyle hizalı).
 */
class SearchAttributeConversions extends Command
{
    protected $signature = 'search:attribute-conversions
        {--tenant= : Yalnız bu tenant (boş = tıklama verisi olan tüm tenantlar)}
        {--days=2 : Kaç günlük sipariş taransın}
        {--dry : Yazma, yalnız raporla}';

    protected $description = 'Arama tıklamalarını siparişlerle eşleştirip search_events\'e conversion yazar (IP + ürün + 24s)';

    public function handle(): int
    {
        $days = max(1, min(90, (int) $this->option('days')));
        $windowH = (int) config('search.attribution.window_hours', 24);
        $offsetH = (int) config('search.attribution.order_tz_offset_hours', 3);
        $dry = (bool) $this->option('dry');

        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : DB::table('search_events')->where('type', 'click')->where('is_test', false)
                ->distinct()->pluck('tenant_id')->all();

        $grandNew = 0;
        foreach ($tenantIds as $tid) {
            // Daha önce atfedilmiş ama artık GERÇEK SATIŞ olmayan siparişlerin conversion'ını düş:
            //   - paid_amount<=0 (ödeme onaylanmamış/başarısız — "Siparişiniz Alındı" hayaleti).
            // İptal (status=8) ve iade statüleri BİLEREK silinmez (kullanıcı kararı 2026-07-11):
            // parası tahsil edilmiş sipariş gerçekleşmiş satıştır; iptal/iade sonraki, ayrı olaydır.
            // Ticimax'ta status=0 siparişlerin ~%99'u ödenmemiştir; ödeme sonradan onaylanırsa
            // (paid>0) bir sonraki koşuda yeniden atfedilir (idempotent, kendini onarır).
            if (! $dry) {
                $voided = DB::delete("
                    DELETE FROM search_events e USING orders o
                    WHERE e.tenant_id = ? AND e.type = 'conversion'
                      AND o.tenant_id = e.tenant_id AND o.platform_order_id = e.platform_order_id
                      AND coalesce(o.paid_amount, 0) <= 0
                ", [$tid]);
                if ($voided > 0) {
                    $this->line("tenant {$tid}: {$voided} conversion silindi (ödenmemiş sipariş)");
                }
            }
            // Sipariş penceresi TR saatiyle; tıklamalar sipariş penceresinden window kadar geriye uzanır
            $orderSince = now()->addHours($offsetH)->subDays($days)->format('Y-m-d H:i:s');
            $clickSince = now()->subDays($days)->subHours($windowH)->format('Y-m-d H:i:s');

            $rows = DB::select("
                WITH clicks AS (
                    SELECT se.product_id, se.session_id, se.search_query_id,
                           se.created_at + make_interval(hours => ?) AS click_local,
                           sq.ip_address, se.cart_id
                    FROM search_events se
                    JOIN search_queries sq ON sq.id = se.search_query_id
                    WHERE se.tenant_id = ? AND se.is_test = false AND se.type = 'click'
                      AND se.product_id IS NOT NULL
                      AND (coalesce(sq.ip_address, '') <> '' OR coalesce(se.cart_id, '') <> '')
                      AND se.created_at >= ?
                ),
                matched AS (
                    SELECT DISTINCT ON (o.id)
                           o.platform_order_id, o.total_amount, o.customer_id, o.order_date,
                           c.search_query_id, c.product_id, c.session_id
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    JOIN clicks c ON oi.product_id = c.product_id
                                 AND o.order_date >= c.click_local - interval '5 minutes'
                                 AND (
                                      -- IP + pencere (Ticimax)
                                      (coalesce(c.ip_address, '') <> '' AND c.ip_address = o.ip_address
                                       AND o.order_date <= c.click_local + make_interval(hours => ?))
                                      -- sepet kimliği = sipariş kimliği (ikas; IP yok) — 7 gün
                                   OR (coalesce(c.cart_id, '') <> '' AND c.cart_id = o.platform_order_id
                                       AND o.order_date <= c.click_local + interval '7 days')
                                 )
                    WHERE o.tenant_id = ? AND o.order_date >= ?
                      AND coalesce(o.platform_order_id, '') <> ''
                      AND coalesce(o.paid_amount, 0) > 0 -- yalnız ödemesi tahsil edilmiş GERÇEK satış (iptal/iade de sayılır — para ödenmişse satış gerçekleşmiştir)
                    ORDER BY o.id, c.click_local DESC -- siparişe en yakın (son) tıklama atfedilir
                )
                SELECT m.* FROM matched m
                WHERE NOT EXISTS (
                    SELECT 1 FROM search_events x
                    WHERE x.tenant_id = ? AND x.type = 'conversion'
                      AND x.platform_order_id = m.platform_order_id
                )
            ", [$offsetH, $tid, $clickSince, $windowH, $tid, $orderSince, $tid]);

            if (! $rows) {
                $this->line("tenant {$tid}: yeni eşleşme yok");
                continue;
            }

            foreach ($rows as $r) {
                $this->line(sprintf('tenant %d: sipariş %s → %.2f ₺ (query #%s, ürün #%s)%s',
                    $tid, $r->platform_order_id, $r->total_amount,
                    $r->search_query_id, $r->product_id, $dry ? ' [DRY]' : ''));
                if ($dry) {
                    $grandNew++;

                    continue;
                }
                DB::table('search_events')->insert([
                    'tenant_id' => $tid,
                    'search_query_id' => $r->search_query_id,
                    'product_id' => $r->product_id,
                    'type' => 'conversion',
                    'value' => $r->total_amount,
                    'platform_order_id' => $r->platform_order_id,
                    'session_id' => $r->session_id,
                    'customer_id' => $r->customer_id,
                    'is_test' => false,
                    // sipariş anı UTC'ye çevrilir ki arama verisiyle aynı eksende filtrelensin
                    'created_at' => date('Y-m-d H:i:s', strtotime($r->order_date) - $offsetH * 3600),
                    'updated_at' => now()->format('Y-m-d H:i:s'),
                ]);
                $grandNew++;
            }
        }

        $this->info(($dry ? '[DRY] ' : '')."toplam yeni conversion: {$grandNew}");

        return self::SUCCESS;
    }
}
