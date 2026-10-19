<?php

namespace App\Services\Returns;

use App\Enums\RefundMethod;
use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Models\ReturnRequestItem;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Returns\Payment\CodDetector;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * EKSİK / HATALI ÜRÜN İADESİ — PERSONEL BAŞLATIR (kullanıcı talebi 2026-09-23).
 *
 * Senaryo: depo siparişi çıkaramıyor (eksik ürün / hatalı ürün / stok hatası), müşteri aranır,
 * yeni ürün istemezse gönderilemeyen kalem(ler) için para iadesi yapılır; KALAN ürünler
 * kargolanır. Müşteri değil, tenant personeli işlem yapar (hub → İade Yönetimi → Eksik/Hatalı Ürün).
 *
 * Akış:
 *   lookup  → sipariş no VEYA Ticimax sipariş ID ile canlı sipariş + kalemler + uygunluk
 *   preview → seçilen kalemler için sunucu tarafı iade hesabı (RefundCalculator)
 *   create  → ReturnRequest(type=shortage) DOĞRUDAN `staff_approved` (kargo/depo adımı yok;
 *             personel zaten ürünü elinde tutuyor) → yönetici PARA onayı kuyruğuna düşer.
 *             Kapıda ödemeli siparişte tahsilat yok → refund_method=none, talep anında Completed.
 *
 * Ticimax (best-effort, sonuç metadata.ticimax_shortage):
 *   - Sipariş STATÜSÜ DEĞİŞMEZ (sipariş yine kargoya verilecek) — yalnız seçim TÜM siparişi
 *     kapsıyorsa iptal gibi davranılır ve statü `cancel_status` (Iptal) yazılır.
 *   - Kalem işaretleme: tenant `shortage.item_durum_id` tanımlıysa SetSiparisUrunDurum.
 *   - Personel notu: Ticimax'ta not API'si yok → sipariş ÖZEL ALANI'na (OzelAlanN) satır eklenir.
 *   - Nebim'e HİÇBİR yazma yok (kullanıcı kararı).
 *
 * Para onayı sonrası (RefundService finalize*): kısmi kapsamda Ticimax statüsü YİNE değişmez;
 * müşteriye ÖZÜR SMS'i + özel indirim kuponu ({@see afterSettled}).
 *
 * İKİ AŞAMA (metadata.shortage.stage — sipariş durumundan OTOMATİK seçilir, kullanıcı talebi 2026-09-25):
 *   - `pre_ship`  → sipariş HENÜZ GÖNDERİLMEMİŞ (cancellable_statuses, takip no yok): yukarıdaki akış.
 *   - `delivered` → sipariş KARGODA/TESLİM EDİLMİŞ (durum 6 veya returnable_statuses) ve müşteri paketin
 *                   eksik/hatalı geldiğini bildirdi, personel inceledi: aynı para akışı (staff_approved →
 *                   yönetici para onayı → karta iade + 100 TL kupon) AMA Ticimax'a HİÇBİR yazma yapılmaz
 *                   (statü/kalem/not yok; para sonrası statü de yazılmaz) ve SMS daha genel bir özür
 *                   metnidir (`shortage_delivered_refunded`). Kargo ücreti pre_ship ile AYNI kuralla
 *                   iade edilir (tam kapsamda; kullanıcı kararı 2026-10-05: hata firmada, kesilmez).
 *
 * ÜÇÜNCÜ SENARYO — GERİ DÖNEN SİPARİŞ (`returned`, kullanıcı talebi 2026-10-05): firmadan çıkan paket
 * müşteriye teslim edilemeyip DEPOYA GERİ DÖNDÜ. Sipariş durumundan otomatik SEÇİLMEZ; ayrı sayfadan
 * (/returns/returned, sayfa izni `returns_returned`) personel başlatır ($mode = 'returned'). Aynı para
 * akışı (staff_approved → yönetici para onayı) AMA müşteriye HİÇBİR bildirim gitmez (SMS yok, kupon yok —
 * {@see ReturnNotifier::notify} bu aşamada sessizdir) ve Ticimax'a talep açılırken yazılmaz; para onayı
 * tamamlanınca (tam kapsamda) sipariş statüsü `cancel_status` (Iptal) yapılır.
 */
class ShortageService
{
    public const STAGE_PRE_SHIP = 'pre_ship';
    public const STAGE_DELIVERED = 'delivered';
    public const STAGE_RETURNED = 'returned';

    public const STAGE_LABELS = [
        self::STAGE_PRE_SHIP => 'Gönderim öncesi (depo çıkaramadı)',
        self::STAGE_DELIVERED => 'Teslimat sonrası (müşteri eksik/hatalı bildirdi)',
        self::STAGE_RETURNED => 'Geri dönen sipariş (paket teslim edilemedi, depoya döndü)',
    ];

    /** Geri dönen sipariş taleplerinin panelde görünen tür adı (Eksik/Hatalı'dan ayırt edilsin). */
    public const RETURNED_TYPE_LABEL = 'Geri Dönen Sipariş';

    /** Tüm neden kodları (controller doğrulaması); aşama bazlı alt küme aşağıda. */
    public const REASON_CODES = ['missing', 'defective_stock', 'stock_error', 'wrong_item', 'not_collected', 'refused', 'address_error', 'returned_other'];

    public const REASON_LABELS = [
        'missing' => 'Eksik ürün',
        'defective_stock' => 'Hatalı / kusurlu ürün',
        'stock_error' => 'Stok hatası',
    ];

    /** Teslimat sonrası aşamada personelin seçebileceği nedenler (müşteri bildirimi). */
    public const REASON_LABELS_DELIVERED = [
        'missing' => 'Eksik gönderilmiş (pakette yok)',
        'defective_stock' => 'Hatalı / kusurlu ürün gelmiş',
        'wrong_item' => 'Yanlış ürün gönderilmiş',
    ];

    /** Geri dönen sipariş: paketin neden geri döndüğü. */
    public const REASON_LABELS_RETURNED = [
        'not_collected' => 'Müşteri teslim almadı / şubeden almadı',
        'refused' => 'Müşteri teslimatı reddetti',
        'address_error' => 'Adres hatalı / müşteriye ulaşılamadı',
        'returned_other' => 'Diğer (kargo geri gönderdi)',
    ];

    public static function reasonLabels(string $stage): array
    {
        return match ($stage) {
            self::STAGE_DELIVERED => self::REASON_LABELS_DELIVERED,
            self::STAGE_RETURNED => self::REASON_LABELS_RETURNED,
            default => self::REASON_LABELS,
        };
    }

    public static function isReturned(ReturnRequest $r): bool
    {
        return $r->type === ReturnType::Shortage && data_get($r->metadata, 'shortage.stage') === self::STAGE_RETURNED;
    }

    /** Tüm kodların birleşik etiketi (özet/not metinlerinde). */
    private static function reasonLabel(?string $code, ?string $stage = null): string
    {
        return self::reasonLabels($stage ?? self::STAGE_PRE_SHIP)[$code] ?? (self::REASON_LABELS_DELIVERED[$code] ?? (self::REASON_LABELS[$code] ?? (self::REASON_LABELS_RETURNED[$code] ?? (string) $code)));
    }

