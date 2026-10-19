<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Cart\TenantCartSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Sepet Kampanyası paneli (CRO): ayarlar + analitik. */
class CartController extends Controller
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
        $s = TenantCartSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'tier_types' => TenantCartSettings::TIER_TYPES,
            'bases' => TenantCartSettings::BASES,
            'defaults' => ['theme' => TenantCartSettings::DEFAULT_THEME, 'rules' => TenantCartSettings::DEFAULT_RULES],
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $hex = 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/';
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'domains' => 'sometimes|nullable|string|max:500',
            'theme' => 'sometimes|array',
            'theme.accent' => $hex, 'theme.accent2' => $hex, 'theme.ok' => $hex, 'theme.ink' => $hex,
            'theme.muted' => $hex, 'theme.bg' => $hex, 'theme.track' => $hex, 'theme.badge_color' => $hex,
            'theme.radius' => 'sometimes|integer|between:0,24',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'theme.style' => 'sometimes|string|in:card,flat',
            'theme.celebrate' => 'sometimes|boolean',
            'rules' => 'sometimes|array',
            'rules.tiers' => 'sometimes|array|max:6',
            'rules.tiers.*.threshold' => 'required_with:rules.tiers|numeric|between:1,9999999',
            'rules.tiers.*.type' => 'required_with:rules.tiers|string|in:'.implode(',', TenantCartSettings::TIER_TYPES),
            'rules.tiers.*.value' => 'sometimes|nullable|numeric|between:0,9999999',
            'rules.tiers.*.label' => 'sometimes|nullable|string|max:60',
            'rules.tiers.*.short' => 'sometimes|nullable|string|max:14',
            'rules.basis' => 'sometimes|string|in:'.implode(',', TenantCartSettings::BASES),
            'rules.title' => 'sometimes|nullable|string|max:60',
            'rules.msg_next' => 'sometimes|nullable|string|max:120',
            'rules.msg_reached' => 'sometimes|nullable|string|max:120',
            'rules.msg_all' => 'sometimes|nullable|string|max:120',
            'rules.msg_empty' => 'sometimes|nullable|string|max:120',
            'rules.show_savings' => 'sometimes|boolean',
            'rules.show_value' => 'sometimes|boolean',
            'rules.shipping_fee' => 'sometimes|nullable|numeric|between:0,99999',
            'rules.suggest_enabled' => 'sometimes|boolean',
            'rules.suggest_title' => 'sometimes|nullable|string|max:60',
            'rules.suggest_unlock' => 'sometimes|nullable|string|max:60',
            'rules.suggest_max' => 'sometimes|integer|between:2,8',
            'rules.suggest_side' => 'sometimes|boolean',
            'rules.suggest_checkout' => 'sometimes|boolean',
            'rules.suggest_hide_all' => 'sometimes|boolean',
            'rules.cta_text' => 'sometimes|nullable|string|max:40',
            'rules.cta_url' => 'sometimes|nullable|string|max:300',
            'rules.show_cta' => 'sometimes|boolean',
            'rules.side_enabled' => 'sometimes|boolean',
            'rules.side_price' => 'sometimes|boolean',
            'rules.side_summary' => 'sometimes|boolean',
            'rules.side_mount' => 'sometimes|nullable|string|max:300',
            'rules.checkout_enabled' => 'sometimes|boolean',
            'rules.checkout_price' => 'sometimes|boolean',
            'rules.checkout_summary' => 'sometimes|boolean',
            'rules.checkout_mount' => 'sometimes|nullable|string|max:300',
            'rules.checkout_summary_mount' => 'sometimes|nullable|string|max:300',
            'rules.checkout_hide_selector' => 'sometimes|nullable|string|max:300',
            'rules.checkout_paths' => 'sometimes|nullable|string|max:200',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.currency' => 'sometimes|nullable|string|max:6',
            'rules.max_width' => 'sometimes|integer|between:480,1400',
            'rules.started_at' => 'sometimes|nullable|string|max:20',
            'rules.impact_sources' => 'sometimes|nullable|string|max:200',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantCartSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['cart_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['cart_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['cart_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $rules = $data['rules'];
            if (array_key_exists('tiers', $rules)) {
                $rules['tiers'] = TenantCartSettings::normalizeTiers($rules['tiers']);
            }
            $s['cart_rules'] = json_encode(array_merge($cur['rules'], $rules));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantCartSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /**
     * GET /cro/cart/impact?start=Y-m-d H:i — kampanya ETKİSİ: canlıya alındığı andan itibaren siparişler (adet/ciro/ort. sepet/
     * eşik bantları/sepet indirimi uygulanan) ↔ (a) önceki 28 günde AYNI SAAT PENCERESİ günlük ortalaması, (b) aynı haftanın günü (4 hafta),
     * (c) önceki 3 tam ay. orders.order_date TR saatidir. Ay-öncesi kıyas için günlük seri de döner (kampanya öncesi 14 gün + sonrası).
     */
    public function impact(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $s = TenantCartSettings::get($tenant->id);
        $startRaw = trim((string) ($request->query('start') ?: ($s['rules']['started_at'] ?? '')));
        try {
            $start = $startRaw !== '' ? \Carbon\Carbon::parse($startRaw, 'Europe/Istanbul') : null;
        } catch (\Throwable $e) {
            $start = null;
        }
        if (! $start) {
            return response()->json(['started_at' => null, 'message' => 'Başlangıç anı tanımlı değil']);
        }
        $now = now('Europe/Istanbul');
        if ($start->gt($now)) {
            return response()->json(['started_at' => $start->format('Y-m-d H:i'), 'message' => 'Başlangıç gelecekte']);
        }
        $sources = array_values(array_filter(array_map('trim', explode(',', (string) ($s['rules']['impact_sources'] ?? '')))));
        $tiers = array_map(fn ($t) => (float) $t['threshold'], $s['rules']['tiers'] ?? []);
        sort($tiers);
        $bandSql = '';
        $bandSelect = [];
        foreach ($tiers as $i => $th) {
            $bandSelect[] = "sum(case when total_amount >= {$th} then 1 else 0 end) as ge{$i}";
        }
        $base = fn () => DB::table('orders')->where('tenant_id', $tenant->id)->when($sources, fn ($q) => $q->whereIn('order_source', $sources));
        $agg = function ($q) use ($bandSelect) {
            $r = $q->selectRaw('count(*) c, coalesce(sum(total_amount),0) rev, coalesce(avg(total_amount),0) aov, sum(case when discount_amount>0 then 1 else 0 end) disc'.($bandSelect ? ', '.implode(', ', $bandSelect) : ''))->first();

            return $r ? (array) $r : [];
        };
        $fmt = function (array $r, float $days) use ($tiers) {
            $c = (int) ($r['c'] ?? 0);
            $out = ['orders' => $c, 'revenue' => round((float) ($r['rev'] ?? 0), 2), 'aov' => round((float) ($r['aov'] ?? 0), 2), 'disc' => (int) ($r['disc'] ?? 0),
                'orders_per_day' => $days > 0 ? round($c / $days, 2) : null, 'revenue_per_day' => $days > 0 ? round((float) ($r['rev'] ?? 0) / $days, 2) : null, 'days' => round($days, 2), 'bands' => []];
            foreach ($tiers as $i => $th) {
                $n = (int) ($r["ge{$i}"] ?? 0);
                $out['bands'][] = ['threshold' => $th, 'orders' => $n, 'share' => $c > 0 ? round($n / $c * 100, 1) : 0];
            }
            $out['disc_share'] = $c > 0 ? round($out['disc'] / $c * 100, 1) : 0;

            return $out;
        };

        // (1) kampanya penceresi
        $campaign = $fmt($agg($base()->where('order_date', '>=', $start->format('Y-m-d H:i:s'))->where('order_date', '<=', $now->format('Y-m-d H:i:s'))), max(0.01, $start->floatDiffInDays($now)));

        // (2) önceki 28 gün: her gün için aynı saat penceresi (start saati → şimdi saati; gün aşıyorsa pencere gün sonuna kadar)
        $tod0 = $start->format('H:i:s');
        $tod1 = $now->format('H:i:s');
        $sameDay = $start->isSameDay($now);
        $win = function ($q) use ($sameDay, $tod0, $tod1) {
            if ($sameDay) {
                return $q->whereRaw("order_date::time >= ?", [$tod0])->whereRaw("order_date::time <= ?", [$tod1]);
            }

            return $q; // çok günlük pencere: tam günler kıyaslanır
        };
        $b28 = $fmt($agg($win($base()->where('order_date', '>=', $start->copy()->subDays(28)->startOfDay())->where('order_date', '<', $start->copy()->startOfDay()))), 28.0);
        // (3) aynı haftanın günü, son 4 hafta
        $dowQ = $win($base()->where('order_date', '>=', $start->copy()->subDays(28)->startOfDay())->where('order_date', '<', $start->copy()->startOfDay())->whereRaw('extract(dow from order_date) = ?', [(int) $start->format('w')]));
        $bDow = $fmt($agg($dowQ), 4.0);
        // (4) önceki 3 tam ay (tüm saatler)
        $m0 = $start->copy()->startOfMonth()->subMonths(3);
        $m1 = $start->copy()->startOfMonth();
        $b3m = $fmt($agg($base()->where('order_date', '>=', $m0)->where('order_date', '<', $m1)), $m0->diffInDays($m1));

        // günlük seri: başlangıçtan 14 gün önce → bugün (sipariş/ciro/AOV/≥ilk eşik payı)
        $th0 = $tiers[0] ?? 0;
        $daily = $base()->where('order_date', '>=', $start->copy()->subDays(14)->startOfDay())
            ->selectRaw("to_char(order_date, 'YYYY-MM-DD') d, count(*) c, round(sum(total_amount)::numeric,2) rev, round(avg(total_amount)::numeric,2) aov, sum(case when total_amount >= {$th0} then 1 else 0 end) ge0, sum(case when discount_amount>0 then 1 else 0 end) disc")
            ->groupBy('d')->orderBy('d')->get();

        return response()->json([
            'started_at' => $start->format('Y-m-d H:i'),
            'now' => $now->format('Y-m-d H:i'),
            'sources' => $sources,
            'tiers' => $tiers,
            'campaign' => $campaign,
            'baseline_28d' => $b28,
            'baseline_dow' => $bDow,
            'baseline_3m' => $b3m,
            'same_day_window' => $sameDay,
            'daily' => $daily,
        ])->header('Cache-Control', 'no-store');
    }

    /** GET /cro/cart/analytics?range=30 — çubuğu gören oturumlar, kademe dağılımı, "eşiğe yakın" oturumlar, kazanılan kademeler. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('cart_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->whereIn('type', ['view', 'update'])->distinct()->count('session_id');
        $bySurface = (clone $ev)->whereIn('type', ['view', 'update'])->selectRaw('surface, count(distinct session_id) s, count(*) c')->groupBy('surface')->get();
        $unlocks = (clone $ev)->where('type', 'unlock')->selectRaw('tier, count(*) c, count(distinct session_id) s')->groupBy('tier')->orderBy('tier')->get();
        $ctas = (int) (clone $ev)->where('type', 'cta')->count();
        $ctaSessions = (int) (clone $ev)->where('type', 'cta')->distinct()->count('session_id');
        $checkouts = (int) (clone $ev)->where('type', 'checkout')->distinct()->count('session_id');
        $suggestSessions = (int) (clone $ev)->where('type', 'suggest')->distinct()->count('session_id');
        $adds = (int) (clone $ev)->where('type', 'add')->count();
        $addSessions = (int) (clone $ev)->where('type', 'add')->distinct()->count('session_id');
        $addFails = (int) (clone $ev)->where('type', 'add_fail')->count();
        $topAdded = (clone $ev)->where('type', 'add')->whereNotNull('value')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(8)->get();
        $topIds = $topAdded->pluck('value')->map(fn ($v) => (int) $v)->filter()->all();
        $names = $topIds ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('id', $topIds)->pluck('name', 'id') : collect();
        $topAdded = $topAdded->map(fn ($r) => ['id' => (int) $r->value, 'name' => (string) ($names[(int) $r->value] ?? ('#'.$r->value)), 'c' => (int) $r->c])->values();

        // Oturumun SON görülen durumu: kademe dağılımı + eşiğe yakınlık (kalan < eşik farkının %25'i)
        $last = DB::table('cart_events as e')
            ->joinSub(
                (clone $ev)->whereIn('type', ['view', 'update'])->whereNotNull('session_id')->selectRaw('session_id, max(id) mid')->groupBy('session_id'),
                'l', 'l.mid', '=', 'e.id'
            );
        $tierDist = (clone $last)->selectRaw('e.tier, count(*) c, avg(e.basis) avg_basis')->groupBy('e.tier')->orderBy('e.tier')->get();
        $avgBasis = (float) ((clone $last)->avg('e.basis') ?? 0);
        $nearMiss = (clone $last)->whereRaw('e.remaining > 0 and e.remaining <= greatest(150, e.basis * 0.15)')->selectRaw('e.tier, count(*) c, avg(e.remaining) avg_remaining')->groupBy('e.tier')->orderBy('e.tier')->get();

        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type in ('view','update')) sessions, count(*) filter (where type='unlock') unlocks, count(*) filter (where type='cta') ctas, count(*) filter (where type='add') adds")
            ->groupBy('d')->orderBy('d')->get();
        $errors = (clone $ev)->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'by_surface' => $bySurface,
            'unlocks' => $unlocks,
            'ctas' => $ctas,
            'cta_sessions' => $ctaSessions,
            'cta_rate' => $sessions > 0 ? round($ctaSessions / $sessions * 100, 1) : 0,
            'checkout_sessions' => $checkouts,
            'suggest_sessions' => $suggestSessions,
            'adds' => $adds,
            'add_sessions' => $addSessions,
            'add_rate' => $suggestSessions > 0 ? round($addSessions / $suggestSessions * 100, 1) : 0,
            'add_fails' => $addFails,
            'top_added' => $topAdded,
            'tier_dist' => $tierDist,
            'avg_basis' => round($avgBasis, 2),
            'near_miss' => $nearMiss,
            'daily' => $daily,
            'errors' => $errors,
        ]);
    }
}
