<?php

namespace App\Services\Returns;

use InvalidArgumentException;

/**
 * İade tutarı hesaplayıcı — PARA-KRİTİK, saf (DB'siz), tam test edilebilir.
 *
 * Tasarım ilkesi: Client'tan SADECE kalem (line_id) + adet gelir. Fiyat, indirim payı ve
 * iade tutarı burada, sunucu tarafında, sipariş canlı verisinden yeniden hesaplanır.
 *
 * İndirim mantığı:
 *  - Kalem düzeyi indirim (`line_discount`) doğrudan o kalemden düşülür.
 *  - Sipariş düzeyi indirim/kupon (`order_discount`) kalemlerin net değerine ORANTILI dağıtılır.
 *  - İade edilen birim başına etkin (indirim sonrası) tutar × iade adedi = kalem iade tutarı.
 *
 * Güvenlik:
 *  - Bilinmeyen line_id veya adet > mevcut adet → exception (suistimal işareti).
 *  - Negatif tutar → 0'a sabitlenir.
 *  - Toplam, `cap` (genelde ödenen tutar) ile sınırlanır.
 */
class RefundCalculator
{
    /**
     * @param  array  $order  Normalize sipariş:
     *   [
     *     'currency'         => 'TRY',
     *     'order_discount'   => float,   // sipariş düzeyi indirim/kupon (kalemlere yansımamış)
     *     'shipping_cost'    => float,
     *     'gift_card_amount' => float,   // bilgilendirme/breakdown
     *     'points_discount'  => float,   // bilgilendirme/breakdown
     *     'paid_amount'      => float,   // tavan (cap) varsayılanı
     *     'items' => [
     *       ['line_id'=>string|int, 'name'=>?string, 'sku'=>?string,
     *        'qty'=>int, 'unit_price'=>float /*KDV dahil birim*\/, 'line_discount'=>float,
     *        'qty_available'=>?int /*iade edilebilir kalan; yoksa qty*\/ ],
     *     ],
     *   ]
     * @param  array  $selections  [ ['line_id'=>, 'qty'=>], ... ]
     * @param  array  $options  [ 'refund_shipping'=>bool, 'cap'=>?float ]
     *
     * @return array{
     *   currency:string, lines:array, items_refundable:float, shipping_refundable:float,
     *   total_refundable:float, cap:float|null, capped:bool, breakdown:array, warnings:array
     * }
     */
    public function calculate(array $order, array $selections, array $options = []): array
    {
        $currency = $order['currency'] ?? 'TRY';
        $orderDiscount = max(0.0, (float) ($order['order_discount'] ?? 0));
        $shippingCost = max(0.0, (float) ($order['shipping_cost'] ?? 0));
        $items = $order['items'] ?? [];

        // VADE FARKI burada hesaba KATILMAZ: iade yalnızca ürün tutarını (satır fiyatları) kapsar.
        // Taksit/vade farkını ödeme kuruluşu (iyzico/PayTR) iade sırasında otomatik algılar/düşer.

        if (empty($items)) {
            throw new InvalidArgumentException('Sipariş kalemi bulunamadı.');
        }

        // Kalemleri line_id ile indeksle
        $byLine = [];
        $totalNet = 0.0;            // tüm siparişin net değeri (kalem indirimi sonrası)
        foreach ($items as $i => $it) {
            $lineId = (string) ($it['line_id'] ?? $i);
            $qty = (int) ($it['qty'] ?? 0);
            $unit = max(0.0, (float) ($it['unit_price'] ?? 0));
            $lineDiscount = max(0.0, (float) ($it['line_discount'] ?? 0));

            if ($qty <= 0) {
                continue;
            }

            $gross = $unit * $qty;
            $netLine = max(0.0, $gross - $lineDiscount);
            $totalNet += $netLine;

            $byLine[$lineId] = [
                'line_id' => $lineId,
                'name' => $it['name'] ?? null,
                'sku' => $it['sku'] ?? null,
                'qty' => $qty,
                'qty_available' => isset($it['qty_available']) ? (int) $it['qty_available'] : $qty,
                'unit_price' => $unit,
                'line_discount' => $lineDiscount,
                'net_line' => $netLine,
                // Sepet kampanyası birim payı (unit_price'a zaten yansımış; campaign_recovery girdisi)
                'campaign_discount_unit' => max(0.0, (float) ($it['campaign_discount_unit'] ?? 0)),
                // Açıklama/kademe girdileri (Ticimax normalizer'ı verir; yoksa açıklama üretilmez)
                'original_unit_price' => isset($it['original_unit_price']) ? (float) $it['original_unit_price'] : null,
                'sale_unit_price' => isset($it['sale_unit_price']) ? (float) $it['sale_unit_price'] : null,
                'campaign_ids' => array_map('intval', (array) ($it['campaign_ids'] ?? [])),
            ];
        }

        if ($totalNet <= 0) {
            throw new InvalidArgumentException('Sipariş net tutarı sıfır — iade hesaplanamaz.');
        }

        // Sipariş düzeyi indirimi (kupon) net değere orantılı dağıt → etkin birim fiyat
        $warnings = [];
        $lines = [];
        $itemsRefundable = 0.0;
        $fullReturn = true; // tüm kalemler tamamen mi seçildi?

        $requestedByLine = [];
        foreach ($selections as $sel) {
            $lineId = (string) ($sel['line_id'] ?? '');
            $qtyReq = (int) ($sel['qty'] ?? 0);
            if ($qtyReq <= 0) {
                continue;
            }
            if (! isset($byLine[$lineId])) {
                throw new InvalidArgumentException("Geçersiz kalem: {$lineId}");
            }
            $requestedByLine[$lineId] = ($requestedByLine[$lineId] ?? 0) + $qtyReq;
        }

        if (empty($requestedByLine)) {
            throw new InvalidArgumentException('İade için kalem seçilmedi.');
        }

        foreach ($byLine as $lineId => $row) {
            $qtyReq = $requestedByLine[$lineId] ?? 0;

            if ($qtyReq > $row['qty_available']) {
                throw new InvalidArgumentException(
                    "İade adedi mevcut adedi aşıyor (kalem {$lineId}): {$qtyReq} > {$row['qty_available']}"
                );
            }

            // Sipariş indirim payı (orantılı)
            $orderDiscountShare = $orderDiscount * ($row['net_line'] / $totalNet);
            $effectiveNetLine = max(0.0, $row['net_line'] - $orderDiscountShare);
            $effectiveUnit = $effectiveNetLine / $row['qty'];

            if ($qtyReq <= 0) {
                $fullReturn = false;
                continue;
            }
            if ($qtyReq < $row['qty_available']) {
                $fullReturn = false;
            }

            $refundable = round($effectiveUnit * $qtyReq, 2);
            // Bu kaleme atfedilen toplam indirim (bilgi/denetim)
            $discountShareForReturned = round(
                (($row['line_discount'] + $orderDiscountShare) / $row['qty']) * $qtyReq,
                2
            );

            $itemsRefundable += $refundable;

            $lines[] = [
                'line_id' => $lineId,
                'name' => $row['name'],
                'sku' => $row['sku'],
                'qty_returned' => $qtyReq,
                'unit_price' => round($row['unit_price'], 2),
                'effective_unit_price' => round($effectiveUnit, 2),
                'discount_share' => $discountShareForReturned,
                'refundable' => $refundable,
                'coupon_unit' => round($orderDiscountShare / $row['qty'], 2),
            ];
        }

        // Seçilmeyen kalem varsa tam iade değildir
        foreach ($byLine as $lineId => $row) {
            if (($requestedByLine[$lineId] ?? 0) < $row['qty_available']) {
                $fullReturn = false;
            }
        }

        $itemsRefundable = round($itemsRefundable, 2);

        // ── TAM İADE MUTABAKATI ──
        // Birim fiyatlar KDV dahil 2 ondalığa yuvarlandığı için satır toplamı ödenen tutardan
        // kuruş bazında sapabilir (örn. 989.94 vs 989.95). Tüm sipariş iade ediliyorsa, mal
        // bedelini ödenen tutara birebir sabitle: hedef = ödenen − kargo − (dışlanan vade farkı).
        // Yalnızca sapma küçükse (yuvarlama düzeyi) uygula; büyük fark gerçek tutarsızlık işaretidir.
        if ($fullReturn && ! empty($lines)) {
            $paid = round((float) ($order['paid_amount'] ?? ($options['cap'] ?? 0)), 2);
            // Hedef = ödenen − kargo (kargo satırda değil; vade farkı ödeme kuruluşunun işi).
            $targetItems = round($paid - $shippingCost, 2);
            $delta = round($targetItems - $itemsRefundable, 2);

            // Tolerans: satır başına ~1 kuruş yuvarlama + küçük tampon
            $tolerance = round(0.01 * count($lines) + 0.02, 2);
            if ($targetItems > 0 && abs($delta) <= $tolerance && abs($delta) > 0) {
                // Farkı en büyük iade tutarlı satıra ekle (kuruş kaymasını tek satıra topla)
                $maxIdx = 0;
                foreach ($lines as $idx => $l) {
                    if ($l['refundable'] > $lines[$maxIdx]['refundable']) {
                        $maxIdx = $idx;
                    }
                }
                $lines[$maxIdx]['refundable'] = round($lines[$maxIdx]['refundable'] + $delta, 2);
                $lines[$maxIdx]['reconciled'] = round($delta, 2);
                $itemsRefundable = $targetItems;
                $warnings[] = "Tam iade: mal bedeli ödenen tutara sabitlendi (yuvarlama farkı {$delta} en büyük satıra eklendi).";
            }
        }

        // ── SEPET KAMPANYASI TELAFİSİ (opsiyonel, tenant kuralı: campaign_discount_recovery) ──
        // Kampanya modeli: sepette 2+ ürün → 1 BAZ ürün tam fiyat, diğerleri kampanya indirimli
        // (kalem verisinde campaign_discount_unit > 0). Müşteri BAZ ürünü iade ederse kampanya
        // şartı bozulur: kalan en pahalı kampanyalı ürünün indirimi pasifleşir ve o tutar iade
        // tutarından düşülür (kullanıcı kararı 2026-08-03; örn. 649,97 iade − 150,01 = 499,96).
        // Kampanyalı ürün iadesi ile TAM iade etkilenmez; kupon orantısı/kargo kuralı aynen kalır.
        $campaignAdjustment = 0.0;
        $campaignRevokedFrom = null;
        $hasCampaignData = array_key_exists('campaigns', $order);
        if (($options['campaign_recovery'] ?? false) && ! $hasCampaignData && ! $fullReturn && ! empty($lines)) {
            // Birim havuzları: iade edilen / kalan (adet bazında aç)
            $returnedBaseUnits = 0;      // iade edilen kampanyasız (baz) birim sayısı
            $remaining = [];             // kalan birimler: [unit_price, campaign_unit, name]
            $orderHasCampaign = false;
            foreach ($byLine as $lineId => $row) {
                $campUnit = round($row['campaign_discount_unit'], 2);
                if ($campUnit > 0) {
                    $orderHasCampaign = true;
                }
                $qtyReq = $requestedByLine[$lineId] ?? 0;
                if ($campUnit <= 0) {
                    $returnedBaseUnits += $qtyReq;
                }
                for ($u = 0; $u < $row['qty_available'] - $qtyReq; $u++) {
                    $remaining[] = ['unit_price' => $row['unit_price'], 'campaign_unit' => $campUnit, 'name' => $row['name']];
                }
            }
            $remainingHasBase = (bool) array_filter($remaining, fn ($u) => $u['campaign_unit'] <= 0);

            // Telafi koşulu: siparişte kampanya var + BAZ ürün iade ediliyor + kalan birimlerin
            // hepsi kampanyalı (baz kalmadı) → kalan EN PAHALI kampanyalı birimin indirimi geri alınır.
            if ($orderHasCampaign && $returnedBaseUnits > 0 && $remaining && ! $remainingHasBase) {
                usort($remaining, fn ($a, $b) => $b['unit_price'] <=> $a['unit_price']);
                $revoked = $remaining[0];
                $campaignAdjustment = round($revoked['campaign_unit'], 2);
                $campaignRevokedFrom = $revoked['name'];

                // Kesintiyi İADE EDİLEN BAZ satır(lar)ın tutarından düş (en pahalıdan başla) —
                // kalem toplamı = talep tutarı denetim değişmezi korunur, taban 0.
                $order2 = array_keys($lines);
                usort($order2, fn ($a, $b) => $lines[$b]['refundable'] <=> $lines[$a]['refundable']);
                $left = $campaignAdjustment;
                foreach ($order2 as $idx) {
                    if ($left <= 0) {
                        break;
                    }
                    // Önce baz (kampanyasız) satırlardan kes; hepsi biterse diğerlerinden.
                    $isBase = round($byLine[$lines[$idx]['line_id']]['campaign_discount_unit'] ?? 0, 2) <= 0;
                    if (! $isBase) {
                        continue;
                    }
                    $cut = min($left, $lines[$idx]['refundable']);
                    $lines[$idx]['refundable'] = round($lines[$idx]['refundable'] - $cut, 2);
                    $lines[$idx]['campaign_deduction'] = round(($lines[$idx]['campaign_deduction'] ?? 0) + $cut, 2);
                    $left = round($left - $cut, 2);
                }
                if ($left > 0) { // baz satırlar yetmedi (uç durum) → kalan kesintiyi diğer satırlardan al
                    foreach ($order2 as $idx) {
                        if ($left <= 0) {
                            break;
                        }
                        $cut = min($left, $lines[$idx]['refundable']);
                        $lines[$idx]['refundable'] = round($lines[$idx]['refundable'] - $cut, 2);
                        $lines[$idx]['campaign_deduction'] = round(($lines[$idx]['campaign_deduction'] ?? 0) + $cut, 2);
                        $left = round($left - $cut, 2);
                    }
                }
                $applied = round($campaignAdjustment - max(0.0, $left), 2);
                $campaignAdjustment = $applied;
                $itemsRefundable = round($itemsRefundable - $applied, 2);
                $warnings[] = 'Kampanya şartı bozuldu: kalan üründeki ' . number_format($applied, 2, ',', '.')
                    . ' TL kampanya indirimi iade tutarından düşüldü'
                    . ($campaignRevokedFrom ? ' (' . $campaignRevokedFrom . ')' : '') . '.';
            }
        }

        // ── SEPET KADEMESİ GERİ ALIMI (campaign_recovery kuralı + Ticimax kampanya verisi) ──
        $tierRecovery = null;
        if (($options['campaign_recovery'] ?? false) && $hasCampaignData && ! $fullReturn && ! empty($lines)) {
            $tierRecovery = $this->tierRecovery($byLine, $requestedByLine, $order['tiers'] ?? [], $orderDiscount, $totalNet);
            if ($tierRecovery && $tierRecovery['amount'] > 0) {
                $applied = $this->deductFromLines($lines, $tierRecovery['amount']);
                $tierRecovery['amount'] = $applied;
                $campaignAdjustment = round($campaignAdjustment + $applied, 2);
                $itemsRefundable = round($itemsRefundable - $applied, 2);
                $warnings[] = $tierRecovery['message'];
            }
        }

        $tierCheck = $hasCampaignData ? $this->tierCheck($byLine, $requestedByLine, $order['tiers'] ?? [], $fullReturn, $tierRecovery) : null;

        // Kalem bazlı açıklama (panelde "bu tutar nasıl çıktı?"): liste → ürün indirimi →
        // ürün kampanyası (1+1) → sepet kademesi → ödenen → kupon payı → kademe düzeltmesi → iade.
        $tierIds = array_column($order['tiers'] ?? [], 'id');
        $tierInfo = $this->tierInfo($byLine, $order['tiers'] ?? []);
        foreach ($lines as &$l) {
            $row = $byLine[$l['line_id']];
            if ($row['sale_unit_price'] === null) {
                continue;
            }
            $paid = $row['unit_price'];
            $preTier = round($paid / $this->tierFactor($row['campaign_ids'], $order['tiers'] ?? [], $tierInfo, $l['line_id']), 2);
            $list = $row['original_unit_price'] ?? $row['sale_unit_price'];
            $hasProductCampaign = (bool) array_diff($row['campaign_ids'], $tierIds);
            if (! $hasProductCampaign) {
                $preTier = $row['sale_unit_price']; // yalnız kademe → satış − ödenen tamamen kademe payı (kuruş artığı yok)
            }
            $l['explain'] = [
                'list_unit' => round($list, 2),
                'product_discount_unit' => round(max(0, $list - $row['sale_unit_price']), 2),
                'campaign_unit' => $hasProductCampaign ? round(max(0, $row['sale_unit_price'] - $preTier), 2) : 0.0, // 1+1 vb.
                'tier_unit' => round(max(0, $preTier - $paid), 2),                             // sepet kademesi
                'paid_unit' => round($paid, 2),
                'coupon_unit' => $l['coupon_unit'],
                'campaign_names' => array_values(array_filter(array_map(
                    fn ($id) => collect($order['campaigns'] ?? [])->firstWhere('id', $id)['name'] ?? null,
                    $row['campaign_ids']
                ))),
                'has_tier' => (bool) array_intersect($row['campaign_ids'], $tierIds),
                'tier_rate' => round((1 - $tierInfo[$l['line_id']]['factor']) * 100, 1),
            ];
        }
        unset($l);

        // Kargo iadesi: yalnızca kural izin veriyorsa VE tam iade ise
        $refundShipping = (bool) ($options['refund_shipping'] ?? false);
        $shippingRefundable = ($refundShipping && $fullReturn) ? round($shippingCost, 2) : 0.0;

        $total = round($itemsRefundable + $shippingRefundable, 2);

        // Tavan: ödenen tutarı asla aşma
        $cap = array_key_exists('cap', $options) ? $options['cap'] : ($order['paid_amount'] ?? null);
        $cap = $cap !== null ? round((float) $cap, 2) : null;
        $capped = false;
        if ($cap !== null && $total > $cap) {
            $warnings[] = "Hesaplanan tutar ({$total}) ödenen tutarı ({$cap}) aştı; tavana sabitlendi.";
            $total = $cap;
            $capped = true;
        }
        $total = max(0.0, $total);

        return [
            'currency' => $currency,
            'lines' => $lines,
            'items_refundable' => $itemsRefundable,
            'shipping_refundable' => $shippingRefundable,
            'total_refundable' => $total,
            'cap' => $cap,
            'capped' => $capped,
            'breakdown' => [
                'order_discount' => round($orderDiscount, 2),
                'shipping_cost' => round($shippingCost, 2),
                'shipping_refunded' => $shippingRefundable > 0,
                'gift_card_amount' => round((float) ($order['gift_card_amount'] ?? 0), 2),
                'points_discount' => round((float) ($order['points_discount'] ?? 0), 2),
                'order_total_net' => round($totalNet, 2),
                'full_return' => $fullReturn,
                // Sepet kampanyası telafisi (0 = uygulanmadı): geri alınan indirim + hangi kalan üründen
                'campaign_recovery' => round($campaignAdjustment, 2),
                'campaign_revoked_from' => $campaignRevokedFrom,
                // Sepet kademesi geri alımı (null = uygulanmadı): tutar, iade öncesi/sonrası sepet,
                // kaybedilen ve korunan kademeler — müşteri ekranı + panel açıklaması bunu okur.
                'tier_recovery' => $tierRecovery && $tierRecovery['amount'] > 0 ? $tierRecovery : null,
                // Sepet indirimi kontrolü (kademe varsa her zaman): recovered | kept | unenforced | full_return
                'tier_check' => $tierCheck,
            ],
            'warnings' => $warnings,
        ];
    }

