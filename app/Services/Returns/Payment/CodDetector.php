<?php

namespace App\Services\Returns\Payment;

use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Models\Tenant;
use App\Services\TicimaxService;

/**
 * KAPIDA ÖDEME (COD) TESPİTİ — iade/iptal akışının ödeme adımını belirleyen tek kaynak.
 *
 * Neden gerekli (kullanıcı kararı 2026-09-01): kapıda ödemeli siparişte kart işlemi YOKTUR.
 *  - İPTAL edilirse müşteri hiç ödeme yapmamıştır → iade edilecek para yok, para onayı anlamsız
 *    (11 talep aylarca yönetici kuyruğunda "Karta iade sağlayıcısı belirlenemedi" ile asılı kaldı).
 *  - Teslim sonrası İADE'de para nakit/kapıda kartla tahsil edilmiştir → karta iade İMKÂNSIZ,
 *    tek yol müşterinin IBAN'ına havale.
 *
 * ⚠ AYRAÇ (canlı Ticimax verisiyle doğrulandı 2026-09-01 — TB8159143398 tip=2, TB7119271675 tip=3,
 * TB9744919311 tip=17 kontrol): ödeme satırında `KapidaOdemeTutari > 0` (kapıda ödeme hizmet bedeli,
 * Tonny Black'te 100 TL) kapıda ödemenin KESİN işaretidir; ek olarak `OdemeTipi` 2 (kapıda nakit) /
 * 3 (kapıda kredi kartı) da kapıda ödemedir (hizmet bedeli 0 olan mağaza için). Kartlı ödemelerde
 * (iyzico=17, PayTR=25) KapidaOdemeTutari daima 0 ve PosReferansID/OdemeSiparisID doludur.
 *
 * ⛔ FAIL-CLOSED: ödeme bloğu okunamazsa (Ticimax hatası, ikas gibi başka platform, sipariş ID yok)
 * `cod=false, checked=false` döner → akış ESKİ davranışına düşer (otomatik kapatma yapılmaz, normal
 * iade yöntemleri gösterilir). Yani belirsizlik hiçbir zaman "para gerekmiyor" varsayımına dönüşmez.
 */
class CodDetector
{
    /** @var array<string, array> İstek içi memo (lookup/submit aynı süreçte 2. SOAP çağrısı yapmasın). */
    private array $memo = [];

    /**
     * Siparişin ödeme yapısını çözer.
     *
     * @return array{cod:bool, checked:bool, fee:float, method_code:?int, reason:string}
     */
    public function forOrder(Tenant $tenant, ?string $platformOrderId): array
    {
        $siparisId = (int) $platformOrderId;
        if ($siparisId <= 0) {
            return $this->unknown('sipariş ID yok');
        }

        $memoKey = $tenant->id . ':' . $siparisId;
        if (isset($this->memo[$memoKey])) {
            return $this->memo[$memoKey];
        }

        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'like', 'ticimax%')
            ->where('type', 'like', '%-ecommerce')
            ->where('is_active', true)
            ->first();
        if (! $channel) {
            // Ticimax dışı platform (ikas) — ödeme bloğu bu yoldan okunamaz.
            return $this->memo[$memoKey] = $this->unknown('ticimax kanalı yok');
        }

        try {
            $res = TicimaxService::fromChannel($channel)->getOrderPayment($siparisId);
        } catch (\Throwable $e) {
            return $this->memo[$memoKey] = $this->unknown('ödeme bloğu okunamadı');
        }

        if (! ($res['success'] ?? false)) {
            return $this->memo[$memoKey] = $this->unknown('ödeme bloğu okunamadı: ' . ($res['error'] ?? 'bilinmeyen'));
        }

        return $this->memo[$memoKey] = $this->evaluate((array) ($res['payments'] ?? []));
    }

    /** Talep üzerinden kısayol (panel/komut tarafı). */
    public function forRequest(ReturnRequest $r): array
    {
        $tenant = $r->tenant ?: Tenant::find($r->tenant_id);

        return $tenant ? $this->forOrder($tenant, $r->platform_order_id) : $this->unknown('tenant yok');
    }

    /**
     * Normalize edilmiş ödeme satırlarından kapıda ödeme kararı.
     *
     * KURAL: BAŞARILI (Onaylandi=1, tutar>0, PosReferansID hata metni değil) satırlara bakılır.
     * Başarılı satır yoksa → belirsiz. Başarılı satırların HEPSİ kapıda ödemeyse → COD.
     * Aralarında tek bir kartlı ödeme bile varsa → COD DEĞİL (karta iade yolu açık kalır).
     * Terk edilmiş/reddedilmiş denemeler (Onaylandi 2/5) karara girmez — kapıda ödemeli siparişlerde
     * çok sık görülür (müşteri önce kartla dener, vazgeçip kapıda ödemeyi seçer).
     *
     * @param  array  $payments  TicimaxService::getOrderPayment() normalize satırları
     * @return array{cod:bool, checked:bool, fee:float, method_code:?int, reason:string}
     */
    public function evaluate(array $payments): array
    {
        $successful = array_values(array_filter($payments, function (array $p): bool {
            if ((float) ($p['tutar'] ?? 0) <= 0) {
                return false;   // iade/düzeltme kaydı
            }
            if ((int) ($p['onaylandi'] ?? 0) !== 1) {
                return false;   // 2=red, 5=terk edilmiş deneme
            }
            $posRef = trim((string) ($p['pos_referans_id'] ?? ''));

            return $posRef === '' || ctype_digit($posRef);  // hata metni taşıyan satır = başarısız
        }));

        if ($successful === []) {
            return $this->unknown('başarılı ödeme satırı yok');
        }

        $codRows = array_values(array_filter($successful, fn (array $p) => $this->isCodRow($p)));

        if (count($codRows) !== count($successful)) {
            return ['cod' => false, 'checked' => true, 'fee' => 0.0, 'method_code' => null,
                'reason' => 'kartlı/online ödeme satırı var'];
        }

        $fee = 0.0;
        foreach ($codRows as $p) {
            $fee += (float) ($p['kapida_odeme_tutari'] ?? 0);
        }

        return [
            'cod' => true,
            'checked' => true,
            'fee' => round($fee, 2),
            'method_code' => isset($codRows[0]['odeme_tipi']) ? (int) $codRows[0]['odeme_tipi'] : null,
            'reason' => 'kapıda ödeme',
        ];
    }

    /** Tek ödeme satırı kapıda ödeme mi? (hizmet bedeli > 0 VEYA OdemeTipi kapıda listesinde) */
    private function isCodRow(array $p): bool
    {
        if ((float) ($p['kapida_odeme_tutari'] ?? 0) > 0) {
            return true;
        }

        $types = array_map('intval', (array) config('returns.cod_odeme_tipleri', [2, 3]));

        return in_array((int) ($p['odeme_tipi'] ?? 0), $types, true);
    }

    /** @return array{cod:bool, checked:bool, fee:float, method_code:null, reason:string} */
    private function unknown(string $reason): array
    {
        return ['cod' => false, 'checked' => false, 'fee' => 0.0, 'method_code' => null, 'reason' => $reason];
    }
}
