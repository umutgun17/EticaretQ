<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\NotFound\TenantNotFoundSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** 404 Sayfası paneli (CRO): şablon seçimi, içerik, ürün kaynağı, analitik (kırık adresler dahil). */
class NotFoundController extends Controller
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
        $s = TenantNotFoundSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $ids = $s['content']['product_ids'];

        return $s + [
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['shop_url'] ?? ''), '/'),
            'templates' => TenantNotFoundSettings::TEMPLATES,
            'manual_products' => $ids ? PublicNotFoundController::cards($tenant->id, $ids, rtrim((string) ($ts['shop_url'] ?? ''), '/')) : [],
            'defaults' => ['content' => TenantNotFoundSettings::DEFAULT_CONTENT, 'rules' => TenantNotFoundSettings::DEFAULT_RULES],
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
            'template' => 'sometimes|string|in:'.implode(',', TenantNotFoundSettings::TEMPLATES),
            'content' => 'sometimes|array',
            'content.title' => 'sometimes|nullable|string|max:80',
            'content.subtitle' => 'sometimes|nullable|string|max:200',
            'content.show_search' => 'sometimes|boolean',
            'content.show_matched' => 'sometimes|boolean',
            'content.matched_title' => 'sometimes|nullable|string|max:60',
            'content.show_products' => 'sometimes|boolean',
            'content.products_title' => 'sometimes|nullable|string|max:60',
            'content.products_source' => 'sometimes|string|in:'.implode(',', TenantNotFoundSettings::SOURCES),
            'content.products_days' => 'sometimes|integer|between:1,90',
            'content.product_count' => 'sometimes|integer|between:2,16',
            'content.product_ids' => 'sometimes|array|max:'.TenantNotFoundSettings::MAX_MANUAL,
            'content.product_ids.*' => 'integer',
            'content.show_categories' => 'sometimes|boolean',
            'content.categories' => 'sometimes|array|max:10',
            'content.categories.*.name' => 'required_with:content.categories|string|max:40',
            'content.categories.*.url' => 'required_with:content.categories|string|max:300',
            'content.home_text' => 'sometimes|nullable|string|max:40',
            'content.coupon_code' => 'sometimes|nullable|string|max:40',
            'content.coupon_text' => 'sometimes|nullable|string|max:120',
            'content.accent' => 'sometimes|nullable|string|max:7',
            'rules' => 'sometimes|array',
            'rules.display' => 'sometimes|string|in:auto,overlay,inline',
            'rules.mount_selector' => 'sometimes|nullable|string|max:300',
            'rules.hide_selectors' => 'sometimes|nullable|string|max:300',
            'rules.search_url' => 'sometimes|nullable|string|max:200',
            'rules.detect_paths' => 'sometimes|nullable|string|max:300',
            'rules.detect_selectors' => 'sometimes|nullable|string|max:300',
        ]);

        $s = $tenant->settings ?? [];
        $cur = TenantNotFoundSettings::get($tenant->id);
        if (array_key_exists('enabled', $data)) {
            $s['notfound_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['notfound_domains'] = implode(',', $parts);
        }
        if (array_key_exists('template', $data)) {
            $s['notfound_template'] = $data['template'];
        }
        if (array_key_exists('content', $data)) {
            $content = array_map(fn ($v) => $v ?? '', $data['content']);
            $s['notfound_content'] = json_encode(TenantNotFoundSettings::sanitizeContent(array_merge($cur['content'], $content)));
        }
        if (array_key_exists('rules', $data)) {
            $s['notfound_rules'] = json_encode(array_merge($cur['rules'], array_map(fn ($v) => (string) ($v ?? ''), $data['rules'])));
        }
        $tenant->settings = $s;
        $tenant->save();
        TenantNotFoundSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->payload($tenant->fresh()));
    }

    /** GET /cro/notfound/products?q= — elle seçim için ürün arama (ad / stok kodu). */
    public function products(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $q = trim((string) $request->query('q', ''));
        $ids = DB::table('products')->where('tenant_id', $tenant->id)->where('is_active', true)->where('stock_quantity', '>', 0)
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('name', 'ilike', "%{$q}%")->orWhere('sku', 'ilike', "%{$q}%")))
            ->orderByDesc('performance_score')->limit(20)->pluck('id')->all();
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');

        return response()->json(['items' => PublicNotFoundController::cards($tenant->id, $ids, $shop)]);
    }

    /** GET /cro/notfound/analytics?range=30 — 404 görüntülenme, kurtarılan oturum, tıklama kırılımı, en çok kırılan adresler. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(365, (int) $request->query('range', 30)));
        $since = now()->subDays($days);
        $base = fn () => DB::table('notfound_events')->where('tenant_id', $tenant->id)->where('is_test', false)->where('created_at', '>=', $since);

        $views = $base()->where('type', 'view')->selectRaw('count(*) n, count(distinct session_id) s, count(*) filter (where matched > 0) m')->first();
        // Kurtarılan oturum = 404'ü gören ve bir ürüne/kategoriye tıklayan ya da arama yapan oturum
        $saved = (int) $base()->where(fn ($w) => $w->where('type', 'search')->orWhere(fn ($x) => $x->where('type', 'click')->whereIn('target', ['matched', 'product', 'category'])))
            ->distinct()->count('session_id');
        $clicks = $base()->where('type', 'click')->selectRaw("coalesce(target,'') t, count(*) c")->groupBy('t')->pluck('c', 't');
        $other = $base()->whereIn('type', ['search', 'game', 'coupon'])->selectRaw('type, count(*) c')->groupBy('type')->pluck('c', 'type');
        // Tıklama → aynı oturumda ödenmiş sipariş atfı yok (Ticimax oturumu bilinmez); ürün tıklamaları listelenir
        $topProducts = $base()->where('type', 'click')->whereIn('target', ['matched', 'product'])->whereNotNull('product_id')
            ->selectRaw('product_id, count(*) c')->groupBy('product_id')->orderByDesc('c')->limit(10)->pluck('c', 'product_id');
        $names = $topProducts->isNotEmpty() ? DB::table('products')->where('tenant_id', $tenant->id)->whereIn('id', $topProducts->keys()->map(fn ($v) => (int) $v)->all())->pluck('name', 'id') : collect();

        return response()->json([
            'range_days' => $days,
            'views' => (int) $views->n,
            'sessions' => (int) $views->s,
            'views_matched' => (int) $views->m,
            'saved_sessions' => $saved,
            'saved_rate' => $views->s > 0 ? round($saved / $views->s * 100, 1) : null,
            'clicks' => $clicks,
            'searches' => (int) ($other['search'] ?? 0),
            'games' => (int) ($other['game'] ?? 0),
            'coupons' => (int) ($other['coupon'] ?? 0),
            'by_template' => $base()->where('type', 'view')->selectRaw("coalesce(template,'') t, count(*) v")->groupBy('t')->pluck('v', 't'),
            'broken' => $base()->where('type', 'view')->whereNotNull('page_path')
                ->selectRaw("page_path p, count(*) c, max(created_at) last, max(referrer) ref")->groupBy('page_path')->orderByDesc('c')->limit(25)->get(),
            'top_products' => $topProducts->map(fn ($c, $id) => ['id' => (int) $id, 'name' => $names[(int) $id] ?? ('#'.$id), 'clicks' => (int) $c])->values(),
            'daily' => $base()->selectRaw("to_char(created_at + interval '3 hours', 'YYYY-MM-DD') d, count(*) filter (where type='view') v, count(*) filter (where type='click') c")
                ->groupBy('d')->orderBy('d')->get(),
        ]);
    }
}
