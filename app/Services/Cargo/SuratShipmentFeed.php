<?php

namespace App\Services\Cargo;

use App\Models\CargoShipment;
use App\Models\Tenant;
use App\Services\Returns\SuratKargoService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use SoapClient;

/**
 * Sürat Kargo carilerinin gönderi listesi (GonderilenKargoDetayi, SALT-OKUMA) → cargo_shipments.
 *
 * Tonny'nin iki carisi var: normal (peşin) çıkışlar + kapıda ödeme çıkışları. Gecikmeler sayfası
 * "sipariş gerçekten çıkmadı mı?" sorusunu bu yerel kopya üzerinden yanıtlar (bkz. DelayShipmentChecker).
 *
 * Cari ayarı: tenant.settings.delay_shipment_check.surat_accounts = [{key, label, username, password}].
 * Ayar yoksa normal cari için iade entegrasyonundaki (returns_integrations.surat_kargo) kimlik kullanılır.
 */
class SuratShipmentFeed
{
    public const LABELS = ['normal' => 'Normal cari', 'cod' => 'Kapıda ödeme carisi'];

    public function __construct(private Tenant $tenant)
    {
    }

    /** @return array<int, array{key:string,label:string,username:string,password:string}> */
    public function accounts(): array
    {
        $settings = $this->tenant->settings ?? [];
        $out = [];
        foreach ((array) ($settings['delay_shipment_check']['surat_accounts'] ?? []) as $a) {
            $password = self::decryptPassword($a);
            if (! empty($a['key']) && ! empty($a['username']) && $password !== '') {
                $out[$a['key']] = [
                    'key' => $a['key'],
                    'label' => $a['label'] ?? (self::LABELS[$a['key']] ?? $a['key']),
                    'username' => (string) $a['username'],
                    'password' => $password,
                ];
            }
        }

        $ret = $settings['returns_integrations']['surat_kargo'] ?? [];
        if (! isset($out['normal']) && ! empty($ret['username']) && ! empty($ret['password'])) {
            $out['normal'] = ['key' => 'normal', 'label' => self::LABELS['normal'], 'username' => (string) $ret['username'], 'password' => (string) $ret['password']];
        }

        return array_values($out);
    }

    /** Şifre ayarda şifreli tutulur (password_enc); eski düz 'password' da okunur. */
    private static function decryptPassword(array $a): string
    {
        if (! empty($a['password_enc'])) {
            try {
                return (string) decrypt($a['password_enc']);
            } catch (\Throwable) {
                return '';
            }
        }

        return (string) ($a['password'] ?? '');
    }

    /**
     * Kimliği Sürat'ta dener: son 7 günün gönderi listesi. Sürat yanlış şifrede de yalnız
     * "Kayıt bulunamadı." döndürüyor (boş günle aynı) → 7 günde hiç gönderi yoksa kimlik hatalı sayılır.
     * Hata mesajı ya da null (başarılı) döner; başarılıysa gönderi sayısı $count'a yazılır.
     */
    public static function testAccount(string $username, string $password, ?int &$count = null): ?string
    {
        try {
            $client = new SoapClient(SuratKargoService::WSDL, ['exceptions' => true, 'cache_wsdl' => WSDL_CACHE_DISK, 'connection_timeout' => 20]);
            $to = now('Europe/Istanbul');
            $resp = $client->GonderilenKargoDetayi([
                'CariKodu' => $username, 'Sifre' => $password,
                'BasTar' => $to->copy()->subDays(6)->format('d.m.Y'), 'BitTar' => $to->format('d.m.Y'),
            ]);
            $data = json_decode((string) ($resp->GonderilenKargoDetayiResult ?? ''), true);
            if (! is_array($data)) {
                return 'Sürat yanıtı çözümlenemedi (kimlik hatalı olabilir).';
            }
            $count = count((array) ($data['GonderilenKargoDetayi'] ?? []));
            if ($count === 0) {
                return 'Sürat bu cari kodu + şifreyle son 7 günde hiç gönderi döndürmedi — şifre hatalı olabilir (Sürat hatalı şifrede de yalnız "Kayıt bulunamadı" diyor).';
            }

            return null;
        } catch (\Throwable $e) {
            return 'Sürat bağlantı hatası: ' . mb_substr($e->getMessage(), 0, 200);
        }
    }

    /** Panel için: cari kodları + şifre girili mi (şifre asla dönmez). */
    public function describeAccounts(): array
    {
        $byKey = collect($this->accounts())->keyBy('key');

        return collect(self::LABELS)->map(fn ($label, $key) => [
            'key' => $key,
            'label' => $label,
            'username' => $byKey[$key]['username'] ?? null,
            'connected' => isset($byKey[$key]),
        ])->values()->all();
    }

    /**
     * Sürat cari API'leriyle yapılan kargo kontrolü açık mı?
     * tenant.settings.delay_shipment_check.enabled (vars. açık). Kapalıyken Sürat'a hiç istek gitmez:
     * gönderi senkronu, yanlış cari / çıkış tespiti ve cari ayarı ekranı pasiftir. Nebim no ve
     * Sürat takip linki butonları (API değil) çalışmaya devam eder. (11 Eki 2026 kullanıcı kararı: pasif.)
     */
    public static function enabled(Tenant $tenant): bool
    {
        return (bool) ($tenant->settings['delay_shipment_check']['enabled'] ?? true);
    }

    /** Ayarlı cari anahtarları (normal, cod). */
    public function accountKeys(): array
    {
        return array_column($this->accounts(), 'key');
    }

