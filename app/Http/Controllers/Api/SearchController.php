<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SearchQuery;
use App\Models\SearchSynonym;
use App\Models\Tenant;
use App\Services\Search\DiscoveryEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Arama PANELİ (auth + tenant). Analitik, sonuçsuz sorgular, sinonim yönetimi, önizleme.
 * BelongsToTenant global-scope aktif (authlu) → SearchQuery/SearchSynonym otomatik tenant'a filtreli.
 */
class SearchController extends Controller
{
    protected function tenantId(): ?int
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return (int) $user->tenant_id;
        }

        return request()->header('X-Tenant-Id') ? (int) request()->header('X-Tenant-Id') : null;
    }

    /** GET /search/analytics?range=today|yesterday|7|30|90 (gün sınırları TR saatiyle) */
    public function analytics(Request $request): JsonResponse
    {
        $range = strtolower(trim((string) $request->query('range', (string) $request->query('days', '30'))));
        $tzOff = (int) config('search.attribution.order_tz_offset_hours', 3);
        // search_* UTC tutulur; "bugün/dün" TR gününe göre hesaplanıp UTC'ye çevrilir
        $trDayStart = now()->addHours($tzOff)->startOfDay()->subHours($tzOff);
        $until = null;
        if ($range === 'today') {
            $since = $trDayStart;
            $days = 1;
        } elseif ($range === 'yesterday') {
            $since = $trDayStart->copy()->subDay();
            $until = $trDayStart;
            $days = 1;
        } else {
            $days = max(1, min(365, (int) $range ?: 30));
            $since = now()->subDays($days);
        }

        $base = SearchQuery::query()->where('created_at', '>=', $since)->where('is_test', false)
            ->when($until, fn ($q) => $q->where('created_at', '<', $until));

        $total = (clone $base)->count();
        $zero = (clone $base)->where('has_results', false)->count();

        // Tıklama / CTR / aramadan ciro (search_events)
        $ev = DB::table('search_events')
            ->where('tenant_id', $this->tenantId())
            ->where('is_test', false)
            ->where('created_at', '>=', $since)
            ->when($until, fn ($q) => $q->where('created_at', '<', $until));
        $clicks = (clone $ev)->where('type', 'click')->count();
        $conversions = (clone $ev)->where('type', 'conversion')->count();
        $revenue = (float) (clone $ev)->where('type', 'conversion')->sum('value');

        $top = (clone $base)
            ->selectRaw('normalized_query, count(*) as cnt, round(avg(results_count)) as avg_results')
            ->groupBy('normalized_query')
            ->orderByRaw('cnt desc')
            ->limit(25)
            ->get();

        // En çok tıklanan ürünler — ürün performans analizi (sorgu ataması olan tıklamalarda sorgular da listelenir)
        $topProducts = DB::table('search_events as e')
            ->join('products as p', 'p.id', '=', 'e.product_id')
            ->leftJoin('search_queries as q', 'q.id', '=', 'e.search_query_id')
            ->where('e.tenant_id', $this->tenantId())
            ->where('e.is_test', false)
            ->where('e.type', 'click')
            ->where('e.created_at', '>=', $since)
            ->when($until, fn ($q) => $q->where('e.created_at', '<', $until))
            ->selectRaw("p.id, p.name, p.url, p.price, p.images->>0 as image,
                count(*) as clicks,
                count(distinct e.session_id) as sessions,
                round(avg(e.position), 1) as avg_position,
                string_agg(distinct q.normalized_query, ', ') as queries")
            ->groupBy('p.id')
            ->orderByDesc('clicks')
            ->limit(25)
            ->get();

        // DB'deki url'ler relative — mağaza adresiyle mutlaklaştır (widget'taki present() ile aynı kural)
        $shopUrl = rtrim((string) (($this->tenant()?->settings ?? [])['shop_url'] ?? ''), '/');
        if ($shopUrl !== '') {
            $topProducts->each(function ($r) use ($shopUrl) {
                if ($r->url && str_starts_with($r->url, '/')) {
                    $r->url = $shopUrl . $r->url;
                }
            });
        }

        $absolutizeProductUrl = function ($r) use ($shopUrl) {
            if ($shopUrl !== '' && $r->product_url && str_starts_with($r->product_url, '/')) {
                $r->product_url = $shopUrl . $r->product_url;
            }
        };

        $topZero = (clone $base)
            ->where('has_results', false)
            ->selectRaw('normalized_query, count(*) as cnt')
            ->groupBy('normalized_query')
            ->orderByRaw('cnt desc')
            ->limit(25)
            ->get();

        // Aramadan gelen satışlar — detay: kim, ne aratmış, neye tıklamış, ne almış.
        // Conversion'lar sunucu-taraflı atıfla yazılır (search:attribute-conversions);
        // saatler TR'ye çevrilir (search_* UTC tutulur, offset config'te).
        $orders = DB::table('search_events as e')
            ->join('orders as o', function ($j) {
                $j->on('o.platform_order_id', '=', 'e.platform_order_id')
                    ->on('o.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoin('search_queries as q', 'q.id', '=', 'e.search_query_id')
            ->leftJoin('products as p', 'p.id', '=', 'e.product_id')
            ->where('e.tenant_id', $this->tenantId())
            ->where('e.is_test', false)
            ->where('e.type', 'conversion')
            ->where('e.created_at', '>=', $since)
            ->when($until, fn ($q) => $q->where('e.created_at', '<', $until))
            ->selectRaw("o.order_no, o.order_date, o.total_amount, o.customer_name, o.items_count,
                q.raw_query,
                q.created_at + make_interval(hours => {$tzOff}) as searched_at,
                round(extract(epoch from (o.order_date - (q.created_at + make_interval(hours => {$tzOff})))) / 60) as minutes_to_order,
                p.name as product_name, p.url as product_url, p.images->>0 as product_image")
            ->orderByDesc('o.order_date')
            ->limit(100)
            ->get();
        $orders->each($absolutizeProductUrl);

        return response()->json([
            'range' => $range,
            'range_days' => $days,
            'total_searches' => $total,
            'zero_result_searches' => $zero,
            'zero_result_rate' => $total > 0 ? round($zero / $total * 100, 1) : 0.0,
            'total_clicks' => $clicks,
            'ctr' => $total > 0 ? round($clicks / $total * 100, 1) : 0.0,
            'conversions' => $conversions,
            'attributed_revenue' => round($revenue, 2),
            'top_queries' => $top,
            'top_zero_result_queries' => $topZero,
            'top_clicked_products' => $topProducts,
            'attributed_orders' => $orders,
        ]);
    }

    /** GET /search/synonyms */
    public function synonyms(): JsonResponse
    {
        return response()->json(
            SearchSynonym::query()->orderByDesc('updated_at')->limit(500)->get()
        );
    }

    /** POST /search/synonyms */
    public function storeSynonym(Request $request): JsonResponse
    {
        $data = $request->validate([
            'term' => 'required|string|max:120',
            'synonyms' => 'required|array|min:1',
            'synonyms.*' => 'string|max:120',
            'type' => 'in:synonym,spelling,redirect',
            'status' => 'in:active,suggested,rejected',
        ]);

        $syn = SearchSynonym::create([
            'term' => $data['term'],
            'synonyms' => array_values($data['synonyms']),
            'type' => $data['type'] ?? 'synonym',
            'source' => 'manual',
            'status' => $data['status'] ?? 'active',
        ]);

        $this->forgetSynonymCache();

        return response()->json($syn, 201);
    }

    /** PUT /search/synonyms/{id} */
    public function updateSynonym(Request $request, int $id): JsonResponse
    {
        $syn = SearchSynonym::query()->findOrFail($id);

        $data = $request->validate([
            'term' => 'sometimes|string|max:120',
            'synonyms' => 'sometimes|array|min:1',
            'synonyms.*' => 'string|max:120',
            'type' => 'in:synonym,spelling,redirect',
            'status' => 'in:active,suggested,rejected',
        ]);

        $syn->fill($data);
        if (isset($data['synonyms'])) {
            $syn->synonyms = array_values($data['synonyms']);
        }
        $syn->save();

        $this->forgetSynonymCache();

        return response()->json($syn);
    }

    /** DELETE /search/synonyms/{id} */
    public function destroySynonym(int $id): JsonResponse
    {
        $syn = SearchSynonym::query()->findOrFail($id);
        $syn->delete();
        $this->forgetSynonymCache();

        return response()->json(['ok' => true]);
    }

    /** GET /search/settings — widget kurulum bilgisi + mevcut ayarlar (panel "Kurulum & Ayarlar"). */
    public function settings(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $s = $tenant->settings ?? [];
        $ts = \App\Services\Search\TenantSearchSettings::get($tenant->id);

        return response()->json([
            'slug' => $tenant->slug,
            'enabled' => (bool) filter_var($s['search_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'domains' => (string) ($s['search_widget_domains'] ?? ''),
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($s['shop_url'] ?? ''), '/'),
            // widget davranışı (panelden yönetilir, temaya dokunulmaz)
            'trigger' => $ts['trigger'],
            'input' => $ts['input'],
            'template' => $ts['template'],
            'require_stock' => $ts['require_stock'],
            'require_variant_stock' => $ts['require_variant_stock'],
            'require_image' => $ts['require_image'],
            'badge_enabled' => $ts['badge_enabled'],
            'theme' => $ts['theme'] ?? \App\Services\Search\TenantSearchSettings::theme(null),
            'placeholders' => implode(', ', $ts['placeholders'] ?? []),
            'material_terms' => implode(', ', $ts['material_terms'] ?? []),
        ]);
    }

    /** PUT /search/settings — widget aç/kapat, domain listesi, seçiciler, gösterim kuralları. */
    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }

        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'domains' => 'sometimes|nullable|string|max:500',
            'trigger' => 'sometimes|nullable|string|max:400',
            'input' => 'sometimes|nullable|string|max:400',
            'template' => 'sometimes|string|in:drawer,fullscreen',
            'require_stock' => 'sometimes|boolean',
            'require_variant_stock' => 'sometimes|boolean',
            'require_image' => 'sometimes|boolean',
            'badge_enabled' => 'sometimes|boolean',
            'theme' => 'sometimes|array',
            'theme.font' => 'sometimes|nullable|string|max:80',
            'theme.accent' => 'sometimes|nullable|string|max:7',
            'theme.ink' => 'sometimes|nullable|string|max:7',
            'theme.ratio' => 'sometimes|nullable|string|in:,2/3,3/4,1/1',
            'placeholders' => 'sometimes|nullable|string|max:400',
            'material_terms' => 'sometimes|nullable|string|max:2000',
        ]);

        $s = $tenant->settings ?? [];
        if (array_key_exists('enabled', $data)) {
            $s['search_widget_enabled'] = (bool) $data['enabled'];
        }
        if (array_key_exists('domains', $data)) {
            // host listesi normalize: şema/yol/boşluk temizle, tekrarları at
            $parts = array_values(array_unique(array_filter(array_map(function ($d) {
                $d = strtolower(trim($d));
                $d = preg_replace('~^https?://~', '', $d) ?? $d;

                return trim(explode('/', $d)[0]);
            }, explode(',', (string) $data['domains'])))));
            $s['search_widget_domains'] = implode(',', $parts);
        }
        if (array_key_exists('trigger', $data)) {
            $s['search_widget_trigger'] = trim((string) $data['trigger']);
        }
        if (array_key_exists('input', $data)) {
            $s['search_widget_input'] = trim((string) $data['input']);
        }
        if (array_key_exists('template', $data)) {
            $s['search_widget_template'] = $data['template'];
        }
        if (array_key_exists('material_terms', $data)) {
            $s['search_material_terms'] = trim((string) $data['material_terms']);
        }
        if (array_key_exists('placeholders', $data)) {
            $s['search_widget_placeholders'] = trim((string) $data['placeholders']);
        }
        if (array_key_exists('theme', $data)) {
            $s['search_widget_theme'] = \App\Services\Search\TenantSearchSettings::theme(array_merge($ts['theme'] ?? [], (array) $data['theme']));
        }
        foreach (['require_stock', 'require_variant_stock', 'require_image', 'badge_enabled'] as $k) {
            if (array_key_exists($k, $data)) {
                $s['search_'.$k] = (bool) $data[$k];
            }
        }
        $tenant->settings = $s;
        $tenant->save();

        \App\Services\Search\TenantSearchSettings::forget($tenant->id);

        return response()->json(['ok' => true] + $this->settings()->getData(true));
    }

    /**
     * GET /search/detect-selectors — mağaza ana sayfasını çekip arama ikonu/kutusu
     * ADAYLARINI bulur (id/class/href içinde search|ara geçen öğeler). Merchant panelde
     * "sitemden bul" der, adaydan seçer; CSS seçici el yazımı gerekmez.
     */
    public function detectSelectors(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $shop = rtrim((string) (($tenant->settings ?? [])['shop_url'] ?? ''), '/');
        if ($shop === '') {
            return response()->json(['error' => 'shop_url_missing', 'candidates' => []], 200);
        }

        // SSRF koruması: kiracı-kontrollü shop_url ile iç ağa/cloud metadata'ya erişimi engelle
        if (! \App\Support\SafeUrl::isPublicHttpUrl($shop)) {
            return response()->json(['error' => 'invalid_shop_url', 'candidates' => []], 200);
        }

        try {
            $html = \Illuminate\Support\Facades\Http::timeout(12)
                ->withOptions(['allow_redirects' => false])
                ->withHeaders(['User-Agent' => 'Mozilla/5.0 (YunbiSearch selector detector)'])
                ->get($shop)->body();
        } catch (\Throwable $e) {
            return response()->json(['error' => 'fetch_failed', 'candidates' => []], 200);
        }

        $candidates = [];
        // Açılış etiketlerini tara; id/class/name/href/placeholder içinde arama sinyali olanları topla
        if (preg_match_all('/<(a|button|input|div|span|i|svg|form)\b[^>]{0,600}>/iu', $html, $m)) {
            foreach ($m[0] as $tag) {
                if (! preg_match('/(search|arama|\bara\b|magnif)/iu', $tag)) {
                    continue;
                }
                $sel = null;
                if (preg_match('/\bid\s*=\s*["\']([^"\']+)["\']/iu', $tag, $mm)) {
                    $sel = '#'.trim($mm[1]);
                } elseif (preg_match('/\bclass\s*=\s*["\']([^"\']+)["\']/iu', $tag, $mm)) {
                    // arama sinyali taşıyan ilk class'ı seç; yoksa ilk class
                    $classes = preg_split('/\s+/', trim($mm[1])) ?: [];
                    $hit = null;
                    foreach ($classes as $c) {
                        if (preg_match('/(search|arama|ara)/iu', $c)) {
                            $hit = $c;
                            break;
                        }
                    }
                    $sel = '.'.($hit ?? ($classes[0] ?? ''));
                }
                if (! $sel || $sel === '.' || mb_strlen($sel) > 80) {
                    continue;
                }
                $isInput = stripos($tag, '<input') === 0;
                $candidates[$sel] = [
                    'selector' => $sel,
                    'type' => $isInput ? 'input' : 'trigger',
                    'html' => mb_substr(trim($tag), 0, 220),
                ];
            }
        }

        return response()->json(['candidates' => array_values(array_slice($candidates, 0, 10))]);
    }

    protected function tenant(): ?Tenant
    {
        $tid = $this->tenantId();

        return $tid ? Tenant::find($tid) : null;
    }

    /** GET /search/preview?q=...  (panelden canlı arama önizlemesi/hata ayıklama) */
    public function preview(Request $request): JsonResponse
    {
        $tid = $this->tenantId();
        if (! $tid) {
            return response()->json(['error' => 'no_tenant'], 422);
        }

        $q = trim((string) $request->query('q', ''));
        if ($q === '') {
            return response()->json(['error' => 'empty_query'], 422);
        }

        return response()->json(DiscoveryEngine::forTenant($tid)->search($q));
    }

    protected function forgetSynonymCache(): void
    {
        if ($tid = $this->tenantId()) {
            Cache::forget("search:syn:{$tid}");
            // spelling düzeltmeleri ayrı cache'te — onaylanan öneri 1 saat bekletilmesin
            Cache::forget("search:spell:{$tid}");
        }
    }
}
