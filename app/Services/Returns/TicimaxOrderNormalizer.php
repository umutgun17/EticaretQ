<?php

namespace App\Services\Returns;

/**
 * Ticimax SelectSiparis (WebSiparis) yanıtını, iade akışında kullanılan tek tip
 * normalize sipariş yapısına çevirir. Çıktı hem RefundCalculator girdisi hem de
 * müşteriye gösterilecek özet için kullanılır.
 *
 * ⚠ PARA-KRİTİK ALAN YORUMU (canlı veriyle doğrulandı — TB1729941181, TB4772352628):
 *  - `Tutar` = birim NET fiyat (KDV hariç), TÜM kampanya/indirimler ZATEN UYGULANMIŞ.
 *  - Birim nihai fiyat (KDV dahil) = `Tutar + KdvTutari` → müşterinin fiilen ödediği birim fiyat.
 *  - Σ(birim_nihai × Adet) ≈ `OdenenTutar` − kargo (doğrulandı).
 *  - `ToplamIndirim` / `IndirimTutari` = indirim MİKTARI ama bu miktar Tutar'a ZATEN
 *    yansımıştır → iade hesabında BİR DAHA ÇIKARILMAZ (yoksa net 0'a düşer = eski bug).
 *  Bu yüzden RefundCalculator'a `line_discount = 0` verilir; `unit_price` zaten nihai.
 *  `order_discount` ise yalnızca satıra dağıtılmamış (kupon/hediye çeki) farkı yakalamak için
 *  Σsatır − (ödenen − kargo) olarak savunmacı hesaplanır; asla ödenenin üstüne çıkmaz.
 *  VADE FARKI: hesaplanmaz/dağıtılmaz — iade yalnızca ürün tutarını kapsar, vade farkını
 *  ödeme kuruluşu otomatik algılar. Kargo: ayrı tutulur (refund_shipping opsiyonu).
 */
