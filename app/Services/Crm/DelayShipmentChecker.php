<?php

namespace App\Services\Crm;

use App\Models\CargoShipment;
use App\Models\Channel;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderShipmentCheck;
use App\Models\Tenant;
use App\Services\Cargo\SuratShipmentFeed;
use App\Services\Returns\NebimService;
use App\Services\TicimaxService;
use Illuminate\Support\Collection;

/**
 * Gecikmeler › Kargo kontrolü — "bu sipariş gerçekten çıkmadı mı?"
 *
 * 1) Nebim (usp_OrderDetail, SALT-OKUMA): Nebim sipariş no + fatura no.
 * 2) Sürat iki cari (cargo_shipments yerel kopyası):
 *    - kesin: gönderi kodu = TB no / Ticimax ID / Nebim sipariş no / Nebim fatura no
 *    - yanlış cari: kapıda ödemeli sipariş normal cariden (ya da tersi)
 *    - olası manuel çıkış: kodsuz/tanımsız kodlu gönderide alıcı adı + il tutuyor;
 *      aynı müşterinin başka siparişinin koduyla giden gönderi = birlikte gönderilmiş olabilir
 * 3) Hiçbiri yoksa: Nebim faturalı → "faturalı, kargo yok"; değilse "çıkış yok".
 *
 * Sonuç order_shipment_checks'e yazılır; panel buradan okur.
 */
class DelayShipmentChecker
{
    public const VERDICTS = [
        'shipped' => 'Sürat\'ta çıkış var',
        'wrong_account' => 'Yanlış cariden çıkış',
        'possible_manual' => 'Olası manuel çıkış',
        'invoiced' => 'Nebim faturalı, kargo yok',
        'not_shipped' => 'Çıkış yok',
        'unverified' => 'Kontrol eksik (cari bağlı değil)',
        'disabled' => 'Kargo kontrolü pasif',
        'error' => 'Kontrol edilemedi',
    ];

    /** Pazaryeri gönderi kodları (Trendyol 727…, HB 203-…, Amazon ***) — site siparişi olamaz. */
    private const MARKETPLACE_CODE = '/^(\d{16}|\d{3}-\d+|\d+\*\d+\*\d+)$/';

    private ?NebimService $nebim = null;

    private array $accountKeys;

    private bool $enabled;

    public function __construct(private Tenant $tenant)
    {
        $this->enabled = SuratShipmentFeed::enabled($tenant);
        $this->accountKeys = $this->enabled ? (new SuratShipmentFeed($tenant))->accountKeys() : [];
    }

    /** @param bool $forceNebim true: Nebim'i önbellekten bağımsız yeniden sorgula */
    public function check(Order $order, bool $forceNebim = false): OrderShipmentCheck
    {
        $check = OrderShipmentCheck::firstOrNew(['order_id' => $order->id]);
        $check->tenant_id = $this->tenant->id;

        $this->checkNebim($order, $check, $forceNebim);

        // Kargo kontrolü pasif: yalnız Nebim no (+ Nebim'e aktarılmadı bilgisi), Sürat'a/gönderi tablosuna bakılmaz
        if (! $this->enabled) {
            $check->verdict = 'disabled';
            $check->findings = [
                'disabled' => true,
                'ticimax_transferred' => $check->nebim_status === 'not_found' ? $this->ticimaxTransferred($order) : null,
            ];
            $check->checked_at = now();
            $check->save();

            return $check;
        }

        $expected = in_array(PaymentMethod::classify($order->payments), ['cod_cash', 'cod_card'], true) ? 'cod' : 'normal';
        $since = $order->getRawOriginal('order_date')
            ? \Carbon\CarbonImmutable::parse($order->getRawOriginal('order_date'))->subDay()
            : now()->subDays(60);

        // 1) Kesin eşleşme (sipariş kodu)
        $codes = array_filter([
            'order_no' => SuratShipmentFeed::normCode((string) $order->order_no),
            'platform_id' => strlen((string) $order->platform_order_id) >= 5 ? SuratShipmentFeed::normCode((string) $order->platform_order_id) : '',
            'nebim_order' => SuratShipmentFeed::normCode((string) $check->nebim_order_number),
            'nebim_invoice' => SuratShipmentFeed::normCode((string) $check->nebim_invoice_number),
        ]);
        $byCode = array_flip($codes);

        $exact = $codes ? CargoShipment::query()
            ->where('tenant_id', $this->tenant->id)
            ->whereIn('web_order_norm', array_values($codes))
            ->where('shipped_at', '>=', $since)
            ->orderBy('shipped_at')
            ->get() : collect();

        $matches = $exact->map(fn (CargoShipment $s) => $this->shipmentRow($s) + [
            'matched_by' => $byCode[$s->web_order_norm] ?? null,
            'wrong_account' => $s->account_key !== $expected,
        ])->values()->all();

        // 2) Ad + il eşleşmesi (kodsuz / tanımsız kodlu / aynı müşterinin başka siparişi)
        $candidates = $matches ? [] : $this->nameCandidates($order, $since, $exact->pluck('id')->all());

        $missing = array_values(array_diff(array_keys(SuratShipmentFeed::LABELS), $this->accountKeys));

        $verdict = match (true) {
            $matches && collect($matches)->contains('wrong_account', false) => 'shipped',
            (bool) $matches => 'wrong_account',
            (bool) $candidates => 'possible_manual',
            // Siparişin çıkması gereken cari bağlı değilse "çıkış yok" denemez
            in_array($expected, $missing, true) => 'unverified',
            (bool) $check->nebim_invoice_number => 'invoiced',
            default => 'not_shipped',
        };

        // Nebim'de yoksa: Ticimax siparişi Nebim'e hiç aktarmamış olabilir (EntegrasyonAktarildi=false)
        $transferred = $check->nebim_status === 'not_found' ? $this->ticimaxTransferred($order) : null;

        $check->verdict = $verdict;
        $check->findings = [
            'expected_account' => $expected,
            'accounts_checked' => $this->accountKeys,
            'missing_accounts' => $missing,
            'ticimax_transferred' => $transferred,
            'matches' => $matches,
            'candidates' => $candidates,
            'shipments_synced_at' => CargoShipment::where('tenant_id', $this->tenant->id)->max('updated_at'),
        ];
        $check->checked_at = now();
        $check->save();

        return $check;
    }

