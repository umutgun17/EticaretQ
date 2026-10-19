<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Gallery\TenantGallerySettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Ürün Galerisi storefront API — /w/{slug}/gallery/config|event (GalleryCors). */
class PublicGalleryController extends Controller
{
    /** view (galeri çizildi) | swipe (ana görsel değişti) | thumb (küçük görsele dokunuldu) | open (tam ekran) | zoom | close | error
     *  Ürün videosu A/B: video_expose (videolu ürün sayfası açıldı; A ve B) | video_view (video karesi göründü) | video_play
     *  | video_3s | video_50 | video_100 (izlenme eşikleri) | add_cart (ürün detayda sepete ekle; video A/B karnesi için) */
    public const EVENT_TYPES = ['view', 'swipe', 'thumb', 'open', 'zoom', 'close', 'share', 'download', 'error',
        'video_expose', 'video_view', 'video_play', 'video_3s', 'video_50', 'video_100', 'add_cart'];

    /** Satış atfı (IP + ürün + pencere, search:attribute-conversions gibi) yalnız bu olaylarda IP saklar. */
    protected const IP_TYPES = ['video_expose', 'add_cart'];

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantGallerySettings::get($tenant->id);

        return response()->json([
            'enabled' => $s['enabled'],
            'theme' => $s['theme'],
            'rules' => $s['rules'],
        ])->header('Cache-Control', 'no-store');
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
        $ab = (string) $request->input('ab', '');

        DB::table('gallery_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'product_id' => $pid > 0 ? $pid : null,
            'image_index' => max(0, min(99, (int) $request->input('index', 0))),
            'image_count' => max(0, min(99, (int) $request->input('count', 0))),
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'ab' => in_array($ab, ['A', 'B'], true) ? $ab : null,
            'ip_address' => in_array($type, self::IP_TYPES, true) ? $request->ip() : null,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
