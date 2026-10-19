<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Recommendation\CartRecommender;
use App\Services\Recommendation\CheckoutOfferCoupon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Sepet Önerisi widget'ı — public uçlar (auth yok, slug ile tenant).
 *
 * config     → widget görünüm/davranış ayarları (panelden yönetilir, no-store)
 * cart-offer → sepete eklenen ürüne göre öneri seti (beden filtreli, üye-farkındalıklı)
 * event      → impression/click/atc olayları (sendBeacon text/plain destekli)
 */
class PublicRecController extends Controller
{
    /** GET w/{slug}/rec/config */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $s = $tenant->settings ?? [];

        if (! filter_var($s['rec_cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['enabled' => false])->header('Cache-Control', 'no-store');
        }

        $timer = (int) ($s['rec_cart_timer_seconds'] ?? 300);
        $timer = max(0, min(3600, $timer));

        $max = (int) ($s['rec_cart_max_products'] ?? 4);
        $max = max(1, min(8, $max));

        $coTimer = (int) ($s['rec_checkout_timer_seconds'] ?? 180);
        $coTimer = max(0, min(3600, $coTimer));
        $coMax = (int) ($s['rec_checkout_max_products'] ?? 6);
        $coMax = max(1, min(10, $coMax));

        return response()
            ->json([
                'enabled' => true,
                // Yüzey 1: Sepete Ekleme Önerisi (ürün sepete eklendiği an)
                'atc_enabled' => filter_var($s['rec_cart_atc_enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
                'title' => (string) ($s['rec_cart_title'] ?? 'Sepetindekiyle çok iyi gidiyor'),
                'subtitle' => (string) ($s['rec_cart_subtitle'] ?? 'Bu ürünü alanlar bunları da ekledi'),
                'badge' => (string) ($s['rec_cart_badge'] ?? ''),
                'cta' => (string) ($s['rec_cart_cta'] ?? 'Sepete Ekle'),
                'timer_seconds' => $timer,
                'max_products' => $max,
                // Yüzey 2: Ödeme Adımı Önerisi — checkout sayfası İÇİNDE inline bloklar
                // (üst: timer'lı kompakt şerit, alt: timersız geniş grid)
                'checkout_enabled' => filter_var($s['rec_checkout_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'co_title' => (string) ($s['rec_checkout_title'] ?? 'Son bir fırsat!'),
                'co_subtitle' => (string) ($s['rec_checkout_subtitle'] ?? 'Sepetindekilerle en çok birlikte alınanlar'),
                'co_badge' => (string) ($s['rec_checkout_badge'] ?? ''),
                'co_cta' => (string) ($s['rec_checkout_cta'] ?? 'Sepete Ekle'),
                'co_timer_seconds' => $coTimer,
                'co_max_products' => $coMax,
                'co_top_enabled' => filter_var($s['rec_checkout_top_enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
                'co_top_count' => max(1, min(6, (int) ($s['rec_checkout_top_count'] ?? 3))),
                'co_top_selector' => trim((string) ($s['rec_checkout_top_selector'] ?? '')),
                'co_bottom_enabled' => filter_var($s['rec_checkout_bottom_enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
                'co_bottom_title' => (string) ($s['rec_checkout_bottom_title'] ?? 'Bunları da beğenebilirsin'),
                'co_bottom_selector' => trim((string) ($s['rec_checkout_bottom_selector'] ?? '')),
                // "Sana Özel Teklif" — üst blok tek ürünlü süreli teklif olarak çizilir
                // mode=campaign: mağazanın mevcut kampanyası (rozet metni), kupon YOK
                // mode=coupon : CTA'da Ticimax'ta tek kullanımlık gerçek kupon açılır + otomatik uygulanır
                'offer' => $this->offerSettings($s),
                'accent' => $this->color((string) ($s['rec_cart_accent'] ?? ''), '#111111'),
                'highlight' => $this->color((string) ($s['rec_cart_highlight'] ?? ''), '#e11d48'),
                'now' => (int) round(microtime(true) * 1000),
            ])
            ->header('Cache-Control', 'no-store');
    }

    /** GET w/{slug}/rec/cart-offer?product=&variant=&member=&sid= */
    public function cartOffer(Request $request, string $slug, CartRecommender $recommender): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $s = $tenant->settings ?? [];
        if (! filter_var($s['rec_cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['items' => []])->header('Cache-Control', 'no-store');
        }

        $pid = trim((string) $request->query('product', ''));
        $variant = trim((string) $request->query('variant', ''));
        if ($pid !== '' && ! preg_match('/^\d{1,18}$/', $pid)) {
            $pid = '';
        }
        if ($variant !== '' && ! preg_match('/^\d{1,18}$/', $variant)) {
            $variant = '';
        }
        if ($pid === '' && $variant === '') {
            return response()->json(['items' => []], 422);
        }

        $member = trim((string) $request->query('member', ''));
        $max = (int) ($s['rec_cart_max_products'] ?? 4);

        $result = $recommender->recommend(
            $tenant->id,
            $pid !== '' ? $pid : null,
            $variant !== '' ? $variant : null,
            $member !== '' ? $member : null,
            max(1, min(8, $max))
        );

        return response()
            ->json([
                'items' => $result['items'],
                'size' => $result['size'],
                'personalized' => $result['customer_id'] !== null,
                'source_id' => $result['source_id'],
            ])
            ->header('Cache-Control', 'no-store');
    }

    /**
     * GET w/{slug}/rec/checkout-offer?items=p:v:q,p:v:q&member=&sid=
     * Ödeme Adımı Önerisi — sepetin tamamına göre (satır formatı platformProductId:platformVariantId:adet).
     */
    public function checkoutOffer(Request $request, string $slug, CartRecommender $recommender): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $s = $tenant->settings ?? [];
        if (! filter_var($s['rec_cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)
            || ! filter_var($s['rec_checkout_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['items' => []])->header('Cache-Control', 'no-store');
        }

        // items=p:v:q:b — b (barkod) opsiyonel; checkout SPA'sında varyantın en
        // güvenilir anahtarı barkoddur (bkz. CartRecommender::recommendForCart)
        $lines = [];
        foreach (explode(',', (string) $request->query('items', '')) as $chunk) {
            $parts = explode(':', trim($chunk));
            if (count($parts) < 2) {
                continue;
            }
            $lines[] = [
                'p' => $parts[0],
                'v' => $parts[1],
                'q' => (int) ($parts[2] ?? 1),
                'b' => isset($parts[3]) ? preg_replace('/[^A-Za-z0-9\-_.]/', '', $parts[3]) : '',
            ];
        }
        if (empty($lines)) {
            return response()->json(['items' => []], 422);
        }

        $member = trim((string) $request->query('member', ''));
        $max = (int) ($s['rec_checkout_max_products'] ?? 6);

        $result = $recommender->recommendForCart(
            $tenant->id,
            $lines,
            $member !== '' ? $member : null,
            max(1, min(10, $max))
        );

        // Teklif ürünü = ilk öneri; kupon modunda müşteriye gösterilecek indirimli fiyat önden hesaplanır
        $offer = $this->offerSettings($s);
        $hero = null;
        if (! empty($result['items'])) {
            $it = $result['items'][0];
            $unit = (float) (($it['discounted'] ?? null) ?: $it['price']);
            $hero = ['product_id' => $it['id'], 'mode' => $offer['mode']];
            if ($offer['mode'] === 'coupon' && $unit > 0) {
                $amount = floor(min($unit * $offer['percent'] / 100, $offer['max_amount'] > 0 ? $offer['max_amount'] : PHP_FLOAT_MAX));
                $amount = max(1.0, $amount);
                if ($amount >= $unit) {
                    $amount = max(1.0, floor($unit * 0.5));
                }
                $hero['amount'] = $amount;
                $hero['percent'] = (int) round($amount / $unit * 100);
                $hero['price_after'] = round($unit - $amount, 2);
            }
        }

        return response()
            ->json([
                'items' => $result['items'],
                'sizes' => $result['sizes'],
                'personalized' => $result['customer_id'] !== null,
                'source_ids' => $result['source_ids'],
                'hero' => $hero,
            ])
            ->header('Cache-Control', 'no-store');
    }

    /**
     * POST w/{slug}/rec/claim — müşteri "Sana Özel Teklif" CTA'sına bastı.
     * Body (JSON veya text/plain JSON): product_id (bizim id), variant_id, total (sepet ürün toplamı), member, sid, remaining (sn).
     * mode=coupon → Ticimax'ta tek kullanımlık kupon açılır ve kod döner (widget otomatik uygular).
     * Aynı oturum + ürün için 30 dk içinde tekrar istek → aynı kod (çift tık / yenileme).
     */
    public function claim(Request $request, string $slug, CheckoutOfferCoupon $coupons): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['ok' => false], 404);
        }
        if (! $request->isJson() && $request->getContent() !== '') {
            $decoded = json_decode($request->getContent(), true);
            if (is_array($decoded)) {
                $request->merge($decoded);
            }
        }

        $s = $tenant->settings ?? [];
        if (! filter_var($s['rec_cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)
            || ! filter_var($s['rec_checkout_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['ok' => false, 'error' => 'disabled'], 403);
        }

        $productId = (int) $request->input('product_id', 0);
        if ($productId <= 0) {
            return response()->json(['ok' => false, 'error' => 'product'], 422);
        }
        $product = DB::table('products')->where('tenant_id', $tenant->id)->where('id', $productId)
            ->first(['id', 'platform_product_id', 'name', 'price', 'discounted_price']);
        if (! $product) {
            return response()->json(['ok' => false, 'error' => 'product'], 404);
        }

        $offer = $this->offerSettings($s);
        $sid = mb_substr(trim((string) $request->input('sid', '')), 0, 64);
        $member = trim((string) $request->input('member', ''));
        $customerId = $this->resolveCustomer($tenant->id, $member);
        $variantId = preg_replace('/[^0-9]/', '', (string) $request->input('variant_id', '')) ?: null;
        $cartTotal = max(0.0, (float) $request->input('total', 0));
        $isTest = $this->isTestTraffic($request);
        $price = (float) $product->price;
        $discounted = (float) ($product->discounted_price ?? 0);
        $unit = ($discounted > 0 && $discounted < $price) ? $discounted : $price;

        // Aynı oturum+ürün: 30 dk içinde açılmış kupon varsa onu döndür (çift tık / sayfa yenileme)
        if ($sid !== '') {
            $existing = DB::table('rec_offers')
                ->where('tenant_id', $tenant->id)->where('session_id', $sid)->where('product_id', $productId)
                ->where('created_at', '>=', now()->subMinutes(30))
                ->whereIn('status', ['issued', 'claimed'])
                ->orderByDesc('id')->first();
            if ($existing) {
                return response()->json([
                    'ok' => true,
                    'mode' => $existing->mode,
                    'code' => $existing->coupon_code,
                    'amount' => $existing->discount_amount !== null ? (float) $existing->discount_amount : null,
                    'expires_at' => $existing->expires_at ? strtotime($existing->expires_at) * 1000 : null,
                    'reused' => true,
                ])->header('Cache-Control', 'no-store');
            }
        }

        $row = [
            'tenant_id' => $tenant->id,
            'session_id' => $sid !== '' ? $sid : null,
            'customer_id' => $customerId,
            'platform_member_id' => $member !== '' ? mb_substr($member, 0, 32) : null,
            'product_id' => $productId,
            'platform_product_id' => (string) $product->platform_product_id,
            'platform_variant_id' => $variantId,
            'mode' => $offer['mode'],
            'product_price' => round($unit, 2),
            'cart_total' => round($cartTotal, 2),
            'ip_address' => mb_substr((string) $request->ip(), 0, 64),
            'is_test' => $isTest,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        if ($offer['mode'] !== 'coupon') {
            $row['status'] = 'claimed';
            DB::table('rec_offers')->insert($row);

            return response()->json(['ok' => true, 'mode' => 'campaign'])->header('Cache-Control', 'no-store');
        }

        // Test trafiğinde (hub demo sayfası) Ticimax'a yazma — sahte kod döndür
        if ($isTest) {
            $row += ['status' => 'issued', 'coupon_code' => 'DEMO-TEST', 'discount_percent' => $offer['percent'],
                'discount_amount' => floor($unit * $offer['percent'] / 100), 'expires_at' => now()->addMinutes($offer['valid_minutes'])];
            DB::table('rec_offers')->insert($row);

            return response()->json(['ok' => true, 'mode' => 'coupon', 'code' => 'DEMO-TEST', 'amount' => $row['discount_amount'],
                'expires_at' => $row['expires_at']->getTimestamp() * 1000, 'demo' => true])->header('Cache-Control', 'no-store');
        }

        $res = $coupons->issue(
            $tenant->id,
            ['id' => $productId, 'price' => $price, 'discounted' => $discounted > 0 ? $discounted : null],
            $cartTotal,
            $offer['percent'],
            $offer['max_amount'],
            $offer['valid_minutes'],
            $member !== '' ? $member : null
        );

        if (! ($res['success'] ?? false)) {
            $row += ['status' => 'failed', 'error' => mb_substr((string) ($res['error'] ?? ''), 0, 255), 'discount_percent' => $offer['percent']];
            DB::table('rec_offers')->insert($row);

            // Kupon açılamadı → widget ürünü yine ekler, kampanya moduna düşer
            return response()->json(['ok' => true, 'mode' => 'campaign', 'fallback' => true])->header('Cache-Control', 'no-store');
        }

        $row += [
            'status' => 'issued',
            'coupon_code' => $res['code'],
            'coupon_id' => $res['id'] ?: null,
            'discount_percent' => $offer['percent'],
            'discount_amount' => $res['amount'],
            'min_basket' => $res['min_basket'],
            'expires_at' => $res['expires_at'],
        ];
        DB::table('rec_offers')->insert($row);

        return response()->json([
            'ok' => true,
            'mode' => 'coupon',
            'code' => $res['code'],
            'amount' => $res['amount'],
            'expires_at' => $res['expires_at']->getTimestamp() * 1000,
        ])->header('Cache-Control', 'no-store');
    }

    /** @return array{mode:string, percent:float, max_amount:float, valid_minutes:int, title:string, text:string, cta:string, applied:string} */
    protected function offerSettings(array $s): array
    {
        $mode = strtolower(trim((string) ($s['rec_checkout_offer_mode'] ?? 'campaign')));
        $percent = (float) ($s['rec_checkout_offer_percent'] ?? 10);

        return [
            'mode' => $mode === 'coupon' ? 'coupon' : 'campaign',
            'percent' => max(1, min(70, $percent)),
            'max_amount' => max(0, (float) ($s['rec_checkout_offer_max_amount'] ?? 0)),
            'valid_minutes' => max(5, min(240, (int) ($s['rec_checkout_offer_valid_minutes'] ?? 20))),
            'title' => (string) ($s['rec_checkout_offer_title'] ?? 'Sana özel teklif'),
            'text' => (string) ($s['rec_checkout_offer_text'] ?? 'Sepetindekilerle en çok birlikte alınan ürün. Süre dolmadan ekle.'),
            'cta' => (string) ($s['rec_checkout_offer_cta'] ?? 'Teklifi kullan, sepete ekle'),
            'applied' => (string) ($s['rec_checkout_offer_applied'] ?? 'Teklif uygulandı'),
        ];
    }

    /** POST w/{slug}/rec/event — impression (products dizisi) | click | atc (tek ürün) */
    public function event(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['ok' => false], 404);
        }

        // sendBeacon preflight'a takılmasın diye widget text/plain gönderir; body'yi elle çöz
        if (! $request->isJson() && $request->getContent() !== '') {
            $decoded = json_decode($request->getContent(), true);
            if (is_array($decoded)) {
                $request->merge($decoded);
            }
        }

        $type = (string) $request->input('type', '');
        if (! in_array($type, ['impression', 'click', 'atc'], true)) {
            return response()->json(['ok' => false], 422);
        }

        $surface = (string) $request->input('surface', 'atc');
        if (! in_array($surface, ['atc', 'checkout'], true)) {
            $surface = 'atc';
        }

        $sourceId = $request->filled('source_id') ? (int) $request->input('source_id') : null;
        $sid = trim((string) $request->input('sid', ''));
        $sid = $sid !== '' ? mb_substr($sid, 0, 64) : null;
        $customerId = $this->resolveCustomer($tenant->id, trim((string) $request->input('member', '')));
        $isTest = $this->isTestTraffic($request);
        $ip = mb_substr((string) $request->ip(), 0, 64);
        $size = trim((string) $request->input('size', ''));
        $size = $size !== '' ? mb_substr($size, 0, 32) : null;
        $now = now();

        // impression: gösterilen tüm ürünler tek istekte gelir → satır başına yaz
        $products = $type === 'impression'
            ? (array) $request->input('products', [])
            : [['id' => $request->input('product_id'), 'pos' => $request->input('position')]];

        $rows = [];
        foreach (array_slice($products, 0, 12) as $p) {
            $prodId = is_array($p) ? ($p['id'] ?? null) : $p;
            if (! is_numeric($prodId)) {
                continue;
            }
            $rows[] = [
                'tenant_id' => $tenant->id,
                'type' => $type,
                'surface' => $surface,
                'source_product_id' => $sourceId,
                'product_id' => (int) $prodId,
                'variant_size' => $size,
                'position' => is_array($p) && is_numeric($p['pos'] ?? null) ? (int) $p['pos'] : null,
                'session_id' => $sid,
                'customer_id' => $customerId,
                'ip_address' => $ip,
                'is_test' => $isTest,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows) {
            DB::table('rec_events')->insert($rows);
        }

        return response()->json(['ok' => true]);
    }

    protected function resolveCustomer(int $tenantId, string $platformMemberId): ?int
    {
        if ($platformMemberId === '' || ! preg_match('/^\d{1,18}$/', $platformMemberId)) {
            return null;
        }
        $id = DB::table('customers')
            ->where('tenant_id', $tenantId)
            ->where('platform_customer_id', $platformMemberId)
            ->value('id');

        return $id ? (int) $id : null;
    }

    /** Hub'ın kendi domain'inden (demo/test sayfaları) gelen trafik = test. */
    protected function isTestTraffic(Request $request): bool
    {
        $src = $request->header('Origin') ?: $request->header('Referer');
        if (! $src) {
            return false;
        }
        $host = strtolower((string) parse_url($src, PHP_URL_HOST));
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));

        return $host !== '' && $host === $hubHost;
    }

    protected function color(string $value, string $fallback): string
    {
        return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? $value : $fallback;
    }

    protected function resolveTenant(string $slug): ?Tenant
    {
        return Cache::remember(
            "rec:tenant:{$slug}",
            300,
            fn () => Tenant::where('slug', $slug)->where('is_active', true)->first()
        ) ?: null;
    }
}