    /** Toplu: geciken siparişlerin hepsi. @return array<string,int> verdict adetleri */
    public function checkMany(Collection $orders, ?callable $progress = null): array
    {
        $counts = [];
        foreach ($orders as $o) {
            try {
                $v = $this->check($o)->verdict;
            } catch (\Throwable $e) {
                OrderShipmentCheck::updateOrCreate(['order_id' => $o->id], [
                    'tenant_id' => $this->tenant->id, 'verdict' => 'error', 'checked_at' => now(),
                    'findings' => ['error' => mb_substr($e->getMessage(), 0, 300)],
                ]);
                $v = 'error';
            }
            $counts[$v] = ($counts[$v] ?? 0) + 1;
            $progress && $progress($o, $v);
        }

        return $counts;
    }

    private function checkNebim(Order $order, OrderShipmentCheck $check, bool $force): void
    {
        // Faturalı sipariş 6 saatte bir, diğerleri her koşuda yeniden sorgulanır
        $fresh = $check->nebim_checked_at && $check->nebim_status === 'found' && $check->nebim_invoice_number
            && $check->nebim_checked_at->gt(now()->subHours(6));
        if ($fresh && ! $force) {
            return;
        }

        $barcodes = OrderItem::where('order_id', $order->id)->pluck('barcode')->filter()->all();
        $res = $this->nebim()->getOrderDetail((string) $order->platform_order_id, $barcodes);
        $check->nebim_checked_at = now();

        if (! $res['success']) {
            $check->nebim_status = 'error';

            return;
        }
        if (! $res['rows']) {
            $check->nebim_status = 'not_found';
            $check->nebim_order_number = null;
            $check->nebim_invoice_number = null;

            return;
        }

        $check->nebim_status = 'found';
        $check->nebim_order_number = (string) ($res['rows'][0]['OrderNumber'] ?? '') ?: null;
        $check->nebim_invoice_number = collect($res['rows'])->pluck('InvoiceNumber')->map(fn ($v) => trim((string) $v))->filter()->first();
    }