    public function __construct(
        private readonly ReturnRulesService $rules,
        private readonly RefundCalculator $calculator,
        private readonly ReturnAuditLogger $audit,
        private readonly ReturnNotifier $notifier,
        private readonly CodDetector $cod,
        private readonly TicimaxOrderNormalizer $normalizer,
    ) {}

    // ───────────────────────── LOOKUP ─────────────────────────

    /**
     * Sipariş no (TB…) veya Ticimax sipariş ID'si ile canlı sipariş + iade uygunluğu.
     *
     * @return array{success:bool, status?:int, error?:string, order?:array, raw?:array, eligibility?:array, existing?:array, payment?:array, warnings?:array}
     */
    public function lookup(Tenant $tenant, string $ref, ?string $mode = null): array
    {
        $svc = $this->ticimax($tenant);
        if (! $svc) {
            return ['success' => false, 'status' => 503, 'error' => 'Bu firmada aktif Ticimax kanalı yok — eksik/hatalı ürün iadesi yalnız Ticimax mağazalarında kullanılabilir.'];
        }

        $ref = trim($ref);
        $clean = preg_replace('/[^A-Za-z0-9\-_\/]/', '', $ref);
        if ($clean === '') {
            return ['success' => false, 'status' => 422, 'error' => 'Sipariş numarası veya sipariş ID girin.'];
        }

        // Yalnız rakam → önce Ticimax sipariş ID'si, bulunamazsa sipariş no olarak dene.
        $res = null;
        if (ctype_digit($clean)) {
            $res = $svc->getOrderById((int) $clean);
        }
        if (! ($res['success'] ?? false)) {
            $res = $svc->getOrderByNo($clean);
        }
        if (! ($res['success'] ?? false)) {
            return ['success' => false, 'status' => 404, 'error' => 'Sipariş bulunamadı. Sipariş numarasını (TB…) veya Ticimax sipariş ID\'sini kontrol edin.'];
        }

        $raw = $res['order'];
        $order = $this->normalizer->normalize($raw);
        $rules = $this->rules->forTenant($tenant);
        $existing = $this->existingRequests($tenant->id, $order['platform_order_id'], $order['order_no']);
        $eligibility = $this->evaluate($order, $rules, $existing, $mode);
        $cod = $this->cod->forOrder($tenant, $order['platform_order_id']);

        $stage = $eligibility['stage'] ?? null;
        $warnings = [];
        if ($cod['cod'] && $stage === self::STAGE_RETURNED) {
            $warnings[] = 'KAPIDA ÖDEMELİ sipariş: paket teslim edilmediği için tahsilat yapılmadı, para iadesi oluşturulmaz. Talep açılır açılmaz kapanır; siparişin tamamı seçildiyse Ticimax\'ta İptal yapılır.';
        } elseif ($cod['cod']) {
            $warnings[] = $stage === self::STAGE_DELIVERED
                ? 'KAPIDA ÖDEMELİ sipariş: tahsilat kapıda yapıldı, karta iade YOK. Para iadesi gerekiyorsa müşteriden IBAN alıp Havale bölümünden ödeyin; bu ekrandan açılan talep para iadesi oluşturmaz (yalnız özür SMS\'i + kupon).'
                : 'KAPIDA ÖDEMELİ sipariş: henüz tahsilat yapılmadı, para iadesi oluşturulmaz. Kapıda tahsil edilecek tutarı Ticimax\'ta düzeltmeyi unutmayın.';
        }
        if ($stage === self::STAGE_RETURNED) {
            $warnings[] = 'GERİ DÖNEN SİPARİŞ: müşteriye hiçbir bildirim gitmez (SMS/kupon yok). Talep yönetici para onayına düşer; onay sonrası para karta iade edilir ve siparişin tamamı seçildiyse Ticimax statüsü İptal yapılır.';
        }
        if ($stage === self::STAGE_DELIVERED) {
            $warnings[] = 'TESLİMAT SONRASI eksik/hatalı bildirimi: Ticimax\'ta hiçbir güncelleme yapılmaz (statü/kalem); siparişin tamamı iade ediliyorsa kargo ücreti de iadeye eklenir; onayda karta iade + genel özür SMS\'i + kupon gider.';
        }

        // Kalemler: daha önce iade edilmiş adetler düşülür (aynı kalem iki kez iade edilemez).
        // Gönderim öncesi: yalnız önceki eksik/hatalı talepleri; teslimat sonrası: müşteri iadeleri de.
        $prior = $this->priorShortageQty($existing, $stage);
        $items = [];
        foreach ($order['items'] as $it) {
            $lineId = (string) $it['line_id'];
            $used = (int) ($prior[$lineId] ?? 0);
            $items[] = [
                'line_id' => $lineId,
                'name' => $it['name'],
                'sku' => $it['sku'],
                'barcode' => $it['barcode'],
                'variant_info' => $it['variant_info'],
                'image_url' => $it['image_url'],
                'qty' => (int) $it['qty'],
                'qty_available' => max(0, (int) $it['qty'] - $used),
                'qty_prior_shortage' => $used,
                'unit_price' => (float) $it['unit_price'],
                'status_label' => $it['status_label'],
            ];
        }

        return [
            'success' => true,
            'order' => [
                'platform_order_id' => $order['platform_order_id'],
                'order_no' => $order['order_no'],
                'status' => $order['status'],
                'status_label' => $order['status_label'],
                'order_date' => $order['order_date'],
                'currency' => $order['currency'],
                'customer_name' => $order['customer_name'],
                'customer_email' => $order['customer_email'],
                'customer_phone' => $order['customer_phone'],
                'total_amount' => (float) $order['total_amount'],
                'paid_amount' => (float) $order['paid_amount'],
                'shipping_cost' => (float) ($order['shipping_cost'] ?? 0),
                'cargo_company' => $order['cargo_company'],
                'cargo_tracking_no' => $order['cargo_tracking_no'],
                'admin_url' => $this->adminOrderUrl($tenant, $order['platform_order_id']),
                'custom_fields' => [
                    1 => (string) ($raw['OzelAlan1'] ?? ''),
                    2 => (string) ($raw['OzelAlan2'] ?? ''),
                    3 => (string) ($raw['OzelAlan3'] ?? ''),
                ],
                'items' => $items,
            ],
            'eligibility' => $eligibility,
            'existing' => array_map(fn (ReturnRequest $r) => [
                'id' => $r->id,
                'public_code' => $r->public_code,
                'type' => $r->type->value,
                'type_label' => $r->type->label(),
                'status' => $r->status->value,
                'status_label' => $r->status->label(),
                'amount' => (float) ($r->approved_amount ?? $r->requested_amount),
                'created_at' => optional($r->created_at)->format('Y-m-d H:i'),
            ], $existing),
            'payment' => ['cod' => (bool) $cod['cod'], 'cod_fee' => (float) $cod['fee'], 'checked' => (bool) $cod['checked']],
            'stage' => $stage,
            'stage_label' => $stage ? (self::STAGE_LABELS[$stage] ?? $stage) : null,
            'reasons' => self::reasonLabels($stage ?? self::STAGE_PRE_SHIP),
            'warnings' => $warnings,
        ];
    }

