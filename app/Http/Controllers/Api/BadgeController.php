<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Badge\BadgeBuilder;
use App\Services\Badge\TenantBadgeSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Ürün Rozetleri paneli (CRO): ayarlar, rozet tipleri, harita durumu + örnek ürünler, analitik. */
class BadgeController extends Controller
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
        $s = TenantBadgeSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $map = BadgeBuilder::cached($tenant->id);
        $catIds = array_column(array_column(array_filter($s['types'], fn ($t) => $t['kind'] === 'category'), 'params'), 'category_id');
        $cats = $catIds ? DB::table('platform_categories')->where('tenant_id', $tenant->id)->whereIn('platform_category_id', array_map('strval', $catIds))
            ->pluck('path', 'platform_category_id') : collect();

        return $s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'kinds' => TenantBadgeSettings::KINDS,
            'icons' => TenantBadgeSettings::ICONS,
            'designs' => TenantBadgeSettings::DESIGNS,
            'category_names' => $cats,
            'defaults' => ['theme' => TenantBadgeSettings::DEFAULT_THEME, 'rules' => TenantBadgeSettings::DEFAULT_RULES, 'types' => TenantBadgeSettings::DEFAULT_TYPES],
            'build' => $map ? [
                'built_at' => $map['built_at'],
                'duration_ms' => $map['duration_ms'] ?? null,
                'counts' => $map['counts'] ?? [],
                'badged' => $map['badged'] ?? 0,
                'proof' => $map['proof'] ?? 0,
                'notes' => $map['notes'] ?? [],
                'samples' => (new BadgeBuilder)->samples($tenant->id, $map, 6),
            ] : null,
        ];
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
            'theme.style' => 'sometimes|string|in:'.implode(',', TenantBadgeSettings::STYLES),
            'theme.shape' => 'sometimes|string|in:'.implode(',', TenantBadgeSettings::SHAPES),
            'theme.size' => 'sometimes|string|in:s,m,l',
            'theme.uppercase' => 'sometimes|boolean',
            'theme.list_position' => 'sometimes|string|in:'.implode(',', TenantBadgeSettings::POSITIONS),
            'theme.list_direction' => 'sometimes|string|in:column,row',
            'theme.list_offset' => 'sometimes|integer|between:0,24',
            'theme.shadow' => 'sometimes|boolean',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'theme.proof_style' => 'sometimes|string|in:card,plain',
            'theme.proof_accent' => $hex,
            'rules' => 'sometimes|array',
            'rules.list_enabled' => 'sometimes|boolean',
            'rules.pdp_enabled' => 'sometimes|boolean',
            'rules.list_max' => 'sometimes|integer|between:1,4',
            'rules.pdp_max' => 'sometimes|integer|between:1,8',
            'rules.exclusive' => 'sometimes|array|max:10',
            'rules.exclusive.*' => 'string|max:40',
            'rules.new_skip_category' => 'sometimes|boolean',
            'rules.hide_out_of_stock' => 'sometimes|boolean',
            'rules.proof_enabled' => 'sometimes|boolean',
            'rules.proof_sold_24h' => 'sometimes|boolean',
            'rules.proof_sold_24h_min' => 'sometimes|integer|between:1,1000',
            'rules.proof_sold_24h_text' => 'sometimes|string|max:80',
            'rules.proof_sold_7d' => 'sometimes|boolean',
            'rules.proof_sold_7d_min' => 'sometimes|integer|between:1,10000',
            'rules.proof_sold_7d_text' => 'sometimes|string|max:80',
            'rules.proof_views' => 'sometimes|boolean',
            'rules.proof_views_min' => 'sometimes|integer|between:1,1000000',
            'rules.proof_views_text' => 'sometimes|string|max:80',
            'rules.proof_round' => 'sometimes|boolean',
            'rules.proof_max_lines' => 'sometimes|integer|between:1,6',
            'rules.proof_sold_30d' => 'sometimes|boolean',
            'rules.proof_sold_30d_min' => 'sometimes|integer|between:1,100000',
            'rules.proof_sold_30d_text' => 'sometimes|string|max:80',
            'rules.proof_rank' => 'sometimes|boolean',
            'rules.proof_rank_max' => 'sometimes|integer|between:1,10',
            'rules.proof_rank_min_qty' => 'sometimes|integer|between:1,10000',
            'rules.proof_rank_text' => 'sometimes|string|max:80',
            'rules.proof_cart' => 'sometimes|boolean',
            'rules.proof_cart_min' => 'sometimes|integer|between:1,1000',
            'rules.proof_cart_hours' => 'sometimes|integer|between:1,72',
            'rules.proof_cart_text' => 'sometimes|string|max:80',
            'rules.proof_fav' => 'sometimes|boolean',
            'rules.proof_fav_min' => 'sometimes|integer|between:1,1000000',
            'rules.proof_fav_text' => 'sometimes|string|max:80',
            'rules.proof_atc' => 'sometimes|boolean',
            'rules.proof_atc_min' => 'sometimes|integer|between:1,1000000',
            'rules.proof_atc_text' => 'sometimes|string|max:80',
            'rules.proof_sizes' => 'sometimes|boolean',
            'rules.proof_sizes_max_stock' => 'sometimes|integer|between:1,20',
            'rules.proof_sizes_text' => 'sometimes|string|max:80',
            'rules.list_card_selector' => 'sometimes|nullable|string|max:300',
            'rules.list_id_selector' => 'sometimes|nullable|string|max:300',
            'rules.list_image_selector' => 'sometimes|nullable|string|max:300',
            'rules.bar_list_mount' => 'sometimes|nullable|string|max:300',
            'rules.bar_pdp_mount' => 'sometimes|nullable|string|max:300',
            'rules.pdp_badge_mount' => 'sometimes|nullable|string|max:300',
            'rules.pdp_proof_mount' => 'sometimes|nullable|string|max:300',
            'rules.hide_paths' => 'sometimes|nullable|string|max:400',
            'rules.pdp_badge_position' => 'sometimes|string|in:image,price,title',
            'rules.pdp_image_mount' => 'sometimes|nullable|string|max:300',
            'rules.pdp_price_mount' => 'sometimes|nullable|string|max:300',
            'types' => 'sometimes|array|max:'.TenantBadgeSettings::MAX_TYPES,
            'types.*.id' => 'nullable|string|max:40',
            'types.*.kind' => 'required_with:types|string|in:'.implode(',', TenantBadgeSettings::KINDS),
            'types.*.label' => 'required_with:types|string|max:40',
            'types.*.color' => 'required_with:types|string|regex:/^#[0-9a-fA-F]{6}$/',
            'types.*.icon' => 'nullable|string|in:'.implode(',', TenantBadgeSettings::ICONS),
            'types.*.enabled' => 'boolean',
            'types.*.list' => 'boolean',
            'types.*.pdp' => 'boolean',
            'types.*.params' => 'nullable|array',
            'types.*.corner' => 'nullable|string|in:,'.implode(',', TenantBadgeSettings::POSITIONS),
            'types.*.design' => 'nullable|string|in:'.implode(',', TenantBadgeSettings::DESIGNS),
            'rebuild' => 'sometimes|boolean',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantBadgeSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['badge_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['badge_domains'] = implode(',', $parts);
        }
        if (array_key_exists('theme', $data)) {
            $s['badge_theme'] = json_encode(array_merge($cur['theme'], $data['theme']));
        }
        if (array_key_exists('rules', $data)) {
            $s['badge_rules'] = json_encode(array_merge($cur['rules'], $data['rules']));
        }
        if (array_key_exists('types', $data)) {
            $s['badge_types'] = json_encode(TenantBadgeSettings::sanitizeTypes($data['types']));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantBadgeSettings::forget($tenant->id);

        // Rozet seçimini etkileyen değişikliklerde haritayı hemen yeniden üret
        $affects = array_key_exists('types', $data) || ! empty($data['rebuild']) || (array_key_exists('enabled', $data) && $data['enabled'] && ! BadgeBuilder::cached($tenant->id))
            || (isset($data['rules']) && array_intersect_key($data['rules'], array_flip(['exclusive', 'new_skip_category', 'hide_out_of_stock', 'proof_enabled', 'proof_sold_24h', 'proof_sold_24h_min', 'proof_sold_7d', 'proof_sold_7d_min', 'proof_views', 'proof_views_min', 'proof_sizes', 'proof_sizes_max_stock', 'proof_sold_30d', 'proof_sold_30d_min', 'proof_rank', 'proof_rank_max', 'proof_rank_min_qty', 'proof_fav', 'proof_fav_min', 'proof_atc', 'proof_atc_min', 'proof_cart', 'proof_cart_min', 'proof_cart_hours'])));
        $error = null;
        if ($affects) {
            try {
                if ((int) ini_get('memory_limit') > 0 && (int) ini_get('memory_limit') < 1024) {
                    ini_set('memory_limit', '1024M'); // canlı kategori çekimi büyük (bkz. BuildBadges)
                }
                (new BadgeBuilder)->build($tenant->fresh());
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        return response()->json(['ok' => true, 'build_error' => $error] + $this->payload($tenant->fresh()));
    }

    /** GET /cro/badges/categories?q= — kampanya rozeti için kategori arama (ad/yol). */
    public function categories(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $q = trim((string) $request->query('q', ''));
        $rows = DB::table('platform_categories')->where('tenant_id', $tenant->id)
            ->when($q !== '', fn ($w) => is_numeric($q)
                ? $w->where('platform_category_id', $q)
                : $w->where(fn ($x) => $x->where('name', 'ilike', "%{$q}%")->orWhere('path', 'ilike', "%{$q}%")))
            ->orderByDesc('product_count')->limit(20)
            ->get(['platform_category_id as id', 'name', 'path', 'product_count', 'is_active']);

        return response()->json(['items' => $rows]);
    }

    /** GET /cro/badges/analytics?range=30 — rozet başına liste tıklama oranı (rozetsiz kartlarla kıyas) + ürün detay görüntülemeleri. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $base = fn () => DB::table('badge_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $tot = $base()->where('type', 'list_view')->selectRaw("count(*) pages, count(distinct session_id) sessions, coalesce(sum((counts->>'total')::int),0) total, coalesce(sum((counts->>'badged')::int),0) badged")->first();
        $impr = DB::table('badge_events as e')->crossJoin(DB::raw("jsonb_each_text(e.counts->'by') as kv"))
            ->where('e.tenant_id', $tenant->id)->where('e.is_test', false)->where('e.created_at', '>=', $since)->where('e.type', 'list_view')
            ->groupBy('kv.key')->selectRaw('kv.key k, sum(kv.value::int) n')->pluck('n', 'k');
        $clicks = $base()->where('type', 'click')->selectRaw("coalesce(badge,'') b, count(*) c")->groupBy('b')->pluck('c', 'b');
        $pdp = $base()->where('type', 'pdp_view')->selectRaw("coalesce(badge,'') b, count(*) c")->groupBy('b')->pluck('c', 'b');

        $unbadgedImpr = max(0, (int) $tot->total - (int) $tot->badged);
        $rows = [];
        foreach (TenantBadgeSettings::get($tenant->id)['types'] as $t) {
            $i = (int) ($impr[$t['id']] ?? 0);
            $c = (int) ($clicks[$t['id']] ?? 0);
            $rows[] = ['id' => $t['id'], 'label' => $t['label'], 'color' => $t['color'], 'impressions' => $i, 'clicks' => $c,
                'ctr' => $i > 0 ? round($c / $i * 100, 2) : null, 'pdp_views' => (int) ($pdp[$t['id']] ?? 0)];
        }
        $uc = (int) ($clicks[''] ?? 0);

        return response()->json([
            'range_days' => $days,
            'pages' => (int) $tot->pages,
            'sessions' => (int) $tot->sessions,
            'cards' => (int) $tot->total,
            'badged_cards' => (int) $tot->badged,
            'baseline' => ['impressions' => $unbadgedImpr, 'clicks' => $uc, 'ctr' => $unbadgedImpr > 0 ? round($uc / $unbadgedImpr * 100, 2) : null],
            'types' => $rows,
            'pdp_total' => array_sum($pdp->all()),
            'daily' => $base()->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(*) filter (where type='click' and badge is not null) bc, count(*) filter (where type='click' and badge is null) uc, count(*) filter (where type='pdp_view') pv")
                ->groupBy('d')->orderBy('d')->get(),
        ]);
    }
}
