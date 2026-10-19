<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\AppPromo\TenantAppPromoSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * "Uygulamaya Özel" kulakçığı storefront API — /w/{slug}/app/config|event|go (AppPromoCors).
 * /go: QR ve butonların tek çıkış noktası — cihazı tanır, olayı yazar, mağazaya 302 atar.
 */
class PublicAppPromoController extends Controller
{
    public const EVENT_TYPES = ['view', 'open', 'close', 'click', 'copy', 'dismiss', 'error'];

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantAppPromoSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
        $rules = $s['rules'];
        $endsAt = null;
        if ($rules['valid_until']) {
            $endsAt = \Carbon\Carbon::createFromFormat('Y-m-d', $rules['valid_until'], 'Europe/Istanbul')->endOfDay()->getTimestamp() * 1000;
            if ($endsAt < time() * 1000) {
                // Süresi dolmuş kampanya: widget hiçbir şey göstermez
                return response()->json(['expired' => true, 'theme' => $s['theme'], 'rules' => $rules])->header('Cache-Control', 'public, max-age=60');
            }
        }
        $base = rtrim((string) config('app.url'), '/');

        return response()->json([
            'theme' => $s['theme'],
            'rules' => $rules,
            'go_url' => $base.'/w/'.$tenant->slug.'/app/go',
            'ends_at' => $endsAt,
            'now' => (int) round(microtime(true) * 1000),
            'shop_url' => $shop,
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'platform' => (string) ($ts['platform'] ?? 'ticimax'),
        ])->header('Cache-Control', 'public, max-age=60');
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
        $platform = (string) $request->input('platform', '');

