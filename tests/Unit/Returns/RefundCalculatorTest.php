<?php

namespace Tests\Unit\Returns;

use App\Services\Returns\RefundCalculator;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class RefundCalculatorTest extends TestCase
{
    private RefundCalculator $calc;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calc = new RefundCalculator();
    }

    public function test_full_return_without_discount_sums_line_totals(): void
    {
        $order = [
            'currency' => 'TRY',
            'order_discount' => 0,
            'shipping_cost' => 25,
            'paid_amount' => 150,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 50, 'line_discount' => 0],
            ],
        ];

        $result = $this->calc->calculate($order, [
            ['line_id' => 'A', 'qty' => 1],
            ['line_id' => 'B', 'qty' => 1],
        ]);

        $this->assertSame(150.0, $result['items_refundable']);
        $this->assertSame(0.0, $result['shipping_refundable']); // kural kapalı
        $this->assertSame(150.0, $result['total_refundable']);
        $this->assertTrue($result['breakdown']['full_return']);
        $this->assertFalse($result['capped']);
    }

    public function test_order_level_coupon_is_distributed_proportionally(): void
    {
        $order = [
            'order_discount' => 40,   // kupon
            'paid_amount' => 360,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 300, 'line_discount' => 0],
            ],
        ];

        $result = $this->calc->calculate($order, [
            ['line_id' => 'A', 'qty' => 1],
            ['line_id' => 'B', 'qty' => 1],
        ]);

        $lines = [];
        foreach ($result['lines'] as $line) {
            $lines[$line['line_id']] = $line;
        }
        $this->assertSame(90.0, $lines['A']['refundable']);   // 100 - (40*100/400)=10
        $this->assertSame(270.0, $lines['B']['refundable']);  // 300 - (40*300/400)=30
        $this->assertSame(360.0, $result['total_refundable']); // 400 - 40 kupon
    }

    public function test_partial_quantity_return(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 200,
            'items' => [
                ['line_id' => 'A', 'qty' => 2, 'unit_price' => 100, 'line_discount' => 0],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'A', 'qty' => 1]]);

        $this->assertSame(100.0, $result['total_refundable']);
        $this->assertFalse($result['breakdown']['full_return']);
    }

    public function test_shipping_refunded_only_on_full_return_when_rule_enabled(): void
    {
        $order = [
            'order_discount' => 0,
            'shipping_cost' => 30,
            'paid_amount' => 180,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 50, 'line_discount' => 0],
            ],
        ];

        // Tam iade + kargo kuralı açık → kargo dahil
        $full = $this->calc->calculate($order, [
            ['line_id' => 'A', 'qty' => 1],
            ['line_id' => 'B', 'qty' => 1],
        ], ['refund_shipping' => true]);
        $this->assertSame(30.0, $full['shipping_refundable']);
        $this->assertSame(180.0, $full['total_refundable']);

        // Kısmi iade → kargo iade edilmez (kural açık olsa bile)
        $partial = $this->calc->calculate($order, [
            ['line_id' => 'A', 'qty' => 1],
        ], ['refund_shipping' => true]);
        $this->assertSame(0.0, $partial['shipping_refundable']);
    }

    public function test_total_is_capped_at_paid_amount(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 360, // gerçekte ödenen
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 300, 'line_discount' => 0],
            ],
        ];

        // cap'i elle 300'e düşür → 400 hesaplanır ama 300'e sabitlenir
        $result = $this->calc->calculate($order, [
            ['line_id' => 'A', 'qty' => 1],
            ['line_id' => 'B', 'qty' => 1],
        ], ['cap' => 300]);

        $this->assertSame(300.0, $result['total_refundable']);
        $this->assertTrue($result['capped']);
        $this->assertNotEmpty($result['warnings']);
    }

    public function test_invalid_line_id_throws(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $order = [
            'items' => [['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0]],
        ];
        $this->calc->calculate($order, [['line_id' => 'ZZZ', 'qty' => 1]]);
    }

    public function test_returning_more_than_ordered_throws(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $order = [
            'items' => [['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0]],
        ];
        $this->calc->calculate($order, [['line_id' => 'A', 'qty' => 2]]);
    }

    public function test_line_discount_reduces_refund(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 80,
            'items' => [
                // 100 birim, 20 kalem indirimi → net 80
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 20],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'A', 'qty' => 1]]);
        $this->assertSame(80.0, $result['total_refundable']);
    }

    // ── SEPET KAMPANYASI TELAFİSİ (campaign_recovery) — Tonny Black "2. ürüne ekstra indirim" ──
    // Gerçek örnek TB1385967466: baz TBKMN320 649.97 (kampanyasız), TBTKLC030 499.96 ödendi
    // (kampanya payı 150.01). Baz iade edilirse kalan ürünün kampanyası pasifleşir → 649.97−150.01.

    /** Kampanyalı (indirimli) ürünün iadesi: ödediği tutar aynen iade, telafi YOK. */
    public function test_campaign_returning_discounted_item_refunds_paid_amount(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1149.93,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 649.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'KAMP', 'qty' => 1, 'unit_price' => 499.96, 'line_discount' => 0, 'campaign_discount_unit' => 150.01],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'KAMP', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertSame(499.96, $result['total_refundable']);
        $this->assertSame(0.0, $result['breakdown']['campaign_recovery']);
    }

    /** BAZ ürünün iadesi: kalan kampanyalı ürünün indirimi geri alınır (649.97 − 150.01). */
    public function test_campaign_returning_base_item_revokes_remaining_discount(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1149.93,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 649.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'KAMP', 'qty' => 1, 'unit_price' => 499.96, 'line_discount' => 0, 'campaign_discount_unit' => 150.01],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'BAZ', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertSame(499.96, $result['total_refundable']); // 649.97 − 150.01
        $this->assertSame(150.01, $result['breakdown']['campaign_recovery']);
        $this->assertSame(150.01, $result['lines'][0]['campaign_deduction']);
        $this->assertNotEmpty($result['warnings']);
    }

    /** 3 ürün (TB4239272196): baz iade → yalnız EN PAHALI kalan kampanyalının indirimi düşer. */
    public function test_campaign_three_items_revokes_only_most_expensive_remaining(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1369.90,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 714.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'K1', 'qty' => 1, 'unit_price' => 434.96, 'line_discount' => 0, 'campaign_discount_unit' => 130.51],
                ['line_id' => 'K2', 'qty' => 1, 'unit_price' => 219.97, 'line_discount' => 0, 'campaign_discount_unit' => 66.00],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'BAZ', 'qty' => 1]], ['campaign_recovery' => true]);

        // En pahalı kalan = K1 (434.96) → onun 130.51'i düşer; K2'nin 66'sı DÜŞMEZ.
        $this->assertSame(584.46, $result['total_refundable']); // 714.97 − 130.51
        $this->assertSame(130.51, $result['breakdown']['campaign_recovery']);
    }

    /** Baz + bir kampanyalı birlikte iade: kalan tek kampanyalının indirimi geri alınır. */
    public function test_campaign_base_plus_discounted_return_revokes_last_remaining(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1369.90,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 714.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'K1', 'qty' => 1, 'unit_price' => 434.96, 'line_discount' => 0, 'campaign_discount_unit' => 130.51],
                ['line_id' => 'K2', 'qty' => 1, 'unit_price' => 219.97, 'line_discount' => 0, 'campaign_discount_unit' => 66.00],
            ],
        ];

        $result = $this->calc->calculate($order, [
            ['line_id' => 'BAZ', 'qty' => 1],
            ['line_id' => 'K1', 'qty' => 1],
        ], ['campaign_recovery' => true]);

        // Kalan yalnız K2 → tek ürün kaldı, kampanyası pasif: 66.00 düşer.
        // İade: 714.97 + 434.96 − 66.00 = 1083.93; kesinti BAZ satırından yapılır.
        $this->assertSame(1083.93, $result['total_refundable']);
        $this->assertSame(66.0, $result['breakdown']['campaign_recovery']);
    }

    /** Yalnızca kampanyalı ürünler iade edilirse (baz sepette kalır) telafi uygulanmaz. */
    public function test_campaign_no_recovery_when_base_stays(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1369.90,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 714.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'K1', 'qty' => 1, 'unit_price' => 434.96, 'line_discount' => 0, 'campaign_discount_unit' => 130.51],
                ['line_id' => 'K2', 'qty' => 1, 'unit_price' => 219.97, 'line_discount' => 0, 'campaign_discount_unit' => 66.00],
            ],
        ];

        $result = $this->calc->calculate($order, [
            ['line_id' => 'K1', 'qty' => 1],
            ['line_id' => 'K2', 'qty' => 1],
        ], ['campaign_recovery' => true]);

        $this->assertSame(654.93, $result['total_refundable']); // 434.96 + 219.97
        $this->assertSame(0.0, $result['breakdown']['campaign_recovery']);
    }

    /** TAM iadede telafi uygulanmaz — müşteri her şeyi iade ediyor, ödediğinin tamamını alır. */
    public function test_campaign_full_return_skips_recovery(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1149.93,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 649.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'KAMP', 'qty' => 1, 'unit_price' => 499.96, 'line_discount' => 0, 'campaign_discount_unit' => 150.01],
            ],
        ];

        $result = $this->calc->calculate($order, [
            ['line_id' => 'BAZ', 'qty' => 1],
            ['line_id' => 'KAMP', 'qty' => 1],
        ], ['campaign_recovery' => true]);

        $this->assertSame(1149.93, $result['total_refundable']);
        $this->assertSame(0.0, $result['breakdown']['campaign_recovery']);
    }

    /** Kural KAPALIYKEN (varsayılan) davranış eskisi gibi — telafi yok. */
    public function test_campaign_recovery_disabled_keeps_old_behavior(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 1149.93,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 649.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'KAMP', 'qty' => 1, 'unit_price' => 499.96, 'line_discount' => 0, 'campaign_discount_unit' => 150.01],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'BAZ', 'qty' => 1]]);

        $this->assertSame(649.97, $result['total_refundable']);
        $this->assertSame(0.0, $result['breakdown']['campaign_recovery']);
    }

    /** Kupon (order_discount) orantılı dağıtımı telafiyle BİRLİKTE çalışır: önce kupon payı, sonra kesinti. */
    public function test_campaign_recovery_composes_with_coupon(): void
    {
        $order = [
            'order_discount' => 100,  // kupon — orantılı dağıtılır
            'paid_amount' => 1049.93,
            'items' => [
                ['line_id' => 'BAZ', 'qty' => 1, 'unit_price' => 649.97, 'line_discount' => 0, 'campaign_discount_unit' => 0],
                ['line_id' => 'KAMP', 'qty' => 1, 'unit_price' => 499.96, 'line_discount' => 0, 'campaign_discount_unit' => 150.01],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'BAZ', 'qty' => 1]], ['campaign_recovery' => true]);

        // Kupon payı (BAZ): 100 × 649.97/1149.93 = 56.52 → 649.97 − 56.52 = 593.45; − 150.01 = 443.44
        $this->assertSame(443.44, $result['total_refundable']);
        $this->assertSame(150.01, $result['breakdown']['campaign_recovery']);
    }

    /** Kampanyasız sipariş: kural açık olsa da hiçbir şey değişmez. */
    public function test_campaign_recovery_noop_without_campaign_items(): void
    {
        $order = [
            'order_discount' => 0,
            'paid_amount' => 150,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 100, 'line_discount' => 0],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 50, 'line_discount' => 0],
            ],
        ];

        $result = $this->calc->calculate($order, [['line_id' => 'A', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertSame(100.0, $result['total_refundable']);
        $this->assertSame(0.0, $result['breakdown']['campaign_recovery']);
    }

    /** 697419 benzeri: 2.599,85 sepette %5 kademe; ucuz ürün iade edilince kalan 2.199,90 < 2.500 → %5 geri alınır. */
    private function tierOrder(array $extra = []): array
    {
        return array_merge([
            'campaigns' => [['id' => 24, 'name' => '2.500 TL üzerine ek %5 İndirim', 'type' => 1]],
            'tiers' => [['id' => 24, 'name' => '2.500 TL üzerine ek %5 İndirim', 'pct' => 5.0, 'min' => 2500.0]],
            'order_discount' => 0, 'shipping_cost' => 0, 'paid_amount' => 2469.85,
            'items' => [
                ['line_id' => 'A1', 'qty' => 1, 'unit_price' => 1044.95, 'line_discount' => 0, 'sale_unit_price' => 1099.95, 'original_unit_price' => 2799.95, 'campaign_ids' => [24]],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 379.95, 'line_discount' => 0, 'sale_unit_price' => 399.95, 'original_unit_price' => 799.90, 'campaign_ids' => [24]],
                ['line_id' => 'A2', 'qty' => 1, 'unit_price' => 1044.95, 'line_discount' => 0, 'sale_unit_price' => 1099.95, 'original_unit_price' => 2799.95, 'campaign_ids' => [24]],
            ],
        ], $extra);
    }

    public function test_tier_recovery_when_basket_drops_below_threshold(): void
    {
        $r = $this->calc->calculate($this->tierOrder(), [['line_id' => 'B', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertSame(110.0, $r['breakdown']['tier_recovery']['amount']);
        $this->assertSame(269.95, $r['total_refundable']);
        $this->assertSame(2199.9, $r['breakdown']['tier_recovery']['basket_after']);
        $this->assertSame(20.0, $r['lines'][0]['explain']['tier_unit']);
        $this->assertSame(399.95, $r['lines'][0]['explain']['product_discount_unit']);
    }

    public function test_tier_kept_when_basket_stays_above_threshold(): void
    {
        $order = $this->tierOrder();
        $order['items'][] = ['line_id' => 'C', 'qty' => 1, 'unit_price' => 474.95, 'line_discount' => 0, 'sale_unit_price' => 499.95, 'campaign_ids' => [24]];
        $order['paid_amount'] = 2944.80;
        $r = $this->calc->calculate($order, [['line_id' => 'B', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertNull($r['breakdown']['tier_recovery']);
        $this->assertSame(379.95, $r['total_refundable']);
    }

    public function test_bogo_line_not_treated_as_legacy_campaign(): void
    {
        // 1+1 kalemleri kampanyalı (campaign_discount_unit>0); eski kural normal ürün iadesinde 1+1 indirimini kesiyordu
        $order = [
            'campaigns' => [['id' => 5, 'name' => '1 Alana 1 Bedava', 'type' => 2]], 'tiers' => [],
            'order_discount' => 0, 'shipping_cost' => 0, 'paid_amount' => 1599.91,
            'items' => [
                ['line_id' => 'N', 'qty' => 1, 'unit_price' => 599.95, 'line_discount' => 0, 'campaign_ids' => []],
                ['line_id' => 'F1', 'qty' => 1, 'unit_price' => 499.98, 'line_discount' => 0, 'campaign_discount_unit' => 499.98, 'campaign_ids' => [5]],
                ['line_id' => 'F2', 'qty' => 1, 'unit_price' => 499.98, 'line_discount' => 0, 'campaign_discount_unit' => 499.98, 'campaign_ids' => [5]],
            ],
        ];
        $r = $this->calc->calculate($order, [['line_id' => 'N', 'qty' => 1]], ['campaign_recovery' => true]);

        $this->assertSame(599.95, $r['total_refundable']);
        $this->assertSame(0.0, $r['breakdown']['campaign_recovery']);
    }

    private function eraTiers(): array
    {
        // Bugünkü tanım: hepsi %5 (üst üste). Ad: tekil dönem oranı.
        return [
            ['id' => 24, 'name' => '2.500 TL üzerine ek %5 İndirim', 'pct' => 5.0, 'name_pct' => 5.0, 'min' => 2500.0],
            ['id' => 25, 'name' => '5.000 TL üzerine ek %10 İndirim', 'pct' => 5.0, 'name_pct' => 10.0, 'min' => 5000.0],
        ];
    }

    /** 9 Eki öncesi tekil düzen: kalemde yalnız #25 (%10). İade sonrası 3.000 TL → %5 kademesine iner. */
    public function test_exclusive_era_drops_to_lower_tier(): void
    {
        $order = [
            'campaigns' => [['id' => 25, 'name' => '5.000 TL üzerine ek %10 İndirim', 'type' => 1]], 'tiers' => $this->eraTiers(),
            'order_discount' => 0, 'shipping_cost' => 0, 'paid_amount' => 5400.0,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 2700.0, 'line_discount' => 0, 'sale_unit_price' => 3000.0, 'campaign_ids' => [25]],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 2700.0, 'line_discount' => 0, 'sale_unit_price' => 3000.0, 'campaign_ids' => [25]],
            ],
        ];
        $r = $this->calc->calculate($order, [['line_id' => 'B', 'qty' => 1]], ['campaign_recovery' => true]);

        // kalan A: %10 yerine %5 → 2.850; fark 150
        $this->assertSame(150.0, $r['breakdown']['tier_recovery']['amount']);
        $this->assertSame(2550.0, $r['total_refundable']);
        $this->assertSame(5.0, $r['breakdown']['tier_recovery']['new_rate']);
        $this->assertSame(10.0, $r['lines'][0]['explain']['tier_rate']);
    }

    /** 9 Eki 20:29–23:06: #24 %5 + #25 %10 üst üste (%14,5). Kalan 3.000 → #25 kaybı, #24 kalır. */
    public function test_stacked_era_with_old_rate_removes_only_lost_tier(): void
    {
        $order = [
            'campaigns' => [['id' => 25, 'name' => '', 'type' => 1], ['id' => 24, 'name' => '', 'type' => 1]], 'tiers' => $this->eraTiers(),
            'order_discount' => 0, 'shipping_cost' => 0, 'paid_amount' => 5130.0,
            'items' => [
                ['line_id' => 'A', 'qty' => 1, 'unit_price' => 2565.0, 'line_discount' => 0, 'sale_unit_price' => 3000.0, 'campaign_ids' => [25, 24]],
                ['line_id' => 'B', 'qty' => 1, 'unit_price' => 2565.0, 'line_discount' => 0, 'sale_unit_price' => 3000.0, 'campaign_ids' => [25, 24]],
            ],
        ];
        $r = $this->calc->calculate($order, [['line_id' => 'B', 'qty' => 1]], ['campaign_recovery' => true]);

        // kalan A: %14,5 → %5 = 2.850; fark 285
        $this->assertSame(285.0, $r['breakdown']['tier_recovery']['amount']);
        $this->assertSame(2280.0, $r['total_refundable']);
    }
}
