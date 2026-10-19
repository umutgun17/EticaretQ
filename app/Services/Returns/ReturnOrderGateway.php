<?php

namespace App\Services\Returns;

use App\Models\Channel;
use App\Models\Tenant;
use App\Services\IkasService;
use App\Services\TicimaxService;

/**
 * İade akışının e-ticaret platformu soyutlaması: tenant'ın aktif kanalına göre
 * Ticimax (Tonny Black) veya ikas (Boise Atelier) üzerinden CANLI sipariş lookup'ı
 * + platforma özel normalizer. PublicReturnController platformdan bağımsız
 * getOrderByNo/verifyContact/normalize çağırır — normalize çıktısı iki platformda
 * da aynı sözleşmedir (RefundCalculator + eligibility + müşteri özeti).
 */
class ReturnOrderGateway
{
    private function __construct(
        private readonly string $platform,
        private readonly TicimaxService|IkasService $service,
        private readonly TicimaxOrderNormalizer|IkasOrderNormalizer $normalizer,
        private readonly ?int $tenantId = null,
    ) {}

    /** Tenant'ın kullanılabilir sipariş kaynağı — yoksa null (public uçlar 503 döner). */
    public static function forTenant(Tenant $tenant): ?self
    {
        // Ticimax: platform filtresi şart — tenant'ta başka e-ticaret kanalı varsa ->first() kapmasın.
        $ticimax = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'like', 'ticimax%')
            ->where('type', 'like', '%-ecommerce')
            ->where('is_active', true)
            ->first();
        if ($ticimax) {
            $svc = TicimaxService::fromChannel($ticimax);

            return $svc->isAvailable() ? new self('ticimax', $svc, new TicimaxOrderNormalizer, $tenant->id) : null;
        }

        $ikas = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', 'ikas-ecommerce')
            ->where('is_active', true)
            ->first();
        if ($ikas) {
            $svc = IkasService::fromChannel($ikas);

            return $svc->isAvailable() ? new self('ikas', $svc, new IkasOrderNormalizer($svc)) : null;
        }

