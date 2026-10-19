<?php

namespace App\Http\Controllers\Api;

use App\Enums\RefundMethod;
use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Models\ReturnAttachment;
use App\Models\ReturnRequest;
use App\Models\Tenant;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnErpProcessor;
use App\Services\Returns\ReturnNotifier;
use App\Services\Returns\ReturnRulesService;
use App\Services\Returns\RefundService;
use App\Services\Returns\CargoProviderFactory;
use App\Services\Returns\TicimaxOrderNormalizer;
use App\Services\TicimaxService;
use App\Support\CargoTracking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Personel/Yönetici İade Yönetim Paneli (Faz 3). Auth + permission:returns.
 *
 * Güvenlik ilkeleri:
 *  - Tüm sorgular tenant global-scope ile otomatik filtrelenir (BelongsToTenant).
 *  - Durum geçişleri YALNIZCA ReturnStatus state machine üzerinden (canTransitionTo).
 *  - Onay modeli: ERP/statü işlemleri OTOMATİK yürür; YÖNETİCİ onayı yalnızca PARA gate'idir.
 *    İptal ERP'si müşteri submit anında (PublicReturnController), iade Ticimax 'Iade' personel onayında.
 *  - Çift onay + GÖREV AYRILIĞI (iade): aynı talebi onaylayan personel ile yönetici aynı kişi olamaz.
 *  - Tutar asla artırılamaz: approved_amount ∈ [0, requested_amount] ve ödenen tavanını aşamaz.
 *  - Para iadesini TETİKLEME (ManagerApproved → Refunding/Refunded) burada YOK → Faz 4.
 *  - Her işlem append-only audit log'a (ReturnRequestEvent) yazılır.
 */
class ReturnController extends Controller
{
    public function __construct(
        private readonly ReturnRulesService $rules,
        private readonly ReturnAuditLogger $audit,
        private readonly ReturnNotifier $notifier,
        private readonly ReturnErpProcessor $erp,
        private readonly RefundService $refundService,
        private readonly TicimaxOrderNormalizer $normalizer,
        private readonly \App\Services\Returns\Payment\CodDetector $cod,
    ) {
        // Para alanları JSON'da temiz (en kısa) gösterilsin (sunucu serialize_precision=100).
        ini_set('serialize_precision', '-1');
    }

    /** Onay bekleyen (panelde aksiyon gerektiren) durumlar. Processing = iptal ERP'si işlendi, yönetici para onayı bekliyor. */
    private const ACTIONABLE = [
        ReturnStatus::Pending->value,
        ReturnStatus::AwaitingShipment->value,
        ReturnStatus::InTransit->value,
        ReturnStatus::Received->value,
        ReturnStatus::StaffApproved->value,
        ReturnStatus::Processing->value,
        ReturnStatus::Refunding->value,
        ReturnStatus::DefectReview->value,
    ];

    /**
     * KAPIDA ÖDEME (COD) SQL ayracı — listRow()'daki `is_cod` mantığının birebir SQL karşılığı.
     * Filtre ile satırdaki rozet asla ayrışmasın diye tek yerde tutulur.
     */
    private const SQL_IS_COD = "((metadata->'cod'->>'is_cod')::boolean is true or refund_method in ('bank_transfer','none'))";

    /**
     * ÖDENECEK kuyruğu (kullanıcı kararı 2026-09-04): para onayı bekleyenler de buraya dâhildir.
     * Muhasebe havaleyi yapar, kapanış aynı ekrandan verilir — staff_approved satırda önce yönetici
     * para onayı, ardından havale kapanışı ARDIŞIK çalışır (ikisi de mevcut tekil uçlardan).
     */
    private const PAYOUT_PAYABLE = [
        ReturnStatus::StaffApproved->value,
        ReturnStatus::ManagerApproved->value,
        ReturnStatus::Refunding->value,
    ];

    /** Henüz ödeme kuyruğuna girmemiş, kargo/inceleme sürecindeki kapıda ödeme talepleri. */
    private const PAYOUT_PIPELINE = [
        ReturnStatus::Pending->value,
        ReturnStatus::AwaitingShipment->value,
        ReturnStatus::InTransit->value,
        ReturnStatus::Received->value,
        ReturnStatus::DefectReview->value,
    ];

    /** Havalesi tamamlanmış (kapanmış) talepler. */
    private const PAYOUT_PAID = [
        ReturnStatus::Refunded->value,
        ReturnStatus::Completed->value,
    ];

    /** Havale hesabı (IBAN) girilmemiş talepler — muhasebeye eksik satır gitmesin diye ayrıca sayılır. */
    private const SQL_NO_IBAN = "coalesce(metadata->'bank_account'->>'iban','') = ''";

    /** Henüz muhasebeye iletildi damgası almamış talepler. */
    private const SQL_NOT_SENT_TO_ACCOUNTING = "coalesce(metadata->'accounting'->>'sent_at','') = ''";

    /** Havale listesi ekranda en fazla bu kadar satır gösterir (CSV'de sınır yok). */
    private const PAYOUT_MAX = 500;


    /** transition ucu ile izin verilen hedefler (onay/red/para iadesi AYRI uçlarda). */
    private const TRANSITION_TARGETS = [
        ReturnStatus::AwaitingShipment->value,
        ReturnStatus::InTransit->value,
        ReturnStatus::Received->value,
    ];

    // ───────────────────────── LİSTE ─────────────────────────

