<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Flash\TenantFlashSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** "Flaş İndirim" ana sayfa vitrini paneli (CRO): ayarlar, setler, ürün arama, akıllı öneri, analitik. */
class FlashController extends Controller
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
        $s = TenantFlashSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
        $today = now('Europe/Istanbul')->format('Y-m-d');
        $active = TenantFlashSettings::activeSet($s['sets'], $today);
        $allIds = [];
        foreach ($s['sets'] as $st) {
            $allIds = array_merge($allIds, $st['products']);
        }
        $byId = [];
        foreach (PublicFlashController::products($tenant->id, array_values(array_unique($allIds)), $shop) as $c) {
            $byId[$c['id']] = $c;
        }
        // Stoksuz/görselsiz olanlar da panelde görünsün (işaretli)
        foreach (PublicHeroController::resolveProducts($tenant->id, array_values(array_diff(array_unique($allIds), array_keys($byId))), $shop) as $c) {
            $c['sold14'] = 0;
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
            'presets' => TenantFlashSettings::PRESETS,
            'layouts' => TenantFlashSettings::LAYOUTS,
            'timer_modes' => TenantFlashSettings::TIMER_MODES,
            'mount_modes' => TenantFlashSettings::MOUNT_MODES,
            'max_products' => TenantFlashSettings::MAX_PRODUCTS,
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
            'theme.preset' => 'sometimes|string|in:'.implode(',', TenantFlashSettings::PRESETS),
            'theme.layout' => 'sometimes|string|in:'.implode(',', TenantFlashSettings::LAYOUTS),
            'theme.accent' => $hex, 'theme.accent2' => $hex, 'theme.bg' => $hex, 'theme.ink' => $hex, 'theme.card_bg' => $hex,
            'theme.radius' => 'sometimes|integer|between:0,32',
            'theme.rain' => 'sometimes|boolean',
            'theme.dark_cards' => 'sometimes|boolean',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'theme.container_width' => 'sometimes|integer|between:0,1800',
            'theme.width' => 'sometimes|string|in:container,full',
            'rules' => 'sometimes|array',
            'rules.eyebrow' => 'sometimes|nullable|string|max:30',
            'rules.title' => 'sometimes|nullable|string|max:60',
            'rules.subtitle' => 'sometimes|nullable|string|max:140',
            'rules.timer_mode' => 'sometimes|string|in:'.implode(',', TenantFlashSettings::TIMER_MODES),
            'rules.timer_label' => 'sometimes|nullable|string|max:40',
            'rules.pages' => 'sometimes|array',
            'rules.pages.*' => 'string|in:home,category,product,other',
            'rules.mount' => 'sometimes|nullable|string|max:200',
            'rules.mount_mode' => 'sometimes|string|in:'.implode(',', TenantFlashSettings::MOUNT_MODES),
            'rules.mount_fallback' => 'sometimes|nullable|string|max:200',
            'rules.max_products' => 'sometimes|integer|between:2,'.TenantFlashSettings::MAX_PRODUCTS,
            'rules.rows' => 'sometimes|integer|between:1,3',
            'rules.rotate_hours' => 'sometimes|integer|between:0,168',
            'rules.rotate_step' => 'sometimes|integer|between:1,12',
            'rules.rotate_mode' => 'sometimes|string|in:time,visitor',
            'rules.quick_add' => 'sometimes|boolean',
            'rules.show_sold' => 'sometimes|boolean',
            'rules.sold_threshold' => 'sometimes|integer|between:1,1000',
            'rules.show_stock' => 'sometimes|boolean',
            'rules.stock_threshold' => 'sometimes|integer|between:1,50',
            'rules.min_sizes' => 'sometimes|integer|between:1,20',
            'rules.show_bar' => 'sometimes|boolean',
            'rules.show_segment' => 'sometimes|boolean',
            'rules.cta_text' => 'sometimes|nullable|string|max:24',
            'rules.view_text' => 'sometimes|nullable|string|max:24',
            'rules.footer_text' => 'sometimes|nullable|string|max:40',
            'rules.footer_url' => 'sometimes|nullable|string|max:200',
            'rules.coupon_label' => 'sometimes|nullable|string|max:30',
            'rules.hover_swap' => 'sometimes|boolean',
            'rules.min_width' => 'sometimes|integer|between:0,1400',
            'rules.max_width' => 'sometimes|integer|between:0,1400',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'sets' => 'sometimes|nullable|array|max:60',
            'sets.*.id' => 'sometimes|nullable|string|max:24',
            'sets.*.title' => 'sometimes|nullable|string|max:60',
            'sets.*.subtitle' => 'sometimes|nullable|string|max:140',
            'sets.*.eyebrow' => 'sometimes|nullable|string|max:30',
            'sets.*.start_date' => 'sometimes|nullable|date_format:Y-m-d',
            'sets.*.end_date' => 'sometimes|nullable|date_format:Y-m-d',
            'sets.*.products' => 'sometimes|array|max:'.TenantFlashSettings::MAX_PRODUCTS,
            'sets.*.products.*' => 'integer',
            'sets.*.coupon' => 'sometimes|nullable|string|max:32',
            'sets.*.coupon_mode' => 'sometimes|string|in:none,code,auto',
            'sets.*.coupon_pct' => 'sometimes|integer|between:0,90',
            'sets.*.coupon_text' => 'sometimes|nullable|string|max:100',
            'sets.*.enabled' => 'sometimes|boolean',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantFlashSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['flash_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['flash_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['flash_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['flash_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('sets', $data)) {
            $ids = [];
            foreach ((array) $data['sets'] as $st) {
                $ids = array_merge($ids, array_map('intval', (array) ($st['products'] ?? [])));
            }
            $own = $ids ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('id', array_unique($ids))->pluck('id')->map(fn ($i) => (int) $i)->all() : [];
            $sets = array_map(function ($st) use ($own) {
                $st['products'] = array_values(array_filter(array_map('intval', (array) ($st['products'] ?? [])), fn ($i) => in_array($i, $own, true)));

                return $st;
            }, (array) $data['sets']);
            $s['flash_sets'] = json_encode(TenantFlashSettings::sanitizeSets($sets));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantFlashSettings::forget($tenant->id);
        Cache::forget('flash:config:'.$tenant->id.':'.now('Europe/Istanbul')->format('Y-m-d').':0');
        $rh = max(0, (int) (TenantFlashSettings::get($tenant->id)['rules']['rotate_hours'] ?? 0));
        if ($rh > 0) {
            Cache::forget('flash:config:'.$tenant->id.':'.now('Europe/Istanbul')->format('Y-m-d').':'.intdiv((int) floor(now('Europe/Istanbul')->getTimestamp() / 3600), $rh));
        }

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /** GET /cro/flash/products?q=&ids=&limit=&discounted=1 — panel ürün seçici. */
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
                        ->orWhere('category_path', 'ILIKE', $like)->orWhere('platform_product_id', $q);
                });
            }
            if ($only) {
                $query->whereNotNull('discounted_price')->where('discounted_price', '>', 0)->whereColumn('discounted_price', '<', 'price');
            }
            $query->orderByDesc('platform_updated_at');
        }
        $found = $query->limit($limit)->pluck('id')->map(fn ($i) => (int) $i)->all();
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');
        $cards = PublicFlashController::products($tenant->id, $found, $shop);
        $have = array_map(fn ($c) => $c['id'], $cards);
        foreach (PublicHeroController::resolveProducts($tenant->id, array_values(array_diff($found, $have)), $shop) as $c) {
            $c['sold14'] = 0;
            $cards[] = $c;
        }

        return response()->json(['data' => $cards]);
    }

    /**
     * GET /cro/flash/suggest?count=8&q=bot&segments=kadin,erkek,cocuk&days=14
     * Akıllı öneri: stoklu + görselli + indirimli (≥%15) ürünler; puan = 0.45 satış ivmesi (14g ödenmiş) +
     * 0.20 tıklanma (arama/menü/rozet olayları 30g) + 0.20 indirim derinliği + 0.15 puan. Segment başına eşit dağıtım,
     * aynı model ailesinden (SKU model kodu) tek ürün. Anahtar kelime (örn. "bot") ad/kategoriyi süzer.
     */
    public function suggest(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $count = max(1, min(TenantFlashSettings::MAX_PRODUCTS, (int) $request->query('count', 8)));
        $q = trim((string) $request->query('q', ''));
        $days = max(3, min(60, (int) $request->query('days', 14)));
        $segs = array_values(array_filter(array_map('trim', explode(',', (string) $request->query('segments', '')))));
        $segs = array_values(array_intersect($segs, ['kadin', 'erkek', 'cocuk']));
        $like = $q !== '' ? '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%' : null;
        $rows = DB::select("
            with sales as (
                select oi.product_id, sum(oi.quantity) q
                from order_items oi join orders o on o.id = oi.order_id
                where o.tenant_id = ? and o.order_date > now() - make_interval(days => ?) and coalesce(o.paid_amount,0) > 0 and o.payment_status = 1 and o.status <> 8
                group by oi.product_id
            ),
            clicks as (
                select product_id, count(*) c from (
                    select product_id from search_events where tenant_id = ? and product_id is not null and created_at > now() - interval '30 days'
                    union all select product_id from hero_events where tenant_id = ? and product_id is not null and type in ('click','atc') and created_at > now() - interval '30 days'
                    union all select product_id from foryou_events where tenant_id = ? and product_id is not null and type in ('click','atc') and created_at > now() - interval '30 days'
                ) x group by product_id
            )
            select p.id, p.name, p.category_path, p.sku, coalesce(s.q,0) q, coalesce(c.c,0) clicks,
                   round((p.price - p.discounted_price) / nullif(p.price,0) * 100) disc,
                   coalesce(p.trendyol_rating, 0) rating
            from products p left join sales s on s.product_id = p.id left join clicks c on c.product_id = p.id
            where p.tenant_id = ? and p.is_active and p.stock_quantity > 2 and p.images is not null and p.images::text <> '[]'
              and p.discounted_price is not null and p.discounted_price > 0 and p.discounted_price < p.price
              and (p.price - p.discounted_price) / nullif(p.price,0) >= 0.15
              ".($like ? 'and (p.name ILIKE ? or p.category_path ILIKE ?)' : '')."
            order by coalesce(s.q,0) desc, disc desc
            limit 600", array_merge([$tenant->id, $days, $tenant->id, $tenant->id, $tenant->id, $tenant->id], $like ? [$like, $like] : []));
        if (! $rows) {
            return response()->json(['data' => [], 'reason' => 'no_discounted']);
        }
        $maxQ = max(1, max(array_map(fn ($r) => (int) $r->q, $rows)));
        $maxC = max(1, max(array_map(fn ($r) => (int) $r->clicks, $rows)));
        $scored = [];
        foreach ($rows as $r) {
            $seg = PublicHeroController::segment((string) $r->category_path, '', (string) $r->name);
            $segKey = ['Kadın' => 'kadin', 'Erkek' => 'erkek', 'Çocuk' => 'cocuk'][$seg] ?? 'diger';
            if ($segs && ! in_array($segKey, $segs, true)) {
                continue;
            }
            $score = 0.45 * ((int) $r->q / $maxQ) + 0.20 * ((int) $r->clicks / $maxC) + 0.20 * min(1, (float) $r->disc / 60) + 0.15 * ((float) $r->rating / 5);
            $model = explode('|', (string) $r->sku)[1] ?? mb_strtolower(implode(' ', array_slice(preg_split('/\s+/', (string) $r->name), 0, 3)));
            $scored[] = ['id' => (int) $r->id, 'score' => $score, 'seg' => $segKey, 'model' => $model ?: (string) $r->id, 'q' => (int) $r->q, 'clicks' => (int) $r->clicks];
        }
        usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);
        // Segment başına eşit pay (round-robin), model ailesi tekil
        $buckets = [];
        $fam = [];
        foreach ($scored as $x) {
            if (isset($fam[$x['model']])) {
                continue;
            }
            $fam[$x['model']] = true;
            $buckets[$x['seg']][] = $x;
        }
        $order = $segs ?: array_keys($buckets);
        $picked = [];
        $i = 0;
        while (count($picked) < $count * 2 && $i < 50) {
            $any = false;
            foreach ($order as $sg) {
                if (! empty($buckets[$sg])) {
                    $picked[] = array_shift($buckets[$sg]);
                    $any = true;
                }
            }
            if (! $any) {
                break;
            }
            $i++;
        }
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');
        $cards = PublicFlashController::products($tenant->id, array_map(fn ($x) => $x['id'], $picked), $shop);
        $meta = [];
        foreach ($picked as $x) {
            $meta[$x['id']] = $x;
        }
        $out = [];
        foreach ($cards as $c) {
            $c['why'] = ['sold' => $meta[$c['id']]['q'] ?? 0, 'clicks' => $meta[$c['id']]['clicks'] ?? 0, 'score' => round(($meta[$c['id']]['score'] ?? 0) * 100), 'seg' => $meta[$c['id']]['seg'] ?? ''];
            $out[] = $c;
            if (count($out) >= $count) {
                break;
            }
        }

        return response()->json(['data' => $out, 'days' => $days]);
    }

    /** GET /cro/flash/analytics?range=30 */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $ev = DB::table('flash_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $sessions = (int) (clone $ev)->where('type', 'view')->distinct()->count('session_id');
        $clickSessions = (int) (clone $ev)->whereIn('type', ['click', 'atc'])->distinct()->count('session_id');
        $clicks = (int) (clone $ev)->where('type', 'click')->count();
        $atc = (int) (clone $ev)->where('type', 'atc')->count();
        $coupons = (int) (clone $ev)->where('type', 'coupon')->count();
        $tabs = (int) (clone $ev)->where('type', 'tab')->count();
        $ctas = (int) (clone $ev)->where('type', 'cta')->count();
        $conv = (clone $ev)->where('type', 'conversion')->selectRaw('count(*) c, coalesce(sum(value_num),0) rev')->first();
        $byProduct = DB::select("
            select e.product_id, p.name, p.url,
                   count(*) filter (where e.type='click') clicks,
                   count(*) filter (where e.type='atc') atc,
                   count(*) filter (where e.type='conversion') conv,
                   coalesce(sum(e.value_num) filter (where e.type='conversion'),0) rev
            from flash_events e left join products p on p.id = e.product_id
            where e.tenant_id = ? and e.is_test = false and e.created_at >= ? and e.product_id is not null
            group by 1,2,3 order by clicks desc, atc desc limit 30", [$tenant->id, $since]);
        $byLayout = (clone $ev)->whereIn('type', ['view', 'click', 'atc', 'conversion'])
            ->selectRaw("layout, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type in ('click','atc')) acts, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('layout')->orderByDesc('views')->get();
        $bySet = (clone $ev)->whereIn('type', ['view', 'click', 'atc', 'conversion'])
            ->selectRaw("set_id, count(distinct session_id) filter (where type='view') views, count(*) filter (where type='click') clicks, count(*) filter (where type='atc') atc, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('set_id')->orderByDesc('views')->limit(30)->get();
        $byDevice = (clone $ev)->whereIn('type', ['view', 'click', 'atc'])
            ->selectRaw("device, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type in ('click','atc')) acts")
            ->groupBy('device')->get();
        $daily = (clone $ev)->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(distinct session_id) filter (where type='view') views, count(distinct session_id) filter (where type in ('click','atc')) acts, count(*) filter (where type='conversion') conv, coalesce(sum(value_num) filter (where type='conversion'),0) rev")
            ->groupBy('d')->orderBy('d')->get();
        $errors = (clone $ev)->where('type', 'error')->selectRaw('value, count(*) c')->groupBy('value')->orderByDesc('c')->limit(5)->get();

        return response()->json([
            'range_days' => $days,
            'sessions' => $sessions,
            'clicks' => $clicks,
            'atc' => $atc,
            'coupons' => $coupons,
            'tabs' => $tabs,
            'ctas' => $ctas,
            'click_sessions' => $clickSessions,
            'engagement_rate' => $sessions > 0 ? round($clickSessions / $sessions * 100, 1) : 0,
            'conversions' => (int) ($conv->c ?? 0),
            'revenue' => round((float) ($conv->rev ?? 0), 2),
            'by_product' => $byProduct,
            'by_layout' => $byLayout,
            'by_set' => $bySet,
            'by_device' => $byDevice,
            'daily' => $daily,
            'errors' => $errors,
        ]);
    }
}
