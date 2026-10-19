<?php

namespace App\Services\Wheel;

use App\Enums\WheelCouponStatus;
use App\Enums\WheelPrizeType;
use App\Models\Channel;
use App\Models\WheelCampaign;
use App\Models\WheelSlice;
use App\Models\WheelSpin;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Kazanılan ödül için kupon kodu üretir.
 *
 * İKİ MOD:
 *  - `display` → kod bizim tarafta üretilir, YALNIZCA ekranda gösterilir. Dış sisteme yazılmaz.
 *  - `ticimax` → Ticimax HediyeCekiOlustur ile GERÇEK tek kullanımlık kupon. Her çevirme için
 *    BENZERSİZ kod; kullanım takibi SelectHediyeCeki ile yapılır (performans raporları).
 *
 * AKIŞ (ticimax): {@see prepare()} kodu üretir + payload'ı kurar ve spin'i `pending` bırakır
 * (DB transaction içinde, hızlı). {@see pushToTicimax()} commit SONRASI gerçek SOAP yazımını
 * yapar — başarıda `issued` + Ticimax id; hatada `pending` kalır ve retry job devreye girer.
 * Bu sayede yavaş SOAP çağrısı DB kilidini tutmaz ve rollback'te öksüz kupon oluşmaz.
 */
class WheelCouponIssuer
{
    /**
     * Çevirme anında (DB transaction içinde) çağrılır: kodu üretir, ticimax modunda
     * gönderilecek payload'ı hazırlar. GERÇEK Ticimax yazımı burada YAPILMAZ.
     *
     * @return array{code:?string, status:WheelCouponStatus, provider:string, expires_at:?\Carbon\Carbon, request:?array}
     */
    public function prepare(WheelCampaign $campaign, WheelSlice $slice, string $variant = 'wheel'): array
    {
        $provider = $campaign->coupon_provider ?: config('wheel.coupon.provider', 'display');

        // Ödül kupon gerektirmiyorsa (kaybeden / serbest metin) kod üretilmez.
        if (! $slice->prize_type->needsCoupon()) {
            return [
                'code' => null,
                'status' => WheelCouponStatus::None,
                'provider' => $provider,
                'expires_at' => null,
                'request' => null,
            ];
        }

        if ($variant === 'scratch') {
            // Kazı kazan: KISA süreli (dakika) "sana özel" kupon — aciliyet. Kod ön eki farklı
            // (KAZI-xxxxx) ki Ticimax/sipariş raporlarında çarktan ayrışsın.
            $code = $this->generateCode($campaign, $slice, (string) config('wheel.scratch.code_prefix', 'KAZI'));
            $minutes = (int) (($campaign->settings['scratch_valid_minutes'] ?? null) ?: config('wheel.scratch.valid_minutes', 30));
            $expiresAt = now()->addMinutes(max(5, $minutes));
        } else {
            $code = $this->generateCode($campaign, $slice);
            $validHours = (int) ($campaign->coupon_valid_hours ?: config('wheel.coupon.valid_hours', 24));
            $expiresAt = now()->addHours(max(1, $validHours));
        }

        // Ticimax modu, fakat ödül türü hediye çekine çevrilemiyorsa (ör. hediye ürün) →
        // display'e düş: kod yine üretilir, ekranda gösterilir, Ticimax'a yazılmaz.
        $ticimaxRequest = ($provider === 'ticimax')
            ? $this->buildTicimaxRequest($slice, $code, $expiresAt, $variant)
            : null;

        if ($provider === 'ticimax' && $ticimaxRequest !== null) {
            return [
                'code' => $code,
                'status' => WheelCouponStatus::Pending, // pushToTicimax başarıyla yazınca issued olur
                'provider' => 'ticimax',
                'expires_at' => $expiresAt,
                'request' => $ticimaxRequest,
            ];
        }

        // display modu (veya ticimax'a çevrilemeyen ödül) — kod hazır, müşteriye gösterilir.
        return [
            'code' => $code,
            'status' => WheelCouponStatus::Issued,
            'provider' => 'display',
            'expires_at' => $expiresAt,
            'request' => null,
        ];
    }

    /**
     * Commit SONRASI: hazırlanmış payload'ı Ticimax'a yazar ve spin'i günceller.
     * Başarı → coupon_status=issued, metadata.ticimax_id set. Hata → false döner
     * (çağıran retry job'ı tetikler; spin pending kalır).
     *
     * @return bool Ticimax'a başarıyla yazıldıysa true.
     */
    public function pushToTicimax(WheelSpin $spin): bool
    {
        $request = $spin->metadata['ticimax_request'] ?? null;

        if (! is_array($request) || empty($request['Kod'])) {
            Log::warning('[wheel] pushToTicimax: payload yok', ['spin_id' => $spin->id]);

            return false;
        }

        // Dry-run: gerçek yazma yok, ne gönderilecekti logla, pending bırak.
        if (config('wheel.coupon.dry_run', false)) {
            Log::info('[wheel] ticimax coupon DRY-RUN (yazılmadı)', [
                'spin_id' => $spin->id,
                'tenant_id' => $spin->tenant_id,
                'request' => $request,
            ]);

            return false;
        }

        $service = $this->resolveTicimaxService($spin->tenant_id);

        if (! $service) {
            Log::error('[wheel] ticimax kanalı/servisi yok', [
                'spin_id' => $spin->id,
                'tenant_id' => $spin->tenant_id,
            ]);

            return false;
        }

        $res = $service->createGiftVoucher($request);

        if (! ($res['success'] ?? false)) {
            Log::error('[wheel] HediyeCekiOlustur başarısız', [
                'spin_id' => $spin->id,
                'code' => $request['Kod'],
                'error' => $res['error'] ?? '?',
            ]);

            $meta = $spin->metadata ?? [];
            $meta['ticimax_error'] = $res['error'] ?? 'bilinmeyen';
            $spin->update(['metadata' => $meta]);

            return false;
        }

        $meta = $spin->metadata ?? [];
        $meta['ticimax_id'] = $res['id'];
        unset($meta['ticimax_error']);

        $spin->update([
            // Ticimax kendi kodunu döndürürse onu kullan (normalde bizim Kod ile aynı).
            'coupon_code' => $res['code'] ?: $spin->coupon_code,
            'coupon_status' => WheelCouponStatus::Issued,
            'metadata' => $meta,
        ]);

        Log::info('[wheel] Ticimax hediye çeki oluşturuldu', [
            'spin_id' => $spin->id,
            'ticimax_id' => $res['id'],
            'code' => $res['code'],
        ]);

        return true;
    }

