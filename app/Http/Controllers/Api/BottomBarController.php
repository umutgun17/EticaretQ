<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\BottomBar\TenantBottomBarSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Mobil Alt Bar paneli (CRO): ayarlar + analitik. */
class BottomBarController extends Controller
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
        $s = TenantBottomBarSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'cart_url' => (string) ($ts['cart_url'] ?? '/checkout'),
            'presets' => TenantBottomBarSettings::PRESETS,
            'item_types' => TenantBottomBarSettings::ITEM_TYPES,
            'icons' => TenantBottomBarSettings::ICONS,
            'default_items' => TenantBottomBarSettings::defaultItems(),
            'categories_preview' => PublicBottomBarController::categoryTree($tenant->id, (int) $s['rules']['sheet_levels']),
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
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantBottomBarSettings::PRESETS),
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.ink' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.labels' => 'sometimes|boolean',
            'theme.icon_style' => 'sometimes|string|in:line,solid',
            'theme.radius' => 'sometimes|integer|between:0,32',
            'theme.hide_on_scroll' => 'sometimes|boolean',
            'theme.show_shadow' => 'sometimes|boolean',
            'theme.center_item' => 'sometimes|nullable|string|max:32',
            'rules' => 'sometimes|array',
            'rules.cart_badge' => 'sometimes|boolean',
            'rules.account_name' => 'sometimes|boolean',
            'rules.categories_source' => 'sometimes|string|in:yunbi,theme',
            'rules.search_action' => 'sometimes|string|in:yunbi,theme',
            'rules.cart_action' => 'sometimes|string|in:page,side',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.hide_page_types' => 'sometimes|array',
            'rules.hide_page_types.*' => 'string|in:home,category,product,account,other',
            'rules.max_width' => 'sometimes|integer|between:480,1400',
            'rules.sheet_levels' => 'sometimes|integer|between:1,3',
            'items' => 'sometimes|nullable|array|max:8',
            'items.*.key' => 'sometimes|nullable|string|max:32',
            'items.*.type' => 'required_with:items|string|in:'.implode(',', TenantBottomBarSettings::ITEM_TYPES),
            'items.*.label' => 'sometimes|nullable|string|max:20',
            'items.*.icon' => 'sometimes|nullable|string|in:'.implode(',', TenantBottomBarSettings::ICONS),
            'items.*.url' => 'sometimes|nullable|string|max:200',
            'items.*.enabled' => 'sometimes|boolean',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantBottomBarSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['bottombar_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['bottombar_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['bottombar_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['bottombar_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('items', $data)) {
            $s['bottombar_items'] = $data['items'] ? json_encode(TenantBottomBarSettings::sanitizeItems($data['items'])) : null;
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantBottomBarSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /** GET /cro/bottombar/analytics?range=30 — sekme tıklamaları, sayfa bazında, günlük. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('bottombar_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $views = (int) (clone $ev)->where('type', 'view')->count();
        $clickSessions = (int) (clone $ev)->where('type', 'click')->distinct()->count('session_id');
        $clicks = (int) (clone $ev)->where('type', 'click')->count();

        $byItem = (clone $ev)->where('type', 'click')->selectRaw('item, count(*) c, count(distinct session_id) s')->groupBy('item')->orderByDesc('c')->get();
        $byPageType = (clone $ev)->where('type', 'click')->selectRaw('page_type, item, count(*) c')->groupBy('page_type', 'item')->orderByDesc('c')->get();
        $byPath = (clone $ev)->where('type', 'click')->selectRaw('page_path, count(*) c, count(distinct session_id) s')->groupBy('page_path')->orderByDesc('c')->limit(15)->get();
        $sheet = (clone $ev)->where('type', 'sheet_click')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(15)->get();
        $sheetOpens = (int) (clone $ev)->where('type', 'sheet_open')->count();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') sessions, count(*) filter (where type='click') clicks")
            ->groupBy('d')->orderBy('d')->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'views' => $views,
            'clicks' => $clicks,
            'click_sessions' => $clickSessions,
            'engagement_rate' => $sessions > 0 ? round($clickSessions / $sessions * 100, 1) : 0,
            'clicks_per_session' => $sessions > 0 ? round($clicks / $sessions, 2) : 0,
            'by_item' => $byItem,
            'by_page_type' => $byPageType,
            'by_path' => $byPath,
            'sheet_opens' => $sheetOpens,
            'sheet_clicks' => $sheet,
            'daily' => $daily,
        ]);
    }
}
