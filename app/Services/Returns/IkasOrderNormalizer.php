<?php

namespace App\Services\Returns;

use App\Services\IkasService;

/**
 * ikas listOrder yanıtını (IkasService::getOrderByNo) iade akışının normalize sipariş
 * yapısına çevirir — TicimaxOrderNormalizer ile AYNI çıktı sözleşmesi (RefundCalculator
 * girdisi + müşteri özeti + eligibility). Durum eşlemesi ikas:sync ile birebirdir
 * (IkasSync::mapStatus) — böylece tenant iade kuralları (returnable_statuses=[7] vb.)
 * platformdan bağımsız çalışır.
 *
 * ⚠ PARA ALANLARI (canlı doğrulama 2026-07-24, BA5126528):
 *  - orderLineItems.finalPrice = SATIR toplamı (adet dahil), KDV DAHİL, indirimler uygulanmış.
 *    Birim nihai = finalPrice / quantity (finalUnitPrice çoğu siparişte null geliyor).
 *  - Σsatır finalPrice = totalFinalPrice (kargo dahilse shippingLines.finalPrice içinde).
 *  - order_discount: satıra dağıtılmamış fark savunmacı hesaplanır (Ticimax'la aynı formül).
 */
class IkasOrderNormalizer
{
    /** Servis yalnız görsel CDN URL'i (merchant id) için — kanal ayarında cache'li, ek API çağrısı yok. */
    public function __construct(private readonly ?IkasService $ikas = null) {}

    public function normalize(array $o): array
    {
        $items = [];
        $sumLineFinal = 0.0;

        foreach ((array) ($o['orderLineItems'] ?? []) as $idx => $it) {
            $qty = max(1, (int) ($it['quantity'] ?? 1));
            $lineTotal = round((float) ($it['finalPrice'] ?? 0), 2);
            $unit = $it['finalUnitPrice'] !== null && (float) $it['finalUnitPrice'] > 0
                ? round((float) $it['finalUnitPrice'], 2)
                : round($lineTotal / $qty, 2);
            $sumLineFinal += $lineTotal;

            $variant = (array) ($it['variant'] ?? []);
            $originalUnit = round((float) ($it['price'] ?? 0) / $qty, 2);

            $items[] = [
                'line_id' => (string) ($it['id'] ?? $idx),
                'name' => trim((string) ($variant['name'] ?? '')) ?: null,
                'sku' => trim((string) ($variant['sku'] ?? '')) ?: null,
                'barcode' => trim((string) (($variant['barcodeList'] ?? [])[0] ?? '')) ?: null,
                'variant_info' => $this->variantInfo($variant),
                'image_url' => $this->imageUrl($variant),
                'qty' => $qty,
                'unit_price' => $unit,      // KDV dahil, indirim uygulanmış nihai birim (Ticimax sözleşmesi)
                'line_discount' => 0.0,     // indirim zaten finalPrice'a yansımış — tekrar çıkarma!
                // ── bilgi/denetim (hesaba girmez) ──
                'original_unit_price' => $originalUnit > $unit ? $originalUnit : null,
                'discount_applied' => round((float) ($it['discountPrice'] ?? 0), 2),
                'status_label' => $this->itemStatusLabel((string) ($it['status'] ?? '')),
                'platform_product_id' => (string) ($variant['productId'] ?? '') ?: null,
                'platform_variant_id' => (string) ($variant['id'] ?? '') ?: null,
            ];
        }

        $sumLineFinal = round($sumLineFinal, 2);
        $paidAmount = round((float) ($o['totalFinalPrice'] ?? 0), 2);
        $shippingCost = 0.0;
        foreach ((array) ($o['shippingLines'] ?? []) as $sl) {
            $shippingCost += (float) ($sl['finalPrice'] ?? 0);
        }
        $shippingCost = round($shippingCost, 2);

        [$status, $statusLabel] = $this->mapStatus($o);

        // Satıra dağıtılmamış indirim (kupon/hediye kartı) — Ticimax'la aynı savunmacı formül.
        $orderDiscount = max(0.0, round($sumLineFinal - ($paidAmount - $shippingCost), 2));

        $customer = (array) ($o['customer'] ?? []);
        $ship = (array) ($o['shippingAddress'] ?? ($o['billingAddress'] ?? []));
        $name = trim((string) ($customer['fullName'] ?? ''))
            ?: trim(trim((string) ($ship['firstName'] ?? '')) . ' ' . trim((string) ($ship['lastName'] ?? '')));

        return [
            'platform_order_id' => (string) ($o['id'] ?? '') ?: null,   // ikas UUID
            'order_no' => trim((string) ($o['orderNumber'] ?? '')) ?: null,
            'order_code' => null,
            'status' => $status,
            'status_label' => $statusLabel,
            'customer_name' => $name ?: null,
            'customer_email' => ! empty($customer['email']) ? strtolower(trim((string) $customer['email'])) : null,
            'customer_phone' => trim((string) ($customer['phone'] ?? $ship['phone'] ?? '')) ?: null,
            // Kargo iade gönderisinin shipper/müşteri alanları buradan beslenir (Sürat/DHL ortak).
            'customer_address' => $this->address($ship),
            'currency' => trim((string) ($o['currencyCode'] ?? 'TRY')) ?: 'TRY',
            'order_date' => IkasService::msToDate($o['orderedAt'] ?? $o['createdAt'] ?? null),
            'cargo_company' => null,
            'cargo_tracking_no' => null,

            // RefundCalculator için tutar alanları (Ticimax sözleşmesiyle aynı anlamlar)
            'order_discount' => $orderDiscount,
            'shipping_cost' => $shippingCost,
            'gift_card_amount' => 0.0,
            'coupon_code' => trim((string) ($o['couponCode'] ?? '')) ?: null,
            'points_discount' => 0.0,
            'total_amount' => round((float) ($o['totalPrice'] ?? 0), 2),
            'paid_amount' => $paidAmount,
            'line_total' => $sumLineFinal,

            'items' => $items,
        ];
    }