    /**
     * Kalemlerin GERÇEKTE uygulanmış kademe çarpanı ve kademe bazında oranları.
     *
     * Kademe ayarı zamanla değişti (Tonny: 9 Eki 23:06 öncesi tekil %5/%10/%15; sonrası üst üste
     * "ek %5"ler) → bugünkü tanım eski siparişe uymaz. Çarpan siparişin kendisinden okunur:
     * yalnız kademe kampanyalı kalemde ödenen ÷ kampanya öncesi satış fiyatı. 1+1 gibi başka
     * kampanyası da olan kalem aynı kademe setine sahip bir kardeş kalemden alır; o da yoksa tanım.
     * Tanımla tutmazsa fark kalemin en yüksek eşikli kademesine yazılır (20:29–23:06 %10+%5 dönemi).
     *
     * @return array<string, array{tiers:list<int>, factor:float, pct:array<int,float>}>  line_id → bilgi
     */
    private function tierInfo(array $byLine, array $tiers): array
    {
        $def = [];
        foreach ($tiers as $t) {
            $def[(int) $t['id']] = $t;
        }
        $bySet = [];
        $info = [];
        foreach ($byLine as $lineId => $row) {
            $set = array_values(array_filter($row['campaign_ids'], fn ($id) => isset($def[$id])));
            sort($set);
            $info[$lineId] = ['tiers' => $set, 'factor' => 1.0, 'pct' => []];
            $onlyTiers = ! array_diff($row['campaign_ids'], $set);
            if ($set && $onlyTiers && ($row['sale_unit_price'] ?? 0) > 0) {
                $f = $row['unit_price'] / $row['sale_unit_price'];
                if ($f > 0.5 && $f <= 1.0) {
                    $bySet[implode(',', $set)] = $f;
                }
            }
        }
        foreach ($info as $lineId => &$x) {
            if (! $x['tiers']) {
                continue;
            }
            $defFactor = array_reduce($x['tiers'], fn ($c, $id) => $c * (1 - (float) $def[$id]['pct'] / 100), 1.0);
            $f = $bySet[implode(',', $x['tiers'])] ?? $defFactor;
            $x['factor'] = $f;
            foreach ($x['tiers'] as $id) {
                $x['pct'][$id] = (float) $def[$id]['pct'];
            }
            if (abs($f - $defFactor) > 0.002) {
                $hi = collect($x['tiers'])->sortByDesc(fn ($id) => (float) $def[$id]['min'])->first();
                $others = array_reduce(array_diff($x['tiers'], [$hi]), fn ($c, $id) => $c * (1 - (float) $def[$id]['pct'] / 100), 1.0);
                $x['pct'][$hi] = round((1 - $f / $others) * 100, 4);
            }
        }
        unset($x);

        return $info;
    }

