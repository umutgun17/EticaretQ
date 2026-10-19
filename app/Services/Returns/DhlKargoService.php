<?php

namespace App\Services\Returns;

use App\Contracts\CargoProviderInterface;
use App\Models\Channel;
use App\Models\ReturnRequest;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * DHL Kargo (eski MNG Kargo — Mayıs 2025'te "DHL eCommerce" oldu) — iade gönderisi.
 *
 * REST API (MNG "apizone", IBM API Connect): prod https://api.mngkargo.com.tr/mngapi/api,
 * test https://testapi.mngkargo.com.tr/mngapi/api. Tüm isteklerde X-IBM-Client-Id/Secret
 * header'ları; Identity dışındakilerde ek olarak JWT Bearer (POST /token
 * {customerNumber, password, identityType:1} → {jwt}, 8 saat geçerli — 7 saat cache).
 *
 * İADE modeli Sürat'la aynı mantık: POST /standardcmdapi/createReturnOrder —
 * `shipper` bloğu paketi getiren MÜŞTERİ'dir (varış = sözleşmeli cari hesabın kayıtlı
 * iade adresi), `referenceId` = bizim iade kodumuz (public_code) → müşteri bu kodla
 * pakedi şubeye götürür; yanıttaki returnOrderLabelURL müşteriye verilebilecek etikettir.
 * paymentType=2 (Alıcı Ödemeli → merchant öder, müşteri ücretsiz gönderir).
 *
 * Şema kaynağı: apizone Standard Command/Query + CBS Info API'leri (portal login'li olduğundan
 * alan adları açık kaynak MNG istemcilerinden doğrulandı; tcgunel/omniship-mng REST sürücüsü
 * birebir aynı payload'ı kullanıyor). İLK CANLI ÇAĞRIDA teyit edilecek varsayımlar:
 * createReturnOrder yanıt alanları (orderInvoiceId/returnOrderLabelURL) + paymentType=2'nin
 * iade siparişinde kabulü. ⛔ dry_run=true iken HTTP çağrısı YAPILMAZ; payload loglanır.
 */
class DhlKargoService implements CargoProviderInterface
{
    public const BASE_PROD = 'https://api.mngkargo.com.tr/mngapi/api';

    public const BASE_TEST = 'https://testapi.mngkargo.com.tr/mngapi/api';

    private array $creds = [];

    private array $cfg = [];

    public static function fromChannel(?Channel $channel, array $cfg = []): self
    {
        $s = new self();
        $s->creds = $channel?->credentials ?? [];
        $s->cfg = $cfg ?: (array) config('returns.integrations.dhl_kargo', []);

        return $s;
    }

    public function providerKey(): string
    {
        return 'dhl-kargo';
    }

    public function displayName(): string
    {
        return 'DHL Kargo';
    }

    public function isDryRun(): bool
    {
        return (bool) ($this->cfg['dry_run'] ?? true);
    }

    public function isEnabled(): bool
    {
        return (bool) ($this->cfg['enabled'] ?? false);
    }

    public function expireDays(): int
    {
        return max(1, (int) ($this->cfg['expire_days'] ?? 14));
    }

    /** Kimlik: tenant ayarı (returns_integrations.dhl_kargo.*) > kanal credentials (dhl_* önekli). */
    private function clientId(): string
    {
        return trim((string) ($this->cfg['client_id'] ?? $this->creds['dhl_client_id'] ?? ''));
    }

    private function clientSecret(): string
    {
        return trim((string) ($this->cfg['client_secret'] ?? $this->creds['dhl_client_secret'] ?? ''));
    }

    private function customerNumber(): string
    {
        return trim((string) ($this->cfg['customer_number'] ?? $this->creds['dhl_customer_number'] ?? ''));
    }

    private function apiPassword(): string
    {
        return (string) ($this->cfg['password'] ?? $this->creds['dhl_password'] ?? '');
    }

    public function isConfigured(): bool
    {
        return $this->clientId() !== '' && $this->clientSecret() !== ''
            && $this->customerNumber() !== '' && $this->apiPassword() !== '';
    }