        return null;
    }

    public function platform(): string
    {
        return $this->platform;
    }

    /** @return array{success:bool, order?:array, error?:string} */
    public function getOrderByNo(string $orderNo): array
    {
        return $this->service->getOrderByNo($orderNo);
    }

    public function verifyContact(array $rawOrder, ?string $email, ?string $phone): bool
    {
        return $this->normalizer->verifyContact($rawOrder, $email, $phone);
    }

    public function normalize(array $rawOrder): array
    {
        $order = $this->normalizer->normalize($rawOrder);
        if ($this->service instanceof TicimaxService) {
            $order['tiers'] = self::resolveTiers($this->service, $order['campaigns'] ?? [], $this->tenantId);
            if ($order['tiers'] && ! empty($order['order_date'])) {
                $order['tiers'] = self::applyEnforcement($this->service, $order['tiers'], (string) $order['order_date'], $this->tenantId);
            }
        }

        return $order;
    }

    /**
     * Siparişteki sepet tutarı kademeleri (Ticimax tanımından: tip 1 sepet kampanyası, yüzde,
     * minimum alışveriş tutarı > 0). RefundCalculator iade sonrası kalan sepet eşiğin altına
     * düşerse bu kademenin indirimini geri alır. Tanım okunamazsa o kademe atlanır (geri alım
     * yapılmaz — müşteri lehine, güvenli taraf).
     *
     * @return list<array{id:int, name:string, pct:float, min:float}>
     */
    public static function resolveTiers(TicimaxService $svc, array $campaigns, ?int $tenantId = null): array
    {
        // Siparişin kampanyaları + tenant'ın son 60 günde görülen diğer sepet kampanyaları
        // (tekil kademe düzeninde siparişte yalnız en yüksek kademe görünür; iade sonrası inilecek
        // alt kademe listede olmaz).
        $ids = [];
        foreach ($campaigns as $c) {
            if ((int) ($c['type'] ?? 0) === 1) {
                $ids[(int) $c['id']] = $c['name'] ?? '';
            }
        }
        foreach ($tenantId ? self::knownCartCampaignIds($tenantId) : [] as $id) {
            $ids[$id] ??= '';
        }
        $tiers = [];
        foreach ($ids as $id => $name) {
            $def = $svc->getCampaign($id);
            if ($def && $def['type'] === 1 && $def['op'] === 1 && $def['value'] > 0 && $def['value'] < 100 && $def['min'] > 0) {
                $name = $name ?: $def['name'];
                // Addaki yüzde (tekil düzen dönemi oranı; "ek %10" → 10). Tanım değeriyle farklı olabilir.
                $namePct = preg_match('/%\s*(\d+(?:[.,]\d+)?)/u', $name, $m) ? (float) str_replace(',', '.', $m[1]) : null;
                $tiers[] = ['id' => $def['id'], 'name' => $name, 'pct' => $def['value'], 'name_pct' => $namePct, 'min' => $def['min']];
            }
        }
        usort($tiers, fn ($a, $b) => $a['min'] <=> $b['min']);

        return $tiers;
    }

    /**
     * Kademe eşiği sipariş saatinde GERÇEKTEN işliyor muydu? Tonny'de bazı dönemlerde (ör. 5 Eki)
     * "2.500 TL üzeri %5" eşiğin altındaki sepetlere de uygulanmış → o dönemde eşik yok sayılmalı,
     * iade sonrası geri alınmamalı. Sipariş saatinin ±90 dk çevresinden ≤100 sipariş örneklenir
     * (1+1'siz); kademe almış ama kampanya öncesi tutarı eşiğin altında kalan sipariş varsa o
     * kademe işlemiyor sayılır → min = 0 (geri alınmaz, alt kademe olarak her zaman geçerli).
     * Sonuç saat bazında 30 gün önbellekte (geçmiş değişmez). Örnek alınamazsa tanım geçerli.
     */
    public static function applyEnforcement(TicimaxService $svc, array $tiers, string $orderDate, ?int $tenantId): array
    {
        try {
            $at = \Carbon\Carbon::parse($orderDate);
        } catch (\Throwable) {
            return $tiers;
        }
        $key = 'returns:tier-enforcement:' . ($tenantId ?? 0) . ':' . $at->format('YmdH');
        $unenforced = \Illuminate\Support\Facades\Cache::get($key);
        if ($unenforced === null) {
            $unenforced = [];
            $mins = [];
            foreach ($tiers as $t) {
                $mins[(int) $t['id']] = (float) $t['min'];
            }
            $ok = false;
            for ($page = 1; $page <= 2; $page++) {
                $res = $svc->getOrders([
                    'SiparisTarihiBas' => $at->copy()->subMinutes(90)->format('Y-m-d\TH:i:s'),
                    'SiparisTarihiSon' => $at->copy()->addMinutes(90)->format('Y-m-d\TH:i:s'),
                ], $page, 50, true, 'DESC');
                $orders = $res['data']['SelectSiparisResult']['WebSiparis'] ?? [];
                if (isset($orders['ID'])) {
                    $orders = [$orders];
                }
                if (! $orders) {
                    break;
                }
                $ok = true;
                foreach ($orders as $o) {
                    $camps = $o['Kampanyalar']['WebSiparisKampanya'] ?? [];
                    if (isset($camps['KampanyaID'])) {
                        $camps = [$camps];
                    }
                    $ids = array_map('intval', array_column((array) $camps, 'KampanyaID'));
                    if (array_diff($ids, array_keys($mins))) {
                        continue; // başka kampanya (1+1 vb.) tabanı bozar
                    }
                    $items = $o['Urunler']['WebSiparisUrun'] ?? [];
                    if (isset($items['UrunID'])) {
                        $items = [$items];
                    }
                    $sale = 0.0;
                    foreach ((array) $items as $it) {
                        $s = (float) ($it['SatisAniIndirimliFiyat'] ?? 0) + (float) ($it['SatisAniIndirimliFiyatKdv'] ?? 0);
                        $l = (float) ($it['SatisAniSatisFiyat'] ?? 0) + (float) ($it['SatisAniSatisFiyatKdv'] ?? 0);
                        $sale += ($s > 0 ? $s : $l) * (int) ($it['Adet'] ?? 1);
                    }
                    foreach ($ids as $id) {
                        if ($sale > 0 && $sale + 0.01 < $mins[$id]) {
                            $unenforced[$id] = true;
                        }
                    }
                }
                if (count($orders) < 50) {
                    break;
                }
            }
            $unenforced = array_keys($unenforced);
            if ($ok) {
                \Illuminate\Support\Facades\Cache::put($key, $unenforced, now()->addDays(30));
            }
        }

        return array_map(function ($t) use ($unenforced) {
            if (in_array((int) $t['id'], $unenforced, true)) {
                $t['min_defined'] = $t['min'];
                $t['min'] = 0.0;
                $t['unenforced'] = true;
            }

            return $t;
        }, $tiers);
    }

    /** CRM sipariş senkronunun yazdığı kampanya listesinden tenant'ın sepet kampanyası (tip 1) ID'leri — 1 sa önbellek. */
    private static function knownCartCampaignIds(int $tenantId): array
    {
        return \Illuminate\Support\Facades\Cache::remember("returns:cart-campaign-ids:{$tenantId}", 3600, function () use ($tenantId) {
            try {
                $rows = \Illuminate\Support\Facades\DB::select(
                    "select distinct (c->>'id')::int as id from orders, jsonb_array_elements(coalesce(metadata->'discounts'->'campaigns','[]'::jsonb)) c
                     where tenant_id = ? and order_date > now() - interval '60 days' and c->>'type' = '1'",
                    [$tenantId]
                );

                return array_map(fn ($r) => (int) $r->id, $rows);
            } catch (\Throwable) {
                return [];
            }
        });
    }
}