        DB::table('app_promo_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'source' => mb_substr((string) $request->input('source', ''), 0, 24) ?: null,
            'platform' => in_array($platform, ['ios', 'android', 'desktop', 'other', 'inapp_ios', 'inapp_android'], true) ? $platform : null,
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'ip_address' => in_array($type, ['click', 'copy'], true) ? mb_substr((string) $request->ip(), 0, 45) : null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'page_type' => mb_substr((string) $request->input('page_type', ''), 0, 16) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ] + self::attribution($request));

        return response()->json(['ok' => true]);
    }

    /**
     * GET /w/{slug}/app/go?src=qr|tab|panel&sid=…&p=ios|android — QR taraması ve butonların tek çıkışı.
     * Cihazı UA'dan (veya ?p ile) tanır, 'redirect' olayını yazar, mağazaya 302 atar.
     * Masaüstü/bilinmeyen cihaz: landing_url (mağazanın /app-indir sayfası) → yoksa ios_url.
     */
    public function go(Request $request, string $slug)
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            abort(404);
        }
        $s = TenantAppPromoSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
        $r = $s['rules'];
        if (! $s['enabled']) {
            return $this->fallback($shop, $r);
        }
        $ua = (string) $request->userAgent();
        $p = strtolower((string) $request->query('p', ''));
        $platform = in_array($p, ['ios', 'android'], true) ? $p : self::platformFromUa($ua);
        $target = match ($platform) {
            'ios' => $r['ios_url'] ?: '',
            'android' => $r['android_url'] ?: '',
            default => '',
        };
        if ($target === '') {
            $landing = (string) $r['landing_url'];
            if ($landing !== '' && ! preg_match('~^https?://~', $landing)) {
                $landing = $shop.'/'.ltrim($landing, '/');
            }
            $target = $landing !== '' ? $landing : ($r['ios_url'] ?: $r['android_url'] ?: $shop);
        }
        $attr = self::attribution($request);
        if ($platform === 'android' && str_contains($target, 'play.google.com/store/apps')) {
            $target = self::withInstallReferrer($target, $attr, (string) $request->query('gclid', ''));
        }
        $src = mb_substr(preg_replace('/[^a-z0-9_]/', '', strtolower((string) $request->query('src', ''))) ?: 'link', 0, 24);
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $ref = (string) $request->header('Referer');
        $isTest = $ref !== '' && strtolower((string) parse_url($ref, PHP_URL_HOST)) === $hubHost;
        try {
            DB::table('app_promo_events')->insert([
                'tenant_id' => $tenant->id,
                'session_id' => mb_substr(trim((string) $request->query('sid', '')), 0, 64) ?: null,
                'type' => 'redirect',
                'source' => $src,
                'platform' => $platform,
                'value' => mb_substr($target, 0, 160),
                'ip_address' => mb_substr((string) $request->ip(), 0, 45),
                'user_agent' => mb_substr($ua, 0, 200) ?: null,
                'device' => in_array($platform, ['ios', 'android'], true) ? 'm' : 'd',
                'is_test' => $isTest,
                'created_at' => now(),
            ] + $attr);
        } catch (\Throwable $e) {
            // yönlendirme olay yazımından bağımsız çalışır
        }

        return redirect()->away($target, 302)->withHeaders(['Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex']);
    }

    /**
     * Widget'ın gönderdiği son kampanya dokunuşu (ch, us, um, uc) — olay satırına yazılır.
     * ch: meta | google | other; utm'ler ziyaretçinin siteye geldiği linkten (7 gün saklanır).
     */
    public static function attribution(Request $request): array
    {
        $clean = fn ($v, $n) => mb_substr(trim(preg_replace('/[\x00-\x1F<>"]/u', '', (string) $v) ?? ''), 0, $n) ?: null;
        $ch = strtolower((string) $request->input('ch', ''));

        return [
            'channel' => in_array($ch, ['meta', 'google', 'other'], true) ? $ch : null,
            'utm_source' => $clean($request->input('us'), 64),
            'utm_medium' => $clean($request->input('um'), 64),
            'utm_campaign' => $clean($request->input('uc'), 128),
        ];
    }

    /**
     * Google Play linkine install referrer ekler → uygulama ilk açılışta (Firebase/GA4) kaynağı
     * web'deki reklam etiketiyle görür. Etiket yoksa "web / app_promo" yazılır (web→uygulama geçişi
     * en azından ayırt edilsin). gclid varsa Google Ads atfı için referrer'a eklenir.
     */
    public static function withInstallReferrer(string $url, array $attr, string $gclid = ''): string
    {
        $ref = [
            'utm_source' => $attr['utm_source'] ?: ($attr['channel'] === 'google' ? 'google' : 'web'),
            'utm_medium' => $attr['utm_medium'] ?: ($attr['channel'] === 'google' ? 'cpc' : 'app_promo'),
            'utm_campaign' => $attr['utm_campaign'] ?: 'uygulamaya_ozel',
            'utm_content' => 'app_promo',
        ];
        $gclid = preg_replace('/[^A-Za-z0-9_\-]/', '', $gclid);
        if ($gclid !== '') {
            $ref['gclid'] = mb_substr($gclid, 0, 200);
        }
        $url = preg_replace('/([?&])referrer=[^&]*&?/', '$1', $url);
        $url = rtrim($url, '?&');

        return $url.(str_contains($url, '?') ? '&' : '?').'referrer='.rawurlencode(http_build_query($ref));
    }

    protected function fallback(string $shop, array $r): RedirectResponse
    {
        $landing = (string) ($r['landing_url'] ?? '');
        if ($landing !== '' && ! preg_match('~^https?://~', $landing)) {
            $landing = $shop.'/'.ltrim($landing, '/');
        }

        return redirect()->away($landing !== '' ? $landing : ($shop ?: '/'), 302);
    }

    /** ios | android | desktop | other — Ticimax uygulama UA'ları (TicimaxiOS/TicimaxAndroid) da mobil sayılır. */
    public static function platformFromUa(string $ua): string
    {
        if ($ua === '') {
            return 'other';
        }
        if (preg_match('/iPhone|iPad|iPod|TicimaxiOS/i', $ua)) {
            return 'ios';
        }
        // iPadOS 13+ Safari kendini Macintosh olarak tanıtır; dokunmatik ayrımı istemcide yapılır
        if (preg_match('/Android|TicimaxAndroid/i', $ua)) {
            return 'android';
        }
        if (preg_match('/Windows|Macintosh|X11|Linux|CrOS/i', $ua)) {
            return 'desktop';
        }

        return 'other';
    }
}
