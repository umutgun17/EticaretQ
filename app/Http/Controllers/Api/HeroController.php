<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Hero\TenantHeroSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Bugüne Özel" Hero Ürün paneli (CRO): ayarlar, setler, ürün arama, öneri, analitik. */
class HeroController extends Controller
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
        $s = TenantHeroSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
        $today = now('Europe/Istanbul')->format('Y-m-d');
        $active = TenantHeroSettings::activeSet($s['sets'], $today);
        $allIds = [];
        foreach ($s['sets'] as $st) {
            $allIds = array_merge($allIds, $st['products']);
        }
        $cards = PublicHeroController::resolveProducts($tenant->id, array_values(array_unique($allIds)), $shop);
        $shown = $s['rules']['best_color'] !== false ? PublicHeroController::bestColorMap($tenant->id, $cards) : [];
        $byId = [];
        foreach ($cards as $c) {
            $byId[$c['id']] = $c;
        }

        return response()->json($s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => $shop,
            'today' => $today,
            'active_set_id' => $active['id'] ?? null,
            'ends_at' => PublicHeroController::endsAt($s['rules']['timer_mode'], $active),
            'products' => $byId,
            'shown_colors' => $shown,
            'presets' => TenantHeroSettings::PRESETS,
            'tab_styles' => TenantHeroSettings::TAB_STYLES,
            'tab_positions' => TenantHeroSettings::TAB_POSITIONS,
            'timer_modes' => TenantHeroSettings::TIMER_MODES,
            'frequencies' => TenantHeroSettings::FREQUENCIES,
            'max_products' => TenantHeroSettings::MAX_PRODUCTS,
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
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantHeroSettings::PRESETS),
            'theme.accent' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.accent2' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.ink' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.bg' => 'sometimes|string|regex:/^#[0-9a-fA-F]{6}$/',
            'theme.radius' => 'sometimes|integer|between:0,32',
            'theme.tab_style' => 'sometimes|string|in:'.implode(',', TenantHeroSettings::TAB_STYLES),
            'theme.tab_position' => 'sometimes|string|in:'.implode(',', TenantHeroSettings::TAB_POSITIONS),
            'theme.tab_text' => 'sometimes|nullable|string|max:24',
            'theme.tab_emoji' => 'sometimes|nullable|string|max:4',
            'theme.tab_pulse' => 'sometimes|boolean',
            'theme.tab_timer' => 'sometimes|boolean',
            'theme.drawer_width' => 'sometimes|integer|between:320,640',
            'theme.card_layout' => 'sometimes|string|in:row,grid',
            'theme.layout' => 'sometimes|string|in:full,minimal,panel',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'rules' => 'sometimes|array',
            'rules.eyebrow' => 'sometimes|nullable|string|max:30',
            'rules.title' => 'sometimes|nullable|string|max:60',
            'rules.subtitle' => 'sometimes|nullable|string|max:140',
            'rules.timer_mode' => 'sometimes|string|in:'.implode(',', TenantHeroSettings::TIMER_MODES),
            'rules.timer_label' => 'sometimes|nullable|string|max:40',
            'rules.auto_open' => 'sometimes|boolean',
            'rules.auto_open_delay' => 'sometimes|integer|between:3,300',
            'rules.auto_open_scroll' => 'sometimes|integer|between:0,100',
            'rules.exit_intent' => 'sometimes|boolean',
            'rules.frequency' => 'sometimes|string|in:'.implode(',', TenantHeroSettings::FREQUENCIES),
            'rules.quick_add' => 'sometimes|boolean',
            'rules.show_stock' => 'sometimes|boolean',
            'rules.stock_threshold' => 'sometimes|integer|between:1,50',
            'rules.show_discount_badge' => 'sometimes|boolean',
            'rules.best_color' => 'sometimes|boolean',
            'rules.cta_text' => 'sometimes|nullable|string|max:24',
            'rules.view_text' => 'sometimes|nullable|string|max:24',
            'rules.footer_text' => 'sometimes|nullable|string|max:40',
            'rules.footer_url' => 'sometimes|nullable|string|max:200',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.hide_page_types' => 'sometimes|array',
            'rules.hide_page_types.*' => 'string|in:home,category,product,account,other',
            'rules.no_auto_page_types' => 'sometimes|array',
            'rules.no_auto_page_types.*' => 'string|in:home,category,product,account,other',
            'rules.mobile_sheet' => 'sometimes|boolean',
            'rules.max_width' => 'sometimes|integer|between:0,1400',
            'rules.min_width' => 'sometimes|integer|between:0,1400',
            'sets' => 'sometimes|nullable|array|max:60',
            'sets.*.id' => 'sometimes|nullable|string|max:24',
            'sets.*.title' => 'sometimes|nullable|string|max:60',
            'sets.*.subtitle' => 'sometimes|nullable|string|max:140',
            'sets.*.eyebrow' => 'sometimes|nullable|string|max:24',
            'sets.*.badge' => 'sometimes|nullable|string|max:20',
            'sets.*.start_date' => 'sometimes|nullable|date_format:Y-m-d',
            'sets.*.end_date' => 'sometimes|nullable|date_format:Y-m-d',
            'sets.*.products' => 'sometimes|array|max:'.TenantHeroSettings::MAX_PRODUCTS,
            'sets.*.products.*' => 'integer',
            'sets.*.coupon' => 'sometimes|nullable|string|max:32',
            'sets.*.coupon_text' => 'sometimes|nullable|string|max:100',
            'sets.*.enabled' => 'sometimes|boolean',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantHeroSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['hero_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['hero_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['hero_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['hero_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('sets', $data)) {
            // Setteki ürünler bu tenant'a ait olmalı
            $ids = [];
            foreach ((array) $data['sets'] as $st) {
                $ids = array_merge($ids, array_map('intval', (array) ($st['products'] ?? [])));
            }
            $own = $ids ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('id', array_unique($ids))->pluck('id')->map(fn ($i) => (int) $i)->all() : [];
            $sets = array_map(function ($st) use ($own) {
                $st['products'] = array_values(array_filter(array_map('intval', (array) ($st['products'] ?? [])), fn ($i) => in_array($i, $own, true)));

                return $st;
            }, (array) $data['sets']);
            $s['hero_sets'] = json_encode(TenantHeroSettings::sanitizeSets($sets));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantHeroSettings::forget($tenant->id);
        Cache::forget('hero:config:'.$tenant->id.':'.now('Europe/Istanbul')->format('Y-m-d'));

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /** GET /cro/hero/products?q=&ids=&limit= — panel ürün seçici (aktif ürünler; stoksuz da listelenir ama işaretlenir). */
    public function products(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $q = trim((string) $request->query('q', ''));
        $ids = array_filter(array_map('intval', explode(',', (string) $request->query('ids', ''))));
        $limit = max(1, min(60, (int) $request->query('limit', 24)));
        $only = $request->boolean('discounted');
        $query = DB::table('products')->where('tenant_id', $tenant->id);
        if ($ids) {
            $query->whereIn('id', $ids);
        } else {
            $query->where('is_active', true)->where('stock_quantity', '>', 0)->whereNotNull('images')->where('images', '<>', '[]');
            if ($q !== '') {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
                $query->where(function ($w) use ($like, $q) {
                    $w->where('name', 'ILIKE', $like)->orWhere('sku', 'ILIKE', $like)->orWhere('brand', 'ILIKE', $like)
                        ->orWhere('platform_product_id', $q);
                });
            }
            if ($only) {
                $query->whereNotNull('discounted_price')->where('discounted_price', '>', 0)->whereColumn('discounted_price', '<', 'price');
            }
            $query->orderByDesc('platform_updated_at');
        }
        $found = $query->limit($limit)->pluck('id')->map(fn ($i) => (int) $i)->all();
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');

        return response()->json(['data' => PublicHeroController::resolveProducts($tenant->id, $found, $shop)]);
    }

    /**
     * GET /cro/hero/suggest?count=3 — Yunbi önerisi: stoklu + görselli + indirimli ürünler arasından
     * son 14 gün satış ivmesi × indirim oranı × puan; son 7 günde sette kullanılanlar dışlanır (çeşitlilik).
     */
    public function suggest(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $count = max(1, min(TenantHeroSettings::MAX_PRODUCTS, (int) $request->query('count', 3)));
        $s = TenantHeroSettings::get($tenant->id);
        $recent = [];
        $weekAgo = now('Europe/Istanbul')->subDays(7)->format('Y-m-d');
        foreach ($s['sets'] as $st) {
            if (($st['end_date'] ?? null) === null || $st['end_date'] >= $weekAgo) {
                $recent = array_merge($recent, $st['products']);
            }
        }
        $rows = DB::select("
            with sales as (
                select oi.product_id, sum(oi.quantity) q
                from order_items oi join orders o on o.id = oi.order_id
                where o.tenant_id = ? and o.order_date > now() - interval '14 days' and coalesce(o.paid_amount,0) > 0
                group by oi.product_id
            )
            select p.id, coalesce(s.q,0) q,
                   round((p.price - p.discounted_price) / nullif(p.price,0) * 100) disc,
                   coalesce(p.trendyol_rating, 0) rating
            from products p left join sales s on s.product_id = p.id
            where p.tenant_id = ? and p.is_active and p.stock_quantity > 2 and p.images is not null and p.images::text <> '[]'
              and p.discounted_price is not null and p.discounted_price > 0 and p.discounted_price < p.price
              and (p.price - p.discounted_price) / nullif(p.price,0) >= 0.15
            order by (coalesce(s.q,0) * 1.0) desc, disc desc
            limit 400", [$tenant->id, $tenant->id]);
        if (! $rows) {
            return response()->json(['data' => [], 'reason' => 'no_discounted']);
        }
        $maxQ = max(1, max(array_map(fn ($r) => (int) $r->q, $rows)));
        $scored = [];
        foreach ($rows as $r) {
            if (in_array((int) $r->id, $recent, true)) {
                continue;
            }
            $score = 0.45 * ((int) $r->q / $maxQ) + 0.35 * min(1, (float) $r->disc / 60) + 0.20 * ((float) $r->rating / 5);
            $scored[] = [(int) $r->id, $score];
        }
        usort($scored, fn ($a, $b) => $b[1] <=> $a[1]);
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');
        $cards = PublicHeroController::resolveProducts($tenant->id, array_map(fn ($x) => $x[0], array_slice($scored, 0, $count * 4)), $shop);
        // Aynı model ailesinden (ad ilk 3 kelime) bir ürün — çeşitlilik
        $out = [];
        $fam = [];
        foreach ($cards as $c) {
            if (! $c['in_stock']) {
                continue;
            }
            $key = mb_strtolower(implode(' ', array_slice(preg_split('/\s+/', $c['name']), 0, 3)));
            if (isset($fam[$key])) {
                continue;
            }
            $fam[$key] = true;
            $out[] = $c;
            if (count($out) >= $count) {
                break;
            }
        }

        return response()->json(['data' => $out]);
    }

    /** GET /cro/hero/analytics?range=30 — kulakçık gösterimi, açılma (kaynak), ürün tıklama/sepet, atıf. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('hero_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $openSessions = (int) (clone $ev)->where('type', 'open')->distinct()->count('session_id');
        $opens = (int) (clone $ev)->where('type', 'open')->count();
        $clickSessions = (int) (clone $ev)->whereIn('type', ['click', 'atc'])->distinct()->count('session_id');
        $clicks = (int) (clone $ev)->where('type', 'click')->count();
        $atc = (int) (clone $ev)->where('type', 'atc')->count();
        $coupons = (int) (clone $ev)->where('type', 'coupon')->count();
        $closes = (int) (clone $ev)->where('type', 'close')->count();
        $conv = (clone $ev)->where('type', 'conversion')->selectRaw('count(*) c, coalesce(sum(value_num),0) rev')->first();
        $bySource = (clone $ev)->where('type', 'open')->selectRaw('coalesce(source,\'tab\') source, count(*) c, count(distinct session_id) s')->groupBy('source')->orderByDesc('c')->get();
        // Kaynağa göre etkileşim: açılma kaynağı → aynı oturumda tık/sepet var mı
        $srcEng = DB::select("
            select coalesce(o.source,'tab') source, count(distinct o.session_id) opened,
                   count(distinct case when e.session_id is not null then o.session_id end) engaged
            from hero_events o
            left join hero_events e on e.tenant_id = o.tenant_id and e.session_id = o.session_id and e.type in ('click','atc') and e.created_at >= o.created_at and e.is_test = false
            where o.tenant_id = ? and o.type = 'open' and o.is_test = false and o.created_at >= ?
            group by 1 order by 2 desc", [$tenant->id, $since]);
        $byProduct = DB::select("
            select e.product_id, p.name, p.url,
                   count(*) filter (where e.type='click') clicks,
                   count(*) filter (where e.type='atc') atc,
                   count(*) filter (where e.type='conversion') conv,
                   coalesce(sum(e.value_num) filter (where e.type='conversion'),0) rev
            from hero_events e left join products p on p.id = e.product_id
            where e.tenant_id = ? and e.is_test = false and e.created_at >= ? and e.product_id is not null
            group by 1,2,3 order by clicks desc, atc desc limit 30", [$tenant->id, $since]);
        $bySet = (clone $ev)->whereIn('type', ['view', 'open', 'click', 'atc', 'conversion'])
            ->selectRaw("set_id, count(distinct session_id) filter (where type='view') views, count(*) filter (where type='open') opens, count(*) filter (where type='click') clicks, count(*) filter (where type='atc') atc, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('set_id')->orderByDesc('views')->limit(30)->get();
        $byDevice = (clone $ev)->whereIn('type', ['view', 'open', 'click', 'atc'])->selectRaw("device, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type in ('click','atc')) acts")->groupBy('device')->get();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type='open') opens, count(*) filter (where type in ('click','atc')) acts, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('d')->orderBy('d')->get();
        $hourly = (clone $ev)->where('type', 'open')->selectRaw("extract(hour from created_at + interval '3 hours')::int h, count(*) c")->groupBy('h')->orderBy('h')->get();
        $errors = (clone $ev)->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'open_sessions' => $openSessions,
            'opens' => $opens,
            'open_rate' => $sessions > 0 ? round($openSessions / $sessions * 100, 1) : 0,
            'clicks' => $clicks,
            'atc' => $atc,
            'coupons' => $coupons,
            'closes' => $closes,
            'click_sessions' => $clickSessions,
            'engagement_rate' => $openSessions > 0 ? round($clickSessions / $openSessions * 100, 1) : 0,
            'conversions' => (int) ($conv->c ?? 0),
            'revenue' => round((float) ($conv->rev ?? 0), 2),
            'by_source' => $bySource,
            'source_engagement' => $srcEng,
            'by_product' => $byProduct,
            'by_set' => $bySet,
            'by_device' => $byDevice,
            'daily' => $daily,
            'hourly' => $hourly,
            'errors' => $errors,
        ]);
    }
}