    private function baseUrl(): string
    {
        if (! empty($this->cfg['test_mode'])) {
            return self::BASE_TEST;
        }

        return rtrim((string) ($this->cfg['api_base'] ?? self::BASE_PROD), '/');
    }

    // ───────────────────────── HTTP katmanı ─────────────────────────

    private function http(bool $withJwt = true): PendingRequest
    {
        $req = Http::timeout(30)->withHeaders([
            'X-IBM-Client-Id' => $this->clientId(),
            'X-IBM-Client-Secret' => $this->clientSecret(),
            'Accept' => 'application/json',
        ]);

        if ($withJwt) {
            $req = $req->withToken($this->jwt());
        }

        return $req;
    }

    /** JWT 8 saat geçerli → 7 saat cache (ortam+kimlik kapsamlı anahtar). 401'de düşürülüp yenilenir. */
    private function jwt(): string
    {
        $key = 'returns:dhl:jwt:' . sha1($this->baseUrl() . '|' . $this->clientId() . '|' . $this->customerNumber());

        return Cache::remember($key, now()->addHours(7), function () {
            $resp = Http::timeout(30)->withHeaders([
                'X-IBM-Client-Id' => $this->clientId(),
                'X-IBM-Client-Secret' => $this->clientSecret(),
                'Accept' => 'application/json',
            ])->post($this->baseUrl() . '/token', [
                'customerNumber' => $this->customerNumber(),
                'password' => $this->apiPassword(),
                'identityType' => (int) ($this->cfg['identity_type'] ?? 1),
            ]);

            $jwt = (string) ($resp->json('jwt') ?? '');
            if (! $resp->successful() || $jwt === '') {
                throw new \RuntimeException('DHL/MNG token alınamadı (HTTP ' . $resp->status() . '): ' . mb_substr($resp->body(), 0, 200));
            }

            return $jwt;
        });
    }

    /**
     * MNG tek-nesne yanıtları swagger'ın aksine bazen tek elemanlı dizi ([{...}]) döner — normalize et.
     */
    private static function unwrap(mixed $body): ?array
    {
        if (! is_array($body) || $body === []) {
            return is_array($body) ? $body : null;
        }
        if (array_is_list($body)) {
            return is_array($body[0] ?? null) ? $body[0] : null;
        }

        return $body;
    }

    /** MNG hata gövdesi: {error:{code,message,description}} veya ProblemDetails {title,detail}. */
    private static function errorMessage(mixed $body, int $status): string
    {
        $b = is_array($body) ? $body : [];
        foreach ([$b['error']['description'] ?? null, $b['error']['message'] ?? null, $b['detail'] ?? null, $b['title'] ?? null] as $cand) {
            if (is_string($cand) && trim($cand) !== '') {
                return trim($cand);
            }
        }

        return 'HTTP ' . $status;
    }

    // ───────────────────────── iade gönderisi ─────────────────────────