class TicimaxOrderNormalizer
{
    public function normalize(array $o): array
    {
        $items = [];
        $rawItems = $o['Urunler']['WebSiparisUrun'] ?? [];
        // Tek ürün olduğunda SOAP bazen tek nesne döndürür — diziye sar
        if (isset($rawItems['UrunAdi'])) {
            $rawItems = [$rawItems];
        }

        $sumLineFinal = 0.0; // Σ(birim_nihai × adet) — ödenen tutarla mutabakat için
        foreach ($rawItems as $idx => $it) {
            $qty = (int) ($it['Adet'] ?? 1);
            $unit = round((float) ($it['Tutar'] ?? 0) + (float) ($it['KdvTutari'] ?? 0), 2);
            $lineId = (string) ($it['ID'] ?? $it['SiparisUrunID'] ?? $it['SiparisUrunId'] ?? $idx);
            $sumLineFinal += round($unit * max(0, $qty), 2);

            // Bilgi amaçlı: kampanya öncesi birim fiyat + uygulanmış indirim (gösterim/denetim)
            $originalUnit = round((float) ($it['SatisAniSatisFiyat'] ?? 0) + (float) ($it['SatisAniSatisFiyatKdv'] ?? 0), 2);

            // ── SEPET KAMPANYASI PAYI (birim, KDV dahil) — kampanya iade telafisi için ──
            // Tonny Black örneği "2. ürüne ek indirim": KampanyaIndirimTutari alanı kampanya
            // farkını birim+KDV dahil verir (canlı doğrulama 2026-08-03, TB1385967466 →150.01 /
            // TB4239272196 →130.51+66.00). Çapraz kanıt: SatisAniIndirimliFiyat(+Kdv) − (Tutar+KdvTutari)
            // birebir aynı değeri verir; KalemBazliIndirimTutari da öyle. Baz (kampanyasız) üründe 0.
            // Alan yoksa/0 ise kampanya yok sayılır (telafi tetiklenmez — muhafazakâr).
            $campaignUnit = max(0.0, round((float) ($it['KampanyaIndirimTutari'] ?? 0), 2));
            if ($originalUnit > 0 && $campaignUnit > $originalUnit) {
                $campaignUnit = 0.0; // saçma veri (kampanya > liste fiyatı) → kampanya yok say
            }

            // Kalemde uygulanan kampanya ID'leri (sepet kademesi geri alımı + panel iade açıklaması)
            $campaignIds = array_values(array_map('intval', (array) ($it['KampanyaIDList']['int'] ?? [])));
            if (! $campaignIds && ! empty($it['KampanyaID'])) {
                $campaignIds = [(int) $it['KampanyaID']];
            }
            // Kampanya öncesi satış fiyatı (ürün indirimi uygulanmış). 1+1 kalemlerinde Ticimax
            // SatisAniIndirimliFiyat'ı 0 yazar → liste fiyatı.
            $saleUnit = round((float) ($it['SatisAniIndirimliFiyat'] ?? 0) + (float) ($it['SatisAniIndirimliFiyatKdv'] ?? 0), 2);

            $items[] = [
                'line_id' => $lineId,
                'name' => trim($it['UrunAdi'] ?? '') ?: null,
                'sku' => trim($it['StokKodu'] ?? '') ?: null,
                'barcode' => trim($it['Barkod'] ?? '') ?: null,
                'variant_info' => $this->variantInfo($it),
                'image_url' => trim($it['ResimYolu'] ?? '') ?: null,
                'qty' => $qty,
                'unit_price' => $unit,                 // KDV dahil, indirim UYGULANMIŞ nihai birim
                'line_discount' => 0.0,                // indirim zaten unit_price'a yansımış — tekrar çıkarma!
                // Sepet kampanyası birim payı (KDV dahil; unit_price'a ZATEN yansımış — bilgi +
                // kampanya iade telafisi girdisi, RefundCalculator campaign_recovery opsiyonu).
                'campaign_discount_unit' => $campaignUnit,
                // ── bilgi/denetim (hesaba girmez) ──
                'original_unit_price' => $originalUnit > 0 ? $originalUnit : null,
                'sale_unit_price' => $saleUnit > 0 ? $saleUnit : ($originalUnit > 0 ? $originalUnit : null),
                'campaign_ids' => $campaignIds,
                'discount_applied' => round((float) ($it['ToplamIndirim'] ?? 0), 2),
                'status_label' => trim($it['IslemAd'] ?? '') ?: (trim($it['DurumAd'] ?? '') ?: null),
                'platform_product_id' => (string) ($it['UrunKartiID'] ?? $it['UrunID'] ?? '') ?: null,
                'platform_variant_id' => (string) ($it['VaryasyonID'] ?? '') ?: null,
            ];
        }

        $paidAmount = round((float) ($o['OdenenTutar'] ?? 0), 2);
        $orderTotal = round((float) ($o['SiparisToplamTutari'] ?? 0), 2);
        $shippingCost = round((float) ($o['KargoTutari'] ?? 0), 2);
        $sumLineFinal = round($sumLineFinal, 2);

        // VADE FARKI hesaplanmaz/dağıtılmaz: iade YALNIZCA ürün tutarını (satır fiyatları) kapsar;
        // taksit/vade farkını ödeme kuruluşu (iyzico/PayTR) iade sırasında otomatik algılar.
        // (Not: SiparisToplamTutari güvenilmez — TB9967377787'de paid>SiparisToplam ama installments=1,
        //  yani vade YOK. Bu yüzden paid−SiparisToplam vade farkı OLARAK kullanılmaz.)

        // Satıra DAĞITILMAMIŞ indirim (hediye çeki/kupon kodu): Σsatır, ödenen+kargo'dan fazlaysa
        // aradaki fark müşterinin ÖDEMEDİĞİ tutardır (TB2812278375: Σsatır 1299.94 > ödenen 1234.95,
        // fark 64.99 = 65 TL hediye çeki). Kısmi iadede fazla iade olmasın diye orantılı düşülür
        // → RefundCalculator order_discount olarak alır. Kampanya indirimleri zaten Tutar'a yansıdığı
        // için burada YALNIZCA dağıtılmamış kalan yakalanır (normal/kargo siparişlerde 0).
        // ⚠ OdenenTutar panelden yapılan iadeleri (eksi ödeme satırı) DÜŞER → fark indirim sanılırdı
        // (TB9931547563 / #2955: −645,22 panel iadesi 745,22 "indirim" oldu, ayakkabı 645,22 yerine
        // 292,09 iade edildi). Ödeme bloğu varsa indirim BRÜT başarılı tahsilattan hesaplanır.
        $grossPaid = $this->grossPaid($o);
        $orderDiscount = max(0.0, round($sumLineFinal - (($grossPaid ?? $paidAmount) - $shippingCost), 2));

        return [
            // DİKKAT: SelectSiparis yanıtında sipariş ID alanı `ID`'dir (`SiparisID` DEĞİL — o yalnızca
            // filtre adı). Bu değer (örn 628560) = Nebim usp_OrderDetail @DocumentNumber. SiparisID fallback.
            'platform_order_id' => (string) ($o['ID'] ?? $o['SiparisID'] ?? '') ?: null,
            'order_no' => trim($o['SiparisNo'] ?? '') ?: null,
            'order_code' => trim($o['SiparisKodu'] ?? '') ?: null,
            'status' => (int) ($o['Durum'] ?? 0),
            'status_label' => trim($o['SiparisDurumu'] ?? '') ?: null,
            'customer_name' => \App\Support\TurkishText::fix(trim($o['AdiSoyadi'] ?? '')) ?: null,
            'customer_email' => ! empty($o['Mail']) ? strtolower(trim($o['Mail'])) : null,
            // Telefon SelectSiparis üst seviyede YOK → Teslimat/Fatura adresindeki AliciTelefon'dan al.
            // Müşteri e-posta ile doğrulasa bile SMS gönderebilmek için saklanır (submit fallback).
            'customer_phone' => trim((string) ($o['TeslimatAdresi']['AliciTelefon'] ?? $o['FaturaAdresi']['AliciTelefon'] ?? '')) ?: null,
            // Sürat iade gönderisinde Alıcı alanları MÜŞTERİ bilgisi olmalı (Sürat dönüşü 2026-07-20)
            // → teslimat adresi saklanır (fallback fatura adresi).
            'customer_address' => $this->address($o['TeslimatAdresi'] ?? $o['FaturaAdresi'] ?? null),
            'currency' => trim($o['ParaBirimi'] ?? 'TRY') ?: 'TRY',
            'order_date' => trim($o['SiparisTarihi'] ?? '') ?: null,
            'cargo_company' => trim($o['KargoFirmaTanim'] ?? '') ?: null,
            'cargo_tracking_no' => trim($o['KargoTakipNo'] ?? '') ?: null,

            // RefundCalculator için tutar alanları
            // order_discount: yalnızca satıra DAĞITILMAMIŞ kupon/hediye çeki (kampanya değil).
            'order_discount' => $orderDiscount,
            'shipping_cost' => $shippingCost,                                    // satırda yok; ayrı (refund_shipping)
            'gift_card_amount' => round((float) ($o['HediyeCekiTutari'] ?? 0), 2),
            'coupon_code' => trim((string) ($o['HediyeCeki'] ?? '')) ?: null,
            'points_discount' => round((float) ($o['PuanIndirimi'] ?? 0), 2),
            'total_amount' => $orderTotal,
            'paid_amount' => $paidAmount,
            'line_total' => round($sumLineFinal, 2),                             // Σ(birim_nihai × adet)
            // Siparişte uygulanan kampanyalar (ad + tip). Oran/eşik için ReturnOrderGateway
            // Ticimax tanımını okuyup `tiers` ekler (adına güvenilmez).
            'campaigns' => $this->campaigns($o),

            'items' => $items,
        ];
    }