    /**
     * Sipariş durumundan aşama: gönderilmemiş (cancellable + takip no yok) → pre_ship;
     * kargoda (6) veya teslim edilmiş (returnable_statuses) → delivered; diğerleri → null.
     */
    public function stageFor(array $order, array $rules): ?string
    {
        $status = (int) ($order['status'] ?? -1);
        $delivered = array_values(array_unique(array_merge([6], (array) ($rules['returnable_statuses'] ?? [7]))));
        if (in_array($status, $delivered, true)) {
            return self::STAGE_DELIVERED;
        }
        if (in_array($status, (array) ($rules['cancellable_statuses'] ?? []), true)) {
            // Kargo takip numarası yazılmışsa paket çıkmış olabilir → teslimat sonrası akış.
            return ! empty($order['cargo_tracking_no']) ? self::STAGE_DELIVERED : self::STAGE_PRE_SHIP;
        }

        return null;
    }

    /**
     * Uygunluk (fail-closed): sipariş KARGOYA VERİLMEMİŞ olmalı (cancellable_statuses) ve sipariş
     * üzerinde açık başka bir talep bulunmamalı. Tamamlanmış müşteri iadesi/iptali varsa da kapalı.
     */
    private function evaluate(array $order, array $rules, array $existing, ?string $mode = null): array
    {
        $reasons = [];
        $status = (int) ($order['status'] ?? -1);
        $stage = $this->stageFor($order, $rules);
        if ($mode === self::STAGE_RETURNED) {
            // Geri dönen sipariş: paket firmadan ÇIKMIŞ olmalı (kargoda/teslim statüsü veya takip no yazılmış).
            $shipped = $stage === self::STAGE_DELIVERED || ! empty($order['cargo_tracking_no']);
            $stage = $shipped ? self::STAGE_RETURNED : null;
        }
        $ok = $stage !== null;
        if (! $ok && $mode === self::STAGE_RETURNED) {
            $reasons[] = 'Bu sipariş kargoya verilmiş görünmüyor (' . ($order['status_label'] ?? $status) . ', kargo takip no yok). Geri dönen sipariş iadesi yalnız firmadan çıkmış siparişlerde açılır; gönderilmemiş sipariş için Eksik / Hatalı Ürün İadesi ekranını kullanın.';
        } elseif (! $ok) {
            $reasons[] = 'Bu sipariş durumunda işlem yapılamıyor (' . ($order['status_label'] ?? $status) . '). Eksik/hatalı ürün iadesi gönderilmemiş, kargodaki veya teslim edilmiş siparişlerde açılır.';
        }

        foreach ($existing as $r) {
            if (! $r->status->isTerminal()) {
                $ok = false;
                $reasons[] = 'Bu siparişte işlemde olan bir talep var: ' . $r->public_code . ' (' . $r->type->label() . ' — ' . $r->status->label() . '). Önce o talep sonuçlanmalı.';
                break;
            }
            // Gönderim öncesi: tamamlanmış müşteri iptali/iadesi varsa sipariş zaten kapanmıştır → kapalı.
            // Teslimat sonrası: müşterinin başka kalemi iade etmiş olması normaldir; adetler kalemden düşülür.
            if ($stage === self::STAGE_PRE_SHIP && $r->type !== ReturnType::Shortage && in_array($r->status, [ReturnStatus::Refunded, ReturnStatus::Completed], true)) {
                $ok = false;
                $reasons[] = 'Bu sipariş için daha önce ' . $r->type->label() . ' tamamlanmış (' . $r->public_code . ').';
                break;
            }
        }

        return ['can_create' => $ok, 'stage' => $stage, 'status' => $status, 'status_label' => $order['status_label'] ?? null, 'reasons' => $reasons];
    }

