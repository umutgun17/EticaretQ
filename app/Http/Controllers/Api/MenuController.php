<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Menu\MenuDataService;
use App\Services\Menu\TenantMenuSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Akıllı Menü paneli (CRO): ayarlar + veri önizleme + analitik. */
class MenuController extends Controller
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

    public function settings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $s = TenantMenuSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $data = MenuDataService::build($tenant->id, $request->boolean('fresh'));
        $bar = filter_var($ts['bottombar_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'presets' => TenantMenuSettings::PRESETS,
            'default_virtual' => TenantMenuSettings::defaultVirtual(),
            'bottombar_enabled' => $bar,   // bilgi amaçlı: alt bar gömülüyse Kategoriler sekmesi menüyü açar (menu.js ayrı yüklenir)
            'data' => $data,
            'picks' => self::picks($tenant->id),
            'picking' => (bool) \Illuminate\Support\Facades\Cache::get("menu:picking:{$tenant->id}"),
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
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantMenuSettings::PRESETS),
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.ink' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.tile_bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.radius' => 'sometimes|integer|between:0,28',
            'theme.label_case' => 'sometimes|string|in:normal,upper',
            'theme.columns' => 'sometimes|integer|between:2,3',
            'theme.image_fit' => 'sometimes|string|in:cover,contain',
            'theme.show_shadow' => 'sometimes|boolean',
            'theme.full_width' => 'sometimes|boolean',
            'theme.logo_url' => 'sometimes|nullable|string|max:600|regex:#^(https?://|/|$)#',
            'rules' => 'sometimes|array',
            'rules.mount' => 'sometimes|string|in:hamburger,bottombar,both',
            'rules.max_width' => 'sometimes|integer|between:480,1400',
            'rules.default_tab' => 'sometimes|string|in:remember,sales,catalog',
            'rules.sort' => 'sometimes|string|in:sales_30d,sales_7d,catalog',
            'rules.season_boost' => 'sometimes|boolean',
            'rules.personalize' => 'sometimes|boolean',
            'rules.show_recent' => 'sometimes|boolean',
            'rules.badges' => 'sometimes|boolean',
            'rules.show_counts' => 'sometimes|boolean',
            'rules.hide_min_products' => 'sometimes|integer|between:0,50',
            'rules.max_tiles' => 'sometimes|integer|between:0,60',
            'rules.group_headers' => 'sometimes|boolean',
            'rules.virtual_position' => 'sometimes|string|in:top,bottom,both',
            'rules.show_products' => 'sometimes|boolean',
            'rules.products_count' => 'sometimes|integer|between:2,12',
            'rules.product_name_max' => 'sometimes|integer|between:16,80',
            'rules.products_source' => 'sometimes|string|in:auto,popular,personal',
            'rules.show_search' => 'sometimes|boolean',
            'rules.show_all_link' => 'sometimes|boolean',
            'rules.segments_max' => 'sometimes|integer|between:1,6',
            'rules.footer_links' => 'sometimes|boolean',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.nav_promo' => 'sometimes|boolean',
            'virtual' => 'sometimes|nullable|array|max:12',
            'virtual.*.key' => 'sometimes|nullable|string|max:32',
            'virtual.*.label' => 'required_with:virtual|string|max:40',
            'virtual.*.url' => 'required_with:virtual|string|max:300',
            'virtual.*.style' => 'sometimes|nullable|string|in:chip,card,hero',
            'virtual.*.icon' => 'sometimes|nullable|string|max:20',
            'virtual.*.emoji' => 'sometimes|nullable|string|max:8',
            'virtual.*.look' => 'sometimes|nullable|string|in:plain,solid,gradient,glow',
            'virtual.*.color' => 'sometimes|nullable|string|max:7',
            'virtual.*.auto_price' => 'sometimes|boolean',
            'virtual.*.image' => 'sometimes|nullable|string|max:400',
            'virtual.*.note' => 'sometimes|nullable|string|max:60',
            'virtual.*.enabled' => 'sometimes|boolean',
            'overrides' => 'sometimes|array',
            'overrides.pinned' => 'sometimes|array|max:60',
            'overrides.pinned.*' => 'string|max:200',
            'overrides.hidden' => 'sometimes|array|max:200',
            'overrides.hidden.*' => 'string|max:200',
            'overrides.labels' => 'sometimes|array',
            'overrides.labels.*' => 'nullable|string|max:40',
            'overrides.images' => 'sometimes|array',
            'overrides.images.*' => 'nullable|string|max:400',
            'overrides.order' => 'sometimes|array',
            'overrides.order.*' => 'array|max:60',
            'overrides.order.*.*' => 'string|max:200',
            'overrides.segments_hidden' => 'sometimes|array|max:20',
            'overrides.segments_hidden.*' => 'string|max:200',
            'overrides.segments_order' => 'sometimes|array|max:20',
            'overrides.segments_order.*' => 'string|max:200',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantMenuSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['menu_enabled'] = (bool) $data['enabled'];
            // ilk açılışta domain boşsa mağaza adresinden doldur (aktif et → siteye gitsin)
            if ($data['enabled'] && trim((string) ($s['menu_domains'] ?? '')) === '') {
                $host = strtolower((string) parse_url((string) ($s['shop_url'] ?? ''), PHP_URL_HOST));
                $host = preg_replace('/^www\./', '', $host) ?? $host;
                if ($host) {
                    $s['menu_domains'] = $host;
                }
            }
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['menu_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['menu_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['menu_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('virtual', $data)) {
            $s['menu_virtual'] = $data['virtual'] === null ? null : json_encode(TenantMenuSettings::sanitizeVirtual($data['virtual']));
        }
        if (array_key_exists('overrides', $data)) {
            $ov = array_merge($cur['overrides'], $data['overrides']);
            // boş etiket/görsel = geri al
            foreach (['labels', 'images'] as $k) {
                $ov[$k] = array_filter($ov[$k] ?? [], fn ($v) => is_string($v) && trim($v) !== '');
            }
            $s['menu_overrides'] = json_encode($ov);
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantMenuSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings($request)->getData(true));
    }

    /** Seçicinin kategori başına kapak + adayları (panel için). */
    public static function picks(int $tenantId): array
    {
        $out = [];
        foreach (DB::table('menu_category_images')->where('tenant_id', $tenantId)->get() as $r) {
            $out[$r->category_path] = ['image' => $r->image_url, 'score' => $r->score !== null ? (float) $r->score : null, 'picked_at' => $r->picked_at,
                'candidates' => json_decode((string) $r->candidates, true) ?: []];
        }

        return $out;
    }

    /**
     * POST /cro/menu/pick-images {path?} — kapakları yeniden seç. Tek kategori eşzamanlı (1-2 sn);
     * tümü yanıt sonrası arka planda (30-60 sn), panel `picking` bayrağını yoklar.
     */
    public function pickImages(Request $request, \App\Services\Menu\MenuImagePicker $picker): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $path = trim((string) $request->input('path', ''));
        if ($path !== '') {
            $res = $picker->pickCategory($tenant->id, $path, null);
            \Illuminate\Support\Facades\Cache::forget("menu:images:{$tenant->id}");
            TenantMenuSettings::forget($tenant->id);

            return response()->json(['ok' => true, 'path' => $path, 'pick' => self::picks($tenant->id)[$path] ?? null, 'result' => $res ? ['downloaded' => $res['downloaded']] : null]);
        }
        if (\Illuminate\Support\Facades\Cache::get("menu:picking:{$tenant->id}")) {
            return response()->json(['ok' => true, 'queued' => true, 'already' => true]);
        }
        \Illuminate\Support\Facades\Cache::put("menu:picking:{$tenant->id}", ['started' => now()->toIso8601String()], 1800);
        $tid = $tenant->id;
        dispatch(function () use ($tid) {
            try {
                app(\App\Services\Menu\MenuImagePicker::class)->pickForTenant($tid);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::error('menu pick-images failed', ['tenant' => $tid, 'err' => $e->getMessage()]);
                \Illuminate\Support\Facades\Cache::forget("menu:picking:{$tid}");
            }
        })->afterResponse();

        return response()->json(['ok' => true, 'queued' => true]);
    }

    /** POST /cro/menu/refresh — görsel/satış/sezon cache'lerini tazele. */
    public function refresh(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        \Illuminate\Support\Facades\Cache::forget("menu:images:{$tenant->id}");
        \Illuminate\Support\Facades\Cache::forget("menu:season:{$tenant->id}:".now()->format('Y-m'));
        TenantMenuSettings::forget($tenant->id);

        return response()->json(['ok' => true, 'data' => MenuDataService::build($tenant->id, true)]);
    }

    /** GET /cro/menu/analytics?range=30 */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('menu_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $opens = (int) (clone $ev)->where('type', 'open')->count();
        $openSessions = (int) (clone $ev)->where('type', 'open')->distinct()->count('session_id');
        $clickTypes = ['tile', 'virtual', 'product', 'recent'];
        $clicks = (int) (clone $ev)->whereIn('type', $clickTypes)->count();
        $clickSessions = (int) (clone $ev)->whereIn('type', $clickTypes)->distinct()->count('session_id');
        $bySource = (clone $ev)->where('type', 'open')->selectRaw('source, count(*) c')->groupBy('source')->orderByDesc('c')->get();
        $byTab = (clone $ev)->where('type', 'tab')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->get();
        $byTile = (clone $ev)->where('type', 'tile')->selectRaw('segment, value, count(*) c, round(avg(position),1) avg_pos')->groupBy('segment', 'value')->orderByDesc('c')->limit(30)->get();
        $byVirtual = (clone $ev)->where('type', 'virtual')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(15)->get();
        $products = (int) (clone $ev)->where('type', 'product')->count();
        $recent = (int) (clone $ev)->where('type', 'recent')->count();
        $bySrc2 = (clone $ev)->where('type', 'tile')->selectRaw('source, count(*) c')->groupBy('source')->orderByDesc('c')->get();
        // ── menüdeki HER öğe: tür toplamları, segment bazlı kart/çip/ürün listeleri, konum eğrisi, alt linkler, tümü linki, daha fazla, arama
        $byType = (clone $ev)->whereNotIn('type', ['error'])->selectRaw('type, count(*) c, count(distinct session_id) s')->groupBy('type')->orderByDesc('c')->get();
        $byTileAll = (clone $ev)->where('type', 'tile')->selectRaw('segment, value, count(*) c, count(distinct session_id) s, round(avg(position),1) avg_pos')->groupBy('segment', 'value')->orderByDesc('c')->limit(300)->get();
        $byVirtualSeg = (clone $ev)->where('type', 'virtual')->selectRaw('segment, value, count(*) c')->groupBy('segment', 'value')->orderByDesc('c')->limit(100)->get();
        $byProduct = (clone $ev)->where('type', 'product')->selectRaw('segment, value, count(*) c, round(avg(position),1) avg_pos')->groupBy('segment', 'value')->orderByDesc('c')->limit(60)->get();
        $pids = $byProduct->pluck('value')->filter(fn ($v) => is_numeric($v))->values()->all();
        $pnames = $pids ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('platform_product_id', $pids)->pluck('name', 'platform_product_id') : collect();
        $byProduct = $byProduct->map(function ($r) use ($pnames) { $r->name = $pnames[$r->value] ?? $r->value; return $r; });
        $byRecent = (clone $ev)->where('type', 'recent')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(30)->get();
        $rurls = $byRecent->pluck('value')->all();
        $rnames = $rurls ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('url', $rurls)->pluck('name', 'url') : collect();
        $byRecent = $byRecent->map(function ($r) use ($rnames) { $r->name = $rnames[$r->value] ?? null; return $r; });
        $byPosition = (clone $ev)->where('type', 'tile')->whereNotNull('position')->where('position', '>', 0)->selectRaw('position, count(*) c')->groupBy('position')->orderBy('position')->limit(40)->get();
        $byFooter = (clone $ev)->where('type', 'footer')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->get();
        $byAll = (clone $ev)->where('type', 'all')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->get();
        $byMore = (clone $ev)->where('type', 'more')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->get();
        $searchClicks = (int) (clone $ev)->where('type', 'search')->count();
        $closeNoClick = (int) (clone $ev)->where('type', 'close')->where('value', 'noclick')->count();
        $hourly = (clone $ev)->where('type', 'open')->selectRaw("extract(hour from created_at + interval '3 hours')::int h, count(*) c")->groupBy('h')->orderBy('h')->get();
        $segOpens = (clone $ev)->whereIn('type', ['open', 'tab'])->selectRaw('segment, count(*) c')->groupBy('segment')->orderByDesc('c')->get();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(*) filter (where type='open') opens, count(*) filter (where type in ('tile','virtual','product','recent')) clicks")
            ->groupBy('d')->orderBy('d')->get();

        return response()->json([
            'range_days' => $days,
            'opens' => $opens,
            'open_sessions' => $openSessions,
            'clicks' => $clicks,
            'click_sessions' => $clickSessions,
            'click_rate' => $openSessions > 0 ? round($clickSessions / $openSessions * 100, 1) : 0,
            'by_source' => $bySource,
            'by_tab' => $byTab,
            'by_tile' => $byTile,
            'by_virtual' => $byVirtual,
            'tile_by_sort_source' => $bySrc2,
            'product_clicks' => $products,
            'recent_clicks' => $recent,
            'daily' => $daily,
            'by_type' => $byType,
            'by_tile_all' => $byTileAll,
            'by_virtual_seg' => $byVirtualSeg,
            'by_product' => $byProduct,
            'by_recent' => $byRecent,
            'by_position' => $byPosition,
            'by_footer' => $byFooter,
            'by_all' => $byAll,
            'by_more' => $byMore,
            'search_clicks' => $searchClicks,
            'close_noclick' => $closeNoClick,
            'hourly' => $hourly,
            'segment_views' => $segOpens,
        ]);
    }
}