    public function index(Request $request): JsonResponse
    {
        $rules = $this->resolveRules();
        $reviewHours = (int) $rules['manager_review_hours'];
        $staffHours = (int) ($rules['staff_review_hours'] ?? 48);

        // Liste satırları Trendyol tarzı zengin görünüm için kalem + görsel + personel notu taşır.
        $query = ReturnRequest::query()->withCount('items')->with(['items', 'attachments', 'staffNotes.actor:id,name', 'creator:id,name']);

        // Durum filtresi: tekil değer ya da mantıksal grup
        if ($status = $request->query('status')) {
            if ($status === 'actionable') {
                $query->whereIn('status', self::ACTIONABLE);
            } elseif ($status === 'closed') {
                $query->whereIn('status', [
                    ReturnStatus::Refunded->value, ReturnStatus::Completed->value,
                    ReturnStatus::Rejected->value, ReturnStatus::CancelledByCustomer->value,
                ]);
            } elseif ($status === 'requested') {
                // "Talep Alındı" adımı: kod verildi, kargo henüz yolda değil.
                $query->whereIn('status', [ReturnStatus::Pending->value, ReturnStatus::AwaitingShipment->value]);
            } elseif ($status === 'approved') {
                // Personel ekranı "Onaylı": personel onayı verilmiş ve sonrası.
                $query->whereIn('status', [
                    ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value,
                    ReturnStatus::Refunding->value, ReturnStatus::Refunded->value, ReturnStatus::Completed->value,
                ]);
            } elseif ($status === 'refunded_done') {
                // Yönetici ekranı "Onaylı — İade Edildi": para iadesi fiilen tamamlanmış talepler.
                // (manager_approved statüsü GEÇİCİDİR: onay anında iade koşar ve talep ya Refunded'a
                // gider ya da geri sarılır — bu yüzden ayrı "Yönetici Onaylı" sekmesi hep boştu.)
                $query->whereIn('status', [ReturnStatus::Refunded->value, ReturnStatus::Completed->value]);
            } elseif ($status === 'shortage_awaiting') {
                // Yönetici ekranı "Eksik/Hatalı Ürün": personelin başlattığı, para onayı bekleyen
                // (veya yarım kalmış) gönderilemeyen-ürün iadeleri — ayrı sekmede görünsün (kullanıcı isteği 2026-09-23).
                // Geri dönen sipariş kayıtları kendi sekmesinde (returned_awaiting) — burada sayılmaz.
                $query->where('type', ReturnType::Shortage->value)->whereIn('status', [
                    ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value,
                ])->where(fn ($q) => $q->whereNull('metadata->shortage->stage')->orWhere('metadata->shortage->stage', '!=', 'returned'));
            } elseif ($status === 'returned_awaiting') {
                // Yönetici ekranı "Geri Dönen Sipariş": firmadan çıkıp depoya geri dönen paketler için personelin
                // başlattığı, para onayı bekleyen kayıtlar (kullanıcı isteği 2026-10-05).
                $query->where('type', ReturnType::Shortage->value)->whereIn('status', [
                    ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value,
                ])->where('metadata->shortage->stage', 'returned');
            } elseif ($status === 'awaiting_manager') {
                // Yönetici ekranı: para onayı bekleyenler (iade: personel onaylı; iptal: ERP işlendi)
                // + yarım kalmış iadeler (ManagerApproved/Refunding — yönetici aksiyonu gerektirir;
                // canlı vaka #118: kısmi iyzico iadesi Refunding'de görünmez kalmıştı).
                $query->whereIn('status', [
                    ReturnStatus::StaffApproved->value, ReturnStatus::Processing->value,
                    ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value,
                ]);
            } elseif (ReturnStatus::tryFrom($status)) {
                $query->where('status', $status);
            }
        }

        if ($type = $request->query('type')) {
            if ($type === 'returned') {
                // Sözde tür: geri dönen sipariş = shortage + stage=returned.
                $query->where('type', ReturnType::Shortage->value)->where('metadata->shortage->stage', 'returned');
            } elseif ($type === 'shortage') {
                $query->where('type', $type)->where(fn ($q) => $q->whereNull('metadata->shortage->stage')->orWhere('metadata->shortage->stage', '!=', 'returned'));
            } elseif (in_array($type, ['return', 'cancel', 'defect'], true)) {
                $query->where('type', $type);
            }
        }

        // İade yöntemi filtresi (yönetici ekranı hızlı ayrımı): karta iade / indirim kuponu.
        if ($rm = $request->query('refund_method')) {
            if (in_array($rm, ['original', 'store_credit', 'bank_transfer', 'none'], true)) {
                $query->where('refund_method', $rm);
            }
        }

        // ÖDEME TÜRÜ filtresi (kullanıcı isteği 2026-09-04): siparişin ödeme şekli — iade yönteminden
        // AYRIDIR (kapıda ödemeli bir siparişte iade indirim kuponuyla da yapılabilir). Kaynak
        // metadata.cod (submit/detay anında canlı ödeme bloğundan tespit); havale/iadesiz yöntem de
        // kapıda ödemeyi ele verir. Tespiti hiç yapılmamış eski talepler İKİ tarafa da girmez.
        if ($pt = $request->query('payment_type')) {
            if ($pt === 'cod') {
                $query->whereRaw(self::SQL_IS_COD);
            } elseif ($pt === 'online') {
                $query->whereRaw('not ' . self::SQL_IS_COD . " and (jsonb_exists(metadata, 'cod') or refund_method = 'original')");
            }
        }

        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('order_no', 'ilike', $like)
                    ->orWhere('public_code', 'ilike', $like)
                    ->orWhere('customer_name', 'ilike', $like)
                    ->orWhere('customer_email', 'ilike', $like)
                    ->orWhere('customer_phone', 'ilike', $like)
                    // Paket üzerindeki kargo barkodu (Sürat KargoObjId'sinin son 11 hanesi) —
                    // depo gelen paketi barkodla arayabilsin (kullanıcı isteği 2026-08-06).
                    ->orWhere('metadata->cargo_carrier->barcode', 'ilike', $like)
                    // Store_credit iade kupon kodu (IADE-XXXXXX) — kuponun hangi müşteriye
                    // verildiği aranabilsin (kullanıcı isteği 2026-08-25).
                    ->orWhereHas('refunds', fn ($rq) => $rq->where('coupon_code', 'ilike', $like));
            });
        }

        if ($from = $request->query('from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        // Sıralama:
        //  - sla: onay süresine EN AZ kalan en üstte (sabit pencere → en eski received/staff_approved önce)
        //  - workqueue: işlem bekleyenler üstte (SLA'ya göre), işlem görmüşler EN SONDA (yeni→eski)
        //  - varsayılan: created_at (sort_dir)
        $sort = (string) $request->query('sort', '');
        if ($sort === 'sla') {
            // Sayaç tabanı: staff_approved → staff_approved_at, diğerleri → received_at.
            $query->orderByRaw(
                "COALESCE(CASE WHEN status = 'staff_approved' THEN staff_approved_at END, received_at, staff_approved_at, created_at) ASC"
            );
        } elseif ($sort === 'workqueue') {
            $actionableList = "'" . implode("','", self::ACTIONABLE) . "'";
            $query->orderByRaw(
                "CASE WHEN status IN ({$actionableList}) THEN 0 ELSE 1 END ASC, " .
                "CASE WHEN status IN ({$actionableList}) THEN EXTRACT(EPOCH FROM COALESCE(received_at, created_at)) END ASC, " .
                'created_at DESC'
            );
        } else {
            $sortDir = $request->query('sort_dir') === 'asc' ? 'asc' : 'desc';
            $query->orderBy('created_at', $sortDir);
        }

        $perPage = min((int) ($request->query('per_page', 25)), 100);

        $page = $query->paginate($perPage)->through(function (ReturnRequest $r) use ($reviewHours, $staffHours) {
            return $this->listRow($r, $reviewHours, $staffHours);
        });

        return response()->json($page);
    }

    /** Durum bazlı sayaçlar (üst kartlar/sekmeler için). */
    public function stats(): JsonResponse
    {
        $rules = $this->resolveRules();
        $reviewHours = (int) $rules['manager_review_hours'];
        $staffHours = (int) ($rules['staff_review_hours'] ?? 48);

        $byStatus = ReturnRequest::query()
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $countIn = fn (array $st) => collect($st)->sum(fn ($s) => (int) ($byStatus[$s] ?? 0));

        // SLA aşımı — iki aşamalı: depo onayı (received, received_at + staff_review_hours) +
        // para onayı (staff_approved, staff_approved_at + manager_review_hours).
        $slaBreached = ReturnRequest::query()
            ->where(function ($w) use ($reviewHours, $staffHours) {
                $w->where(fn ($q) => $q->where('status', ReturnStatus::Received->value)
                    ->whereNotNull('received_at')
                    ->where('received_at', '<', now()->subHours($staffHours)))
                    ->orWhere(fn ($q) => $q->where('status', ReturnStatus::StaffApproved->value)
                        ->whereRaw('COALESCE(staff_approved_at, received_at) < ?', [now()->subHours($reviewHours)]));
            })
            ->count();

        return response()->json([
            'total' => (int) $byStatus->sum(),
            'actionable' => $countIn(self::ACTIONABLE),
            'pending' => (int) ($byStatus[ReturnStatus::Pending->value] ?? 0),
            'processing' => (int) ($byStatus[ReturnStatus::Processing->value] ?? 0),
            'received' => (int) ($byStatus[ReturnStatus::Received->value] ?? 0),
            'staff_approved' => (int) ($byStatus[ReturnStatus::StaffApproved->value] ?? 0),
            'manager_approved' => (int) ($byStatus[ReturnStatus::ManagerApproved->value] ?? 0),
            'refunding' => $countIn([ReturnStatus::Refunding->value, ReturnStatus::Refunded->value]),
            'completed' => (int) ($byStatus[ReturnStatus::Completed->value] ?? 0),
            'rejected' => (int) ($byStatus[ReturnStatus::Rejected->value] ?? 0),
            // Sekme rozetleri — index()'teki grup filtreleriyle BİREBİR aynı kümeler.
            'in_transit' => (int) ($byStatus[ReturnStatus::InTransit->value] ?? 0),
            'requested' => $countIn([ReturnStatus::Pending->value, ReturnStatus::AwaitingShipment->value]),
            'approved_group' => $countIn([
                ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value,
                ReturnStatus::Refunding->value, ReturnStatus::Refunded->value, ReturnStatus::Completed->value,
            ]),
            'cancelled' => (int) ($byStatus[ReturnStatus::CancelledByCustomer->value] ?? 0),
            'awaiting_manager' => $countIn([
                ReturnStatus::StaffApproved->value, ReturnStatus::Processing->value,
                ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value,
            ]),
            'defect_review' => (int) ($byStatus[ReturnStatus::DefectReview->value] ?? 0),
            // Personel kaynaklı eksik/hatalı ürün iadeleri — para onayı bekleyen (sekme rozeti).
            'shortage_awaiting' => (int) ReturnRequest::query()
                ->where('type', ReturnType::Shortage->value)
                ->whereIn('status', [ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value])
                ->where(fn ($q) => $q->whereNull('metadata->shortage->stage')->orWhere('metadata->shortage->stage', '!=', 'returned'))
                ->count(),
            // Geri dönen sipariş kayıtları — para onayı bekleyen (ayrı sekme rozeti).
            'returned_awaiting' => (int) ReturnRequest::query()
                ->where('type', ReturnType::Shortage->value)
                ->whereIn('status', [ReturnStatus::StaffApproved->value, ReturnStatus::ManagerApproved->value, ReturnStatus::Refunding->value])
                ->where('metadata->shortage->stage', 'returned')
                ->count(),
            'refunded_done' => $countIn([ReturnStatus::Refunded->value, ReturnStatus::Completed->value]),
            'closed' => $countIn([
                ReturnStatus::Refunded->value, ReturnStatus::Completed->value,
                ReturnStatus::Rejected->value, ReturnStatus::CancelledByCustomer->value,
            ]),
            'sla_breached' => $slaBreached,
            'staff_review_hours' => $staffHours,
            'manager_review_hours' => $reviewHours,
        ]);
    }

    // ───────────────────────── MUTABAKAT RAPORU ─────────────────────────

    /**
     * İade/İptal mutabakat raporu (finans özeti). Tarih aralığında tür×durum bazında
     * adet + talep/onaylanan/iade tutarları. Tutarlar tenant global-scope ile otomatik filtreli.
     */
    public function report(Request $request): JsonResponse
    {
        $from = $request->query('from') ? Carbon::parse($request->query('from'))->startOfDay() : now()->subDays(30)->startOfDay();
        $to = $request->query('to') ? Carbon::parse($request->query('to'))->endOfDay() : now()->endOfDay();

        $agg = 'count(*) as cnt, coalesce(sum(requested_amount),0) as req, coalesce(sum(approved_amount),0) as apr, coalesce(sum(refunded_amount),0) as ref';

        $rows = ReturnRequest::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("type, status, {$agg}")
            ->groupBy('type', 'status')
            ->get();

        $byStatus = [];
        $byType = ['cancel' => ['count' => 0, 'approved' => 0.0, 'refunded' => 0.0], 'return' => ['count' => 0, 'approved' => 0.0, 'refunded' => 0.0]];
        $total = ['count' => 0, 'requested' => 0.0, 'approved' => 0.0, 'refunded' => 0.0];

        foreach ($rows as $r) {
            // status/type modelde enum'a cast edilir; gruplamada ham değer gerekir.
            $st = $r->status instanceof ReturnStatus ? $r->status->value : (string) $r->status;
            $ty = $r->type instanceof ReturnType ? $r->type->value : (string) $r->type;
            $byStatus[$st] ??= ['status' => $st, 'label' => (ReturnStatus::tryFrom($st)?->label() ?? $st), 'count' => 0, 'requested' => 0.0, 'approved' => 0.0, 'refunded' => 0.0];
            $byStatus[$st]['count'] += (int) $r->cnt;
            $byStatus[$st]['requested'] += (float) $r->req;
            $byStatus[$st]['approved'] += (float) $r->apr;
            $byStatus[$st]['refunded'] += (float) $r->ref;

            if (isset($byType[$ty])) {
                $byType[$ty]['count'] += (int) $r->cnt;
                $byType[$ty]['approved'] += (float) $r->apr;
                $byType[$ty]['refunded'] += (float) $r->ref;
            }

            $total['count'] += (int) $r->cnt;
            $total['requested'] += (float) $r->req;
            $total['approved'] += (float) $r->apr;
            $total['refunded'] += (float) $r->ref;
        }

        // Para iadesi yöntemi kırılımı (onaylanan tutar bazlı).
        $byMethod = ReturnRequest::query()
            ->whereBetween('created_at', [$from, $to])
            ->whereNotNull('refund_method')
            ->selectRaw('refund_method, count(*) as cnt, coalesce(sum(approved_amount),0) as apr')
            ->groupBy('refund_method')
            ->get()
            ->map(fn ($m) => [
                'method' => $m->refund_method instanceof RefundMethod ? $m->refund_method->value : (string) $m->refund_method,
                'count' => (int) $m->cnt,
                'approved' => (float) $m->apr,
            ])
            ->values();

        return response()->json([
            'from' => $from->format('Y-m-d'),
            'to' => $to->format('Y-m-d'),
            'total' => $total,
            'by_type' => $byType,
            'by_status' => array_values($byStatus),
            'by_refund_method' => $byMethod,
        ]);
    }

    // ───────────────────────── DETAY ─────────────────────────

    public function show(int $id): JsonResponse
    {
        $r = ReturnRequest::with([
            'items',
            'events' => fn ($q) => $q->orderBy('created_at')->orderBy('id'),
            'events.actor:id,name',
            'staffNotes.actor:id,name',
            'attachments',
            'refunds' => fn ($q) => $q->orderBy('id'),
            'staffApprover:id,name',
            'managerApprover:id,name',
            'creator:id,name',
        ])->findOrFail($id);

        // Kapıda ödeme bayrağı bu özellikten ÖNCE açılmış taleplerde yok — detay açılışında canlı
        // ödeme bloğundan bir kez tespit edilip metadata'ya yazılır (sonraki açılışlarda çağrı yok).
        // Böylece personel "Havale Bilgileri" kartını görür; kartlı taleplerde hiçbir şey değişmez.
        $this->backfillCodFlag($r);

        $rules = $this->resolveRules();
        $reviewHours = (int) $rules['manager_review_hours'];
        $staffHours = (int) ($rules['staff_review_hours'] ?? 48);

        return response()->json([
            'request' => $this->detail($r, $reviewHours, $staffHours),
            'items' => $r->items->map(fn ($it) => [
                'id' => $it->id,
                'product_name' => $it->product_name,
                'sku' => $it->sku,
                'barcode' => $it->barcode,
                'variant_info' => $it->variant_info,
                'image_url' => $it->image_url,
                'qty_ordered' => $it->qty_ordered,
                'qty_requested' => $it->qty_requested,
                'qty_approved' => $it->qty_approved,
                'unit_price' => (float) $it->unit_price,
                'refundable_amount' => (float) $it->refundable_amount,
                'reason_code' => $it->reason_code,
                'reason_note' => $it->reason_note,
                'item_condition' => $it->item_condition,
            ]),
            'timeline' => $r->events->map(fn ($e) => [
                'id' => $e->id,
                'actor_type' => $e->actor_type,
                'actor_name' => $e->actor?->name,
                'action' => $e->action,
                'from_status' => $e->from_status,
                'to_status' => $e->to_status,
                'amount' => $e->amount !== null ? (float) $e->amount : null,
                'note' => $e->payload['note'] ?? null,
                'created_at' => optional($e->created_at)->format('Y-m-d H:i:s'),
            ]),
            // Bildirimler (SMS) — gözlem: her gönderim (dry-run dahil) audit'e yazılır (sms_* action).
            'sms' => $r->events
                ->filter(fn ($e) => str_starts_with((string) $e->action, 'sms_'))
                ->map(fn ($e) => [
                    'id' => $e->id,
                    'event' => $e->payload['event'] ?? substr((string) $e->action, 4),
                    'sent' => (bool) ($e->payload['sent'] ?? false),
                    'dry_run' => (bool) ($e->payload['dry_run'] ?? false),
                    'message' => $e->payload['message'] ?? null,
                    'error' => $e->payload['error'] ?? null,
                    'created_at' => optional($e->created_at)->format('Y-m-d H:i:s'),
                ])
                ->values(),
            'attachments' => $r->attachments->map(fn ($a) => [
                'id' => $a->id,
                'kind' => $a->kind,
                'original_name' => $a->original_name,
                'mime_type' => $a->mime_type,
                'size_bytes' => $a->size_bytes,
                'url' => route('returns.attachment.download', ['id' => $r->id, 'attachment' => $a->id]),
            ]),
            // İPTAL onay ekranı: yöneticiye gösterilecek ÖNİZLEME (Pending) ve işlenmiş sonuçlar.
            'cancel_preview' => $this->cancelPreview($r),
            'nebim_result' => $this->nebimResultView($r->nebim_result),
            'ticimax_cancel' => $r->metadata['ticimax_cancel'] ?? null,
            'ticimax_return' => $r->metadata['ticimax_return'] ?? null,
            // Faz 4 — para iadesi: tüm denemeler + (varsa) başarılı/dry-run kupon özeti.
            'refunds' => $r->refunds->map(fn ($f) => [
                'id' => $f->id,
                'provider' => $f->provider,
                'status' => $f->status,
                'amount' => (float) $f->amount,
                'currency' => $f->currency,
                'coupon_code' => $f->coupon_code,
                'provider_txn_id' => $f->provider_txn_id,
                'attempts' => (int) $f->attempts,
                'error_message' => $f->error_message,
                'processed_at' => optional($f->processed_at)->format('Y-m-d H:i:s'),
            ])->values(),
            // Yöneticiye PARA onayı butonu için: bu talep şu an iade tetiklemeye uygun mu?
            // Havale yönteminde "yeniden dene" anlamsız (otomatik sağlayıcı yok) — kapanış
            // "Havale Yapıldı" butonuyla yapılır, bu buton gizlenir.
            'refund_actionable' => in_array($r->status, [ReturnStatus::ManagerApproved, ReturnStatus::Refunding], true)
                && $r->refund_method !== RefundMethod::BankTransfer,
        ]);
    }

    /**
     * Kapıda ödeme bayrağını (metadata.cod) yoksa canlı ödeme bloğundan doldurur.
     * Fail-closed: okunamazsa hiçbir şey yazılmaz, akış değişmez. Kapanmış taleplere dokunulmaz.
     */
    private function backfillCodFlag(ReturnRequest $r): void
    {
        if (data_get($r->metadata, 'cod') !== null || $r->status->isTerminal()) {
            return;
        }

        $info = $this->cod->forRequest($r);
        if (! $info['checked']) {
            return;
        }

        $meta = $r->metadata ?? [];
        $meta['cod'] = ['is_cod' => (bool) $info['cod'], 'fee' => (float) $info['fee'], 'method_code' => $info['method_code'], 'detected_at' => now()->toIso8601String()];
        $r->metadata = $meta;
        $r->save();
    }

    /**
     * İPTAL önizlemesi (yalnızca type=cancel & Pending): yöneticinin onaydan önce kontrol etmesi için
     * Nebim ModelType 34 payload'ı (POST edilmeden) + Ticimax tam/kısmi planı + iade tutarı.
     */
    private function cancelPreview(ReturnRequest $r): ?array
    {
        if ($r->type !== ReturnType::Cancel || $r->status !== ReturnStatus::Pending) {
            return null;
        }

        $nebim = $this->erp->nebimFor($r);
        if (! $nebim->isEnabled()) {
            return null; // Nebim aktif değilse önizleme yok (gereksiz canlı çağrı/karışıklık olmasın).
        }

        $built = $nebim->previewModelType34($r);
        $isFull = (bool) ($built['is_full'] ?? false);

        return [
            'ok' => (bool) $built['success'],
            'error' => $built['error'] ?? null,
            'scope' => $built['success'] ? ($isFull ? 'full' : 'partial') : null,
            'refund_amount' => $built['success'] ? (float) ($built['amount'] ?? 0) : null,
            'nebim' => $built['success'] ? [
                'order_number' => $built['order_number'] ?? null,
                'lines' => $built['payload']['Lines'] ?? [],
                'payment' => $built['payload']['Payments'][0] ?? null,
            ] : null,
            'ticimax' => $built['success'] ? [
                'method' => $isFull ? 'full' : 'partial',
                'note' => $isFull
                    ? 'Tüm sipariş "Iptal" statüsüne çekilecek (SetSiparisDurum).'
                    : 'Kalem-bazlı iptal (SiparisUrunIptalIade) — canlı için Ticimax kalem kodları gerekir.',
            ] : null,
        ];
    }

    /** nebim_result'tan UI'a yetecek özet (büyük payload'ı kısmadan ama güvenli). */
    private function nebimResultView(?array $res): ?array
    {
        if (! $res) {
            return null;
        }

        return [
            'success' => (bool) ($res['success'] ?? false),
            'dry_run' => $res['dry_run'] ?? null,
            'order_number' => $res['order_number'] ?? null,
            'is_full' => $res['is_full'] ?? null,
            'error' => $res['error'] ?? null,
            'amount' => $res['payload']['Payments'][0]['Amount'] ?? null,
            'lines_count' => isset($res['payload']['Lines']) ? count($res['payload']['Lines']) : null,
        ];
    }

    // ───────────────────────── KARGO/İŞLEM ADIMLARI ─────────────────────────

    /**
     * Genel durum geçişi (kargo/işlem adımları). State machine ile doğrulanır.
     * Faz 2 (otomatik kargo) gelene kadar personel adımları manuel ilerletebilir.
     */
    public function transition(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canStaffApproveReturns()) {
            return response()->json(['message' => 'İade işlemleri için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'to_status' => 'required|string',
            'note' => 'nullable|string|max:500',
        ]);

        if (! in_array($data['to_status'], self::TRANSITION_TARGETS, true)) {
            return response()->json(['message' => 'Bu geçiş bu uçtan yapılamaz.'], 422);
        }
        $target = ReturnStatus::from($data['to_status']);

        $r = ReturnRequest::findOrFail($id);

        // Kusur kararı YALNIZCA yönetici uçlarından (defect-approve/defect-reject) verilir —
        // personel bu uçtan defect_review → awaiting_shipment ile onay kapısını atlayamaz.
        if ($r->status === ReturnStatus::DefectReview) {
            return response()->json(['message' => 'Kusur bildirimi kararı yalnızca yönetici onay/red ekranından verilebilir.'], 403);
        }

        if (! $r->status->canTransitionTo($target)) {
            return response()->json([
                'message' => "Geçersiz durum geçişi: {$r->status->label()} → {$target->label()}.",
            ], 422);
        }

        // YENİDEN AÇMA: kapanmış (müşteri vazgeçti / kod süresi doldu) talep, ürün farklı yoldan
        // (firmanın cari numarasıyla) depoya ulaştıysa elle Received'a çekilir.
        $reopen = $r->status === ReturnStatus::CancelledByCustomer;
        if ($reopen) {
            // İptal talebinde kargo adımı yoktur; kusur bildirimi yönetici onayından (kod üretimi) geçmiş olmalı.
            if ($r->type !== ReturnType::Return && ! ($r->type === ReturnType::Defect && ! empty($r->cargo_tracking_code))) {
                return response()->json(['message' => 'Bu talep türü yeniden açılamaz.'], 422);
            }
            // ÇİFT İADE GUARD: aynı siparişin aynı kalemleri için başka bir açık/iade edilmiş talep varsa açılmaz
            // (müşteri kod süresi dolunca yeni talep açmış olabilir).
            $lineIds = $r->items()->pluck('platform_line_id')->filter()->all();
            $other = ReturnRequest::query()
                ->where('platform_order_id', $r->platform_order_id)
                ->where('id', '!=', $r->id)
                ->whereNotIn('status', [ReturnStatus::Rejected->value, ReturnStatus::CancelledByCustomer->value])
                ->whereHas('items', fn ($q) => $q->whereIn('platform_line_id', $lineIds))
                ->first();
            if ($other) {
                return response()->json([
                    'message' => "Bu siparişin aynı ürünleri için başka bir talep var ({$other->public_code} — {$other->status->label()}). İşlem o talep üzerinden yürütülmeli.",
                ], 422);
            }
        }

        // İade gönderisi için kargo kodu: AwaitingShipment'a geçişte üretilir (Faz 2, dry-run).
        // Canlıda kod üretilemezse geçişe izin verilmez (kodsuz "kargo bekleniyor" olmaz).
        $cargo = null;
        if ($target === ReturnStatus::AwaitingShipment && $r->type !== ReturnType::Cancel && empty($r->cargo_tracking_code)) {
            $cargo = CargoProviderFactory::forRequest($r)->createReturnShipment($r);
            if (! $cargo['success']) {
                return response()->json(['message' => 'Kargo kodu oluşturulamadı: ' . $cargo['error']], 422);
            }
        }

        $from = $r->status;
        DB::transaction(function () use ($r, $target, $from, $user, $request, $data, $cargo, $reopen) {
            if ($target === ReturnStatus::Received) {
                $r->received_at = now();
            }
            if ($reopen) {
                $meta = $r->metadata ?? [];
                $meta['reopened'] = ['at' => now()->toIso8601String(), 'by' => $user->id, 'from' => $from->value, 'note' => $data['note'] ?? null];
                $r->metadata = $meta;
                $r->shipment_status = 'manual';
            }
            if ($cargo) {
                $r->cargo_provider = $cargo['provider'];
                $r->cargo_tracking_code = $cargo['tracking_code'];
                $r->cargo_label_url = $cargo['label_url'];
                $r->shipment_status = $cargo['dry_run'] ? 'dry_run' : 'created';
            }
            $r->status = $target;
            $r->save();

            $this->audit->log($r, 'transition', [
                'actor_type' => $this->actorType($user),
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => $target->value,
                'payload' => array_filter([
                    'note' => $data['note'] ?? null,
                    'cargo_tracking_code' => $cargo['tracking_code'] ?? null,
                    'reopened' => $reopen ? 'Kapanmış talep elle yeniden açıldı (ürün iade kodu dışında bir gönderiyle depoya ulaştı).' : null,
                ]),
                'request' => $request,
            ]);
        });

        // Yeniden açmada Ticimax 'İade Talebi Alındı' + kalem işaretleri geri yazılır (kapanışta geri
        // çekilmişti) — public akışla birebir, best-effort.
        if ($reopen) {
            $ticimax = $this->erp->ticimaxReturnRequested($r);
            $meta = $r->metadata ?? [];
            $meta['ticimax_return_requested'] = $ticimax;
            $r->metadata = $meta;
            $r->save();
        }

        // Bildirim (commit sonrası). Dry-run varsayılan.
        if ($target === ReturnStatus::AwaitingShipment && $cargo) {
            $this->notifier->notify($r, 'cargo_code', ['tracking_code' => $cargo['tracking_code']]);
        } elseif ($target === ReturnStatus::Received) {
            $this->notifier->notify($r, 'received');
        }

        return response()->json([
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'cargo_tracking_code' => $r->cargo_tracking_code,
        ]);
    }

    // ───────────────────────── ÇİFT ONAY ─────────────────────────

    /**
     * 1. onay (personel, yalnızca İADE): Received → StaffApproved. Personel gelen kargoyu onaylar.
     * Onay sonrası OTOMATİK Ticimax statü 'Iade' (best-effort; Nebim'e DOKUNULMAZ — kullanıcı kararı).
     * Ticimax başarısız olsa bile statü StaffApproved kalır; gerçek koruma yönetici PARA gate'idir.
     */
    public function approveStaff(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canStaffApproveReturns()) {
            return response()->json(['message' => 'Personel onayı için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'approved_amount' => 'nullable|numeric|min:0',
            'note' => 'nullable|string|max:500',
            'items' => 'nullable|array',
            'items.*.id' => 'required|integer',
            'items.*.qty_approved' => 'required|integer|min:0',
        ]);

        $r = ReturnRequest::with('items')->findOrFail($id);
        if (! $r->status->canTransitionTo(ReturnStatus::StaffApproved)) {
            return response()->json(['message' => 'Bu talep personel onayına uygun değil (önce depoya ulaşmalı).'], 422);
        }

        $approved = $this->clampAmount($data['approved_amount'] ?? null, $r);

        // Müşteriye SMS GİTMEZ — yönetici para onayı kesinleşince gider (kullanıcı kararı 2026-07-21).
        // Ticimax statüsü ise personel onayında 'IadeUlastiOdemeYapilacak' yazılır (kullanıcı
        // kararı 2026-08-07 — 21 Tem "statü değişmez" kararını revize eder).
        DB::transaction(function () use ($r, $user, $request, $data, $approved) {
            $this->applyItemApprovals($r, $data['items'] ?? null);
            $from = $r->status;
            $r->approved_amount = $approved;
            $r->staff_approved_by = $user->id;
            $r->staff_approved_at = now();
            $r->status = ReturnStatus::StaffApproved;
            $r->save();

            $this->audit->log($r, 'staff_approve', [
                'actor_type' => ReturnActorType::Staff,
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::StaffApproved->value,
                'amount' => $approved,
                'payload' => array_filter([
                    'note' => $data['note'] ?? null,
                ]),
                'request' => $request,
            ]);
        });

        // Ticimax siparişini 'İade Ulaştı Ödeme Yapılacak' statüsüne çek — best-effort
        // (kullanıcı kararı 2026-08-07; başarısız olsa da onay akışı devam eder).
        // YALNIZ Ticimax tenant'larında (ikas'ta muadil statü yazımı yok).
        if ($this->hasActiveTicimaxChannel($r)) {
            $ticimax = $this->erp->ticimaxStaffApproved($r);
            $meta = $r->metadata ?? [];
            $meta['ticimax_staff_approved'] = $ticimax;
            $r->metadata = $meta;
            $r->save();
            $this->audit->log($r, 'ticimax_staff_approved', [
                'actor_type' => ReturnActorType::System,
                'payload' => array_filter([
                    'durum' => $ticimax['payload']['durum'] ?? null,
                    'success' => ($ticimax['success'] ?? false) ? 'evet' : 'hayır',
                    'dry_run' => ($ticimax['dry_run'] ?? false) ? 'evet' : null,
                    'error' => $ticimax['error'] ?? null,
                ]),
            ]);
        }

        return response()->json([
            'status' => $r->status->value,
            'approved_amount' => (float) $r->approved_amount,
        ]);
    }

    /** Tenant'ta aktif Ticimax kanalı var mı? (statü yazımları yalnız Ticimax'ta anlamlı) */
    private function hasActiveTicimaxChannel(ReturnRequest $r): bool
    {
        return Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->exists();
    }

    /**
     * Yönetici onayı = SADECE PARA gate'i (ERP/statü işlemleri burada YOK; otomatik yürür).
     *  - İPTAL: Processing → ManagerApproved (tek onay; ERP zaten submit anında işlendi).
     *  - İADE:  StaffApproved → ManagerApproved (çift onay + görev ayrılığı; Ticimax 'Iade' personel onayında).
     *
     * NOT: Para iadesi (ManagerApproved → Refunding/Refunded) Faz 4'te tetiklenir.
     */
    public function approveManager(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canManagerApproveReturns()) {
            return response()->json(['message' => 'Yönetici onayı için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'approved_amount' => 'nullable|numeric|min:0',
            'note' => 'nullable|string|max:500',
        ]);

        $r = ReturnRequest::with('items')->findOrFail($id);

        // Hangi durumdan onaya geçilebilir: İPTAL → Processing, İADE → StaffApproved.
        $expected = $r->type === ReturnType::Cancel ? ReturnStatus::Processing : ReturnStatus::StaffApproved;
        if ($r->status !== $expected || ! $r->status->canTransitionTo(ReturnStatus::ManagerApproved)) {
            // Refunding = onay ZATEN verildi ama iade yarım kaldı (örn. çok-kalemli iyzico'da bir
            // kalemi banka reddetti — canlı vaka #118 tbp70841298). Eski mesaj "önce ERP iptali
            // işlenmeli" diyordu ve yanlış yola sevk ediyordu; doğru yol retry ucu (POST /refund).
            $msg = $r->status === ReturnStatus::Refunding
                ? 'Para onayı zaten verildi; iade kısmen tamamlandı. Kalan tutar için "Kalan İadeyi Tekrar Dene" işlemini kullanın.'
                : ($r->type === ReturnType::Cancel
                    ? 'Bu iptal talebi para onayına uygun değil (önce ERP iptali işlenmeli).'
                    : 'Bu talep yönetici onayına uygun değil (önce personel onayı gerekir).');

            return response()->json(['message' => $msg], 422);
        }

        // GÖREV AYRILIĞI KALDIRILDI (kullanıcı kararı 2026-07-30): önce süper admin muaftı (2026-07-21),
        // artık yöneticiler de muaf — yönetici, depo personelinin kaçırdığı iadeyi kendisi personel-onaylayıp
        // ardından para onayını da verebilir. Para onayı ucuna zaten yalnız canManagerApproveReturns
        // (süper admin / firma yöneticisi / return_role=manager) girebildiğinden kural fiilen kalktı.

        // ⛔ KAPIDA ÖDEME + karta iade: ortada iade edilecek bir kart işlemi YOK. Eskiden bu talepler
        // onaylanıp "Karta iade sağlayıcısı belirlenemedi" ile geri sarılıyordu (11 talep aylarca
        // kuyrukta kaldı). Artık onay hiç denenmez; personel havale bilgisini girince yöntem
        // otomatik havaleye döner ve onay normal ilerler.
        if ($r->refund_method === RefundMethod::Original) {
            $codInfo = $this->cod->forRequest($r);
            if ($codInfo['cod']) {
                $meta = $r->metadata ?? [];
                $meta['cod'] = ['is_cod' => true, 'fee' => (float) $codInfo['fee'], 'method_code' => $codInfo['method_code'], 'detected_at' => now()->toIso8601String()];
                $r->metadata = $meta;

                // İPTAL: hiç tahsilat olmadı → onaya gerek yok, talep burada parasız kapanır.
                if ($r->type === ReturnType::Cancel) {
                    $r->refund_method = RefundMethod::None;
                    $r->save();
                    $closed = $this->refundService->closeWithoutRefund($r, $user, 'Kapıda ödeme iptali — tahsilat yapılmadığı için iade edilecek tutar yok.');

                    return response()->json([
                        'status' => $r->refresh()->status->value,
                        'message' => $closed['success']
                            ? 'Bu sipariş kapıda ödemeli — tahsilat yapılmadığı için iade gerekmiyor, talep kapatıldı.'
                            : ($closed['error'] ?? 'Talep kapatılamadı.'),
                    ], $closed['success'] ? 200 : 422);
                }

                $r->save();

                return response()->json([
                    'message' => 'Bu sipariş KAPIDA ÖDEMELİ — karta iade yapılamaz. Talep detayındaki "Havale Bilgileri" bölümünden müşterinin banka / ad soyad / IBAN bilgisini girip tekrar onaylayın.',
                ], 422);
            }
        }

        $upper = $r->approved_amount !== null ? (float) $r->approved_amount : null;

        // ── PARA GATE'inde ödenen tutarı CANLI TAZELE (bayat snapshot koruması) ──
        // Submit ile onay arasında siparişte doğrudan (Ticimax'ta) kısmi iade olmuş olabilir →
        // snapshot bayat kalır ve fazla iade riski doğar. Onay anında ödenen tutarı Ticimax'tan
        // tekrar oku; daha DÜŞÜKSE tavanı ona indir. Ticimax erişilemezse snapshot'a düşülür
        // (onay bloke edilmez), fark audit'e yazılır.
        $livePaid = $this->refreshPaidCeiling($r);
        if ($livePaid !== null) {
            $upper = $upper !== null ? min($upper, $livePaid) : $livePaid;
        }

        $approved = $this->clampAmount($data['approved_amount'] ?? null, $r, $upper);
        $prevApprovedAmount = $r->approved_amount !== null ? (float) $r->approved_amount : null;

        DB::transaction(function () use ($r, $user, $request, $data, $approved, $livePaid) {
            $from = $r->status;
            $r->approved_amount = $approved;
            $r->manager_approved_by = $user->id;
            $r->manager_approved_at = now();
            $r->status = ReturnStatus::ManagerApproved;
            $r->save();

            $this->audit->log($r, 'manager_approve', [
                'actor_type' => ReturnActorType::Manager,
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::ManagerApproved->value,
                'amount' => $approved,
                'payload' => array_filter([
                    'note' => $data['note'] ?? null,
                    'paid_snapshot' => $r->paid_amount_snapshot !== null ? (float) $r->paid_amount_snapshot : null,
                    'paid_live' => $livePaid,
                ], fn ($v) => $v !== null),
                'request' => $request,
            ]);
        });

        // PARA onayı sonrası iade yürütme OTOMATİK: store_credit → anında indirim kuponu;
        // original → karta iade (PayTR/iyzico). refund() idempotent + dry-run aware.
        $refund = $this->refundService->refund($r, $user);

        $refundOk = (bool) ($refund['success'] ?? false);
        $pendingManual = (bool) ($refund['pending_manual'] ?? false);
        $partial = (bool) ($refund['partial'] ?? false);

        // Ticimax 'IadeOdemeYapildi' statüsü RefundService.finalize*'da, para iadesi FİİLEN
        // tamamlanınca yazılır (kullanıcı kararı 2026-07-21) — burada ayrıca yazılmaz.

        // KISMİ İADE (çok-kalemli iyzico'da bazı kalemler iade edildi, biri reddedildi): para hareketi
        // geri alınamaz → onay GERİ ALINMAZ, talep Refunding'de kalır; hata panelde gösterilir ve
        // "tekrar dene" kalan kalemleri tamamlar (başarılı kalemler atlanır, çift iade imkânsız).
        if (! $refundOk && $partial) {
            return response()->json([
                'status' => $r->refresh()->status->value,
                'refund' => $refund,
                'message' => 'Kısmi iade yapıldı ancak tamamlanamadı — kalan tutar için tekrar deneyin: ' . ($refund['error'] ?? 'bilinmeyen hata'),
            ], 422);
        }

        // ⛔ SAĞLAYICI REDDİ → ONAY GERİ ALINIR (kullanıcı kararı 2026-07-07): PayTR/iyzico bakiye
        // yetersizliği vb. ile iadeyi reddederse (veya kupon oluşturulamazsa) talep onaylanmış
        // SAYILMAZ; statü para-onayı-öncesi durumuna döner, hata nedeni panelde gösterilir.
        // Müşteriye bu aşamada HİÇBİR SMS gitmez (onay/iade mesajı yanıltıcı olurdu).
        if (! $refundOk && ! $pendingManual) {
            $r->refresh();
            DB::transaction(function () use ($r, $user, $expected, $prevApprovedAmount, $refund) {
                $from = $r->status;
                $r->status = $expected;
                $r->manager_approved_by = null;
                $r->manager_approved_at = null;
                $r->approved_amount = $prevApprovedAmount;
                $r->save();

                $this->audit->log($r, 'manager_approve_reverted', [
                    'actor_type' => ReturnActorType::Manager,
                    'actor_id' => $user->id,
                    'from_status' => $from->value,
                    'to_status' => $expected->value,
                    'payload' => ['error' => $refund['error'] ?? 'bilinmeyen hata'],
                ]);
            });

            return response()->json([
                'status' => $r->status->value,
                'refund' => $refund,
                'message' => 'Onay geri alındı — para iadesi yapılamadı: ' . ($refund['error'] ?? 'bilinmeyen hata'),
            ], 422);
        }

        // pending_manual: onay geçerli kalır (ödeme manuel yapılacak) → müşteriye onay SMS'i.
        // Başarıda 'approved' SMS ATILMAZ: RefundService zaten nihai 'refunded' SMS'ini
        // (tutar + varsa kupon kodu) gönderdi — çift SMS olmasın.
        if ($pendingManual) {
            $this->notifier->notify($r, 'approved', ['amount' => (float) $r->approved_amount]);
        }

        return response()->json([
            'status' => $r->status->value,
            'approved_amount' => (float) $r->approved_amount,
            'refund' => $refund,
            'message' => $this->refundMessage($refund),
        ]);
    }

    /** approve-manager / refund yanıtı için kullanıcıya gösterilecek mesaj. */
    private function refundMessage(?array $refund): string
    {
        if ($refund === null) {
            return 'Para iadesi onaylandı.';
        }
        $isCredit = ($refund['refund']['provider'] ?? null) === 'store_credit';
        $what = $isCredit ? 'indirim kuponu' : 'karta iade';

        if ($refund['pending_manual'] ?? false) {
            // Havale (kapıda ödeme iadesi) planlı bir manuel yoldur — hata gibi sunulmamalı.
            if (($refund['refund']['provider'] ?? null) === 'bank_transfer') {
                return 'Para onayı verildi. Havale müşterinin IBAN\'ına yapıldıktan sonra talep detayından "Havale Yapıldı" ile kapatın.';
            }

            return 'Para iadesi onaylandı; karta iade otomatikleştirilemedi, ödeme panelinden manuel yapılacak: '
                . ($refund['error'] ?? '');
        }
        if (! ($refund['success'] ?? false)) {
            return "Para iadesi yapılamadı ({$what} reddedildi) — işlem tamamlanmadı, tekrar deneyebilirsiniz: "
                . ($refund['error'] ?? 'bilinmeyen hata');
        }
        if ($refund['dry_run'] ?? false) {
            return "Para iadesi onaylandı; {$what} DRY-RUN olarak hazırlandı (sağlayıcıya gönderilmedi).";
        }

        return $isCredit ? 'Para iadesi onaylandı ve indirim kuponu oluşturuldu.' : 'Para iadesi onaylandı ve karta iade başlatıldı.';
    }

    /**
     * Para iadesini elle tetikle / yeniden dene (Faz 4). Yönetici onayından (ManagerApproved) veya
     * yarıda kalan denemeden (Refunding) çağrılabilir; idempotent (çift kupon açmaz).
     */
    public function refund(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canManagerApproveReturns()) {
            return response()->json(['message' => 'Para iadesi için yetkiniz yok.'], 403);
        }

        $r = ReturnRequest::with('items')->findOrFail($id);
        $result = $this->refundService->refund($r, $user);

        // Sağlayıcı reddi → Refunding'de bırakma, ManagerApproved'a geri çek (onay durur,
        // ödeme adımı tekrar denenebilir; hata nedeni yanıt mesajında).
        // İSTİSNA: kısmi iade (partial) — para kısmen gitti, Refunding'de kalır; retry kalanı tamamlar.
        if (! ($result['success'] ?? false) && ! ($result['pending_manual'] ?? false) && ! ($result['partial'] ?? false)) {
            $r->refresh();
            if ($r->status === ReturnStatus::Refunding) {
                $r->status = ReturnStatus::ManagerApproved;
                $r->save();

                $this->audit->log($r, 'refund_reverted', [
                    'actor_type' => ReturnActorType::Manager,
                    'actor_id' => $user->id,
                    'from_status' => ReturnStatus::Refunding->value,
                    'to_status' => ReturnStatus::ManagerApproved->value,
                    'payload' => ['error' => $result['error'] ?? 'bilinmeyen hata'],
                ]);
            }
        }

        return response()->json([
            'status' => $r->status->value,
            'refund' => $result,
            'message' => $this->refundMessage($result),
        ], ($result['success'] ?? false) ? 200 : 422);
    }

    /** Reddet: gerekçe + (opsiyonel) kanıt görseli. */
    public function reject(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canStaffApproveReturns()) {
            return response()->json(['message' => 'Red işlemi için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'reason' => 'required|string|min:3|max:1000',
            'attachment' => 'nullable|file|mimes:jpg,jpeg,png,webp,gif,bmp|max:8192', // 8 MB (SVG hariç)
        ]);

        $r = ReturnRequest::findOrFail($id);

        // Kusur bildirimi kararı yönetici uçlarından: personel genel reject ile karar veremez.
        if ($r->status === ReturnStatus::DefectReview) {
            return response()->json(['message' => 'Kusur bildirimi kararı yalnızca yönetici onay/red ekranından verilebilir.'], 403);
        }

        if (! $r->status->canTransitionTo(ReturnStatus::Rejected)) {
            return response()->json(['message' => 'Bu talep bu durumdayken reddedilemez.'], 422);
        }

        DB::transaction(function () use ($r, $user, $request, $data) {
            $from = $r->status;
            $r->reject_reason = $data['reason'];
            $r->rejected_by = $user->id;
            $r->rejected_at = now();
            $r->status = ReturnStatus::Rejected;
            $r->save();

            $event = $this->audit->log($r, 'reject', [
                'actor_type' => $this->actorType($user),
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::Rejected->value,
                'payload' => ['note' => $data['reason']],
                'request' => $request,
            ]);

            if ($request->hasFile('attachment')) {
                $this->storeAttachment($r, $request->file('attachment'), 'reject_evidence', $user->id, $event->id);
            }
        });

        // Ürün kırılımı 'İade Talebi' işaretlenmişse Ticimax'ta 'İşlemde'ye geri çek (best-effort).
        if (($r->metadata['ticimax_item_status'] ?? null) === 'return_requested') {
            $this->erp->ticimaxItemStatuses($r, 'reverted');
        }

        // Sipariş statüsü bizim tarafımızdan yazıldıysa iade öncesine geri çek — VARSAYILAN KAPALI
        // (Ticimax statü-SMS otomasyonu müşteriye ikinci teslim SMS'i atabilir; config'e bak).
        if ($this->erp->ticimaxRejectRevertEnabled($r) && $this->ticimaxOrderStatusWritten($r)) {
            $ticimax = $this->erp->ticimaxRejectRevert($r);
            $meta = $r->metadata ?? [];
            $meta['ticimax_reject_revert'] = $ticimax;
            $r->metadata = $meta;
            $r->save();
            $this->audit->log($r, 'ticimax_reject_revert', [
                'actor_type' => ReturnActorType::System,
                'payload' => array_filter([
                    'durum' => $ticimax['payload']['durum'] ?? null,
                    'success' => ($ticimax['success'] ?? false) ? 'evet' : 'hayır',
                    'dry_run' => ($ticimax['dry_run'] ?? false) ? 'evet' : null,
                    'error' => $ticimax['error'] ?? null,
                ]),
            ]);
        }

        $this->notifier->notify($r, 'rejected');

        return response()->json(['status' => $r->status->value]);
    }

    /**
     * İade akışı bu siparişin Ticimax SİPARİŞ statüsünü canlı olarak değiştirdi mi?
     * (Red/süre dolumu geri çekmesi yalnız o zaman anlamlı — hiç yazmadıysak dokunmayız.)
     */
    private function ticimaxOrderStatusWritten(ReturnRequest $r): bool
    {
        $req = $r->metadata['ticimax_return_requested'] ?? null;

        return is_array($req) && ($req['success'] ?? false) && ! ($req['dry_run'] ?? false);
    }

    /**
     * Personel notu ekle — telefonla çözülen durumlar için iç kayıt (ör. müşteri 1 ürün için talep
     * açıp 2 ürün gönderdi / sonradan kapsamı değiştirdi). Müşteriye HİÇBİR bildirim gitmez;
     * append-only audit'e (action=staff_note) yazılır, para onayı ekranlarında zorunlu gösterilir.
     */
    // ───────────────────────── HAVALE İLE İADE (kapıda ödeme) ─────────────────────────

    /**
     * Talebin HAVALE bilgisini (banka / ad soyad / IBAN) kaydeder veya düzeltir.
     *
     * İki kullanım: (1) müşteri public formda girdi ama düzeltme gerekiyor, (2) kapıda ödemeli
     * ESKİ talepler — bu özellikten önce açıldıkları için havale bilgisi yok; personel müşteriyle
     * iletişime geçip buradan girer (kullanıcı kararı 2026-09-01). Her değişiklik audit'e yazılır.
     */
    public function saveBankAccount(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canStaffApproveReturns()) {
            return response()->json(['message' => 'İade işlemleri için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            // Banka adı opsiyonel: havale IBAN + ad soyad ile yapılır, banka adı IBAN'dan zaten
            // bellidir (kullanıcı kararı 2026-09-01 — müşteriyi gereksiz alanla yormayalım).
            'bank_name' => 'nullable|string|max:80',
            'account_holder' => 'required|string|max:120',
            'iban' => 'required|string|max:40',
        ]);

        $r = ReturnRequest::findOrFail($id);
        if ($r->status->isTerminal()) {
            return response()->json(['message' => 'Kapanmış talebin havale bilgisi değiştirilemez.'], 422);
        }

        $iban = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $data['iban']) ?? '');
        if (! $this->isValidTrIban($iban)) {
            return response()->json(['message' => 'Geçerli bir TR IBAN giriniz (TR ile başlayan 26 karakter).'], 422);
        }

        $previous = (array) data_get($r->metadata, 'bank_account', []);
        $bank = [
            'bank_name' => trim((string) ($data['bank_name'] ?? '')),
            'account_holder' => trim($data['account_holder']),
            'iban' => $iban,
            'collected_at' => $previous['collected_at'] ?? now()->toIso8601String(),
            'updated_by' => $user->name,
            'updated_at' => now()->toIso8601String(),
        ];

        $meta = $r->metadata ?? [];
        $meta['bank_account'] = $bank;
        $r->metadata = $meta;

        // Kapıda ödemeli ESKİ talepler 'original' (karta iade) ile açılmıştı; havale bilgisi
        // girildiğine göre ödeme havaleyle yapılacak → yöntem düzeltilir ki para onayı karta
        // iade denemesiyle patlamasın. İndirim kodu seçilmiş talebe DOKUNULMAZ.
        if ($r->refund_method === RefundMethod::Original) {
            $r->refund_method = RefundMethod::BankTransfer;
        }
        $r->save();

        $this->audit->log($r, 'bank_account_saved', [
            'actor_type' => $this->actorType($user),
            'actor_id' => $user->id,
            'payload' => array_filter([
                'bank_name' => $bank['bank_name'],
                'account_holder' => $bank['account_holder'],
                'iban' => $bank['iban'],
                'previous_iban' => ($previous['iban'] ?? null) !== ($bank['iban']) ? ($previous['iban'] ?? null) : null,
                'refund_method' => $r->refund_method?->value,
            ], fn ($v) => $v !== null),
            'request' => $request,
        ]);

        $rules = $this->resolveRules();

        return response()->json([
            'message' => 'Havale bilgisi kaydedildi.',
            'request' => $this->detail($r->fresh(['items', 'attachments', 'staffNotes.actor']), (int) $rules['manager_review_hours'], (int) ($rules['staff_review_hours'] ?? 48)),
        ]);
    }

    /**
     * HAVALE YAPILDI: finans ekibi müşterinin IBAN'ına havaleyi gerçekleştirdikten sonra talebi
     * kapatır (Refunding → Refunded + Ticimax statüsü + müşteriye SMS).
     *
     * Para hareketi modül dışında (banka) olduğu için açıklama ZORUNLUDUR — denetim izi kim/ne
     * zaman/hangi dekontla sorularını yanıtlamalı. Yalnız para onayı yetkisi olanlar kullanabilir.
     */
    public function markTransferred(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canManagerApproveReturns()) {
            return response()->json(['message' => 'Para iadesi için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'amount' => 'nullable|numeric|min:0',
            'txn' => 'nullable|string|max:64',
            'note' => 'required|string|min:3|max:500',
        ]);

        $r = ReturnRequest::with('items')->findOrFail($id);
        $amount = isset($data['amount']) ? (float) $data['amount'] : (float) ($r->approved_amount ?? 0);

        $result = $this->refundService->markBankTransferPaid($r, $user, $amount, trim($data['note']), $data['txn'] ?? null);

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Havale işlenemedi.'], 422);
        }

        // Denetim için personel notu olarak da düşülür (para onayı ekranlarında görünür).
        $this->audit->log($r, 'staff_note', [
            'actor_type' => $this->actorType($user),
            'actor_id' => $user->id,
            'payload' => ['note' => 'Havale yapıldı: ' . number_format($amount, 2, ',', '.') . ' ' . ($r->currency ?? 'TRY') . ' — ' . trim($data['note'])],
            'request' => $request,
        ]);

        return response()->json([
            'status' => $r->refresh()->status->value,
            'refund' => $result,
            'message' => 'Havale kaydedildi, talep kapatıldı.',
        ]);
    }

    // ─────────────────── MUHASEBE: KAPIDA ÖDEME HAVALE LİSTESİ ───────────────────

    /**
     * Kapıda ödemeli siparişlerin HAVALE ÖDEME EMRİ ekranı (kullanıcı isteği 2026-09-04).
     *
     * Neden ayrı bir ekran: kapıda ödemede para kart üzerinden geri verilemez — muhasebe, müşterinin
     * beyan ettiği IBAN'a tek tek havale yapar. Talepleri detay detay gezip IBAN toplamak yerine
     * yönetici burada bekleyen ödemeleri TOPLU görür, çıktı/CSV alıp muhasebeye iletir.
     *
     * Kapsamlar (scope):
     *  - payable  (varsayılan): yöntem havale + yönetici para onayı verilmiş (manager_approved/refunding)
     *             → FİİLEN ÖDENECEK liste. Muhasebeye giden çıktı budur.
     *  - pipeline: kapıda ödemeli, henüz para onayı almamış açık talepler → yaklaşan yük + IBAN'ı
     *             eksik olanların erken görülmesi (personel müşteriden isteyebilsin).
     *  - paid     : havalesi yapılıp kapanmış talepler (arşiv/mutabakat).
     *
     * IBAN gibi hassas veri taşıdığı için uç YALNIZCA para onayı yetkisi olanlara açıktır.
     */
    public function payouts(Request $request): JsonResponse
    {
        if (! $request->user()->canManagerApproveReturns()) {
            return response()->json(['message' => 'Havale listesi için yetkiniz yok.'], 403);
        }

        $scope = $this->payoutScope($request);
        $query = $this->payoutQuery($request, $scope);

        $agg = (clone $query)
            ->selectRaw('count(*) as cnt, coalesce(sum(coalesce(approved_amount, requested_amount)),0) as amount')
            ->first();

        $missingIban = (clone $query)->whereRaw(self::SQL_NO_IBAN)->count();
        // Fiilen ödenebilir olanlar (IBAN girilmiş + yöntemi havale) — panel toplamları buradan.
        $payableAgg = (clone $query)
            ->where('refund_method', RefundMethod::BankTransfer->value)
            ->whereRaw('not ' . self::SQL_NO_IBAN)
            ->selectRaw('count(*) as cnt, coalesce(sum(coalesce(approved_amount, requested_amount)),0) as amount')
            ->first();
        $notSent = (clone $query)->whereRaw(self::SQL_NOT_SENT_TO_ACCOUNTING)->count();

        $rows = (clone $query)
            ->with($this->payoutEager())
            ->orderByRaw($scope === 'paid'
                ? 'coalesce(manager_approved_at, updated_at) desc'
                : 'coalesce(manager_approved_at, staff_approved_at, created_at) asc')
            ->limit(self::PAYOUT_MAX)
            ->get()
            ->map(fn (ReturnRequest $r) => $this->payoutRow($r))
            ->values();

        return response()->json([
            'scope' => $scope,
            'data' => $rows,
            'summary' => [
                'count' => (int) ($agg->cnt ?? 0),
                'amount' => round((float) ($agg->amount ?? 0), 2),
                'missing_iban' => $missingIban,
                'not_sent' => $notSent,
                'payable_count' => (int) ($payableAgg->cnt ?? 0),
                'payable_amount' => round((float) ($payableAgg->amount ?? 0), 2),
                'currency' => $rows[0]['currency'] ?? 'TRY',
            ],
            // Sekme rozetleri: üç kapsamın da adedi (arama/tarih filtreleri UYGULANMADAN — sekme
            // sayısı, kullanıcı arama yaptı diye altından değişmesin).
            'counts' => [
                'payable' => $this->payoutQuery(new Request(), 'payable')->count(),
                'pipeline' => $this->payoutQuery(new Request(), 'pipeline')->count(),
                'paid' => $this->payoutQuery(new Request(), 'paid')->count(),
            ],
            // Liste tavanı aşıldıysa panelde uyarı gösterilir (özet sayılar TAM kümeye aittir).
            'truncated' => (int) ($agg->cnt ?? 0) > self::PAYOUT_MAX,
            'limit' => self::PAYOUT_MAX,
        ]);
    }

    /**
     * Aynı listenin muhasebeye e-postayla iletilebilir CSV'si (Excel uyumlu: UTF-8 BOM + ';').
     * Ekranda görünen 500'lük tavan burada YOKTUR — dosya tüm kümeyi taşır.
     */
    public function payoutsExport(Request $request): StreamedResponse|JsonResponse
    {
        if (! $request->user()->canManagerApproveReturns()) {
            return response()->json(['message' => 'Havale listesi için yetkiniz yok.'], 403);
        }

        $scope = $this->payoutScope($request);
        $query = $this->payoutQuery($request, $scope)
            ->with($this->payoutEager())
            ->orderByRaw('coalesce(manager_approved_at, staff_approved_at, created_at) asc');

        $filename = 'kapida-odeme-havale-listesi-' . $scope . '-' . now()->format('Ymd-Hi') . '.csv';

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM → Excel Türkçe karakterleri doğru açar
            fputcsv($out, [
                'Talep Kodu', 'Sipariş No', 'Tür', 'Durum', 'Müşteri', 'Telefon',
                'Hesap Sahibi', 'IBAN', 'Banka', 'Tutar', 'Para Birimi',
                'Talep Tarihi', 'Para Onayı', 'Muhasebeye İletildi', 'Havale Fişi',
            ], ';');

            $query->chunk(300, function ($chunk) use ($out) {
                foreach ($chunk as $r) {
                    $row = $this->payoutRow($r);
                    fputcsv($out, [
                        $row['public_code'],
                        $row['order_no'] ?? '',
                        $row['type_label'],
                        $row['status_label'],
                        $row['customer_name'] ?? '',
                        $row['customer_phone'] ?? '',
                        $row['account_holder'] ?? '',
                        $row['iban'] ?? '',
                        $row['bank_name'] ?? '',
                        number_format($row['amount'], 2, ',', '.'),
                        $row['currency'],
                        $row['created_at'] ?? '',
                        $row['manager_approved_at'] ?? '',
                        $row['accounting']['sent_at'] ?? '',
                        $row['transfer_txn'] ?? '',
                    ], ';');
                }
            });

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * Seçili talepleri "muhasebeye iletildi" olarak damgalar (kullanıcı isteği 2026-09-04).
     *
     * PARA HAREKETİ DEĞİLDİR — talebin durumuna dokunmaz, müşteriye bildirim gitmez. Tek amacı
     * aynı listenin iki kez muhasebeye gönderilip çift havale yapılmasını önlemek: damgalanan
     * talep listede "İletildi (tarih · parti)" rozetiyle görünür ve "Yalnız iletilmemişler"
     * filtresinden düşer. Havale fiilen yapıldığında kapanış yine tekil "Havale Yapıldı"
     * ucundan ({@see markTransferred}) yapılır.
     */
    public function markAccountingSent(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->canManagerApproveReturns()) {
            return response()->json(['message' => 'Bu işlem için yetkiniz yok.'], 403);
        }

        $data = $request->validate([
            'ids' => 'required|array|min:1|max:500',
            'ids.*' => 'integer',
            'note' => 'nullable|string|max:255',
        ]);

        // Parti kodu: çıktı/CSV başlığında da görünür → muhasebe hangi listeyi aldığını eşleştirir.
        $batch = 'MH-' . now()->format('ymd-Hi');
        $stampedAt = now();

        // Tenant global-scope zaten süzer; ayrıca YALNIZCA havale yöntemli talepler damgalanır.
        $requests = ReturnRequest::query()
            ->whereIn('id', $data['ids'])
            ->where('refund_method', RefundMethod::BankTransfer->value)
            ->get();

        foreach ($requests as $r) {
            $meta = $r->metadata ?? [];
            $meta['accounting'] = [
                'sent_at' => $stampedAt->toIso8601String(),
                'sent_by' => $user->name,
                'sent_by_id' => $user->id,
                'batch' => $batch,
                'note' => $data['note'] ?? null,
            ];
            $r->metadata = $meta;
            $r->save();

            $this->audit->log($r, 'accounting_batch_sent', [
                'actor_type' => $this->actorType($user),
                'actor_id' => $user->id,
                'payload' => ['batch' => $batch, 'note' => $data['note'] ?? null],
                'request' => $request,
            ]);
        }

        return response()->json([
            'batch' => $batch,
            'marked' => $requests->count(),
            'skipped' => count($data['ids']) - $requests->count(),
            'message' => $requests->count() . ' talep muhasebeye iletildi olarak işaretlendi (parti ' . $batch . ').',
        ]);
    }

    /**
     * Havale satırı dekont referansı taşır → satır başına ek sorgu olmasın diye eager-load edilir
     * (yalnız havale iadesi kayıtları; kupon/kart denemeleri değil).
     */
    private function payoutEager(): array
    {
        return ['refunds' => fn ($q) => $q->where('provider', 'bank_transfer')];
    }

    /** İstekten kapsam adı: payable (varsayılan) | pipeline | paid. */
    private function payoutScope(Request $request): string
    {
        $scope = (string) $request->query('scope', 'payable');

        return in_array($scope, ['payable', 'pipeline', 'paid'], true) ? $scope : 'payable';
    }

    /** @return \Illuminate\Database\Eloquent\Builder<ReturnRequest> */
    private function payoutQuery(Request $request, string $scope)
    {
        $query = ReturnRequest::query();

        if ($scope === 'paid') {
            $query->where('refund_method', RefundMethod::BankTransfer->value)
                ->whereIn('status', self::PAYOUT_PAID);
        } else {
            // Kapıda ödemeli ve sonunda HAVALE gerektirecek talepler.
            // İPTAL dışarıda — kapıda ödemeli iptalde tahsilat hiç yapılmamıştır (iade edilecek para yok).
            // İndirim kodu / "iade yok" seçilenler de dışarıda: banka havalesi doğurmazlar.
            // NOT: refund_method='original' kalmış eski COD talepleri BİLEREK dâhildir — IBAN'ı
            // eksik oldukları listede görünsün ve personel müşteriden isteyebilsin (ödeme butonu kapalı).
            $query->whereRaw(self::SQL_IS_COD)
                ->where('type', '!=', ReturnType::Cancel->value)
                ->whereIn('status', $scope === 'payable' ? self::PAYOUT_PAYABLE : self::PAYOUT_PIPELINE)
                ->where(function ($w) {
                    $w->whereNull('refund_method')
                        ->orWhereNotIn('refund_method', [RefundMethod::None->value, RefundMethod::StoreCredit->value]);
                });
        }

        if ($request->boolean('unsent_only')) {
            $query->whereRaw(self::SQL_NOT_SENT_TO_ACCOUNTING);
        }

        if ($request->boolean('missing_iban_only')) {
            $query->whereRaw(self::SQL_NO_IBAN);
        }

        // Çıktı/CSV varsayılanı: yalnız FİİLEN ödenebilir satırlar (IBAN'ı olan + yöntemi havale).
        // IBAN'ı eksik talepler ekranda görünmeye devam eder, muhasebeye giden listeye girmez.
        if ($request->boolean('only_payable')) {
            $query->where('refund_method', RefundMethod::BankTransfer->value)
                ->whereRaw('not ' . self::SQL_NO_IBAN);
        }

        if ($from = $request->query('from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('order_no', 'ilike', $like)
                    ->orWhere('public_code', 'ilike', $like)
                    ->orWhere('customer_name', 'ilike', $like)
                    ->orWhere('customer_phone', 'ilike', $like)
                    ->orWhereRaw("metadata->'bank_account'->>'iban' ilike ?", [$like])
                    ->orWhereRaw("metadata->'bank_account'->>'account_holder' ilike ?", [$like]);
            });
        }

        return $query;
    }

    /** Havale listesi satırı — çıktıda/CSV'de gösterilen alanlar (IBAN dâhil). */
    private function payoutRow(ReturnRequest $r): array
    {
        $bank = (array) data_get($r->metadata, 'bank_account', []);
        $accounting = data_get($r->metadata, 'accounting');
        $amount = (float) ($r->approved_amount ?? $r->requested_amount);

        return [
            'id' => $r->id,
            'public_code' => $r->public_code,
            'order_no' => $r->order_no,
            'platform_order_id' => $r->platform_order_id,
            'type' => $r->type->value,
            'type_label' => \App\Services\Returns\ShortageService::isReturned($r) ? \App\Services\Returns\ShortageService::RETURNED_TYPE_LABEL : $r->type->label(),
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'customer_name' => $r->customer_name,
            'customer_phone' => $r->customer_phone,
            'customer_email' => $r->customer_email,
            'currency' => $r->currency ?? 'TRY',
            'amount' => round($amount, 2),
            'refunded_amount' => (float) $r->refunded_amount,
            'account_holder' => trim((string) ($bank['account_holder'] ?? '')) ?: null,
            'iban' => trim((string) ($bank['iban'] ?? '')) ?: null,
            'bank_name' => trim((string) ($bank['bank_name'] ?? '')) ?: null,
            'cod_fee' => (float) data_get($r->metadata, 'cod.fee', 0),
            'created_at' => optional($r->created_at)->format('Y-m-d H:i'),
            'staff_approved_at' => optional($r->staff_approved_at)->format('Y-m-d H:i'),
            'manager_approved_at' => optional($r->manager_approved_at)->format('Y-m-d H:i'),
            /**
             * Ödeme aşaması — panel butonunun ne yapacağını belirler:
             *  awaiting_approval → önce yönetici para onayı, ardından havale kapanışı (2 adım)
             *  approved          → onay verilmiş, yalnız havale kapanışı kalmıştır
             *  paid              → kapanmış
             */
            'payment_stage' => match (true) {
                in_array($r->status->value, self::PAYOUT_PAID, true) => 'paid',
                $r->status === ReturnStatus::StaffApproved => 'awaiting_approval',
                in_array($r->status->value, self::PAYOUT_PAYABLE, true) => 'approved',
                default => 'pipeline',
            },
            /**
             * Ödeme yapılabilir mi: IBAN yoksa (ya da yöntem hâlâ 'karta iade' kalmışsa) havale
             * kapanışı sunucuda zaten reddedilir → buton panelde de kapalı gösterilir.
             */
            'payable' => trim((string) ($bank['iban'] ?? '')) !== ''
                && $r->refund_method === RefundMethod::BankTransfer
                && in_array($r->status->value, self::PAYOUT_PAYABLE, true),
            // Havale fişi/dekont referansı — kapanışta markTransferred ile yazılır.
            'transfer_txn' => $r->relationLoaded('refunds')
                ? $r->refunds->first()?->provider_txn_id
                : $r->refunds()->where('provider', 'bank_transfer')->value('provider_txn_id'),
            'accounting' => $accounting ? [
                'sent_at' => isset($accounting['sent_at']) ? Carbon::parse($accounting['sent_at'])->format('Y-m-d H:i') : null,
                'sent_by' => $accounting['sent_by'] ?? null,
                'batch' => $accounting['batch'] ?? null,
            ] : null,
        ];
    }

    /** TR IBAN doğrulaması: 26 karakter + ISO 7064 mod-97 = 1. */
    private function isValidTrIban(string $iban): bool
    {
        if (! preg_match('/^TR\\d{24}$/', $iban)) {
            return false;
        }

        $rearranged = substr($iban, 4) . substr($iban, 0, 4);
        $numeric = '';
        foreach (str_split($rearranged) as $chr) {
            $numeric .= ctype_alpha($chr) ? (string) (ord($chr) - 55) : $chr;
        }

        $remainder = 0;
        foreach (str_split($numeric, 7) as $chunk) {
            $remainder = (int) ((string) $remainder . $chunk) % 97;
        }

        return $remainder === 1;
    }

    public function addNote(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canAddReturnNotes()) {
            return response()->json(['message' => 'Not eklemek için yetkiniz yok.'], 403);
        }

        $data = $request->validate(['note' => 'required|string|min:3|max:1000']);

        $r = ReturnRequest::findOrFail($id);

        $this->audit->log($r, 'staff_note', [
            'actor_type' => $this->actorType($user),
            'actor_id' => $user->id,
            'payload' => ['note' => $data['note']],
            'request' => $request,
        ]);

        return response()->json(['staff_notes' => $this->staffNoteViews($r->load('staffNotes.actor'))], 201);
    }

    /** staff_note event'lerini panel görünümüne çevirir (listRow/detail/addNote ortak). */
    private function staffNoteViews(ReturnRequest $r): array
    {
        return $r->staffNotes->map(fn ($e) => [
            'id' => $e->id,
            'note' => $e->payload['note'] ?? '',
            'actor_name' => $e->actor?->name,
            'created_at' => optional($e->created_at)->format('Y-m-d H:i:s'),
        ])->values()->all();
    }

    // ───────────────────────── KUSUR BİLDİRİMİ (yönetici kararı) ─────────────────────────

    /**
     * Kusur bildirimini ONAYLA — YALNIZCA tenant yöneticisi (admin) / süper admin.
     * Sürat iade kodu üretilir (kodsuz onay yok), DefectReview → AwaitingShipment,
     * Ticimax best-effort 'İade Talebi Alındı', müşteriye cargo_code SMS'i.
     * Sonrası normal iade akışıyla aynıdır (kargo takip → received → çift onay → refund).
     */
    public function approveDefect(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! $user->isAdmin()) {
            return response()->json(['message' => 'Kusur bildirimi kararı yalnızca firma yöneticisi tarafından verilebilir.'], 403);
        }

        $data = $request->validate(['note' => 'nullable|string|max:500']);

        $r = ReturnRequest::findOrFail($id);
        if ($r->type !== ReturnType::Defect || $r->status !== ReturnStatus::DefectReview) {
            return response()->json(['message' => 'Bu talep kusur onayına uygun değil.'], 422);
        }

        $cargo = CargoProviderFactory::forRequest($r)->createReturnShipment($r);
        if (! $cargo['success']) {
            return response()->json(['message' => 'Kargo kodu oluşturulamadı: ' . $cargo['error']], 422);
        }

        DB::transaction(function () use ($r, $user, $request, $data, $cargo) {
            $from = $r->status;
            $r->cargo_provider = $cargo['provider'];
            $r->cargo_tracking_code = $cargo['tracking_code'];
            $r->cargo_label_url = $cargo['label_url'];
            $r->shipment_status = $cargo['dry_run'] ? 'dry_run' : 'created';
            $r->status = ReturnStatus::AwaitingShipment;
            $r->save();

            $this->audit->log($r, 'defect_approve', [
                'actor_type' => $this->actorType($user),
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::AwaitingShipment->value,
                'payload' => array_filter([
                    'note' => $data['note'] ?? null,
                    'cargo_tracking_code' => $cargo['tracking_code'],
                    'dry_run' => ($cargo['dry_run'] ?? false) ? 'evet' : null,
                ]),
                'request' => $request,
            ]);
        });

        // Ticimax siparişini 'İade Talebi Alındı' statüsüne çek — best-effort (public iade akışıyla aynı).
        $ticimax = $this->erp->ticimaxReturnRequested($r);
        $meta = $r->metadata ?? [];
        $meta['ticimax_return_requested'] = $ticimax;
        $r->metadata = $meta;
        $r->save();
        $this->audit->log($r, 'ticimax_return_requested', [
            'actor_type' => ReturnActorType::System,
            'payload' => array_filter([
                'success' => ($ticimax['success'] ?? false) ? 'evet' : 'hayır',
                'dry_run' => ($ticimax['dry_run'] ?? false) ? 'evet' : null,
                'error' => $ticimax['error'] ?? null,
            ]),
        ]);

        // Müşteriye ONAY + kargo kodu SMS'i (dry-run varsayılan kurala tabi).
        $this->notifier->notify($r, 'defect_approved', [
            'tracking_code' => $r->cargo_tracking_code,
            'expire_days' => app(\App\Services\Returns\ReturnRulesService::class)->shipmentExpireDays($r->tenant),
        ]);

        return response()->json([
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'cargo_tracking_code' => $r->cargo_tracking_code,
        ]);
    }

    /**
     * Kusur bildirimini REDDET — YALNIZCA tenant yöneticisi (admin) / süper admin.
     * Red nedeni tenant'ın tanımlı listesinden seçilir (fail-closed) ve müşteriye
     * neden içeren 'defect_rejected' SMS'i gönderilir.
     */
    public function rejectDefect(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! $user->isAdmin()) {
            return response()->json(['message' => 'Kusur bildirimi kararı yalnızca firma yöneticisi tarafından verilebilir.'], 403);
        }

        $data = $request->validate([
            'reason' => 'required|string|max:300',
            'note' => 'nullable|string|max:500',
        ]);

        $r = ReturnRequest::findOrFail($id);
        if ($r->type !== ReturnType::Defect || $r->status !== ReturnStatus::DefectReview) {
            return response()->json(['message' => 'Bu talep kusur reddine uygun değil.'], 422);
        }

        // Neden LİSTEDEN seçilmek zorunda (SMS'e gireceği için serbest metne izin yok).
        $allowedReasons = (array) ($this->resolveRules()['defect_reject_reasons'] ?? []);
        if (! in_array($data['reason'], $allowedReasons, true)) {
            return response()->json(['message' => 'Geçersiz red nedeni: tanımlı listeden seçiniz.'], 422);
        }

        DB::transaction(function () use ($r, $user, $request, $data) {
            $from = $r->status;
            $r->reject_reason = $data['reason'] . (! empty($data['note']) ? ' — ' . $data['note'] : '');
            $r->rejected_by = $user->id;
            $r->rejected_at = now();
            $r->status = ReturnStatus::Rejected;
            $r->save();

            $this->audit->log($r, 'defect_reject', [
                'actor_type' => $this->actorType($user),
                'actor_id' => $user->id,
                'from_status' => $from->value,
                'to_status' => ReturnStatus::Rejected->value,
                'payload' => array_filter(['reason' => $data['reason'], 'note' => $data['note'] ?? null]),
                'request' => $request,
            ]);
        });

        $this->notifier->notify($r, 'defect_rejected', ['reason' => $data['reason']]);

        return response()->json(['status' => $r->status->value]);
    }

    // ───────────────────────── GÖRSEL ─────────────────────────

    public function uploadAttachment(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->canStaffApproveReturns()) {
            return response()->json(['message' => 'Görsel yükleme için yetkiniz yok.'], 403);
        }

        $request->validate([
            'file' => 'required|file|mimes:jpg,jpeg,png,webp,gif,bmp|max:8192',
            'kind' => 'nullable|string|max:32',
        ]);

        $r = ReturnRequest::findOrFail($id);
        $att = $this->storeAttachment($r, $request->file('file'), $request->input('kind', 'inspection'), $user->id);

        return response()->json([
            'id' => $att->id,
            'kind' => $att->kind,
            'original_name' => $att->original_name,
            'url' => route('returns.attachment.download', ['id' => $r->id, 'attachment' => $att->id]),
        ], 201);
    }

    public function downloadAttachment(Request $request, int $id, int $attachment): StreamedResponse
    {
        $r = ReturnRequest::findOrFail($id);
        $att = ReturnAttachment::where('return_request_id', $r->id)->findOrFail($attachment);

        abort_unless(Storage::disk($att->disk)->exists($att->path), 404);

        // GÜVENLİK: panel bu yanıtı blob olarak yeni sekmede açıyor (hub origin'i). Tür, kayıttaki
        // değere güvenilmeden DOSYA İÇERİĞİNDEN belirlenir; bilinen raster görsel değilse
        // tarayıcıda çalışmayacak biçimde (octet-stream + attachment) indirilir.
        $detected = (string) (Storage::disk($att->disk)->mimeType($att->path) ?: '');
        $safeImage = in_array($detected, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp'], true);

        return Storage::disk($att->disk)->response(
            $att->path,
            $att->original_name,
            [
                'Content-Type' => $safeImage ? $detected : 'application/octet-stream',
                'X-Content-Type-Options' => 'nosniff',
            ],
            $safeImage ? 'inline' : 'attachment'
        );
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    private function resolveTenant(): ?Tenant
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

    private function resolveRules(): array
    {
        $tenant = $this->resolveTenant();

        return $tenant ? $this->rules->forTenant($tenant) : config('returns.default_rules');
    }

    private function actorType($user): ReturnActorType
    {
        return $user->canManagerApproveReturns() ? ReturnActorType::Manager : ReturnActorType::Staff;
    }

    /**
     * Siparişin ödenen tutarını Ticimax'tan CANLI okur (para gate'inde bayat snapshot koruması).
     * Erişilemez/okunamazsa null → çağıran snapshot'a düşer (onay bloke edilmez).
     */
    private function refreshPaidCeiling(ReturnRequest $r): ?float
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->first();
        if (! $channel) {
            return null;
        }

        $svc = TicimaxService::fromChannel($channel);
        if (! $svc->isAvailable()) {
            return null;
        }

        $res = $svc->getOrderByNo((string) $r->order_no);
        if (! ($res['success'] ?? false)) {
            return null;
        }

        $paid = $this->normalizer->normalize($res['order'])['paid_amount'] ?? null;

        return $paid !== null ? round((float) $paid, 2) : null;
    }

    /** Tutarı güvenli aralığa sabitle: 0 ≤ x ≤ min(requested, paid_snapshot, üst_sınır). */
    private function clampAmount(?float $amount, ReturnRequest $r, ?float $upper = null): float
    {
        $ceiling = (float) $r->requested_amount;
        if ($r->paid_amount_snapshot !== null) {
            $ceiling = min($ceiling, (float) $r->paid_amount_snapshot);
        }
        if ($upper !== null) {
            $ceiling = min($ceiling, $upper);
        }
        if ($amount === null) {
            return round($ceiling, 2);
        }

        return round(max(0.0, min((float) $amount, $ceiling)), 2);
    }

    /** Kalem bazlı onay adetlerini uygula (talep edilenden fazla olamaz). */
    private function applyItemApprovals(ReturnRequest $r, ?array $items): void
    {
        if (! $items) {
            // Belirtilmediyse talep edilen adetler onaylanmış sayılır.
            foreach ($r->items as $it) {
                if ($it->qty_approved === null) {
                    $it->qty_approved = $it->qty_requested;
                    $it->save();
                }
            }

            return;
        }

        $byId = $r->items->keyBy('id');
        foreach ($items as $row) {
            $it = $byId->get($row['id']);
            if (! $it) {
                continue;
            }
            $it->qty_approved = max(0, min((int) $row['qty_approved'], (int) $it->qty_requested));
            $it->save();
        }
    }

    private function storeAttachment(ReturnRequest $r, $file, string $kind, int $userId, ?int $eventId = null): ReturnAttachment
    {
        $disk = 'local'; // gizli disk (public değil) — indirme yetki kontrollü uçtan
        $path = $file->store("returns/{$r->tenant_id}/{$r->id}", $disk);

        return ReturnAttachment::create([
            'tenant_id' => $r->tenant_id,
            'return_request_id' => $r->id,
            'event_id' => $eventId,
            'kind' => $kind,
            'disk' => $disk,
            'path' => $path,
            'original_name' => basename((string) $file->getClientOriginalName()),
            // GÜVENLİK: istemcinin beyan ettiği tür DEĞİL, içerikten algılanan tür saklanır
            'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
            'size_bytes' => $file->getSize(),
            'uploaded_by' => $userId,
        ]);
    }

    private function timer(ReturnRequest $r, int $reviewHours, int $staffHours): array
    {
        if (! $r->received_at || in_array($r->status, [
            ReturnStatus::ManagerApproved, ReturnStatus::Refunding, ReturnStatus::Refunded,
            ReturnStatus::Completed, ReturnStatus::Rejected, ReturnStatus::CancelledByCustomer,
        ], true)) {
            return ['deadline' => null, 'hours_left' => null, 'sla_breached' => false];
        }

        // İki aşamalı sayaç: depo onayı (received) received_at + staff_review_hours;
        // yönetici para onayı (staff_approved) personel onay anından + manager_review_hours.
        if ($r->status === ReturnStatus::Received) {
            $deadline = Carbon::parse($r->received_at)->addHours($staffHours);
        } else {
            $deadline = Carbon::parse($r->staff_approved_at ?? $r->received_at)->addHours($reviewHours);
        }
        $hoursLeft = round(now()->diffInMinutes($deadline, false) / 60, 2);

        return [
            'deadline' => $deadline->format('Y-m-d H:i:s'),
            'hours_left' => $hoursLeft,
            'sla_breached' => $hoursLeft < 0,
        ];
    }

    /** channel_id → mağaza admin sipariş URL şablonu ('%d' = platform sipariş ID); null = link yok. */
    private array $adminOrderUrlMemo = [];

    /**
     * Ticimax kanallı taleplerde mağaza admin panelindeki sipariş detay linki
     * (domain kanalın wsdl_url'inden türetilir). Diğer platformlarda null.
     */
    private function adminOrderUrl(ReturnRequest $r): ?string
    {
        if (! $r->platform_order_id || ! $r->channel_id) {
            return null;
        }

        if (! array_key_exists($r->channel_id, $this->adminOrderUrlMemo)) {
            $template = null;
            $channel = Channel::withoutGlobalScopes()->find($r->channel_id);
            if ($channel && str_starts_with((string) $channel->type, 'ticimax')) {
                $wsdl = $channel->credentials['wsdl_url'] ?? '';
                $parts = parse_url($wsdl);
                if (! empty($parts['host'])) {
                    $template = ($parts['scheme'] ?? 'https') . '://' . $parts['host'] . '/Admin/SiparisDetay.aspx?SID=%s';
                }
            }
            $this->adminOrderUrlMemo[$r->channel_id] = $template;
        }

        $template = $this->adminOrderUrlMemo[$r->channel_id];

        return $template ? sprintf($template, rawurlencode((string) $r->platform_order_id)) : null;
    }

    /**
     * Kargo firmasının takip sayfası — personel statüyü kargo ekranından görsün (kullanıcı isteği
     * 2026-08-03). Takip cron'u sağlayıcının KENDİ takip no'sunu/linkini yakaladıysa o kullanılır
     * (Sürat'ın sitesi kendi numarasını bekler); yoksa bizim gönderi kodumuzla sorgulanır.
     */
    private function cargoTrackingUrl(ReturnRequest $r): ?string
    {
        $code = trim((string) $r->cargo_tracking_code);
        if ($code === '') {
            return null;
        }

        $carrier = $r->metadata['cargo_carrier'] ?? [];
        if (! empty($carrier['tracking_url'])) {
            return (string) $carrier['tracking_url'];
        }
        $lookup = ! empty($carrier['tracking_no']) ? (string) $carrier['tracking_no'] : $code;

        // Tek kaynak: App\Support\CargoTracking (DHL vb. doğrulanmamış sağlayıcıda null).
        return CargoTracking::url((string) $r->cargo_provider, $lookup);
    }

    /**
     * SİPARİŞİN ÖDEME TÜRÜ — 'cod' (kapıda) | 'online' (kart/online) | null (tespit yok).
     *
     * İade YÖNTEMİYLE karıştırılmamalı: yöntem paranın nasıl geri verileceğidir, bu ise müşterinin
     * siparişi nasıl ödediğidir. Kaynak sırası:
     *  1) metadata.cod.is_cod — submit anında (ya da detay açılışındaki backfill'de) canlı ödeme
     *     bloğundan tespit edilmiş kesin bilgi.
     *  2) refund_method bank_transfer/none — bu yöntemler YALNIZCA kapıda ödemede sunulur.
     *  3) refund_method original — karta iade yalnız kartlı/online siparişte sunulur.
     * Hiçbiri yoksa null döner (bu özellikten önce açılmış, kupon seçilmiş eski talepler): panelde
     * "—" görünür ve iki filtreye de girmez — uydurma bir ödeme türü yazmaktansa boş bırakılır.
     */
    private function paymentType(ReturnRequest $r): ?string
    {
        if ((bool) data_get($r->metadata, 'cod.is_cod', false)
            || in_array($r->refund_method, [RefundMethod::BankTransfer, RefundMethod::None], true)) {
            return 'cod';
        }

        if (data_get($r->metadata, 'cod') !== null || $r->refund_method === RefundMethod::Original) {
            return 'online';
        }

        return null;
    }

    private static function paymentTypeLabel(?string $type): ?string
    {
        return match ($type) {
            'cod' => 'Kapıda Ödeme',
            'online' => 'Kartlı / Online Ödeme',
            default => null,
        };
    }

    private function listRow(ReturnRequest $r, int $reviewHours, int $staffHours): array
    {
        $row = [
            'id' => $r->id,
            'public_code' => $r->public_code,
            'type' => $r->type->value,
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'order_no' => $r->order_no,
            'customer_name' => $r->customer_name,
            'customer_email' => $r->customer_email,
            'currency' => $r->currency,
            'requested_amount' => (float) $r->requested_amount,
            'approved_amount' => $r->approved_amount !== null ? (float) $r->approved_amount : null,
            'items_count' => $r->items_count,
            'created_at' => optional($r->created_at)->format('Y-m-d H:i:s'),
            'timer' => $this->timer($r, $reviewHours, $staffHours),
            'cargo_provider' => $r->cargo_provider,
            'cargo_tracking_code' => $r->cargo_tracking_code,
            'cargo_tracking_url' => $this->cargoTrackingUrl($r),
            // Paket üzerindeki barkod (takip no'dan farklı) — depo eşleştirmesi için listede gösterilir.
            'cargo_barcode' => $r->metadata['cargo_carrier']['barcode'] ?? null,
            // Kargo kodu ÜRETİLEMEDİ (sağlayıcı hatası) → talep kodsuz Pending'de takılı kalır ve
            // müşteri talep numarasını kargo kodu sanıp şubeye gidebilir. 6-7 Eylül olayında 10 gün
            // fark edilmedi → listede kırmızı rozetle görünsün, personel tek tıkla yeniden denesin.
            'cargo_error' => $r->cargo_tracking_code === null
                ? array_filter([
                    'error' => data_get($r->metadata, 'cargo_error.error'),
                    'at' => data_get($r->metadata, 'cargo_error.at'),
                    'retry_count' => data_get($r->metadata, 'cargo_retry.count'),
                    'giving_up' => data_get($r->metadata, 'cargo_retry.giving_up') ? true : null,
                ]) ?: null
                : null,
            'refund_method' => $r->refund_method?->value,
            'refund_method_label' => $r->refund_method?->label(),
            // Kapıda ödeme: talep açılırken canlı ödeme bloğundan tespit edildi. Bu özellikten önce
            // açılmış taleplerde bayrak yoktur → havale/iadesiz yöntem de kapıda ödemeyi ele verir.
            'is_cod' => (bool) data_get($r->metadata, 'cod.is_cod', false)
                || in_array($r->refund_method, [RefundMethod::BankTransfer, RefundMethod::None], true),
            'cod_fee' => (float) data_get($r->metadata, 'cod.fee', 0),
            // Ödeme türü (listede kolon olarak gösterilir + filtrelenir): cod | online | null(bilinmiyor).
            'payment_type' => $this->paymentType($r),
            'payment_type_label' => self::paymentTypeLabel($this->paymentType($r)),
            // Havale bilgisi listede/onay pencerelerinde de görünür (personel onay anında görmeli).
            'bank_account' => data_get($r->metadata, 'bank_account'),
            'platform_order_id' => $r->platform_order_id,
            'admin_order_url' => $this->adminOrderUrl($r),
            // Depoya teslim bilgisi (kargo firmasından): tarih+saat, teslim alan, teslim yeri.
            'received_at' => optional($r->received_at)->format('Y-m-d H:i:s'),
            'delivery' => $r->metadata['delivery'] ?? null,
            // PERSONEL KAYNAKLI eksik/hatalı ürün iadesi (ReturnType::Shortage): kim açtı, kapsam,
            // personel notu, Ticimax izleri ve para sonrası özür kuponu — liste rozeti + onay penceresi.
            'created_by_name' => $r->relationLoaded('creator') ? $r->creator?->name : null,
            'shortage' => $r->type === ReturnType::Shortage ? [
                // pre_ship = depo çıkaramadı (gönderim öncesi) · delivered = teslimat sonrası müşteri bildirimi
                'stage' => ($st = (string) data_get($r->metadata, 'shortage.stage', \App\Services\Returns\ShortageService::STAGE_PRE_SHIP)),
                'stage_label' => \App\Services\Returns\ShortageService::STAGE_LABELS[$st] ?? $st,
                'is_full' => (bool) data_get($r->metadata, 'shortage.is_full', false),
                'staff_note' => data_get($r->metadata, 'shortage.staff_note'),
                'summary' => data_get($r->metadata, 'shortage.summary'),
                'created_by_name' => data_get($r->metadata, 'shortage.created_by_name') ?: ($r->relationLoaded('creator') ? $r->creator?->name : null),
                'ticimax' => $this->ticimaxShortageView(data_get($r->metadata, 'ticimax_shortage')),
                'apology_coupon' => ($c = data_get($r->metadata, 'apology_coupon')) && is_array($c) ? [
                    'success' => (bool) ($c['success'] ?? false),
                    'code' => $c['code'] ?? null,
                    'amount' => (float) ($c['amount'] ?? 0),
                    'days' => (int) ($c['days'] ?? 0),
                    'dry_run' => (bool) ($c['dry_run'] ?? false),
                    'error' => $c['error'] ?? null,
                ] : null,
            ] : null,
        ];

        // Satır içi onay/red ekranı (liste) için kalem + görsel özeti — yalnız eager-load edildiyse.
        if ($r->relationLoaded('items')) {
            $row['items'] = $r->items->map(fn ($it) => [
                'id' => $it->id,
                'product_name' => $it->product_name,
                'sku' => $it->sku,
                'barcode' => $it->barcode,
                'variant_info' => $it->variant_info,
                'image_url' => $it->image_url,
                'qty_ordered' => $it->qty_ordered,
                'qty_requested' => $it->qty_requested,
                'qty_approved' => $it->qty_approved,
                'unit_price' => (float) $it->unit_price,
                'refundable_amount' => (float) $it->refundable_amount,
                'reason_code' => $it->reason_code,
                'reason_note' => $it->reason_note,
                'item_condition' => $it->item_condition,
            ])->values();
        }
        if ($r->relationLoaded('attachments')) {
            $row['attachments'] = $r->attachments->map(fn ($a) => [
                'id' => $a->id,
                'kind' => $a->kind,
                'url' => route('returns.attachment.download', ['id' => $r->id, 'attachment' => $a->id]),
            ])->values();
        }
        // Personel notları: para onayı pencerelerinde ZORUNLU görünür (kullanıcı kararı 2026-07-31).
        if ($r->relationLoaded('staffNotes')) {
            $row['staff_notes'] = $this->staffNoteViews($r);
        }

        return $row;
    }

    /** metadata.ticimax_shortage → panelde okunur kısa özet (ne yazıldı / ne atlandı). */
    private function ticimaxShortageView(?array $t): ?array
    {
        if (! is_array($t)) {
            return null;
        }
        $lines = [];
        if (! empty($t['skipped'])) {
            $lines[] = ['ok' => null, 'text' => (string) $t['skipped']];
        }
        if (is_array($t['order_status'] ?? null)) {
            $os = $t['order_status'];
            $lines[] = ['ok' => (bool) ($os['success'] ?? false), 'text' => 'Sipariş statüsü → ' . ($os['durum'] ?? '?') . (($os['dry_run'] ?? false) ? ' (dry-run)' : '') . (! empty($os['error']) ? ': ' . $os['error'] : '')];
        } elseif (($t['enabled'] ?? false) && empty($t['skipped'])) {
            $lines[] = ['ok' => true, 'text' => 'Sipariş statüsü değiştirilmedi (kısmi — kalan ürünler kargolanacak).'];
        }
        if (is_array($t['items'] ?? null)) {
            $it = $t['items'];
            if (! empty($it['skipped'])) {
                $lines[] = ['ok' => null, 'text' => 'Kalem işaretleme: ' . $it['skipped']];
            } else {
                $n = count((array) ($it['marked'] ?? []));
                $lines[] = ['ok' => empty($it['errors']), 'text' => "Kalem işaretlendi: {$n}" . (($it['dry_run'] ?? false) ? ' (dry-run)' : '') . (! empty($it['errors']) ? ' — ' . implode(' | ', $it['errors']) : '')];
            }
        }
        if (is_array($t['note'] ?? null)) {
            $nt = $t['note'];
            if (! empty($nt['skipped'])) {
                $lines[] = ['ok' => null, 'text' => 'Not: ' . $nt['skipped']];
            } else {
                $lines[] = ['ok' => (bool) ($nt['success'] ?? false), 'text' => 'Ticimax özel alan ' . ($nt['field'] ?? '?') . ' notu' . (($nt['dry_run'] ?? false) ? ' (dry-run)' : '') . (! empty($nt['error']) ? ': ' . $nt['error'] : ' yazıldı')];
            }
        }

        return ['dry_run' => (bool) ($t['dry_run'] ?? false), 'lines' => $lines];
    }

    private function detail(ReturnRequest $r, int $reviewHours, int $staffHours): array
    {
        return array_merge($this->listRow($r, $reviewHours, $staffHours), [
            'customer_phone' => $r->customer_phone,
            'refund_method' => $r->refund_method?->value,
            'paid_amount_snapshot' => $r->paid_amount_snapshot !== null ? (float) $r->paid_amount_snapshot : null,
            'refunded_amount' => (float) $r->refunded_amount,
            'reject_reason' => $r->reject_reason,
            'cargo_tracking_code' => $r->cargo_tracking_code,
            'staff_approved_by' => $r->staffApprover?->name,
            'staff_approved_at' => optional($r->staff_approved_at)->format('Y-m-d H:i:s'),
            'manager_approved_by' => $r->managerApprover?->name,
            'manager_approved_at' => optional($r->manager_approved_at)->format('Y-m-d H:i:s'),
            'eligibility_snapshot' => $r->eligibility_snapshot,
            // Sepet kampanyası telafisi (submit anındaki hesaptan): iade tutarından düşülen geri
            // alınan kampanya indirimi + indirimi pasifleşen (sepette kalan) ürün adı.
            'campaign_recovery' => round((float) ($r->metadata['calculation']['breakdown']['campaign_recovery'] ?? 0), 2),
            'campaign_revoked_from' => $r->metadata['calculation']['breakdown']['campaign_revoked_from'] ?? null,
            // İade hesabı açıklaması (talep anındaki hesap): kalem bazında liste → indirimler → ödenen
            // → kupon payı → kademe düzeltmesi → iade. 10 Eki 2026 öncesi taleplerde 'explain' yok.
            'calculation' => isset($r->metadata['calculation']) ? [
                'lines' => array_values((array) ($r->metadata['calculation']['lines'] ?? [])),
                'items_refundable' => (float) ($r->metadata['calculation']['items_refundable'] ?? 0),
                'shipping_refundable' => (float) ($r->metadata['calculation']['shipping_refundable'] ?? 0),
                'total_refundable' => (float) ($r->metadata['calculation']['total_refundable'] ?? 0),
                'capped' => (bool) ($r->metadata['calculation']['capped'] ?? false),
                'breakdown' => (array) ($r->metadata['calculation']['breakdown'] ?? []),
            ] : null,
            // Kusur bildirimi: müşterinin şikâyet metni + yönetici red ekranı için tanımlı nedenler.
            'complaint' => $r->metadata['complaint'] ?? null,
            'defect_reject_reasons' => $r->type === ReturnType::Defect
                ? array_values((array) ($this->resolveRules()['defect_reject_reasons'] ?? []))
                : null,
            // Kargo/işlem adımları yalnızca İADE akışında manuel ilerletilir. İPTAL yönetici onayıyla
            // yürür (Nebim+Ticimax onayda çalışır) → iptalde manuel geçiş butonu gösterilmez.
            // KUSUR kararı (defect_review) yalnızca yönetici uçlarından → geçiş butonu gösterilmez.
            // Kapanmış talep (müşteri vazgeçti) → 'Depoya ulaştı' yeniden açma: kodu hiç üretilmemiş kusur hariç.
            'allowed_transitions' => ($r->type === ReturnType::Cancel || $r->status === ReturnStatus::DefectReview
                || ($r->status === ReturnStatus::CancelledByCustomer && $r->type !== ReturnType::Return
                    && ! ($r->type === ReturnType::Defect && ! empty($r->cargo_tracking_code)))) ? [] : array_values(array_map(
                fn (ReturnStatus $s) => ['value' => $s->value, 'label' => $s->label()],
                array_filter(
                    ReturnStatus::transitions()[$r->status->value] ?? [],
                    fn (ReturnStatus $s) => in_array($s->value, self::TRANSITION_TARGETS, true),
                )
            )),
        ]);
    }
}
