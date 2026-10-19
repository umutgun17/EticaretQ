<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\AppPromo\TenantAppPromoSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** "Uygulamaya Özel" kulakçığı paneli (CRO): ayarlar + huni analitiği (olaylar + siparişler). */
class AppPromoController extends Controller
{
    public const APP_SOURCES = ['NativeAndroid', 'NativeIOS'];

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
        $s = TenantAppPromoSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $base = rtrim((string) config('app.url'), '/');

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => $base,
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'go_url' => $base.'/w/'.$tenant->slug.'/app/go',
            'presets' => TenantAppPromoSettings::PRESETS,
            'tab_positions' => TenantAppPromoSettings::TAB_POSITIONS,
            'frequencies' => TenantAppPromoSettings::FREQUENCIES,
            'in_app_modes' => TenantAppPromoSettings::IN_APP_MODES,
            'defaults' => ['theme' => TenantAppPromoSettings::DEFAULT_THEME, 'rules' => TenantAppPromoSettings::DEFAULT_RULES],
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
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantAppPromoSettings::PRESETS),
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.accent2' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.ink' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.radius' => 'sometimes|integer|between:0,32',
            'theme.tab_position' => 'sometimes|string|in:'.implode(',', TenantAppPromoSettings::TAB_POSITIONS),
            'theme.tab_text' => 'sometimes|nullable|string|max:24',
            'theme.tab_badge' => 'sometimes|nullable|string|max:8',
            'theme.tab_emoji' => 'sometimes|nullable|string|max:4',
            'theme.tab_pulse' => 'sometimes|boolean',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'rules' => 'sometimes|array',
            'rules.code' => 'sometimes|nullable|string|max:32',
            'rules.channel_codes' => 'sometimes|array',
            'rules.channel_codes.*' => 'nullable|string|max:32',
            'rules.discount_label' => 'sometimes|nullable|string|max:40',
            'rules.eyebrow' => 'sometimes|nullable|string|max:24',
            'rules.title' => 'sometimes|nullable|string|max:60',
            'rules.subtitle' => 'sometimes|nullable|string|max:140',
            'rules.terms' => 'sometimes|nullable|string|max:160',
            'rules.valid_until' => 'sometimes|nullable|date_format:Y-m-d',
            'rules.ios_url' => 'sometimes|nullable|url|max:300',
            'rules.android_url' => 'sometimes|nullable|url|max:300',
            'rules.landing_url' => 'sometimes|nullable|string|max:300',
            'rules.show_code_web' => 'sometimes|boolean',
            'rules.show_qr' => 'sometimes|boolean',
            'rules.in_app_mode' => 'sometimes|string|in:'.implode(',', TenantAppPromoSettings::IN_APP_MODES),
            'rules.cta_ios' => 'sometimes|nullable|string|max:40',
            'rules.cta_android' => 'sometimes|nullable|string|max:40',
            'rules.copy_text' => 'sometimes|nullable|string|max:30',
            'rules.auto_open' => 'sometimes|boolean',
            'rules.auto_open_mobile' => 'sometimes|boolean',
            'rules.auto_open_delay' => 'sometimes|integer|between:0,600',
            'rules.auto_open_scroll' => 'sometimes|integer|between:0,100',
            'rules.exit_intent' => 'sometimes|boolean',
            'rules.tab_close' => 'sometimes|boolean',
            'rules.tab_close_days' => 'sometimes|integer|between:1,30',
            'rules.frequency' => 'sometimes|string|in:'.implode(',', TenantAppPromoSettings::FREQUENCIES),
            'rules.no_auto_page_types' => 'sometimes|array',
            'rules.no_auto_page_types.*' => 'string|in:home,category,product,account,other',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.hide_page_types' => 'sometimes|array',
            'rules.hide_page_types.*' => 'string|in:home,category,product,account,other',
            'rules.max_width' => 'sometimes|integer|between:0,2000',
            'rules.min_width' => 'sometimes|integer|between:0,2000',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantAppPromoSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['apppromo_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['apppromo_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['apppromo_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $rules = array_merge($cur['rules'], $data['rules']);
            $rules['code'] = mb_substr(strtoupper(trim((string) ($rules['code'] ?? ''))), 0, 32);
            $rules['channel_codes'] = TenantAppPromoSettings::channelCodes($rules['channel_codes'] ?? []);
            $s['apppromo_rules'] = json_encode($rules);
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantAppPromoSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /**
     * GET /cro/app/analytics?range=30 — huni: gören → açan → mağazaya giden (QR/buton) → uygulama siparişi (kod).
     * Olaylar app_promo_events'ten; sipariş/kod kullanımı orders'tan (order_source NativeIOS/NativeAndroid + coupon_code).
     */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $prevSince = now()->subDays($days * 2);
        $rulesNow = TenantAppPromoSettings::get($tenant->id)['rules'];
        $code = $rulesNow['code'];
        // Kod ailesi: ana kod + kanal kodları (APP10, APP10M, APP10G) — hepsi "kod kullanımı" sayılır
        $codeArr = '{'.implode(',', TenantAppPromoSettings::allCodes($rulesNow)).'}';
        $tid = $tenant->id;
        $ev = DB::table('app_promo_events')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $openSessions = (int) (clone $ev)->where('type', 'open')->distinct()->count('session_id');
        $opens = (int) (clone $ev)->where('type', 'open')->count();
        $clicks = (int) (clone $ev)->where('type', 'click')->count();
        $clickSessions = (int) (clone $ev)->where('type', 'click')->distinct()->count('session_id');
        $copies = (int) (clone $ev)->where('type', 'copy')->count();
        $copySessions = (int) (clone $ev)->where('type', 'copy')->distinct()->count('session_id');
        $redirects = (int) (clone $ev)->where('type', 'redirect')->count();
        $qrScans = (int) (clone $ev)->where('type', 'redirect')->where('source', 'qr')->count();
        $storeVisits = (int) (clone $ev)->where('type', 'redirect')->whereIn('platform', ['ios', 'android'])->count();
        $closes = (int) (clone $ev)->where('type', 'close')->count();
        $inAppViews = (int) (clone $ev)->where('type', 'view')->whereIn('platform', ['inapp_ios', 'inapp_android'])->distinct()->count('session_id');

        $bySource = (clone $ev)->where('type', 'open')->selectRaw("coalesce(source,'tab') source, count(*) c, count(distinct session_id) s")->groupBy('source')->orderByDesc('c')->get();
        $byClick = (clone $ev)->where('type', 'click')->selectRaw("coalesce(source,'?') source, coalesce(platform,'?') platform, count(*) c, count(distinct session_id) s")->groupBy('source', 'platform')->orderByDesc('c')->get();
        $byRedirect = (clone $ev)->where('type', 'redirect')->selectRaw("coalesce(source,'link') source, coalesce(platform,'other') platform, count(*) c")->groupBy('source', 'platform')->orderByDesc('c')->get();
        $byDevice = (clone $ev)->whereIn('type', ['view', 'open', 'click', 'copy'])->selectRaw("device, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type in ('click','copy')) acts")->groupBy('device')->get();
        $byPlatform = (clone $ev)->whereIn('type', ['view', 'open', 'click', 'copy'])->selectRaw("coalesce(platform,'?') platform, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type='click') clicks, count(*) filter (where type='copy') copies")->groupBy('platform')->orderByDesc('views')->get();
        $dailyEv = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type='click') clicks, count(*) filter (where type='copy') copies, count(*) filter (where type='redirect') redirects")
            ->groupBy('d')->orderBy('d')->get()->keyBy('d');
        $errors = (clone $ev)->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();
        $firstEvent = DB::table('app_promo_events')->where('tenant_id', $tid)->where('is_test', false)->min('created_at');

        // ── Siparişler: uygulama siparişleri + kod kullanımı ──
        $appSrc = self::APP_SOURCES;
        $ordersBase = fn () => DB::table('orders')->where('tenant_id', $tid)->where('status', '!=', 8);
        $orderStats = function ($from, $to) use ($ordersBase, $appSrc, $codeArr) {
            $q = $ordersBase()->where('order_date', '>=', $from);
            if ($to) {
                $q->where('order_date', '<', $to);
            }
            $row = (clone $q)->selectRaw('count(*) total, count(*) filter (where order_source = any(?)) app, coalesce(sum(total_amount) filter (where order_source = any(?)),0) app_rev, count(*) filter (where upper(coupon_code) = any(?::text[])) code_orders, coalesce(sum(total_amount) filter (where upper(coupon_code) = any(?::text[])),0) code_rev, count(*) filter (where upper(coupon_code) = any(?::text[]) and not (order_source = any(?))) code_web', ['{'.implode(',', $appSrc).'}', '{'.implode(',', $appSrc).'}', $codeArr, $codeArr, $codeArr, '{'.implode(',', $appSrc).'}'])->first();

            return [
                'total' => (int) $row->total, 'app' => (int) $row->app, 'app_rev' => round((float) $row->app_rev, 2),
                'app_share' => (int) $row->total > 0 ? round((int) $row->app / (int) $row->total * 100, 1) : 0,
                'code_orders' => (int) $row->code_orders, 'code_rev' => round((float) $row->code_rev, 2), 'code_web' => (int) $row->code_web,
            ];
        };
        $cur = $orderStats($since, null);
        $prev = $orderStats($prevSince, $since);
        $arr = '{'.implode(',', $appSrc).'}';
        $dailyOrders = DB::select("
            select to_char(order_date, 'YYYY-MM-DD') d, count(*) total,
                   count(*) filter (where order_source = any(?::text[])) app,
                   count(*) filter (where upper(coupon_code) = any(?::text[])) code_orders,
                   coalesce(sum(total_amount) filter (where upper(coupon_code) = any(?::text[])),0) code_rev
            from orders where tenant_id = ? and status <> 8 and order_date >= ?
            group by 1 order by 1", [$arr, $codeArr, $codeArr, $tid, $since]);
        $codeBySource = DB::select('select order_source, count(*) c, coalesce(sum(total_amount),0) rev from orders where tenant_id = ? and status <> 8 and order_date >= ? and upper(coupon_code) = any(?::text[]) group by 1 order by 2 desc', [$tid, $since, $codeArr]);
        // Uygulamaya YENİ gelen müşteriler: ilk uygulama siparişi bu dönemde; kaçı daha önce web'den almıştı (web→app geçişi)
        $newApp = DB::select('
            select count(*) n, count(*) filter (where w.customer_id is not null) from_web, count(*) filter (where f.used_code) with_code
            from (select customer_id, min(order_date) first_app, bool_or(upper(coupon_code) = any(?::text[])) used_code from orders where tenant_id = ? and status <> 8 and order_source = any(?::text[]) and customer_id is not null group by customer_id) f
            left join lateral (select 1 customer_id from orders w where w.tenant_id = ? and w.customer_id = f.customer_id and w.order_date < f.first_app and not (w.order_source = any(?::text[])) limit 1) w on true
            where f.first_app >= ?', [$codeArr, $tid, $arr, $tid, $arr, $since]);
        $newRow = $newApp[0] ?? null;
        $codeUsers = DB::select('select count(distinct coalesce(customer_id::text, lower(customer_email))) n, count(*) filter (where rn = 1) firsts from (select customer_id, customer_email, upper(coupon_code) cc, row_number() over (partition by tenant_id, coalesce(customer_id::text, lower(customer_email)) order by order_date) rn from orders where tenant_id = ? and status <> 8) x where cc = any(?::text[]) and rn >= 1', [$tid, $codeArr]);

        // Günlük birleşik seri (olay + sipariş)
        $daily = [];
        $dO = collect($dailyOrders)->keyBy('d');
        $keys = array_unique(array_merge(array_keys($dailyEv->all()), array_keys($dO->all())));
        sort($keys);
        foreach ($keys as $d) {
            $e = $dailyEv[$d] ?? null;
            $o = $dO[$d] ?? null;
            $daily[] = [
                'd' => $d,
                'views' => (int) ($e->views ?? 0), 'opens' => (int) ($e->opens ?? 0), 'clicks' => (int) ($e->clicks ?? 0), 'copies' => (int) ($e->copies ?? 0), 'redirects' => (int) ($e->redirects ?? 0),
                'orders' => (int) ($o->total ?? 0), 'app_orders' => (int) ($o->app ?? 0), 'code_orders' => (int) ($o->code_orders ?? 0), 'code_rev' => round((float) ($o->code_rev ?? 0), 2),
            ];
        }

        return response()->json([
            'range_days' => $days,
            'code' => $code,
            'codes' => TenantAppPromoSettings::allCodes($rulesNow),
            'channel_codes' => $rulesNow['channel_codes'] ?? [],
            // kod başına (APP10 = doğrudan/organik, APP10M = Meta, APP10G = Google reklamından gelen ziyaretçi)
            'code_breakdown' => DB::select('select upper(coupon_code) code, count(*) c, coalesce(sum(total_amount),0) rev from orders where tenant_id = ? and status <> 8 and order_date >= ? and upper(coupon_code) = any(?::text[]) group by 1 order by 2 desc', [$tid, $since, $codeArr]),
            'first_event_at' => $firstEvent,
            'sessions' => $sessions,
            'open_sessions' => $openSessions,
            'opens' => $opens,
            'open_rate' => $sessions > 0 ? round($openSessions / $sessions * 100, 1) : 0,
            'clicks' => $clicks,
            'click_sessions' => $clickSessions,
            'click_rate' => $openSessions > 0 ? round($clickSessions / $openSessions * 100, 1) : 0,
            'copies' => $copies,
            'copy_sessions' => $copySessions,
            'redirects' => $redirects,
            'qr_scans' => $qrScans,
            'store_visits' => $storeVisits,
            'closes' => $closes,
            'inapp_sessions' => $inAppViews,
            'by_source' => $bySource,
            'by_click' => $byClick,
            'by_redirect' => $byRedirect,
            'by_device' => $byDevice,
            'by_platform' => $byPlatform,
            'errors' => $errors,
            'orders' => ['current' => $cur, 'previous' => $prev],
            'code_by_source' => $codeBySource,
            'new_app_customers' => ['n' => (int) ($newRow->n ?? 0), 'from_web' => (int) ($newRow->from_web ?? 0), 'with_code' => (int) ($newRow->with_code ?? 0)],
            'code_users' => ['n' => (int) ($codeUsers[0]->n ?? 0), 'first_orders' => (int) ($codeUsers[0]->firsts ?? 0)],
            'daily' => $daily,
        ]);
    }
}