    /**
     * @return array{success:bool, dry_run:bool, provider:string, tracking_code:?string, label_url:?string, error:?string, payload:array}
     */
    public function createReturnShipment(ReturnRequest $r): array
    {
        // Müşteriye verilecek iade kodu = referenceId (Sürat'taki OzelKargoTakipNo muadili).
        // KUSUR onayında 'ony' eki (Sürat'la aynı kural, 2026-07-24; 27.07 revize: tiresiz).
        $code = $r->public_code . ($r->type === \App\Enums\ReturnType::Defect ? 'ony' : '');
        [$payload, $missing] = $this->buildReturnOrder($r, $code);

        if (! $this->isEnabled()) {
            return $this->fail('DHL Kargo entegrasyonu kapalı (Ayarlar → İade Entegrasyonları → enabled).', $payload);
        }

        if ($this->isDryRun()) {
            Log::channel(config('returns.log_channel', 'stack'))->info('[DhlKargo][DRY-RUN] iade gönderisi (gönderilmedi)', [
                'return_id' => $r->id, 'public_code' => $code, 'payload' => $payload, 'eksik_alan' => $missing,
            ]);

            return $this->ok('DRYRUN-' . $code, true, $payload);
        }

        if (! $this->isConfigured()) {
            return $this->fail('DHL Kargo kimliği eksik (Ayarlar → İade Entegrasyonları: client id/secret + müşteri no/şifre).', $payload);
        }
        if ($missing) {
            return $this->fail('İade adresi eksik (zorunlu): ' . implode(', ', $missing), $payload);
        }

        // İl/ilçe MNG CBS kodlarına canlı modda çözülür (dry-run'da atlanır — HTTP yok).
        try {
            [$payload, $codeErr] = $this->fillCityCodes($r, $payload);
        } catch (\Throwable $e) {
            return $this->fail('DHL Kargo il/ilçe kodu çözülemedi: ' . $e->getMessage(), $payload);
        }
        if ($codeErr) {
            return $this->fail($codeErr, $payload);
        }

        try {
            $resp = $this->http()->post($this->baseUrl() . '/standardcmdapi/createReturnOrder', $payload);
            $body = self::unwrap($resp->json());

            if (! $resp->successful()) {
                $msg = self::errorMessage($body, $resp->status());
                Log::warning('[DhlKargo] iade gönderisi reddedildi', ['return_id' => $r->id, 'status' => $resp->status(), 'body' => mb_substr($resp->body(), 0, 500)]);

                return $this->fail('DHL Kargo: ' . $msg, $payload);
            }

            Log::channel(config('returns.log_channel', 'stack'))->info('[DhlKargo] iade gönderisi oluşturuldu', [
                'return_id' => $r->id, 'reference_id' => $code,
                'order_invoice_id' => $body['orderInvoiceId'] ?? null,
            ]);

            $label = trim((string) ($body['returnOrderLabelURL'] ?? ''));

            return $this->ok($code, false, $payload, $label !== '' ? $label : null);
        } catch (\Throwable $e) {
            Log::error('[DhlKargo] iade gönderisi hatası', ['return_id' => $r->id, 'err' => $e->getMessage()]);

            return $this->fail('DHL Kargo bağlantı hatası: ' . $e->getMessage(), $payload);
        }
    }

    /**
     * createReturnOrder payload'ı + eksik zorunlu alan listesi. `shipper` = MÜŞTERİ
     * (paketi getiren kişi; adres submit anında metadata.customer_address'e yazılır).
     * cityCode/districtCode canlı gönderim öncesi fillCityCodes ile doldurulur.
     *
     * @return array{0:array, 1:array<int,string>}
     */
    private function buildReturnOrder(ReturnRequest $r, string $code): array
    {
        $addr = (array) (($r->metadata ?? [])['customer_address'] ?? []);

        $adres = trim((string) ($addr['address'] ?? ''));
        $mahalle = trim((string) ($addr['neighborhood'] ?? ''));
        if ($mahalle !== '' && ! str_contains(mb_strtolower($adres), mb_strtolower($mahalle))) {
            $adres = trim($mahalle . ' ' . $adres);
        }

        $missing = [];
        foreach ([
            ['Müşteri adı', $r->customer_name],
            ['Müşteri adresi', $adres],
            ['İl', $addr['city'] ?? ''],
            ['İlçe', $addr['district'] ?? ''],
        ] as [$label, $val]) {
            if (trim((string) $val) === '') {
                $missing[] = $label;
            }
        }

        // MNG telefon formatı: yalnız rakam, başında 90/0 olmadan 10 hane.
        $phone = preg_replace('/\D+/', '', (string) ($r->customer_phone ?? ''));
        if (str_starts_with($phone, '90') && strlen($phone) === 12) {
            $phone = substr($phone, 2);
        }
        if (str_starts_with($phone, '0') && strlen($phone) === 11) {
            $phone = substr($phone, 1);
        }

        $desi = max(1, (int) round((float) ($this->cfg['desi'] ?? 1)));
        $kg = max(1, (int) round((float) ($this->cfg['kg'] ?? $this->cfg['desi'] ?? 1)));
        $content = 'Iade - ' . (string) ($r->order_no ?? $r->public_code);

        $payload = [
            'order' => [
                'referenceId' => $code,          // müşteriye verilen iade kodu (şubede bu söylenir)
                'barcode' => $code,
                'billOfLandingId' => '',
                'isCOD' => 0,
                'codAmount' => 0,
                'shipmentServiceType' => (int) ($this->cfg['shipment_service_type'] ?? 1), // 1 = Standart
                'packagingType' => (int) ($this->cfg['packaging_type'] ?? 3),              // 1 Dosya, 2 Mini, 3 Paket, 4 Koli
                'content' => $content,
                'smsPreference1' => 0,           // MNG'nin kendi SMS'leri kapalı — bildirimler bizim NetGSM akışımızdan
                'smsPreference2' => 0,
                'smsPreference3' => 0,
                'paymentType' => (int) ($this->cfg['payment_type'] ?? 2),                  // 2 = Alıcı Ödemeli (merchant öder)
                'deliveryType' => (int) ($this->cfg['delivery_type'] ?? 1),                // 1 = Adrese Teslim (cari iade adresi)
                'description' => $content,
                'marketPlaceShortCode' => '',
                'marketPlaceSaleCode' => '',
            ],
            'orderPieceList' => [[
                'barcode' => $code . '_PARCA1',
                'desi' => $desi,
                'kg' => $kg,
                'content' => '',
            ]],
            'shipper' => [
                'refCustomerId' => '',
                'cityCode' => 0,                 // fillCityCodes canlı gönderim öncesi doldurur
                'cityName' => (string) ($addr['city'] ?? ''),
                'districtCode' => 0,
                'districtName' => (string) ($addr['district'] ?? ''),
                'address' => $adres,
                'bussinessPhoneNumber' => '',
                'email' => (string) ($r->customer_email ?? ''),
                'taxOffice' => '',
                'taxNumber' => '',
                'fullName' => (string) ($r->customer_name ?? ''),
                'homePhoneNumber' => '',
                'mobilePhoneNumber' => $phone,
            ],
        ];

        return [$payload, $missing];
    }

