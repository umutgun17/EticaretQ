<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Services\TrendyolCompareService;
use App\Services\TrendyolService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Trendyol Kiyas: site katalogu vs Trendyol Seller API katalogu.
 * Eski /price-comparison ucu (yalniz Apify fiyati) korunur; bu uc onun genislemesidir.
 */
class TrendyolCompareController extends Controller
{
    public function stats(): JsonResponse
    {
        $tenantId = $this->resolveTenantId();
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant secilmedi.'], 422);
        }

        return response()->json((new TrendyolCompareService($tenantId))->stats());
    }

    public function index(Request $request): JsonResponse
    {
        $tenantId = $this->resolveTenantId();
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant secilmedi.'], 422);
        }

        $view = in_array($request->view, TrendyolCompareService::VIEWS, true) ? $request->view : 'all';
        $perPage = min((int) ($request->per_page ?? 25), 100);

        $q = $this->buildQuery($tenantId, $view, $request);

        return response()->json($q->paginate($perPage));
    }

    /** CSV disa aktarim (secili goruntu, en fazla 10.000 satir). */
    public function export(Request $request): StreamedResponse|JsonResponse
    {
        $tenantId = $this->resolveTenantId();
        if (! $tenantId) {
            return response()->json(['message' => 'Tenant secilmedi.'], 422);
        }

        $view = in_array($request->view, TrendyolCompareService::VIEWS, true) ? $request->view : 'all';
        $rows = $this->buildQuery($tenantId, $view, $request)->limit(10000)->get();
        $file = 'trendyol-kiyas-' . $view . '-' . now()->format('Ymd-Hi') . '.csv';

        return response()->streamDownload(function () use ($rows, $view) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // Excel UTF-8 BOM
            $cols = match ($view) {
                'missing_on_site' => ['ty_main_id', 'ty_color', 'ty_title', 'ty_brand', 'ty_category', 'ty_sizes', 'ty_barcodes', 'ty_stock_code', 'ty_variant_count', 'ty_quantity', 'ty_seller_price', 'ty_list_price', 'ty_image_count', 'ty_approved', 'ty_on_sale', 'ty_campaign', 'ty_url'],
                'missing_on_trendyol' => ['id', 'sku', 'barcode', 'name', 'brand', 'category', 'site_price', 'site_stock', 'site_variant_count', 'site_in_stock_variants', 'site_image_count', 'site_trendyol_flag', 'site_url', 'ty_url'],
                'match_conflict' => ['ty_main_id', 'ty_stock_codes', 'ty_barcodes', 'ty_title', 'ty_variant_count', 'ty_quantity', 'ty_seller_price', 'ty_url', 'id', 'sku', 'name', 'site_price', 'site_stock', 'site_url', 'barcode_product_id', 'barcode_sku', 'barcode_name', 'barcode_site_price', 'barcode_site_stock', 'barcode_site_url'],
                default => ['id', 'sku', 'barcode', 'name', 'ty_title', 'ty_main_id', 'site_price', 'ty_price', 'ty_price_source', 'ty_seller_price', 'ty_buyer_price', 'ty_list_price', 'price_diff', 'price_diff_pct', 'ty_campaign', 'site_stock', 'ty_quantity', 'site_variant_count', 'ty_variant_count', 'ty_unmatched_variants', 'site_image_count', 'ty_image_count', 'image_diff', 'site_description_length', 'ty_description_length', 'title_differs', 'ty_rating', 'ty_stock_code', 'ty_stock_verified', 'ty_conflicts', 'site_url', 'ty_url'],
            };
            fputcsv($out, $cols, ';');
            foreach ($rows as $r) {
                $line = [];
                foreach ($cols as $c) {
                    $v = $r->{$c} ?? null;
                    if (is_bool($v)) {
                        $v = $v ? 'Evet' : 'Hayir';
                    }
                    $line[] = is_scalar($v) || $v === null ? $v : json_encode($v, JSON_UNESCAPED_UNICODE);
                }
                fputcsv($out, $line, ';');
            }
            fclose($out);
        }, $file, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Kanal anahtarinin urun API'sine erisimi var mi? (401 → ayarlar sayfasina yonlendir) */
    public function probe(): JsonResponse
    {
        $tenantId = $this->resolveTenantId();
        $channel = Channel::withoutGlobalScopes()->where('tenant_id', $tenantId)->where('type', 'trendyol-product')->first();
        if (! $channel) {
            return response()->json(['ok' => false, 'reason' => 'no_channel']);
        }
        $svc = TrendyolService::fromChannelForProducts($channel);
        if (! $svc->isAvailable()) {
            return response()->json(['ok' => false, 'reason' => 'no_credentials']);
        }
        $p = $svc->probeProductAccess();

        return response()->json([
            'ok' => $p['ok'],
            'key' => $svc->usesProductKey ? 'product' : 'main',
            'reason' => $p['ok'] ? null : ($p['status'] === 401 ? 'no_product_permission' : 'api_error'),
            'status' => $p['status'],
            'message' => $p['message'],
            'total' => $p['total'],
        ]);
    }

    /** Katalog senkronunu kuyrukta baslatir (trendyol:sync-catalog --tenant=X). */
    public function sync(Request $request): JsonResponse
    {
        $tenantId = $this->resolveTenantId();
        $channel = Channel::withoutGlobalScopes()->where('tenant_id', $tenantId)->where('type', 'trendyol-product')->first();
        if (! $channel) {
            return response()->json(['message' => 'Trendyol kanali yok.'], 422);
        }

        $settings = $channel->settings ?? [];
        if (is_string($settings)) {
            $settings = json_decode($settings, true) ?? [];
        }
        $startedAt = isset($settings['catalog_sync_started_at']) ? strtotime($settings['catalog_sync_started_at']) : 0;
        if (! empty($settings['catalog_sync_running']) && $startedAt > time() - 1800) {
            return response()->json(['message' => 'Senkron zaten calisiyor.', 'running' => true], 409);
        }

        $channel->settings = array_merge($settings, ['catalog_sync_running' => true, 'catalog_sync_started_at' => now()->toIso8601String()]);
        $channel->saveQuietly();

        $withPrices = $request->boolean('with_prices');
        $cid = $channel->id;
        dispatch(function () use ($tenantId, $cid, $withPrices) {
            try {
                Artisan::call('trendyol:sync-catalog', ['--tenant' => $tenantId]);
                if ($withPrices) {
                    Artisan::call('trendyol:sync-prices', ['--batch' => 20]);
                }
            } finally {
                $ch = Channel::withoutGlobalScopes()->find($cid);
                if ($ch) {
                    $s = $ch->settings ?? [];
                    if (is_string($s)) {
                        $s = json_decode($s, true) ?? [];
                    }
                    $ch->settings = array_merge($s, ['catalog_sync_running' => false]);
                    $ch->saveQuietly();
                }
            }
        })->onQueue('default');

        return response()->json(['message' => 'Senkron baslatildi.', 'running' => true]);
    }

    protected function buildQuery(int $tenantId, string $view, Request $request)
    {
        $svc = new TrendyolCompareService($tenantId);
        $search = $request->filled('search') ? (string) $request->search : null;
        $dir = $request->sort_dir === 'asc' ? 'asc' : 'desc';

        if ($view === 'missing_on_site') {
            $q = $svc->missingOnSiteQuery();
            if ($request->boolean('in_stock_only', true)) {
                $q->havingRaw('coalesce(sum(quantity),0) > 0');
            }
            if ($search) {
                $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
                $q->where(fn ($w) => $w->where('title', 'ilike', $like)->orWhere('product_main_id', 'ilike', $like)->orWhere('stock_code', 'ilike', $like)->orWhere('barcode', $search));
            }
            $sort = in_array($request->sort_by, ['ty_quantity', 'ty_seller_price', 'ty_updated_at', 'ty_variant_count'], true) ? $request->sort_by : 'ty_quantity';

            return $q->orderByRaw("{$sort} {$dir} NULLS LAST");
        }

        if ($view === 'match_conflict') {
            $q = $svc->matchConflictQuery();
            if ($search) {
                $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
                $q->where(fn ($w) => $w->where('sp.name', 'ilike', $like)->orWhere('bp.name', 'ilike', $like)->orWhere('sp.sku', 'ilike', $like)->orWhere('bp.sku', 'ilike', $like)->orWhere('t.stock_code', 'ilike', $like)->orWhere('t.barcode', $search));
            }
            $sort = in_array($request->sort_by, ['ty_variant_count', 'ty_quantity', 'site_price'], true) ? $request->sort_by : 'ty_variant_count';

            return DB::query()->fromSub($q, 'x')->orderByRaw("{$sort} {$dir} NULLS LAST")->orderBy('id');
        }

        if ($view === 'missing_on_trendyol') {
            $q = $svc->missingOnTrendyolQuery();
            if ($request->boolean('in_stock_only', true)) {
                $q->where('p.stock_quantity', '>', 0);
            }
            if ($search) {
                $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
                $q->where(fn ($w) => $w->where('p.name', 'ilike', $like)->orWhere('p.sku', 'ilike', $like)->orWhere('p.barcode', $search));
            }
            $sort = in_array($request->sort_by, ['site_stock', 'site_price', 'platform_created_at'], true) ? $request->sort_by : 'site_stock';

            return $q->orderByRaw("{$sort} {$dir} NULLS LAST");
        }

        $q = $svc->applyView($svc->matchedQuery(), $view);
        $svc->applySearch($q, $search);
        if ($request->boolean('in_stock_only')) {
            $q->where('ty.ty_quantity', '>', 0);
        }
        if ($request->boolean('campaign_only')) {
            $q->where('ty.ty_campaign', true);
        }

        $sortable = ['price_diff', 'price_diff_pct', 'image_diff', 'variant_diff', 'ty_quantity', 'site_stock', 'ty_price', 'site_price', 'ty_updated_at', 'name'];
        $sort = in_array($request->sort_by, $sortable, true) ? $request->sort_by : match ($view) {
            'fewer_images_on_site', 'fewer_images_on_trendyol' => 'image_diff',
            'variant_diff' => 'variant_diff',
            'stock_diff' => 'ty_quantity',
            default => 'price_diff',
        };
        if ($view === 'fewer_images_on_trendyol' && ! $request->filled('sort_dir')) {
            $dir = 'asc';
        }
        if ($view === 'cheaper_on_site' && ! $request->filled('sort_dir')) {
            $dir = 'asc';
        }

        // Turetilmis sutunlar select'te alias oldugu icin dis sorguya sarariz
        return DB::query()->fromSub($q, 'x')->orderByRaw("{$sort} {$dir} NULLS LAST")->orderBy('id');
    }

    protected function resolveTenantId(): ?int
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return (int) $user->tenant_id;
        }
        if (request()->hasHeader('X-Tenant-Id')) {
            return (int) request()->header('X-Tenant-Id');
        }

        return null;
    }
}
