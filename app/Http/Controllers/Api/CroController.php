<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Traits\ResolvesGa4Service;
use App\Http\Controllers\Controller;
use App\Models\CroAction;
use App\Models\CroAudit;
use App\Models\Tenant;
use App\Services\Cro\CroActionCatalog;
use App\Services\Cro\CroAuditService;
use App\Services\GoogleAnalyticsService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * CRO ürünü paneli: dönüşüm özeti (GA4 huni + cihaz + giriş sayfaları + Yunbi araçları),
 * aksiyon planı (CRUD + katalogdan tohumlama) ve otomatik site denetimi.
 */
class CroController extends Controller
{
    use ResolvesGa4Service;

    // ───────────────────────── Özet ─────────────────────────

    public function overview(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }

        [$start, $end] = $this->resolveDateRange($request);
        $days = max(1, Carbon::parse($start)->diffInDays(Carbon::parse($end)) + 1);
        $prevEnd = Carbon::parse($start)->subDay()->format('Y-m-d');
        $prevStart = Carbon::parse($start)->subDays($days)->format('Y-m-d');

        $ga4 = GoogleAnalyticsService::fromTenant($tenant);
        $ga4Ok = $ga4->isAvailable();

        $funnel = $ga4Ok ? $ga4->getFunnelData($start, $end) : null;
        $prev = $ga4Ok ? $ga4->getFunnelData($prevStart, $prevEnd) : null;
        $devices = $ga4Ok ? ($ga4->getDeviceBreakdown($start, $end) ?? []) : [];
        $landing = $ga4Ok ? ($ga4->getLandingPages($start, $end) ?? []) : [];

        $rates = fn (?array $f) => $f ? [
            'cr' => $f['sessions'] > 0 ? round($f['purchases'] / $f['sessions'] * 100, 2) : 0,
            'atc_rate' => $f['sessions'] > 0 ? round($f['add_to_carts'] / $f['sessions'] * 100, 2) : 0,
            'atc_to_checkout' => $f['add_to_carts'] > 0 ? round($f['checkouts'] / $f['add_to_carts'] * 100, 2) : 0,
            'checkout_to_purchase' => $f['checkouts'] > 0 ? round($f['purchases'] / $f['checkouts'] * 100, 2) : 0,
            'aov' => $f['purchases'] > 0 ? round($f['revenue'] / $f['purchases'], 2) : 0,
            'rps' => $f['sessions'] > 0 ? round($f['revenue'] / $f['sessions'], 2) : 0, // oturum başına ciro
        ] : null;

        // Giriş sayfaları: yeterli trafikli olanlarda site ortalamasının altındakiler "fırsat"
        $siteCr = $funnel && $funnel['sessions'] > 0 ? $funnel['purchases'] / $funnel['sessions'] * 100 : 0;
        $landingRows = collect($landing)
            ->filter(fn ($r) => ! empty($r['landing_page']) && ! str_contains((string) $r['landing_page'], '(not set)'))
            ->sortByDesc('sessions')->take(25)->map(function ($r) use ($siteCr) {
            $cr = round((float) ($r['conversion_rate'] ?? 0), 2);
            $sessions = (int) ($r['sessions'] ?? 0);
            $r['conversion_rate'] = $cr;
            $r['bounce_rate'] = round((float) ($r['bounce_rate'] ?? 0), 1);
            $r['engagement_rate'] = round((float) ($r['engagement_rate'] ?? 0), 1);
            $r['revenue'] = round((float) ($r['revenue'] ?? 0), 2);
            // Fırsat: yeterli trafik (≥1000 oturum) + site ortalamasının %70'inin altında dönüşüm
            $r['opportunity'] = $siteCr > 0 && $sessions >= 1000 && $cr < $siteCr * 0.7;
            // Site ortalamasına çekilse kaç ek sipariş gelirdi?
            $r['potential_orders'] = $r['opportunity'] ? (int) round($sessions * ($siteCr - $cr) / 100) : 0;

            return $r;
        })->values();