    /**
     * Müşterinin il/ilçe adını MNG CBS kodlarına çevirir (getcities / getdistricts/{cityCode}).
     * Listeler 24 saat cache'lenir; eşleşme Türkçe katlamalı (İ/ı, ş, ğ...) yapılır.
     *
     * @return array{0:array, 1:?string} [payload, hata]
     */
    private function fillCityCodes(ReturnRequest $r, array $payload): array
    {
        $cityName = (string) $payload['shipper']['cityName'];
        $districtName = (string) $payload['shipper']['districtName'];

        $cities = Cache::remember('returns:dhl:cities', now()->addDay(), function () {
            $resp = $this->http(withJwt: false)->get($this->baseUrl() . '/cbsinfoapi/getcities');
            if (! $resp->successful()) {
                throw new \RuntimeException('getcities HTTP ' . $resp->status());
            }

            return (array) $resp->json();
        });

        $city = $this->matchByName($cities, $cityName, ['code'], ['name']);
        if (! $city) {
            return [$payload, "DHL Kargo il eşleşmedi: '{$cityName}'"];
        }
        $cityCode = (int) $city;

        $districts = Cache::remember('returns:dhl:districts:' . $cityCode, now()->addDay(), function () use ($cityCode) {
            // MNG il kodları 1-81; path iki haneli ister ("01".."81").
            $padded = str_pad((string) $cityCode, 2, '0', STR_PAD_LEFT);
            $resp = $this->http(withJwt: false)->get($this->baseUrl() . '/cbsinfoapi/getdistricts/' . $padded);
            if (! $resp->successful()) {
                throw new \RuntimeException('getdistricts HTTP ' . $resp->status());
            }

            return (array) $resp->json();
        });

        $district = $this->matchByName($districts, $districtName, ['code', 'districtCode'], ['name', 'districtName']);
        if (! $district) {
            return [$payload, "DHL Kargo ilçe eşleşmedi: '{$districtName}' ({$cityName})"];
        }

        $payload['shipper']['cityCode'] = $cityCode;
        $payload['shipper']['districtCode'] = (int) $district;

        return [$payload, null];
    }

