<?php

namespace App\Http\Controllers\Api;

use App\Console\Commands\SyncCrmOrders;
use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Models\Order;
use App\Models\OrderDelayEvent;
use App\Models\OrderDelayReview;
use App\Models\OrderItem;
use App\Models\OrderShipmentCheck;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Cargo\SuratShipmentFeed;
use App\Services\Crm\DelayShipmentChecker;
use App\Services\Crm\PaymentMethod;
use App\Services\OrderDelayService;
use App\Services\TicimaxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CRM › Gecikmeler — geciken siparişleri listeler, adetler, personelin
 * inceleme/müdahale kaydını tutar. Gecikme hesabı: OrderDelayService.
 */
class CrmOrderDelayController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $service = $this->service($request);
        $all = $this->withChecks($service->delayedOrders());
        $rows = $this->applySort($this->applyFilters($all, $request), $request);

        $perPage = min(max((int) ($request->per_page ?? 50), 10), 200);
        $page = max(1, (int) ($request->page ?? 1));
        $total = $rows->count();
        $slice = $rows->slice(($page - 1) * $perPage, $perPage)->values();

        $items = OrderItem::query()
            ->whereIn('order_id', $slice->pluck('order.id'))
            ->orderBy('id')
            ->get(['order_id', 'product_id', 'product_name', 'variant_info', 'sku', 'quantity', 'image_url', 'status', 'status_label', 'total_price'])
            ->groupBy('order_id');

        $adminBases = $this->adminBases($slice->pluck('order.channel_id')->unique()->filter()->all());

        return response()->json([
            'data' => $slice->map(fn ($r) => $this->present($r, $items->get($r['order']->id, collect()), $adminBases)),
            'current_page' => $page,
            'last_page' => max(1, (int) ceil($total / $perPage)),
            'total' => $total,
            'per_page' => $perPage,
        ]);
    }

    /**
     * Ekrandaki filtre + sıralamayla TÜM geciken siparişler — Excel uyumlu CSV
     * (UTF-8 BOM + ';'). Sipariş başına bir satır; ürünler tek hücrede.
     */
    public function export(Request $request): StreamedResponse
    {
        $rows = $this->applySort($this->applyFilters($this->withChecks($this->service($request)->delayedOrders()), $request), $request);

        $items = OrderItem::query()
            ->whereIn('order_id', $rows->pluck('order.id'))
            ->orderBy('id')
            ->get(['order_id', 'product_name', 'variant_info', 'sku', 'quantity'])
            ->groupBy('order_id');

        $adminBases = $this->adminBases($rows->pluck('order.channel_id')->unique()->filter()->all());
        $stateLabels = [
            'new' => 'Yeni', 'reviewing' => 'İnceleniyor', 'customer_informed' => 'Müşteri bilgilendirildi',
            'waiting_supply' => 'Tedarik bekleniyor', 'resolved' => 'Çözüldü',
        ];
        $money = fn ($v) => number_format((float) $v, 2, ',', '.');

        $filename = 'geciken-siparisler-' . now('Europe/Istanbul')->format('Ymd-Hi') . '.csv';
        $cargoOn = SuratShipmentFeed::enabled(Tenant::findOrFail($this->tenantId($request)));

        return response()->streamDownload(function () use ($rows, $items, $adminBases, $stateLabels, $money, $cargoOn) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM → Excel Türkçe karakterleri doğru açar
            $header = [
                'Sipariş No', 'Ticimax ID', 'Nebim Sipariş No', 'Nebim Fatura No', 'Kargo Kontrolü', 'Kargo Kontrol Detayı', 'Sipariş Tarihi', 'Kanal', 'Statü', 'Söz Verilen Kargo Günü',
                'Gecikme (gün)', 'Sipariş Yaşı (gün)', 'Ödeme', 'Müşteri', 'Telefon', 'E-posta', 'İlçe / İl',
                'Tutar', 'Ödenen', 'Ürün Adedi', 'Ürünler', 'Stok Kodları', 'Kargo Firması', 'Takip No',
                'İnceleme Durumu', 'Sorumlu', 'Not', 'Takip Tarihi', 'Ticimax Linki',
            ];
            // Kargo kontrolü pasifken o iki sütun hiç yazılmaz
            $strip = fn (array $r) => $cargoOn ? $r : array_values(array_diff_key($r, [4 => 1, 5 => 1]));
            fputcsv($out, $strip($header), ';');

            foreach ($rows as $r) {
                $row = $this->present($r, $items->get($r['order']->id, collect()), $adminBases);
                $review = $row['review'];
                fputcsv($out, $strip([
                    $row['order_no'],
                    $row['platform_order_id'],
                    $row['shipment_check']['nebim_order_number'] ?? '',
                    $row['shipment_check']['nebim_invoice_number'] ?? '',
                    ($row['shipment_check']['verdict'] ?? null) === 'disabled' ? '' : ($row['shipment_check']['verdict_label'] ?? 'Henüz kontrol edilmedi'),
                    $row['shipment_check']['summary'] ?? '',
                    $row['order_date'] ? substr((string) $row['order_date'], 0, 16) : '',
                    $row['order_source'] ?? '',
                    $row['status_label'] ?? '',
                    $row['due_date'] ?? '',
                    $row['delay_days'],
                    $row['age_days'],
                    PaymentMethod::LABELS[$row['payment_method']] ?? '',
                    $row['customer_name'] ?? '',
                    $row['phone'] ?? '',
                    $row['customer_email'] ?? '',
                    $row['city'] ?? '',
                    $money($row['total_amount']),
                    $money($row['paid_amount']),
                    collect($row['items'])->sum('quantity'),
                    collect($row['items'])->map(fn ($i) => $i['product_name']
                        . ($i['variant_info'] ? " ({$i['variant_info']})" : '')
                        . ' x' . $i['quantity'])->implode(' | '),
                    collect($row['items'])->pluck('sku')->filter()->implode(' | '),
                    $row['cargo_company'] ?? '',
                    $row['cargo_tracking_no'] ?? '',
                    $stateLabels[$review['state'] ?? 'new'] ?? ($review['state'] ?? ''),
                    $review['assigned_name'] ?? '',
                    $review['note'] ?? '',
                    $review['follow_up_at'] ?? '',
                    $row['admin_url'] ?? '',
                ]), ';');
            }

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function stats(Request $request): JsonResponse
    {
        $service = $this->service($request);
        $all = $this->withChecks($service->delayedOrders());

        // Adetler: kaynak filtresi uygulanır, diğerleri (aşama/inceleme vb.) kart tıklamasıyla seçilir
        if ($request->filled('sources')) {
            $sources = array_filter(array_map('trim', explode(',', $request->sources)));
            $all = $all->filter(fn ($r) => in_array($r['order']->order_source, $sources, true))->values();
        }
        // Ödeme dağılımı kanal filtresiyle; ödeme/kargo filtresi seçiliyse adetler de onunla
        $byPayment = $all->filter(fn ($r) => ($r['review']?->state ?? 'new') !== 'resolved')
            ->groupBy(fn ($r) => PaymentMethod::classify($r['order']->payments))->map->count()->sortDesc();
        $all = $this->applyPaymentCargo($all, $request);

        $open = $all->filter(fn ($r) => ($r['review']?->state ?? 'new') !== 'resolved');

        $byState = array_fill_keys(OrderDelayReview::STATES, 0);
        foreach ($all as $r) {
            $byState[$r['review']?->state ?? 'new']++;
        }

        $buckets = ['1' => 0, '2-3' => 0, '4-7' => 0, '8+' => 0];
        foreach ($open as $r) {
            $buckets[OrderDelayService::bucket($r['delay_days'])]++;
        }

        $countBy = fn (Collection $c, callable $key) => $c->groupBy($key)->map->count()->sortDesc();

        // En çok geciken ürünler (açık hazırlık gecikmeleri) — stok/tedarik sorunu sinyali
        $prepIds = $open->where('stage', 'prep')->pluck('order.id');
        $topProducts = $prepIds->isEmpty() ? [] : OrderItem::query()
            ->whereIn('order_id', $prepIds)
            ->selectRaw("COALESCE(NULLIF(split_part(sku, '|', 2), ''), sku, product_name) as model, MAX(product_name) as product_name, MAX(image_url) as image_url, COUNT(DISTINCT order_id) as order_count, SUM(quantity) as quantity")
            ->groupBy('model')
            ->orderByDesc('order_count')
            ->limit(10)
            ->get();

        $today = now('Europe/Istanbul')->startOfDay();

        return response()->json([
            'total' => $all->count(),
            'open' => $open->count(),
            'prep' => $open->where('stage', 'prep')->count(),
            'unreviewed' => $byState['new'],
            'open_amount' => round((float) $open->sum(fn ($r) => (float) $r['order']->total_amount), 2),
            'max_delay' => (int) ($open->max('delay_days') ?? 0),
            'avg_delay' => round((float) ($open->avg('delay_days') ?? 0), 1),
            'follow_up_due' => $open->filter(fn ($r) => $r['review']?->follow_up_at && $r['review']->follow_up_at->lte($today))->count(),
            'buckets' => $buckets,
            'by_state' => $byState,
            'by_source' => $countBy($open, fn ($r) => $r['order']->order_source ?: '—'),
            'by_payment' => $byPayment,
            'cargo_check_enabled' => $cargoOn = SuratShipmentFeed::enabled(Tenant::findOrFail($this->tenantId($request))),
            'by_shipment' => $cargoOn ? $countBy($open, fn ($r) => $r['shipment']?->verdict ?? 'pending') : [],
            'shipment_accounts' => $cargoOn ? (new SuratShipmentFeed(Tenant::findOrFail($this->tenantId($request))))->accountKeys() : [],
            'by_cargo' => $countBy($open, fn ($r) => $r['order']->cargo_company ?: '—'),
            'by_status' => $open->groupBy(fn ($r) => $r['order']->status)->map(fn ($g) => [
                'status' => (int) $g->first()['order']->status,
                'label' => $g->first()['order']->status_label,
                'count' => $g->count(),
            ])->values()->sortByDesc('count')->values(),
            'top_products' => $topProducts,
            'users' => User::where('tenant_id', $this->tenantId($request))->orderBy('name')->get(['id', 'name']),
            'config' => $service->config(),
        ]);
    }

    /** Tek siparişin inceleme durumu / notu / sorumlusu / takip tarihi. */
    public function update(Request $request, int $orderId): JsonResponse
    {
        $data = $request->validate([
            'state' => ['sometimes', Rule::in(OrderDelayReview::STATES)],
            'note' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'assigned_user_id' => ['sometimes', 'nullable', 'integer'],
            'follow_up_at' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ]);

        $order = Order::findOrFail($orderId);
        $review = $this->applyReview($request, $order, $data);

        return response()->json($this->presentReview($review->load('assignee:id,name')));
    }

    /** Toplu durum / sorumlu değişikliği (seçili satırlar). */
    public function bulk(Request $request): JsonResponse
    {
        $data = $request->validate([
            'order_ids' => ['required', 'array', 'min:1', 'max:200'],
            'order_ids.*' => ['integer'],
            'state' => ['sometimes', Rule::in(OrderDelayReview::STATES)],
            'assigned_user_id' => ['sometimes', 'nullable', 'integer'],
            'note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $orders = Order::whereIn('id', $data['order_ids'])->get();
        $fields = array_intersect_key($data, array_flip(['state', 'assigned_user_id', 'note']));

        DB::transaction(function () use ($request, $orders, $fields) {
            foreach ($orders as $order) {
                $this->applyReview($request, $order, $fields);
            }
        });

        return response()->json(['updated' => $orders->count()]);
    }

    public function events(int $orderId): JsonResponse
    {
        Order::findOrFail($orderId);

        $events = OrderDelayEvent::with('user:id,name')
            ->where('order_id', $orderId)
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return response()->json($events);
    }

    /**
     * Yunbi'den seçilebilen sipariş statüleri → Ticimax WebSiparisDurumlari.
     * İptal/iade bilinçli olarak YOK (para iadesi gerektirir → İade modülü).
     */
    public const SETTABLE_STATUSES = [
        2 => ['Onaylandi', 'Onaylandı'],
        4 => ['Paketleniyor', 'Paketleniyor'],
        5 => ['TedarikEdiliyor', 'Tedarik Ediliyor'],
        6 => ['KargoyaVerildi', 'Kargoya Verildi'],
    ];

    /**
     * Sipariş statüsünü Ticimax'ta değiştirir (⛔ CANLI YAZMA), ardından
     * siparişi Ticimax'tan yeniden okuyup Yunbi'ye işler ve sonucu doğrular.
     */
    public function setStatus(Request $request, int $orderId): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'integer', Rule::in(array_keys(self::SETTABLE_STATUSES))],
            'notify' => ['sometimes', 'boolean'],
            'tracking_no' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $order = Order::findOrFail($orderId);
        $channel = Channel::find($order->channel_id);
        if (! $channel || ! str_starts_with((string) $channel->type, 'ticimax')) {
            return response()->json(['message' => 'Bu sipariş Ticimax kanalına ait değil.'], 422);
        }

        [$enum, $label] = self::SETTABLE_STATUSES[$data['status']];
        $beforeLabel = $order->status_label;
        $svc = TicimaxService::fromChannel($channel);

        $res = $svc->setOrderStatus(
            (int) $order->platform_order_id,
            $enum,
            (bool) ($data['notify'] ?? false),
            (string) $order->order_no,
            $data['status'] === 6 ? ($data['tracking_no'] ?? null) : null,
        );

        $event = ['tenant_id' => $order->tenant_id, 'order_id' => $order->id, 'user_id' => $request->user()->id, 'type' => 'status'];

        if (! ($res['success'] ?? false)) {
            OrderDelayEvent::create($event + ['note' => "Statü değiştirilemedi ({$beforeLabel} → {$label}): " . ($res['error'] ?? 'Ticimax hatası')]);

            return response()->json(['message' => 'Ticimax statüyü değiştirmedi: ' . ($res['error'] ?? 'bilinmeyen hata')], 502);
        }

        // Doğrulama: Ticimax'tan geri oku + Yunbi'ye işle
        $fresh = $this->resync($svc, $order, $channel);
        $verified = $fresh && (int) $order->status === $data['status'];

        OrderDelayEvent::create($event + ['note' => "Statü değiştirildi: {$beforeLabel} → {$label}"
            . (! empty($data['tracking_no']) && $data['status'] === 6 ? " (takip no: {$data['tracking_no']})" : '')
            . (! empty($data['notify']) ? ' · müşteriye e-posta' : '')
            . ($verified ? '' : ' · ⚠ Ticimax\'ta doğrulanamadı (şu an: ' . $order->status_label . ')')]);

        return response()->json([
            'verified' => $verified,
            'status' => $order->status,
            'status_label' => $order->status_label,
            'still_delayed' => $this->service($request)->evaluate($order) !== null,
        ]);
    }

    /** Ticimax'tan tek siparişi okuyup Yunbi'ye işler; $order tazelenir. */
    protected function resync(TicimaxService $svc, Order $order, Channel $channel): bool
    {
        $result = $svc->getOrders(['SiparisID' => (int) $order->platform_order_id, 'OdemeGetir' => true], 1, 1);
        $data = $result['data']['SelectSiparisResult']['WebSiparis'] ?? [];
        if (isset($data[0])) {
            $data = $data[0];
        }
        if (! ($result['success'] ?? false) || empty($data['ID'])) {
            return false;
        }

        $syncer = new class extends SyncCrmOrders
        {
            public function syncOne(array $data, Channel $channel): void
            {
                $this->syncOrder($data, $channel);
            }
        };
        $syncer->syncOne($data, $channel);
        $order->refresh();

        return true;
    }

    /** Siparişi Ticimax'tan anlık tazele (durum/kargo bilgisi bayat olabilir). */
    public function refresh(Request $request, int $orderId): JsonResponse
    {
        $order = Order::findOrFail($orderId);
        $channel = Channel::find($order->channel_id);
        if (! $channel || ! str_starts_with((string) $channel->type, 'ticimax')) {
            return response()->json(['message' => 'Bu sipariş Ticimax kanalına ait değil.'], 422);
        }

        $before = [$order->status, $order->status_label];
        if (! $this->resync(TicimaxService::fromChannel($channel), $order, $channel)) {
            return response()->json(['message' => 'Ticimax siparişi döndürmedi.'], 502);
        }

        $changed = $before[0] !== $order->status;
        OrderDelayEvent::create([
            'tenant_id' => $order->tenant_id,
            'order_id' => $order->id,
            'user_id' => $request->user()->id,
            'type' => 'refresh',
            'note' => $changed
                ? "Ticimax'tan yenilendi: {$before[1]} → {$order->status_label}"
                : "Ticimax'tan yenilendi: durum değişmedi ({$order->status_label})",
        ]);

        $calc = $this->service($request)->evaluate($order);

        return response()->json([
            'changed' => $changed,
            'status' => $order->status,
            'status_label' => $order->status_label,
            'still_delayed' => $calc !== null,
            'delay' => $calc,
        ]);
    }

    /** Gecikme eşikleri (kargo teslim süresi, geriye bakış). Yalnız admin. */
    public function settings(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdmin() || $request->user()->isSuperAdmin(), 403);

        $data = $request->validate([
            'lookback_days' => ['required', 'integer', 'min:7', 'max:365'],
        ]);

        $tenant = Tenant::findOrFail($this->tenantId($request));
        $settings = $tenant->settings ?? [];
        $settings['delay_lookback_days'] = $data['lookback_days'];
        $tenant->settings = $settings;
        $tenant->save();

        return response()->json((new OrderDelayService($tenant))->config());
    }

    // ── yardımcılar ──

    protected function applyReview(Request $request, Order $order, array $data): OrderDelayReview
    {
        $userId = $request->user()->id;

        if (array_key_exists('assigned_user_id', $data) && $data['assigned_user_id']
            && ! User::where('tenant_id', $order->tenant_id)->whereKey($data['assigned_user_id'])->exists()) {
            abort(422, 'Geçersiz sorumlu.');
        }

        $review = OrderDelayReview::firstOrNew(['order_id' => $order->id]);
        $review->tenant_id = $order->tenant_id;
        $fromState = $review->exists ? $review->state : 'new';

        $review->fill(array_intersect_key($data, array_flip(['state', 'note', 'assigned_user_id', 'follow_up_at'])));
        $review->state ??= 'new';
        $review->updated_by = $userId;
        $review->save();

        $event = ['tenant_id' => $order->tenant_id, 'order_id' => $order->id, 'user_id' => $userId];
        if (isset($data['state']) && $data['state'] !== $fromState) {
            OrderDelayEvent::create($event + ['type' => 'state', 'from_state' => $fromState, 'to_state' => $data['state']]);
        }
        if (filled($data['note'] ?? null) && ($review->wasRecentlyCreated || $review->wasChanged('note'))) {
            OrderDelayEvent::create($event + ['type' => 'note', 'note' => $data['note']]);
        }
        if (array_key_exists('assigned_user_id', $data) && ($review->wasChanged('assigned_user_id') || ($review->wasRecentlyCreated && $data['assigned_user_id']))) {
            $name = $data['assigned_user_id'] ? User::whereKey($data['assigned_user_id'])->value('name') : null;
            OrderDelayEvent::create($event + ['type' => 'assign', 'note' => $name ? "Sorumlu: {$name}" : 'Sorumlu kaldırıldı']);
        }
        if (array_key_exists('follow_up_at', $data) && ($review->wasChanged('follow_up_at') || ($review->wasRecentlyCreated && $data['follow_up_at']))) {
            OrderDelayEvent::create($event + ['type' => 'follow_up', 'note' => $data['follow_up_at'] ? "Takip tarihi: {$data['follow_up_at']}" : 'Takip tarihi kaldırıldı']);
        }

        return $review;
    }

    protected function applySort(Collection $rows, Request $request): Collection
    {
        $sortBy = in_array($request->sort_by, ['delay_days', 'order_date', 'total_amount', 'age_days'], true)
            ? $request->sort_by : 'delay_days';

        return $rows->sortBy(fn ($r) => match ($sortBy) {
            'order_date' => (string) $r['order']->getRawOriginal('order_date'),
            'total_amount' => (float) $r['order']->total_amount,
            'age_days' => $r['age_days'],
            default => $r['delay_days'] * 1e6 + $r['age_days'],
        }, SORT_REGULAR, $request->sort_dir !== 'asc')->values();
    }

    protected function applyFilters(Collection $rows, Request $request): Collection
    {
        if ($request->filled('status')) {
            $rows = $rows->filter(fn ($r) => (int) $r['order']->status === (int) $request->status);
        }

        if ($request->filled('sources')) {
            $sources = array_filter(array_map('trim', explode(',', $request->sources)));
            $rows = $rows->filter(fn ($r) => in_array($r['order']->order_source, $sources, true));
        }

        $rows = $this->applyPaymentCargo($rows, $request);

        if ($request->filled('bucket')) {
            $rows = $rows->filter(fn ($r) => OrderDelayService::bucket($r['delay_days']) === $request->bucket);
        }

        if ($request->filled('min_delay')) {
            $rows = $rows->filter(fn ($r) => $r['delay_days'] >= (int) $request->min_delay);
        }

        // review_state: '' = hepsi, 'open' = çözülmemişler, aksi hâlde birebir durum
        $state = $request->input('review_state', 'open');
        if ($state === 'open') {
            $rows = $rows->filter(fn ($r) => ($r['review']?->state ?? 'new') !== 'resolved');
        } elseif ($state === 'follow_up') {
            $today = now('Europe/Istanbul')->startOfDay();
            $rows = $rows->filter(fn ($r) => $r['review']?->follow_up_at && $r['review']->follow_up_at->lte($today) && $r['review']->state !== 'resolved');
        } elseif ($state !== '' && $state !== null) {
            $rows = $rows->filter(fn ($r) => ($r['review']?->state ?? 'new') === $state);
        }

        if ($request->filled('assigned')) {
            $assigned = $request->assigned === 'me' ? $request->user()->id : (int) $request->assigned;
            $rows = $request->assigned === 'none'
                ? $rows->filter(fn ($r) => ! $r['review']?->assigned_user_id)
                : $rows->filter(fn ($r) => (int) $r['review']?->assigned_user_id === $assigned);
        }

        // Ürün (model kodu) — "en çok geciken ürünler" kartından gelir
        if ($request->filled('model') && $rows->isNotEmpty()) {
            $model = $this->escapeLike(trim($request->model));
            $ids = OrderItem::query()
                ->whereIn('order_id', $rows->pluck('order.id'))
                ->where(fn ($q) => $q->where('sku', 'ilike', "%{$model}%")->orWhere('product_name', 'ilike', "%{$model}%"))
                ->distinct()
                ->pluck('order_id')
                ->flip();
            $rows = $rows->filter(fn ($r) => $ids->has($r['order']->id));
        }

        // Kargo kontrolü: 'alert' = personelin bakması gerekenler (çıkmış / yanlış cari / olası manuel / faturalı)
        if ($request->filled('shipment') && SuratShipmentFeed::enabled(Tenant::findOrFail($this->tenantId($request)))) {
            $want = $request->shipment === 'alert'
                ? ['shipped', 'wrong_account', 'possible_manual', 'invoiced']
                : explode(',', (string) $request->shipment);
            $rows = $rows->filter(fn ($r) => in_array($r['shipment']?->verdict ?? 'pending', $want, true));
        }

        if ($request->filled('search')) {
            $q = mb_strtolower(trim($request->search));
            $rows = $rows->filter(function ($r) use ($q) {
                $o = $r['order'];
                $hay = mb_strtolower(implode(' ', [
                    $o->order_no, $o->customer_name, $o->customer_email, $o->cargo_tracking_no,
                    $o->shipping_address['phone'] ?? '', $o->platform_order_id,
                ]));

                return str_contains($hay, $q);
            });
        }

        return $rows->values();
    }

    /** Ödeme yöntemi + kargo firması (liste, CSV ve adet kartları ortak). */
    protected function applyPaymentCargo(Collection $rows, Request $request): Collection
    {
        if ($request->filled('payment_methods')) {
            $keys = PaymentMethod::expand((string) $request->payment_methods);
            if ($keys !== []) {
                $rows = $rows->filter(fn ($r) => in_array(PaymentMethod::classify($r['order']->payments), $keys, true));
            }
        }

        if ($request->filled('cargo_company')) {
            $cargo = $request->cargo_company === '—' ? null : $request->cargo_company;
            $rows = $rows->filter(fn ($r) => $r['order']->cargo_company === $cargo);
        }

        return $rows->values();
    }

    protected function present(array $r, Collection $items, array $adminBases): array
    {
        $o = $r['order'];
        $addr = $o->shipping_address ?? [];
        $base = $adminBases[$o->channel_id] ?? null;

        return [
            'id' => $o->id,
            'order_no' => $o->order_no,
            'platform_order_id' => $o->platform_order_id,
            'order_date' => $o->getRawOriginal('order_date'),
            'status' => (int) $o->status,
            'status_label' => $o->status_label,
            'status_updated_at' => $o->getRawOriginal('status_updated_at'),
            'order_source' => $o->order_source,
            'payment_method' => PaymentMethod::classify($o->payments),
            'total_amount' => (float) $o->total_amount,
            'paid_amount' => (float) $o->paid_amount,
            'customer_id' => $o->customer_id,
            'customer_name' => $o->customer_name,
            'customer_email' => $o->customer_email,
            'phone' => $addr['phone'] ?? null,
            'city' => trim(($addr['district'] ?? '') . ' / ' . ($addr['city'] ?? ''), ' /') ?: null,
            'cargo_company' => $o->cargo_company,
            'cargo_tracking_no' => $o->cargo_tracking_no,
            'cargo_tracking_url' => $o->cargo_tracking_url,
            'items_count' => $o->items_count,
            'stage' => $r['stage'],
            'due_date' => $r['due_date'],
            'delay_days' => $r['delay_days'],
            'age_days' => $r['age_days'],
            'admin_url' => $base ? $base . '/Admin/SiparisDetay.aspx?SID=' . $o->platform_order_id : null,
            'shipment_check' => isset($r['shipment']) && $r['shipment'] ? $this->presentCheck($r['shipment']) : null,
            'review' => $r['review'] ? $this->presentReview($r['review']) : null,
            'items' => $items->map(fn ($i) => [
                'product_id' => $i->product_id,
                'product_name' => $i->product_name,
                'variant_info' => $i->variant_info,
                'sku' => $i->sku,
                'quantity' => (int) $i->quantity,
                'image_url' => $i->image_url,
                'status_label' => $i->status_label,
                'total_price' => (float) $i->total_price,
            ])->values(),
        ];
    }

    /**
     * Tek siparişi şimdi yeniden kontrol et: Sürat son 2 gün tazelenir, Nebim önbelleksiz sorgulanır.
     * SALT-OKUMA (Sürat/Nebim'e yazma yok).
     */
    public function shipmentCheck(Request $request, int $orderId): JsonResponse
    {
        $order = Order::findOrFail($orderId);
        $tenant = Tenant::findOrFail($this->tenantId($request));

        if (SuratShipmentFeed::enabled($tenant)) {
            $today = \Carbon\CarbonImmutable::now('Europe/Istanbul')->startOfDay();
            (new SuratShipmentFeed($tenant))->sync($today->subDay(), $today);
        }
        $check = (new DelayShipmentChecker($tenant))->check($order, true);
        $out = $this->presentCheck($check);

        OrderDelayEvent::create([
            'tenant_id' => $order->tenant_id, 'order_id' => $order->id, 'user_id' => $request->user()->id,
            'type' => 'cargo_check', 'note' => $check->verdict === 'disabled'
                ? 'Nebim yenilendi: ' . ($check->nebim_order_number ?: 'Nebim\'de kayıt yok')
                : 'Kargo kontrolü: ' . $out['verdict_label'] . ($out['summary'] ? ' — ' . $out['summary'] : ''),
        ]);

        return response()->json($out);
    }

    /** Sürat carileri (yalnız admin) — şifre dönmez. */
    public function cargoAccounts(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdmin() || $request->user()->isSuperAdmin(), 403);
        abort_unless(SuratShipmentFeed::enabled(Tenant::findOrFail($this->tenantId($request))), 403, 'Kargo kontrolü pasif.');

        return response()->json((new SuratShipmentFeed(Tenant::findOrFail($this->tenantId($request))))->describeAccounts());
    }

    /**
     * Sürat carisi kaydet (yalnız admin). Kimlik önce Sürat'ta denenir; başarılıysa şifreli saklanır,
     * ardından 50 günlük gönderi geçmişi çekilip gecikmeler yeniden kontrol edilir (kuyrukta).
     */
    public function saveCargoAccount(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdmin() || $request->user()->isSuperAdmin(), 403);
        abort_unless(SuratShipmentFeed::enabled(Tenant::findOrFail($this->tenantId($request))), 403, 'Kargo kontrolü pasif.');

        $data = $request->validate([
            'key' => ['required', Rule::in(array_keys(SuratShipmentFeed::LABELS))],
            'username' => ['required', 'string', 'max:32', 'regex:/^[0-9A-Za-z]+$/'],
            'password' => ['required', 'string', 'max:128'],
        ]);

        $count = null;
        if ($err = SuratShipmentFeed::testAccount($data['username'], $data['password'], $count)) {
            return response()->json(['message' => $err], 422);
        }

        $tenant = Tenant::findOrFail($this->tenantId($request));
        $settings = $tenant->settings ?? [];
        $accounts = collect($settings['delay_shipment_check']['surat_accounts'] ?? [])
            ->reject(fn ($a) => ($a['key'] ?? null) === $data['key'])
            ->push([
                'key' => $data['key'],
                'label' => SuratShipmentFeed::LABELS[$data['key']],
                'username' => $data['username'],
                'password_enc' => encrypt($data['password']),
                'updated_by' => $request->user()->id,
                'updated_at' => now()->toIso8601String(),
            ])->values()->all();
        $settings['delay_shipment_check']['surat_accounts'] = $accounts;
        $tenant->settings = $settings;
        $tenant->save();

        $tenantId = $tenant->id;
        dispatch(function () use ($tenantId) {
            \Illuminate\Support\Facades\Artisan::call('cargo:sync-surat-shipments', ['--tenant' => $tenantId, '--days' => 50]);
            \Illuminate\Support\Facades\Artisan::call('crm:check-delay-shipments', ['--tenant' => $tenantId]);
        });

        return response()->json([
            'accounts' => (new SuratShipmentFeed($tenant->fresh()))->describeAccounts(),
            'today_count' => $count,
        ]);
    }

    /** Satırlara kargo kontrolü sonucunu ekler ($r['shipment']). */
    protected function withChecks(Collection $rows): Collection
    {
        if ($rows->isEmpty()) {
            return $rows;
        }
        $checks = OrderShipmentCheck::whereIn('order_id', $rows->pluck('order.id'))->get()->keyBy('order_id');

        return $rows->map(function ($r) use ($checks) {
            $r['shipment'] = $checks->get($r['order']->id);

            return $r;
        });
    }

    protected function presentCheck(OrderShipmentCheck $c): array
    {
        $f = $c->findings ?? [];
        $acc = fn ($k) => SuratShipmentFeed::LABELS[$k] ?? $k;
        $matches = $f['matches'] ?? [];
        $candidates = $f['candidates'] ?? [];

        $summary = match ($c->verdict) {
            'shipped', 'wrong_account' => collect($matches)->map(fn ($m) => $acc($m['account_key']) . ' · takip ' . $m['tracking_no']
                . ' · ' . $m['shipped_at'] . ' · ' . ($m['status'] ?? '') . ($m['wrong_account'] ? ' (YANLIŞ CARİ)' : ''))->implode(' | '),
            'possible_manual' => collect($candidates)->map(fn ($m) => ($m['web_order_code'] ? 'kod ' . $m['web_order_code'] : 'kodsuz')
                . ' · ' . $m['recipient_name'] . ' · ' . trim(($m['district'] ?? '') . ' / ' . ($m['city'] ?? ''), ' /')
                . ' · takip ' . $m['tracking_no'] . ' · ' . $m['shipped_at'])->implode(' | '),
            'invoiced' => 'Nebim fatura ' . $c->nebim_invoice_number . ', Sürat\'ta gönderi bulunamadı',
            'error' => (string) ($f['error'] ?? ''),
            'disabled' => '',
            'unverified' => 'Siparişin çıkması gereken cari (' . $acc($f['expected_account'] ?? '') . ') bağlı olmadığı için doğrulanamadı',
            default => '',
        };
        if (($f['ticimax_transferred'] ?? null) === false) {
            $summary = trim($summary . ' · Ticimax siparişi Nebim\'e aktarmamış', ' ·');
        }
        if (! empty($f['missing_accounts'])) {
            $summary = trim($summary . ' · ⚠ bağlı olmayan: ' . implode(', ', array_map($acc, $f['missing_accounts'])), ' ·');
        }

        return [
            'verdict' => $c->verdict,
            'verdict_label' => DelayShipmentChecker::VERDICTS[$c->verdict] ?? $c->verdict,
            'summary' => $summary,
            'nebim_status' => $c->nebim_status,
            'nebim_order_number' => $c->nebim_order_number,
            'nebim_invoice_number' => $c->nebim_invoice_number,
            'expected_account' => $f['expected_account'] ?? null,
            'accounts_checked' => $f['accounts_checked'] ?? [],
            'missing_accounts' => $f['missing_accounts'] ?? [],
            'ticimax_transferred' => $f['ticimax_transferred'] ?? null,
            'matches' => $matches,
            'candidates' => $candidates,
            'checked_at' => $c->checked_at?->toIso8601String(),
        ];
    }

    protected function presentReview(OrderDelayReview $review): array
    {
        return [
            'state' => $review->state,
            'note' => $review->note,
            'assigned_user_id' => $review->assigned_user_id,
            'assigned_name' => $review->assignee?->name,
            'follow_up_at' => $review->follow_up_at?->format('Y-m-d'),
            'updated_at' => $review->updated_at?->toIso8601String(),
        ];
    }

    /** @return array<int, string> channel_id → Ticimax site kökü */
    protected function adminBases(array $channelIds): array
    {
        $out = [];
        foreach (Channel::whereIn('id', $channelIds)->get() as $ch) {
            if (! str_starts_with((string) $ch->type, 'ticimax')) {
                continue;
            }
            $base = preg_replace('/\/Servis\/.*$/i', '', $ch->credentials['wsdl_url'] ?? '');
            if ($base) {
                $out[$ch->id] = $base;
            }
        }

        return $out;
    }

    protected function tenantId(Request $request): int
    {
        return (int) ($request->user()->tenant_id ?: $request->header('X-Tenant-Id'));
    }

    protected function service(Request $request): OrderDelayService
    {
        return new OrderDelayService(Tenant::findOrFail($this->tenantId($request)));
    }
}
