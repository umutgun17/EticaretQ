<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Gallery\TenantGallerySettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Ürün Galerisi paneli (CRO): ayarlar + analitik. */
class GalleryController extends Controller
{
    protected function tenant(): ?Tenant
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return $user->tenant;
        }
        $id = request()->header('X-Tenant-Id');

        return $id ? Tenant::find((int) $id) : null;
    }

    public function settings(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $s = TenantGallerySettings::get($tenant->id);
        $ts = $tenant->settings ?? [];

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'devices' => TenantGallerySettings::DEVICES,
            'thumb_styles' => TenantGallerySettings::THUMB_STYLES,
            'indicators' => TenantGallerySettings::DOT_STYLES,
            'defaults' => ['theme' => TenantGallerySettings::DEFAULT_THEME, 'rules' => TenantGallerySettings::DEFAULT_RULES],
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'domains' => 'sometimes|nullable|string|max:500',
            'theme' => 'sometimes|array',
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.viewer_bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.thumb_size' => 'sometimes|integer|between:40,120',
            'theme.thumb_style' => 'sometimes|string|in:'.implode(',', TenantGallerySettings::THUMB_STYLES),
            'theme.thumb_gap' => 'sometimes|integer|between:2,24',
            'theme.radius' => 'sometimes|integer|between:0,32',
            'theme.indicator' => 'sometimes|string|in:'.implode(',', TenantGallerySettings::DOT_STYLES),
            'theme.aspect' => 'sometimes|string|in:photo,1:1,2:3,3:4,4:5,auto',
            'theme.fit' => 'sometimes|string|in:cover,contain',
            'theme.zoom_hint' => 'sometimes|boolean',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'rules' => 'sometimes|array',
            'rules.devices' => 'sometimes|string|in:'.implode(',', TenantGallerySettings::DEVICES),
            'rules.max_width' => 'sometimes|integer|between:480,1400',
            'rules.max_zoom' => 'sometimes|numeric|between:2,8',
            'rules.double_tap_zoom' => 'sometimes|numeric|between:1.5,4',
            'rules.viewer_enabled' => 'sometimes|boolean',
            'rules.show_title' => 'sometimes|boolean',
            'rules.share_button' => 'sometimes|boolean',
            'rules.download_button' => 'sometimes|boolean',
            'rules.zoom_enabled' => 'sometimes|boolean',
            'rules.indicator_arrows' => 'sometimes|boolean',
            'rules.thumbs_on_page' => 'sometimes|boolean',
            'rules.thumbs_in_viewer' => 'sometimes|boolean',
            'rules.swipe_main' => 'sometimes|boolean',
            'rules.autoplay' => 'sometimes|boolean',
            'rules.source_selector' => 'sometimes|nullable|string|max:400',
            'rules.hide_selector' => 'sometimes|nullable|string|max:400',
            'rules.mount_selector' => 'sometimes|nullable|string|max:400',
            'rules.preload' => 'sometimes|integer|between:0,10',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.video_ab' => 'sometimes|boolean',
            'rules.video_ab_share' => 'sometimes|integer|between:10,90',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantGallerySettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['gallery_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['gallery_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['gallery_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            // A/B kapalıdan açığa geçince karne başlangıcı yenilenir
            if (! empty($data['rules']['video_ab']) && empty($cur['rules']['video_ab'])) {
                $data['rules']['video_ab_since'] = now()->format('Y-m-d H:i:s');
            }
            $s['gallery_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantGallerySettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /** GET /cro/gallery/analytics?range=30 — galeri etkileşimi: kaydırma, küçük görsel, tam ekran, yakınlaştırma. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('gallery_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $views = (int) (clone $ev)->where('type', 'view')->count();
        $cnt = fn (string $t) => (int) (clone $ev)->where('type', $t)->count();
        $sess = fn (string $t) => (int) (clone $ev)->where('type', $t)->distinct()->count('session_id');
        $swipes = $cnt('swipe');
        $thumbs = $cnt('thumb');
        $opens = $cnt('open');
        $zooms = $cnt('zoom');
        $openSessions = $sess('open');
        $zoomSessions = $sess('zoom');
        $interactSessions = (int) (clone $ev)->whereIn('type', ['swipe', 'thumb', 'open', 'zoom'])->distinct()->count('session_id');

        $avgCount = (float) ((clone $ev)->where('type', 'view')->where('image_count', '>', 0)->avg('image_count') ?? 0);
        $depth = (clone $ev)->whereIn('type', ['swipe', 'thumb'])->selectRaw('image_index, count(*) c')->groupBy('image_index')->orderBy('image_index')->limit(12)->get();
        $byProduct = (clone $ev)->whereIn('type', ['open', 'zoom'])->whereNotNull('product_id')->selectRaw('product_id, page_path, count(*) c, count(distinct session_id) s')->groupBy('product_id', 'page_path')->orderByDesc('c')->limit(15)->get();
        $errors = (clone $ev)->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') sessions, count(*) filter (where type='open') opens, count(*) filter (where type='zoom') zooms")
            ->groupBy('d')->orderBy('d')->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'views' => $views,
            'swipes' => $swipes,
            'thumbs' => $thumbs,
            'opens' => $opens,
            'zooms' => $zooms,
            'open_sessions' => $openSessions,
            'zoom_sessions' => $zoomSessions,
            'interact_sessions' => $interactSessions,
            'interact_rate' => $sessions > 0 ? round($interactSessions / $sessions * 100, 1) : 0,
            'open_rate' => $sessions > 0 ? round($openSessions / $sessions * 100, 1) : 0,
            'zoom_rate' => $sessions > 0 ? round($zoomSessions / $sessions * 100, 1) : 0,
            'avg_image_count' => round($avgCount, 1),
            'depth' => $depth,
            'by_product' => $byProduct,
            'errors' => $errors,
            'daily' => $daily,
        ]);
    }
    /**
     * GET /cro/gallery/video-ab?since=YYYY-MM-DD — ürün videosu A/B karnesi.
     * Birim = (oturum, videolu ürün) maruziyeti (video_expose; A = video gösterildi, B = gizlendi).
     * Sepete ekleme = aynı oturumda o ürünün detayında "Sepete Ekle". Satış = ödemesi alınmış sipariş, AYNI IP,
     * maruziyetten sonraki 24 saat içinde, siparişte o ürün var (search:attribute-conversions ile aynı atıf; Ticimax
     * checkout tema betiği yüklemez). Bir sipariş en son maruziyete tek kez atfedilir.
     * Saat: gallery_events.created_at UTC, orders.order_date TR (+3).
     */
    public function videoAb(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $rules = TenantGallerySettings::get($tenant->id)['rules'];
        $since = $request->query('since') ?: ($rules['video_ab_since'] ?: now()->subDays(14)->format('Y-m-d H:i:s'));
        $since = date('Y-m-d H:i:s', strtotime((string) $since) ?: time() - 14 * 86400);
        $tid = $tenant->id;

        $exp = "SELECT ab, session_id, product_id, min(created_at) t, max(ip_address) ip, max(device) dev
                FROM gallery_events
                WHERE tenant_id = ? AND type = 'video_expose' AND is_test = false AND ab IN ('A','B')
                  AND session_id IS NOT NULL AND product_id IS NOT NULL AND created_at >= ?
                GROUP BY 1, 2, 3";
        $sql = "
            WITH ex AS ($exp),
            ev AS (
                SELECT session_id, product_id, type FROM gallery_events
                WHERE tenant_id = ? AND is_test = false AND created_at >= ?
                  AND type IN ('add_cart','video_view','video_play','video_3s','video_50','video_100')
                GROUP BY 1, 2, 3
            ),
            buy AS (
                SELECT DISTINCT ON (o.id) o.id order_id, x.ab, x.session_id, x.product_id,
                       (SELECT coalesce(sum(oi.total_price), 0) FROM order_items oi
                         WHERE oi.order_id = o.id AND oi.platform_product_id = x.product_id::text) rev
                FROM ex x
                JOIN orders o ON o.tenant_id = ? AND o.ip_address = x.ip
                     AND o.order_date >= x.t + interval '3 hours' - interval '5 minutes'
                     AND o.order_date <= x.t + interval '27 hours'
                     AND coalesce(o.paid_amount, 0) > 0
                WHERE x.ip IS NOT NULL
                  AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.platform_product_id = x.product_id::text)
                ORDER BY o.id, x.t DESC
            ),
            pairs AS (
                SELECT x.ab, x.session_id, x.product_id, x.dev,
                       bool_or(e.type = 'add_cart') atc, bool_or(e.type = 'video_view') vview, bool_or(e.type = 'video_play') vplay,
                       bool_or(e.type = 'video_3s') v3, bool_or(e.type = 'video_50') v50, bool_or(e.type = 'video_100') v100
                FROM ex x LEFT JOIN ev e ON e.session_id = x.session_id AND e.product_id = x.product_id
                GROUP BY 1, 2, 3, 4
            )
            SELECT p.ab, p.product_id, p.dev,
                   count(*) n, count(DISTINCT p.session_id) sessions,
                   count(*) FILTER (WHERE p.atc) atc,
                   count(*) FILTER (WHERE p.vview) vview, count(*) FILTER (WHERE p.vplay) vplay,
                   count(*) FILTER (WHERE p.v3) v3, count(*) FILTER (WHERE p.v50) v50, count(*) FILTER (WHERE p.v100) v100,
                   count(b.order_id) orders, coalesce(sum(b.rev), 0) revenue
            FROM pairs p
            LEFT JOIN buy b ON b.session_id = p.session_id AND b.product_id = p.product_id
            GROUP BY 1, 2, 3";
        $rows = DB::select($sql, [$tid, $since, $tid, $since, $tid]);

        $blank = fn () => ['n' => 0, 'sessions' => 0, 'atc' => 0, 'orders' => 0, 'revenue' => 0.0, 'vview' => 0, 'vplay' => 0, 'v3' => 0, 'v50' => 0, 'v100' => 0];
        $tot = ['A' => $blank(), 'B' => $blank()];
        $dev = [];
        $prod = [];
        foreach ($rows as $r) {
            foreach (['n', 'atc', 'orders', 'vview', 'vplay', 'v3', 'v50', 'v100'] as $k) {
                $tot[$r->ab][$k] += (int) $r->$k;
                $dev[$r->dev ?: '?'][$r->ab][$k] = ($dev[$r->dev ?: '?'][$r->ab][$k] ?? 0) + (int) $r->$k;
                $prod[$r->product_id][$r->ab][$k] = ($prod[$r->product_id][$r->ab][$k] ?? 0) + (int) $r->$k;
            }
            $tot[$r->ab]['revenue'] += (float) $r->revenue;
            $prod[$r->product_id][$r->ab]['revenue'] = ($prod[$r->product_id][$r->ab]['revenue'] ?? 0) + (float) $r->revenue;
        }
        $sess = DB::select("SELECT ab, count(DISTINCT session_id) s FROM ($exp) x GROUP BY 1", [$tid, $since]);
        foreach ($sess as $r) {
            $tot[$r->ab]['sessions'] = (int) $r->s;
        }

        $names = DB::table('product_videos as v')->leftJoin('products as p', 'p.id', '=', 'v.product_id')
            ->where('v.tenant_id', $tid)->whereIn('v.platform_product_id', array_map('strval', array_keys($prod) ?: [0]))
            ->select('v.platform_product_id', 'p.name', 'p.sku', 'p.url')->get()->keyBy('platform_product_id');
        $byProduct = [];
        foreach ($prod as $pid => $g) {
            $a = ($g['A'] ?? []) + $blank();
            $b = ($g['B'] ?? []) + $blank();
            $nm = $names[(string) $pid] ?? null;
            $byProduct[] = [
                'product_id' => (int) $pid, 'name' => $nm->name ?? null, 'sku' => $nm->sku ?? null, 'url' => $nm->url ?? null,
                'A' => $a, 'B' => $b,
                'atc_lift' => $this->lift($a['atc'], $a['n'], $b['atc'], $b['n']),
                'view3_rate' => $a['n'] ? round($a['v3'] / $a['n'] * 100, 1) : null,
            ];
        }
        usort($byProduct, fn ($x, $y) => ($y['A']['n'] + $y['B']['n']) <=> ($x['A']['n'] + $x['B']['n']));

        $daily = DB::select("SELECT to_char(t + interval '3 hours', 'YYYY-MM-DD') d, ab, count(*) n FROM ($exp) x GROUP BY 1, 2 ORDER BY 1", [$tid, $since]);

        $tot['A']['revenue'] = round($tot['A']['revenue'], 2);
        $tot['B']['revenue'] = round($tot['B']['revenue'], 2);
        foreach ($byProduct as &$bp) {
            $bp['A']['revenue'] = round($bp['A']['revenue'], 2);
            $bp['B']['revenue'] = round($bp['B']['revenue'], 2);
        }
        unset($bp);
        $A = $tot['A'];
        $B = $tot['B'];

        return response()->json([
            'enabled' => (bool) ($rules['video_ab'] ?? false),
            'share' => (int) ($rules['video_ab_share'] ?? 50),
            'since' => $since,
            'totals' => $tot,
            'atc' => $this->compare($A['atc'], $A['n'], $B['atc'], $B['n']),
            'purchase' => $this->compare($A['orders'], $A['n'], $B['orders'], $B['n']),
            'revenue_per_exposure' => [
                'A' => $A['n'] ? round($A['revenue'] / $A['n'], 2) : 0,
                'B' => $B['n'] ? round($B['revenue'] / $B['n'], 2) : 0,
            ],
            'engagement' => $A['n'] ? [
                'view_rate' => round($A['vview'] / $A['n'] * 100, 1),
                'play_rate' => round($A['vplay'] / $A['n'] * 100, 1),
                'watch3_rate' => round($A['v3'] / $A['n'] * 100, 1),
                'half_rate' => round($A['v50'] / $A['n'] * 100, 1),
                'full_rate' => round($A['v100'] / $A['n'] * 100, 1),
            ] : null,
            'by_device' => $dev,
            'by_product' => $byProduct,
            'daily' => $daily,
        ]);
    }

    /** A/B oran karşılaştırması: oranlar (%), göreli fark (%), iki oran z-testi p değeri. */
    protected function compare(int $xa, int $na, int $xb, int $nb): array
    {
        $ra = $na ? $xa / $na : 0;
        $rb = $nb ? $xb / $nb : 0;
        $p = null;
        if ($na > 0 && $nb > 0 && ($xa + $xb) > 0) {
            $pp = ($xa + $xb) / ($na + $nb);
            $se = sqrt($pp * (1 - $pp) * (1 / $na + 1 / $nb));
            if ($se > 0) {
                $z = abs($ra - $rb) / $se;
                $p = round(2 * (1 - $this->normCdf($z)), 4);
            }
        }

        return [
            'A' => ['x' => $xa, 'n' => $na, 'rate' => round($ra * 100, 2)],
            'B' => ['x' => $xb, 'n' => $nb, 'rate' => round($rb * 100, 2)],
            'lift' => $this->lift($xa, $na, $xb, $nb),
            'p_value' => $p,
            'significant' => $p !== null && $p < 0.05,
        ];
    }

    protected function lift(int $xa, int $na, int $xb, int $nb): ?float
    {
        if (! $na || ! $nb || ! $xb) {
            return null;
        }

        return round((($xa / $na) / ($xb / $nb) - 1) * 100, 1);
    }

    /** Standart normal birikimli dağılım (Abramowitz-Stegun 26.2.17). */
    protected function normCdf(float $z): float
    {
        $t = 1 / (1 + 0.2316419 * $z);
        $d = 0.3989422804014327 * exp(-$z * $z / 2);
        $q = $d * $t * (0.319381530 + $t * (-0.356563782 + $t * (1.781477937 + $t * (-1.821255978 + $t * 1.330274429))));

        return 1 - $q;
    }
}
