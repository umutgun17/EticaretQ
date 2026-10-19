<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Models\WebPushSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * HALKA AÇIK Web Push akışı (tenant'ın site ziyaretçisi). Auth YOK.
 *
 *  - config: widget'ın aboneliği başlatması için VAPID public key.
 *  - subscribe: tarayıcının ürettiği PushSubscription'ı saklar (endpoint benzersiz).
 *  - unsubscribe: aboneliği pasifler.
 *
 * Public bağlamda Eloquent tenant global-scope pasif → her sorgu açıkça tenant_id ile.
 */
class PublicPushController extends Controller
{
    private function tenant(string $slug): ?Tenant
    {
        return Tenant::where('slug', $slug)->where('is_active', true)->first();
    }

    /** GET w/{slug}/push/config */
    public function config(string $slug): JsonResponse
    {
        $tenant = $this->tenant($slug);
        $publicKey = config('webpush.public_key');

        if (! $tenant || ! $publicKey) {
            return response()->json(['active' => false], 200);
        }

        $s = $tenant->settings ?? [];

        return response()->json([
            'active' => true,
            'vapidPublicKey' => $publicKey,
            // Onay kutusu (soft prompt) — tenant panelden özelleştirebilir
            'prompt' => [
                // title = "<domain> {title}" başlık son eki; body = çan satırı etiketi (native diyalog taklidi)
                'title' => $s['push_prompt_title'] ?? 'bildirim göndermek istiyor',
                'body' => $s['push_prompt_body'] ?? 'İndirim ve kampanyalardan haberdar ol',
                'allow' => $s['push_prompt_allow'] ?? 'İzin Ver',
                'deny' => $s['push_prompt_deny'] ?? 'Engelle',
                'color' => $s['push_prompt_color'] ?? '#4f46e5',
                'position' => $s['push_prompt_position'] ?? 'top-left',
                'delay' => (int) ($s['push_prompt_delay'] ?? 4),  // saniye
                'snooze_days' => (int) ($s['push_prompt_snooze_days'] ?? 7),
            ],
        ]);
    }

    /** POST w/{slug}/push/subscribe */
    public function subscribe(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->tenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $data = $request->validate([
            'endpoint' => ['required', 'string', 'max:1000', 'url'],
            'keys.p256dh' => ['required', 'string', 'max:255'],
            'keys.auth' => ['required', 'string', 'max:255'],
            'visitor_ref' => ['nullable', 'string', 'max:255'],
            'encoding' => ['nullable', 'string', 'max:20'],
        ]);

        // SSRF/abuse koruması: endpoint yalnızca bilinen push servisi olabilir (https).
        // Aksi halde kampanya gönderiminde sunucu saldırgan-seçili URL'ye POST atardı (blind SSRF).
        if (! $this->isAllowedPushEndpoint($data['endpoint'])) {
            return response()->json(['error' => 'invalid_endpoint'], 422);
        }

        $sub = WebPushSubscription::withoutGlobalScopes()->updateOrCreate(
            ['tenant_id' => $tenant->id, 'endpoint' => $data['endpoint']],
            [
                'p256dh' => $data['keys']['p256dh'],
                'auth' => $data['keys']['auth'],
                'encoding' => $data['encoding'] ?? 'aesgcm',
                'origin' => $request->headers->get('Origin'),
                'user_agent' => substr((string) $request->userAgent(), 0, 512),
                'visitor_ref' => $data['visitor_ref'] ?? null,
                'is_active' => true,
                'last_seen_at' => now(),
            ],
        );

        return response()->json(['ok' => true, 'id' => $sub->id]);
    }

    /** POST w/{slug}/push/unsubscribe */
    public function unsubscribe(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->tenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $endpoint = (string) $request->input('endpoint', '');
        if ($endpoint !== '') {
            WebPushSubscription::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->where('endpoint', $endpoint)
                ->update(['is_active' => false]);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Push endpoint yalnızca bilinen sağlayıcı host'larına ve https'e izin verir.
     * (FCM, Mozilla, Windows/WNS, Apple.) Böylece endpoint iç adrese yönlendirilemez.
     */
    private function isAllowedPushEndpoint(string $endpoint): bool
    {
        $parts = parse_url($endpoint);
        if (! $parts || strtolower($parts['scheme'] ?? '') !== 'https') {
            return false;
        }

        $host = strtolower($parts['host'] ?? '');
        if ($host === '') {
            return false;
        }

        $allowedSuffixes = [
            'fcm.googleapis.com',
            'android.googleapis.com',
            'updates.push.services.mozilla.com',
            'push.services.mozilla.com',
            'notify.windows.com',       // *.notify.windows.com
            'push.apple.com',           // *.push.apple.com
        ];

        foreach ($allowedSuffixes as $suffix) {
            if ($host === $suffix || str_ends_with($host, '.' . $suffix)) {
                return true;
            }
        }

        return false;
    }
}
