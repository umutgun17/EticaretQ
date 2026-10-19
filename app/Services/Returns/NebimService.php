<?php

namespace App\Services\Returns;

use App\Enums\ReturnType;
use App\Models\Channel;
use App\Models\ReturnRequest;
use Illuminate\Support\Facades\Log;

/**
 * Nebim V3 — İptal/İade ERP entegrasyonu (Faz 5).
 *
 * Onaylanan iptal/iade'yi Nebim Integrator üzerinden ERP'ye işler (ModelType 34
 * satış iade/iptal belgesi). İki uç (paylaşımlı integrator, çok şirketli host):
 *
 *  OKUMA  (canlı serbest): GET {host}:{port_read}/(S(<token>))/IntegratorService/RunProc?<urlencoded JSON>
 *          JSON: {"ProcName":"{db}.dbo.{proc}","Parameters":[{"Name":"DocumentNumber","Value":"<SiparisID>"}]}
 *          → satır başına: OrderNumber, OrderLineID(=LineID GUID), UsedBarcode, Qty,
 *            PaymentType(KK=2), CreditCardTypeCode, Doc_PriceVI(birim KDV DAHİL).
 *          3-PARÇALI isim (db.dbo.proc) ZORUNLU; aksi halde "saklı yordamı bulunamadı" (Error 2812).
 *
 *  YAZMA  (dry-run aware): POST {host}:{port_write}/(S(<token>))/IntegratorService/POST/
 *          body: {ModelType:34, OrderNumber, Lines:[{LineID, Qty1, OrderCancelReasonCode}], Payments:[...]}
 *          → yanıt ModelType==34 başarı; ==0 hata (ExceptionMessage).
 *
 * Token: {host}:{port_read}/IntegratorService/Connect → yanıt alanı `Token`. Tek token hem
 * RunProc (read) hem POST (write) için geçerli. Parametresiz Connect, TBSQL/TonnyBlack (TB01)
 * context'ine düşer → ek şirket parametresi gerekmez.
 *
 * ⛔ CANLI ORTAM KURALI: ModelType 34 = canlı ERP'ye YAZMA (para/muhasebe kritik). dry_run=true
 * iken POST YAPILMAZ; payload loglanır ve dry_run sonucu döner. Okuma her zaman serbest.
 */
class NebimService
{
    private array $creds = [];
    private array $cfg = [];

    public static function fromChannel(?Channel $channel, array $cfg = []): self
    {
        $s = new self();
        $s->creds = $channel?->credentials ?? [];
        $s->cfg = $cfg ?: (array) config('returns.integrations.nebim', []);

        return $s;
    }

    public function isDryRun(): bool
    {
        return (bool) ($this->cfg['dry_run'] ?? true);
    }

    /** Nebim entegrasyonu bu tenant için aktif mi (okuma/uygunluk kontrolü dahil). */
    public function isEnabled(): bool
    {
        return (bool) ($this->cfg['enabled'] ?? false);
    }

    // Kanal (tenant) ayarı global config'i EZER; eski sırada global doluyken
    // tenant'ın kendi Nebim host/db'si hiç kullanılamıyordu. Sabit müşteri
    // değerleri (185.51.114.151 / TB01) koddan çıkarıldı → boşsa bağlantı
    // açıkça başarısız olur, yanlış şirketin ERP'sine yazılmaz.
    private function host(): string
    {
        return (string) ($this->creds['nebim_host'] ?? $this->cfg['base_host'] ?? '');
    }

    private function portRead(): int
    {
        return (int) ($this->creds['nebim_port_read'] ?? $this->cfg['port_read'] ?? 34555);
    }

    private function portWrite(): int
    {
        return (int) ($this->creds['nebim_port_write'] ?? $this->cfg['port_write'] ?? 34554);
    }

    private function database(): string
    {
        return (string) ($this->creds['nebim_database'] ?? $this->cfg['database'] ?? '');
    }

