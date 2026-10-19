<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Returns\ShortageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * EKSİK / HATALI ÜRÜN İADESİ — personel ekranı (hub → İade Yönetimi → Eksik/Hatalı Ürün).
 *
 * Yetki: sayfa izni `returns_shortage` (Personel Yönetimi'nden temsilciye verilir; firma admini
 * otomatik). Müşteriye açık değildir.
 * Akış ve para güvenliği {@see ShortageService}'te; burada yalnız yetki + doğrulama + HTTP.
 *
 * Aynı denetleyici GERİ DÖNEN SİPARİŞ İADESİ ekranına da hizmet eder (/returns/returned/*, rota
 * varsayılanı mode=returned, sayfa izni `returns_returned`): müşteriye bildirim yok, onay sonrası Ticimax İptal.
 */
class ReturnShortageController extends Controller
{
    public function __construct(private readonly ShortageService $shortage)
    {
        ini_set('serialize_precision', '-1');
    }

    /** POST /returns/shortage/lookup  { ref: sipariş no VEYA Ticimax sipariş ID } */
    public function lookup(Request $request): JsonResponse
    {
        if ($deny = $this->guard($request)) {
            return $deny;
        }
        $data = $request->validate(['ref' => 'required|string|max:64']);
        $tenant = $this->tenant();

        $res = $this->shortage->lookup($tenant, $data['ref'], $this->mode($request));
        if (! $res['success']) {
            return response()->json(['message' => $res['error']], $res['status'] ?? 422);
        }
        unset($res['success']);

        return response()->json($res);
    }

    /** POST /returns/shortage/preview  { platform_order_id, items:[{line_id, qty}] } */
    public function preview(Request $request): JsonResponse
    {
        if ($deny = $this->guard($request)) {
            return $deny;
        }
        $data = $request->validate([
            'platform_order_id' => 'required|string|max:32',
            'items' => 'required|array|min:1',
            'items.*.line_id' => 'required|string|max:64',
            'items.*.qty' => 'required|integer|min:1|max:1000',
        ]);
        $tenant = $this->tenant();

        $fetched = $this->shortage->fetchOrder($tenant, $data['platform_order_id']);
        if (! $fetched['success']) {
            return response()->json(['message' => $fetched['error']], $fetched['status'] ?? 422);
        }
        $selections = array_map(fn ($i) => ['line_id' => (string) $i['line_id'], 'qty' => (int) $i['qty']], $data['items']);
        $pv = $this->shortage->preview($tenant, $fetched['order'], $selections, $this->mode($request));
        if (! $pv['success']) {
            return response()->json(['message' => $pv['error']], 422);
        }

        return response()->json([
            'calculation' => $pv['calc'],
            'is_full' => $pv['is_full'],
        ]);
    }

    /**
     * POST /returns/shortage
     * { platform_order_id, items:[{line_id, qty, reason_code, reason_note?}], staff_note? }
     */
    public function store(Request $request): JsonResponse
    {
        if ($deny = $this->guard($request)) {
            return $deny;
        }
        $data = $request->validate([
            'platform_order_id' => 'required|string|max:32',
            'items' => 'required|array|min:1',
            'items.*.line_id' => 'required|string|max:64',
            'items.*.qty' => 'required|integer|min:1|max:1000',
            'items.*.reason_code' => 'required|string|in:' . implode(',', ShortageService::REASON_CODES),
            'items.*.reason_note' => 'nullable|string|max:300',
            'staff_note' => 'nullable|string|max:1000',
        ], [
            'items.*.reason_code.required' => 'Her ürün için neden seçin.',
            'items.*.reason_code.in' => 'Geçersiz neden.',
        ]);
        $tenant = $this->tenant();

        $fetched = $this->shortage->fetchOrder($tenant, $data['platform_order_id']);
        if (! $fetched['success']) {
            return response()->json(['message' => $fetched['error']], $fetched['status'] ?? 422);
        }

        $res = $this->shortage->create($tenant, $request->user(), $fetched['order'], $fetched['raw'], $data['items'], $data['staff_note'] ?? null, $this->mode($request));
        if (! $res['success']) {
            return response()->json(['message' => $res['error']], $res['status'] ?? 422);
        }

        $r = $res['request'];

        return response()->json([
            'id' => $r->id,
            'public_code' => $r->public_code,
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'refund_method' => $r->refund_method?->value,
            'requested_amount' => (float) $r->requested_amount,
            'approved_amount' => (float) $r->approved_amount,
            'currency' => $r->currency,
            'is_full' => (bool) data_get($r->metadata, 'shortage.is_full', false),
            'stage' => data_get($r->metadata, 'shortage.stage'),
            'ticimax' => $res['ticimax'],
            'settled' => $res['settled'],
            'message' => data_get($r->metadata, 'shortage.stage') === ShortageService::STAGE_RETURNED
                ? ($r->refund_method?->value === 'none'
                    ? 'Geri dönen sipariş kaydı oluşturuldu. Kapıda ödemeli sipariş — tahsilat yapılmadığı için para iadesi yok; müşteriye bildirim gönderilmedi.'
                    : 'Geri dönen sipariş kaydı oluşturuldu ve yönetici para onayı kuyruğuna düştü. Onay verilince para iadesi yapılır ve (tam kapsamda) Ticimax sipariş statüsü İptal olur. Müşteriye hiçbir bildirim gönderilmez.')
                : ($r->refund_method?->value === 'none'
                ? 'Talep oluşturuldu. Kapıda ödemeli sipariş — karta iade yok; müşteriye özür SMS\'i ve kupon gönderildi.'
                : (data_get($r->metadata, 'shortage.stage') === ShortageService::STAGE_DELIVERED
                    ? 'Talep oluşturuldu ve yönetici para onayı kuyruğuna düştü. Onay verilince para iadesi yapılır, müşteriye genel özür SMS\'i ve telafi kuponu gider. Ticimax\'ta güncelleme yapılmadı.'
                    : 'Talep oluşturuldu ve yönetici para onayı kuyruğuna düştü. Onay verilince para iadesi yapılır, müşteriye özür SMS\'i ve kupon gider.')),
        ], 201);
    }

    private function guard(Request $request): ?JsonResponse
    {
        $user = $request->user();
        $returned = $this->mode($request) === ShortageService::STAGE_RETURNED;
        if (! $user || ! $user->hasPermission($returned ? 'returns_returned' : 'returns_shortage')) {
            return response()->json(['message' => 'Bu ekran için yetkiniz yok (Personel Yönetimi → İade → ' . ($returned ? 'Geri Dönen Sipariş İadesi' : 'Eksik / Hatalı Ürün İadesi') . ').'], 403);
        }
        if (! $this->tenant()) {
            return response()->json(['message' => 'Firma belirlenemedi.'], 422);
        }

        return null;
    }

    /** Rota varsayılanı: /returns/returned/* → 'returned'; /returns/shortage/* → null (sipariş durumundan otomatik). */
    private function mode(Request $request): ?string
    {
        return $request->route('mode') === ShortageService::STAGE_RETURNED ? ShortageService::STAGE_RETURNED : null;
    }

    private function tenant(): ?Tenant
    {
        $user = auth()->user();
        if ($user?->tenant_id) {
            return $user->tenant;
        }
        if (request()->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) request()->header('X-Tenant-Id'));
        }

        return null;
    }
}