    /**
     * Dilim ödülünü WebHediyeCekiOlusturRequest payload'ına çevirir.
     * Çevrilemiyorsa (hediye ürün vb.) null döner → display'e düşülür.
     */
    private function buildTicimaxRequest(WheelSlice $slice, string $code, \Carbon\CarbonInterface $expiresAt, string $variant = 'wheel'): ?array
    {
        $cfg = config('wheel.coupon.ticimax');
        $type = $slice->prize_type;
        $settings = $slice->settings ?? [];
        $minBasket = (float) ($settings['min_basket'] ?? 0);

        $indirimTipi = null;
        $indirimDegeri = 0.0;
        $kargoUcretsiz = false;

        if ($type === WheelPrizeType::DiscountAmount) {
            $indirimTipi = $cfg['indirim_tipi']['amount'];
            $indirimDegeri = (float) $slice->prize_value;
        } elseif ($type === WheelPrizeType::DiscountPercent) {
            $indirimTipi = $cfg['indirim_tipi']['percent'];
            $indirimDegeri = (float) $slice->prize_value;
        } elseif ($type === WheelPrizeType::FreeShipping) {
            $indirimTipi = $cfg['indirim_tipi']['amount'];
            $indirimDegeri = 0.0;
            $kargoUcretsiz = true;
        } else {
            // Hediye ürün / özel → hediye çekine çevrilemez.
            return null;
        }

        return [
            'Kod' => $code,
            'IndirimTipi' => (int) $indirimTipi,
            'IndirimDegeri' => $indirimDegeri,
            'MinimumUrunTutari' => $minBasket,
            'MinTutarKosuldaGecerli' => $minBasket > 0,
            'KargoUcretsiz' => $kargoUcretsiz,
            'KullanimSayisi' => (int) ($cfg['usage_count'] ?? 1),
            'UyeMaksimumKullanimSayisi' => (int) ($cfg['member_max_usage'] ?? 1),
            // Ticimax Türkiye saatiyle ve GÜN bazında çalışır (saat yok sayılır, başlangıç gün
            // başı / bitiş gün sonu); tarihleri Türkiye TZ'sine çevirip gönderiyoruz ki doğru
            // günler seçilsin (UTC gece yarısı kaymalarını önler). +24 saat → ertesi gün sonu.
            'TarihBaslagic' => now()->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'TarihBitis' => $expiresAt->copy()->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'WebAktif' => (bool) ($cfg['web_active'] ?? true),
            'MobilAktif' => (bool) ($cfg['mobile_active'] ?? true),
            'AndroidAktif' => (bool) ($cfg['android_active'] ?? true),
            'IOSAktif' => (bool) ($cfg['ios_active'] ?? true),
            // Kazı kazan kuponları Ticimax panelinde ayrı grupta görünsün.
            'GrupAdi' => $variant === 'scratch' ? 'Kazı Kazan' : (string) ($cfg['grup_adi'] ?? 'Çark'),
            'IndirimliUrunleKullanilabilir' => true,
            // Tüm kampanyalarla birlikte kullanılabilir (kullanıcı kararı).
            'BaskaKampanyalarlaBilestirilebilir' => true,
            'SepetteKosulsuzGoster' => false,
        ];
    }

    /**
     * Tenant'ın aktif Ticimax kanalından TicimaxService kurar (ecommerce tercih edilir).
     */
    private function resolveTicimaxService(int $tenantId): ?TicimaxService
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

    /**
     * Benzersiz, okunabilir kupon kodu üretir: PREFIX-XXXXX
     * (PREFIX dilim şablonundan ya da config'ten; XXXXX karışıklığı önleyen rastgele ek).
     */
    private function generateCode(WheelCampaign $campaign, WheelSlice $slice, ?string $forcePrefix = null): string
    {
        $base = $forcePrefix
            ?: $slice->coupon_code_template
            ?: ($slice->settings['code'] ?? null)
            ?: config('wheel.coupon.code_prefix', 'CARK');

        $base = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $base)) ?: 'CARK';

        do {
            $code = $base . '-' . strtoupper(Str::random(5));
        } while (
            WheelSpin::query()
                ->where('tenant_id', $campaign->tenant_id)
                ->where('coupon_code', $code)
                ->exists()
        );

        return $code;
    }
}
