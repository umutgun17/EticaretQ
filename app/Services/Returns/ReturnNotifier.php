<?php

namespace App\Services\Returns;

use App\Enums\ReturnActorType;
use App\Enums\ReturnType;
use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Services\NetgsmService;
use Illuminate\Support\Facades\Log;

/**
 * İade yaşam döngüsü SMS bildirimleri (Faz 2) — NetGSM üzerinden, şablonlu.
 *
 * ⛔ CANLI ORTAM KURALI: Varsayılan DRY-RUN. dry_run=true / sms.enabled=false / msgheader yok
 * ise SMS GÖNDERİLMEZ; mesaj yalnızca loglanır ve audit'e dry_run olarak yazılır.
 * Her gönderim (dry-run dahil) ReturnRequestEvent'e append-only kaydedilir.
 */
class ReturnNotifier
{
    public function __construct(private readonly ReturnAuditLogger $audit) {}

    /**
     * Panelden yönetilebilir SMS olayları (İade Yönetimi → SMS Yönetimi): etiket + varsayılan
     * şablon. Şablonlarda değişkenler: {ad} {kod} {siparis} {takip} {tutar} {kupon} {kupon_tutar} {gun} {tur} {neden} {kargo}.
     * {kargo} = tenant'ın kargo firması adı (Sürat Kargo / DHL Kargo — CargoProviderFactory).
     * Tenant override: settings['returns_integrations']['sms']['events'][olay] = {enabled, template}.
     * NOT: 'staff_approved' olayı artık gönderilmiyor (kullanıcı kararı 2026-07-21) — katalogda yok.
     */
    public static function templateCatalog(): array
    {
        return [
            'submitted' => ['label' => 'Talep alındı', 'default' => 'Sayın {ad}, {kod} numaralı {tur} talebiniz alındı. Süreç başladığında bilgilendirileceksiniz.'],
            'cancel_processing' => ['label' => 'İptal işleme alındı', 'default' => 'Sayın {ad}, {kod} numaralı iptal talebiniz işleme alındı. Onay sonrası ücret iadeniz başlatılacaktır.'],
            'cancel_completed_cod' => ['label' => 'İptal tamamlandı (kapıda ödeme — iade yok)', 'default' => 'Sayın {ad}, {kod} numaralı iptal talebiniz tamamlandı. Siparişiniz kapıda ödemeli olduğu ve tahsilat yapılmadığı için iade işlemi gerekmemektedir.'],
            'cargo_code' => ['label' => 'İade kargo kodu', 'default' => 'Sayın {ad}, iade süreciniz başladı. {takip} kodu ile ürününüzü {gun} gün içinde {kargo} şubesine ücretsiz teslim edebilirsiniz.'],
            'in_transit' => ['label' => 'Kargo yola çıktı', 'default' => '{kod} numaralı iade gönderiniz kargoya verildi, depomuza doğru yolda.'],
            'received' => ['label' => 'Depoya ulaştı', 'default' => '{kod} numaralı iade gönderiniz depomuza ulaştı, inceleniyor.'],
            'approved' => ['label' => 'Onaylandı (karta iade manuel yolda)', 'default' => '{kod} numaralı {tur} talebiniz onaylandı. İade tutarınız en kısa sürede işlenecektir.'],
            'rejected' => ['label' => 'Reddedildi', 'default' => '{kod} numaralı {tur} talebiniz onaylanmadı. Detay için bizimle iletişime geçebilirsiniz.'],
            'defect_approved' => ['label' => 'Kusur bildirimi onaylandı (kargo kodu)', 'default' => 'Sayın {ad}, kusur bildiriminiz ONAYLANDI. {takip} kodu ile ürünü {gun} gün içinde {kargo} şubesine ücretsiz teslim edebilirsiniz.'],
            'defect_rejected' => ['label' => 'Kusur bildirimi reddedildi (nedenli)', 'default' => 'Sayın {ad}, {kod} numaralı kusur bildiriminiz değerlendirildi ve onaylanmadı. Neden: {neden}'],
            'refunded' => ['label' => 'İade tamamlandı (ödeme yapıldı)', 'default' => '{kod} numaralı {tur} tutarınız ({tutar}) indirim koduna dönüştürüldü. Kodunuz: {kupon}'],
            'expired' => ['label' => 'İade kodu süresi doldu', 'default' => 'Sayın {ad}, {kod} numaralı iade kargo kodunuzun süresi dolduğu için talebiniz iptal edildi. Dilerseniz yeni talep oluşturabilirsiniz.'],
            // EKSİK/HATALI ÜRÜN (personel başlattı): para iadesi onaylanınca ÖZÜR + özel kupon.
            // {kupon} = özür kuponu kodu, {kupon_tutar} = kupon tutarı, {siparis} = sipariş no.
            'shortage_refunded' => ['label' => 'Eksik/hatalı ürün — özür + kupon (para iadesi yapıldı)', 'default' => 'Sayın {ad}, {siparis} numaralı siparişinizde gönderemediğimiz ürün için {tutar} iadeniz ödeme yönteminize başlatıldı. Yaşattığımız aksaklık için özür dileriz. Bir sonraki alışverişinizde {kupon} kodu ile {kupon_tutar} indirim hediyemizdir.'],
            // TESLİMAT SONRASI eksik/hatalı bildirimi (müşteri aradı, personel inceledi): daha GENEL özür metni.
            'shortage_delivered_refunded' => ['label' => 'Teslimat sonrası eksik/hatalı ürün — genel özür + kupon', 'default' => 'Sayın {ad}, {siparis} numaralı siparişinizde yaşanan durum için özür dileriz. {tutar} iadeniz ödeme yönteminize başlatıldı. Telafi amaçlı küçük bir hediyemiz: {kupon} kodu ile bir sonraki alışverişinizde {kupon_tutar} indirim.'],
        ];
    }

