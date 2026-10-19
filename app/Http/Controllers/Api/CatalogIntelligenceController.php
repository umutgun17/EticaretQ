<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CategorySuggestion;
use App\Models\PlatformCategory;
use App\Models\Tenant;
use App\Services\Catalog\CategoryApplier;
use App\Services\Ranking\CategoryRanker;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Kategori Zekası PANELİ (auth + permission:marketing).
 * Kategori Denetçisi önerileri (onay/red/uygula), ağaç sağlık raporu ve
 * Akıllı Kategori Sıralaması önizlemesi (sinyal dökümüyle — "neye göre" şeffaf).
 */
class CatalogIntelligenceController extends Controller
{
    protected function tenantId(): ?int
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return (int) $user->tenant_id;
        }

        return request()->header('X-Tenant-Id') ? (int) request()->header('X-Tenant-Id') : null;
    }

    protected function tenantOrFail(): Tenant
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        return Tenant::findOrFail($tid);
    }

    protected ?string $shopUrlCache = null;

    /** DB'deki ürün url'leri relative — mağaza adresiyle mutlaklaştır (SearchController ile aynı kural). */
    protected function absUrl(?string $url, int $tid): ?string
    {
        if (! $url || ! str_starts_with($url, '/')) {
            return $url;
        }
        $this->shopUrlCache ??= rtrim((string) ((Tenant::find($tid)?->settings ?? [])['shop_url'] ?? ''), '/');

        return $this->shopUrlCache !== '' ? $this->shopUrlCache . $url : $url;
    }

    /** Özet sayaçlar: katalog sağlığı + öneri kuyruğu + backlog ilerlemesi. */
    public function overview(): JsonResponse
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        $products = DB::table('products')->where('tenant_id', $tid);
        $active = (clone $products)->where('is_active', true)->count();
        $problem = (clone $products)->where('is_active', true)
            ->where(fn ($q) => $q->where('category', 'Kategorisiz')->orWhereNull('category_path')->orWhere('category_path', ''))
            ->count();

        $sugg = DB::table('category_suggestions')->where('tenant_id', $tid)
            ->selectRaw("status, tier, count(*) as c")->groupBy('status', 'tier')->get();

        $byStatus = [];
        foreach ($sugg as $r) {
            $byStatus[$r->status] = ($byStatus[$r->status] ?? 0) + $r->c;
            $byStatus["{$r->status}:{$r->tier}"] = $r->c;
        }

        $cats = DB::table('platform_categories')->where('tenant_id', $tid)->where('is_active', true);
        $orphans = DB::selectOne("
            select count(*) as c from products p
            where p.tenant_id = ? and p.is_active = true
              and not exists (
                  select 1 from product_platform_categories ppc
                  join platform_categories pc on pc.tenant_id = ppc.tenant_id
                   and pc.platform_category_id = ppc.platform_category_id
                  where ppc.tenant_id = p.tenant_id
                    and ppc.platform_product_id = cast(p.platform_product_id as integer)
                    and pc.is_assignable = true and pc.is_active = true
              )
        ", [$tid]);

        return response()->json([
            'products_total' => (clone $products)->count(),
            'products_active' => $active,
            'products_problem' => $problem,
            'products_orphan' => (int) ($orphans->c ?? 0),
            'categories_active' => (clone $cats)->count(),
            'categories_assignable' => (clone $cats)->where('is_assignable', true)->count(),
            'suggestions' => [
                'review_pending' => $byStatus['suggested:review'] ?? 0,
                'auto_pending' => $byStatus['suggested:auto'] ?? 0,
                'approved' => $byStatus['approved'] ?? 0,
                'applied' => ($byStatus['applied'] ?? 0) + ($byStatus['auto_applied'] ?? 0),
                'rejected' => $byStatus['rejected'] ?? 0,
                'failed' => $byStatus['failed'] ?? 0,
            ],
            'backlog_remaining' => max(0, $problem - DB::table('category_suggestions')->where('tenant_id', $tid)
                ->whereIn('status', ['suggested', 'approved'])->count()),
            'last_tree_sync' => DB::table('platform_categories')->where('tenant_id', $tid)->max('synced_at'),
        ]);
    }

    /** Öneri listesi (ürün görseli/adı + mevcut→önerilen path'ler + katman kaynakları). */
    public function suggestions(Request $request): JsonResponse
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        $status = $request->query('status', 'suggested');
        $tier = $request->query('tier');
        $perPage = max(5, min(200, (int) $request->query('per_page', 25)));

        $q = CategorySuggestion::query()
            ->where('tenant_id', $tid)
            ->with('product:id,name,images,url,category,category_path')
            ->orderByDesc('id');

        if ($status && $status !== 'all') {
            $status === 'applied'
                ? $q->whereIn('status', ['applied', 'auto_applied'])
                : $q->where('status', $status);
        }
        if ($tier) {
            $q->where('tier', $tier);
        }
        if ($request->query('action')) {
            $q->where('action', $request->query('action'));
        }

        $page = $q->paginate($perPage);

        // Kategori path sözlüğü (id → path) — önerilen id'leri okunur yap
        $catPaths = PlatformCategory::forTenant($tid)->pluck('path', 'platform_category_id');

        $items = collect($page->items())->map(function (CategorySuggestion $s) use ($catPaths) {
            $p = $s->product;

            return [
                'id' => $s->id,
                'action' => $s->action,
                'status' => $s->status,
                'tier' => $s->tier,
                'confidence' => (float) $s->confidence,
                'rationale' => $s->rationale,
                'error' => $s->error,
                'applied_at' => $s->applied_at?->toIso8601String(),
                'created_at' => $s->created_at?->toIso8601String(),
                'product' => $p ? [
                    'id' => $p->id,
                    'name' => $p->name,
                    'image' => is_array($p->images) ? (str_replace('/buyuk/', '/thumb/', $p->images[0] ?? '') ?: null) : null,
                    'url' => $this->absUrl($p->url, $s->tenant_id),
                ] : null,
                'current_path' => $s->current['path'] ?? null,
                'current_category' => $s->current['category'] ?? null,
                'suggested_primary_id' => $s->suggested_primary_id,
                'suggested_primary_path' => $s->suggested_primary_id ? ($catPaths[$s->suggested_primary_id] ?? (string) $s->suggested_primary_id) : null,
                'suggested_secondary_paths' => collect($s->suggested_category_ids ?? [])
                    ->map(fn ($id) => $catPaths[$id] ?? (string) $id)->values(),
                'new_category' => $s->new_category,
                'sources' => [
                    'agree' => $s->sources['agree'] ?? [],
                    'age_group' => $s->sources['age_group'] ?? null,
                    'family' => $s->sources['family'] ? [
                        'path' => $s->sources['family']['path'] ?? null,
                        'count' => $s->sources['family']['count'] ?? null,
                        'share' => $s->sources['family']['share'] ?? null,
                    ] : null,
                    'knn' => $s->sources['knn'] ? [
                        'path' => $s->sources['knn']['path'] ?? null,
                        'share' => $s->sources['knn']['share'] ?? null,
                    ] : null,
                    'llm_confidence' => $s->sources['llm']['confidence'] ?? null,
                ],
            ];
        });

        return response()->json([
            'items' => $items,
            'total' => $page->total(),
            'page' => $page->currentPage(),
            'per_page' => $perPage,
        ]);
    }

    /** Onayla (+isteğe bağlı anında uygula). */
    public function approve(Request $request, int $id): JsonResponse
    {
        $tid = $this->tenantId();
        $s = CategorySuggestion::where('tenant_id', $tid)->findOrFail($id);
        abort_unless(in_array($s->status, ['suggested', 'failed']), 422, 'Bu öneri onaylanabilir durumda değil');

        if ($s->action === 'create_category') {
            // Kategori açma bu sürümde panelden otomasyonla YAPILMAZ — bilinçli fren.
            $s->update(['status' => 'approved', 'error' => null]);

            return response()->json(['ok' => true, 'note' => 'Yeni kategori önerisi onaylandı; kategori açma işlemi ayrıca yapılır.']);
        }

        $s->update(['status' => 'approved', 'error' => null]);

        if ($request->boolean('apply', true)) {
            $ok = app(CategoryApplier::class)->apply($s->fresh());

            return response()->json(['ok' => $ok, 'status' => $s->fresh()->status, 'error' => $s->fresh()->error]);
        }

        return response()->json(['ok' => true, 'status' => 'approved']);
    }

    /**
     * Toplu onay/red. Onayda öneriler approved işaretlenir ve her biri için
     * ApplyCategorySuggestion job'u kuyruğa atılır — Ticimax yazımları arka planda
     * (queue:work cron'u her dakika işler), istek anında döner.
     */
    public function bulk(Request $request): JsonResponse
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        $data = $request->validate([
            'action' => 'required|in:approve,reject',
            'ids' => 'required|array|min:1|max:500',
            'ids.*' => 'integer',
        ]);

        $q = CategorySuggestion::where('tenant_id', $tid)
            ->whereIn('id', $data['ids'])
            ->whereIn('status', ['suggested', 'failed']);

        if ($data['action'] === 'reject') {
            $n = $q->update(['status' => 'rejected']);

            return response()->json(['ok' => true, 'count' => $n]);
        }

        // create_category önerileri toplu onaya girmez (kategori açma elle yapılır)
        $ids = $q->where('action', '!=', 'create_category')->pluck('id');
        CategorySuggestion::whereIn('id', $ids)->update(['status' => 'approved', 'error' => null]);
        foreach ($ids as $id) {
            \App\Jobs\ApplyCategorySuggestion::dispatch((int) $id);
        }

        return response()->json(['ok' => true, 'count' => $ids->count(), 'queued' => true]);
    }

    public function reject(int $id): JsonResponse
    {
        $tid = $this->tenantId();
        $s = CategorySuggestion::where('tenant_id', $tid)->findOrFail($id);
        abort_unless(in_array($s->status, ['suggested', 'approved', 'failed']), 422, 'Bu öneri reddedilebilir durumda değil');

        $s->update(['status' => 'rejected']);

        return response()->json(['ok' => true]);
    }

    /** Ağaç sağlık raporu: dublike dallar, boş yapraklar, sahipsiz ürün örnekleri. */
    public function treeAudit(): JsonResponse
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        $dupes = DB::table('platform_categories')
            ->where('tenant_id', $tid)->where('is_active', true)
            ->selectRaw("lower(name) as name, count(*) as count, json_agg(json_build_object('id', platform_category_id, 'path', path, 'products', product_count) order by path) as branches")
            ->groupBy(DB::raw('lower(name)'))->havingRaw('count(*) > 1')
            ->orderByRaw('count(*) desc')->get()
            ->map(fn ($d) => ['name' => $d->name, 'count' => (int) $d->count, 'branches' => json_decode($d->branches)]);

        $empty = DB::table('platform_categories')
            ->where('tenant_id', $tid)->where('is_active', true)->where('is_assignable', true)
            ->where('children_count', 0)->where('product_count', 0)
            ->orderBy('path')->get(['platform_category_id as id', 'name', 'path']);

        $orphans = DB::select("
            select p.id, p.name, p.category, p.images->>0 as image
            from products p
            where p.tenant_id = ? and p.is_active = true
              and not exists (
                  select 1 from product_platform_categories ppc
                  join platform_categories pc on pc.tenant_id = ppc.tenant_id
                   and pc.platform_category_id = ppc.platform_category_id
                  where ppc.tenant_id = p.tenant_id
                    and ppc.platform_product_id = cast(p.platform_product_id as integer)
                    and pc.is_assignable = true and pc.is_active = true
              )
            order by p.id limit 100
        ", [$tid]);

        return response()->json([
            'duplicate_branches' => $dupes,
            'empty_leaves' => $empty,
            'orphans' => collect($orphans)->map(fn ($o) => [
                'id' => $o->id, 'name' => $o->name, 'category' => $o->category,
                'image' => $o->image ? str_replace('/buyuk/', '/thumb/', $o->image) : null,
            ]),
        ]);
    }

    /** Sıralanabilir kategoriler (seçici için). */
    public function rankingCategories(): JsonResponse
    {
        $tid = $this->tenantId();
        abort_unless($tid, 404, 'Tenant bulunamadi');

        $min = (int) config('category_ranking.min_pool_size', 5);
        $cats = PlatformCategory::forTenant($tid)
            ->where('is_active', true)->where('is_assignable', true)
            ->where('product_count', '>=', $min)
            ->orderBy('path')
            ->get(['platform_category_id as id', 'name', 'path', 'product_count']);

        return response()->json([
            'categories' => $cats,
            'weights' => CategoryRanker::effectiveWeights($this->tenantOrFail()),
            'has_override' => isset(($this->tenantOrFail()->settings ?? [])['category_ranking_weights']),
            'config' => [
                'discovery_slot_interval' => CategoryRanker::effectiveDiscovery($this->tenantOrFail())['interval'],
                'discovery_new_max_age_days' => CategoryRanker::effectiveDiscovery($this->tenantOrFail())['max_age_days'],
                'freshness_tau_days' => config('category_ranking.freshness_tau_days'),
                'size_coverage_floor' => config('category_ranking.size_coverage_floor'),
                'out_of_stock_multiplier' => config('category_ranking.out_of_stock_multiplier'),
                'hysteresis_min_move' => config('category_ranking.hysteresis_min_move'),
            ],
            'enabled' => (bool) (($this->tenantOrFail()->settings ?? [])['category_ranking_enabled'] ?? false),
        ]);
    }

    /** Tenant'ın sıralama ağırlıkları: varsayılan + override + etkin + geçmiş. */
    public function rankingWeights(): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $s = $tenant->settings ?? [];

        return response()->json([
            'defaults' => config('category_ranking.weights'),
            'override' => $s['category_ranking_weights'] ?? null,
            'effective' => CategoryRanker::effectiveWeights($tenant),
            'history' => array_slice($s['category_ranking_weight_history'] ?? [], 0, 20),
            'ab' => CategoryRanker::abStatus($tenant),
        ]);
    }

    /**
     * A/B testi (zaman dönüşümlü): {action:"start", variant_b:{...}, period_days} —
     * varyant A = o anki etkin ağırlıkların fotoğrafı; dönem sonunda varyantlar
     * otomatik döner (etkin ağırlık cron'da hesaplanır). {action:"stop"} bitirir,
     * ağırlıklar teste girmeden önceki haline döner.
     */
    public function rankingAb(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $s = $tenant->settings ?? [];
        $u = auth()->user();
        $by = $u->name ?? $u->email ?? 'panel';
        $action = (string) $request->input('action');

        if ($action === 'start') {
            abort_if(($s['category_ranking_ab']['enabled'] ?? false), 422, 'Zaten aktif bir A/B testi var');
            $rawB = $request->input('variant_b');
            abort_unless(is_array($rawB) && count($rawB), 422, 'variant_b ağırlıkları gerekli');
            foreach ($rawB as $k => $v) {
                abort_unless(array_key_exists($k, config('category_ranking.weights')), 422, "Bilinmeyen sinyal: {$k}");
                abort_unless(is_numeric($v) && (float) $v >= 0, 422, "Geçersiz değer: {$k}");
            }
            abort_unless(array_sum(array_map('floatval', $rawB)) > 0, 422, 'En az bir ağırlık sıfırdan büyük olmalı');
            $period = min(30, max(1, (int) $request->input('period_days', 7)));

            $variantA = CategoryRanker::effectiveWeights($tenant);
            $variantB = CategoryRanker::normalizeWeights($rawB);
            abort_if($variantA == $variantB, 422, 'Varyant B, mevcut ağırlıklarla aynı — test anlamsız');

            $s['category_ranking_ab'] = [
                'enabled' => true,
                'started_at' => now()->toIso8601String(),
                'period_days' => $period,
                'variant_a' => $variantA,
                'variant_b' => $variantB,
            ];
            $entry = ['at' => now()->toIso8601String(), 'by' => $by, 'action' => 'ab_start', 'weights' => $variantB];
        } elseif ($action === 'stop') {
            abort_unless(($s['category_ranking_ab']['enabled'] ?? false), 422, 'Aktif A/B testi yok');
            $s['category_ranking_ab']['enabled'] = false;
            $s['category_ranking_ab']['stopped_at'] = now()->toIso8601String();
            $entry = ['at' => now()->toIso8601String(), 'by' => $by, 'action' => 'ab_stop', 'weights' => CategoryRanker::effectiveWeights($tenant)];
        } else {
            abort(422, 'action start|stop olmalı');
        }

        $s['category_ranking_weight_history'] = array_slice(
            array_merge([$entry], $s['category_ranking_weight_history'] ?? []), 0, 20
        );
        $tenant->update(['settings' => $s]);
        $tenant->refresh();

        return response()->json([
            'ok' => true,
            'effective' => CategoryRanker::effectiveWeights($tenant),
            'ab' => CategoryRanker::abStatus($tenant),
        ]);
    }

    /** A/B dönem sonuçları: her pencere için sipariş adedi / ciro / ort. sepet. */
    public function rankingAbResults(): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $ab = ($tenant->settings ?? [])['category_ranking_ab'] ?? null;
        abort_unless(is_array($ab) && ! empty($ab['started_at']), 404, 'A/B testi bulunamadı');

        $start = \Illuminate\Support\Carbon::parse($ab['started_at']);
        $end = ! empty($ab['stopped_at']) && ! ($ab['enabled'] ?? false)
            ? \Illuminate\Support\Carbon::parse($ab['stopped_at']) : now();
        $period = max(1, (int) ($ab['period_days'] ?? 7));

        $windows = [];
        $cursor = $start->copy();
        $i = 0;
        while ($cursor < $end && $i < 24) {
            $wEnd = min($cursor->copy()->addDays($period), $end);
            $row = DB::selectOne('
                select count(*) as orders, coalesce(sum(total_amount),0) as revenue
                from orders
                where tenant_id = ? and order_date >= ? and order_date < ?
                  and (status > 0 or payment_status = 1 or paid_amount > 0) and status <> 8
            ', [$tenant->id, $cursor, $wEnd]);
            $windows[] = [
                'variant' => $i % 2 === 0 ? 'A' : 'B',
                'from' => $cursor->toIso8601String(),
                'to' => $wEnd->toIso8601String(),
                'running' => $wEnd->equalTo($end) && ($ab['enabled'] ?? false),
                'orders' => (int) $row->orders,
                'revenue' => round((float) $row->revenue, 2),
                'aov' => $row->orders > 0 ? round((float) $row->revenue / (int) $row->orders, 2) : null,
            ];
            $cursor = $wEnd;
            $i++;
        }

        $tot = function (string $v) use ($windows) {
            $w = array_filter($windows, fn ($x) => $x['variant'] === $v && ! $x['running']);
            $orders = array_sum(array_column($w, 'orders'));
            $revenue = array_sum(array_column($w, 'revenue'));

            return ['windows' => count($w), 'orders' => $orders, 'revenue' => round($revenue, 2),
                'aov' => $orders > 0 ? round($revenue / $orders, 2) : null];
        };

        return response()->json([
            'ab' => CategoryRanker::abStatus($tenant) ?? ['enabled' => false, 'started_at' => $ab['started_at'], 'period_days' => $period],
            'windows' => $windows,
            'totals' => ['A' => $tot('A'), 'B' => $tot('B')],
            'note' => 'Tamamlanmamış (sürmekte olan) pencere toplamlara dahil edilmez. Varyant geçişi dönem sınırından sonraki ilk gece yazımıyla vitrine yansır.',
        ]);
    }

    /**
     * Ağırlıkları kaydet (tam serbest, sunucu tarafında toplam 1.0'a normalize)
     * veya {"reset":true} ile varsayılana dön. Her değişiklik geçmişe yazılır —
     * A/B testi okurken "hangi tarihte hangi ağırlıklar" buradan çıkar.
     */
    public function saveRankingWeights(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $s = $tenant->settings ?? [];
        abort_if(($s['category_ranking_ab']['enabled'] ?? false), 422,
            'A/B testi sürerken ağırlık değiştirilemez — önce testi durdurun');
        $u = auth()->user();
        $by = $u->name ?? $u->email ?? 'panel';

        if ($request->boolean('reset')) {
            unset($s['category_ranking_weights']);
            $entry = ['at' => now()->toIso8601String(), 'by' => $by, 'action' => 'reset', 'weights' => config('category_ranking.weights')];
        } else {
            $raw = $request->input('weights');
            abort_unless(is_array($raw) && count($raw), 422, 'weights gerekli');
            foreach ($raw as $k => $v) {
                abort_unless(array_key_exists($k, config('category_ranking.weights')), 422, "Bilinmeyen sinyal: {$k}");
                abort_unless(is_numeric($v) && (float) $v >= 0, 422, "Geçersiz değer: {$k}");
            }
            abort_unless(array_sum(array_map('floatval', $raw)) > 0, 422, 'En az bir ağırlık sıfırdan büyük olmalı');
            $normalized = CategoryRanker::normalizeWeights($raw);
            $s['category_ranking_weights'] = $normalized;
            $entry = ['at' => now()->toIso8601String(), 'by' => $by, 'action' => 'save', 'weights' => $normalized];
        }

        $s['category_ranking_weight_history'] = array_slice(
            array_merge([$entry], $s['category_ranking_weight_history'] ?? []), 0, 20
        );
        $tenant->update(['settings' => $s]);
        $tenant->refresh();

        return response()->json([
            'ok' => true,
            'defaults' => config('category_ranking.weights'),
            'override' => ($tenant->settings ?? [])['category_ranking_weights'] ?? null,
            'effective' => CategoryRanker::effectiveWeights($tenant),
            'history' => array_slice(($tenant->settings ?? [])['category_ranking_weight_history'] ?? [], 0, 20),
        ]);
    }

    /**
     * Keşif slotu ayarları (panel): aralık + yaş penceresi + satış şartı.
     * ?max_age_days= & ?require_no_sales= verilirse aday sayısı KAYDEDİLMEDEN
     * o değerlere göre hesaplanır (panelde canlı tahmin).
     */
    public function rankingDiscovery(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $s = $tenant->settings ?? [];
        $effective = CategoryRanker::effectiveDiscovery($tenant);

        $probe = $effective;
        if ($request->filled('max_age_days')) {
            $probe = CategoryRanker::normalizeDiscovery([
                'mode' => $request->input('mode', $effective['mode']),
                'interval' => $request->input('interval', $effective['interval']),
                'max_age_days' => $request->input('max_age_days'),
                'require_no_sales' => $request->input('require_no_sales', $effective['require_no_sales']),
                'bonus_max' => $request->input('bonus_max', $effective['bonus_max']),
                'guarantee_within' => $request->input('guarantee_within', $effective['guarantee_within']),
                'guarantee_position' => $request->input('guarantee_position', $effective['guarantee_position']),
            ]);
        }

        return response()->json([
            'defaults' => CategoryRanker::normalizeDiscovery(null),
            'override' => $s['category_ranking_discovery'] ?? null,
            'effective' => $effective,
            'probe' => $probe,
            'candidates' => $this->discoveryCandidateCount($tenant->id, $probe),
            'limits' => ['interval' => [2, 50], 'max_age_days' => [1, 1000], 'bonus_max' => [0, 0.3], 'guarantee_within' => [0, 50]],
        ]);
    }

    /** Keşif slotu ayarlarını kaydet / varsayılana döndür. */
    public function saveRankingDiscovery(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $s = $tenant->settings ?? [];
        $u = auth()->user();
        $by = $u->name ?? $u->email ?? 'panel';

        if ($request->boolean('reset')) {
            unset($s['category_ranking_discovery']);
            $saved = CategoryRanker::normalizeDiscovery(null);
            $action = 'discovery_reset';
        } else {
            $raw = $request->input('discovery');
            abort_unless(is_array($raw), 422, 'discovery gerekli');
            abort_unless(is_numeric($raw['max_age_days'] ?? null), 422, 'max_age_days sayı olmalı');
            if (($raw['mode'] ?? 'bonus') === 'slot') {
                abort_unless(is_numeric($raw['interval'] ?? null), 422, 'interval sayı olmalı');
            }
            $saved = CategoryRanker::normalizeDiscovery($raw);
            $s['category_ranking_discovery'] = $saved;
            $action = 'discovery_save';
        }

        $s['category_ranking_weight_history'] = array_slice(array_merge([[
            'at' => now()->toIso8601String(), 'by' => $by, 'action' => $action,
            'weights' => [], 'discovery' => $saved,
        ]], $s['category_ranking_weight_history'] ?? []), 0, 20);

        $tenant->update(['settings' => $s]);
        $tenant->refresh();

        return response()->json([
            'ok' => true,
            'defaults' => CategoryRanker::normalizeDiscovery(null),
            'override' => ($tenant->settings ?? [])['category_ranking_discovery'] ?? null,
            'effective' => CategoryRanker::effectiveDiscovery($tenant),
            'probe' => CategoryRanker::effectiveDiscovery($tenant),
            'candidates' => $this->discoveryCandidateCount($tenant->id, CategoryRanker::effectiveDiscovery($tenant)),
            'limits' => ['interval' => [2, 50], 'max_age_days' => [1, 1000], 'bonus_max' => [0, 0.3], 'guarantee_within' => [0, 50]],
            'history' => array_slice(($tenant->settings ?? [])['category_ranking_weight_history'] ?? [], 0, 20),
        ]);
    }

    /**
     * Verilen keşif ayarıyla kaç ürün "yeni" sayılır — panelde kapsama tahmini için.
     * Ranker'daki isNew ile aynı ölçüt: yaş penceresi + stok (+ istenirse satışsızlık).
     */
    protected function discoveryCandidateCount(int $tid, array $disc): array
    {
        $age = (int) $disc['max_age_days'];
        $salesWindow = (int) config('category_ranking.sales_window_days', 60);

        $row = DB::selectOne('
            select count(*) as young,
                   count(*) filter (where p.stock_quantity > 0) as stocked,
                   count(*) filter (where p.stock_quantity > 0 and coalesce(s.q, 0) = 0) as no_sales
            from products p
            left join (
                select oi.product_id, sum(oi.quantity) as q
                from order_items oi
                join orders o on o.id = oi.order_id
                where oi.tenant_id = ? and o.order_date > now() - make_interval(days => ?)
                  and (o.status > 0 or o.payment_status = 1 or o.paid_amount > 0) and o.status <> 8
                group by oi.product_id
            ) s on s.product_id = p.id
            where p.tenant_id = ? and p.is_active = true
              and p.platform_created_at > now() - make_interval(days => ?)
        ', [$tid, $salesWindow, $tid, $age]);

        $eligible = $disc['require_no_sales'] ? (int) $row->no_sales : (int) $row->stocked;

        return [
            'young' => (int) $row->young,
            'stocked' => (int) $row->stocked,
            'no_sales' => (int) $row->no_sales,
            'eligible' => $eligible,
            // Kataloğun tamamı için kaba derinlik tahmini; kategori bazında aday
            // sayısı daha düşük olacağı için bu bir ÜST sınırdır.
            'coverage_depth' => $eligible * (int) $disc['interval'],
        ];
    }

    /** Kategorinin aktif ürün havuzunu verilen stok kodlarıyla sıralar; sabitleme raporunu döner. */
    protected function resolvePins(Tenant $tenant, PlatformCategory $cat, array $codes): array
    {
        if (! $codes) {
            return [];
        }
        $ids = DB::table('product_platform_categories as ppc')
            ->join('products as p', 'p.id', '=', 'ppc.product_id')
            ->where('ppc.tenant_id', $tenant->id)
            ->where('ppc.platform_category_id', $cat->platform_category_id)
            ->where('p.is_active', true)
            ->pluck('ppc.product_id')->map(fn ($v) => (int) $v)->all();

        $ranker = app(CategoryRanker::class);
        $ranker->buildSignals($tenant);
        $ranker->rank($ids, $cat->path ?? null, $codes);

        return $ranker->lastPins;
    }

    /**
     * Manuel ilk sıralar: kategori başına stok kodu listesi. ?category_id= verilirse o kategorinin
     * kodları + çözümü (hangi renk seçildi / bulunamadı / stoksuz); her zaman kategori→adet özeti.
     */
    public function rankingPins(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $all = ($tenant->settings ?? [])['category_ranking_pins'] ?? [];
        $counts = [];
        foreach ((array) $all as $cid => $codes) {
            $counts[(int) $cid] = count((array) $codes);
        }

        $catId = (int) $request->query('category_id');
        if ($catId <= 0) {
            return response()->json(['counts' => $counts]);
        }
        $cat = PlatformCategory::forTenant($tenant->id)->where('platform_category_id', $catId)->firstOrFail();
        $codes = CategoryRanker::effectivePins($tenant, $catId);

        return response()->json([
            'category_id' => $catId,
            'codes' => $codes,
            'resolved' => $this->resolvePins($tenant, $cat, $codes),
            'counts' => $counts,
        ]);
    }

    /** Manuel ilk sıraları kaydet (boş liste = kaldır). apply=true → kategori hemen Ticimax'a yazılır (kuyruk). */
    public function saveRankingPins(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $catId = (int) $request->input('category_id');
        abort_unless($catId > 0, 422, 'category_id gerekli');
        $cat = PlatformCategory::forTenant($tenant->id)->where('platform_category_id', $catId)->firstOrFail();

        $codes = CategoryRanker::normalizePins($request->input('codes', []));
        $s = $tenant->settings ?? [];
        $pins = is_array($s['category_ranking_pins'] ?? null) ? $s['category_ranking_pins'] : [];
        if ($codes) {
            $pins[(string) $catId] = $codes;
        } else {
            unset($pins[(string) $catId], $pins[$catId]);
        }
        $s['category_ranking_pins'] = $pins;

        $u = auth()->user();
        $s['category_ranking_weight_history'] = array_slice(array_merge([[
            'at' => now()->toIso8601String(), 'by' => $u->name ?? $u->email ?? 'panel', 'action' => 'pins_save',
            'weights' => [], 'pins' => ['category' => $cat->path, 'codes' => $codes],
        ]], $s['category_ranking_weight_history'] ?? []), 0, 20);

        $tenant->update(['settings' => $s]);
        $tenant->refresh();

        $applied = false;
        if ($request->boolean('apply') && (bool) (($tenant->settings ?? [])['category_ranking_enabled'] ?? false)) {
            \App\Jobs\ApplyCategoryRanking::dispatch($tenant->id, $catId);
            $applied = true;
        }

        $counts = [];
        foreach ($pins as $cid => $c) {
            $counts[(int) $cid] = count((array) $c);
        }

        return response()->json([
            'ok' => true,
            'category_id' => $catId,
            'codes' => $codes,
            'resolved' => $this->resolvePins($tenant, $cat, $codes),
            'counts' => $counts,
            'apply_queued' => $applied,
        ]);
    }

    /** Sıralama önizlemesi — CANLIYA YAZMAZ. Sinyal dökümüyle tam şeffaf liste. */
    public function rankingPreview(Request $request): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $catId = (int) $request->query('category_id');
        abort_unless($catId > 0, 422, 'category_id gerekli');

        $cat = PlatformCategory::forTenant($tenant->id)
            ->where('platform_category_id', $catId)->firstOrFail();

        $rows = DB::table('product_platform_categories as ppc')
            ->join('products as p', 'p.id', '=', 'ppc.product_id')
            ->where('ppc.tenant_id', $tenant->id)
            ->where('ppc.platform_category_id', $catId)
            ->where('p.is_active', true)
            ->get(['ppc.product_id', 'ppc.sira', 'p.name', 'p.images', 'p.url']);

        $meta = $rows->keyBy('product_id');

        $ranker = app(CategoryRanker::class);

        // Kaydetmeden simülasyon: ?weights={"sales":50,...} (JSON) — normalize edilir.
        $customWeights = null;
        if ($request->filled('weights')) {
            $customWeights = json_decode((string) $request->query('weights'), true);
            abort_unless(is_array($customWeights), 422, 'weights geçersiz JSON');
            $ranker->setWeights($customWeights);
        }

        // Kaydetmeden simülasyon: ?discovery={"interval":4,"max_age_days":120,...}
        $customDiscovery = null;
        if ($request->filled('discovery')) {
            $customDiscovery = json_decode((string) $request->query('discovery'), true);
            abort_unless(is_array($customDiscovery), 422, 'discovery geçersiz JSON');
            $ranker->setDiscovery($customDiscovery);
        }

        // Manuel ilk sıralar: kayıtlı liste; ?pins=["KOD",...] ile kaydetmeden deneme
        $pins = CategoryRanker::effectivePins($tenant, $catId);
        $customPins = false;
        if ($request->has('pins')) {
            $decoded = json_decode((string) $request->query('pins'), true);
            abort_unless(is_array($decoded), 422, 'pins geçersiz JSON');
            $customPins = CategoryRanker::normalizePins($decoded) !== $pins;
            $pins = CategoryRanker::normalizePins($decoded);
        }

        $ranker->buildSignals($tenant);
        $ranked = $ranker->rank($rows->pluck('product_id')->map(fn ($v) => (int) $v)->all(), $cat->path ?? null, $pins, (int) $cat->platform_category_id);

        $limit = max(10, min(500, (int) $request->query('limit', 100)));

        // Mevcut sıra pozisyonları (Sira artan; 9999 = sırasız)
        $currentOrder = $rows->sortBy([['sira', 'asc'], ['product_id', 'asc']])->pluck('product_id')->values();
        $currentPos = array_flip($currentOrder->all());

        $out = [];
        foreach (array_slice($ranked, 0, $limit) as $i => $r) {
            $m = $meta[$r['product_id']] ?? null;
            $images = $m ? json_decode($m->images ?? '[]', true) : [];
            $oldSira = $m ? (int) $m->sira : 9999;

            $out[] = [
                'rank' => $i + 1,
                'product_id' => $r['product_id'],
                'name' => $r['name'],
                'image' => isset($images[0]) ? str_replace('/buyuk/', '/thumb/', $images[0]) : null,
                'url' => $this->absUrl($m->url ?? null, $tenant->id),
                'score' => $r['score'],
                'discovery' => $r['discovery'] ?? false,
                'pinned' => $r['pinned'] ?? false,
                'model' => $r['model'] ?? '',
                'is_new' => $r['is_new'],
                'season' => $r['season'] ?? null,
                'off_season' => $r['off_season'] ?? false,
                'old_sira' => $oldSira < 9999 ? $oldSira : null,
                'old_position' => isset($currentPos[$r['product_id']]) && $oldSira < 9999 ? $currentPos[$r['product_id']] + 1 : null,
                'signals' => $r['signals'],
            ];
        }

        return response()->json([
            'category' => ['id' => $cat->platform_category_id, 'path' => $cat->path, 'pool' => count($ranked)],
            'weights' => $customWeights ? CategoryRanker::normalizeWeights($customWeights) : CategoryRanker::effectiveWeights($tenant),
            'simulated' => (bool) $customWeights || (bool) $customDiscovery || $customPins,
            'pins' => $ranker->lastPins,
            'discovery' => $customDiscovery
                ? CategoryRanker::normalizeDiscovery($customDiscovery)
                : CategoryRanker::effectiveDiscovery($tenant),
            'season' => CategoryRanker::effectiveSeason($tenant),
            'items' => $out,
        ]);
    }
}
