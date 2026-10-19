<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MarketingEmailTemplate;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Pazarlama e-posta şablonları — panel CRUD (GrapesJS düzenleyici).
 * permission:settings ile korunur. Tenant X-Tenant-Id / user->tenant ile çözülür.
 */
class MarketingEmailTemplateController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $templates = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderBy('category')
            ->orderBy('name')
            ->get(['id', 'key', 'name', 'category', 'subject', 'preheader', 'is_active', 'is_system', 'variables', 'updated_at']);

        return response()->json(['templates' => $templates]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $template = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($id);

        return response()->json(['template' => $template]);
    }

    public function store(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $this->validateData($request);

        // key benzersizliği (tenant içinde)
        $exists = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('key', $data['key'])
            ->exists();
        if ($exists) {
            return response()->json(['message' => 'Bu anahtar (key) zaten kullanımda.'], 422);
        }

        $template = new MarketingEmailTemplate($data);
        $template->tenant_id = $tenant->id;
        $template->is_system = false;
        $template->save();

        return response()->json(['template' => $template], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $template = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($id);

        // key değiştirilemez (otomasyon bağı korunur)
        $data = $this->validateData($request, requireKey: false);
        unset($data['key']);

        $template->update($data);

        return response()->json(['template' => $template]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $template = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($id);

        // Sistem şablonları silinemez (pasifleştirilebilir)
        if ($template->is_system) {
            return response()->json(['message' => 'Sistem şablonu silinemez. Pasifleştirebilirsiniz.'], 422);
        }

        $template->delete();

        return response()->json(['deleted' => true]);
    }

    /** Şablonu örnek değişkenlerle render edip önizleme HTML'i döner. */
    public function preview(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $template = MarketingEmailTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($id);

        $sample = array_merge($this->sampleVars($tenant), (array) $request->input('vars', []));
        $rendered = $template->render($sample);

        return response()->json(['preview' => $rendered]);
    }

    /** @return array<string,mixed> */
    protected function validateData(Request $request, bool $requireKey = true): array
    {
        return $request->validate([
            'key' => ($requireKey ? 'required' : 'sometimes') . '|string|max:60|regex:/^[a-z0-9_]+$/',
            'name' => 'required|string|max:255',
            'category' => 'sometimes|string|max:40',
            'subject' => 'required|string|max:255',
            'preheader' => 'nullable|string|max:255',
            'html' => 'nullable|string',
            'design' => 'nullable|array',
            'variables' => 'nullable|array',
            'is_active' => 'sometimes|boolean',
        ]);
    }

    /** @return array<string,string> */
    protected function sampleVars(Tenant $tenant): array
    {
        return [
            'customer_name' => 'Ayşe Yılmaz',
            'shop_name' => $tenant->name,
            'shop_url' => 'https://example.com',
            'cart_total' => '349,90 TL',
            'cart_url' => 'https://example.com/sepet',
            'coupon_code' => 'HOSGELDIN10',
            'order_no' => 'TB8520001',
            'order_total' => '349,90 TL',
            'order_url' => 'https://example.com/siparis',
            'cargo_company' => 'Yurtiçi Kargo',
            'tracking_url' => 'https://example.com/takip',
            'product_name' => 'Örnek Ürün',
            'product_url' => 'https://example.com/urun',
            'review_url' => 'https://example.com/degerlendir',
            'preheader' => '',
            'unsubscribe_url' => 'https://example.com/abonelik-iptal',
        ];
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        $user = $request->user();
        if ($user->tenant_id) {
            return $user->tenant;
        }
        if ($request->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) $request->header('X-Tenant-Id'));
        }

        return null;
    }
}