    /**
     * ikas durumları → Ticimax 'Durum' sayı sözlüğü — IkasSync::mapStatus ile birebir aynı
     * (0 alındı, 3 ödeme bekliyor, 5 hazırlanıyor, 6 kargoda, 7 teslim, 8 iptal,
     * 11 iade talep, 12 kısmi iade, 13 iade ödemesi yapıldı).
     */
    private function mapStatus(array $o): array
    {
        $status = (string) ($o['status'] ?? '');
        $package = (string) ($o['orderPackageStatus'] ?? '');

        return match (true) {
            $status === 'CANCELLED' => [8, 'İptal Edildi'],
            $status === 'REFUNDED' => [13, 'İade Ödemesi Yapıldı'],
            $status === 'PARTIALLY_REFUNDED' => [12, 'Kısmi İade'],
            $status === 'REFUND_REQUESTED' => [11, 'İade Talep Alındı'],
            str_contains($package, 'DELIVERED') => [7, 'Teslim Edildi'],
            str_contains($package, 'FULFILLED') && $package !== 'UNFULFILLED' => [6, 'Kargoya Verildi'],
            str_contains($package, 'READY') || str_contains($package, 'PREPAR') => [5, 'Hazırlanıyor'],
            ! in_array((string) ($o['orderPaymentStatus'] ?? ''), ['PAID', 'PARTIALLY_PAID'], true) => [3, 'Onay Bekliyor (Ödeme)'],
            default => [0, 'Sipariş Alındı'],
        };
    }

    private function itemStatusLabel(string $s): ?string
    {
        return match (true) {
            $s === '' => null,
            str_contains($s, 'REFUND') => 'İade',
            str_contains($s, 'DELIVERED') => 'Teslim Edildi',
            str_contains($s, 'FULFILLED') && $s !== 'UNFULFILLED' => 'Kargoya Verildi',
            str_contains($s, 'CANCEL') => 'İptal',
            default => null,
        };
    }

    /** ikas OrderAddress → Sürat/DHL gönderi adres yapısı (TicimaxOrderNormalizer::address ile aynı anahtarlar). */
    private function address(array $a): ?array
    {
        if ($a === []) {
            return null;
        }

        $line = trim(implode(' ', array_filter([
            trim((string) ($a['addressLine1'] ?? '')),
            trim((string) ($a['addressLine2'] ?? '')),
        ])));

        return [
            'address' => $line ?: null,
            'neighborhood' => null,
            'city' => trim((string) ($a['city']['name'] ?? '')) ?: null,
            'district' => trim((string) ($a['district']['name'] ?? '')) ?: null,
            'postal_code' => trim((string) ($a['postalCode'] ?? '')) ?: null,
        ];
    }

    private function variantInfo(array $variant): ?string
    {
        $parts = array_filter(array_map(
            fn ($v) => trim((string) ($v['variantValueName'] ?? '')),
            (array) ($variant['variantValues'] ?? [])
        ));

        return $parts ? implode(', ', $parts) : null;
    }

    /** Ürün görseli: cdn.myikas.com/images/{merchantId}/{imageId}/image_720.webp deseni. */
    private function imageUrl(array $variant): ?string
    {
        $imageId = trim((string) ($variant['mainImageId'] ?? ''));
        if ($imageId === '' || ! $this->ikas) {
            return null;
        }

        try {
            return $this->ikas->imageUrl($imageId);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Müşterinin girdiği email VEYA telefon siparişle eşleşiyor mu? TicimaxOrderNormalizer
     * ile aynı yaklaşım: alan adına bağımlı kalmadan tüm sipariş ağacındaki metinler taranır.
     */
    public function verifyContact(array $rawOrder, ?string $email, ?string $phone): bool
    {
        $haystack = [];
        $this->collectStrings($rawOrder, $haystack);

        if ($email) {
            $email = strtolower(trim($email));
            foreach ($haystack as $s) {
                if (strtolower($s) === $email) {
                    return true;
                }
            }
        }

        if ($phone) {
            $needle = preg_replace('/\D+/', '', $phone) ?? '';
            if (strlen($needle) >= 10) {
                $needle = substr($needle, -10);
                foreach ($haystack as $s) {
                    $cand = preg_replace('/\D+/', '', $s) ?? '';
                    if (strlen($cand) >= 10 && substr($cand, -10) === $needle) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private function collectStrings($node, array &$out): void
    {
        if (is_array($node)) {
            foreach ($node as $v) {
                $this->collectStrings($v, $out);
            }
        } elseif (is_string($node) || is_numeric($node)) {
            $s = (string) $node;
            if ($s !== '') {
                $out[] = $s;
            }
        }
    }
}