    private function procOrderDetail(): string
    {
        return (string) ($this->cfg['proc_order_detail'] ?? 'usp_OrderDetail');
    }

    private function cancelReasonCode(): string
    {
        return (string) ($this->cfg['cancel_reason_code'] ?? 'N02');
    }

    public function isConfigured(): bool
    {
        return $this->host() !== '' && $this->database() !== '';
    }

    private function logChannel()
    {
        return Log::channel(config('returns.log_channel', 'stack'));
    }

    // ───────────────────────── BAĞLANTI ─────────────────────────

    /** Integrator session token (Connect → `Token`). Hem RunProc hem POST için geçerli. */
    public function connect(): ?string
    {
        $url = 'http://' . $this->host() . ':' . $this->portRead() . '/IntegratorService/Connect';
        [$body, $err] = $this->httpGet($url, 15);
        if ($err !== null) {
            $this->logChannel()->error('[Nebim] Connect hatası', ['err' => $err]);

            return null;
        }
        $data = json_decode((string) $body, true);

        return is_array($data) ? ($data['Token'] ?? null) : null;
    }

    // ───────────────────────── OKUMA (RunProc) ─────────────────────────

    /**
     * usp_OrderDetail çağrısı (RunProc). SALT-OKUMA — canlı serbest.
     *
     * ⚠️ SP yalnız DocumentNumber ile arar; başka kanalların (FLO, n11…) Nebim siparişleri aynı
     * belge numarasını taşıyabilir (2026-09-18: TB6239447524 / 672650 → FLO'nun faturalı siparişi
     * döndü, müşterinin iptali yanlışlıkla kapandı). `$expectedBarcodes` verilirse yalnız bu
     * barkodlardan en az birini içeren Nebim siparişinin (OrderNumber) satırları döner — bkz. ownRows().
     *
     * @param string $siparisId Ticimax SiparisID (= ReturnRequest.platform_order_id)
     * @param array<int,string> $expectedBarcodes Ticimax sipariş/talep kalemlerinin barkodları
     * @return array{success:bool, rows:array<int,array>, error:?string}
     */
    public function getOrderDetail(string $siparisId, array $expectedBarcodes = []): array
    {
        $detail = $this->fetchOrderDetail($siparisId);
        if (! $detail['success'] || ! $expectedBarcodes) {
            return $detail;
        }

        return $this->ownRows($siparisId, $detail['rows'], $expectedBarcodes);
    }

    /**
     * Belge numarası çakışmasını ayıklar: satırları Nebim OrderNumber'a göre gruplar, ürün barkodları
     * beklenenle kesişen grubu tutar (kargo/hizmet satırları grubuyla birlikte gelir). Hiç eşleşme yoksa
     * satırsız döner (= sipariş henüz Nebim'e düşmemiş, çağıran fail-closed davranır). Birden fazla grup
     * eşleşirse hangisinin bizim olduğu bilinemez → hata (fail-closed).
     *
     * @return array{success:bool, rows:array<int,array>, error:?string}
     */
    private function ownRows(string $siparisId, array $rows, array $expectedBarcodes): array
    {
        $expected = array_flip(array_filter(array_map(fn ($b) => trim((string) $b), $expectedBarcodes)));
        if (! $expected) {
            return ['success' => true, 'rows' => $rows, 'error' => null];
        }

        $groups = [];
        foreach ($rows as $row) {
            $groups[(string) ($row['OrderNumber'] ?? '')][] = $row;
        }

        $matched = [];
        foreach ($groups as $orderNumber => $groupRows) {
            foreach ($groupRows as $row) {
                if (isset($expected[trim((string) ($row['UsedBarcode'] ?? ''))])) {
                    $matched[$orderNumber] = $groupRows;
                    break;
                }
            }
        }

        if (count($matched) > 1) {
            $this->logChannel()->warning('[Nebim] Belge numarasında birden fazla eşleşen sipariş', [
                'siparis_id' => $siparisId, 'order_numbers' => array_keys($matched),
            ]);

            return ['success' => false, 'rows' => [], 'error' => 'Nebim\'de bu belge numarasıyla birden fazla eşleşen sipariş var (' . implode(', ', array_keys($matched)) . ').'];
        }

        $foreign = array_diff(array_keys($groups), array_keys($matched));
        if ($foreign) {
            $this->logChannel()->info('[Nebim] Belge numarası çakışması — başka sipariş satırları atlandı', [
                'siparis_id' => $siparisId,
                'foreign' => array_map(fn ($on) => [
                    'order_number' => $on,
                    'sales_url' => $groups[$on][0]['SalesURL'] ?? null,
                    'invoice' => $groups[$on][0]['InvoiceNumber'] ?? null,
                ], array_values($foreign)),
            ]);
        }

        return ['success' => true, 'rows' => $matched ? array_values($matched)[0] : [], 'error' => null];
    }

