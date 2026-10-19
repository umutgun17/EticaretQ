<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\ForYou\TenantForYouSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** "Sana Özel" öneri kulakçığı (CRO) panel API'si — ayarlar + huni analitiği. */
class ForYouController extends Controller
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

        return response()->json($this->payload($tenant));
    }

    protected function payload(Tenant $tenant): array
    {
        $s = TenantForYouSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];

        return [
            'enabled' => $s['enabled'],
            'domains' => $s['domains'],
            'rules' => $s['rules'],
            'defaults' => TenantForYouSettings::DEFAULT_RULES,
            'modes' => TenantForYouSettings::MODES,
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
        ];
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
            'rules' => 'sometimes|array',
            'rules.title' => 'sometimes|string|max:40',
            'rules.tab_text' => 'sometimes|string|max:24',
            'rules.subtitle_bestseller' => 'sometimes|nullable|string|max:80',
            'rules.subtitle_category' => 'sometimes|nullable|string|max:80',
            'rules.subtitle_viewed' => 'sometimes|nullable|string|max:80',
            'rules.subtitle_cart' => 'sometimes|nullable|string|max:80',
            'rules.subtitle_history' => 'sometimes|nullable|string|max:80',
            'rules.count' => 'sometimes|integer|between:2,8',
            'rules.accent' => 'sometimes|nullable|string|max:7',
            'rules.side' => 'sometimes|string|in:left,right',
            'rules.show_add' => 'sometimes|boolean',
            'rules.nudge_after' => 'sometimes|integer|between:0,20',
            'rules.nudge_text' => 'sometimes|string|max:60',
            'rules.product_page' => 'sometimes|string|in:subtle,normal,hidden',
            'rules.hide_paths' => 'sometimes|nullable|string|max:300',
            'rules.bestseller_days' => 'sometimes|integer|between:7,180',
            'rules.use_history' => 'sometimes|boolean',
            'rules.pulse' => 'sometimes|boolean',
            'rules.auto_open' => 'sometimes|boolean',
            'rules.auto_views' => 'sometimes|integer|between:0,20',
            'rules.auto_delay' => 'sometimes|integer|between:0,120',
            'rules.auto_idle' => 'sometimes|integer|between:0,300',
            'rules.auto_exit' => 'sometimes|boolean',
            'rules.auto_daily' => 'sometimes|integer|between:1,5',
        ]);

        $settings = $tenant->settings ?? [];
        if (array_key_exists('enabled', $data)) {
            $settings['foryou_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $settings['foryou_domains'] = trim((string) $data['domains']);
        }
        if (array_key_exists('rules', $data)) {
            $current = TenantForYouSettings::get($tenant->id)['rules'];
            $settings['foryou_rules'] = TenantForYouSettings::sanitizeRules(array_merge($current, $data['rules']));
        }
        $tenant->settings = $settings;
        $tenant->save();
        TenantForYouSettings::forget($tenant->id);

        return response()->json($this->payload($tenant));
    }

    /** GET /cro/foryou/analytics?range=30 — huni: gören → açan → ürüne giden → sepete ekleyen → satın alan; mod/ürün/gün kırılımı. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = fn () => DB::table('foryou_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) $ev()->where('type', 'view')->distinct()->count('session_id');
        $nudges = (int) $ev()->where('type', 'nudge')->count();
        $opens = (int) $ev()->where('type', 'open')->count();
        $openSessions = (int) $ev()->where('type', 'open')->distinct()->count('session_id');
        $nudgeOpens = (int) $ev()->where('type', 'open')->where('source', 'nudge')->count();
        $clicks = (int) $ev()->where('type', 'click')->count();
        $clickSessions = (int) $ev()->whereIn('type', ['click', 'atc'])->distinct()->count('session_id');
        $atc = (int) $ev()->where('type', 'atc')->count();
        $closes = (int) $ev()->where('type', 'close')->count();
        $conv = $ev()->where('type', 'conversion')->selectRaw('count(*) c, count(distinct platform_order_id) o, coalesce(sum(value_num),0) rev')->first();

        $byMode = $ev()->whereIn('type', ['view', 'open', 'click', 'atc', 'conversion'])->whereNotNull('mode')
            ->selectRaw("mode, count(distinct session_id) filter (where type='view') views, count(*) filter (where type='open') opens, count(*) filter (where type='click') clicks, count(*) filter (where type='atc') atc, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('mode')->orderByDesc('views')->get();
        $byProduct = DB::select("
            select e.product_id, p.name, p.url,
                   count(*) filter (where e.type='click') clicks,
                   count(*) filter (where e.type='atc') atc,
                   count(*) filter (where e.type='conversion') conv,
                   coalesce(sum(e.value_num) filter (where e.type='conversion'),0) rev
            from foryou_events e left join products p on p.id = e.product_id
            where e.tenant_id = ? and e.is_test = false and e.created_at >= ? and e.product_id is not null and e.type in ('click','atc','conversion')
            group by 1,2,3 order by clicks desc, atc desc limit 30", [$tenant->id, $since]);
        $byDevice = $ev()->whereIn('type', ['view', 'open', 'click', 'atc'])
            ->selectRaw("device, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type in ('click','atc')) acts")
            ->groupBy('device')->get();
        $daily = $ev()->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type in ('click','atc')) acts, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('d')->orderBy('d')->get();
        $bySource = $ev()->where('type', 'open')->selectRaw("coalesce(source,'tab') s, count(*) c, count(distinct session_id) n")->groupBy('s')->orderByDesc('c')->get();
        // Açılma kaynağı → aynı oturumda tık/sepet var mı (otomatik açılma işe yarıyor mu)
        $srcEng = DB::select("
            select coalesce(o.source,'tab') s, count(distinct o.session_id) opened,
                   count(distinct case when e.session_id is not null then o.session_id end) engaged
            from foryou_events o
            left join foryou_events e on e.tenant_id = o.tenant_id and e.session_id = o.session_id and e.type in ('click','atc') and e.created_at >= o.created_at and e.is_test = false
            where o.tenant_id = ? and o.type = 'open' and o.is_test = false and o.created_at >= ?
            group by 1 order by 2 desc", [$tenant->id, $since]);
        $byPage = $ev()->where('type', 'open')->selectRaw("coalesce(page_type,'') t, count(*) c")->groupBy('t')->orderByDesc('c')->get();
        $errors = $ev()->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'nudges' => $nudges,
            'opens' => $opens,
            'open_sessions' => $openSessions,
            'open_rate' => $sessions > 0 ? round($openSessions / $sessions * 100, 1) : 0,
            'nudge_opens' => $nudgeOpens,
            'nudge_rate' => $nudges > 0 ? round($nudgeOpens / $nudges * 100, 1) : null,
            'clicks' => $clicks,
            'click_sessions' => $clickSessions,
            'engagement_rate' => $openSessions > 0 ? round($clickSessions / $openSessions * 100, 1) : 0,
            'atc' => $atc,
            'closes' => $closes,
            'conversions' => (int) ($conv->c ?? 0),
            'orders' => (int) ($conv->o ?? 0),
            'revenue' => round((float) ($conv->rev ?? 0), 2),
            'by_mode' => $byMode,
            'by_product' => $byProduct,
            'by_device' => $byDevice,
            'by_page' => $byPage,
            'by_source' => $bySource,
            'source_engagement' => $srcEng,
            'daily' => $daily,
            'errors' => $errors,
        ]);
    }
}
