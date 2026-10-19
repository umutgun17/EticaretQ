<?php

namespace App\Services\Returns;

use App\Contracts\CargoProviderInterface;
use App\Models\Channel;
use App\Models\ReturnRequest;
use Illuminate\Support\Facades\Log;
use SoapClient;
use SoapFault;

/**
 * Sürat Kargo — iade gönderisi / iade kargo kodu üretimi (Faz 2).
 *
 * Resmi doküman "Gönderi Web Servisi 2024" (Sürat'ın 2026-07-14 mail dönüşü): metot
 * `GonderiyiKargoyaGonderYeni(KullaniciAdi, Sifre, Gonderi:GonderiModel)`, dönüş STRING →
 * "Tamam" başarı, değilse hata mesajı (dokümandaki Response ID 001-042 metinleri).
 * İADE modeli: `Iademi=true` (dokümanda iade bayrağı — eski metottaki 'normal gönderi' geçici
 * çözümünün yerini aldı), KisiKurum/AliciAdresi/Il/Ilce/Telefon/Email = MÜŞTERİ bilgisi
 * (Sürat dönüşü 2026-07-20: iade gönderisinde bu alanlar paketi getiren müşteriyi tanımlar;
 * varış = cari hesabın kayıtlı iade adresi), OdemeTipi=2 (Ücret Alıcı → merchant öder,
 * müşteri ücretsiz bırakır), OzelKargoTakipNo = bizim kodumuz (public_code) →
 * müşteriye verilen iade kargo kodu budur.
 *
 * ⛔ CANLI ORTAM KURALI: dry_run=true iken SOAP çağrısı YAPILMAZ; payload loglanır ve DRYRUN- kod döner.
 */
class SuratKargoService implements CargoProviderInterface
{
    /**
     * Tek SOAP servisi hem gönderi oluşturma (GonderiyiKargoyaGonderYeni) hem takip
     * (KargoTakipHareketDetayi) operasyonlarını içerir. **HTTPS zorunlu** —
     * http (:80) bu sunucudan filtreleniyor; https (:443) açık (powerspeed aynı sunucudan bunu kullanıyor).
     */
    public const WSDL = 'https://webservices.suratkargo.com.tr/services.asmx?WSDL';

    private array $creds = [];
    private array $cfg = [];

    public static function fromChannel(?Channel $channel, array $cfg = []): self
    {
        $s = new self();
        $s->creds = $channel?->credentials ?? [];
        $s->cfg = $cfg ?: (array) config('returns.integrations.surat_kargo', []);

        return $s;
    }

    public function providerKey(): string
    {
        return 'surat-kargo';
    }

    public function displayName(): string
    {
        return 'Sürat Kargo';
    }

    public function expireDays(): int
    {
        return max(1, (int) ($this->cfg['expire_days'] ?? 14));
    }

    public function isDryRun(): bool
    {
        return (bool) ($this->cfg['dry_run'] ?? true);
    }

    /** Entegrasyon anahtarı (tenant returns_integrations.surat_kargo.enabled). Kapalıyken hiçbir işlem yapılmaz. */
    public function isEnabled(): bool
    {
        return (bool) ($this->cfg['enabled'] ?? false);
    }

    /** Kimlik: tenant ayarı (returns_integrations.surat_kargo.{username,password}) > kanal. */
    private function username(): string
    {
        return (string) ($this->cfg['username'] ?? $this->creds['surat_username'] ?? '');
    }

    private function password(): string
    {
        return (string) ($this->cfg['password'] ?? $this->creds['surat_password'] ?? '');
    }

    /**
     * Takip (WebSiparis... servisi) için Sürat WEB SERVİSİ şifresi — gönderi (API) şifresinden FARKLI
     * olabilir (powerspeed ayrı `kargoSuratWebPassword` kullanıyor). Yoksa API şifresine düşer.
     */
    private function webPassword(): string
    {
        return (string) ($this->cfg['web_password'] ?? $this->creds['surat_web_password'] ?? $this->password());
    }

    public function isConfigured(): bool
    {
        return $this->username() !== '' && $this->password() !== '';
    }

    /** WSDL adresi — varsayılan sabit; config ile geçersiz kılınabilir (hata senaryosu testleri için). */
    private function wsdl(): string
    {
        $u = trim((string) ($this->cfg['wsdl'] ?? ''));

        return $u !== '' ? $u : self::WSDL;
    }