    /** @return array{success:bool, rows:array<int,array>, error:?string} */
    private function fetchOrderDetail(string $siparisId): array
    {
        $siparisId = trim($siparisId);
        if ($siparisId === '') {
            return ['success' => false, 'rows' => [], 'error' => 'empty_order_id'];
        }

        $token = $this->connect();
        if (! $token) {
            return ['success' => false, 'rows' => [], 'error' => 'Nebim bağlantısı kurulamadı (Connect).'];
        }

        $proc = $this->database() . '.dbo.' . $this->procOrderDetail();
        $json = json_encode([
            'ProcName' => $proc,
            'Parameters' => [['Name' => 'DocumentNumber', 'Value' => $siparisId]],
        ], JSON_UNESCAPED_UNICODE);

        $url = 'http://' . $this->host() . ':' . $this->portRead()
            . '/(S(' . $token . '))/IntegratorService/RunProc?' . rawurlencode($json);

        [$body, $err] = $this->httpGet($url, 40);
        if ($err !== null) {
            $this->logChannel()->error('[Nebim] RunProc hatası', ['siparis_id' => $siparisId, 'err' => $err]);

            return ['success' => false, 'rows' => [], 'error' => $err];
        }

        $data = json_decode((string) $body, true);

        // Başarılı sonuç JSON ARRAY (satırlar). Hata ise OBJE + ExceptionMessage.
        if (is_array($data) && array_is_list($data)) {
            return ['success' => true, 'rows' => $data, 'error' => null];
        }

        $msg = is_array($data) ? ($data['ExceptionMessage'] ?? 'Bilinmeyen Nebim yanıtı') : 'Geçersiz Nebim yanıtı';
        $msg = trim(preg_replace('/\s+/', ' ', (string) $msg));
        $this->logChannel()->warning('[Nebim] usp_OrderDetail başarısız', ['siparis_id' => $siparisId, 'msg' => $msg]);

        return ['success' => false, 'rows' => [], 'error' => $msg];
    }

    /**
     * Siparişin faturalaşma durumu (iptal uygunluğu için). SALT-OKUMA.
     * usp_OrderDetail satırlarında dolu `InvoiceNumber` varsa sipariş faturalanmıştır
     * → ModelType 34 iptal "Satış İade İşlemine İzin Verilmiyor!" ile reddedilir.
     *
     * `found` = sipariş Nebim'de bulundu mu (≥1 satır). Connector gecikmesiyle taze sipariş
     * henüz düşmemişse success=true + found=false döner → çağıran fail-closed bekletir.
     *
     * @return array{success:bool, found:bool, invoiced:bool, invoice_number:?string, error:?string}
     */
    public function getInvoiceStatus(string $siparisId, array $expectedBarcodes = []): array
    {
        $detail = $this->getOrderDetail($siparisId, $expectedBarcodes);
        if (! $detail['success']) {
            return ['success' => false, 'found' => false, 'invoiced' => false, 'invoice_number' => null, 'error' => $detail['error']];
        }

        $invoiceNo = null;
        foreach ($detail['rows'] as $row) {
            $inv = trim((string) ($row['InvoiceNumber'] ?? ''));
            if ($inv !== '') {
                $invoiceNo = $inv;
                break;
            }
        }

        return [
            'success' => true,
            'found' => count($detail['rows']) > 0,
            'invoiced' => $invoiceNo !== null,
            'invoice_number' => $invoiceNo,
            'error' => null,
        ];
    }

