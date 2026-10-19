<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Welcome\TenantWelcomeSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** "Hoş geldin" ilk alışveriş hediyesi (CRO) panel API'si — ayarlar + analitik. */
class WelcomeController extends Controller
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
        $s = TenantWelcomeSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        // Kupon mağazada gerçekten kullanılmış mı (son 90 gün) — panelde "kupon tanımlı mı" uyarısı için
        $codeUse = DB::table('orders')->where('tenant_id', $tenant->id)
            ->whereRaw('upper(coalesce(coupon_code, \'\')) = ?', [strtoupper($s['rules']['code'])])
            ->where('order_date', '>=', now()->subDays(90))->count();

        return [
            'enabled' => $s['enabled'],
            'domains' => $s['domains'],
            'rules' => $s['rules'],
            'defaults' => TenantWelcomeSettings::DEFAULT_RULES,
            'code_orders_90d' => $codeUse,
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
            'rules.code' => 'sometimes|string|max:40',
            'rules.percent' => 'sometimes|integer|between:1,90',
            'rules.eyebrow' => 'sometimes|nullable|string|max:40',
            'rules.title' => 'sometimes|string|max:80',
            'rules.text' => 'sometimes|nullable|string|max:200',
            'rules.cta' => 'sometimes|string|max:40',
            'rules.revealed_title' => 'sometimes|string|max:60',
            'rules.revealed_text' => 'sometimes|nullable|string|max:200',
            'rules.shop_cta' => 'sometimes|string|max:40',
            'rules.shop_url' => 'sometimes|nullable|string|max:300',
            'rules.image_url' => 'sometimes|nullable|string|max:300',
            'rules.accent' => 'sometimes|nullable|string|max:7',
            'rules.position' => 'sometimes|string|in:left,right',
            'rules.delay' => 'sometimes|integer|between:0,300',
            'rules.min_pages' => 'sometimes|integer|between:0,20',
            'rules.exit_intent' => 'sometimes|boolean',
            'rules.product_page' => 'sometimes|boolean',
            'rules.hide_paths' => 'sometimes|nullable|string|max:300',
            'rules.dismiss_days' => 'sometimes|integer|between:1,90',
            'rules.hide_customers' => 'sometimes|boolean',
            'rules.remind' => 'sometimes|boolean',
            'rules.remind_text' => 'sometimes|string|max:60',
            'rules.remind_days' => 'sometimes|integer|between:1,90',
        ]);

        $settings = $tenant->settings ?? [];
        $current = TenantWelcomeSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $settings['welcome_enabled'] = (bool) $data['enabled'];
            // Ölçüm başlangıcı: ilk açılışta otomatik (kuponlu siparişler bu andan sayılır)
            if ($data['enabled'] && empty($current['rules']['started_at'])) {
                $data['rules'] = ($data['rules'] ?? []) + ['started_at' => now()->toDateTimeString()];
            }
        }
        if (array_key_exists('domains', $data)) {
            $settings['welcome_domains'] = trim((string) $data['domains']);
        }
        if (array_key_exists('rules', $data)) {
            $settings['welcome_rules'] = TenantWelcomeSettings::sanitizeRules(array_merge($current['rules'], $data['rules']));
        }
        $tenant->settings = $settings;
        $tenant->save();
        TenantWelcomeSettings::forget($tenant->id);

        return response()->json($this->payload($tenant));
    }

    /** GET /cro/welcome/analytics?range=30 — huni: gören → kodu açan → kopyalayan → kuponla sipariş; kapatma; tetik/cihaz/gün kırılımı. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $r = TenantWelcomeSettings::get($tenant->id)['rules'];
        $ev = fn () => DB::table('welcome_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) $ev()->where('type', 'view')->distinct()->count('session_id');
        $reveal = (int) $ev()->where('type', 'reveal')->distinct()->count('session_id');
        $copy = (int) $ev()->whereIn('type', ['copy', 'remind'])->distinct()->count('session_id');
        $dismiss = (int) $ev()->where('type', 'dismiss')->count();
        $cta = (int) $ev()->where('type', 'cta')->count();
        $conv = $ev()->where('type', 'conversion')->selectRaw("count(*) c, count(*) filter (where source='coupon') cc, coalesce(sum(value_num),0) rev, coalesce(sum(discount),0) disc")->first();
        $byTrigger = $ev()->where('type', 'view')->selectRaw("coalesce(source,'') s, count(distinct session_id) n")->groupBy('s')->orderByDesc('n')->get();
        $trigEng = DB::select("
            select coalesce(v.source,'') s, count(distinct v.session_id) shown,
                   count(distinct case when e.session_id is not null then v.session_id end) revealed
            from welcome_events v
            left join welcome_events e on e.tenant_id = v.tenant_id and e.session_id = v.session_id and e.type = 'reveal' and e.is_test = false
            where v.tenant_id = ? and v.type = 'view' and v.is_test = false and v.created_at >= ?
            group by 1 order by 2 desc", [$tenant->id, $since]);
        $byDevice = $ev()->whereIn('type', ['view', 'reveal', 'conversion'])
            ->selectRaw("device, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='reveal') reveals, count(*) filter (where type='conversion') conv")
            ->groupBy('device')->get();
        $daily = $ev()->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='reveal') reveals, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('d')->orderBy('d')->get();
        // Mağazadaki tüm kuponlu siparişler (widget'tan bağımsız doğrulama): kod kullanım sayısı
        $codeOrders = DB::table('orders')->where('tenant_id', $tenant->id)
            ->whereRaw('upper(coalesce(coupon_code, \'\')) = ?', [strtoupper($r['code'])])
            ->where('paid_amount', '>', 0)->where('order_date', '>=', now('Europe/Istanbul')->subDays($days)->format('Y-m-d H:i:s'))
            ->selectRaw('count(*) c, coalesce(sum(total_amount),0) rev')->first();
        $errors = $ev()->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();

        return response()->json([
            'range_days' => $days,
            'code' => $r['code'],
            'started_at' => $r['started_at'],
            'sessions' => $sessions,
            'reveals' => $reveal,
            'reveal_rate' => $sessions > 0 ? round($reveal / $sessions * 100, 1) : 0,
            'copies' => $copy,
            'dismisses' => $dismiss,
            'ctas' => $cta,
            'conversions' => (int) ($conv->c ?? 0),
            'coupon_conversions' => (int) ($conv->cc ?? 0),
            'revenue' => round((float) ($conv->rev ?? 0), 2),
            'discount' => round((float) ($conv->disc ?? 0), 2),
            'code_orders' => (int) ($codeOrders->c ?? 0),
            'code_revenue' => round((float) ($codeOrders->rev ?? 0), 2),
            'by_trigger' => $byTrigger,
            'trigger_engagement' => $trigEng,
            'by_device' => $byDevice,
            'daily' => $daily,
            'errors' => $errors,
        ]);
    }
}