    /** Ortak SoapClient (SSL doğrulama kapalı — Sürat sertifikası güvenilmez olabilir, powerspeed de kapatıyor). */
    private function makeClient(): SoapClient
    {
        return new SoapClient($this->wsdl(), [
            'trace' => app()->environment('local'),
            'exceptions' => true,
            'cache_wsdl' => WSDL_CACHE_DISK,
            'connection_timeout' => 30,
            'stream_context' => stream_context_create([
                'http' => ['timeout' => 60],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true],
            ]),
        ]);
    }

    /**
     * İade gönderisi oluştur → iade kargo kodu (OzelKargoTakipNo).
     *
     * @return array{success:bool, dry_run:bool, provider:string, tracking_code:?string, label_url:?string, error:?string, payload:array}
     */
    public function createReturnShipment(ReturnRequest $r): array
    {
        // Müşteriye verilecek iade kargo kodu = OzelKargoTakipNo (public_code).
        // KUSUR bildiriminde kod, yönetici ONAYINDA üretildiği için talep numarasından
        // 'ony' ekiyle ayrışır (kullanıcı kararı 2026-07-24; 27.07 revize: tiresiz küçük
        // harf — kısa kod formatıyla uyumlu, örn. tbk96439621ony).
        $code = $r->public_code . ($r->type === \App\Enums\ReturnType::Defect ? 'ony' : '');
        [$payload, $missing] = $this->buildGonderi($r, $code);

        // enabled=false → entegrasyon tamamen kapalı (dry-run dahil hiçbir şey yapılmaz).
        if (! $this->isEnabled()) {
            return $this->fail('Sürat Kargo entegrasyonu kapalı (Ayarlar → İade Entegrasyonları → enabled).', $payload);
        }

        if ($this->isDryRun()) {
            Log::channel(config('returns.log_channel', 'stack'))->info('[SuratKargo][DRY-RUN] iade gönderisi (gönderilmedi)', [
                'return_id' => $r->id, 'public_code' => $code, 'gonderi' => $payload, 'eksik_alan' => $missing,
            ]);

            return $this->ok('DRYRUN-' . $code, true, $payload);
        }

        if (! $this->isConfigured()) {
            return $this->fail('Sürat Kargo kullanıcı adı/şifresi eksik (Ayarlar → İade Entegrasyonları).', $payload);
        }
        if ($missing) {
            return $this->fail('İade adresi eksik (zorunlu): ' . implode(', ', $missing), $payload);
        }

        return $this->sendLive($r, $code, $payload);
    }

    /**
     * Gönderi payload'ı + eksik zorunlu alan listesi. Kişi/adres alanları MÜŞTERİ bilgisidir
     * (Sürat dönüşü 2026-07-20: Iademi=true iade gönderisinde bu blok paketi getiren müşteriyi
     * tanımlar; varış adresi cari hesaptan gelir). Adres, submit anında Ticimax teslimat
     * adresinden metadata.customer_address'e yazılır.
     *
     * @return array{0:array, 1:array<int,string>}
     */
    private function buildGonderi(ReturnRequest $r, string $code): array
    {
        $addr = (array) (($r->metadata ?? [])['customer_address'] ?? []);

        // Açık adres: mahalle/semt ayrı alandaysa ve adres metninde geçmiyorsa başa eklenir.
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

        // GonderiyiKargoyaGonderYeni → `GonderiModel` (WSDL'den doğrulandı 2026-07-14). Eski
        // metodun VarisSubeObjId/EvrakSiraNo/SiparisObjId/EntegrasyonSozlesme/KWebGonderiGirisiKaynak
        // alanları bu modelde YOK; OdemeTipi büyük T. BirimDesi/BirimKg WSDL'de string.
        // Telefon yalnız rakam olmalı (Response 020) — boşluk/ayraç temizlenir.
        $phone = preg_replace('/\D+/', '', (string) ($r->customer_phone ?? ''));

        $gonderi = [
            'KisiKurum' => (string) ($r->customer_name ?? ''),  // müşteri (paketi getiren kişi)
            'SahisBirim' => '',
            'AliciAdresi' => $adres,
            'Il' => (string) ($addr['city'] ?? ''),
            'Ilce' => (string) ($addr['district'] ?? ''),
            'TelefonEv' => '',
            'TelefonIs' => $phone,
            'TelefonCep' => $phone,
            'Email' => (string) ($r->customer_email ?? ''),
            'AliciKodu' => '',
            'KargoTuru' => (int) ($this->cfg['kargo_turu'] ?? 3),  // 3 = KOLİ (kutu/paket); config ile değişir
            'OdemeTipi' => 2,                          // 2 = Ücret Alıcı (merchant öder → müşteri ücretsiz)
            'IrsaliyeSeriNo' => '',
            'IrsaliyeSiraNo' => '',
            'ReferansNo' => (string) ($r->order_no ?? ''),
            'OzelKargoTakipNo' => $code,              // müşteriye verilen iade kargo kodu (max 50)
            'Adet' => 1,
            // Sürat kuralı: KOLİ'de Desi ve Kg sıfırdan büyük olmalı (Response 006/032) —
            // en az 1. Kg ayrı config (yoksa desi değerine düşer).
            'BirimDesi' => (string) max(1, (float) ($this->cfg['desi'] ?? 1)),
            'BirimKg' => (string) max(1, (float) ($this->cfg['kg'] ?? $this->cfg['desi'] ?? 1)),
            'KargoIcerigi' => '',                      // yalnız kolibaşı sözleşmeli parçalı gönderide dolu olmalı
            'KapidanOdemeTahsilatTipi' => 0,
            'KapidanOdemeTutari' => '',                // kapıdan ödeme değil → boş (Response 033: dolu olamaz)
            'EkHizmetler' => '',
            'SevkAdresi' => '',
            'TeslimSubeKodu' => '',
            'TasimaSekli' => 1,                        // 1 = Kara Yolu Aracı (dokümanda standart)
            'TeslimSekli' => 1,                        // 1 = Adrese Teslim (merchant adresine)
            'GonderiSekli' => 0,                       // 0 = Standart gönderi (dokümanda standart değer)
            'Pazaryerimi' => 0,                        // pazaryeri gönderisi değil
            'EntegrasyonFirmasi' => '',                // yalnız Pazaryerimi=1 iken zorunlu
            'Iademi' => true,                          // İADE gönderisi (dokümandaki resmi iade bayrağı)
        ];

        return [$gonderi, $missing];
    }

    /**
     * Kargo durumu sorgula (otomatik takip — returns:track-shipments cron'u kullanır).
     *
     * Sürat metodu: `KargoTakipHareketDetayi(CariKodu, Sifre, WebSiparisKodu)` — Sürat'ın
     * 2026-07-21 dönüşüyle geçildi (eski `SozlesmeyeGoreKargoTakip` eski metotmuş; bu en
     * güncel olan). Doküman: "Kargo Takip Hareket Detayı 2024" kitapçığı. Yanıt JSON string:
     * {IsError, errorMessage, Gonderiler:[{KargonunDurumu, KargonunDurumuSayi, TeslimTarihi,
     * TeslimAlan, IadeDurum, Hareketler:[{Islem, IslemTarihi, HareketYeri}], ...}]}.
     * Durum kodları: 1 Gönderi Hazırlanıyor (evrak var, şube kabulü YOK — ilerletme yapılmaz),
     * 2-5/7/9/11 harekette, 6/13/14 Teslim Edildi varyantları. Canlı doğrulama (2026-07-21):
     * teslim edilmiş iade IADE-PKVMNE37 → durum 6 + TeslimAlan dolu; kargoya verilmemiş kod →
     * IsError=false + boş Gonderiler + errorMessage; olmayan kod → IsError=true "Sipariş bulunamadı."
     * Kimlik: cari kodu + ANA şifre (web şifresi değil — canlıda doğrulandı).
     *
     * ⛔ dry_run iken canlı sorgu YAPILMAZ (statü null → cron ilerletmez).
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
            return $none(false, 'Sürat Kargo entegrasyonu kapalı.');
        }
        if ($this->isDryRun()) {
            return $none(true); // dry-run: otomatik ilerletme yok (statü null).
        }
        if (! $this->isConfigured()) {
            return $none(false, 'Sürat Kargo kimliği eksik.');
        }

        try {
            $resp = $this->makeClient()->KargoTakipHareketDetayi([
                'CariKodu' => $this->username(),
                'Sifre' => $this->password(),
                'WebSiparisKodu' => $code,            // = OzelKargoTakipNo (public_code)
            ]);

            $data = json_decode((string) ($resp->KargoTakipHareketDetayiResult ?? ''), true);
            if (! is_array($data)) {
                return $none(false, 'Sürat takip yanıtı çözümlenemedi.');
            }
            if (($data['IsError'] ?? false) || empty($data['Gonderiler'])) {
                // "Sipariş bulunamadı." / boş Gonderiler ("Gönderi iptal edilmiştir." vb.)
                // → ilerletme yapma. Şube kabulüne kadar kayıt görünmemesi normal.
                $msg = trim((string) ($data['errorMessage'] ?? ''));

                return $none(false, $msg !== '' ? 'Sürat: ' . $msg : 'Sürat kaydı bulunamadı (şube kabulü bekleniyor olabilir).');
            }

            // Birden çok gönderi dönerse bizim koda ait olanı seç (Satiskodu = OzelKargoTakipNo).
            $g = null;
            foreach ($data['Gonderiler'] as $cand) {
                if (($cand['Satiskodu'] ?? '') === $code) {
                    $g = $cand;
                    break;
                }
            }
            $g ??= $data['Gonderiler'][0];

            $durumSayi = (int) ($g['KargonunDurumuSayi'] ?? 0);
            $durum = trim((string) ($g['KargonunDurumu'] ?? ''));
            $teslimAlan = trim((string) ($g['TeslimAlan'] ?? ''));
            $teslimTarihi = trim((string) ($g['TeslimTarihi'] ?? ''));

            // Son hareket: IslemTarihi'ne göre en yenisi (canlıda liste yeni→eski geliyor ama sıraya güvenme).
            // Ayrıca "Evrak Oluşturuldu" dışında hareket var mı bak: Sürat, şube paketi fiilen
            // teslim alıp araca yükledikten sonra bile KargonunDurumuSayi=1 dönebiliyor
            // (27.07 IADE-DEH9N3YY: Tesellüm + "Kargo Araca Yüklendi" ama durum sayısı 1).
            // Kabul öncesi sorgu zaten BOŞ Gonderiler döndüğünden, evrak-dışı hareket = kabul kanıtı.
            $sonIslem = '';
            $sonTarih = '';
            $kabulHareketi = false;
            $teslimHareketTarihi = '';   // "Teslim Edildi" hareketinin TAM zamanı (TeslimTarihi saatsizdir)
            $teslimYeri = '';
            foreach ((array) ($g['Hareketler'] ?? []) as $h) {
                $islem = trim((string) ($h['Islem'] ?? ''));
                $t = (string) ($h['IslemTarihi'] ?? '');
                if ($t >= $sonTarih) {
                    $sonTarih = $t;
                    $sonIslem = $islem;
                }
                if ($islem !== '' && mb_strtolower($islem) !== 'evrak oluşturuldu') {
                    $kabulHareketi = true;
                }
                // Teslim hareketi: durum sayısı 6/13/14 ya da işlem adı "Teslim Edildi".
                $hDurum = (int) ($h['KargoHareketKargonunDurumuSayi'] ?? 0);
                if ((in_array($hDurum, [6, 13, 14], true) || mb_stripos($islem, 'teslim edildi') !== false)
                    && $t > $teslimHareketTarihi) {
                    $teslimHareketTarihi = $t;
                    $teslimYeri = trim((string) ($h['HareketYeri'] ?? ''));
                }
            }

            // Teslim: durum kodu 6/13/14 (dokümandaki 'Teslim Edildi' varyantları) veya
            // TeslimAlan/TeslimTarihi dolu ("TeslimEdilmedi" placeholder'ı teslim sayılmaz).
            $teslimAlanOk = $teslimAlan !== ''
                && mb_strtolower(str_replace(' ', '', $teslimAlan)) !== 'teslimedilmedi';
            $delivered = in_array($durumSayi, [6, 13, 14], true) || $teslimAlanOk || $teslimTarihi !== '';

            // Yolda: kabul edilip ilerlemiş (durum 2+) VEYA durum sayısı gecikmeli olsa da
            // evrak-dışı hareket başlamış (Tesellüm sonrası "Kargo Araca Yüklendi" vb.).
            $inTransit = ! $delivered && ($durumSayi >= 2 || $kabulHareketi);

            $status = $durum;
            if ($sonIslem !== '' && $sonIslem !== $durum) {
                $status = trim($durum . ($durum !== '' ? ' — ' : '') . $sonIslem);
            }

            return [
                'success' => true, 'dry_run' => false,
                'status' => $status !== '' ? $status : null,
                'in_transit' => $inTransit, 'delivered' => $delivered, 'error' => null,
                // Teslim kanıtı — personel listede "ne zaman, kim teslim aldı" görsün diye
                // saklanır (TrackReturnShipments → metadata.delivery). TeslimTarihi SAATSİZDİR
                // (01/08/2026) → tam zaman "Teslim Edildi" hareketinden alınır, o da yoksa tarihe düşülür.
                'delivered_at' => $teslimHareketTarihi !== '' ? $teslimHareketTarihi : ($teslimTarihi !== '' ? $teslimTarihi : null),
                'received_by' => $teslimAlanOk ? $teslimAlan : null,
                'delivered_place' => $teslimYeri !== '' ? $teslimYeri : null,
                // Sürat'ın KENDİ takip numarası + hazır takip linki (bizim tba… kodumuz değil).
                'carrier_tracking_no' => trim((string) ($g['KargoTakipNo'] ?? '')) ?: null,
                'tracking_url' => trim((string) ($g['TakipUrl'] ?? '')) ?: null,
                // Paket ÜZERİNDEKİ barkod = KargoObjId'nin son 11 hanesi (canlı doğrulama 06.08:
                // 3120000101254037867 → 01254037867; önek 31200001 sabit, kalan sıralı seri).
                'cargo_barcode' => self::barcodeFromObjId($g['KargoObjId'] ?? null),
            ];
        } catch (SoapFault $e) {
            Log::warning('[SuratKargo] takip SOAP hatası', ['code' => $code, 'err' => $e->getMessage()]);

            return $none(false, 'Sürat takip bağlantı hatası: ' . $e->getMessage());
        } catch (\Throwable $e) {
            Log::warning('[SuratKargo] takip hatası', ['code' => $code, 'err' => $e->getMessage()]);

            return $none(false, 'Sürat takip hata: ' . $e->getMessage());
        }
    }

    /**
     * Paket üzerindeki 11 haneli barkod, takip yanıtında ayrı alan olarak GELMEZ —
     * KargoObjId'nin son 11 hanesidir (depo personelinin okuttuğu numara).
     */
    public static function barcodeFromObjId(mixed $objId): ?string
    {
        $s = trim((string) ($objId ?? ''));

        return (strlen($s) > 11 && ctype_digit($s)) ? substr($s, -11) : null;
    }

    /**
     * Kargoya verilmemiş gönderiyi Sürat'ta SİL (GonderiSil) — 7 gün kullanılmayan iade kodunun
     * pasifleştirilmesi için (returns:expire-shipments). Kod = OzelKargoTakipNo (public_code).
     * Kimlik: cariKodu + WEB şifresi (takiple aynı kimlik seti).
     * İdempotent: kayıt zaten yoksa ("bulunamadı") başarı sayılır — kod zaten kullanılamaz durumda.
     *
     * @return array{success:bool, dry_run:bool, result:?string, error:?string}
     */
    public function cancelShipment(string $code): array
    {
        $base = fn (bool $ok, ?string $result = null, ?string $err = null, bool $dryRun = false): array => [
            'success' => $ok, 'dry_run' => $dryRun, 'result' => $result, 'error' => $err,
        ];

        if (! $this->isEnabled()) {
            return $base(false, null, 'Sürat Kargo entegrasyonu kapalı.');
        }
        if ($this->isDryRun()) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info('[SuratKargo][DRY-RUN] GonderiSil çağrılmadı', ['ozel_kargo_takip_no' => $code]);

            return $base(true, 'DRY-RUN', null, true);
        }
        if (! $this->isConfigured()) {
            return $base(false, null, 'Sürat Kargo kimliği eksik.');
        }

        try {
            $resp = $this->makeClient()->GonderiSil([
                'cariKodu' => $this->username(),
                'WebPassword' => $this->webPassword(),
                'ozelKargoTakipNo' => $code,
            ]);

            $result = trim((string) ($resp->GonderiSilResult ?? ''));
            $hay = mb_strtolower($result);

            // Başarı sinyalleri: "Tamam"/"silindi"/"başarı"; "bulunamadı" = zaten yok (idempotent başarı).
            $ok = $hay !== '' && (
                $hay === 'tamam'
                || str_contains($hay, 'silindi')
                || str_contains($hay, 'basari') || str_contains($hay, 'başarı')
                || str_contains($hay, 'bulunamad')
            );

            if (! $ok) {
                Log::warning('[SuratKargo] GonderiSil reddedildi', ['kod' => $code, 'sonuc' => $result]);
            }

            return $base($ok, $result, $ok ? null : ('Sürat Kargo: ' . ($result !== '' ? $result : 'bilinmeyen yanıt')));
        } catch (SoapFault $e) {
            Log::warning('[SuratKargo] GonderiSil SOAP hatası', ['kod' => $code, 'err' => $e->getMessage()]);

            return $base(false, null, 'Sürat bağlantı hatası: ' . $e->getMessage());
        } catch (\Throwable $e) {
            Log::warning('[SuratKargo] GonderiSil hatası', ['kod' => $code, 'err' => $e->getMessage()]);

            return $base(false, null, 'Sürat hata: ' . $e->getMessage());
        }
    }

    /**
     * Canlı gönderi + TAŞIMA HATASINDA yeniden deneme (2026-09-10).
     *
     * Olay: 6-7 Eylül'de Sürat SOAP servisi aralıklı "Internal Server Error" verdi; tek deneme
     * yapıldığı için 5 talep kalıcı olarak KODSUZ kaldı ve müşteriler talep numarasını kargo
     * kodu sanıp şubeye gitti ("kod geçersiz"). Aynı saatlerde önceki/sonraki talepler başarılıydı.
     *
     * Kural: yalnız TAŞIMA hatası (SoapFault/Throwable) yeniden denenir. Sürat'ın "tamam"
     * dışındaki iş kuralı yanıtı (Response 001-042) sunucunun bilinçli reddidir — tekrarlamak
     * aynı sonucu verir, denenmez.
     *
     * ⚠ Mükerrer gönderi koruması: taşıma hatasında istek Sürat'a ULAŞMIŞ ve işlenmiş olabilir
     * (timeout). Bu yüzden her yeniden denemeden ÖNCE kodun Sürat'ta kaydı var mı sorulur;
     * varsa gönderi oluşmuş demektir → başarı sayılır, ikinci kayıt AÇILMAZ.
     */
    private function sendLive(ReturnRequest $r, string $code, array $gonderi): array
    {
        $attempts = max(1, (int) ($this->cfg['send_attempts'] ?? 3));
        $last = null;

        for ($i = 1; $i <= $attempts; $i++) {
            if ($i > 1) {
                // Kayıt önceki denemede oluşmuş olabilir → mükerrer gönderi açma.
                if ($this->existsAtSurat($code) === true) {
                    Log::channel(config('returns.log_channel', 'stack'))->warning(
                        '[SuratKargo] taşıma hatası sonrası kayıt Sürat\'ta BULUNDU — mükerrer gönderi açılmadı',
                        ['return_id' => $r->id, 'public_code' => $code, 'deneme' => $i]
                    );

                    return $this->ok($code, false, $gonderi);
                }
                usleep((int) (1_500_000 * (2 ** ($i - 2))));  // 1.5s, 3s, 6s...
            }

            $res = $this->sendOnce($r, $code, $gonderi);

            // "Bu gonderi daha önce oluşturulmuş" (2026-10-03, talep #1872): önceki bir ÇAĞRIDA
            // (submit / retry-cargo) istek zaman aşımına düşüp Sürat'ta işlenmişse sonraki her
            // deneme bu redle döner ve talep kalıcı KODSUZ kalırdı. Kod Sürat'ta kayıtlıysa
            // gönderi zaten bizimdir (OzelKargoTakipNo = public_code) → başarı sayılır.
            if (! $res['success'] && $this->isAlreadyCreated((string) ($res['error'] ?? ''))
                && $this->existsAtSurat($code) === true) {
                Log::channel(config('returns.log_channel', 'stack'))->warning(
                    '[SuratKargo] gönderi daha önce oluşturulmuş — kayıt Sürat\'ta doğrulandı, kod kabul edildi',
                    ['return_id' => $r->id, 'public_code' => $code]
                );

                return $this->ok($code, false, $gonderi);
            }

            if ($res['success'] || ! ($res['retryable'] ?? false)) {
                return $res;
            }
            $last = $res;
            Log::warning('[SuratKargo] taşıma hatası' . ($i < $attempts ? ' — yeniden denenecek' : ' — denemeler tükendi'), [
                'return_id' => $r->id, 'deneme' => $i, 'toplam' => $attempts, 'err' => $res['error'] ?? null,
            ]);
        }

        return $last ?? $this->fail('Sürat Kargo: bilinmeyen hata.', $gonderi);
    }

    /** Sürat'ın mükerrer gönderi reddi mi? ("Bu gonderi daha önce oluşturulmuş.") */
    private function isAlreadyCreated(string $error): bool
    {
        $e = mb_strtolower($error);

        return str_contains($e, 'daha önce oluş') || str_contains($e, 'daha once olus');
    }

    /**
     * Kod Sürat'ta kayıtlı mı? true=var, false=yok, null=belirsiz (sorgu da başarısız).
     * "bulunamadı" → yok; diğer her yanıt (şube kabulü bekleniyor dâhil) → kayıt var.
     */
    private function existsAtSurat(string $code): ?bool
    {
        try {
            $q = $this->queryShipment($code);
        } catch (\Throwable $e) {
            return null;
        }
        if ($q['success']) {
            return true;
        }
        $err = mb_strtolower((string) ($q['error'] ?? ''));
        if ($err === '') {
            return null;
        }
        if (str_contains($err, 'bulunamad')) {
            return false;
        }
        // "Veri aktarımı sağlanmış olup kargo kabul bekleniyor." vb. → kayıt VAR.
        if (str_contains($err, 'kabul bekleniyor') || str_contains($err, 'veri aktar')) {
            return true;
        }

        return null;
    }

    /** Tek gönderi denemesi. `retryable` yalnız taşıma katmanı hatalarında true'dur. */
    private function sendOnce(ReturnRequest $r, string $code, array $gonderi): array
    {
        try {
            $client = $this->makeClient();

            $resp = $client->GonderiyiKargoyaGonderYeni([
                'KullaniciAdi' => $this->username(),
                'Sifre' => $this->password(),
                'Gonderi' => $gonderi,
            ]);

            $result = trim((string) ($resp->GonderiyiKargoyaGonderYeniResult ?? ''));

            if (mb_strtolower($result) !== 'tamam') {
                Log::warning('[SuratKargo] iade gönderisi reddedildi', ['return_id' => $r->id, 'sonuc' => $result]);

                return $this->fail($result !== '' ? ('Sürat Kargo: ' . $result) : 'Sürat Kargo: bilinmeyen hata.', $gonderi);
            }

            return $this->ok($code, false, $gonderi);
        } catch (SoapFault $e) {
            Log::error('[SuratKargo] SOAP hatası', ['return_id' => $r->id, 'err' => $e->getMessage()]);

            return $this->fail('Sürat Kargo bağlantı hatası: ' . $e->getMessage(), $gonderi) + ['retryable' => true];
        } catch (\Throwable $e) {
            Log::error('[SuratKargo] beklenmeyen hata', ['return_id' => $r->id, 'err' => $e->getMessage()]);

            return $this->fail('Sürat Kargo hata: ' . $e->getMessage(), $gonderi) + ['retryable' => true];
        }
    }

    private function ok(string $trackingCode, bool $dryRun, array $payload): array
    {
        return [
            'success' => true, 'dry_run' => $dryRun, 'provider' => 'surat-kargo',
            'tracking_code' => $trackingCode, 'label_url' => null, 'error' => null, 'payload' => $payload,
        ];
    }

    private function fail(string $msg, array $payload): array
    {
        return [
            'success' => false, 'dry_run' => $this->isDryRun(), 'provider' => 'surat-kargo',
            'tracking_code' => null, 'label_url' => null, 'error' => $msg, 'payload' => $payload,
        ];
    }
}
