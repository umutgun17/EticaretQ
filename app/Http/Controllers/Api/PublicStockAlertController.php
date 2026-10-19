<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Product;
use App\Models\StockAlert;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Gelince haber ver" — mağazaya gömülen buton bu ucu çağırır.
 * Tenant slug'la çözülür (diğer widget'larla aynı desen); e-posta veya
 * telefon zorunlu; aynı kişi×ürün için tek aktif kayıt (tekrar POST no-op).
 */
class PublicStockAlertController extends Controller
{
    /** Widget açılış konfigi: aktif mi + tema buton seçicisi. */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        $settings = $tenant->settings ?? [];

        return response()->json([
            'enabled' => (bool) ($tenant && filter_var($settings['stock_alert_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)),
            'selector' => (string) ($settings['stock_alert_selector'] ?? ''),
        ]);
    }

    /**
     * Sayfadan toplanan ipuçlarıyla (sku / barkod / ürün yolu) platform
     * ürün kimliğini çözer — tema hiçbir ID vermek zorunda kalmaz.
     */
    public function resolve(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['product_id' => null]);
        }

        $sku = trim((string) $request->query('sku', ''));
        $barcode = trim((string) $request->query('barcode', ''));
        $path = trim((string) $request->query('path', ''));

        $q = Product::withoutGlobalScopes()->where('tenant_id', $tenant->id);
        $product = null;

        if ($sku !== '') {
            $product = (clone $q)->where('sku', $sku)->first(['platform_product_id', 'name'])
                ?? \App\Models\ProductVariant::withoutGlobalScopes()
                    ->where('tenant_id', $tenant->id)->where('sku', $sku)
                    ->join('products', 'products.id', '=', 'product_variants.product_id')
                    ->first(['products.platform_product_id', 'products.name']);
        }
        if (! $product && $barcode !== '') {
            $product = (clone $q)->where('barcode', $barcode)->first(['platform_product_id', 'name']);
        }
        if (! $product && $path !== '') {
            $product = (clone $q)->where('url', 'like', '%' . ltrim($path, '/'))->first(['platform_product_id', 'name']);
        }

        return response()->json([
            'product_id' => $product->platform_product_id ?? null,
            'name' => $product->name ?? null,
        ]);
    }

    public function subscribe(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant || ! filter_var(($tenant->settings ?? [])['stock_alert_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['message' => 'Kapalı.'], 404);
        }

        $v = $request->validate([
            'product_id' => 'required|string|max:64',
            'email' => 'nullable|email|max:190',
            'phone' => 'nullable|string|max:32',
            'name' => 'nullable|string|max:120',
            'variant' => 'nullable|string|max:190',
        ]);

        $phone = ! empty($v['phone']) ? preg_replace('/\D/', '', $v['phone']) : null;
        $email = ! empty($v['email']) ? mb_strtolower(trim($v['email'])) : null;
        if (! $email && ! $phone) {
            return response()->json(['message' => 'E-posta veya telefon gerekli.'], 422);
        }

        $product = Product::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('platform_product_id', $v['product_id'])
            ->first(['id', 'channel_id', 'stock_quantity']);

        // Üye eşleşmesi (varsa) — panelde "kim bekliyor" bağlamı için
        $customerId = null;
        if ($email || $phone) {
            $customerId = Customer::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->when($email, fn ($q) => $q->where('email', $email))
                ->when(! $email && $phone, fn ($q) => $q->whereRaw("RIGHT(REGEXP_REPLACE(phone,'\\D','','g'),10) = ?", [substr($phone, -10)]))
                ->value('id');
        }

        $existing = StockAlert::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('platform_product_id', $v['product_id'])
            ->where('status', 'active')
            ->where(function ($q) use ($email, $phone) {
                if ($email) {
                    $q->orWhere('email', $email);
                }
                if ($phone) {
                    $q->orWhere('phone', $phone);
                }
            })
            ->exists();

        if (! $existing) {
            StockAlert::withoutGlobalScopes()->create([
                'tenant_id' => $tenant->id,
                'channel_id' => $product?->channel_id,
                'product_id' => $product?->id,
                'customer_id' => $customerId,
                'platform_product_id' => $v['product_id'],
                'variant_label' => $v['variant'] ?? null,
                'name' => $v['name'] ?? null,
                'email' => $email,
                'phone' => $phone,
                'status' => 'active',
            ]);
        }

        return response()->json(['ok' => true, 'message' => 'Ürün stoğa girdiğinde size haber vereceğiz.']);
    }
}
