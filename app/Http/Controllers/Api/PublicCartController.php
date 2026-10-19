<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Cart\TenantCartSettings;
use App\Services\Recommendation\CartRecommender;
use App\Services\Recommendation\RecContext;
use App\Services\Recommendation\RecommendationEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Sepet Kampanyası storefront API — /w/{slug}/cart/config|event (CartCors). */
class PublicCartController extends Controller
{
    /**
     * view   : çubuk çizildi (surface=side|checkout; basis=sepet tutarı; tier=kazanılan kademe sayısı; remaining=sıradakine kalan)
     * update : sepet değişti (aynı alanlar)
     * unlock : yeni kademe kazanıldı (tier=kazanılan kademenin sırası 1..n)
     * cta    : ek bağlantı butonu tıklandı
     * checkout: yan sepetten "alışverişi tamamla / sepeti gör" tıklandı
     * suggest: "sepetini tamamla" öneri şeridi gösterildi (value = ürün id listesi)
     * add    : öneri şeridinden ürün sepete eklendi (value = ürün id; tier = eklemeden ÖNCE kazanılmış kademe)
     * add_fail: ekleme başarısız → ürün sayfasına yönlendirildi
     */
    public const EVENT_TYPES = ['view', 'update', 'unlock', 'cta', 'checkout', 'suggest', 'add', 'add_fail', 'error'];

