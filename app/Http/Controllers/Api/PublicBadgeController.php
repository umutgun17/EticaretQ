<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Badge\BadgeBuilder;
use App\Services\Badge\TenantBadgeSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Ürün Rozetleri storefront API — /w/{slug}/badges/config|event (BadgeCors). */
class PublicBadgeController extends Controller
{
    public const EVENT_TYPES = ['list_view', 'click', 'pdp_view'];

    /** Widget'ın ihtiyaç duyduğu kural anahtarları (seçiciler + gösterim + kanıt metinleri). */
    public const CLIENT_RULES = ['list_enabled', 'pdp_enabled', 'list_max', 'pdp_max', 'proof_enabled',
        'proof_sold_24h', 'proof_sold_24h_text', 'proof_sold_7d', 'proof_sold_7d_text', 'proof_views', 'proof_views_text',
        'proof_sizes', 'proof_sizes_text', 'proof_round', 'proof_max_lines', 'proof_sold_30d', 'proof_sold_30d_text', 'proof_rank', 'proof_rank_text', 'proof_cart', 'proof_cart_text', 'proof_fav', 'proof_fav_text', 'proof_atc', 'proof_atc_text', 'list_card_selector', 'list_id_selector', 'list_image_selector', 'bar_list_mount', 'bar_pdp_mount',
        'pdp_badge_mount', 'pdp_proof_mount', 'hide_paths', 'pdp_badge_position', 'pdp_image_mount', 'pdp_price_mount'];

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantBadgeSettings::get($tenant->id);
        $map = BadgeBuilder::cached($tenant->id);
        if (! $map && $s['enabled']) {
            // İlk istek: harita yoksa tek seferlik üret (eşzamanlı istekleri kilitle)
            $map = Cache::lock("badge:build:{$tenant->id}", 60)->get(fn () => (new BadgeBuilder)->build($tenant)) ?: null;
        }
        $types = array_values(array_filter($s['types'], fn ($t) => $t['enabled']));
        $rules = array_intersect_key($s['rules'], array_flip(self::CLIENT_RULES));

        return response()->json([
            'enabled' => $s['enabled'],
            'theme' => $s['theme'],
            'rules' => $rules,
            'types' => array_map(fn ($t) => array_intersect_key($t, array_flip(['id', 'kind', 'label', 'color', 'icon', 'list', 'pdp', 'corner', 'design'])), $types),
            'built_at' => $map['built_at'] ?? null,
            'b' => $map['b'] ?? (object) [],
            'p' => $map['p'] ?? (object) [],
        ])->header('Cache-Control', 'private, max-age=300');
    }

    /** Demo/önizleme: rozetli + rozetsiz gerçek ürün örnekleri (ad, görsel, fiyat). */
    public function demo(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $map = BadgeBuilder::cached($tenant->id) ?: [];
        $byType = [];
        foreach ($map['b'] ?? [] as $pid => $list) {
            $first = explode(':', (string) $list[0], 2)[0];
            if (count($byType[$first] ?? []) < 80) {
                $byType[$first][] = (string) $pid;
            }
        }
        $pids = array_merge(...array_values($byType ?: [[]]));
        $pdp = (string) $request->query('pid', '');
        $rows = DB::table('products')->where('tenant_id', $tenant->id)->where('is_active', true)->where('stock_quantity', '>', 0)
            ->where(fn ($w) => $w->whereIn('platform_product_id', array_merge($pids, [$pdp])))
            ->get(['platform_product_id', 'name', 'images', 'price', 'discounted_price', 'url'])->keyBy('platform_product_id');
        $plain = DB::table('products')->where('tenant_id', $tenant->id)->where('is_active', true)->where('stock_quantity', '>', 50)
            ->whereNotIn('platform_product_id', array_keys($map['b'] ?? []) ?: ['-'])->whereNotNull('images')
            ->orderByDesc('platform_created_at')->limit(3)->get(['platform_product_id', 'name', 'images', 'price', 'discounted_price', 'url']);
        $fmt = function ($r) {
            $imgs = json_decode((string) $r->images, true);
            $img = is_array($imgs) ? ($imgs[0]['url'] ?? $imgs[0] ?? null) : null;

            return ['pid' => (string) $r->platform_product_id, 'name' => $r->name, 'image' => is_string($img) ? $img : null,
                'price' => (float) $r->price, 'sale' => (float) ($r->discounted_price ?: $r->price), 'url' => $r->url];
        };
        $items = [];
        foreach ($byType as $list) {
            $n = 0;
            foreach ($list as $pid) {
                if (isset($rows[$pid]) && $n < 3) {
                    $items[] = $fmt($rows[$pid]);
                    $n++;
                }
            }
        }
        foreach ($plain as $r) {
            $items[] = $fmt($r);
        }

        return response()->json(['items' => $items, 'pdp' => isset($rows[$pdp]) ? $fmt($rows[$pdp]) : ($items[0] ?? null)])
            ->header('Cache-Control', 'no-store');
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

        $counts = null;
        if ($type === 'list_view') {
            $c = (array) $request->input('counts', []);
            $by = [];
            foreach ((array) ($c['by'] ?? []) as $k => $n) {
                $k = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $k));
                if ($k !== '' && count($by) < 20) {
                    $by[$k] = max(0, min(5000, (int) $n));
                }
            }
            $counts = json_encode(['total' => max(0, min(5000, (int) ($c['total'] ?? 0))), 'badged' => max(0, min(5000, (int) ($c['badged'] ?? 0))), 'by' => (object) $by]);
        }
        $badge = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $request->input('badge', '')));

        DB::table('badge_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'product_id' => mb_substr(preg_replace('/[^0-9A-Za-z_-]/', '', (string) $request->input('product_id', '')), 0, 32) ?: null,
            'badge' => $badge !== '' ? mb_substr($badge, 0, 40) : null,
            'counts' => $counts,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