    /** Ad listesinde Türkçe-katlamalı eşleşme → kod (bulunamazsa null). */
    private function matchByName(array $list, string $needle, array $codeKeys, array $nameKeys): int|string|null
    {
        $target = self::trFold($needle);
        if ($target === '') {
            return null;
        }

        foreach ($list as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $name = '';
            foreach ($nameKeys as $nk) {
                if (isset($entry[$nk]) && trim((string) $entry[$nk]) !== '') {
                    $name = (string) $entry[$nk];
                    break;
                }
            }
            if ($name === '' || self::trFold($name) !== $target) {
                continue;
            }
            foreach ($codeKeys as $ck) {
                if (isset($entry[$ck]) && (string) $entry[$ck] !== '') {
                    return $entry[$ck];
                }
            }
        }

        return null;
    }

    /** Türkçe harf katlaması: 'İSTANBUL' / 'istanbul' / 'Istanbul' aynı anahtara düşer. */
    private static function trFold(string $s): string
    {
        $s = trim($s);
        $s = str_replace(['İ', 'I', 'ı', 'Ş', 'ş', 'Ğ', 'ğ', 'Ü', 'ü', 'Ö', 'ö', 'Ç', 'ç', 'Â', 'â'], ['i', 'i', 'i', 's', 's', 'g', 'g', 'u', 'u', 'o', 'o', 'c', 'c', 'a', 'a'], $s);

        return mb_strtolower($s, 'UTF-8');
    }

    // ───────────────────────── takip ─────────────────────────

    /**
     * GET /standardqueryapi/getshipmentstatus/{referenceId} → shipmentStatusCode:
     * 1 Gönderi_Hazırlandı (evrak var, şube kabulü YOK — ilerletme yapılmaz), 2 Transfer,
     * 3 Teslimat_Birimine_Ulaştı, 4 Alıcı_Adresine_Yönlendirildi, 5 Teslim_Edildi,
     * 6 Teslim_Edilemedi, 7 Geri_Geliyor, 8 Destek_Gerekiyor. 404 = kayıt görünmüyor
     * (şube kabulü öncesi normal).
     *
     * @return array{success:bool, dry_run:bool, status:?string, in_transit:bool, delivered:bool, error:?string}
     */
    public function queryShipment(string $code): array
    {
        $none = fn (bool $ok, ?string $err = null): array => [
            'success' => $ok, 'dry_run' => $this->isDryRun(), 'status' => null,
            'in_transit' => false, 'delivered' => false, 'error' => $err,
        ];

        if (! $this->isEnabled()) {
            return $none(false, 'DHL Kargo entegrasyonu kapalı.');
        }
        if ($this->isDryRun()) {
            return $none(true); // dry-run: otomatik ilerletme yok.
        }
        if (! $this->isConfigured()) {
            return $none(false, 'DHL Kargo kimliği eksik.');
        }

        try {
            $resp = $this->http()->get($this->baseUrl() . '/standardqueryapi/getshipmentstatus/' . rawurlencode($code));

            if ($resp->status() === 404) {
                return $none(false, 'DHL kaydı bulunamadı (şube kabulü bekleniyor olabilir).');
            }
            if (! $resp->successful()) {
                return $none(false, 'DHL takip: ' . self::errorMessage(self::unwrap($resp->json()), $resp->status()));
            }

            $g = self::unwrap($resp->json());
            if (! is_array($g) || $g === []) {
                return $none(false, 'DHL takip yanıtı boş (şube kabulü bekleniyor olabilir).');
            }

            $statusCode = (int) ($g['shipmentStatusCode'] ?? 0);
            $statusText = trim(str_replace('_', ' ', (string) ($g['shipmentStatus'] ?? '')));
            $deliveryTo = trim((string) ($g['deliveryTo'] ?? ''));

            $delivered = $statusCode === 5 || (int) ($g['isDelivered'] ?? 0) === 1;
            // 2-4: yolda; 6/7/8 (teslim edilemedi/geri geliyor/destek) da hareket görmüş sayılır —
            // expire cron'u bunlara dokunmaz, takip cron'u InTransit'te bekletir. 1 = yalnız evrak.
            $inTransit = ! $delivered && in_array($statusCode, [2, 3, 4, 6, 7, 8], true);

            $status = $statusText !== '' ? $statusText : ($statusCode > 0 ? 'Durum ' . $statusCode : null);
            if ($delivered && $deliveryTo !== '') {
                $status = trim(($status ?? 'Teslim Edildi') . ' — Teslim Alan: ' . $deliveryTo);
            }

            return [
                'success' => true, 'dry_run' => false,
                'status' => $status,
                'in_transit' => $inTransit, 'delivered' => $delivered, 'error' => null,
                // Teslim kanıtı (Sürat ile aynı sözleşme) — metadata.delivery'ye yazılır.
                'delivered_at' => trim((string) ($g['deliveryDate'] ?? $g['deliveryTime'] ?? '')) ?: null,
                'received_by' => $deliveryTo !== '' ? $deliveryTo : null,
            ];
        } catch (\Throwable $e) {
            Log::warning('[DhlKargo] takip hatası', ['code' => $code, 'err' => $e->getMessage()]);

            return $none(false, 'DHL takip hatası: ' . $e->getMessage());
        }
    }

