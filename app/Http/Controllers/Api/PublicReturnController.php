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
use App\Models\ReturnRequestItem;
use App\Models\Tenant;
use App\Services\Returns\NebimService;
use App\Services\Returns\Payment\CodDetector;
use App\Services\Returns\ReadableCode;
use App\Services\Returns\RefundCalculator;
use App\Services\Returns\ReturnAccessToken;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnErpProcessor;
use App\Services\Returns\ReturnNotifier;
use App\Services\Returns\CargoProviderFactory;
use App\Services\Returns\ReturnOrderGateway;
use App\Services\Returns\ReturnRulesService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * HALKA AÇIK iade/iptal akışı (tenant'ın müşterisi). Auth YOK.
 *
 * Güvenlik ilkeleri:
 *  - Sipariş doğrulama: order_no + (email VEYA telefon). Başarısızlıkta generic hata.
 *  - Doğrulama sonrası kısa ömürlü şifreli token; sonraki adımlar token ile.
 *  - TÜM tutarlar her adımda Ticimax canlı veriden sunucuda yeniden hesaplanır.
 *  - Public bağlamda Eloquent tenant global-scope devre dışı → her sorgu açıkça tenant_id ile filtrelenir.
 *  - Canlı siparişe YAZMA yok (yalnızca okuma); talep yalnızca bizim DB'ye yazılır.
 */
class PublicReturnController extends Controller
{
    /** Müşteri iade formundaki neden kodları (PublicReturnPage REASONS ile birebir). */
    private const RETURN_REASON_CODES = ['size', 'not_satisfied', 'defective', 'wrong_item', 'changed_mind', 'other'];

    /** İptal formundaki neden kodları (PublicReturnPage CANCEL_REASONS ile birebir). */
    private const CANCEL_REASON_CODES = ['changed_mind', 'wrong_selection', 'found_cheaper', 'late_delivery', 'address_error', 'duplicate_order', 'other'];

    public function __construct(
        private readonly ReturnAccessToken $token,
        private readonly RefundCalculator $calculator,
        private readonly ReturnRulesService $rules,
        private readonly ReturnAuditLogger $audit,
        private readonly ReturnNotifier $notifier,
        private readonly ReturnErpProcessor $erp,
        private readonly CodDetector $cod,
        private readonly \App\Services\Returns\RefundService $refundService,
    ) {
        // Sunucu php.ini'sinde serialize_precision=100 → para alanları JSON'da
        // 989.950000000000045... gibi çıkıyor. Para-kritik yanıtlarda temiz (en kısa
        // gidiş-dönüşlü) gösterim için bu istek kapsamında PHP varsayılanına çek.
        ini_set('serialize_precision', '-1');
    }

    private const GENERIC_LOOKUP_ERROR = 'Sipariş bulunamadı veya girdiğiniz bilgiler eşleşmiyor.';

    private const PARTIAL_CANCEL_ERROR = 'İptal işlemleri siparişin tamamı için yapılabilmektedir. Lütfen sayfayı yenileyip tüm ürünlerle birlikte iptal talebi oluşturun.';

    /**
     * POST r/{slug}/returns/lookup
     * Body: order_no, email?, phone?
     */
    public function lookup(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $data = $request->validate([
            'order_no' => 'required|string|max:64',
            'email' => 'nullable|email|max:190',
            'phone' => 'nullable|string|max:32',
        ]);

        $email = $data['email'] ?? null;
        $phone = $data['phone'] ?? null;
        if (! $email && ! $phone) {
            return response()->json(['error' => 'E-posta veya telefon gereklidir.'], 422);
        }

        $orderNo = preg_replace('/[^A-Za-z0-9\-_\/]/', '', $data['order_no']);
        if ($orderNo === '') {
            return response()->json(['error' => self::GENERIC_LOOKUP_ERROR], 422);
        }

        // Platform soyutlaması: Ticimax (Tonny Black) / ikas (Boise Atelier) — tenant kanalına göre.
        $gateway = ReturnOrderGateway::forTenant($tenant);
        if (! $gateway) {
            return response()->json(['error' => 'service_unavailable'], 503);
        }

        $res = $gateway->getOrderByNo($orderNo);
        // Sipariş yok VEYA iletişim eşleşmiyor → AYNI generic hata (enumeration sızıntısı yok)
        if (! ($res['success'] ?? false)) {
            return response()->json(['error' => self::GENERIC_LOOKUP_ERROR], 422);
        }

        $rawOrder = $res['order'];
        if (! $gateway->verifyContact($rawOrder, $email, $phone)) {
            return response()->json(['error' => self::GENERIC_LOOKUP_ERROR], 422);
        }

        $order = $gateway->normalize($rawOrder);
        $rules = $this->rules->forTenant($tenant);
        // KAPIDA ÖDEME: ödeme adımı buna göre değişir — iptalde adım hiç gösterilmez (iade yok),
        // iadede karta iade yerine HAVALE (müşteriden banka/ad soyad/IBAN alınır).
        // Uygunluktan ÖNCE okunur: kargodaki kapıda ödemeli siparişte iade açılmaz.
        $cod = $this->cod->forOrder($tenant, $order['platform_order_id']);
        $eligibility = $this->evaluateEligibility($tenant, $order, $rules, (bool) $cod['cod']);

        // Sipariş başına tek iade hakkı: engel varsa müşteri form doldurmadan LOOKUP'ta görsün.
        if ($rules['block_if_open_request_exists']
            && ($blocking = $this->blockingRequest($tenant->id, $order['platform_order_id'], $order['order_no']))) {
            $eligibility['can_return'] = false;
            $eligibility['can_cancel'] = false;
            $eligibility['can_defect'] = false;
            $eligibility['reasons'] = [$this->blockingMessage($blocking)];
        }

        $token = $this->token->issue($tenant->id, $order['order_no'] ?? $orderNo, $order['platform_order_id']);

        $cargoKey = CargoProviderFactory::providerKeyFor($tenant);

        return response()->json([
            'token' => $token,
            'order' => $this->publicOrderView($order),
            'eligibility' => $eligibility,
            'payment' => ['cod' => (bool) $cod['cod'], 'cod_fee' => (float) $cod['fee']],
            'refund_methods' => $this->availableRefundMethods($rules, (bool) $cod['cod']),
            'rules' => $this->publicRulesView($rules),
            // Tenant'ın iade kargo firması — public ekran metin/logoyu buna göre gösterir.
            // expire_days: kargo kodu geçerlilik süresi (tenant kuralı) — ekran talimat metinlerinde.
            'cargo' => [
                'provider' => $cargoKey,
                'name' => CargoProviderFactory::displayName($cargoKey),
                'expire_days' => (int) ($rules['shipment_expire_days'] ?? 14),
            ],
        ]);
    }

    /**
     * POST r/{slug}/returns/preview
     * Body: token, items:[{line_id, qty}]
     * Sunucu, tutarı Ticimax CANLI veriden yeniden hesaplar.
     */
    public function preview(Request $request, string $slug): JsonResponse
    {
        [$tenant, $order, $err] = $this->authorizeAndFetch($request, $slug);
        if ($err) {
            return $err;
        }

        $rules = $this->rules->forTenant($tenant);
        // Önizleme, submit ile AYNI kuralı kullanmalı — aksi halde iptalde müşteriye kargosuz
        // tutar gösterilip kargolu tutar iade edilirdi. Tür gelmezse 'return' varsayılır.
        $previewType = ReturnType::tryFrom((string) $request->input('type')) ?? ReturnType::Return;

        $selections = $this->validatedSelections($request);

        // İptal daima TAM sipariş — önizleme de submit'le aynı kuralı uygular.
        if ($previewType === ReturnType::Cancel && ! $this->selectionCoversFullOrder($order, $selections)) {
            return response()->json(['error' => self::PARTIAL_CANCEL_ERROR], 422);
        }

        try {
            $calc = $this->calculator->calculate(
                $order,
                $selections,
                [
                    'refund_shipping' => $this->refundShippingFor($previewType, $rules),
                    'campaign_recovery' => $this->campaignRecoveryFor($previewType, $rules),
                    'cap' => $order['paid_amount'],
                ]
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => 'Seçim geçersiz.', 'detail' => $e->getMessage()], 422);
        }

        return response()->json(['calculation' => $calc]);
    }

    /**
     * POST r/{slug}/returns/submit
     * Body: token, type(return|cancel), refund_method, items:[{line_id, qty, reason_code?, reason_note?, condition?}]
     */
    public function submit(Request $request, string $slug): JsonResponse
    {
        [$tenant, $order, $err, $rawToken] = $this->authorizeAndFetch($request, $slug);
        if ($err) {
            return $err;
        }

        // Kusur bildirimi fotoğraflarla birlikte multipart/form-data gelir → items JSON string olur.
        if (is_string($request->input('items'))) {
            $decoded = json_decode($request->input('items'), true);
            $request->merge(['items' => is_array($decoded) ? $decoded : null]);
        }

        // Havale bilgisi (kapıda ödeme iadesi) multipart akışında JSON string gelebilir.
        if (is_string($request->input('bank_account'))) {
            $decodedBank = json_decode($request->input('bank_account'), true);
            $request->merge(['bank_account' => is_array($decodedBank) ? $decodedBank : null]);
        }

        $payload = $request->validate([
            'type' => 'required|in:return,cancel,defect',
            'refund_method' => 'required|in:original,store_credit,bank_transfer,none',
            // Kapıda ödeme iadesinde ZORUNLU (aşağıda tür/COD'a göre denetlenir).
            'bank_account' => 'nullable|array',
            'bank_account.bank_name' => 'nullable|string|max:80',
            'bank_account.account_holder' => 'nullable|string|max:120',
            'bank_account.iban' => 'nullable|string|max:40',
            'items' => 'required|array|min:1',
            'items.*.line_id' => 'required|string|max:64',
            'items.*.qty' => 'required|integer|min:1|max:1000',
            // İade + iptalde ZORUNLU (aşağıda türe göre kod listesi denetlenir); kusur akışında şikâyet metni var.
            'items.*.reason_code' => 'required_unless:type,defect|nullable|string|max:64',
            'items.*.reason_note' => 'nullable|string|max:500',
            'items.*.condition' => 'nullable|string|max:64',
            // Kusur bildirimi: şikâyet metni + en az 1 kusur fotoğrafı ZORUNLU.
            'complaint' => 'required_if:type,defect|nullable|string|min:10|max:2000',
            'photos' => 'required_if:type,defect|nullable|array|min:1|max:5',
            // GÜVENLİK: `image` kuralı SVG'yi de kabul eder (script taşıyabilir) → açık raster listesi
            'photos.*' => 'file|mimes:jpg,jpeg,png,webp,gif,bmp|max:8192',
        ], [
            'items.*.reason_code.required_unless' => 'Lütfen her ürün için iade/iptal nedenini seçiniz.',
        ]);

        $type = ReturnType::from($payload['type']);

        // Neden kodu türe uygun listeden olmalı; "Diğer" seçildiyse kısa açıklama zorunlu.
        if ($payload['type'] !== 'defect') {
            $allowed = $payload['type'] === 'cancel' ? self::CANCEL_REASON_CODES : self::RETURN_REASON_CODES;
            foreach ($payload['items'] as $it) {
                $code = (string) ($it['reason_code'] ?? '');
                if (! in_array($code, $allowed, true)) {
                    return response()->json(['error' => $payload['type'] === 'cancel'
                        ? 'Lütfen iptal nedenini seçiniz.'
                        : 'Lütfen her ürün için iade nedenini seçiniz.'], 422);
                }
                if ($code === 'other' && mb_strlen(trim((string) ($it['reason_note'] ?? ''))) < 3) {
                    return response()->json(['error' => 'Lütfen nedeninizi kısaca açıklayınız.'], 422);
                }
            }
        }
        $refundMethod = RefundMethod::from($payload['refund_method']);
        $rules = $this->rules->forTenant($tenant);

        // ── KAPIDA ÖDEME: yöntem SUNUCUDA belirlenir (istemciye güvenilmez) ──
        // İPTAL   → tahsilat yapılmamıştır, iade edilecek para yok → RefundMethod::None (para
        //           onayı kuyruğuna hiç düşmez, ERP iptali sonrası otomatik kapanır).
        // İADE    → nakit/kapıda kart tahsil edildi, karta iade imkânsız → BankTransfer (havale);
        //           eski/önbellekli arayüz 'original' gönderirse sessizce havaleye çevrilir.
        // Ticimax ödeme bloğu okunamazsa (checked=false) COD sayılmaz → eski davranış (fail-closed).
        $cod = $this->cod->forOrder($tenant, $order['platform_order_id']);
        $bankAccount = null;

        if ($cod['cod']) {
            if ($type === ReturnType::Cancel) {
                $refundMethod = RefundMethod::None;
            } else {
                if ($refundMethod === RefundMethod::Original) {
                    $refundMethod = RefundMethod::BankTransfer;
                }
                // İADE'de "iade yok" seçilemez (para tahsil edilmiştir) — istemci ne gönderirse
                // göndersin yalnız havale/indirim kodu geçerlidir.
                if (! in_array($refundMethod, [RefundMethod::BankTransfer, RefundMethod::StoreCredit], true)) {
                    return response()->json(['error' => 'Bu sipariş için geçersiz iade yöntemi seçildi. Lütfen sayfayı yenileyin.'], 422);
                }
                if ($refundMethod === RefundMethod::BankTransfer) {
                    $bankAccount = $this->normalizeBankAccount((array) ($payload['bank_account'] ?? []));
                    if (is_string($bankAccount)) {
                        return response()->json(['error' => $bankAccount], 422);
                    }
                }
            }
        } elseif (in_array($refundMethod, [RefundMethod::BankTransfer, RefundMethod::None], true)) {
            // COD olmayan siparişte havale/iadesiz yöntem seçilemez (kart işlemi mevcut).
            return response()->json(['error' => 'Bu sipariş için geçersiz iade yöntemi seçildi. Lütfen sayfayı yenileyin.'], 422);
        }

        // İade yöntemi kurallarla uyumlu mu?
        if ($refundMethod === RefundMethod::StoreCredit && ! $rules['allow_store_credit']) {
            return response()->json(['error' => 'Bu mağaza için indirim kodu ile iade kapalı.'], 422);
        }
        if (in_array($refundMethod, [RefundMethod::Original, RefundMethod::BankTransfer], true) && ! $rules['allow_original_refund']) {
            return response()->json(['error' => 'Bu mağaza için para iadesi kapalı.'], 422);
        }

        // Uygunluk yeniden doğrulanır (lookup'a güvenme)
        $eligibility = $this->evaluateEligibility($tenant, $order, $rules, (bool) $cod['cod']);
        $allowed = match ($type) {
            ReturnType::Return => $eligibility['can_return'],
            ReturnType::Cancel => $eligibility['can_cancel'],
            ReturnType::Defect => $eligibility['can_defect'],
        };
        if (! $allowed) {
            return response()->json(['error' => 'Bu sipariş için işlem uygun değil.', 'reasons' => $eligibility['reasons']], 422);
        }

        $selections = $this->normalizeSelections($payload['items']);

        // İPTAL DAİMA TAM SİPARİŞ (kullanıcı kararı 2026-08-26): kısmi iptal, iade/iptal
        // karışması + kargo desi tutarsızlığı (kalan ürün eski desiyle gidiyor) + ERP'de
        // yarım sipariş sorunları üretiyordu. Seçim tüm kalemleri tam adetle kapsamalı.
        if ($type === ReturnType::Cancel && ! $this->selectionCoversFullOrder($order, $selections)) {
            return response()->json(['error' => self::PARTIAL_CANCEL_ERROR], 422);
        }

        // Tutar sunucuda yeniden hesaplanır
        try {
            $calc = $this->calculator->calculate(
                $order,
                $selections,
                [
                    'refund_shipping' => $this->refundShippingFor($type, $rules),
                    'campaign_recovery' => $this->campaignRecoveryFor($type, $rules),
                    'cap' => $order['paid_amount'],
                ]
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => 'Seçim geçersiz.', 'detail' => $e->getMessage()], 422);
        }

        // Sipariş başına tek iade hakkı (süreçte veya tamamlanmış talep → yeni talep yok)
        if ($rules['block_if_open_request_exists']
            && ($blocking = $this->blockingRequest($tenant->id, $order['platform_order_id'], $order['order_no']))) {
            return response()->json(['error' => $this->blockingMessage($blocking)], 409);
        }

        $reasonByLine = [];
        foreach ($payload['items'] as $it) {
            $reasonByLine[(string) $it['line_id']] = $it;
        }
        $itemsByLine = [];
        foreach ($order['items'] as $oi) {
            $itemsByLine[(string) $oi['line_id']] = $oi;
        }

        $created = DB::transaction(function () use ($tenant, $order, $type, $refundMethod, $calc, $rules, $eligibility, $reasonByLine, $itemsByLine, $request, $bankAccount, $cod) {
            // ── Eşzamanlı ÇİFT-SUBMIT yarışını kapat (para-kritik) ──
            // Aynı (tenant, sipariş) için Postgres advisory transaction kilidi al (commit/rollback'te
            // otomatik bırakılır) → bu sipariş için submit'ler serileştirilir. Ardından açık-talep
            // kontrolü kilit ALTINDA tekrar yapılır (TOCTOU penceresi kapanır). Kontrol dışında bir
            // erken kontrol de var (hızlı UX); asıl garanti burası.
            $lockKey = $tenant->id . ':' . ($order['platform_order_id'] ?: $order['order_no']);
            DB::select('select pg_advisory_xact_lock(hashtext(?))', [$lockKey]);

            if ($rules['block_if_open_request_exists']
                && $this->blockingRequest($tenant->id, $order['platform_order_id'], $order['order_no'])) {
                return null; // yarış kaybedildi — eşzamanlı başka talep oluşturuldu
            }

            $rr = new ReturnRequest();
            $rr->tenant_id = $tenant->id;
            $rr->channel_id = $this->platformChannelId($tenant);
            $rr->type = $type;
            $rr->public_code = $this->generatePublicCode($tenant, $type);
            // Kusur bildirimi kargo koduna gitmez: önce YÖNETİCİ onay/red kararı (DefectReview).
            $rr->status = $type === ReturnType::Defect ? ReturnStatus::DefectReview : ReturnStatus::Pending;
            $rr->platform_order_id = $order['platform_order_id'];
            $rr->order_no = $order['order_no'];
            $rr->customer_name = $order['customer_name'];
            $rr->customer_email = $order['customer_email'];
            // Form telefonu varsa onu, yoksa siparişteki telefonu kullan (e-posta ile doğrulamada SMS için).
            $rr->customer_phone = $request->input('phone') ?: ($order['customer_phone'] ?? null);
            $rr->currency = $order['currency'];
            $rr->refund_method = $refundMethod;
            $rr->requested_amount = $calc['total_refundable'];
            $rr->paid_amount_snapshot = $order['paid_amount'];
            $rr->eligibility_snapshot = $eligibility;
            $rr->metadata = array_filter([
                'calculation' => $calc,
                'rules' => $rules,
                // Sürat iade gönderisinin Alıcı alanları = MÜŞTERİ bilgisi (Sürat dönüşü 2026-07-20).
                'customer_address' => $order['customer_address'] ?? null,
                // Kusur bildirimi: müşterinin şikâyet metni (yönetici karar ekranında gösterilir).
                'complaint' => $type === ReturnType::Defect ? trim((string) $request->input('complaint')) : null,
                // Kapıda ödeme tespiti (submit anındaki canlı ödeme bloğundan) — panelde gösterilir.
                'cod' => $cod['checked'] ? ['is_cod' => (bool) $cod['cod'], 'fee' => (float) $cod['fee'], 'method_code' => $cod['method_code']] : null,
                // Havale ile iade: müşterinin paylaştığı banka / ad soyad / IBAN.
                'bank_account' => $bankAccount,
            ], fn ($v) => $v !== null);
            $rr->save();

            $refundByLine = [];
            foreach ($calc['lines'] as $line) {
                $refundByLine[(string) $line['line_id']] = $line;
            }

            foreach ($reasonByLine as $lineId => $sel) {
                $oi = $itemsByLine[$lineId] ?? null;
                if (! $oi) {
                    continue;
                }
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
                    'unit_price' => $oi['unit_price'] ?? 0,
                    'line_discount_share' => $line['discount_share'] ?? 0,
                    'refundable_amount' => $line['refundable'] ?? 0,
                    'reason_code' => $sel['reason_code'] ?? null,
                    'reason_note' => $sel['reason_note'] ?? null,
                    'item_condition' => $sel['condition'] ?? null,
                ]);
            }

            $this->audit->log($rr, 'submit', [
                'actor_type' => ReturnActorType::Customer,
                'to_status' => $rr->status->value,
                'amount' => $calc['total_refundable'],
                'payload' => [
                    'type' => $type->value,
                    'refund_method' => $refundMethod->value,
                    'items' => array_map(fn ($l) => ['line_id' => $l['line_id'], 'qty' => $l['qty_returned'], 'refundable' => $l['refundable']], $calc['lines']),
                ],
                'request' => $request,
            ]);

            return $rr;
        });

        // Advisory kilit altındaki re-check yarışı yakaladıysa: eşzamanlı talep zaten oluşturuldu.
        if (! $created) {
            return response()->json(['error' => 'Bu sipariş için işlemde olan bir talebiniz zaten var.'], 409);
        }

        $created->setRelation('tenant', $tenant);

        // İPTAL: ERP işlemi (Nebim ürün sil + Ticimax iptal) müşteri talebi gönderir göndermez OTOMATİK
        // çalışır (yönetici onayı yalnızca PARA içindir). dry-run aware; başarılıysa Pending → Processing.
        // Faturalı/uygunsuz sipariş uygunlukta zaten engellendi; yine de ERP fail → talep Pending kalır,
        // hata metadata'ya yazılır (panelde görünür) ve müşteriye generic mesaj döner (hata sızdırılmaz).
        if ($created->type === ReturnType::Cancel) {
            $this->autoProcessCancel($created);
        } elseif ($created->type === ReturnType::Defect) {
            // KUSUR: kargo kodu YOK — müşteri fotoğrafları kaydedilir, talep yönetici onayında bekler.
            $this->storeCustomerPhotos($created, $request->file('photos', []));
            $this->notifier->notify($created, 'submitted');
        } else {
            // İADE: Sürat iade gönderisini OTOMATİK oluştur → kargo kodu + AwaitingShipment + SMS.
            $this->autoCreateReturnShipment($created);
        }

        return response()->json([
            'public_code' => $created->public_code,
            'status' => $created->status->value,
            'requested_amount' => (float) $created->requested_amount,
            'currency' => $created->currency,
            // İADE: müşteriye ekranda gösterilecek iade kargo kodu (Sürat OzelKargoTakipNo / DHL referenceId).
            'cargo_tracking_code' => $created->cargo_tracking_code,
            'cargo_provider' => $created->cargo_provider,
            'message' => $created->type === ReturnType::Defect
                ? 'Kusur bildiriminiz alındı. Değerlendirme sonucu size SMS ile bildirilecektir.'
                : 'Talebiniz alındı. Sonraki adımlar için talimatlar gönderilecektir.',
        ], 201);
    }

    /**
     * GET r/{slug}/returns/status/{code}
     * Gizlilik: takip kodu + email/telefon doğrulaması ile durum gösterilir.
     */
    public function status(Request $request, string $slug, string $code): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $contact = $request->query('email') ?: $request->query('phone');
        $rr = ReturnRequest::query()
            ->where('tenant_id', $tenant->id)
            ->whereRaw('UPPER(public_code) = UPPER(?)', [$code])
            ->first();

        // Generic: kod yanlış ya da iletişim eşleşmiyor → aynı 404
        if (! $rr || ! $contact || ! $this->contactMatchesRequest($rr, $contact)) {
            return response()->json(['error' => 'not_found'], 404);
        }

        return response()->json([
            'public_code' => $rr->public_code,
            'type' => $rr->type->value,
            'status' => $rr->status->value,
            'status_label' => $rr->status->label(),
            'requested_amount' => (float) $rr->requested_amount,
            'refunded_amount' => (float) $rr->refunded_amount,
            'currency' => $rr->currency,
            'cargo_tracking_code' => $rr->cargo_tracking_code,
            'cargo_provider' => $rr->cargo_provider,
            'created_at' => optional($rr->created_at)->format('Y-m-d H:i:s'),
        ]);
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    /**
     * İPTAL otomasyonu (submit anında): Nebim ürün sil + Ticimax iptal. dry-run aware.
     * Başarılı → Pending → Processing (yönetici PARA onayı bekler); KAPIDA ÖDEME iptalinde para
     * onayı yoktur, talep burada doğrudan Completed'a kapanır. Başarısız → Pending kalır,
     * hata metadata.erp_error'a yazılır (personel panelde görür/yeniden dener). Müşteriye hata sızdırılmaz.
     */
    private function autoProcessCancel(ReturnRequest $r): void
    {
        $result = $this->erp->processCancel($r);

        if ($result['success']) {
            DB::transaction(function () use ($r, $result) {
                $from = $r->status;
                $r->nebim_result = $result['nebim'];
                $meta = $r->metadata ?? [];
                $meta['ticimax_cancel'] = $result['ticimax'];
                unset($meta['erp_error']);
                $r->metadata = $meta;
                $r->status = ReturnStatus::Processing;
                $r->save();

                $this->audit->log($r, 'cancel_process', [
                    'actor_type' => ReturnActorType::System,
                    'from_status' => $from->value,
                    'to_status' => ReturnStatus::Processing->value,
                    'payload' => array_filter([
                        'nebim_order_number' => $result['nebim']['order_number'] ?? null,
                        'nebim_kapsam' => ($result['nebim']['is_full'] ?? false) ? 'tam' : 'kısmi',
                        'nebim_dry_run' => ($result['nebim']['dry_run'] ?? false) ? 'evet' : 'hayır',
                        'ticimax_yontem' => $result['ticimax']['method'] ?? null,
                        'ticimax_dry_run' => ($result['ticimax']['dry_run'] ?? false) ? 'evet' : 'hayır',
                    ]),
                ]);
            });

            // KAPIDA ÖDEME İPTALİ: müşteri hiç ödeme yapmadı → iade edilecek para yok. Talep
            // yönetici PARA onayı kuyruğuna DÜŞMEZ, burada otomatik kapanır (kullanıcı kararı
            // 2026-09-01). Kapanış SMS'i "iade yapılmayacak" bilgisini içerir; 'cancel_processing'
            // ("onay sonrası ücret iadeniz başlatılacaktır") bu akışta YANILTICI olurdu.
            if ($r->refund_method === RefundMethod::None) {
                $closed = $this->refundService->closeWithoutRefund(
                    $r,
                    null,
                    'Kapıda ödeme iptali — tahsilat yapılmadığı için iade edilecek tutar yok.'
                );
                if ($closed['success']) {
                    return;
                }
                // Kapanamadıysa eski davranışa düş (talep Processing'de kalır, panelde görünür).
            }

            // Müşteriye "iptal işleme alındı" bildirimi (dry-run varsayılan).
            $this->notifier->notify($r, 'cancel_processing');

            return;
        }

        // Başarısız: durum Pending kalır; hata kaydı + generic "alındı" SMS'i.
        $meta = $r->metadata ?? [];
        $meta['erp_error'] = ['error' => $result['error'] ?? 'bilinmeyen', 'at' => now()->toIso8601String()];
        $r->metadata = $meta;
        $r->save();

        $this->audit->log($r, 'cancel_process_failed', [
            'actor_type' => ReturnActorType::System,
            'payload' => ['error' => $result['error'] ?? null],
        ]);

        $this->notifier->notify($r, 'submitted');
    }

    /**
     * İADE otomasyonu (submit anında): Sürat iade gönderisini oluştur → müşteriye kargo kodu.
     * Başarı → Pending → AwaitingShipment, cargo_tracking_code set + `cargo_code` SMS (kargo otomatik
     * takip cron'u buradan devralır). Başarısız → Pending kalır, metadata.cargo_error + generic SMS
     * (kod ayrıca iletilecek). dry_run iken DRYRUN- kod döner, akış yine ilerler.
     */
    private function autoCreateReturnShipment(ReturnRequest $r): void
    {
        $cargoSvc = CargoProviderFactory::forTenant($r->tenant);
        $cargo = $cargoSvc->createReturnShipment($r);

        if ($cargo['success']) {
            DB::transaction(function () use ($r, $cargo) {
                $from = $r->status;
                $r->cargo_provider = $cargo['provider'];
                $r->cargo_tracking_code = $cargo['tracking_code'];
                $r->cargo_label_url = $cargo['label_url'];
                $r->shipment_status = $cargo['dry_run'] ? 'dry_run' : 'created';
                $r->status = ReturnStatus::AwaitingShipment;
                $r->save();

                $this->audit->log($r, 'cargo_created', [
                    'actor_type' => ReturnActorType::System,
                    'from_status' => $from->value,
                    'to_status' => ReturnStatus::AwaitingShipment->value,
                    'payload' => array_filter([
                        'cargo_tracking_code' => $cargo['tracking_code'],
                        'dry_run' => ($cargo['dry_run'] ?? false) ? 'evet' : 'hayır',
                    ]),
                ]);
            });

            // Ticimax siparişini 'İade Talebi Alındı' statüsüne çek (kullanıcı kararı 2026-07-07).
            // Best-effort: başarısız olsa da akış devam eder (kargo kodu verildi); sonuç metadata+audit'e.
            // YALNIZ Ticimax tenant'larında (ikas'ta muadil statü yazımı yok — gereksiz hata kaydı üretme).
            if ($this->ticimaxChannel($r->tenant)) {
                $ticimax = $this->erp->ticimaxReturnRequested($r);
                $meta = $r->metadata ?? [];
                $meta['ticimax_return_requested'] = $ticimax;
                $r->metadata = $meta;
                $r->save();
                $this->audit->log($r, 'ticimax_return_requested', [
                    'actor_type' => ReturnActorType::System,
                    'payload' => array_filter([
                        'durum' => $ticimax['payload']['durum'] ?? null,
                        'success' => ($ticimax['success'] ?? false) ? 'evet' : 'hayır',
                        'dry_run' => ($ticimax['dry_run'] ?? false) ? 'evet' : null,
                        'error' => $ticimax['error'] ?? null,
                    ]),
                ]);
            }

            // Müşteriye iade kargo kodu + talimat SMS'i (dry-run varsayılan).
            $this->notifier->notify($r, 'cargo_code', [
                'tracking_code' => $r->cargo_tracking_code,
                'expire_days' => $this->rules->shipmentExpireDays($r->tenant),
            ]);

            return;
        }

        // Başarısız: Pending kalır; hata kaydı + generic "talep alındı" SMS'i.
        $meta = $r->metadata ?? [];
        $meta['cargo_error'] = ['error' => $cargo['error'] ?? 'bilinmeyen', 'at' => now()->toIso8601String()];
        $r->metadata = $meta;
        $r->save();

        $this->audit->log($r, 'cargo_create_failed', [
            'actor_type' => ReturnActorType::System,
            'payload' => ['error' => $cargo['error'] ?? null],
        ]);

        $this->notifier->notify($r, 'submitted');
    }

    /**
     * Kusur bildirimi fotoğraflarını kaydeder (kind=customer_upload, gizli disk — indirme
     * yetki kontrollü personel ucundan). Submit validasyonu 1-5 görsel garantiler; kayıt
     * best-effort'tur: tek dosya hatası talebi düşürmez, hata metadata+audit'e yazılır.
     */
    private function storeCustomerPhotos(ReturnRequest $r, array $files): void
    {
        $saved = 0;
        $errors = [];
        foreach ($files as $file) {
            try {
                $disk = 'local';
                $path = $file->store("returns/{$r->tenant_id}/{$r->id}", $disk);
                ReturnAttachment::create([
                    'tenant_id' => $r->tenant_id,
                    'return_request_id' => $r->id,
                    'kind' => 'customer_upload',
                    'disk' => $disk,
                    'path' => $path,
                    'original_name' => basename((string) $file->getClientOriginalName()),
                    // GÜVENLİK: istemcinin beyan ettiği tür DEĞİL, içerikten algılanan tür saklanır
                    'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                    'size_bytes' => $file->getSize(),
                    'uploaded_by' => null,
                ]);
                $saved++;
            } catch (\Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }

        if ($errors) {
            $meta = $r->metadata ?? [];
            $meta['photo_errors'] = $errors;
            $r->metadata = $meta;
            $r->save();
        }

        $this->audit->log($r, 'customer_photos', [
            'actor_type' => ReturnActorType::Customer,
            'payload' => array_filter(['saved' => $saved, 'failed' => count($errors) ?: null]),
        ]);
    }

    private function resolveTenant(string $slug): ?Tenant
    {
        return Tenant::where('slug', $slug)->where('is_active', true)->first();
    }

    private function ticimaxChannel(Tenant $tenant): ?Channel
    {
        // Adı üstünde Ticimax kanalı: tenant'ta ikas gibi başka bir e-ticaret
        // kanalı da varsa ->first() onu kapmasın diye platform filtresi şart.
        return Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'like', 'ticimax%')
            ->where('type', 'like', '%-ecommerce')
            ->where('is_active', true)
            ->first();
    }

    /** Talebin bağlandığı e-ticaret kanalı: Ticimax yoksa ikas (Boise). */
    private function platformChannelId(Tenant $tenant): ?int
    {
        return $this->ticimaxChannel($tenant)?->id
            ?? Channel::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->where('type', 'ikas-ecommerce')
                ->where('is_active', true)
                ->value('id');
    }

    /** Tenant'ın Nebim servisi (iptal faturalaşma kontrolü için) — config + tenant ayarı + opsiyonel kanal. */
    private function nebimFor(Tenant $tenant): NebimService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'nebim-v3')
            ->where('is_active', true)
            ->first();

        $cfg = (array) config('returns.integrations.nebim', []);
        $tenantCfg = $tenant->settings['returns_integrations']['nebim'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return NebimService::fromChannel($channel, $cfg);
    }

    /**
     * Token doğrula + siparişi Ticimax'ten CANLI tekrar çek (taze veri, money-safe).
     * @return array{0:Tenant,1:array,2:?JsonResponse,3:?string}
     */
    private function authorizeAndFetch(Request $request, string $slug): array
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return [null, null, response()->json(['error' => 'not_found'], 404), null];
        }

        $rawToken = (string) $request->input('token', '');
        $claims = $rawToken ? $this->token->verify($rawToken, $tenant->id) : null;
        if (! $claims) {
            return [$tenant, null, response()->json(['error' => 'Oturum süresi doldu. Lütfen siparişinizi tekrar sorgulayın.'], 401), null];
        }

        $gateway = ReturnOrderGateway::forTenant($tenant);
        if (! $gateway) {
            return [$tenant, null, response()->json(['error' => 'service_unavailable'], 503), null];
        }

        $res = $gateway->getOrderByNo($claims['order_no']);
        if (! ($res['success'] ?? false)) {
            return [$tenant, null, response()->json(['error' => self::GENERIC_LOOKUP_ERROR], 422), null];
        }

        // Token'daki sipariş ID ile birebir eşleşme (token kurcalanmasına karşı)
        $order = $gateway->normalize($res['order']);
        if ($claims['platform_order_id'] && $order['platform_order_id']
            && (string) $claims['platform_order_id'] !== (string) $order['platform_order_id']) {
            return [$tenant, null, response()->json(['error' => self::GENERIC_LOOKUP_ERROR], 422), null];
        }

        return [$tenant, $order, null, $rawToken];
    }

    /** @return array<int,array{line_id:string,qty:int}> */
    private function validatedSelections(Request $request): array
    {
        $data = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.line_id' => 'required|string|max:64',
            'items.*.qty' => 'required|integer|min:1|max:1000',
        ]);

        return $this->normalizeSelections($data['items']);
    }

    private function normalizeSelections(array $items): array
    {
        return array_map(fn ($i) => [
            'line_id' => (string) $i['line_id'],
            'qty' => (int) $i['qty'],
        ], $items);
    }

    /**
     * Seçim, siparişteki adetli TÜM kalemleri tam adetle kapsıyor mu? (İptal = daima tam sipariş.)
     * Fazla adet/bilinmeyen satır burada değil RefundCalculator'da reddedilir.
     */
    private function selectionCoversFullOrder(array $order, array $selections): bool
    {
        $byLine = [];
        foreach ($selections as $s) {
            $byLine[$s['line_id']] = ($byLine[$s['line_id']] ?? 0) + $s['qty'];
        }

        foreach ($order['items'] as $it) {
            $qty = (int) ($it['qty'] ?? 0);
            if ($qty > 0 && ($byLine[(string) $it['line_id']] ?? 0) < $qty) {
                return false;
            }
        }

        return true;
    }

    /**
     * İptal/iade uygunluk değerlendirmesi — DURUM bazlı + fail-closed.
     *
     * İptal: yalnızca kargoya verilmeden önceki statüler (cancellable_statuses).
     * İade:  yalnızca teslim edilmiş statüler (returnable_statuses) VE iade penceresi içinde.
     * Listede olmayan statü → her ikisi de kapalı (güvenli taraf).
     * `return_in_transit` açıksa durum 6 (Kargoya Verildi) da iadeye açılır — kapıda ödeme hariç.
     */
    private function evaluateEligibility(Tenant $tenant, array $order, array $rules, bool $cod = false): array
    {
        $reasons = [];
        $status = (int) ($order['status'] ?? -1);
        $statusLabel = $order['status_label'] ?? '';

        $isCancellable = in_array($status, $rules['cancellable_statuses'], true);
        $isReturnable = in_array($status, $rules['returnable_statuses'], true);
        // Kargodaki sipariş: Ticimax 'Teslim Edildi'yi geç yazıyor, ürünü almış müşteri bekletilmez.
        // Kapıda ödemede açılmaz — tahsilat/teslim teyidi yok (paketi reddeden müşteriye havale riski).
        $inTransit = false;
        if (! $isReturnable && $status === 6 && ($rules['return_in_transit'] ?? false)) {
            if ($cod) {
                $reasons[] = 'Kapıda ödemeli siparişinizde iade talebini, ürünü teslim aldıktan sonra oluşturabilirsiniz.';
            } else {
                $isReturnable = true;
                $inTransit = true;
            }
        }

        // ── İptal ──
        $canCancel = $rules['enabled'] && $rules['cancel_enabled'] && $isCancellable;
        // Savunma katmanı: kargo takip no varsa iptal yok (statü gecikmeli güncellenmiş olabilir)
        if ($canCancel && $rules['cancel_block_if_shipped'] && ! empty($order['cargo_tracking_no'])) {
            $canCancel = false;
        }
        // FATURALAŞMA KONTROLÜ (Nebim) — FAIL-CLOSED (para-kritik):
        // İptale yalnızca "sipariş Nebim'de VAR ve faturasız" pozitif teyidiyle izin verilir.
        // Nebim aktifken kesin teyit alınamayan her durumda iptal AÇILMAZ + müşteriye uyarı:
        //   - ERP'ye ulaşılamadı/doğrulanamadı  → "birazdan tekrar deneyin"
        //   - sipariş henüz Nebim'e düşmedi (connector ~10 dk gecikme) → "siparişiniz henüz işleniyor"
        //   - faturalanmış → kalıcı blok (ERP "Satış İade İzni Yok" zaten reddeder)
        if ($canCancel) {
            $nebim = $this->nebimFor($tenant);
            if ($nebim->isEnabled()) {
                // Barkodlar: aynı belge numaralı başka kanal siparişlerini (FLO, n11…) ayıklamak için.
                $inv = $nebim->getInvoiceStatus(
                    (string) ($order['platform_order_id'] ?? ''),
                    array_column((array) ($order['items'] ?? []), 'barcode')
                );
                if (! $inv['success']) {
                    $canCancel = false;
                    $reasons[] = 'Sipariş durumunuz şu anda doğrulanamıyor. Lütfen birkaç dakika sonra tekrar deneyin.';
                } elseif (! $inv['found']) {
                    $canCancel = false;
                    $reasons[] = 'Siparişinizdeki işlemler henüz tamamlanmadı. Kayıtlarımıza ulaşması birkaç dakika sürebilir; lütfen biraz sonra tekrar deneyin.';
                } elseif ($inv['invoiced']) {
                    $canCancel = false;
                    $reasons[] = 'Siparişiniz faturalandığı için iptal edilemiyor. Ürünü teslim aldıktan sonra iade talebi oluşturabilirsiniz.';
                }
            }
        }

        // ── İade ──
        $canReturn = $rules['enabled'] && $rules['return_enabled'] && $isReturnable;
        $deadline = null;
        if ($isReturnable) {
            // Pencere: SİPARİŞ tarihinden itibaren. Teslim tarihi bazlı pencere DESTEKLENMİYOR —
            // sipariş kaydında teslim tarihi yok (Sürat TeslimTarihi yalnızca iade gönderisine ait).
            $basisDate = $this->parseDate($order['order_date'] ?? null);
            if ($basisDate) {
                $deadline = $basisDate->copy()->addDays($rules['return_window_days']);
                if (now()->greaterThan($deadline)) {
                    $canReturn = false;
                    $reasons[] = "İade süresi doldu ({$rules['return_window_days']} gün).";
                }
            } else {
                // Tarih belirlenemiyorsa pencere doğrulanamaz → güvenli tarafta kal (engelle)
                $canReturn = false;
                $reasons[] = 'Sipariş tarihi doğrulanamadığı için iade başlatılamadı.';
            }
        }

        // ── Kusur bildirimi (kullanım sonrası) ──
        // YALNIZCA iade penceresi gerçekten DOLMUŞ teslim edilmiş siparişlerde açılır (pencere
        // içindeyken normal iade kullanılır). Tarih doğrulanamıyorsa fail-closed: açılmaz.
        $canDefect = false;
        if ($rules['enabled'] && ($rules['defect_enabled'] ?? false) && $isReturnable && ! $inTransit
            && isset($basisDate, $deadline) && $basisDate && $deadline && now()->greaterThan($deadline)) {
            $maxDays = (int) ($rules['defect_max_days'] ?? 0);
            $canDefect = $maxDays <= 0 || now()->lessThanOrEqualTo($basisDate->copy()->addDays($maxDays)->endOfDay());
        }

        // Açıklayıcı genel sebep
        if (! $canReturn && ! $canCancel && empty($reasons)) {
            if (in_array($status, [8, 9, 11, 12, 13, 15, 16, 17], true)) {
                $reasons[] = "Bu sipariş için zaten bir işlem mevcut ({$statusLabel}).";
            } elseif ($status === 6) {
                $reasons[] = 'Siparişiniz kargoya verildi; teslim aldıktan sonra iade talebi oluşturabilirsiniz.';
            } else {
                $reasons[] = "Bu sipariş durumunda işlem yapılamıyor ({$statusLabel}).";
            }
        }

        return [
            'can_return' => $canReturn,
            'can_cancel' => $canCancel,
            'can_defect' => $canDefect,
            'in_transit' => $inTransit,
            'status' => $status,
            'status_label' => $statusLabel,
            'return_window_days' => $rules['return_window_days'],
            'deadline' => $deadline?->format('Y-m-d'),
            'reasons' => $reasons,
        ];
    }

    /**
     * Müşteriye gösterilecek iade yöntemleri.
     *
     * KAPIDA ÖDEME (cod=true): karta iade seçeneği GÖSTERİLMEZ — ortada iade edilecek bir kart
     * işlemi yoktur (kullanıcı kararı 2026-09-01). Yerine HAVALE/EFT gelir; müşteri banka adı,
     * ad soyad ve IBAN'ını paylaşır, ödeme finans ekibince yapılır. İndirim kodu seçeneği tenant
     * kuralı açıksa kapıda ödemede de geçerlidir (para hareketi gerektirmez).
     */
    private function availableRefundMethods(array $rules, bool $cod = false): array
    {
        $methods = [];
        if ($rules['allow_store_credit']) {
            $methods[] = [
                'value' => RefundMethod::StoreCredit->value,
                'label' => RefundMethod::StoreCredit->label(),
                'promoted' => (bool) $rules['promote_store_credit'],
                'note' => 'Anında indirim kodu — beklemeden yeni alışveriş.',
            ];
        }
        if ($cod) {
            // Kapıda ödemede karta iade imkânsız → yerine havale. allow_original_refund kuralı
            // "para iadesi açık mı" anlamında yorumlanır; kapalıysa yalnız indirim kodu kalır.
            if ($rules['allow_original_refund']) {
                $methods[] = [
                    'value' => RefundMethod::BankTransfer->value,
                    'label' => RefundMethod::BankTransfer->label(),
                    'promoted' => false,
                    'note' => 'Siparişinizi kapıda ödediğiniz için iade banka hesabınıza havale ile yapılır.',
                    'needs_bank_account' => true,
                ];
            }

            return $methods;
        }

        if ($rules['allow_original_refund']) {
            $methods[] = [
                'value' => RefundMethod::Original->value,
                'label' => RefundMethod::Original->label(),
                'promoted' => false,
                'note' => 'Kart/banka türüne göre 14 iş gününe kadar sürebilir.',
            ];
        }

        return $methods;
    }

    /**
     * HAVALE BİLGİSİ doğrulama + normalize (kapıda ödeme iadesi).
     * Para müşterinin beyan ettiği hesaba gideceği için AD SOYAD + IBAN zorunludur ve IBAN
     * matematiksel olarak (TR + 24 hane + ISO 7064 mod-97) doğrulanır — yazım hatası olan IBAN'a
     * havale yapılıp para kaybolmasın. Banka adı OPSİYONELDİR (kullanıcı kararı 2026-09-01):
     * havale IBAN'la yapılır, banka zaten IBAN'ın içinde kodludur; müşteriyi gereksiz alanla
     * yormamak için serbest metin ve zorunsuzdur.
     *
     * @return array{bank_name:string, account_holder:string, iban:string, collected_at:string}|string
     *         Hata durumunda müşteriye gösterilecek mesaj (string) döner.
     */
    private function normalizeBankAccount(array $in): array|string
    {
        $bank = trim((string) ($in['bank_name'] ?? ''));
        $holder = trim((string) ($in['account_holder'] ?? ''));
        $iban = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($in['iban'] ?? '')) ?? '');

        if (mb_strlen($holder) < 5 || ! str_contains($holder, ' ')) {
            return 'Hesap sahibinin adını ve soyadını giriniz.';
        }
        if (! $this->isValidTrIban($iban)) {
            return 'Geçerli bir TR IBAN giriniz (TR ile başlayan 26 karakter).';
        }

        return [
            'bank_name' => mb_substr($bank, 0, 80),
            'account_holder' => mb_substr($holder, 0, 120),
            'iban' => $iban,
            'collected_at' => now()->toIso8601String(),
        ];
    }

    /** TR IBAN doğrulaması: 26 karakter + ISO 7064 mod-97 = 1. */
    private function isValidTrIban(string $iban): bool
    {
        if (! preg_match('/^TR\d{24}$/', $iban)) {
            return false;
        }

        // IBAN mod-97: ilk 4 karakter sona alınır, harfler A=10..Z=35 ile sayıya çevrilir.
        $rearranged = substr($iban, 4) . substr($iban, 0, 4);
        $numeric = '';
        foreach (str_split($rearranged) as $chr) {
            $numeric .= ctype_alpha($chr) ? (string) (ord($chr) - 55) : $chr;
        }

        // bcmod yoksa parça parça mod alınır (uzun sayı int'e sığmaz).
        $remainder = 0;
        foreach (str_split($numeric, 7) as $chunk) {
            $remainder = (int) ((string) $remainder . $chunk) % 97;
        }

        return $remainder === 1;
    }

    private function publicOrderView(array $order): array
    {
        return [
            'order_no' => $order['order_no'],
            'status_label' => $order['status_label'],
            'order_date' => $order['order_date'],
            'currency' => $order['currency'],
            'customer_name' => $order['customer_name'],
            'total_amount' => $order['total_amount'],
            'paid_amount' => $order['paid_amount'],
            'cargo_company' => $order['cargo_company'],
            'items' => array_map(fn ($i) => [
                'line_id' => $i['line_id'],
                'name' => $i['name'],
                'sku' => $i['sku'],
                'variant_info' => $i['variant_info'],
                'image_url' => $i['image_url'],
                'qty' => $i['qty'],
                'unit_price' => $i['unit_price'],
                'status_label' => $i['status_label'],
            ], $order['items']),
        ];
    }

    /**
     * Kargo ücreti iade tutarına dahil mi? İPTAL'de ayrı kural geçerlidir (varsayılan: DAHİL —
     * sipariş kargoya verilmediği için kargo hizmeti verilmemiştir, kullanıcı kararı 2026-08-03).
     * İADE/KUSUR'da eski davranış korunur (refund_shipping, yalnızca tam iadede).
     */
    private function refundShippingFor(ReturnType $type, array $rules): bool
    {
        return $type === ReturnType::Cancel
            ? (bool) ($rules['refund_shipping_cancel'] ?? true)
            : (bool) $rules['refund_shipping'];
    }

    /**
     * Sepet kampanyası telafisi uygulanacak mı? Tenant kuralı açık olmalı; KUSUR bildiriminde
     * uygulanmaz (kusurlu ürün firma sorumluluğu — müşteri kampanya kaybıyla cezalandırılmaz).
     * İADE ve İPTAL'de (kısmi) uygulanır.
     */
    private function campaignRecoveryFor(ReturnType $type, array $rules): bool
    {
        return $type !== ReturnType::Defect && (bool) ($rules['campaign_discount_recovery'] ?? false);
    }

    private function publicRulesView(array $rules): array
    {
        return [
            'return_window_days' => $rules['return_window_days'],
            'refund_shipping' => $rules['refund_shipping'],
            'require_condition_declaration' => $rules['require_condition_declaration'],
            'promote_store_credit' => $rules['promote_store_credit'],
        ];
    }

    /**
     * SİPARİŞ BAŞINA TEK İADE HAKKI (kullanıcı kararı 2026-07-30): bir siparişte talep
     * oluşturulduysa — süreçte VEYA tamamlanmış (refunded/completed) — yeni talep açılamaz
     * (10 ürünü 10 ayrı talep/kargoyla gönderme suistimali engellenir; müşteri tüm ürünleri
     * TEK talepte seçmeli). Yalnız Rejected ve CancelledByCustomer (kargolanmadan süresi
     * dolan kod dahil) yeniden talep hakkı verir — expired SMS'i de bunu söylüyor.
     *
     * @return ReturnRequest|null Engelleyen en güncel talep (yoksa null).
     */
    private function blockingRequest(int $tenantId, ?string $platformOrderId, ?string $orderNo): ?ReturnRequest
    {
        $retryable = [
            ReturnStatus::Rejected->value,
            ReturnStatus::CancelledByCustomer->value,
        ];

        return ReturnRequest::query()
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($platformOrderId, $orderNo) {
                if ($platformOrderId) {
                    $q->where('platform_order_id', $platformOrderId);
                }
                if ($orderNo) {
                    $q->orWhere('order_no', $orderNo);
                }
            })
            ->whereNotIn('status', $retryable)
            ->latest('id')
            ->first();
    }

    /** Engelleyen talebe göre müşteri mesajı (409 gövdesi + eligibility reason). */
    private function blockingMessage(ReturnRequest $blocking): string
    {
        // Personel kaynaklı eksik/hatalı ürün iadesi: sipariş kısmen gönderildi ve gönderilemeyen
        // kalemin parası iade edildi/ediliyor — aynı sipariş için self-servis talep açılamaz
        // (kalem çakışması → çift iade riski); kalan ürünler için müşteri hizmetleri yönlendirir.
        if ($blocking->type === ReturnType::Shortage) {
            return 'Bu siparişinizde gönderilemeyen ürün için tarafımızca başlatılmış bir iade işlemi bulunuyor ('
                . $blocking->public_code . '). Diğer ürünler için lütfen müşteri hizmetlerimizle iletişime geçin.';
        }

        return in_array($blocking->status, [ReturnStatus::Refunded, ReturnStatus::Completed], true)
            ? 'Bu siparişiniz için daha önce iade işlemi tamamlandı. Aynı sipariş için yeniden talep oluşturulamaz.'
            : 'Bu sipariş için işlemde olan bir talebiniz zaten var (' . $blocking->public_code . '). İade etmek istediğiniz tüm ürünleri tek talepte seçebilirsiniz.';
    }

    private function contactMatchesRequest(ReturnRequest $rr, string $contact): bool
    {
        $contact = trim($contact);
        if ($rr->customer_email && strtolower($contact) === strtolower($rr->customer_email)) {
            return true;
        }
        if ($rr->customer_phone) {
            $a = preg_replace('/\D+/', '', $contact);
            $b = preg_replace('/\D+/', '', $rr->customer_phone);
            if (strlen($a) >= 10 && strlen($b) >= 10 && substr($a, -10) === substr($b, -10)) {
                return true;
            }
        }

        return false;
    }

    private function generatePublicCode(Tenant $tenant, ?ReturnType $type = null): string
    {
        // İptal/iade ayrımı (personel paneli için anlamlı kayıt). İptalde kod müşteriye
        // gösterilmez ama DB kimliği olarak yine üretilir.
        //
        // Format: tenant öneki + 8 rakam (örn. tba48291037). Önek yoksa YALNIZ rakam, 10 hane
        // (öneksiz kod daha geniş uzay ister — 10^10). Eski IADE-/IPTAL-/KUSUR- varsayılanları
        // Tonny Black'e özel yazılmıştı; artık varsayılan DEĞİL (TB'de tenant ayarı olarak duruyor,
        // kullanıcı kararı 27.07). Rakamda I/i, O/0 ikizi yok; kısa ve şube personelinin yazması
        // kolay. Önek küçük harf saklanır — Sürat sorgusu Türkçe katlamalı case-insensitive
        // (canlı test 27.07: "Iade-Deh9n3yy" bulundu, "iade-..." ise i→İ≠I yüzünden bulunamadı;
        // bu yüzden önekte i/ı sanitize'da yasak). Eski üretilmiş kodlar DB'de aynen geçerli.
        $key = match ($type) {
            ReturnType::Cancel => 'cancel',
            ReturnType::Defect => 'defect',
            default => 'return',
        };
        $custom = trim((string) data_get($tenant->settings, "returns_integrations.code_prefixes.$key", ''));

        $make = $custom !== ''
            ? fn (int $extra): string => $custom . ReadableCode::digits(8 + $extra)
            : fn (int $extra): string => ReadableCode::digits(10 + $extra);

        // Benzersizlik: çakışırsa yeniden üret; teorik tükenmeye karşı 20 denemede bir uzat.
        // Karşılaştırma case-insensitive (kod dış sistemlerde harf katlamalı aranabiliyor).
        $attempt = 0;
        do {
            $code = $make(intdiv($attempt++, 20));
        } while (ReturnRequest::query()->whereRaw('UPPER(public_code) = UPPER(?)', [$code])->exists());

        return $code;
    }

    private function parseDate(?string $value): ?Carbon
    {
        if (! $value) {
            return null;
        }
        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }
}
