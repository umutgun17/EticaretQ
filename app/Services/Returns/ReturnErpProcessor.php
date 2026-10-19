<?php

namespace App\Services\Returns;

use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Log;

/**
 * İptal/İade ERP yazma orkestrasyonu (Nebim + Ticimax). Hem public (müşteri submit anında
 * otomatik iptal) hem personel/yönetici paneli (iade Ticimax 'Iade') tarafından yeniden kullanılır.
 *
 * Onay modeli: ERP/statü işlemleri OTOMATİK yürür; yönetici onayı yalnızca PARA gate'idir. Bu servis
 * ASLA para hareketi yapmaz (Faz 4) — yalnızca sipariş statüsü/iptal belgesi yazar.
 *
 *  İPTAL: Nebim ModelType 34 (kalem-bazlı sil, faturalı guard) → Ticimax iptal (tam SetSiparisDurum
 *         'Iptal' / kısmi SiparisUrunIptalIade). Müşteri talebi gönderir göndermez otomatik çalışır.
 *  İADE : Ticimax statü 'Iade' (Nebim'e DOKUNULMAZ — kullanıcı kararı). Personel gelen kargoyu
 *         onaylayınca otomatik çalışır.
 *
 * ⛔ CANLI ORTAM KURALI: tüm yazma çağrıları dry-run aware (NebimService/Ticimax cfg.dry_run). dry-run
 * iken dış servise istek GİTMEZ, payload loglanır.
 */
