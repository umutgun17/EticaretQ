<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StockAlert;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** "Gelince haber ver" panel listesi — ürün bazında özet + kişi listesi. */
class StockAlertController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        // Ürün bazında özet (global tenant scope aktif — auth'lu istek)
        $summary = StockAlert::query()
            ->select('platform_product_id', 'product_id')
            ->selectRaw("COUNT(*) FILTER (WHERE status = 'active') as active_count")
            ->selectRaw("COUNT(*) FILTER (WHERE status = 'notified') as notified_count")
            ->selectRaw('MAX(created_at) as last_request_at')
            ->groupBy('platform_product_id', 'product_id')
            ->orderByDesc(DB::raw("COUNT(*) FILTER (WHERE status = 'active')"))
            ->with([])
            ->limit(500)
            ->get();

        $products = \App\Models\Product::whereIn('id', $summary->pluck('product_id')->filter())
            ->get(['id', 'name', 'images', 'stock_quantity'])->keyBy('id');

        $rows = $summary->map(fn ($r) => [
            'platform_product_id' => $r->platform_product_id,
            'product_id' => $r->product_id,
            'product_name' => $products[$r->product_id]->name ?? $r->platform_product_id,
            'image' => $products[$r->product_id]->images[0] ?? null,
            'stock_quantity' => $products[$r->product_id]->stock_quantity ?? null,
            'active_count' => (int) $r->active_count,
            'notified_count' => (int) $r->notified_count,
            'last_request_at' => $r->last_request_at,
        ]);

        return response()->json($rows);
    }

    public function show(Request $request, string $platformProductId): JsonResponse
    {
        $alerts = StockAlert::query()
            ->where('platform_product_id', $platformProductId)
            ->with('customer:id,name,surname,email,phone')
            ->orderByDesc('created_at')
            ->limit(500)
            ->get(['id', 'customer_id', 'name', 'email', 'phone', 'variant_label', 'status', 'notified_at', 'created_at']);

        return response()->json($alerts);
    }
}