    // ───────────────────────── iptal / süre dolumu ─────────────────────────

    /**
     * PUT /standardcmdapi/cancelorder/{referenceId} (gövdesiz) — kargoya verilmemiş iade
     * siparişini iptal eder. İdempotent: kayıt yoksa (404 / "bulunamadı") başarı sayılır.
     *
     * @return array{success:bool, dry_run:bool, result:?string, error:?string}
     */
    public function cancelShipment(string $code): array
    {
        $base = fn (bool $ok, ?string $result = null, ?string $err = null, bool $dryRun = false): array => [
            'success' => $ok, 'dry_run' => $dryRun, 'result' => $result, 'error' => $err,
        ];

        if (! $this->isEnabled()) {
            return $base(false, null, 'DHL Kargo entegrasyonu kapalı.');
        }
        if ($this->isDryRun()) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info('[DhlKargo][DRY-RUN] cancelorder çağrılmadı', ['reference_id' => $code]);

            return $base(true, 'DRY-RUN', null, true);
        }
        if (! $this->isConfigured()) {
            return $base(false, null, 'DHL Kargo kimliği eksik.');
        }

        try {
            $resp = $this->http()->put($this->baseUrl() . '/standardcmdapi/cancelorder/' . rawurlencode($code));

            if ($resp->successful()) {
                return $base(true, trim(mb_substr((string) $resp->body(), 0, 200)) ?: 'OK');
            }

            $msg = self::errorMessage(self::unwrap($resp->json()), $resp->status());
            $hay = mb_strtolower($msg);
            // Kayıt zaten yok → idempotent başarı (kod zaten kullanılamaz durumda).
            if ($resp->status() === 404 || str_contains($hay, 'bulunamad') || str_contains($hay, 'not found')) {
                return $base(true, $msg);
            }

            Log::warning('[DhlKargo] cancelorder reddedildi', ['kod' => $code, 'status' => $resp->status(), 'msg' => $msg]);

            return $base(false, $msg, 'DHL Kargo: ' . $msg);
        } catch (\Throwable $e) {
            Log::warning('[DhlKargo] cancelorder hatası', ['kod' => $code, 'err' => $e->getMessage()]);

            return $base(false, null, 'DHL bağlantı hatası: ' . $e->getMessage());
        }
    }

    private function ok(string $trackingCode, bool $dryRun, array $payload, ?string $labelUrl = null): array
    {
        return [
            'success' => true, 'dry_run' => $dryRun, 'provider' => $this->providerKey(),
            'tracking_code' => $trackingCode, 'label_url' => $labelUrl, 'error' => null, 'payload' => $payload,
        ];
    }

    private function fail(string $msg, array $payload): array
    {
        return [
            'success' => false, 'dry_run' => $this->isDryRun(), 'provider' => $this->providerKey(),
            'tracking_code' => null, 'label_url' => null, 'error' => $msg, 'payload' => $payload,
        ];
    }
}