    private function nameCandidates(Order $order, \Carbon\CarbonImmutable $since, array $excludeIds): array
    {
        $addr = $order->shipping_address ?? [];
        $names = collect([$order->customer_name, $addr['name'] ?? null])
            ->map(fn ($n) => SuratShipmentFeed::normName((string) $n))
            ->filter(fn ($n) => str_contains($n, ' '))
            ->unique();
        if ($names->isEmpty()) {
            return [];
        }

        $city = SuratShipmentFeed::normName((string) ($addr['city'] ?? ''));
        $district = SuratShipmentFeed::normName((string) ($addr['district'] ?? ''));

        $rows = CargoShipment::query()
            ->where('tenant_id', $this->tenant->id)
            ->where('shipped_at', '>=', $since)
            ->whereNotIn('id', $excludeIds ?: [0])
            ->where(function ($q) use ($names) {
                foreach ($names as $n) {
                    $t = explode(' ', $n);
                    $q->orWhere(fn ($q) => $q->where('recipient_norm', 'like', '%' . $t[0] . '%')->where('recipient_norm', 'like', '%' . end($t) . '%'));
                }
            })
            ->limit(50)
            ->get();

        // Gönderi kodu bizdeki başka bir siparişe aitse: aynı müşterinin siparişi mi?
        $codeOwners = Order::query()
            ->where('tenant_id', $this->tenant->id)
            ->whereIn('order_no', $rows->pluck('web_order_code')->filter()->unique()->values())
            ->get(['id', 'order_no', 'customer_id', 'status_label'])
            ->keyBy(fn ($o) => SuratShipmentFeed::normCode((string) $o->order_no));

        $out = [];
        foreach ($rows as $s) {
            if (! $this->sameName($names, (string) $s->recipient_norm)) {
                continue;
            }
            if ($city !== '' && SuratShipmentFeed::normName((string) $s->city) !== $city) {
                continue;
            }
            $code = (string) $s->web_order_norm;
            $owner = $code !== '' ? $codeOwners->get($code) : null;

            if ($owner) {
                if ((int) $owner->id === (int) $order->id) {
                    continue;
                }
                // Başka müşterinin siparişi (adaş) → ilgisiz
                if ($order->customer_id && (int) $owner->customer_id !== (int) $order->customer_id) {
                    continue;
                }
                $type = 'combined';
            } elseif ($code !== '' && preg_match(self::MARKETPLACE_CODE, (string) $s->web_order_code)) {
                continue; // pazaryeri siparişi
            } else {
                $type = $code === '' ? 'no_code' : 'unknown_code';
            }

            $out[] = $this->shipmentRow($s) + [
                'type' => $type,
                'related_order_no' => $owner?->order_no,
                'related_status' => $owner?->status_label,
                'district_match' => $district !== '' && SuratShipmentFeed::normName((string) $s->district) === $district,
            ];
        }

        return $out;
    }

    /** Ad eşleşmesi: kısa adın tüm kelimeleri uzun adda var (ör. "ayse yilmaz" ⊂ "ayse nur yilmaz"). */
    private function sameName(Collection $names, string $recipient): bool
    {
        $r = array_filter(explode(' ', $recipient));
        foreach ($names as $n) {
            $t = array_filter(explode(' ', $n));
            [$short, $long] = count($t) <= count($r) ? [$t, $r] : [$r, $t];
            if (count($short) >= 2 && ! array_diff($short, $long)) {
                return true;
            }
        }

        return false;
    }

    private function shipmentRow(CargoShipment $s): array
    {
        return [
            'account_key' => $s->account_key,
            'tracking_no' => $s->tracking_no,
            'web_order_code' => $s->web_order_code,
            'recipient_name' => $s->recipient_name,
            'city' => $s->city,
            'district' => $s->district,
            'address' => $s->address,
            'shipped_at' => $s->shipped_at?->format('Y-m-d H:i'),
            'status' => $s->status,
            'delivery_status' => $s->delivery_status,
        ];
    }

    /** Ticimax EntegrasyonAktarildi (Nebim'e aktarıldı mı); okunamazsa null. */
    private function ticimaxTransferred(Order $order): ?bool
    {
        try {
            $channel = Channel::withoutGlobalScopes()->find($order->channel_id);
            if (! $channel || ! str_starts_with((string) $channel->type, 'ticimax')) {
                return null;
            }
            $res = TicimaxService::fromChannel($channel)->getOrders(['SiparisID' => (int) $order->platform_order_id], 1, 1);
            $d = $res['data']['SelectSiparisResult']['WebSiparis'] ?? [];
            $d = isset($d[0]) ? $d[0] : $d;

            return array_key_exists('EntegrasyonAktarildi', $d) ? (bool) $d['EntegrasyonAktarildi'] : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function nebim(): NebimService
    {
        if ($this->nebim) {
            return $this->nebim;
        }
        $channel = Channel::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)
            ->where('type', 'nebim-v3')->where('is_active', true)->first();
        $cfg = (array) config('returns.integrations.nebim', []);
        $tenantCfg = $this->tenant->settings['returns_integrations']['nebim'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return $this->nebim = NebimService::fromChannel($channel, $cfg);
    }
}