    /**
     * @param  array  $ctx  Şablon değişkenleri: tracking_code, amount, provider...
     * @return array{sent:bool, dry_run:bool, message:string, error:?string}
     */
    public function notify(ReturnRequest $r, string $event, array $ctx = []): array
    {
        // GERİ DÖNEN SİPARİŞ (personel kaydı, kullanıcı kararı 2026-10-05): müşteriye HİÇBİR bildirim gitmez
        // (onay/red/iade dahil tüm olaylar) — tek noktadan susturulur.
        if (ShortageService::isReturned($r)) {
            return ['sent' => false, 'dry_run' => false, 'message' => '', 'error' => null, 'skipped' => true];
        }

        $cfg = $this->smsConfig($r);
        $message = $this->buildMessage($r, $event, $ctx, $cfg);
        $phone = $r->customer_phone;

        $dryRun = (bool) ($cfg['dry_run'] ?? true);
        $enabled = (bool) ($cfg['enabled'] ?? false);
        $msgheader = $cfg['msgheader'] ?? null;
        // Olay bazlı anahtar (SMS Yönetimi sayfası): varsayılan AÇIK, tenant kapattıysa gönderilmez.
        $eventEnabled = (bool) ((($cfg['events'] ?? [])[$event]['enabled'] ?? true));

        // Gerçekten gönderilebilir mi? (canlı + açık + olay açık + başlık + telefon var)
        $canSendLive = $enabled && $eventEnabled && ! $dryRun && $msgheader && $phone;

        $sent = false;
        $error = null;

        if ($canSendLive) {
            $netgsm = $this->netgsmFor($r);
            if (! $netgsm || ! $netgsm->isAvailable()) {
                $error = 'NetGSM kimliği bulunamadı.';
            } else {
                // encoding='tr' → REST v2 (TR): Türkçe karakterler (ş ğ ı İ ç ...) korunur.
                // Türkçe karakterli gönderimde tek SMS ~150 karakterdir (ş/ğ/ı/İ 2 karakter sayılır).
                $res = $netgsm->sendSms($phone, $message, $msgheader, 'tr');
                $sent = $res['success'];
                $error = $res['error'];
            }
        } else {
            Log::channel(config('returns.log_channel', 'stack'))->info('[ReturnSMS][DRY-RUN] gönderilmedi', [
                'return_id' => $r->id, 'public_code' => $r->public_code, 'event' => $event,
                'phone' => $phone, 'message' => $message,
                'reason' => ! $enabled ? 'sms_disabled' : (! $eventEnabled ? 'event_disabled' : ($dryRun ? 'dry_run' : (! $msgheader ? 'no_msgheader' : (! $phone ? 'no_phone' : 'unknown')))),
            ]);
        }

        // Audit: her durumda iz bırak (gönderildi / dry-run / olay kapalı)
        $this->audit->log($r, 'sms_' . $event, [
            'actor_type' => ReturnActorType::System,
            'payload' => array_filter([
                'event' => $event,
                'sent' => $sent,
                'dry_run' => ! $canSendLive,
                'event_disabled' => ! $eventEnabled ? true : null,
                'message' => $message,
                'error' => $error,
            ], fn ($v) => $v !== null),
        ]);

        return ['sent' => $sent, 'dry_run' => ! $canSendLive, 'message' => $message, 'error' => $error];
    }