    /** Kalemde uygulanmış kademelerin çarpanı (açıklama için; tierInfo'dan). */
    private function tierFactor(array $campaignIds, array $tiers, ?array $info = null, ?string $lineId = null): float
    {
        if ($info !== null && $lineId !== null && isset($info[$lineId])) {
            return $info[$lineId]['factor'];
        }
        $f = 1.0;
        foreach ($tiers as $t) {
            if (in_array((int) $t['id'], $campaignIds, true)) {
                $f *= 1 - ((float) $t['pct']) / 100;
            }
        }

        return $f > 0 ? $f : 1.0;
    }

    /**
     * Kademe geri alımı: iade sonrası KALAN ürünlerin kademe öncesi toplamı bir eşiğin altına
     * düşerse kalan ürünler artık hak ettikleri kademeyle fiyatlanır, fark iadeden düşülür.
     *  - Üst üste (stacked) düzen: kaybedilen kademelerin oranı çarpandan çıkarılır.
     *  - Tekil (exclusive) düzen — sipariş birden çok eşiği geçtiği hâlde kalemde tek kademe var:
     *    kalan sepet hâlâ geçtiği en yüksek eşiğin oranını alır (ör. %10 → %5).
     * Yalnız geri alır (yeni kademe kazandırmaz). Kupon orantısı korunur.
     */
    private function tierRecovery(array $byLine, array $requested, array $tiers, float $orderDiscount, float $totalNet): ?array
    {
        if (! $tiers) {
            return null;
        }
        $def = [];
        foreach ($tiers as $t) {
            $def[(int) $t['id']] = $t;
        }
        $info = $this->tierInfo($byLine, $tiers);
        $baseBefore = 0.0;
        $baseAfter = 0.0;
        $remain = [];
        $exclusive = false;
        foreach ($byLine as $lineId => $row) {
            $pre = round($row['unit_price'] / $info[$lineId]['factor'], 2);
            $keep = $row['qty_available'] - ($requested[$lineId] ?? 0);
            $baseBefore += $pre * $row['qty_available'];
            $baseAfter += $pre * $keep;
            if ($keep > 0 && $info[$lineId]['tiers']) {
                $remain[] = ['row' => $row, 'pre' => $pre, 'keep' => $keep, 'info' => $info[$lineId]];
            }
        }
        // Siparişin kendisi eşiğin altında kademe almışsa eşik o an işlemiyordu → geri alınmaz
        foreach ($info as $x) {
            foreach ($x['tiers'] as $id) {
                if ($baseBefore + 0.005 < (float) $def[$id]['min']) {
                    $def[$id]['min'] = 0.0;
                }
            }
        }
        $qualBefore = array_keys(array_filter($def, fn ($t) => (float) $t['min'] <= $baseBefore + 0.005));
        $qualAfter = array_keys(array_filter($def, fn ($t) => (float) $t['min'] <= $baseAfter + 0.005));
        foreach ($info as $x) {
            if ($x['tiers'] && array_diff($qualBefore, $x['tiers'])) {
                $exclusive = true;
            }
        }

        $diff = 0.0;
        $lostIds = [];
        $oldPaid = 0.0;
        $newPaid = 0.0;
        $preSum = 0.0;
        foreach ($remain as $x) {
            $lost = array_values(array_diff($x['info']['tiers'], $qualAfter));
            if (! $lost) {
                continue;
            }
            $lostIds = array_merge($lostIds, $lost);
            if ($exclusive) {
                // en yüksek eşikli hâlâ geçerli kademe (tanımdaki oranıyla), yoksa indirimsiz
                $best = collect($qualAfter)->sortByDesc(fn ($id) => (float) $def[$id]['min'])->first();
                // tekil düzen döneminde adlar gerçek oranı gösteriyordu ("ek %10" = %10) → addaki oran
                $newFactor = $best !== null ? 1 - (float) ($def[$best]['name_pct'] ?? $def[$best]['pct']) / 100 : 1.0;
            } else {
                $newFactor = $x['info']['factor'];
                foreach ($lost as $id) {
                    $newFactor /= (1 - $x['info']['pct'][$id] / 100);
                }
            }
            if ($newFactor <= $x['info']['factor']) {
                continue;
            }
            $newUnit = round($x['pre'] * $newFactor, 2);
            $diff += ($newUnit - $x['row']['unit_price']) * $x['keep'];
            $oldPaid += $x['row']['unit_price'] * $x['keep'];
            $newPaid += $newUnit * $x['keep'];
            $preSum += $x['pre'] * $x['keep'];
        }
        $couponRatio = $totalNet > 0 ? min(1.0, $orderDiscount / $totalNet) : 0.0;
        $amount = round(max(0.0, $diff * (1 - $couponRatio)), 2);
        if ($amount < 0.01 || $preSum <= 0) {
            return null;
        }
        $lostIds = array_values(array_unique($lostIds));
        $lost = array_map(fn ($id) => $def[$id], $lostIds);
        $threshold = min(array_map(fn ($t) => (float) $t['min'], $lost)); // kaybedilen kademelerin min'i > 0
        $oldRate = round((1 - $oldPaid / $preSum) * 100, 1);
        $newRate = round(max(0, (1 - $newPaid / $preSum) * 100), 1);

        $fmt = fn (float $v) => number_format($v, 2, ',', '.');
        $pct = fn (float $v) => '%' . rtrim(rtrim(number_format($v, 1, ',', ''), '0'), ',');
        $rateText = $newRate > 0.05
            ? "kalan ürünlerin sepet indirimi {$pct($oldRate)} yerine {$pct($newRate)} oluyor"
            : 'kalan ürünler sepet indirimi şartını kaybediyor';

        return [
            'amount' => $amount,
            'basket_before' => round($baseBefore, 2),
            'basket_after' => round($baseAfter, 2),
            'threshold' => $threshold,
            'old_rate' => $oldRate,
            'new_rate' => $newRate,
            'lost' => array_map(fn ($t) => ['name' => $t['name'], 'pct' => (float) $t['pct'], 'min' => (float) $t['min']], $lost),
            'message' => "Sepet indirimi düzeltmesi: iade sonrası kalan ürünlerin tutarı {$fmt($baseAfter)} TL ile "
                . number_format($threshold, 0, ',', '.') . " TL eşiğinin altına düşüyor; {$rateText}, aradaki {$fmt($amount)} TL iade tutarından düşüldü.",
        ];
    }

