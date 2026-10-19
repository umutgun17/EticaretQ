<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Flash\TenantFlashSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Flaş İndirim" ana sayfa vitrini storefront API — /w/{slug}/flash/config|event (FlashCors). */
class PublicFlashController extends Controller
{
    public const EVENT_TYPES = ['view', 'click', 'atc', 'coupon', 'tab', 'cta', 'error'];

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantFlashSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $day = now('Europe/Istanbul')->format('Y-m-d');
        // Rotasyon: rotate_hours > 0 ise liste her periyotta rotate_step kadar kayar (segment sırası korunur) → ana sayfa 4'lüsü değişir
        $rotH = ($s['rules']['rotate_mode'] ?? 'time') === 'visitor' ? 0 : max(0, (int) ($s['rules']['rotate_hours'] ?? 0)); // visitor modunda rotasyon istemci tarafında
        $period = $rotH > 0 ? intdiv((int) floor(now('Europe/Istanbul')->getTimestamp() / 3600), $rotH) : 0;
        $payload = Cache::remember("flash:config:{$tenant->id}:{$day}:{$period}", 60, function () use ($tenant, $s, $ts, $day, $rotH, $period) {
            $set = TenantFlashSettings::activeSet($s['sets'], $day);
            $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
            $products = $set ? self::products($tenant->id, $set['products'], $shop) : [];
            // Beden eksikse (stokta < min_sizes beden) vitrine koyma: 'Hemen Al' deyince 2 beden görmek güven kırar
            $minSizes = (int) ($s['rules']['min_sizes'] ?? 3);
            $products = array_values(array_filter($products, fn ($p) => ! $p['variants'] || count($p['variants']) >= $minSizes || count($p['variants']) === 1));
            if ($rotH > 0 && count($products) > 1) {
                $step = max(1, (int) ($s['rules']['rotate_step'] ?? 4));
                $off = ($period * $step) % count($products);
                $products = array_merge(array_slice($products, $off), array_slice($products, 0, $off));
            }

            return [
                'set' => $set ? [
                    'id' => $set['id'],
                    'title' => $set['title'] !== '' ? $set['title'] : $s['rules']['title'],
                    'subtitle' => $set['subtitle'] !== '' ? $set['subtitle'] : $s['rules']['subtitle'],
                    'eyebrow' => $set['eyebrow'] !== '' ? $set['eyebrow'] : $s['rules']['eyebrow'],
                    'coupon' => $set['coupon'],
                    'coupon_mode' => $set['coupon_mode'] ?? ($set['coupon'] !== '' ? 'code' : 'none'),
                    'coupon_text' => $set['coupon_text'],
                    'coupon_pct' => (int) ($set['coupon_pct'] ?? 0),
                    'start_date' => $set['start_date'],
                    'end_date' => $set['end_date'],
                ] : null,
                'products' => $products,
                'ends_at' => PublicHeroController::endsAt($s['rules']['timer_mode'], $set),
            ];
        });

        return response()->json([
            'theme' => $s['theme'],
            'rules' => $s['rules'],
            'set' => $payload['set'],
            'products' => $payload['products'],
            'ends_at' => $payload['ends_at'],
            'now' => (int) round(microtime(true) * 1000),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'platform' => (string) ($ts['platform'] ?? (str_contains(strtolower((string) ($ts['shop_url'] ?? '')), 'ikas') ? 'ikas' : 'ticimax')),
        ])->header('Cache-Control', 'public, max-age=60');
    }

    /**
     * Vitrin kartları: hero çözümleyicisi (fiyat/indirim/thumb/stok/beden) + gerçek 14 günlük ÖDENMİŞ satış adedi.
     * Stoksuz/görselsiz ürün vitrine girmez (gerçek veri ilkesi). Sıra korunur.
     */
    public static function products(int $tenantId, array $ids, string $shopUrl = ''): array
    {
        $cards = PublicHeroController::resolveProducts($tenantId, $ids, $shopUrl);
        $cards = array_values(array_filter($cards, fn ($p) => $p['in_stock']));
        if (! $cards) {
            return [];
        }
        $sold = DB::table('order_items as oi')->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->where('o.tenant_id', $tenantId)->where('o.order_date', '>', now()->subDays(14))
            ->where('o.paid_amount', '>', 0)->where('o.payment_status', 1)->where('o.status', '<>', 8)
            ->whereIn('oi.product_id', array_map(fn ($p) => $p['id'], $cards))
            ->groupBy('oi.product_id')->selectRaw('oi.product_id, sum(oi.quantity) q')->pluck('q', 'product_id');

        return array_map(function ($p) use ($sold) {
            $p['sold14'] = (int) ($sold[$p['id']] ?? 0);
            $p['name'] = self::shortName($p['name']);
            unset($p['colors']);

            return $p;
        }, $cards);
    }

    /** "… Kadın Kahve Bot TBMHH005" → SKU kuyruğunu at. */
    public static function shortName(?string $n): string
    {
        $n = trim((string) $n);
        $parts = preg_split('/\s+/', $n);
        while (count($parts) > 2 && preg_match('/^[A-ZÇĞİÖŞÜ0-9\-]{4,}$/u', end($parts)) && preg_match('/\d/', end($parts))) {
            array_pop($parts);
        }

        return implode(' ', $parts);
    }

    public function event(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['ok' => false], 404);
        }
        if (! $request->isJson() && $request->getContent() !== '') {
            $decoded = json_decode($request->getContent(), true);
            if (is_array($decoded)) {
                $request->merge($decoded);
            }
        }
        $type = (string) $request->input('type', '');
        if (! in_array($type, self::EVENT_TYPES, true)) {
            return response()->json(['ok' => false], 422);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $isTest = $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;
        $pid = (int) $request->input('product_id', 0);

        DB::table('flash_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'layout' => mb_substr((string) $request->input('layout', ''), 0, 16) ?: null,
            'set_id' => mb_substr((string) $request->input('set_id', ''), 0, 24) ?: null,
            'product_id' => $pid > 0 ? $pid : null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'ip_address' => in_array($type, ['click', 'atc'], true) ? mb_substr((string) $request->ip(), 0, 45) : null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