    /**
     * Ödeme bloğundaki (OdemeGetir=true) Onaylandi=1 POZİTİF tahsilatların toplamı = panel iadeleri
     * düşülmeden önceki OdenenTutar (Ticimax OdenenTutar = ΣOnaylandi=1 satırlar; TB9931547563,
     * TB8369149879, TB4346184547, TB7718486535 ile birebir doğrulandı). PosReferansID metnine
     * BAKILMAZ: PayTR başarılı satırda eski deneme hatasını taşıyabiliyor (TB7718486535).
     * Ödeme bloğu yoksa veya onaylı tahsilat yoksa null → OdenenTutar kullanılır.
     */
    private function grossPaid(array $o): ?float
    {
        $raw = $o['Odemeler']['WebSiparisOdeme'] ?? null;
        if (! is_array($raw)) {
            return null;
        }
        $sum = 0.0;
        foreach (isset($raw[0]) ? $raw : [$raw] as $p) {
            $amount = (float) ($p['Tutar'] ?? 0);
            if ($amount > 0 && (int) ($p['Onaylandi'] ?? 0) === 1) {
                $sum += $amount;
            }
        }

        return $sum > 0 ? round($sum, 2) : null;
    }

    /** @return list<array{id:int, name:string, type:int}> */
    private function campaigns(array $o): array
    {
        $list = $o['Kampanyalar']['WebSiparisKampanya'] ?? [];
        if (isset($list['KampanyaID'])) {
            $list = [$list];
        }
        $out = [];
        foreach ((array) $list as $c) {
            if (! empty($c['KampanyaID'])) {
                $out[] = [
                    'id' => (int) $c['KampanyaID'],
                    'name' => \App\Support\TurkishText::fix(trim((string) ($c['KampanyaTanim'] ?? ''))),
                    'type' => (int) ($c['KampanyaTipi'] ?? 0),
                ];
            }
        }

        return $out;
    }

