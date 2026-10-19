<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Recommendation\RecommendationEngine;
use App\Services\Welcome\TenantWelcomeSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Hoş geldin" ilk alışveriş hediyesi storefront API — /w/{slug}/welcome/config|event (WelcomeCors). */
class PublicWelcomeController extends Controller
{
    public const EVENT_TYPES = ['view', 'reveal', 'copy', 'dismiss', 'cta', 'remind', 'error'];

    protected const ID_RE = '/^(\d{1,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i';

    /**
     * GET config?member=… — metinler + kurallar. member (mağaza müşteri kimliği) verilirse ve hide_customers açıksa,
     * sipariş geçmişi olan müşteriye "eligible=false" döner (ilk alışveriş hediyesi yalnız yeni müşteriye).
     */
    public function config(Request $request, string $slug, RecommendationEngine $engine): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantWelcomeSettings::get($tenant->id);
        $r = $s['rules'];
        $eligible = true;
        $member = trim((string) $request->query('member', ''));
        if ($r['hide_customers'] && $member !== '' && preg_match(self::ID_RE, $member)) {
            $cid = $engine->resolveCustomerId($tenant->id, $member);
            if ($cid) {
                $eligible = ! Cache::remember("welcome:hasorder:{$tenant->id}:{$cid}", 600, fn () => DB::table('orders')
                    ->where('tenant_id', $tenant->id)->where('customer_id', $cid)->where('paid_amount', '>', 0)->exists());
            }
        }

        return response()->json([
            'enabled' => $s['enabled'],
            'eligible' => $eligible,
            'rules' => array_diff_key($r, array_flip(['started_at', 'hide_customers'])),
            'now' => (int) round(microtime(true) * 1000),
        ])->header('Cache-Control', 'no-store');
    }

    public function event(Request $request, string $slug, RecommendationEngine $engine): JsonResponse
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
        $member = trim((string) $request->input('member', ''));
        $customerId = $member !== '' && preg_match(self::ID_RE, $member) ? $engine->resolveCustomerId($tenant->id, $member) : null;

        DB::table('welcome_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'source' => mb_substr(preg_replace('/[^a-z_]/', '', (string) $request->input('source', '')), 0, 16) ?: null,
            'customer_id' => $customerId,
            'cart_id' => mb_substr(preg_replace('/[^A-Za-z0-9\-_]/', '', (string) $request->input('cart_id', '')), 0, 64) ?: null,
            'value' => mb_substr(trim((string) $request->input('value', '')), 0, 160) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'page_type' => mb_substr(preg_replace('/[^a-z_]/', '', strtolower((string) $request->input('page_type', ''))), 0, 16) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $this->fromHub($request),
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }

    protected function fromHub(Request $request): bool
    {
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));

        return $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;
    }
}