    // ───────────────────────── YAZMA (ModelType 34) ─────────────────────────

    /**
     * ModelType 34 payload'ını ÜRETİR (POST etmez): getOrderDetail → faturalaşma kontrolü →
     * barkod eşleme → Lines + Payments + CancelDate. `is_full` = tüm sipariş satırları tam adet
     * iptal mi (Ticimax tam/kısmi iptal yol seçimi için). Hem önizleme hem gönderim bunu kullanır.
     *
     * @return array{success:bool, payload:array, is_full:bool, order_number:?string, amount:float, error:?string}
     */
    public function buildModelType34(ReturnRequest $r): array
    {
        $fail = fn (string $m): array => ['success' => false, 'payload' => [], 'is_full' => false, 'order_number' => null, 'amount' => 0.0, 'error' => $m];

        $detail = $this->getOrderDetail((string) $r->platform_order_id, $r->items->pluck('barcode')->all());
        if (! $detail['success']) {
            return $fail('Nebim sipariş detayı okunamadı: ' . ($detail['error'] ?? '?'));
        }
        $rows = $detail['rows'];
        if (! $rows) {
            return $fail('Nebim siparişte satır bulunamadı (SiparisID: ' . $r->platform_order_id . ').');
        }

        // İPTAL'de faturalaşma SERT KORUMASI: faturalanmış sipariş ModelType 34 ile iptal edilemez
        // (Nebim "Satış İade İşlemine İzin Verilmiyor!" döner) → canlıya hatalı istek gitmesin.
        if ($r->type === ReturnType::Cancel) {
            foreach ($rows as $row) {
                if (trim((string) ($row['InvoiceNumber'] ?? '')) !== '') {
                    return $fail('Sipariş faturalandığı için iptal edilemez (faturalaşmış). Teslim sonrası iade talebi gerekir.');
                }
            }
        }

        // Barkod → Nebim satırları (her adet ayrı LineID olabilir).
        $byBarcode = [];
        foreach ($rows as $row) {
            $bc = trim((string) ($row['UsedBarcode'] ?? ''));
            if ($bc !== '') {
                $byBarcode[$bc][] = $row;
            }
        }

        // İptal/iade kalemlerini eşle → Lines + Amount + adet tahsisi (is_full için).
        $lines = [];
        $amount = 0.0;
        $missing = [];
        $allocated = []; // OrderLineID => iptal edilen adet
        $reason = $this->cancelReasonCode();

        foreach ($r->items as $item) {
            $needed = (int) ($item->qty_approved ?? $item->qty_requested);
            if ($needed <= 0) {
                continue;
            }
            $bc = trim((string) $item->barcode);
            $candidates = $byBarcode[$bc] ?? [];
            if ($bc === '' || ! $candidates) {
                $missing[] = $item->product_name . ' (' . ($bc ?: 'barkodsuz') . ')';

                continue;
            }

            foreach ($candidates as $row) {
                if ($needed <= 0) {
                    break;
                }
                $lid = (string) $row['OrderLineID'];
                $rowQty = max(1, (int) ($row['Qty'] ?? 1));
                $remainingRow = $rowQty - ($allocated[$lid] ?? 0);
                if ($remainingRow <= 0) {
                    continue;
                }
                $take = min($needed, $remainingRow);
                $lines[] = [
                    'LineID' => $lid,
                    'Qty1' => $take,
                    'OrderCancelReasonCode' => $reason,
                ];
                $amount += round((float) ($row['Doc_PriceVI'] ?? 0) * $take, 2);
                $allocated[$lid] = ($allocated[$lid] ?? 0) + $take;
                $needed -= $take;
            }

            if ($needed > 0) {
                $missing[] = $item->product_name . ' (yetersiz Nebim adedi)';
            }
        }

        if ($missing) {
            return $fail('İade kalemleri Nebim ile eşleşmedi: ' . implode(', ', $missing));
        }
        if (! $lines) {
            return $fail('İade edilecek kalem yok (onaylı adet 0).');
        }

        // KARGO/HİZMET SATIRLARI (barkodsuz): siparişteki TÜM ürün satırları tam adet iptal
        // ediliyorsa bunlar da iptale eklenir → Nebim'de sipariş tamamen sıfırlanır, aksi halde
        // kargo satırı kalıp sipariş "hâlâ duruyor" görünür (kullanıcı kararı 2026-08-03).
        // KISMİ iptalde dokunulmaz — müşteri 3 üründen 1'ini iptal ederken kargo iptal edilmemeli.
        $productsFull = true;
        foreach ($rows as $row) {
            if (trim((string) ($row['UsedBarcode'] ?? '')) === '') {
                continue; // barkodsuz = kargo/hizmet, ürün bütünlüğü hesabına girmez
            }
            $lid = (string) $row['OrderLineID'];
            if (($allocated[$lid] ?? 0) < max(1, (int) ($row['Qty'] ?? 1))) {
                $productsFull = false;
                break;
            }
        }
        if ($productsFull) {
            foreach ($rows as $row) {
                if (trim((string) ($row['UsedBarcode'] ?? '')) !== '') {
                    continue;
                }
                $lid = (string) $row['OrderLineID'];
                $rowQty = max(1, (int) ($row['Qty'] ?? 1));
                $remainingRow = $rowQty - ($allocated[$lid] ?? 0);
                if ($remainingRow <= 0) {
                    continue;
                }
                $lines[] = [
                    'LineID' => $lid,
                    'Qty1' => $remainingRow,
                    'OrderCancelReasonCode' => $reason,
                ];
                $amount += round((float) ($row['Doc_PriceVI'] ?? 0) * $remainingRow, 2);
                $allocated[$lid] = ($allocated[$lid] ?? 0) + $remainingRow;
            }
        }

        // is_full: TÜM sipariş satırları tam adet iptal mi? (kısmi iptalde Ticimax kalem-bazlı yol gerekir)
        $isFull = true;
        foreach ($rows as $row) {
            $lid = (string) $row['OrderLineID'];
            if (($allocated[$lid] ?? 0) < max(1, (int) ($row['Qty'] ?? 1))) {
                $isFull = false;
                break;
            }
        }

        // Ödeme: PaymentType + CreditCardTypeCode SP'den. Firma yalnızca kredi kartı → Code boş.
        $first = $rows[0];
        $payment = [
            'PaymentType' => (int) ($first['PaymentType'] ?? 0),
            'CreditCardTypeCode' => (string) ($first['CreditCardTypeCode'] ?? ''),
            'Code' => '',
            'InstallmentCount' => 1,
            'CurrencyCode' => 'TRY',
            'Amount' => round($amount, 2),
        ];

        $orderNumber = (string) $first['OrderNumber'];
        $payload = [
            'ModelType' => 34,
            'OrderNumber' => $orderNumber,
            'Lines' => $lines,
            'Payments' => [$payment],
            // Canlı çalışan örnek JSON'da zorunlu: .NET tarih biçimi /Date(epoch_ms)/ (iptal/iade anı).
            'CancelDate' => '/Date(' . (int) round(microtime(true) * 1000) . ')/',
        ];

        return ['success' => true, 'payload' => $payload, 'is_full' => $isFull, 'order_number' => $orderNumber, 'amount' => round($amount, 2), 'error' => null];
    }

