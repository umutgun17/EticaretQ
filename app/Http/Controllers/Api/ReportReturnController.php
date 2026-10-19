<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportReturnController extends Controller
{
    // status=13 = İade Ödemesi Yapıldı
    private const RETURN_STATUS = 13;

    public function stats(Request $request): JsonResponse
    {
        $paidBase = Order::where('payment_status', 1);
        $paidBase = $this->applyPeriod($paidBase, $request->period, 'order_date');

        $totalOrders = (clone $paidBase)->count();
        $totalReturns = (clone $paidBase)->where('status', self::RETURN_STATUS)->count();
        $revenueLost = (clone $paidBase)->where('status', self::RETURN_STATUS)->sum('total_amount');

        $returnRate = $totalOrders > 0 ? round(($totalReturns / $totalOrders) * 100, 2) : 0;

        // Item-level stats
        $itemBase = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->where('orders.payment_status', 1)
            ->where('orders.tenant_id', DB::raw('order_items.tenant_id'));
        $itemBase = $this->applyPeriod($itemBase, $request->period, 'orders.order_date');

        $itemStats = (clone $itemBase)
            ->selectRaw("
                SUM(CASE WHEN order_items.status_label ILIKE '%iade edildi%' THEN order_items.quantity ELSE 0 END) as returned_items,
                SUM(CASE WHEN order_items.status_label ILIKE '%iade talebi%' THEN order_items.quantity ELSE 0 END) as pending_items,
                SUM(CASE WHEN order_items.status_label ILIKE '%iptal%' THEN order_items.quantity ELSE 0 END) as cancelled_items
            ")
            ->first();

        return response()->json([
            'total_orders' => $totalOrders,
            'total_returns' => $totalReturns,
            'return_rate_pct' => $returnRate,
            'revenue_lost' => round((float) $revenueLost, 2),
            'returned_items' => (int) ($itemStats->returned_items ?? 0),
            'pending_items' => (int) ($itemStats->pending_items ?? 0),
            'cancelled_items' => (int) ($itemStats->cancelled_items ?? 0),
        ]);
    }

    public function topProducts(Request $request): JsonResponse
    {
        $limit = min((int) ($request->limit ?? 20), 50);
        $minSales = (int) ($request->min_sales ?? 10);
        $sort = $request->sort === 'rate' ? 'return_rate_pct' : 'return_item_count';

        $query = DB::table('order_items')
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->where('orders.payment_status', 1)
            ->where('order_items.tenant_id', DB::raw('orders.tenant_id'))
            ->whereNotNull('order_items.product_name');

        // DB::table global tenant scope'tan geçmez; trait ile aynı çözümleme:
        // normal kullanıcı kendi tenant'ı, süper admin X-Tenant-Id (yoksa tümü).
        $tenantId = $request->user()->tenant_id
            ?: ($request->hasHeader('X-Tenant-Id') ? (int) $request->header('X-Tenant-Id') : null);
        if ($tenantId) {
            $query->where('order_items.tenant_id', $tenantId);
        }

        $query
            ->select(
                'order_items.platform_product_id',
                DB::raw("MAX(order_items.product_name) as product_name"),
                DB::raw("MAX(order_items.image_url) as image_url"),
                DB::raw("MAX(order_items.product_id) as product_id"),
                DB::raw("SUM(order_items.quantity) as total_item_count"),
                DB::raw("SUM(CASE WHEN orders.status = " . self::RETURN_STATUS . " THEN order_items.quantity ELSE 0 END) as return_item_count"),
                DB::raw("SUM(CASE WHEN orders.status = " . self::RETURN_STATUS . " THEN order_items.total_price ELSE 0 END) as return_revenue"),
            )
            ->groupBy('order_items.platform_product_id');

        $this->applyPeriodRaw($query, $request->period, 'orders.order_date');

        $query->havingRaw("SUM(order_items.quantity) >= ?", [$minSales])
            ->havingRaw("SUM(CASE WHEN orders.status = " . self::RETURN_STATUS . " THEN order_items.quantity ELSE 0 END) > 0");

        $products = $query->get()->map(function ($row) {
            $row->return_rate_pct = $row->total_item_count > 0
                ? round(($row->return_item_count / $row->total_item_count) * 100, 2)
                : 0;
            $row->return_revenue = round((float) $row->return_revenue, 2);

            return $row;
        });

        // Sort
        $products = $products->sortByDesc($sort)->values()->take($limit);

        return response()->json($products);
    }

    public function trend(Request $request): JsonResponse
    {
        $months = min((int) ($request->months ?? 12), 24);

        $trend = Order::where('payment_status', 1)
            ->where('status', self::RETURN_STATUS)
            ->where('order_date', '>=', now()->subMonths($months))
            ->selectRaw("TO_CHAR(order_date, 'YYYY-MM') as month")
            ->selectRaw('count(*) as total_returns')
            ->selectRaw('SUM(total_amount) as revenue_lost')
            ->groupByRaw("TO_CHAR(order_date, 'YYYY-MM')")
            ->orderBy('month')
            ->get()
            ->map(fn ($row) => [
                'month' => $row->month,
                'total_returns' => $row->total_returns,
                'revenue_lost' => round((float) $row->revenue_lost, 2),
            ]);

        return response()->json($trend);
    }

    public function bySource(Request $request): JsonResponse
    {
        $base = Order::where('payment_status', 1)
            ->whereNotNull('order_source')
            ->where('order_source', '!=', '');
        $base = $this->applyPeriod($base, $request->period, 'order_date');

        $sources = (clone $base)
            ->select('order_source')
            ->selectRaw('count(*) as total_count')
            ->selectRaw("SUM(CASE WHEN status = " . self::RETURN_STATUS . " THEN 1 ELSE 0 END) as return_count")
            ->selectRaw("SUM(CASE WHEN status = " . self::RETURN_STATUS . " THEN total_amount ELSE 0 END) as return_revenue")
            ->groupBy('order_source')
            ->orderByDesc('total_count')
            ->get()
            ->map(fn ($row) => [
                'order_source' => $row->order_source,
                'total_count' => $row->total_count,
                'return_count' => $row->return_count,
                'return_rate_pct' => $row->total_count > 0 ? round(($row->return_count / $row->total_count) * 100, 2) : 0,
                'return_revenue' => round((float) $row->return_revenue, 2),
            ]);

        return response()->json($sources);
    }

    private function applyPeriod($query, ?string $period, string $column = 'order_date')
    {
        $days = $this->periodDays($period);
        if ($days) {
            $query->where($column, '>=', now()->subDays($days));
        }

        return $query;
    }

    private function applyPeriodRaw($query, ?string $period, string $column = 'order_date'): void
    {
        $days = $this->periodDays($period);
        if ($days) {
            $query->where($column, '>=', now()->subDays($days));
        }
    }

    private function periodDays(?string $period): ?int
    {
        return match ($period) {
            '7d' => 7,
            '30d' => 30,
            '90d' => 90,
            '180d' => 180,
            '365d' => 365,
            default => null,
        };
    }
}
