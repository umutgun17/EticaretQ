<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\ForYou\TenantForYouSettings;
use App\Services\Recommendation\RecommendationEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Sana Özel" öneri kulakçığı storefront API — /w/{slug}/foryou/config|suggest|event (ForYouCors). */
class PublicForYouController extends Controller
{
    public const EVENT_TYPES = ['view', 'nudge', 'open', 'close', 'impression', 'click', 'atc', 'error'];

    protected const ID_RE = '/^(\d{1,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i';

    /** GET config — metinler, görünüm ve davranış kuralları (ürün yok; öneri suggest ile gelir). */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantForYouSettings::get($tenant->id);

        return response()->json([
            'enabled' => $s['enabled'],
            'rules' => $s['rules'],
            'now' => (int) round(microtime(true) * 1000),
        ])->header('Cache-Control', 'private, max-age=120');
    }

    /**
     * GET suggest?viewed=pid,pid&cart=p:v:q:b,...&member=&cur=pid&cat=Kategori
     * viewed = gezilen ürünler (en yeni önce), cur = bulunulan ürün sayfası, cat = bulunulan kategori sayfası.
     */
    public function suggest(Request $request, string $slug, RecommendationEngine $engine): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantForYouSettings::get($tenant->id);
        if (! $s['enabled'] && ! $this->fromHub($request)) {
            return response()->json(['items' => [], 'mode' => 'off']);
        }
        $r = $s['rules'];
        $limit = (int) $r['count'];

        $viewed = [];
        foreach (explode(',', (string) $request->query('viewed', '')) as $pid) {
            $pid = trim($pid);
            if ($pid !== '' && preg_match(self::ID_RE, $pid) && ! in_array($pid, $viewed, true)) {
                $viewed[] = $pid;
            }
            if (count($viewed) >= 12) {
                break;
            }
        }
        $cart = [];
        foreach (explode(',', (string) $request->query('cart', '')) as $chunk) {
            $parts = explode(':', trim($chunk));
            if (count($parts) < 2 || ($parts[0] === '' && $parts[1] === '' && ($parts[3] ?? '') === '')) {
                continue;
            }
            $cart[] = [
                'p' => substr(preg_replace('/[^A-Za-z0-9\-]/', '', $parts[0]), 0, 64),
                'v' => substr(preg_replace('/[^A-Za-z0-9\-]/', '', $parts[1]), 0, 64),
                'q' => (int) ($parts[2] ?? 1),
                'b' => isset($parts[3]) ? substr(preg_replace('/[^A-Za-z0-9\-_.]/', '', $parts[3]), 0, 64) : '',
            ];
            if (count($cart) >= 40) {
                break;
            }
        }
        $member = trim((string) $request->query('member', ''));
        $member = $member !== '' && preg_match(self::ID_RE, $member) ? $member : null;
        $cur = trim((string) $request->query('cur', ''));
        $cur = $cur !== '' && preg_match(self::ID_RE, $cur) ? $cur : null;
        $cat = mb_substr(trim((string) $request->query('cat', '')), 0, 80) ?: null;

        $config = (int) config('rec.engine.recent_sales_days', 30);
        config(['rec.engine.recent_sales_days' => (int) $r['bestseller_days']]);
        try {
            // Sinyalsiz akış (çok satan / kategori) herkese aynı → 10 dk önbellek; kişisel akış önbelleksiz
            $signalless = ! $viewed && ! $cart && ! $member;
            $compute = fn () => $engine->forVisitor($tenant->id, $viewed, $cart, $member, $cur, $cat, $limit, (bool) $r['use_history']);
            $res = $signalless
                ? Cache::remember('foryou:base:'.$tenant->id.':'.md5(($cur ?? '').'|'.($cat ?? '').'|'.$limit.'|'.$r['bestseller_days']), 600, $compute)
                : $compute();
        } catch (\Throwable $e) {
            report($e);
            $res = ['items' => [], 'mode' => 'bestseller', 'category' => null, 'customer_id' => null];
        } finally {
            config(['rec.engine.recent_sales_days' => $config]);
        }

        $items = [];
        foreach ($res['items'] as $it) {
            if (empty($it['url']) || empty($it['image']) || (float) $it['price'] <= 0) {
                continue;
            }
            $items[] = array_intersect_key($it, array_flip(['id', 'pid', 'name', 'url', 'image', 'price', 'discounted', 'variant_id', 'low_stock']));
            if (count($items) >= $limit) {
                break;
            }
        }
        $subtitle = (string) ($r['subtitle_'.$res['mode']] ?? '');
        $subtitle = str_replace('{category}', (string) ($res['category'] ?? ''), $subtitle);

        return response()->json([
            'mode' => $res['mode'],
            'category' => $res['category'],
            'subtitle' => trim($subtitle),
            'items' => $items,
            'member_known' => (bool) $res['customer_id'],
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
        $mode = (string) $request->input('mode', '');
        $source = mb_substr(preg_replace('/[^a-z_]/', '', (string) $request->input('source', '')), 0, 16);
        $member = trim((string) $request->input('member', ''));
        $customerId = $member !== '' && preg_match(self::ID_RE, $member) ? $engine->resolveCustomerId($tenant->id, $member) : null;
        $cartId = mb_substr(preg_replace('/[^A-Za-z0-9\-_]/', '', (string) $request->input('cart_id', '')), 0, 64) ?: null;

        DB::table('foryou_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'mode' => in_array($mode, TenantForYouSettings::MODES, true) ? $mode : null,
            'source' => $source ?: null,
            'product_id' => (int) preg_replace('/[^0-9]/', '', (string) $request->input('product_id', '')) ?: null,
            'position' => $request->filled('position') ? max(0, min(99, (int) $request->input('position'))) : null,
            'customer_id' => $customerId,
            'cart_id' => $cartId,
            'value' => mb_substr(trim((string) $request->input('value', '')), 0, 160) ?: null,
            'ip_address' => mb_substr((string) $request->ip(), 0, 45),
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