    /**
     * Yönetici onay ekranı için ModelType 34 ÖNİZLEMESİ (POST etmez — buildModelType34 ile aynı, güvenli).
     *
     * @return array{success:bool, payload:array, is_full:bool, order_number:?string, amount:float, error:?string}
     */
    public function previewModelType34(ReturnRequest $r): array
    {
        return $this->buildModelType34($r);
    }

    /**
     * İptal/İade'yi Nebim'e işle (ModelType 34). dry-run varsayılan.
     *
     * @return array{success:bool, dry_run:bool, provider:string, order_number:?string, is_full:bool, response:?array, error:?string, payload:array}
     */
    public function submitReturn(ReturnRequest $r): array
    {
        $built = $this->buildModelType34($r);
        if (! $built['success']) {
            return $this->fail($built['error'] ?? 'Nebim payload üretilemedi', []);
        }
        $payload = $built['payload'];
        $orderNumber = $built['order_number'];

        if ($this->isDryRun()) {
            $this->logChannel()->info('[Nebim][DRY-RUN] ModelType 34 (gönderilmedi)', [
                'return_id' => $r->id, 'order_number' => $orderNumber, 'payload' => $payload,
            ]);

            return $this->ok($orderNumber, true, $payload, null, $built['is_full']);
        }

        return $this->sendLive($r, $payload, $built['is_full']);
    }