    /**
     * Olay → SMS metni (Türkçe, kısa). İptal/iade'ye göre kelime farkı ($r->type).
     * Tenant şablon override'ı (SMS Yönetimi sayfası) varsa {değişken}'ler doldurulup o kullanılır.
     */
    private function buildMessage(ReturnRequest $r, string $event, array $ctx, array $cfg = []): string
    {
        $name = $r->customer_name ? explode(' ', trim($r->customer_name))[0] : 'Değerli müşterimiz';
        $code = $r->public_code;
        $tracking = $ctx['tracking_code'] ?? $r->cargo_tracking_code;
        $amount = isset($ctx['amount']) ? number_format((float) $ctx['amount'], 2, ',', '.') . ' ' . ($r->currency ?? 'TRY') : null;
        $coupon = $ctx['coupon_code'] ?? null;
        $couponAmount = isset($ctx['coupon_amount']) ? number_format((float) $ctx['coupon_amount'], 0, ',', '.') . ' ' . ($r->currency ?? 'TRY') : null;
        $orderNo = (string) ($r->order_no ?? '');
        $days = (int) ($ctx['expire_days'] ?? 14); // iade kodunun geçerlilik süresi (gün) — tenant kuralı ctx ile gelir

        // İPTAL/İADE/KUSUR kelime farkı (talep türü).
        $tur = match ($r->type) {
            ReturnType::Cancel => 'iptal',
            ReturnType::Defect => 'kusur bildirimi',
            ReturnType::Shortage => 'iade',
            default => 'iade',
        };
        $reason = (string) ($ctx['reason'] ?? '');
        // Kargo firması adı: talebe yazılan sağlayıcı, yoksa tenant'ın seçili sağlayıcısı.
        $kargo = CargoProviderFactory::displayName(
            $r->cargo_provider ?: CargoProviderFactory::providerKeyFor($r->tenant)
        );

        $override = trim((string) ((($cfg['events'] ?? [])[$event]['template'] ?? '')));
        if ($override !== '') {
            return strtr($override, [
                '{ad}' => $name, '{kod}' => $code, '{takip}' => (string) $tracking,
                '{tutar}' => (string) ($amount ?? ''), '{kupon}' => (string) ($coupon ?? ''),
                '{gun}' => (string) $days, '{tur}' => $tur, '{neden}' => $reason,
                '{kargo}' => $kargo, '{kupon_tutar}' => (string) ($couponAmount ?? ''), '{siparis}' => $orderNo,
            ]);
        }

        return match ($event) {
            'submitted' => "Sayın {$name}, {$code} numaralı {$tur} talebiniz alındı. Süreç başladığında bilgilendirileceksiniz.",
            'cancel_processing' => "Sayın {$name}, {$code} numaralı iptal talebiniz işleme alındı. Onay sonrası ücret iadeniz başlatılacaktır.",
            'cancel_completed_cod' => "Sayın {$name}, {$code} numaralı iptal talebiniz tamamlandı. Siparişiniz kapıda ödemeli olduğu ve tahsilat yapılmadığı için iade işlemi gerekmemektedir.",
            'cargo_code' => "Sayın {$name}, iade süreciniz başladı. {$tracking} kodu ile ürününüzü {$days} gün içinde {$kargo} şubesine ücretsiz teslim edebilirsiniz.",
            'in_transit' => "{$code} numaralı iade gönderiniz kargoya verildi, depomuza doğru yolda.",
            'received' => "{$code} numaralı iade gönderiniz depomuza ulaştı, inceleniyor.",
            'staff_approved' => "{$code} numaralı iade gönderiniz incelendi ve onaylandı. Ücret iadeniz için son onay bekleniyor.",
            'expired' => "Sayın {$name}, {$code} numaralı iade kargo kodunuzun süresi dolduğu için talebiniz iptal edildi. Dilerseniz yeni talep oluşturabilirsiniz.",
            'approved' => "{$code} numaralı {$tur} talebiniz onaylandı. İade tutarınız en kısa sürede işlenecektir.",
            'rejected' => "{$code} numaralı {$tur} talebiniz onaylanmadı. Detay için bizimle iletişime geçebilirsiniz.",
            'defect_approved' => "Sayın {$name}, kusur bildiriminiz ONAYLANDI. {$tracking} kodu ile ürünü {$days} gün içinde {$kargo} şubesine ücretsiz teslim edebilirsiniz.",
            'defect_rejected' => "Sayın {$name}, {$code} numaralı kusur bildiriminiz değerlendirildi ve onaylanmadı." . ($reason !== '' ? " Neden: {$reason}" : ''),
            // Eksik/hatalı ürün: para iadesi + özür + özel kupon (kupon üretilemediyse kuponsuz metin).
            'shortage_refunded' => "Sayın {$name}, {$orderNo} numaralı siparişinizde gönderemediğimiz ürün için"
                . ($amount ? " {$amount} iadeniz ödeme yönteminize başlatıldı." : ' işlem tamamlandı.')
                . ' Yaşattığımız aksaklık için özür dileriz.'
                . ($coupon ? " Bir sonraki alışverişinizde {$coupon} kodu ile" . ($couponAmount ? " {$couponAmount}" : '') . ' indirim hediyemizdir.' : ''),
            // Teslimat sonrası eksik/hatalı bildirimi: nedeni sayılmayan genel özür + telafi hediyesi.
            'shortage_delivered_refunded' => "Sayın {$name}, {$orderNo} numaralı siparişinizde yaşanan durum için özür dileriz."
                . ($amount ? " {$amount} iadeniz ödeme yönteminize başlatıldı." : '')
                . ($coupon ? " Telafi amaçlı küçük bir hediyemiz: {$coupon} kodu ile bir sonraki alışverişinizde" . ($couponAmount ? " {$couponAmount}" : '') . ' indirim.' : ''),
            // store_credit → indirim kuponu kodu mesaja eklenir; aksi halde genel iade metni.
            'refunded' => $coupon
                ? ($amount
                    ? "{$code} numaralı {$tur} tutarınız ({$amount}) indirim koduna dönüştürüldü. Kodunuz: {$coupon}"
                    : "{$code} numaralı {$tur} indirim kodunuz: {$coupon}")
                : ($amount
                    ? "{$code} numaralı {$tur} tutarınız işlendi. {$amount} iade yöntemine aktarıldı."
                    : "{$code} numaralı {$tur} talebiniz tamamlandı."),
            default => "{$code} numaralı {$tur} talebinizde güncelleme var.",
        };
    }

    private function smsConfig(ReturnRequest $r): array
    {
        $base = (array) config('returns.integrations.sms', []);
        // Tenant override (settings['returns_integrations']['sms'])
        $tenantCfg = $r->tenant?->settings['returns_integrations']['sms'] ?? [];

        return array_merge($base, is_array($tenantCfg) ? $tenantCfg : []);
    }

    private function netgsmFor(ReturnRequest $r): ?NetgsmService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $r->tenant_id)
            ->where('type', 'like', 'netgsm%')
            ->where('is_active', true)
            ->first();

        return $channel ? NetgsmService::fromChannel($channel) : null;
    }
}