    /**
     * Gün gün çekip upsert eder. Bir gün alınamazsa diğerleri yine işlenir.
     *
     * @return array<string, array{days:int, rows:int, errors:array<int,string>}>
     */
    public function sync(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $report = [];
        foreach ($this->accounts() as $acc) {
            $r = ['days' => 0, 'rows' => 0, 'errors' => []];
            for ($d = $from->startOfDay(); $d->lte($to); $d = $d->addDay()) {
                try {
                    $r['rows'] += $this->syncDay($acc, $d);
                    $r['days']++;
                } catch (\Throwable $e) {
                    $r['errors'][] = $d->format('Y-m-d') . ': ' . mb_substr($e->getMessage(), 0, 200);
                    Log::warning('[SuratShipmentFeed] gün alınamadı', ['account' => $acc['key'], 'day' => $d->toDateString(), 'err' => $e->getMessage()]);
                }
            }
            $report[$acc['key']] = $r;
        }

        return $report;
    }

    private function syncDay(array $acc, CarbonImmutable $day): int
    {
        $client = new SoapClient(SuratKargoService::WSDL, [
            'trace' => false, 'exceptions' => true, 'cache_wsdl' => WSDL_CACHE_DISK, 'connection_timeout' => 30,
            'stream_context' => stream_context_create(['http' => ['timeout' => 120]]),
        ]);
        $resp = $client->GonderilenKargoDetayi([
            'CariKodu' => $acc['username'], 'Sifre' => $acc['password'],
            'BasTar' => $day->format('d.m.Y'), 'BitTar' => $day->format('d.m.Y'),
        ]);
        $data = json_decode((string) ($resp->GonderilenKargoDetayiResult ?? ''), true);
        if (! is_array($data)) {
            throw new \RuntimeException('Sürat yanıtı çözümlenemedi');
        }
        if (! empty($data['IsError']) || isset($data['errorMessage'])) {
            $msg = (string) ($data['errorMessage'] ?? 'hata');
            // Kayıt olmayan gün hata gibi dönebilir
            if (stripos($msg, 'bulunamad') !== false) {
                return 0;
            }
            throw new \RuntimeException('Sürat: ' . $msg);
        }

        $now = now();
        $rows = [];
        foreach ((array) ($data['GonderilenKargoDetayi'] ?? []) as $g) {
            $tracking = trim((string) ($g['TakipNo'] ?? ''));
            if ($tracking === '') {
                continue;
            }
            $code = trim((string) ($g['WebSiparisKodu'] ?? ''));
            // Aynı takip no birden çok satırda gelebiliyor (çok koli) → son satır kalır
            $rows[$tracking] = [
                'tenant_id' => $this->tenant->id,
                'provider' => 'surat',
                'account_key' => $acc['key'],
                'account_code' => $acc['username'],
                'tracking_no' => $tracking,
                'web_order_code' => $code !== '' ? mb_substr($code, 0, 64) : null,
                'web_order_norm' => $code !== '' ? self::normCode($code) : null,
                'recipient_name' => mb_substr(trim((string) ($g['AliciUnvan'] ?? '')), 0, 255) ?: null,
                'recipient_norm' => mb_substr(self::normName((string) ($g['AliciUnvan'] ?? '')), 0, 255) ?: null,
                'address' => trim((string) ($g['AliciAdres'] ?? '')) ?: null,
                'city' => mb_substr(trim((string) ($g['VarisIl'] ?? '')), 0, 64) ?: null,
                'district' => mb_substr(trim((string) ($g['VarisIlce'] ?? '')), 0, 64) ?: null,
                'payment_type' => mb_substr((string) ($g['OdemeSekli'] ?? ''), 0, 16) ?: null,
                'status' => mb_substr((string) ($g['Durum'] ?? ''), 0, 64) ?: null,
                'delivery_status' => mb_substr((string) ($g['TeslimatDurum'] ?? ''), 0, 64) ?: null,
                'amount' => is_numeric($g['Tutar'] ?? null) ? (float) $g['Tutar'] : null,
                'shipped_at' => ! empty($g['OlusturulmaTarihi']) ? $g['OlusturulmaTarihi'] . ':00' : $day->format('Y-m-d 00:00:00'),
                'raw' => json_encode($g, JSON_UNESCAPED_UNICODE),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        foreach (array_chunk(array_values($rows), 500) as $chunk) {
            CargoShipment::upsert($chunk, ['tenant_id', 'account_code', 'tracking_no'], [
                'web_order_code', 'web_order_norm', 'recipient_name', 'recipient_norm', 'address', 'city', 'district',
                'payment_type', 'status', 'delivery_status', 'amount', 'shipped_at', 'raw', 'updated_at',
            ]);
        }

        return count($rows);
    }

    /** Sipariş/belge kodu karşılaştırması: büyük harf, yalnız harf-rakam. */
    public static function normCode(string $code): string
    {
        return preg_replace('/[^A-Z0-9]/', '', strtoupper(self::ascii($code)));
    }

    /** Ad karşılaştırması: Türkçe küçük harf → ASCII, yalnız harf + tek boşluk. */
    public static function normName(string $name): string
    {
        $s = self::ascii(mb_strtolower(strtr($name, ['I' => 'ı', 'İ' => 'i']), 'UTF-8'));

        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z ]/', ' ', $s)));
    }

    private static function ascii(string $s): string
    {
        return strtr($s, [
            'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'â' => 'a', 'î' => 'i', 'û' => 'u',
            'Ç' => 'C', 'Ğ' => 'G', 'İ' => 'I', 'Ö' => 'O', 'Ş' => 'S', 'Ü' => 'U', 'Â' => 'A',
        ]);
    }
}