class ReturnErpProcessor
{
    /** Tenant'ın nebim-v3 servisi (opsiyonel kanal kimliği) + config(+tenant ayarı). */
    public function nebimFor(ReturnRequest $r): NebimService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'nebim-v3')
            ->where('is_active', true)
            ->first();

        $cfg = (array) config('returns.integrations.nebim', []);
        $tenantCfg = $r->tenant?->settings['returns_integrations']['nebim'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return NebimService::fromChannel($channel, $cfg);
    }

    /**
     * İPTAL otomasyonu: önce Nebim (kalem-bazlı sil; faturalı/eşleşmeyen kalem → burada engellenir),
     * başarılıysa Ticimax iptali (Nebim kapsamına göre tam/kısmi). İkisi de başarılı olmalı.
     *
     * @return array{success:bool, nebim:array, ticimax:?array, error:?string}
     */
    public function processCancel(ReturnRequest $r): array
    {
        $nebim = $this->nebimFor($r)->submitReturn($r);
        if (! $nebim['success']) {
            return ['success' => false, 'nebim' => $nebim, 'ticimax' => null, 'error' => 'Nebim iptal işlenemedi: ' . ($nebim['error'] ?? '?')];
        }

        $ticimax = $this->ticimaxCancel($r, (bool) ($nebim['is_full'] ?? false));
        if (! $ticimax['success']) {
            return ['success' => false, 'nebim' => $nebim, 'ticimax' => $ticimax, 'error' => 'Ticimax iptali yapılamadı: ' . ($ticimax['error'] ?? '?')];
        }

        return ['success' => true, 'nebim' => $nebim, 'ticimax' => $ticimax, 'error' => null];
    }

    /**
     * İPTAL — Ticimax tarafı. $isFull=true → TAM iptal SetSiparisDurum('Iptal'); $isFull=false →
     * KISMI iptal SiparisUrunIptalIade (kalem-bazlı). Para iadesi YOK (Faz 4).
     *
     * @return array{success:bool, dry_run:bool, provider:string, mode:string, method:string, error:?string, payload:array}
     */
    public function ticimaxCancel(ReturnRequest $r, bool $isFull): array
    {
        return $this->applyTicimax($r, $isFull, 'cancel');
    }

    /**
     * İPTAL otomasyonuna KALDIĞI YERDEN devam — adım-idempotent retry (vaka #134, 2026-08-06):
     * processCancel Nebim'i her retry'da BAŞTAN koşar; oysa yarım kalan vakada Nebim çoktan işlenmiş
     * (kalemler Qty=0) ve kalan ürün SONRADAN faturalanmış olabilir → buildModelType34'ün fatura
     * guard'ı retry'ı tamamen kilitler (çift belge riski de var). Burada HER ADIM önce canlıdan
     * "zaten yapılmış mı" diye doğrulanır; yapılmışsa atlanır, yapılmamışsa normal yoldan koşar.
     *
     *  - Nebim: talep kalemi barkodlarının Nebim kalan adedi beklenen değere inmişse (qty_ordered−talep)
     *    adım YAPILMIŞ sayılır. Hiç düşmemişse normal submitReturn koşar. ARADA bir değerse (kısmen
     *    işlenmiş/elle değişmiş) güvenli tarafta durup hata döner — insan incelemesi gerekir.
     *  - Ticimax: talep kalemleri zaten iptal durumundaysa (item_durum_id) adım atlanır; değilse
     *    ticimaxCancel koşar (kapsam: Nebim koştuysa onun is_full'u, atlandıysa Nebim kalan adetlerinden).
     *
     * @return array{success:bool, nebim:array, ticimax:?array, error:?string}
     */
    public function processCancelResume(ReturnRequest $r): array
    {
        $fail = fn (string $m, array $nebim = []): array => ['success' => false, 'nebim' => $nebim, 'ticimax' => null, 'error' => $m];

        $detail = $this->nebimFor($r)->getOrderDetail((string) $r->platform_order_id, $r->items->pluck('barcode')->all());
        if (! $detail['success']) {
            return $fail('Nebim sipariş detayı okunamadı: ' . ($detail['error'] ?? '?'));
        }
        // usp_OrderDetail satırları iptal belgesi sonrası join artefaktıyla ÇİFTLENİR → LineID'de teke indir.
        $byLine = [];
        foreach ($detail['rows'] as $row) {
            $byLine[(string) $row['OrderLineID']] = $row;
        }
        $qtyByBarcode = [];
        foreach ($byLine as $row) {
            $bc = trim((string) ($row['UsedBarcode'] ?? ''));
            if ($bc !== '') {
                $qtyByBarcode[$bc] = ($qtyByBarcode[$bc] ?? 0) + max(0, (int) ($row['Qty'] ?? 0));
            }
        }

        // Nebim adımı yapılmış mı? Kalem kalem: kalan adet beklenene inmiş / hiç düşmemiş / belirsiz.
        $doneCnt = 0;
        $untouchedCnt = 0;
        foreach ($r->items as $it) {
            $q = (int) ($it->qty_approved ?? $it->qty_requested);
            if ($q <= 0) {
                continue;
            }
            $bc = trim((string) $it->barcode);
            $current = $qtyByBarcode[$bc] ?? null;
            if ($bc === '' || $current === null) {
                return $fail('Talep kalemi Nebim ile eşleşmedi: ' . $it->product_name . ' (' . ($bc ?: 'barkodsuz') . ')');
            }
            $expected = max(0, (int) $it->qty_ordered - $q);
            if ($current <= $expected) {
                $doneCnt++;
            } elseif ($current >= (int) $it->qty_ordered) {
                $untouchedCnt++;
            } else {
                return $fail("Nebim kalan adedi belirsiz durumda ({$it->product_name}: kalan {$current}, beklenen {$expected}) — elle inceleme gerekir.");
            }
        }
        if ($doneCnt > 0 && $untouchedCnt > 0) {
            return $fail('Nebim kalemlerinin bir kısmı iptal edilmiş, bir kısmı edilmemiş görünüyor — elle inceleme gerekir.');
        }

        if ($untouchedCnt > 0) {
            // Nebim hiç işlememiş → klasik akış (Nebim + Ticimax) aynen koşsun.
            return $this->processCancel($r);
        }

        // ── Nebim ZATEN işlenmiş → adımı atla. Kapsamı mevcut Nebim durumundan hesapla:
        // tüm ÜRÜN (barkodlu) satırları sıfırlanmışsa TAM, değilse KISMİ iptal.
        $isFull = true;
        foreach ($byLine as $row) {
            if (trim((string) ($row['UsedBarcode'] ?? '')) !== '' && (int) ($row['Qty'] ?? 0) > 0) {
                $isFull = false;
                break;
            }
        }
        $first = array_values($byLine)[0] ?? [];
        $nebim = [
            'success' => true, 'skipped' => true, 'dry_run' => false,
            'order_number' => (string) ($first['OrderNumber'] ?? ''), 'is_full' => $isFull, 'error' => null,
        ];

        // ── Ticimax adımı yapılmış mı? Kalem durumları zaten iptal kodundaysa atla.
        if ($this->ticimaxCancelAlreadyApplied($r, $isFull)) {
            return ['success' => true, 'nebim' => $nebim,
                'ticimax' => ['success' => true, 'skipped' => true, 'dry_run' => false, 'provider' => 'ticimax',
                    'mode' => 'cancel', 'method' => $isFull ? 'full' : 'partial', 'error' => null, 'payload' => []],
                'error' => null];
        }

        $ticimax = $this->ticimaxCancel($r, $isFull);
        if (! $ticimax['success']) {
            return ['success' => false, 'nebim' => $nebim, 'ticimax' => $ticimax,
                'error' => 'Ticimax iptali yapılamadı: ' . ($ticimax['error'] ?? '?')];
        }

        return ['success' => true, 'nebim' => $nebim, 'ticimax' => $ticimax, 'error' => null];
    }

    /**
     * Ticimax iptal adımı DAHA ÖNCE uygulanmış mı? (resume güvenlik kontrolü — salt-okuma)
     * Kısmi: talep kalemlerinin Ticimax `Durum`u zaten `item_durum_id` (İptal Edildi) mi?
     * Tam: sipariş durumu zaten iptal statüsü mü? Okuma başarısızsa "uygulanmamış" varsayılır
     * (yazma yolu kendi hatasını zaten net raporlar).
     */
    private function ticimaxCancelAlreadyApplied(ReturnRequest $r, bool $isFull): bool
    {
        $channel = $this->ticimaxChannel($r);
        if (! $channel) {
            return false;
        }
        $res = TicimaxService::fromChannel($channel)->getOrderByNo((string) $r->order_no);
        if (! ($res['success'] ?? false)) {
            return false;
        }
        $order = json_decode(json_encode($res['order'] ?? []), true);

        if ($isFull) {
            $cfg = $this->ticimaxConfig($r);
            $want = mb_strtolower(str_replace(' ', '', (string) ($cfg['cancel_status'] ?? 'Iptal')));

            return mb_strtolower(str_replace(' ', '', (string) ($order['SiparisDurumu'] ?? ''))) === $want;
        }

        $items = $order['Urunler']['WebSiparisUrun'] ?? [];
        if (isset($items['ID'])) {
            $items = [$items];
        }
        $statusById = [];
        foreach ((array) $items as $it) {
            if (is_array($it) && isset($it['ID'])) {
                $statusById[(int) $it['ID']] = (int) ($it['Durum'] ?? 0);
            }
        }
        $durumId = (int) ($this->ticimaxConfig($r)['item_durum_id'] ?? 0);
        if ($durumId <= 0) {
            return false;
        }
        foreach ($r->items as $it) {
            $q = (int) ($it->qty_approved ?? $it->qty_requested);
            if ($q <= 0 || empty($it->platform_line_id)) {
                continue;
            }
            if (($statusById[(int) $it->platform_line_id] ?? null) !== $durumId) {
                return false;
            }
        }

        return true;
    }

    /**
     * İADE/İPTAL — para iadesi tamamlanınca Ticimax sipariş statüsü (RefundService çağırır).
     * Kapsam TAM ise 'IadeOdemeYapildi', KISMİ ise 'KismiIadeYapildi' (kullanıcı kararı 2026-08-07;
     * iptallerde 'Iptal' statüsünün üzerine yazılır — sipariş statüsünde "ödeme yapıldı" bilgisi
     * öncelikli, kalemler zaten 'İptal Edildi' işaretli kalır). Nebim'e dokunulmaz.
     *
     * @return array{success:bool, dry_run:bool, provider:string, mode:string, method:string, error:?string, payload:array}
     */
    public function ticimaxReturnStatus(ReturnRequest $r): array
    {
        $cfg = $this->ticimaxConfig($r);
        $status = $this->refundScopeIsFull($r)
            ? (string) ($cfg['return_status'] ?? 'IadeOdemeYapildi')
            : (string) ($cfg['return_status_partial'] ?? 'KismiIadeYapildi');

        return $this->applyTicimax($r, true, 'return', $status);
    }

    /**
     * Ödemesi yapılan talebin kapsamı siparişin TAMAMI mı? İptalde ERP iptal adımının kapsamı
     * (metadata.ticimax_cancel.method / nebim is_full), iade/kusurda submit anındaki hesaplamanın
     * `full_return` bayrağı + personel onayında adet kısılmış mı kontrolü. Belirsizse TAM varsayılır
     * (eski davranış korunur).
     */
    public function refundScopeIsFull(ReturnRequest $r): bool
    {
        if ($r->type === \App\Enums\ReturnType::Cancel) {
            $method = $r->metadata['ticimax_cancel']['method'] ?? null;
            if (is_string($method) && $method !== '') {
                return $method === 'full';
            }

            return (bool) (($r->nebim_result['is_full'] ?? null) ?? true);
        }

        if (! (bool) ($r->metadata['calculation']['breakdown']['full_return'] ?? true)) {
            return false;
        }
        foreach ($r->items as $it) {
            if ($it->qty_approved !== null && (int) $it->qty_approved < (int) $it->qty_requested) {
                return false;
            }
        }

        return true;
    }

    /**
     * PERSONEL ONAYI — ürün depoya ulaşıp kontrol edildiğinde Ticimax siparişi
     * 'IadeUlastiOdemeYapilacak' statüsüne çekilir (kullanıcı kararı 2026-08-07). Best-effort.
     *
     * @return array{success:bool, dry_run:bool, provider:string, mode:string, method:string, error:?string, payload:array}
     */
    public function ticimaxStaffApproved(ReturnRequest $r): array
    {
        $cfg = $this->ticimaxConfig($r);

        return $this->applyTicimax($r, true, 'staff_approved', (string) ($cfg['staff_approved_status'] ?? 'IadeUlastiOdemeYapilacak'));
    }

    /**
     * Red/süre dolumu geri çekmesi bu tenant'ta AÇIK mı? ⚠ Varsayılan KAPALI (2026-08-07):
     * TeslimEdildi'ye dönüş Ticimax statü-SMS otomasyonunu tetikleyip müşteriye ikinci kez
     * teslim SMS'i gönderebilir; enum'da red'e özel statü yok. Açmak: tenant/env
     * reject_revert_enabled=true (SMS otomasyonu kapalıysa güvenli).
     */
    public function ticimaxRejectRevertEnabled(ReturnRequest $r): bool
    {
        return (bool) ($this->ticimaxConfig($r)['reject_revert_enabled'] ?? false);
    }

    /**
     * RED / SÜRE DOLUMU — sipariş statüsünü iade akışı ÖNCESİNE geri çeker (kullanıcı kararı
     * 2026-08-07). Öncelik: submit anında kaydedilen `metadata.ticimax_prev_status`; yoksa config
     * `reject_fallback_status` (varsayılan 'TeslimEdildi'). Yalnız daha önce sipariş statüsü bizim
     * tarafımızdan yazıldıysa VE ticimaxRejectRevertEnabled ise çağrılmalı (çağıran guard'lar).
     * Best-effort.
     *
     * @return array{success:bool, dry_run:bool, provider:string, mode:string, method:string, error:?string, payload:array}
     */
    public function ticimaxRejectRevert(ReturnRequest $r): array
    {
        $cfg = $this->ticimaxConfig($r);
        $prev = (string) ($r->metadata['ticimax_prev_status'] ?? '');
        $status = ($prev !== '' && in_array($prev, self::TICIMAX_ORDER_STATUSES, true))
            ? $prev
            : (string) ($cfg['reject_fallback_status'] ?? 'TeslimEdildi');
        // Kargodayken açılan iade (return_in_transit): red/süre dolumu anında paket müşteriye
        // ulaşmıştır → 'Kargoya Verildi'ye değil 'Teslim Edildi'ye geri çek.
        if ($status === 'KargoyaVerildi') {
            $status = 'TeslimEdildi';
        }

        return $this->applyTicimax($r, true, 'reject_revert', $status);
    }

    /** WebSiparisDurumlari enum değerleri (WSDL xsd'den, 2026-07-07 doğrulaması). */
    private const TICIMAX_ORDER_STATUSES = [
        'OnayBekliyor', 'Onaylandi', 'OdemeBekliyor', 'Paketleniyor', 'TedarikEdiliyor',
        'KargoyaVerildi', 'TeslimEdildi', 'TeslimEdilemedi', 'Iptal', 'Iade', 'IadeTalepAlindi',
        'IadeUlastiOdemeYapilacak', 'IadeOdemeYapildi', 'TeslimOncesiIptal', 'IptalTalebi',
        'KismiIadeTalebi', 'KismiIadeYapildi', 'CuzdanaIade',
    ];

    /** İade akışının KENDİ yazdığı statüler — prev-status anlık görüntüsüne alınmaz. */
    private const TICIMAX_RETURN_FLOW_STATUSES = [
        'Iade', 'IadeTalepAlindi', 'IadeUlastiOdemeYapilacak', 'IadeOdemeYapildi',
        'KismiIadeTalebi', 'KismiIadeYapildi',
    ];

    /**
     * Ticimax "Sipariş Durumu" etiketini WebSiparisDurumlari enum adayına çevirir
     * ("Teslim Edildi" → "TeslimEdildi"). Bilinen enum'la eşleşmezse null.
     */
    public static function ticimaxStatusLabelToEnum(?string $label): ?string
    {
        $s = trim((string) $label);
        if ($s === '') {
            return null;
        }
        $s = str_replace(
            ['ı', 'İ', 'ş', 'Ş', 'ğ', 'Ğ', 'ü', 'Ü', 'ö', 'Ö', 'ç', 'Ç', ' '],
            ['i', 'I', 's', 'S', 'g', 'G', 'u', 'U', 'o', 'O', 'c', 'C', ''],
            $s
        );
        // Ticimax PANEL etiketi ≠ enum adı olan bilinen durumlar (canlı t1 örnekleri, 2026-08-07):
        // "İade Talebi Alındı", "İade Ödemesi Yapıldı", "İptal Edildi", "İade Edildi".
        $aliases = [
            'iadetalebialindi' => 'IadeTalepAlindi',
            'iadeodemesiyapildi' => 'IadeOdemeYapildi',
            'iptaledildi' => 'Iptal',
            'iadeedildi' => 'Iade',
            'teslimatoncesiiptal' => 'TeslimOncesiIptal',
        ];
        $alias = $aliases[mb_strtolower($s)] ?? null;
        if ($alias !== null) {
            return $alias;
        }
        foreach (self::TICIMAX_ORDER_STATUSES as $enum) {
            if (strcasecmp($s, $enum) === 0) {
                return $enum;
            }
        }

        return null;
    }

    /**
     * İADE TALEBİ ALINDI — müşteri iade talebi verip kargo kodu oluştuğunda Ticimax siparişi
     * 'IadeTalepAlindi' statüsüne çekilir (kullanıcı kararı 2026-07-07). Best-effort: başarısız
     * olsa da iade akışı devam eder (sonraki fazların statüleri ayrıca yazılır: personel onayı
     * 'IadeUlastiOdemeYapilacak', ödeme sonrası 'IadeOdemeYapildi'/'KismiIadeYapildi').
     *
     * @return array{success:bool, dry_run:bool, provider:string, mode:string, method:string, error:?string, payload:array}
     */
    public function ticimaxReturnRequested(ReturnRequest $r): array
    {
        // Statüyü yazmadan ÖNCE mevcut sipariş statüsünü kaydet (red/süre dolumunda geri
        // çekilebilsin — kullanıcı kararı 2026-08-07). İade akışının kendi statüleri anlık
        // görüntüye alınmaz (ör. reddedilen eski talebin ardından ikinci talep). Best-effort.
        $this->snapshotTicimaxPrevStatus($r);

        $res = $this->applyTicimax($r, true, 'return_requested');
        // Ürün kırılımı: talep edilen kalemler panelde 'İade Talebi' görünsün (best-effort).
        $res['payload']['item_status'] = $this->ticimaxItemStatuses($r, 'return_requested');

        return $res;
    }

    /** Siparişin şu anki Ticimax statüsünü metadata.ticimax_prev_status'a yazar (best-effort). */
    private function snapshotTicimaxPrevStatus(ReturnRequest $r): void
    {
        try {
            $channel = $this->ticimaxChannel($r);
            if (! $channel || ! empty($r->metadata['ticimax_prev_status'])) {
                return;
            }
            $res = TicimaxService::fromChannel($channel)->getOrderByNo((string) $r->order_no);
            if (! ($res['success'] ?? false)) {
                return;
            }
            $order = json_decode(json_encode($res['order'] ?? []), true);
            $enum = self::ticimaxStatusLabelToEnum($order['SiparisDurumu'] ?? null);
            if ($enum === null || in_array($enum, self::TICIMAX_RETURN_FLOW_STATUSES, true)) {
                return;
            }
            $meta = $r->metadata ?? [];
            $meta['ticimax_prev_status'] = $enum;
            $r->metadata = $meta;
            $r->save();
        } catch (\Throwable $e) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info('[Ticimax] prev-status anlık görüntüsü alınamadı', ['return_id' => $r->id, 'err' => $e->getMessage()]);
        }
    }

    /**
     * Ürün kırılımına (sipariş kalemi) statü yazar — Ticimax panelde hangi ürünün iade sürecinde
     * olduğu görünsün diye (kullanıcı isteği 2026-07-30). Best-effort: hata iade akışını durdurmaz.
     *
     * $phase: 'return_requested' (talep kalemleri → İade Talebi) · 'refunded' (onaylı kalemler →
     * İade Edildi) · 'reverted' (red/süre dolumu → İşlemde; yalnız daha önce işaretlendiyse çağrılmalı).
     * Kodlar config returns.integrations.ticimax.item_status'tan; enabled=false → hiç çağrı yok.
     * Canlı başarıda metadata.ticimax_item_status={phase} yazılır (revert guard'ı için).
     *
     * @return array{enabled:bool, dry_run?:bool, phase?:string, marked?:array, errors?:array}
     */
    public function ticimaxItemStatuses(ReturnRequest $r, string $phase): array
    {
        $cfg = $this->ticimaxConfig($r);
        $itemCfg = (array) ($cfg['item_status'] ?? []);
        $codes = (array) ($itemCfg[$phase] ?? []);
        $durumId = (int) ($codes['durum_id'] ?? 0);
        $islem = (int) ($codes['islem'] ?? -1);

        if (! ($itemCfg['enabled'] ?? false) || $durumId <= 0 || $islem < 0 || ! ctype_digit((string) $r->platform_order_id)) {
            return ['enabled' => false];
        }

        $dryRun = (bool) ($cfg['dry_run'] ?? true);
        $items = [];
        foreach ($r->items as $it) {
            $qty = $phase === 'refunded' ? (float) ($it->qty_approved ?? $it->qty_requested) : (float) $it->qty_requested;
            if ($qty > 0 && ctype_digit((string) $it->platform_line_id)) {
                $items[] = ['SiparisUrunID' => (int) $it->platform_line_id, 'Adet' => $qty];
            }
        }
        if (! $items) {
            return ['enabled' => true, 'dry_run' => $dryRun, 'phase' => $phase, 'marked' => [], 'errors' => ['Kalemlerde platform_line_id yok.']];
        }

        if ($dryRun) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->info("[Ticimax][DRY-RUN] item_status {$phase} (gönderilmedi)", ['return_id' => $r->id, 'durum_id' => $durumId, 'islem' => $islem, 'items' => $items]);

            return ['enabled' => true, 'dry_run' => true, 'phase' => $phase, 'marked' => $items, 'errors' => []];
        }

        $channel = $this->ticimaxChannel($r);
        if (! $channel) {
            return ['enabled' => true, 'dry_run' => false, 'phase' => $phase, 'marked' => [], 'errors' => ['Ticimax kanalı bulunamadı.']];
        }

        $svc = TicimaxService::fromChannel($channel);
        $marked = [];
        $errors = [];
        foreach ($items as $it) {
            $res = $svc->setOrderItemStatus((int) $r->platform_order_id, $it['SiparisUrunID'], $it['Adet'], $durumId, $islem);
            if ($res['success']) {
                $marked[] = $it;
            } else {
                $errors[] = 'Kalem ' . $it['SiparisUrunID'] . ': ' . ($res['error'] ?? 'bilinmeyen hata');
            }
        }

        if ($marked) {
            $meta = $r->metadata ?? [];
            $meta['ticimax_item_status'] = $phase;
            $r->metadata = $meta;
            $r->save();
        }
        if ($errors) {
            Log::channel(config('returns.log_channel', 'stack'))
                ->warning("[Ticimax] item_status {$phase} kısmen/tamamen başarısız", ['return_id' => $r->id, 'errors' => $errors]);
        }

        return ['enabled' => true, 'dry_run' => false, 'phase' => $phase, 'marked' => $marked, 'errors' => $errors];
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    /** Ticimax config (varsayılan + tenant ayarı). */
    private function ticimaxConfig(ReturnRequest $r): array
    {
        $cfg = (array) config('returns.integrations.ticimax', []);
        $tenantCfg = $r->tenant?->settings['returns_integrations']['ticimax'] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        return $cfg;
    }

    private function ticimaxChannel(ReturnRequest $r): ?Channel
    {
        return Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->first();
    }

    /**
     * Ticimax statü/kalem yazma (iptal & iade ortak). $mode: 'cancel' → statü 'Iptal'; 'return' → 'Iade'.
     * dry-run iken SOAP çağrısı YAPILMAZ; payload loglanır. Kısmi (yalnızca iptal) için kalem kodları
     * config'de tanımlı değilse canlı çağrı engellenir.
     */
    private function applyTicimax(ReturnRequest $r, bool $isFull, string $mode, ?string $statusOverride = null): array
    {
        $cfg = $this->ticimaxConfig($r);
        $dryRun = (bool) ($cfg['dry_run'] ?? true);
        $method = $isFull ? 'full' : 'partial';
        $statusFull = $statusOverride ?? match ($mode) {
            'return' => (string) ($cfg['return_status'] ?? 'Iade'),
            'return_requested' => (string) ($cfg['return_requested_status'] ?? 'IadeTalepAlindi'),
            default => (string) ($cfg['cancel_status'] ?? 'Iptal'),
        };
        $notify = (bool) ($cfg['notify_customer'] ?? false);

        $log = fn (array $payload) => Log::channel(config('returns.log_channel', 'stack'))
            ->info("[Ticimax][DRY-RUN] {$mode} ({$method}) (gönderilmedi)", ['return_id' => $r->id, 'payload' => $payload]);
        $ok = fn (array $payload) => ['success' => true, 'dry_run' => $dryRun, 'provider' => 'ticimax', 'mode' => $mode, 'method' => $method, 'error' => null, 'payload' => $payload];
        $fail = fn (string $m, array $payload) => ['success' => false, 'dry_run' => $dryRun, 'provider' => 'ticimax', 'mode' => $mode, 'method' => $method, 'error' => $m, 'payload' => $payload];

        if ($isFull) {
            // ── TAM: sipariş statüsü 'Iptal' / 'Iade' ──
            $payload = ['mode' => $mode, 'method' => 'full', 'siparis_id' => (string) $r->platform_order_id, 'order_no' => (string) $r->order_no, 'durum' => $statusFull, 'mail_bilgilendir' => $notify];
            if ($dryRun) {
                $log($payload);

                return $ok($payload);
            }
            $channel = $this->ticimaxChannel($r);
            if (! $channel) {
                return $fail('Ticimax kanalı bulunamadı.', $payload);
            }
            $res = TicimaxService::fromChannel($channel)->setOrderStatus((int) $r->platform_order_id, $statusFull, $notify, (string) $r->order_no);

            return $res['success'] ? $ok($payload) : $fail($res['error'] ?? 'Ticimax statü güncellenemedi.', $payload);
        }

        // ── KISMI: kalem-bazlı SiparisUrunIptalIade ──
        $items = [];
        foreach ($r->items as $it) {
            $q = (int) ($it->qty_approved ?? $it->qty_requested);
            if ($q > 0 && ! empty($it->platform_line_id)) {
                $items[] = ['SiparisUrunID' => (int) $it->platform_line_id, 'Adet' => $q];
            }
        }
        $islem = (int) ($cfg['item_islem'] ?? 0);
        $durumId = (int) ($cfg['item_durum_id'] ?? 0);
        $iadeNeden = (int) ($cfg['item_iade_neden_id'] ?? 0);
        $payload = ['mode' => $mode, 'method' => 'partial', 'siparis_id' => (string) $r->platform_order_id, 'items' => $items, 'islem' => $islem, 'durum_id' => $durumId, 'iade_neden_id' => $iadeNeden];

        if (! $items) {
            return $fail('Kısmi işlem için Ticimax sipariş satır ID (platform_line_id) bulunamadı.', $payload);
        }
        if ($dryRun) {
            $log($payload);

            return $ok($payload);
        }
        // Canlı: Ticimax kalem kodları tanımlı olmalı (bu tenant'ta henüz YOK → Ticimax ekibinden).
        if ($islem <= 0 || $durumId <= 0) {
            return $fail('Ticimax kalem kodları tanımlı değil (item_islem/item_durum_id). Kısmi işlem canlıya alınamaz — kodlar Ticimax tarafından sağlanmalı.', $payload);
        }
        $channel = $this->ticimaxChannel($r);
        if (! $channel) {
            return $fail('Ticimax kanalı bulunamadı.', $payload);
        }
        // SiparisUrunIptalIade KULLANILMIYOR (canlı deneme 2026-08-06, #134): TumuIptal=false'ta
        // API IadeTutari>0 zorunlu kılıyor; tutar göndermek Ticimax'ın ödeme kayıtlarını değiştirip
        // para iade tavanıyla (paid ceiling) çakışabilir. SetSiparisUrunDurum ise para alanları
        // DAİMA kapalı çalışır ve kalem-statü özelliğiyle 30 Tem'den beri canlıda kanıtlı.
        $svc = TicimaxService::fromChannel($channel);
        foreach ($items as $it) {
            $res = $svc->setOrderItemStatus((int) $r->platform_order_id, (int) $it['SiparisUrunID'], (float) $it['Adet'], $durumId, $islem, $iadeNeden);
            if (! ($res['success'] ?? false)) {
                return $fail('Ticimax kalem ' . $it['SiparisUrunID'] . ' işaretlenemedi: ' . ($res['error'] ?? '?'), $payload);
            }
        }

        return $ok($payload);
    }
}