    /** Kesintiyi iade edilen satırlara tutarlarıyla orantılı dağıt (taban 0); uygulanan tutarı döner. */
    private function deductFromLines(array &$lines, float $amount): float
    {
        $total = array_sum(array_column($lines, 'refundable'));
        if ($total <= 0) {
            return 0.0;
        }
        $amount = min($amount, $total);
        $left = $amount;
        $maxIdx = 0;
        foreach ($lines as $idx => $l) {
            if ($l['refundable'] > $lines[$maxIdx]['refundable']) {
                $maxIdx = $idx;
            }
        }
        foreach ($lines as $idx => $l) {
            if ($idx === $maxIdx) {
                continue;
            }
            $cut = min($l['refundable'], round($amount * $l['refundable'] / $total, 2));
            $lines[$idx]['refundable'] = round($l['refundable'] - $cut, 2);
            $lines[$idx]['campaign_deduction'] = round(($l['campaign_deduction'] ?? 0) + $cut, 2);
            $left = round($left - $cut, 2);
        }
        $cut = min($lines[$maxIdx]['refundable'], $left);
        $lines[$maxIdx]['refundable'] = round($lines[$maxIdx]['refundable'] - $cut, 2);
        $lines[$maxIdx]['campaign_deduction'] = round(($lines[$maxIdx]['campaign_deduction'] ?? 0) + $cut, 2);

        return round($amount - ($left - $cut), 2);
    }