    /** @return list<ReturnRequest> */
    private function existingRequests(int $tenantId, ?string $platformOrderId, ?string $orderNo): array
    {
        if (! $platformOrderId && ! $orderNo) {
            return [];
        }

        return ReturnRequest::withoutGlobalScopes()
            ->with('items')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($platformOrderId, $orderNo) {
                if ($platformOrderId) {
                    $q->where('platform_order_id', $platformOrderId);
                }
                if ($orderNo) {
                    $q->orWhere('order_no', $orderNo);
                }
            })
            ->orderBy('id')
            ->get()
            ->all();
    }

    /**
     * Daha önce açılmış (reddedilmemiş) taleplerde kalem başına kullanılmış adet.
     * pre_ship: yalnız eksik/hatalı talepleri; delivered: her türden (müşteri iadesi dahil) talep.
     */
    private function priorShortageQty(array $existing, ?string $stage = null): array
    {
        $out = [];
        foreach ($existing as $r) {
            if (in_array($r->status, [ReturnStatus::Rejected, ReturnStatus::CancelledByCustomer], true)) {
                continue;
            }
            if (! in_array($stage, [self::STAGE_DELIVERED, self::STAGE_RETURNED], true) && $r->type !== ReturnType::Shortage) {
                continue;
            }
            foreach ($r->items as $it) {
                $k = (string) $it->platform_line_id;
                $out[$k] = ($out[$k] ?? 0) + (int) ($it->qty_approved ?? $it->qty_requested);
            }
        }

        return $out;
    }

    // ───────────────────────── PREVIEW / CREATE ─────────────────────────

    /**
     * Seçim için sunucu hesabı. Kampanya telafisi UYGULANMAZ (hata firmada, müşteri cezalandırılmaz);
     * kargo ücreti TAM kapsamda ve `refund_shipping_cancel` kuralı açıksa iade edilir — teslimat
     * sonrası aşamada da (kullanıcı kararı 2026-10-05: hata firmada, kargo müşteriden kesilmez).
     *
     * @param  array<int,array{line_id:string,qty:int}>  $selections
     * @return array{success:bool, error?:string, calc?:array, is_full?:bool}
     */
    public function preview(Tenant $tenant, array $order, array $selections, ?string $mode = null): array
    {
        $rules = $this->rules->forTenant($tenant);
        $isFull = $this->coversFullOrder($order, $selections);
        $stage = $mode === self::STAGE_RETURNED ? self::STAGE_RETURNED : ($this->stageFor($order, $rules) ?? self::STAGE_PRE_SHIP);

        try {
            $calc = $this->calculator->calculate($order, $selections, [
                'refund_shipping' => $isFull && (bool) ($rules['refund_shipping_cancel'] ?? true),
                'campaign_recovery' => false,
                'cap' => $order['paid_amount'],
            ]);
        } catch (\InvalidArgumentException $e) {
            return ['success' => false, 'error' => 'Seçim geçersiz: ' . $e->getMessage()];
        }

        return ['success' => true, 'calc' => $calc, 'is_full' => $isFull, 'stage' => $stage, 'rules' => $rules];
    }

    /**
     * Normalize edilmiş siparişi ID/No ile yeniden getirir (istemciden gelen kalem verisine güvenilmez).
     *
     * @return array{success:bool, status?:int, error?:string, order?:array, raw?:array}
     */
    public function fetchOrder(Tenant $tenant, string $platformOrderId): array
    {
        $svc = $this->ticimax($tenant);
        if (! $svc) {
            return ['success' => false, 'status' => 503, 'error' => 'Aktif Ticimax kanalı yok.'];
        }
        $res = ctype_digit($platformOrderId) ? $svc->getOrderById((int) $platformOrderId) : ['success' => false];
        if (! ($res['success'] ?? false)) {
            return ['success' => false, 'status' => 404, 'error' => 'Sipariş bulunamadı.'];
        }

        return ['success' => true, 'order' => $this->normalizer->normalize($res['order']), 'raw' => $res['order']];
    }

    /**
     * Talebi oluşturur: staff_approved (para onayı bekler) — kapıda ödemede completed (iade yok).
     *
     * @param  array<int,array{line_id:string,qty:int,reason_code:string,reason_note?:?string}>  $lines
     * @return array{success:bool, status?:int, error?:string, request?:ReturnRequest, ticimax?:array, settled?:array}
     */
    public function create(Tenant $tenant, User $actor, array $order, array $raw, array $lines, ?string $staffNote, ?string $mode = null): array
    {
        $rules = $this->rules->forTenant($tenant);
        $existing = $this->existingRequests($tenant->id, $order['platform_order_id'], $order['order_no']);
        $eligibility = $this->evaluate($order, $rules, $existing, $mode);
        if (! $eligibility['can_create']) {
            return ['success' => false, 'status' => 422, 'error' => implode(' ', $eligibility['reasons']) ?: 'Bu sipariş için işlem uygun değil.'];
        }

        // Kalem doğrulama: sipariş satırı var, adet ≤ kalan (önceki eksik iadeleri düşülmüş), neden geçerli.
        $itemsByLine = [];
        foreach ($order['items'] as $oi) {
            $itemsByLine[(string) $oi['line_id']] = $oi;
        }
        $stage = (string) ($eligibility['stage'] ?? self::STAGE_PRE_SHIP);
        $allowedReasons = array_keys(self::reasonLabels($stage));
        $prior = $this->priorShortageQty($existing, $stage);
        $selections = [];
        $byLine = [];
        foreach ($lines as $ln) {
            $lineId = (string) $ln['line_id'];
            $qty = (int) $ln['qty'];
            $oi = $itemsByLine[$lineId] ?? null;
            if (! $oi) {
                return ['success' => false, 'status' => 422, 'error' => "Sipariş satırı bulunamadı ({$lineId})."];
            }
            $avail = (int) $oi['qty'] - (int) ($prior[$lineId] ?? 0);
            if ($qty < 1 || $qty > $avail) {
                return ['success' => false, 'status' => 422, 'error' => ($oi['name'] ?? $lineId) . " için adet geçersiz (en fazla {$avail})."];
            }
            if (! in_array((string) ($ln['reason_code'] ?? ''), $allowedReasons, true)) {
                return ['success' => false, 'status' => 422, 'error' => ($oi['name'] ?? $lineId) . ' için geçerli bir neden seçilmeli (' . implode(' / ', self::reasonLabels($stage)) . ').'];
            }
            if (isset($byLine[$lineId])) {
                return ['success' => false, 'status' => 422, 'error' => 'Aynı kalem birden fazla kez seçilemez.'];
            }
            $byLine[$lineId] = $ln;
            $selections[] = ['line_id' => $lineId, 'qty' => $qty];
        }
        if (! $selections) {
            return ['success' => false, 'status' => 422, 'error' => 'En az bir ürün seçin.'];
        }

        $pv = $this->preview($tenant, $order, $selections, $mode);
        if (! $pv['success']) {
            return ['success' => false, 'status' => 422, 'error' => $pv['error']];
        }
        $calc = $pv['calc'];
        $isFull = (bool) $pv['is_full'];
        $cod = $this->cod->forOrder($tenant, $order['platform_order_id']);
        $isCod = (bool) $cod['cod'];

        $created = DB::transaction(function () use ($tenant, $actor, $order, $calc, $rules, $eligibility, $byLine, $itemsByLine, $isFull, $isCod, $cod, $staffNote, $stage) {
            // Aynı sipariş için eşzamanlı oluşturma yarışını serileştir (public submit ile aynı kilit anahtarı).
            $lockKey = $tenant->id . ':' . ($order['platform_order_id'] ?: $order['order_no']);
            DB::select('select pg_advisory_xact_lock(hashtext(?))', [$lockKey]);
            $again = $this->existingRequests($tenant->id, $order['platform_order_id'], $order['order_no']);
            foreach ($again as $x) {
                if (! $x->status->isTerminal()) {
                    return null;
                }
            }

            $rr = new ReturnRequest();
            $rr->tenant_id = $tenant->id;
            $rr->channel_id = $this->ticimaxChannel($tenant)?->id;
            $rr->type = ReturnType::Shortage;
            $rr->public_code = $this->generatePublicCode($tenant, $stage);
            // Kargo/depo adımı yok: ürün zaten firmada → doğrudan personel onaylı (para onayı bekler).
            // Kapıda ödeme: tahsilat yok → iade edilecek para yok → anında tamamlanır.
            $rr->status = $isCod ? ReturnStatus::Completed : ReturnStatus::StaffApproved;
            $rr->platform_order_id = $order['platform_order_id'];
            $rr->order_no = $order['order_no'];
            $rr->customer_name = $order['customer_name'];
            $rr->customer_email = $order['customer_email'];
            $rr->customer_phone = $order['customer_phone'] ?? null;
            $rr->currency = $order['currency'];
            $rr->refund_method = $isCod ? RefundMethod::None : RefundMethod::Original;
            $rr->requested_amount = $calc['total_refundable'];
            $rr->approved_amount = $isCod ? 0 : $calc['total_refundable'];
            $rr->refunded_amount = 0;
            $rr->paid_amount_snapshot = $order['paid_amount'];
            $rr->eligibility_snapshot = $eligibility;
            $rr->staff_approved_by = $actor->id;
            $rr->staff_approved_at = now();
            $rr->created_by = $actor->id;
            $rr->metadata = array_filter([
                'calculation' => $calc,
                'rules' => $rules,
                'customer_address' => $order['customer_address'] ?? null,
                'cod' => $cod['checked'] ? ['is_cod' => $isCod, 'fee' => (float) $cod['fee'], 'method_code' => $cod['method_code']] : null,
                'shortage' => [
                    'stage' => $stage,
                    'is_full' => $isFull,
                    'staff_note' => $staffNote !== null && trim($staffNote) !== '' ? trim($staffNote) : null,
                    'created_by_name' => $actor->name,
                    // Kayıt Yunbi tarafında (Ticimax'a not yazılmaz — kullanıcı kararı 2026-09-23).
                    'summary' => null,
                ],
            ], fn ($v) => $v !== null);
            $rr->save();

            $refundByLine = [];
            foreach ($calc['lines'] as $line) {
                $refundByLine[(string) $line['line_id']] = $line;
            }
            foreach ($byLine as $lineId => $sel) {
                $oi = $itemsByLine[$lineId];
                $line = $refundByLine[$lineId] ?? null;
                ReturnRequestItem::create([
                    'tenant_id' => $tenant->id,
                    'return_request_id' => $rr->id,
                    'platform_line_id' => $lineId,
                    'platform_product_id' => $oi['platform_product_id'] ?? null,
                    'platform_variant_id' => $oi['platform_variant_id'] ?? null,
                    'product_name' => $oi['name'] ?? null,
                    'sku' => $oi['sku'] ?? null,
                    'barcode' => $oi['barcode'] ?? null,
                    'variant_info' => $oi['variant_info'] ?? null,
                    'image_url' => $oi['image_url'] ?? null,
                    'qty_ordered' => $oi['qty'] ?? 0,
                    'qty_requested' => (int) $sel['qty'],
                    'qty_approved' => (int) $sel['qty'],
                    'unit_price' => $oi['unit_price'] ?? 0,
                    'line_discount_share' => $line['discount_share'] ?? 0,
                    'refundable_amount' => $line['refundable'] ?? 0,
                    'reason_code' => $sel['reason_code'],
                    'reason_note' => isset($sel['reason_note']) && trim((string) $sel['reason_note']) !== '' ? trim((string) $sel['reason_note']) : null,
                    'item_condition' => match ($stage) {
                        self::STAGE_DELIVERED => 'not_delivered',
                        self::STAGE_RETURNED => 'returned_to_sender',
                        default => 'not_shipped',
                    },
                ]);
            }

            $this->audit->log($rr, 'submit', [
                'actor_type' => ReturnActorType::Staff,
                'actor_id' => $actor->id,
                'to_status' => $rr->status->value,
                'amount' => $calc['total_refundable'],
                'payload' => [
                    'type' => ReturnType::Shortage->value,
                    'source' => 'staff',
                    'stage' => $stage,
                    'is_full' => $isFull,
                    'refund_method' => $rr->refund_method->value,
                    'items' => array_map(fn ($l) => ['line_id' => $l['line_id'], 'qty' => $l['qty_returned'], 'refundable' => $l['refundable']], $calc['lines']),
                    'note' => $staffNote ?: null,
                ],
            ]);
            if ($staffNote !== null && trim($staffNote) !== '') {
                // Personel notu: onay pencerelerinde ZORUNLU görünen not listesine de düşsün.
                $this->audit->log($rr, 'staff_note', [
                    'actor_type' => ReturnActorType::Staff,
                    'actor_id' => $actor->id,
                    'payload' => ['note' => trim($staffNote)],
                ]);
            }
            $this->audit->log($rr, 'staff_approve', [
                'actor_type' => ReturnActorType::Staff,
                'actor_id' => $actor->id,
                'from_status' => ReturnStatus::Pending->value,
                'to_status' => $rr->status->value,
                'amount' => (float) $rr->approved_amount,
                'payload' => ['auto' => true, 'reason' => $isCod
                    ? 'Kapıda ödeme — kart tahsilatı yok, iade edilecek tutar yok.'
                    : match ($stage) {
                        self::STAGE_DELIVERED => 'Teslimat sonrası eksik/hatalı bildirimi: personel inceledi, depo/kargo adımı yok.',
                        self::STAGE_RETURNED => 'Geri dönen sipariş: paket depoya döndü, personel kaydetti; depo/kargo adımı yok.',
                        default => 'Eksik/hatalı ürün: ürün firmada, depo/kargo adımı atlandı.',
                    }],
            ]);

            return $rr;
        });

        if (! $created) {
            return ['success' => false, 'status' => 409, 'error' => 'Bu sipariş için işlemde olan başka bir talep var.'];
        }
        $created->setRelation('tenant', $tenant);
        $created->load('items');

        // İşlem özeti Yunbi tarafında saklanır (Ticimax özel alanına YAZILMAZ — o alan başka amaçla kullanılıyor).
        $meta = $created->metadata;
        $meta['shortage']['summary'] = $this->noteLine($created, $actor);
        $created->metadata = $meta;
        $created->save();

        // Ticimax: kalem işaretleme (+ TAM kapsamda iptal statüsü). Best-effort.
        $ticimax = $this->applyTicimax($created, $raw, $actor);

        // Kapıda ödeme: para hareketi yok → özür SMS'i + kupon hemen gider.
        $settled = null;
        if ($created->status === ReturnStatus::Completed) {
            $this->audit->log($created, 'closed_without_refund', [
                'actor_type' => ReturnActorType::System,
                'from_status' => ReturnStatus::StaffApproved->value,
                'to_status' => ReturnStatus::Completed->value,
                'amount' => 0,
                'payload' => ['reason' => 'Kapıda ödemeli sipariş — tahsilat yapılmadığı için iade edilecek tutar yok.'],
            ]);
            $settled = $this->afterSettled($created, 0.0, false);
        }

        return ['success' => true, 'request' => $created, 'ticimax' => $ticimax, 'settled' => $settled];
    }

    // ───────────────────────── TİCİMAX ─────────────────────────

    /**
     * Sipariş üzerinde Ticimax izleri:
     *  - TAM kapsam → sipariş statüsü `cancel_status` (Iptal) — sipariş hiç gönderilmeyecek.
     *  - KISMİ kapsam → statüye DOKUNULMAZ (kalan ürünler kargoya verilecek).
     *  - Kalem işaretleme (SetSiparisUrunDurum) — tenant kodu tanımlıysa.
     *  - Özel alana bilgi notu (UpdateSiparisOzelAlanlar) — personel notu API'si olmadığı için.
     * Ticimax yazma kapalı / dry-run ise SOAP çağrısı yapılmaz, payload loglanır.
     */
    private function applyTicimax(ReturnRequest $r, array $raw, User $actor): array
    {
        $tcfg = $this->ticimaxConfig($r->tenant);
        $scfg = $this->config($r->tenant);
        $enabled = (bool) ($tcfg['enabled'] ?? false);
        $dryRun = (bool) ($tcfg['dry_run'] ?? true);
        $isFull = (bool) data_get($r->metadata, 'shortage.is_full', false);

        $out = ['enabled' => $enabled, 'dry_run' => $dryRun, 'order_status' => null, 'items' => null, 'note' => null];
        if (data_get($r->metadata, 'shortage.stage') === self::STAGE_RETURNED) {
            // Kullanıcı kararı 2026-10-05: geri dönen siparişte Ticimax'a talep anında yazılmaz;
            // sipariş statüsü para onayı tamamlanınca İptal yapılır ({@see applyReturnedCancel}).
            $out['skipped'] = 'Geri dönen sipariş — Ticimax statüsü yönetici para onayından sonra İptal yapılır.';
            $this->storeTicimaxResult($r, $out);

            return $out;
        }
        if (data_get($r->metadata, 'shortage.stage') === self::STAGE_DELIVERED) {
            // Kullanıcı kararı 2026-09-25: teslimat sonrası eksik/hatalı bildiriminde Ticimax'a HİÇBİR yazma yok.
            $out['skipped'] = 'Teslimat sonrası bildirim — Ticimax\'ta güncelleme yapılmaz (kullanıcı kararı).';
            $this->storeTicimaxResult($r, $out);

            return $out;
        }
        if (! $enabled) {
            $out['skipped'] = 'Ticimax yazma kapalı (returns_integrations.ticimax.enabled=false).';
            $this->storeTicimaxResult($r, $out);

            return $out;
        }

        $svc = $dryRun ? null : $this->ticimax($r->tenant);
        if (! $dryRun && ! $svc) {
            $out['skipped'] = 'Ticimax kanalı bulunamadı.';
            $this->storeTicimaxResult($r, $out);

            return $out;
        }
        $log = Log::channel(config('returns.log_channel', 'stack'));
        $sid = (int) $r->platform_order_id;

        // 1) TAM kapsam → iptal statüsü
        if ($isFull) {
            $status = (string) ($tcfg['cancel_status'] ?? 'Iptal');
            if ($dryRun) {
                $log->info('[Ticimax][DRY-RUN] shortage full → statü (gönderilmedi)', ['return_id' => $r->id, 'durum' => $status]);
                $out['order_status'] = ['success' => true, 'dry_run' => true, 'durum' => $status];
            } else {
                $res = $svc->setOrderStatus($sid, $status, (bool) ($tcfg['notify_customer'] ?? false), (string) $r->order_no);
                $out['order_status'] = ['success' => (bool) $res['success'], 'dry_run' => false, 'durum' => $status, 'error' => $res['error'] ?? null];
            }
        }

        // 2) Kalem işaretleme — varsayılan: iptal akışının kanıtlı kalem kodu (ticimax.item_durum_id/item_islem,
        //    t1'de 2/2 = "İptal Edildi"; kısmi iptallerde canlıda çalışıyor). Tenant isterse shortage.item_durum_id
        //    ile farklı bir kalem durumu (örn. "Gönderilemedi") tanımlayabilir.
        $durumId = (int) ($scfg['item_durum_id'] ?? 0) ?: (int) ($tcfg['item_durum_id'] ?? 0);
        $islem = (int) ($scfg['item_durum_id'] ?? 0) ? (int) ($scfg['item_islem'] ?? 0) : (int) ($tcfg['item_islem'] ?? 0);
        if ($durumId > 0) {
            $marked = [];
            $errors = [];
            foreach ($r->items as $it) {
                if (! ctype_digit((string) $it->platform_line_id)) {
                    continue;
                }
                $payload = ['SiparisUrunID' => (int) $it->platform_line_id, 'Adet' => (float) $it->qty_requested];
                if ($dryRun) {
                    $marked[] = $payload;

                    continue;
                }
                $res = $svc->setOrderItemStatus($sid, $payload['SiparisUrunID'], $payload['Adet'], $durumId, $islem);
                if ($res['success']) {
                    $marked[] = $payload;
                } else {
                    $errors[] = 'Kalem ' . $payload['SiparisUrunID'] . ': ' . ($res['error'] ?? 'hata');
                }
            }
            if ($dryRun) {
                $log->info('[Ticimax][DRY-RUN] shortage item_status (gönderilmedi)', ['return_id' => $r->id, 'durum_id' => $durumId, 'islem' => $islem, 'items' => $marked]);
            }
            $out['items'] = ['durum_id' => $durumId, 'islem' => $islem, 'marked' => $marked, 'errors' => $errors, 'dry_run' => $dryRun];
        } else {
            $out['items'] = ['skipped' => 'Kalem durumu kodu tanımlı değil (ne iptal kalem kodu ne de Eksik/Hatalı Ürün ayarı).'];
        }

        // 3) Özel alana not
        $field = (int) ($scfg['note_field'] ?? 0);
        if ($field >= 1 && $field <= 3) {
            $current = (string) ($raw["OzelAlan{$field}"] ?? '');
            $line = $this->noteLine($r, $actor);
            $value = trim($current) === '' ? $line : rtrim($current) . "\n" . $line;
            // Alan uzunluğu bilinmiyor → 2000 karakterde tut, en eski satırları düşür.
            while (mb_strlen($value) > 2000 && str_contains($value, "\n")) {
                $value = (string) substr($value, strpos($value, "\n") + 1);
            }
            if ($dryRun) {
                $log->info('[Ticimax][DRY-RUN] shortage özel alan notu (gönderilmedi)', ['return_id' => $r->id, 'field' => $field, 'value' => $value]);
                $out['note'] = ['success' => true, 'dry_run' => true, 'field' => $field, 'text' => $line];
            } else {
                $res = $svc->updateOrderCustomFields($sid, [$field => $value]);
                $out['note'] = ['success' => (bool) $res['success'], 'dry_run' => false, 'field' => $field, 'text' => $line, 'error' => $res['error'] ?? null];
            }
        } else {
            $out['note'] = ['skipped' => 'Not alanı kapalı (note_field=0).'];
        }

        $this->storeTicimaxResult($r, $out);

        return $out;
    }

    private function noteLine(ReturnRequest $r, User $actor): string
    {
        $stage = (string) data_get($r->metadata, 'shortage.stage', self::STAGE_PRE_SHIP);
        $parts = [];
        foreach ($r->items as $it) {
            $parts[] = trim(($it->product_name ?: $it->sku ?: $it->platform_line_id) . ($it->variant_info ? ' ' . $it->variant_info : ''))
                . ' x' . (int) $it->qty_requested
                . ' (' . self::reasonLabel($it->reason_code, $stage) . ')';
        }
        $amount = number_format((float) $r->requested_amount, 2, ',', '.') . ' ' . ($r->currency ?: 'TL');
        $tail = $r->status === ReturnStatus::Completed
            ? 'Kapıda ödeme — para iadesi yok.'
            : "Para iadesi {$amount} yönetici onayı bekliyor.";
        if ($stage === self::STAGE_RETURNED) {
            $tail .= ' Müşteriye bildirim yapılmaz.';
        }
        $title = match ($stage) {
            self::STAGE_DELIVERED => 'Teslimat sonrası eksik/hatalı ürün iadesi ',
            self::STAGE_RETURNED => 'Geri dönen sipariş iadesi ',
            default => 'Gönderilemeyen ürün iadesi ',
        };

        return '[Yunbi ' . now()->setTimezone('Europe/Istanbul')->format('d.m.Y H:i') . '] ' . $title
            . $r->public_code . ': ' . implode(', ', $parts) . ' — ' . $actor->name . '. ' . $tail;
    }

    private function storeTicimaxResult(ReturnRequest $r, array $out): void
    {
        $meta = $r->metadata ?? [];
        $meta['ticimax_shortage'] = $out;
        $r->metadata = $meta;
        $r->save();

        $this->audit->log($r, 'ticimax_shortage', [
            'actor_type' => ReturnActorType::System,
            'payload' => array_filter([
                'dry_run' => ($out['dry_run'] ?? false) ? 'evet' : null,
                'skipped' => $out['skipped'] ?? null,
                'order_status' => isset($out['order_status']) ? (($out['order_status']['success'] ?? false) ? ($out['order_status']['durum'] ?? 'evet') : 'başarısız: ' . ($out['order_status']['error'] ?? '?')) : null,
                'items_marked' => isset($out['items']['marked']) ? count($out['items']['marked']) : null,
                'items_errors' => ! empty($out['items']['errors']) ? implode(' | ', $out['items']['errors']) : null,
                'note' => isset($out['note']['success']) ? (($out['note']['success']) ? 'OzelAlan' . $out['note']['field'] : 'başarısız: ' . ($out['note']['error'] ?? '?')) : null,
            ], fn ($v) => $v !== null),
        ]);
    }

    // ───────────────────────── PARA SONRASI: ÖZÜR KUPONU + SMS ─────────────────────────

    /**
     * Para iadesi tamamlandığında (veya kapıda ödemede talep açılır açılmaz) çağrılır:
     * müşteriye özel ÖZÜR KUPONU (Ticimax HediyeCekiOlustur) + özür SMS'i (kupon kodlu).
     * İdempotent: kupon bir kez üretilir (metadata.apology_coupon), tekrar çağrıda yeniden açılmaz.
     *
     * @return array{coupon:?array, sms:array}
     */
    public function afterSettled(ReturnRequest $r, float $refundedAmount, bool $refundDryRun): array
    {
        if (self::isReturned($r)) {
            // Geri dönen sipariş (kullanıcı kararı 2026-10-05): müşteriye SMS/kupon YOK; yalnız Ticimax İptal.
            $rcfg = $this->refundConfig($r->tenant);
            $this->applyReturnedCancel($r, $refundDryRun || (bool) ($rcfg['dry_run'] ?? true));

            return ['coupon' => null, 'sms' => ['sent' => false, 'dry_run' => false, 'message' => '', 'error' => null, 'skipped' => true]];
        }

        $scfg = $this->config($r->tenant);
        $couponEnabled = (bool) ($scfg['coupon_enabled'] ?? true);
        $couponAmount = round((float) ($scfg['coupon_amount'] ?? 100), 2);
        $rcfg = $this->refundConfig($r->tenant);
        $dryRun = $refundDryRun || (bool) ($rcfg['dry_run'] ?? true);

        $coupon = data_get($r->metadata, 'apology_coupon');
        if ($couponEnabled && $couponAmount > 0 && ! is_array($coupon)) {
            $coupon = $this->createApologyCoupon($r, $couponAmount, $scfg, $dryRun);
        }

        $ctx = [
            'amount' => $refundedAmount > 0 ? $refundedAmount : null,
            'coupon_code' => is_array($coupon) && ($coupon['success'] ?? false) ? $coupon['code'] : null,
            'coupon_amount' => is_array($coupon) && ($coupon['success'] ?? false) ? (float) $coupon['amount'] : null,
        ];
        // Teslimat sonrası bildirimde daha genel bir özür metni (kullanıcı talebi 2026-09-25).
        $event = data_get($r->metadata, 'shortage.stage') === self::STAGE_DELIVERED ? 'shortage_delivered_refunded' : 'shortage_refunded';
        $sms = $this->notifier->notify($r, $event, $ctx);

        return ['coupon' => is_array($coupon) ? $coupon : null, 'sms' => $sms];
    }

    /**
     * GERİ DÖNEN SİPARİŞ — para onayı tamamlandıktan sonra Ticimax sipariş statüsü `cancel_status` (Iptal).
     * Yalnız TAM kapsamda (kısmi seçimde siparişin kalanı iptal sayılmaz → statüye dokunulmaz).
     * Müşteriye Ticimax bildirimi DAİMA kapalı. İdempotent: statü bir kez başarıyla yazıldıysa tekrar yazılmaz.
     */
    private function applyReturnedCancel(ReturnRequest $r, bool $refundDryRun): array
    {
        $prev = data_get($r->metadata, 'ticimax_shortage');
        if (is_array($prev) && ($prev['order_status']['success'] ?? false) && ! ($prev['order_status']['dry_run'] ?? false)) {
            return $prev;
        }

        $tcfg = $this->ticimaxConfig($r->tenant);
        $enabled = (bool) ($tcfg['enabled'] ?? false);
        $dryRun = $refundDryRun || (bool) ($tcfg['dry_run'] ?? true);
        $out = ['enabled' => $enabled, 'dry_run' => $dryRun, 'order_status' => null, 'items' => null, 'note' => null];

        if (! (bool) data_get($r->metadata, 'shortage.is_full', false)) {
            $out['skipped'] = 'Geri dönen sipariş (kısmi seçim) — Ticimax sipariş statüsü değiştirilmedi.';
        } elseif (! $enabled) {
            $out['skipped'] = 'Ticimax yazma kapalı (returns_integrations.ticimax.enabled=false) — statü İptal yapılmadı.';
        } else {
            $status = (string) ($tcfg['cancel_status'] ?? 'Iptal');
            if ($dryRun) {
                Log::channel(config('returns.log_channel', 'stack'))->info('[Ticimax][DRY-RUN] returned → statü (gönderilmedi)', ['return_id' => $r->id, 'durum' => $status]);
                $out['order_status'] = ['success' => true, 'dry_run' => true, 'durum' => $status];
            } elseif (! ($svc = $this->ticimax($r->tenant))) {
                $out['order_status'] = ['success' => false, 'dry_run' => false, 'durum' => $status, 'error' => 'Ticimax kanalı bulunamadı.'];
            } else {
                try {
                    $res = $svc->setOrderStatus((int) $r->platform_order_id, $status, false, (string) $r->order_no);
                    $out['order_status'] = ['success' => (bool) $res['success'], 'dry_run' => false, 'durum' => $status, 'error' => $res['error'] ?? null];
                } catch (\Throwable $e) {
                    // Para iadesi tamamlandı; statü yazımı best-effort — hata panelde görünür, akış bozulmaz.
                    $out['order_status'] = ['success' => false, 'dry_run' => false, 'durum' => $status, 'error' => $e->getMessage()];
                }
            }
        }
        $this->storeTicimaxResult($r, $out);

        return $out;
    }

    private function createApologyCoupon(ReturnRequest $r, float $amount, array $scfg, bool $dryRun): array
    {
        $code = $this->generateCouponCode($r, (string) ($scfg['coupon_prefix'] ?? 'OZUR'));
        $days = max(1, (int) ($scfg['coupon_days'] ?? 90));
        $payload = [
            'Kod' => $code,
            'IndirimTipi' => 0, // TUTAR (TL) — ⚠ 1 yüzde olur
            'IndirimDegeri' => $amount,
            'MinimumUrunTutari' => max(0, (float) ($scfg['coupon_min_amount'] ?? 0)),
            'MinTutarKosuldaGecerli' => ((float) ($scfg['coupon_min_amount'] ?? 0)) > 0,
            'KargoUcretsiz' => (bool) ($scfg['coupon_free_shipping'] ?? false),
            'HediyeCekiniOdemeOlarakKaydet' => false,
            'KullanimSayisi' => 1,
            'UyeMaksimumKullanimSayisi' => 1,
            'TarihBaslagic' => now()->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'TarihBitis' => now()->addDays($days)->setTimezone('Europe/Istanbul')->format('Y-m-d\TH:i:s'),
            'WebAktif' => true,
            'MobilAktif' => true,
            'AndroidAktif' => true,
            'IOSAktif' => true,
            'GrupAdi' => (string) ($scfg['coupon_grup_adi'] ?? 'Özür Kuponu'),
            'IndirimliUrunleKullanilabilir' => true,
            'BaskaKampanyalarlaBilestirilebilir' => true,
            'SepetteKosulsuzGoster' => false,
        ];

        $result = ['success' => false, 'code' => $code, 'amount' => $amount, 'days' => $days, 'dry_run' => $dryRun, 'ticimax_id' => null, 'error' => null, 'created_at' => now()->format('Y-m-d H:i:s')];

        if ($dryRun) {
            Log::channel(config('returns.log_channel', 'stack'))->info('[Shortage][DRY-RUN] özür kuponu yazılmadı', ['return_id' => $r->id, 'payload' => $payload]);
            $result['success'] = true;
        } else {
            $svc = $this->ticimax($r->tenant);
            if (! $svc) {
                $result['error'] = 'Ticimax kanalı bulunamadı.';
            } else {
                $res = $svc->createGiftVoucher($payload);
                if ($res['success'] ?? false) {
                    $result['success'] = true;
                    $result['ticimax_id'] = $res['id'] ?? null;
                    $result['code'] = $res['code'] ?: $code;
                } else {
                    $result['error'] = (string) ($res['error'] ?? 'Hediye çeki oluşturulamadı.');
                }
            }
        }

        $meta = $r->metadata ?? [];
        $meta['apology_coupon'] = $result;
        $r->metadata = $meta;
        $r->save();

        $this->audit->log($r, 'apology_coupon', [
            'actor_type' => ReturnActorType::System,
            'amount' => $amount,
            'payload' => array_filter([
                'code' => $result['success'] ? $result['code'] : null,
                'days' => $days,
                'dry_run' => $dryRun ? 'evet' : null,
                'ticimax_id' => $result['ticimax_id'],
                'error' => $result['error'],
            ], fn ($v) => $v !== null),
        ]);

        return $result;
    }

    private function generateCouponCode(ReturnRequest $r, string $prefix): string
    {
        $base = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $prefix)) ?: 'OZUR';
        do {
            $code = $base . '-' . ReadableCode::generate(6);
            $exists = ReturnRequest::withoutGlobalScopes()
                ->where('tenant_id', $r->tenant_id)
                ->where('metadata->apology_coupon->code', $code)
                ->exists()
                || \App\Models\ReturnRefund::withoutGlobalScopes()->where('tenant_id', $r->tenant_id)->where('coupon_code', $code)->exists();
        } while ($exists);

        return $code;
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    private function coversFullOrder(array $order, array $selections): bool
    {
        $byLine = [];
        foreach ($selections as $s) {
            $byLine[(string) $s['line_id']] = ($byLine[(string) $s['line_id']] ?? 0) + (int) $s['qty'];
        }
        foreach ($order['items'] as $it) {
            $qty = (int) ($it['qty'] ?? 0);
            if ($qty > 0 && ($byLine[(string) $it['line_id']] ?? 0) < $qty) {
                return false;
            }
        }

        return true;
    }

    /** Talep kodu: tenant önekli (code_prefixes.shortage, örn. tbe48291037) veya 10 rakam. */
    private function generatePublicCode(Tenant $tenant, string $stage = self::STAGE_PRE_SHIP): string
    {
        // Geri dönen sipariş kendi önekini kullanır (code_prefixes.returned, örn. tbg…); boşsa eksik/hatalı önekine düşer.
        $custom = $stage === self::STAGE_RETURNED
            ? trim((string) data_get($tenant->settings, 'returns_integrations.code_prefixes.returned', ''))
            : '';
        $custom = $custom !== '' ? $custom : trim((string) data_get($tenant->settings, 'returns_integrations.code_prefixes.shortage', ''));
        $make = $custom !== ''
            ? fn (int $extra): string => $custom . ReadableCode::digits(8 + $extra)
            : fn (int $extra): string => ReadableCode::digits(10 + $extra);

        $attempt = 0;
        do {
            $code = $make(intdiv($attempt++, 20));
        } while (ReturnRequest::withoutGlobalScopes()->whereRaw('UPPER(public_code) = UPPER(?)', [$code])->exists());

        return $code;
    }

    public function config(Tenant $tenant): array
    {
        $cfg = (array) config('returns.integrations.shortage', []);
        $tcfg = $tenant->settings['returns_integrations']['shortage'] ?? [];

        return is_array($tcfg) && $tcfg ? array_replace($cfg, $tcfg) : $cfg;
    }

    private function refundConfig(Tenant $tenant): array
    {
        $cfg = (array) config('returns.integrations.refund', []);
        $tcfg = $tenant->settings['returns_integrations']['refund'] ?? [];

        return is_array($tcfg) && $tcfg ? array_replace_recursive($cfg, $tcfg) : $cfg;
    }

    private function ticimaxConfig(Tenant $tenant): array
    {
        $cfg = (array) config('returns.integrations.ticimax', []);
        $tcfg = $tenant->settings['returns_integrations']['ticimax'] ?? [];

        return is_array($tcfg) && $tcfg ? array_replace_recursive($cfg, $tcfg) : $cfg;
    }

    private function ticimaxChannel(Tenant $tenant): ?Channel
    {
        return Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->first();
    }

    private function ticimax(Tenant $tenant): ?TicimaxService
    {
        $ch = $this->ticimaxChannel($tenant);
        if (! $ch) {
            return null;
        }
        $svc = TicimaxService::fromChannel($ch);

        return $svc->isAvailable() ? $svc : null;
    }

    private function adminOrderUrl(Tenant $tenant, ?string $platformOrderId): ?string
    {
        if (! $platformOrderId) {
            return null;
        }
        $ch = $this->ticimaxChannel($tenant);
        $wsdl = (string) ($ch?->credentials['wsdl_url'] ?? '');
        if (! preg_match('#^(https?://[^/]+)#i', $wsdl, $m)) {
            return null;
        }

        return $m[1] . '/Admin/SiparisDetay.aspx?SID=' . rawurlencode($platformOrderId);
    }
}