    /**
     * Ticimax adres düğümünü (TeslimatAdresi/FaturaAdresi) normalize eder — Sürat iade
     * gönderisinin müşteri alanları (AliciAdresi/Il/Ilce) buradan beslenir.
     */
    private function address($a): ?array
    {
        if (empty($a) || ! is_array($a)) {
            return null;
        }

        return [
            'address' => trim((string) ($a['Adres'] ?? '')) ?: null,
            'neighborhood' => trim((string) ($a['Semt'] ?? $a['Mahalle'] ?? '')) ?: null,
            'city' => trim((string) ($a['Il'] ?? '')) ?: null,
            'district' => trim((string) ($a['Ilce'] ?? '')) ?: null,
            'postal_code' => trim((string) ($a['PostaKodu'] ?? '')) ?: null,
        ];
    }

    private function variantInfo(array $it): ?string
    {
        $options = $it['EkSecenekList']['WebSiparisUrunEkSecenekOzellik'] ?? [];
        if (isset($options['Tanim'])) {
            $options = [$options];
        }
        $parts = array_filter(array_map(fn ($o) => trim($o['Tanim'] ?? ''), $options));

        return $parts ? implode(', ', $parts) : null;
    }

    /**
     * Müşterinin girdiği email VEYA telefon, siparişteki bilgilerle eşleşiyor mu?
     * Güvenlik: alan adlarına bağımlı kalmamak için sipariş ağacındaki tüm metinler
     * taranır; email tam (küçük harf), telefon son 10 hane ile karşılaştırılır.
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
            $needle = $this->normalizePhone($phone);
            if (strlen($needle) >= 10) {
                $needle = substr($needle, -10);
                foreach ($haystack as $s) {
                    $cand = $this->normalizePhone($s);
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

    private function normalizePhone(string $s): string
    {
        return preg_replace('/\D+/', '', $s) ?? '';
    }
}