    /**
     * Sepet indirimi kontrolünün sonucu (panel her zaman gösterir): sipariş/kalan sepet tutarı
     * (kampanya öncesi), eşik, uygulanan oran ve durum.
     *  recovered  : kalan sepet eşiğin altında → düzeltme düşüldü
     *  kept       : kalan sepet hâlâ eşiğin üstünde → değişiklik yok
     *  unenforced : sipariş anında eşik uygulanmıyordu (herkese verildi) → geri alınmaz
     *  full_return: tüm ürünler iade → kontrol gerekmez
     */
    private function tierCheck(array $byLine, array $requested, array $tiers, bool $fullReturn, ?array $recovery): ?array
    {
        if (! $tiers) {
            return null;
        }
        $def = [];
        foreach ($tiers as $t) {
            $def[(int) $t['id']] = $t;
        }
        $info = $this->tierInfo($byLine, $tiers);
        $used = [];
        $before = 0.0;
        $after = 0.0;
        $paidBefore = 0.0;
        foreach ($byLine as $lineId => $row) {
            $pre = round($row['unit_price'] / $info[$lineId]['factor'], 2);
            $keep = $row['qty_available'] - ($requested[$lineId] ?? 0);
            $before += $pre * $row['qty_available'];
            $after += $pre * $keep;
            $paidBefore += $row['unit_price'] * $row['qty_available'];
            $used = array_merge($used, $info[$lineId]['tiers']);
        }
        $used = array_values(array_unique($used));
        if (! $used) {
            return null;
        }
        $definedMin = fn ($id) => (float) ($def[$id]['min_defined'] ?? $def[$id]['min']);
        $unenforced = array_values(array_filter($used, fn ($id) => ! empty($def[$id]['unenforced']) || $before + 0.005 < $definedMin($id)));
        $threshold = min(array_map($definedMin, $used));
        $topMin = max(array_map($definedMin, $used));

        if ($recovery && $recovery['amount'] > 0) {
            $status = 'recovered';
        } elseif ($fullReturn) {
            $status = 'full_return';
        } elseif ($unenforced && $after + 0.005 < max(array_map($definedMin, $unenforced))) {
            $status = 'unenforced';
        } else {
            $status = 'kept';
        }

        return [
            'status' => $status,
            'basket_before' => round($before, 2),
            'basket_after' => round($after, 2),
            'rate' => $before > 0 ? round((1 - $paidBefore / $before) * 100, 1) : 0.0,
            'threshold' => $threshold,
            'top_threshold' => $topMin,
            'names' => array_values(array_map(fn ($id) => $def[$id]['name'], $used)),
        ];
    }
}
