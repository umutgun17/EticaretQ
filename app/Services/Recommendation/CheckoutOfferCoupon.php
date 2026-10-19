<?php

namespace App\Services\Recommendation;

use App\Models\Channel;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Sepet içi "Sana Özel Teklif" için TEK KULLANIMLIK Ticimax hediye çeki üretir.
 *
 * Kupon yalnız müşteri teklifi kullandığında (CTA) açılır — her gösterimde değil.
 * İndirim = teklif ürünü fiyatının %X'i (TL olarak, tavanlı). Kupon koşulu:
 *   - Minimum ürün tutarı = sepet toplamı + teklif ürünü fiyatı (küçük tolerans)
 *     → teklif ürünü eklenmeden kupon geçmez (Ticimax API'sinde ürün kısıtı yok).
 *   - Üye girişliyse UyeID'ye bağlanır (başkası kullanamaz).
 *   - 1 kullanım, N dakika geçerli (sayaç bitince zaten teklif kaybolur).
 */
class CheckoutOfferCoupon
{
    /**
     * @param  array{id:int, pid?:string, variant_id?:string|null, price:float, discounted?:float|null, name?:string}  $item
     * @return array{success:bool, code?:string, id?:int, amount?:float, min_basket?:float, expires_at?:\Carbon\Carbon, error?:string}
     */
    public function issue(int $tenantId, array $item, float $cartTotal, float $percent, float $maxAmount, int $validMinutes, ?string $platformMemberId = null): array
    {
        $service = $this->resolveTicimax($tenantId);
        if (! $service) {
            return ['success' => false, 'error' => 'Ticimax kanalı yok'];
        }

        $unit = (float) (($item['discounted'] ?? null) ?: ($item['price'] ?? 0));
        if ($unit <= 0 || $percent <= 0) {
            return ['success' => false, 'error' => 'Fiyat/oran geçersiz'];
        }

        $amount = round($unit * $percent / 100, 2);
        if ($maxAmount > 0) {
            $amount = min($amount, $maxAmount);
        }
        $amount = max(1.0, floor($amount)); // Ticimax'ta tam TL daha okunaklı
        if ($amount >= $unit) {
            $amount = max(1.0, floor($unit * 0.5));
        }

        // Teklif ürünü eklenmeden kupon geçmesin: sepet + ürün (%2 tolerans, fiyat farkları için)
        $minBasket = $cartTotal > 0 ? round(($cartTotal + $unit) * 0.98, 2) : 0.0;

        $validMinutes = max(5, min(240, $validMinutes));
        $expires = now()->addMinutes($validMinutes);
        $code = 'OZEL-'.strtoupper(Str::random(6));

        $req = [
            'Kod' => $code,
            'IndirimTipi' => 0, // 0 = Tutar (TL)
            'IndirimDegeri' => $amount,
            'MinimumUrunTutari' => $minBasket,
            'MinTutarKosuldaGecerli' => $minBasket > 0,
            'KargoUcretsiz' => false,
            'KullanimSayisi' => 1,
            'UyeMaksimumKullanimSayisi' => 1,
            'TarihBaslagic' => now()->subMinutes(2)->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'TarihBitis' => $expires->copy()->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'WebAktif' => true,
            'MobilAktif' => true,
            'AndroidAktif' => true,
            'IOSAktif' => true,
            'GrupAdi' => 'Yunbi Sana Ozel Teklif',
            'IndirimliUrunleKullanilabilir' => true,
            'BaskaKampanyalarlaBilestirilebilir' => true,
            'SepetteKosulsuzGoster' => false,
        ];
        if ($platformMemberId !== null && preg_match('/^\d{1,9}$/', $platformMemberId)) {
            $req['UyeID'] = (int) $platformMemberId;
        }

        $res = $service->createGiftVoucher($req);
        if (! ($res['success'] ?? false)) {
            Log::error('[rec-offer] kupon oluşturulamadı', ['tenant' => $tenantId, 'error' => $res['error'] ?? '?']);

            return ['success' => false, 'error' => (string) ($res['error'] ?? 'Kupon oluşturulamadı')];
        }

        return [
            'success' => true,
            'code' => $res['code'] ?: $code,
            'id' => (int) ($res['id'] ?? 0),
            'amount' => $amount,
            'min_basket' => $minBasket,
            'expires_at' => $expires,
        ];
    }

    protected function resolveTicimax(int $tenantId): ?TicimaxService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'like', 'ticimax%')
            ->where('is_active', true)
            ->orderByRaw("CASE WHEN type = 'ticimax-ecommerce' THEN 0 ELSE 1 END")
            ->first();

        if (! $channel) {
            return null;
        }

        $service = TicimaxService::fromChannel($channel);

        return $service->isAvailable() ? $service : null;
    }
}