    /**
     * GET /w/cart-resolve?host=www.tonnyblack.com.tr → {slug}: mağaza alan adından tenant.
     * Ticimax checkout SPA'sı panelden enjekte ettiği script etiketinin data-tenant özniteliğini düşürdüğü için widget alan adından çözer.
     */
    public function resolve(Request $request): JsonResponse
    {
        $host = strtolower(trim((string) $request->query('host', '')));
        $host = preg_replace('~^https?://~', '', $host) ?? $host;
        $host = explode('/', $host)[0];
        $bare = preg_replace('~^www\.~', '', $host) ?? $host;
        $slug = null;
        if ($bare !== '') {
            $slug = \Illuminate\Support\Facades\Cache::remember('cart:resolve:'.$bare, 300, function () use ($host, $bare) {
                foreach (DB::table('tenants')->where('is_active', true)->get(['slug', 'settings']) as $t) {
                    $s = is_string($t->settings) ? (json_decode($t->settings, true) ?: []) : ((array) $t->settings);
                    if (! filter_var($s['cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                        continue;
                    }
                    foreach (explode(',', (string) ($s['cart_domains'] ?? '')) as $d) {
                        $d = strtolower(trim($d));
                        $d = preg_replace('~^www\.~', '', $d) ?? $d;
                        if ($d !== '' && ($d === $bare || $d === $host)) {
                            return $t->slug;
                        }
                    }
                }

                return '';
            });
        }
        $res = response()->json($slug ? ['slug' => $slug] : ['slug' => null], $slug ? 200 : 404);
        $res->headers->set('Access-Control-Allow-Origin', '*');
        $res->headers->set('Cache-Control', 'public, max-age=300');

        return $res;
    }

    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantCartSettings::get($tenant->id);

        return response()->json([
            'enabled' => $s['enabled'],
            'theme' => $s['theme'],
            'rules' => $s['rules'],
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * GET /w/{slug}/cart/suggest?items=p:v:q:b,...&remaining=300&member=&surface=side|checkout
     * "Sepetini tamamla" ürün önerileri: Ürün Öneri motorunun sepet-bazlı adayları (birlikte alım → kategori karışımı → genel en iyiler),
     * sıradaki kademeye KALAN tutarı tek başına kapatan (unlocks) ürünler öne, onların içinde en ucuz olan ilk sırada;
     * kalanı fiyata göre azalan. Sepet çözülemezse (anchor yok) genel en iyilerden devam eder.
     * p = ürün kartı id (Ticimax UrunKartId), v = varyant id (UrunId), b = barkod (checkout'ta en güvenilir anahtar).
     */
    public function suggest(Request $request, string $slug, CartRecommender $recommender, RecommendationEngine $engine): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantCartSettings::get($tenant->id);
        if (! $s['enabled'] || ! filter_var($s['rules']['suggest_enabled'] ?? true, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['items' => []])->header('Cache-Control', 'no-store');
        }
        $max = max(2, min(8, (int) ($s['rules']['suggest_max'] ?? 4)));
        $want = min(10, $max + 4); // istemci kalan tutar değişince yeniden istemeden yerel sıralasın diye birkaç yedek
        $remaining = max(0.0, min(9999999.0, (float) $request->query('remaining', 0)));

        $lines = [];
        foreach (explode(',', (string) $request->query('items', '')) as $chunk) {
            $parts = explode(':', trim($chunk));
            if (count($parts) < 2 || ($parts[0] === '' && $parts[1] === '' && ($parts[3] ?? '') === '')) {
                continue;
            }
            $lines[] = [
                // Ticimax sayısal, ikas UUID kimlik gönderir
                'p' => substr(preg_replace('/[^A-Za-z0-9\-]/', '', $parts[0]), 0, 64),
                'v' => substr(preg_replace('/[^A-Za-z0-9\-]/', '', $parts[1]), 0, 64),
                'q' => (int) ($parts[2] ?? 1),
                'b' => isset($parts[3]) ? preg_replace('/[^A-Za-z0-9\-_.]/', '', $parts[3]) : '',
            ];
            if (count($lines) >= 40) {
                break;
            }
        }
        $member = trim((string) $request->query('member', ''));
        $pool = max($max * 4, 16); // sıralama + fotoğrafsız eleme için geniş havuz

        $items = [];
        try {
            if (! empty($lines)) {
                $res = $recommender->recommendForCart($tenant->id, $lines, $member !== '' ? $member : null, min(10, $pool));
                $items = $res['items'] ?? [];
            }
            if (count($items) < $max) {
                $ctx = new RecContext($tenant->id, 'checkout', $pool);
                $have = array_map(fn ($it) => (int) $it['id'], $items);
                $ctx->excludeIds = $have;
                foreach ($engine->run($ctx, ['global_top']) as $p) {
                    if (in_array((int) $p->id, $have, true)) {
                        continue;
                    }
                    $items[] = $engine->present($p, $ctx);
                    if (count($items) >= $pool) {
                        break;
                    }
                }
            }
        } catch (\Throwable $e) {
            report($e);
            $items = [];
        }

        // Sıralama: eşiği tek başına kapatanlar (en ucuzdan pahalıya) → kalanlar (pahalıdan ucuza: sepete katkısı büyük)
        $unit = fn (array $it) => (float) (($it['discounted'] ?? null) ?: ($it['price'] ?? 0));
        $out = [];
        foreach ($items as $it) {
            // fotoğrafsız / fiyatsız ürün öneri kartı olmaz (mağazada placeholder görünür)
            if (empty($it['url']) || empty($it['image']) || $unit($it) <= 0) {
                continue;
            }
            $u = $unit($it);
            $out[] = [
                'id' => (int) $it['id'],
                'pid' => (string) ($it['pid'] ?? ''),
                'variant_id' => $it['variant_id'] ?? null,
                'name' => (string) $it['name'],
                'url' => (string) $it['url'],
                'image' => $it['image'] ?? null,
                'price' => (float) $it['price'],
                'discounted' => isset($it['discounted']) && $it['discounted'] !== null ? (float) $it['discounted'] : null,
                'size' => $it['size'] ?? null,
                'low_stock' => $it['low_stock'] ?? null,
                'unlocks' => $remaining > 0 && $u + 0.005 >= $remaining,
            ];
        }
        usort($out, function ($a, $b) use ($unit) {
            if ($a['unlocks'] !== $b['unlocks']) {
                return $a['unlocks'] ? -1 : 1;
            }
            $ua = $unit($a); $ub = $unit($b);

            return $a['unlocks'] ? $ua <=> $ub : $ub <=> $ua;
        });

        return response()->json([
            'items' => array_slice($out, 0, $want),
            'max' => $max,
            'remaining' => $remaining,
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
        $surface = in_array($request->input('surface'), ['side', 'checkout'], true) ? $request->input('surface') : 'side';

        DB::table('cart_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'surface' => $surface,
            'type' => $type,
            'basis' => max(0, min(9999999, round((float) $request->input('basis', 0), 2))),
            'tier' => max(0, min(9, (int) $request->input('tier', 0))),
            'remaining' => max(0, min(9999999, round((float) $request->input('remaining', 0), 2))),
            'items' => max(0, min(999, (int) $request->input('items', 0))),
            'value' => mb_substr((string) $request->input('value', ''), 0, 160) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 200) ?: null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $isTest,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }
}