    private function sendLive(ReturnRequest $r, array $payload, bool $isFull = false): array
    {
        [$body, $err] = $this->connectAndPostWrite($this->encodeJson($payload));
        if ($err !== null) {
            $this->logChannel()->error('[Nebim] POST hatası', ['return_id' => $r->id, 'err' => $err]);

            return $this->fail('Nebim bağlantı hatası: ' . $err, $payload);
        }

        $resp = json_decode((string) $body, true);
        if (is_array($resp) && (int) ($resp['ModelType'] ?? 0) === 34) {
            $this->logChannel()->info('[Nebim] ModelType 34 başarılı', [
                'return_id' => $r->id, 'order_number' => $payload['OrderNumber'],
            ]);

            return $this->ok((string) $payload['OrderNumber'], false, $payload, $resp, $isFull);
        }

        $msg = is_array($resp) ? ($resp['ExceptionMessage'] ?? 'Bilinmeyen Nebim hatası') : 'Geçersiz Nebim yanıtı';
        $msg = trim(preg_replace('/\s+/', ' ', (string) $msg));
        $this->logChannel()->warning('[Nebim] ModelType 34 reddedildi', ['return_id' => $r->id, 'msg' => $msg]);

        return $this->fail('Nebim: ' . $msg, $payload, is_array($resp) ? $resp : null);
    }

    // ───────────────────────── HTTP (curl) ─────────────────────────