        return response()->json([
            'period' => ['start' => $start, 'end' => $end, 'prev_start' => $prevStart, 'prev_end' => $prevEnd, 'days' => $days],
            'ga4_configured' => $ga4Ok,
            'funnel' => $funnel,
            'funnel_prev' => $prev,
            'rates' => $rates($funnel),
            'rates_prev' => $rates($prev),
            'devices' => $devices,
            'landing_pages' => $landingRows,
            'tools' => $this->tools($tenant, $days),
            'actions' => $this->actionSummary($tenant),
            'audit' => $this->latestAuditSummary($tenant),
        ]);
    }

    /** Yunbi'nin CRO'ya dokunan araçları: açık mı + dönemdeki atfedilen ciro. */
    private function tools(Tenant $tenant, int $days): array
    {
        $s = $tenant->settings ?? [];
        $tid = $tenant->id;
        $since = now()->subDays($days);
        $on = fn ($k) => filter_var($s[$k] ?? false, FILTER_VALIDATE_BOOLEAN);

        $recEv = DB::table('rec_events')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $recRevenue = (float) (clone $recEv)->where('type', 'conversion')->sum('value');
        $recOrders = (int) (clone $recEv)->where('type', 'conversion')->count();

        $srchEv = DB::table('search_events')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $srchRevenue = (float) (clone $srchEv)->where('type', 'conversion')->sum('value');
        $srchOrders = (int) (clone $srchEv)->where('type', 'conversion')->count();
        $srchQueries = DB::table('search_queries')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $srchTotal = (int) (clone $srchQueries)->count();
        $srchZero = (int) (clone $srchQueries)->where('has_results', false)->count();

        $wheel = DB::table('wheel_spins')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $wheelSpins = (int) (clone $wheel)->count();
        $wheelRedeemed = (int) (clone $wheel)->whereNotNull('redeemed_at')->count();

        $chatSessions = (int) DB::table('chat_sessions')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since)->count();

        $fyEv = DB::table('foryou_events')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $fyRevenue = (float) (clone $fyEv)->where('type', 'conversion')->sum('value_num');
        $fyOrders = (int) (clone $fyEv)->where('type', 'conversion')->distinct()->count('platform_order_id');
        $fyOpens = (int) (clone $fyEv)->where('type', 'open')->count();

        $wcEv = DB::table('welcome_events')->where('tenant_id', $tid)->where('is_test', false)->where('created_at', '>=', $since);
        $wcOrders = (int) (clone $wcEv)->where('type', 'conversion')->count();
        $wcRevenue = (float) (clone $wcEv)->where('type', 'conversion')->sum('value_num');

        $wheelOn = DB::table('wheel_campaigns')->where('tenant_id', $tid)->where('status', 'active')->exists();

        return [
            ['key' => 'shipping_widget', 'label' => 'Bugün Kargoda sayacı', 'enabled' => $on('shipping_widget_enabled'), 'url' => '/shipping-widget', 'metric' => null],
            ['key' => 'announce_widget', 'label' => 'Kampanya Duyuruları + güven rozetleri', 'enabled' => $on('announce_widget_enabled'), 'url' => '/announce-widget', 'metric' => null],
            ['key' => 'review_widget', 'label' => 'Trendyol Yorum Widget\'ı', 'enabled' => $on('review_widget_enabled'), 'url' => '/settings/review-widget', 'metric' => null],
            ['key' => 'smart_search', 'label' => 'Akıllı Arama', 'enabled' => $on('search_widget_enabled'), 'url' => '/search-insights',
                'metric' => ['revenue' => round($srchRevenue, 2), 'orders' => $srchOrders, 'queries' => $srchTotal, 'zero_rate' => $srchTotal > 0 ? round($srchZero / $srchTotal * 100, 1) : 0]],
            ['key' => 'recommendations', 'label' => 'Sepet / Ödeme Önerisi', 'enabled' => $on('rec_cart_enabled') || $on('rec_checkout_enabled'), 'url' => '/recommendations/cart',
                'metric' => ['revenue' => round($recRevenue, 2), 'orders' => $recOrders]],
            ['key' => 'foryou', 'label' => 'Sana Özel öneri kulakçığı', 'enabled' => $on('foryou_enabled'), 'url' => '/cro/foryou',
                'metric' => ['revenue' => round($fyRevenue, 2), 'orders' => $fyOrders, 'opens' => $fyOpens]],
            ['key' => 'welcome', 'label' => 'Hoş geldin hediyesi (ilk alışveriş)', 'enabled' => $on('welcome_enabled'), 'url' => '/cro/welcome',
                'metric' => ['revenue' => round($wcRevenue, 2), 'orders' => $wcOrders]],
            ['key' => 'chatbot', 'label' => 'AI Chatbot', 'enabled' => $on('chat_widget_enabled'), 'url' => '/chatbot', 'metric' => ['sessions' => $chatSessions]],
            ['key' => 'wheel', 'label' => 'Şans Çarkı', 'enabled' => $wheelOn, 'url' => '/wheel', 'metric' => ['spins' => $wheelSpins, 'redeemed' => $wheelRedeemed]],
            ['key' => 'cart_recovery', 'label' => 'Sepet Kurtarma (WhatsApp)', 'enabled' => $on('cart_recovery_enabled'), 'url' => '/marketing/automations', 'metric' => null],
            ['key' => 'stock_alert', 'label' => 'Gelince Haber Ver', 'enabled' => $on('stock_alert_widget_enabled'), 'url' => '/crm/stock-alerts', 'metric' => null],
            ['key' => 'category_ranking', 'label' => 'Akıllı Kategori Sıralaması', 'enabled' => $on('category_ranking_enabled'), 'url' => '/category-intelligence', 'metric' => null],
        ];
    }

    /**
     * Site Araçları sayfası: her aracın açık/kapalı durumu (yalnız okuma, ayar anahtarlarından).
     * CRO ya da Pazarlama yetkisi yeter — çark/kargo/chatbot sayfaları hâlâ 'marketing' yetkisiyle açılıyor.
     */
    public function toolStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! $user->hasPermission('cro') && ! $user->hasPermission('marketing')) {
            return response()->json(['message' => 'Bu sayfa/işlem için yetkiniz bulunmuyor.'], 403);
        }
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }

        $s = $tenant->settings ?? [];
        $on = fn ($k) => filter_var($s[$k] ?? false, FILTER_VALIDATE_BOOLEAN);

        return response()->json(['status' => [
            'search' => $on('search_widget_enabled'),
            'filter' => $on('filter_widget_enabled'),
            'menu' => $on('menu_enabled'),
            'bottombar' => $on('bottombar_enabled'),
            'notfound' => $on('notfound_enabled'),
            'badges' => $on('badge_enabled'),
            'variant' => $on('variant_select_enabled'),
            'gallery' => $on('gallery_enabled'),
            'shipping' => $on('shipping_widget_enabled'),
            'cart' => $on('cart_enabled'),
            'welcome' => $on('welcome_enabled'),
            'app' => $on('apppromo_enabled'),
            'wheel' => DB::table('wheel_campaigns')->where('tenant_id', $tenant->id)->where('status', 'active')->exists(),
            'flash' => $on('flash_enabled'),
            'hero' => $on('hero_enabled'),
            'announce' => $on('announce_widget_enabled'),
            'foryou' => $on('foryou_enabled'),
            'category' => $on('category_ranking_enabled'),
        ]]);
    }

    private function actionSummary(Tenant $tenant): array
    {
        $rows = CroAction::where('tenant_id', $tenant->id)->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status');
        $top = CroAction::where('tenant_id', $tenant->id)->whereIn('status', ['idea', 'planned'])
            ->orderByRaw('(impact*confidence*ease) desc')->limit(5)->get(['id', 'title', 'status', 'impact', 'confidence', 'ease', 'feature_url', 'expected_uplift']);

        return [
            'counts' => ['idea' => (int) ($rows['idea'] ?? 0), 'planned' => (int) ($rows['planned'] ?? 0), 'running' => (int) ($rows['running'] ?? 0), 'done' => (int) ($rows['done'] ?? 0), 'discarded' => (int) ($rows['discarded'] ?? 0)],
            'top' => $top,
        ];
    }

    private function latestAuditSummary(Tenant $tenant): ?array
    {
        $last = CroAudit::where('tenant_id', $tenant->id)->latest('id')->first();
        if (! $last) {
            return null;
        }
        $pages = CroAudit::where('tenant_id', $tenant->id)->where('run_id', $last->run_id)->get(['page_type', 'score', 'url']);

        return [
            'run_id' => $last->run_id,
            'at' => $last->created_at,
            'avg_score' => (int) round($pages->avg('score')),
            'pages' => $pages->map(fn ($p) => ['page_type' => $p->page_type, 'score' => $p->score, 'url' => $p->url])->values(),
        ];
    }

    // ───────────────────────── Aksiyonlar ─────────────────────────

    public function actions(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }
        $q = CroAction::where('tenant_id', $tenant->id);
        if ($st = $request->query('status')) {
            $q->where('status', $st);
        }
        $items = $q->orderByRaw("case status when 'running' then 0 when 'planned' then 1 when 'idea' then 2 when 'done' then 3 else 4 end")
            ->orderByRaw('(impact*confidence*ease) desc')->orderBy('sort_order')->get();

        return response()->json(['data' => $items, 'catalog_size' => count(CroActionCatalog::items())]);
    }

    public function storeAction(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }
        $data = $this->validateAction($request);
        $action = CroAction::create($data + ['tenant_id' => $tenant->id, 'created_by' => $request->user()->id]);

        return response()->json(['data' => $action], 201);
    }

    public function updateAction(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        $action = CroAction::where('tenant_id', $tenant?->id)->findOrFail($id);
        $data = $this->validateAction($request, true);

        // Durum geçişlerinde tarih damgaları
        if (isset($data['status']) && $data['status'] !== $action->status) {
            if ($data['status'] === 'running' && ! $action->started_at) {
                $data['started_at'] = now();
            }
            if (in_array($data['status'], ['done', 'discarded'], true) && ! $action->finished_at) {
                $data['finished_at'] = now();
            }
        }
        $action->update($data);

        return response()->json(['data' => $action->fresh()]);
    }

    public function destroyAction(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        CroAction::where('tenant_id', $tenant?->id)->findOrFail($id)->delete();

        return response()->json(['ok' => true]);
    }

    public function seedActions(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }
        $added = CroActionCatalog::seed($tenant, $request->user()->id);

        return response()->json(['added' => $added]);
    }

    private function validateAction(Request $request, bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'title' => [$req, 'string', 'max:160'],
            'category' => ['sometimes', 'string', 'in:'.implode(',', CroAction::CATEGORIES)],
            'surface' => ['nullable', 'string', 'max:80'],
            'hypothesis' => ['nullable', 'string', 'max:2000'],
            'description' => ['nullable', 'string', 'max:5000'],
            'status' => ['sometimes', 'string', 'in:'.implode(',', CroAction::STATUSES)],
            'impact' => ['sometimes', 'integer', 'between:1,5'],
            'confidence' => ['sometimes', 'integer', 'between:1,5'],
            'ease' => ['sometimes', 'integer', 'between:1,5'],
            'expected_uplift' => ['nullable', 'string', 'max:80'],
            'feature' => ['nullable', 'string', 'max:48'],
            'feature_url' => ['nullable', 'string', 'max:160', 'regex:#^/#'],
            'result' => ['nullable', 'string', 'max:5000'],
            'result_uplift' => ['nullable', 'numeric', 'between:-100,1000'],
        ]);
    }

    // ───────────────────────── Denetim ─────────────────────────

    public function audits(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }
        $last = CroAudit::where('tenant_id', $tenant->id)->latest('id')->first();
        $pages = $last ? CroAudit::where('tenant_id', $tenant->id)->where('run_id', $last->run_id)->orderBy('id')->get() : collect();

        // Geçmiş koşular: run başına ortalama puan (trend grafiği)
        $history = CroAudit::where('tenant_id', $tenant->id)
            ->selectRaw('run_id, min(created_at) as at, round(avg(score)) as avg_score, count(*) as pages')
            ->groupBy('run_id')->orderByDesc('at')->limit(20)->get();

        return response()->json(['run' => $last ? ['run_id' => $last->run_id, 'at' => $last->created_at] : null, 'pages' => $pages, 'history' => $history]);
    }

    public function runAudit(Request $request, CroAuditService $service): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant yok'], 422);
        }
        $lock = Cache::lock('cro:audit:'.$tenant->id, 120);
        if (! $lock->get()) {
            return response()->json(['message' => 'Denetim zaten çalışıyor, biraz bekleyin.'], 429);
        }
        try {
            $result = $service->run($tenant);
        } finally {
            $lock->release();
        }

        return response()->json($result);
    }
}