    /** @return array{0:?string, 1:?string} [body, error] */
    private function httpGet(string $url, int $timeout): array
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_CUSTOMREQUEST => 'GET',
        ]);
        $body = curl_exec($ch);
        $err = $body === false ? (curl_error($ch) ?: 'curl_error') : null;
        curl_close($ch);

        return [$body === false ? null : (string) $body, $err];
    }

    /**
     * Float'ları en kısa/temiz biçimde JSON'a çevirir (serialize_precision=-1).
     * Sunucu php.ini'sinde serialize_precision=100 olduğundan, Amount gibi tutar
     * alanları aksi halde kayan-nokta gürültüsüyle ("1509.95000…") gider → Nebim
     * "Tutarlar Örtüşmüyor" riski. Geçici set + restore ile caller'dan bağımsız.
     */
    private function encodeJson(array $data): string
    {
        $prev = ini_get('serialize_precision');
        ini_set('serialize_precision', '-1');
        try {
            return (string) json_encode($data, JSON_UNESCAPED_UNICODE);
        } finally {
            ini_set('serialize_precision', $prev);
        }
    }

    /**
     * Yazma portu (34554) Connect + POST — TEK curl handle ile.
     *
     * 34554 cookieless ASP.NET session kullanır: /IntegratorService/Connect → 302 ile
     * /(S(<session>))/IntegratorService/Connect'e yönlendirir. Çözülen session'a (redirect
     * sonrası effective URL'den okunur) DOĞRUDAN POST edilir → ikinci bir redirect olmaz →
     * POST gövdesi düşmez. Aynı handle kullanıldığı için cookie + keep-alive bağlantı korunur.
     *
     * NOT: Bir önceki yaklaşım (rastgele session id'ye POST + FOLLOWLOCATION/POSTREDIR) çalışmadı:
     * 34554 her POST'u taze session'a yönlendiriyordu ve redirect'te gövde boşalıyordu
     * ("Geçersiz Nebim yanıtı" → "Boş akışın serisini kaldırma girişimi"). Canlı doğrulandı:
     * çözülen session'a doğrudan POST → Nebim gövdeyi parse ediyor (ModelType 34 işlenir).
     *
     * @return array{0:?string, 1:?string} [body, error]
     */
    private function connectAndPostWrite(string $json): array
    {
        $base = 'http://' . $this->host() . ':' . $this->portWrite();
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $base . '/IntegratorService/Connect',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,   // 302 → /(S(session))/Connect izlenir
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_COOKIEFILE => '',          // handle-içi cookie motoru
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 30,
        ]);
        $connectBody = curl_exec($ch);
        if ($connectBody === false) {
            $e = curl_error($ch) ?: 'connect_error';
            curl_close($ch);

            return [null, 'Nebim bağlantısı kurulamadı (Connect): ' . $e];
        }

        // Session çözümü — İKİ davranış da desteklenir:
        //  a) cookieless redirect: effective URL'de /(S(<session>))/  (eski 34554 davranışı)
        //  b) redirect YOK, gövdede token: {"Token":"..."} — okuma portuyla (34555) aynı biçim.
        //     2026-08-03: 34554 artık (b) ile yanıt veriyor; sadece (a)+SessionID arayan eski kod
        //     "session alınamadı" verip iptal otomasyonunu düşürüyordu (talep TBP71770262).
        $effective = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $session = null;
        if (preg_match('#/\(S\(([^)]+)\)\)/#', $effective, $m)) {
            $session = $m[1];
        } else {
            $cd = json_decode((string) $connectBody, true);
            $session = is_array($cd) ? ($cd['Token'] ?? $cd['SessionID'] ?? null) : null;
        }
        if (! $session) {
            curl_close($ch);

            return [null, 'Nebim session alınamadı (Connect, yazma portu).'];
        }

        // AYNI handle → çözülen session'a DOĞRUDAN POST (redirect kapalı → gövde tam ulaşır).
        curl_setopt_array($ch, [
            CURLOPT_URL => $base . '/(S(' . $session . '))/IntegratorService/POST/',
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 60,
        ]);
        $postBody = curl_exec($ch);
        $err = $postBody === false ? (curl_error($ch) ?: 'curl_error') : null;
        curl_close($ch);

        return [$postBody === false ? null : (string) $postBody, $err];
    }

    // ───────────────────────── sonuç sarmalayıcılar ─────────────────────────

    private function ok(string $orderNumber, bool $dryRun, array $payload, ?array $response, bool $isFull = false): array
    {
        return [
            'success' => true, 'dry_run' => $dryRun, 'provider' => 'nebim-v3', 'is_full' => $isFull,
            'order_number' => $orderNumber, 'response' => $response, 'error' => null, 'payload' => $payload,
        ];
    }

    private function fail(string $msg, array $payload, ?array $response = null): array
    {
        return [
            'success' => false, 'dry_run' => $this->isDryRun(), 'provider' => 'nebim-v3', 'is_full' => false,
            'order_number' => $payload['OrderNumber'] ?? null, 'response' => $response, 'error' => $msg, 'payload' => $payload,
        ];
    }
}
