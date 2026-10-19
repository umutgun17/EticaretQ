<?php

namespace App\Services\Marketing;

use App\Enums\WheelCouponStatus;
use App\Models\MarketingEmailTemplate;
use App\Models\MarketingMessage;
use App\Models\Order;
use App\Models\Tenant;
use App\Models\WheelSpin;
use Illuminate\Support\Carbon;

/**
 * Çark Entegrasyonu otomasyonu — kazanılmış ama kullanılmamış kuponlar için
 * SON HATIRLATMA SMS'i (varsayılan: bitimine 3 saat kala).
 *
 * KRİTİK GÜVENLİK: yalnızca coupon_status=Issued (kullanılmamış) VE müşteri
 * SİPARİŞ VERMEMİŞ olan kuponlara gönderilir. Kupon koduyla sipariş açılmışsa
 * ya da müşteri (e-posta) yeni sipariş vermişse → gönderilmez (yanlış kişiye SMS yok).
 *
 * Gönderim saat aralığı + frekans limiti UnifiedSender kapısında uygulanır; pencere
 * dışıysa bu çalışmada GÖNDERMEZ ve işaretlemez → sonraki çalışmada (kupon hâlâ
 * geçerliyse) tekrar dener. Gece yarısında SMS atılmaz.
 */
class WheelCouponReminder
{
    public const KEY = 'wheel_coupon';

    public function __construct(protected UnifiedSender $sender) {}

    protected function settings(int $tenantId): array
    {
        return Tenant::withoutGlobalScopes()->find($tenantId)?->settings ?? [];
    }

    public function isEnabled(int $tenantId): bool
    {
        return ! empty($this->settings($tenantId)['wheel_reminder_enabled']);
    }

    public function hoursBefore(int $tenantId): int
    {
        return max(1, (int) ($this->settings($tenantId)['wheel_reminder_hours_before'] ?? 3));
    }

    /**
     * Hatırlatma için son tarama anı (TR). Normalde now + hoursBefore. ANCAK gönderim
     * penceresi bu süre içinde KAPANIYORSA (gece sessiz saat), bir sonraki açılışa kadar
     * dolacak kuponları da kapsar → kişiye gece yerine AKŞAMDAN (6-10 saat kala) SMS gider,
     * kupon süresi gece dolup hatırlatmasız kalmaz.
     */
    protected function lookaheadDeadline(int $tenantId, int $hours): Carbon
    {
        $normal = now()->addHours($hours);
        $s = $this->settings($tenantId);

        // Pencere kapalıysa (şu an gece) normal kalsın — gate zaten gönderimi erteler.
        if (! SendWindow::isOpen($s)) {
            return $normal;
        }

        // Pencere bu lookahead içinde kapanıyorsa → bir sonraki açılışa kadarki bitişleri de al.
        $close = SendWindow::nextClose($s);
        if ($close && $close->lessThanOrEqualTo($normal)) {
            $reopen = SendWindow::nextOpenAfter($s, $close);

            return $reopen->greaterThan($normal) ? $reopen : $normal;
        }

        return $normal;
    }

    protected function optOutUrl(int $tenantId): string
    {
        return trim((string) ($this->settings($tenantId)['sms_opt_out_url'] ?? ''));
    }

    /**
     * @return array{eligible:int,sent:int,skipped:int,ordered:int,deferred:int,simulated:bool,attributed:int,revenue:float}
     */
    public function run(int $tenantId, bool $live = false, int $limit = 200): array
    {
        // Önce: daha önce SMS attığımız hatırlatmaların satışa dönüşünü ölç (SMS göndermez).
        $attr = $this->attribute($tenantId);

        $simulate = ! ($live && $this->isEnabled($tenantId));
        $hours = $this->hoursBefore($tenantId);
        $deadline = $this->lookaheadDeadline($tenantId, $hours);

        $spins = WheelSpin::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('coupon_status', WheelCouponStatus::Issued)   // kullanılmamış
            ->where('is_test', false)
            ->whereNotNull('coupon_code')
            ->whereNotNull('coupon_expires_at')
            ->where('coupon_expires_at', '>', now())               // henüz dolmamış
            ->where('coupon_expires_at', '<=', $deadline)          // son N saat (gece-akıllı genişler)
            ->where('variant', '!=', 'scratch')                     // kazı kazan (30 dk) → runScratch() dakika bazlı
            ->whereRaw("(metadata->>'coupon_reminder_sent_at') is null")
            ->with('lead')
            ->orderBy('coupon_expires_at')                          // önce en yakın bitenler
            ->limit($limit)
            ->get();

        $sent = 0; $skipped = 0; $ordered = 0; $deferred = 0;

        foreach ($spins as $spin) {
            $lead = $spin->lead;
            $phone = trim((string) ($lead->phone ?? ''));

            // Telefon yoksa hatırlatma yapılamaz → işaretle, bir daha bakma
            if ($phone === '') {
                $this->mark($spin, 'no_phone');
                $skipped++;
                continue;
            }

            // GÜVENLİK: sipariş verdiyse / kuponu kullandıysa → gönderme
            if ($this->hasOrdered($tenantId, $spin, $lead)) {
                $this->mark($spin, 'ordered');
                $ordered++;
                continue;
            }

            if ($simulate) { $skipped++; continue; }

            // WhatsApp kanalı (ayarla açılır): Meta onaylı template ile gönder;
            // terminal hata olursa SMS'e düş (skipped/pencere ise ertele, SMS deneme).
            $waSent = false;
            if ($this->whatsappEnabled($tenantId)) {
                $waLog = $this->sender->send($tenantId, 'whatsapp', $phone, $this->buildWhatsApp($tenantId, $spin), [
                    'source' => self::KEY,
                    'source_type' => 'automation',
                ]);
                if ($waLog->status === 'sent') {
                    $this->mark($spin, 'sent', $waLog->id);
                    $sent++;
                    $waSent = true;
                } elseif ($waLog->status !== 'failed') {
                    // quiet_hours / frequency_cap → işaretleme, sonraki çalışmada tekrar
                    $deferred++;
                    continue;
                }
                // failed → aşağıda SMS fallback dener
            }
            if ($waSent) { continue; }

            $message = $this->buildSms($tenantId, $spin, $lead);
            $log = $this->sender->send($tenantId, 'sms', $phone, $message, [
                'source' => self::KEY,
                'source_type' => 'automation',
            ]);

            if ($log->status === 'sent' || $log->status === 'failed') {
                // terminal: işaretle (sent → tek sefer; failed → tekrar deneme)
                $this->mark($spin, $log->status, $log->id);
                $log->status === 'sent' ? $sent++ : $skipped++;
            } else {
                // skipped (quiet_hours / frequency_cap) → İŞARETLEME, sonraki çalışmada tekrar dene
                $deferred++;
            }
        }

        return [
            'eligible' => $spins->count(),
            'sent' => $sent, 'skipped' => $skipped, 'ordered' => $ordered, 'deferred' => $deferred,
            'simulated' => $simulate,
            'attributed' => $attr['converted'], 'revenue' => $attr['revenue'],
        ];
    }

    /**
     * KAZI KAZAN (30 dk kupon) hatırlatması: bitmeden N dakika önce (config
     * wheel.scratch.reminder_minutes_before) kullanılmamış kuponlara SMS. Çark akışından
     * ayrı çünkü (1) saat bazlı pencere 30 dk kuponu daha kazınırken yakalardı, (2) Meta
     * WhatsApp şablonu "kalan saat" parametreli → dakika yazılamaz; burada yalnız SMS.
     * Aynı kill-switch (wheel_reminder_enabled) + aynı işaretleme (coupon_reminder_sent_at).
     *
     * @return array{eligible:int,sent:int,skipped:int,ordered:int,deferred:int,simulated:bool}
     */
    public function runScratch(int $tenantId, bool $live = false, int $limit = 200): array
    {
        $simulate = ! ($live && $this->isEnabled($tenantId));
        $minutes = max(3, (int) config('wheel.scratch.reminder_minutes_before', 10));

        $spins = WheelSpin::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('variant', 'scratch')
            ->where('coupon_status', WheelCouponStatus::Issued)
            ->where('is_test', false)
            ->whereNotNull('coupon_code')
            ->whereNotNull('coupon_expires_at')
            ->where('coupon_expires_at', '>', now()->addMinutes(2))          // en az 2 dk kalsın (SMS yolda bitmesin)
            ->where('coupon_expires_at', '<=', now()->addMinutes($minutes))  // son N dakika
            ->whereRaw("(metadata->>'coupon_reminder_sent_at') is null")
            ->with('lead')
            ->orderBy('coupon_expires_at')
            ->limit($limit)
            ->get();

        $sent = 0; $skipped = 0; $ordered = 0; $deferred = 0;

        foreach ($spins as $spin) {
            $lead = $spin->lead;
            $phone = trim((string) ($lead->phone ?? ''));
            if ($phone === '') {
                $this->mark($spin, 'no_phone');
                $skipped++;
                continue;
            }
            if ($this->hasOrdered($tenantId, $spin, $lead)) {
                $this->mark($spin, 'ordered');
                $ordered++;
                continue;
            }
            if ($simulate) { $skipped++; continue; }

            $log = $this->sender->send($tenantId, 'sms', $phone, $this->buildScratchSms($tenantId, $spin), [
                'source' => self::KEY,
                'source_type' => 'automation',
            ]);
            if ($log->status === 'sent' || $log->status === 'failed') {
                $this->mark($spin, $log->status, $log->id);
                $log->status === 'sent' ? $sent++ : $skipped++;
            } else {
                $deferred++; // quiet_hours / frequency_cap → bir sonraki dakikada tekrar (pencere içindeyse)
            }
        }

        return [
            'eligible' => $spins->count(),
            'sent' => $sent, 'skipped' => $skipped, 'ordered' => $ordered, 'deferred' => $deferred,
            'simulated' => $simulate,
        ];
    }

    /** Kazı kazan SMS metni: dakika bazlı aciliyet. @return array<string,mixed> */
    public function buildScratchSms(int $tenantId, WheelSpin $spin): array
    {
        $s = $this->settings($tenantId);
        $url = (string) ($s['shop_url'] ?? $s['cart_url'] ?? '');
        $remaining = max(1, (int) ceil(now()->diffInSeconds($spin->coupon_expires_at, false) / 60));
        $code = (string) $spin->coupon_code;
        $prize = trim((string) ($spin->prize_label ?? ''));

        $text = 'Sana ozel' . ($prize !== '' ? " {$prize}" : ' indirim')
            . " kuponunun son {$remaining} dakikasi! Hemen kullan:"
            . ($url !== '' ? " {$url}" : '')
            . " Kod: {$code}";

        $optOut = $this->optOutUrl($tenantId);
        if ($optOut !== '' && stripos($text, $optOut) === false) {
            $text = rtrim($text) . " Red: {$optOut}";
        }

        return ['body' => $text, 'header' => $s['sms_header'] ?? null];
    }

    /**
     * Gönderilmiş hatırlatmaların SATIŞA dönüşünü ölçer (attribution).
     *
     * DÖNÜŞÜM TANIMI (kullanıcı kararı 2026-07-02): SMS'ten SONRA **o kupon KODUYLA**
     * verilmiş ödenmiş/ilerlemiş sipariş. Kodu kullanmadan verilen sipariş (aynı kişi
     * e-postayla eşleşse bile) bu otomasyonun başarısı SAYILMAZ — kupon zaten en fazla
     * 24 saat geçerli; kod kullanılmadıysa satış SMS'e bağlanamaz.
     *
     * Bulunan ciro ilgili marketing_messages kaydına (revenue + converted_at) ve spin
     * metadata'sına işlenir. Yalnızca okuma + loglama (SMS GÖNDERMEZ) → her çalışmada güvenli.
     *
     * Pencere: son N gün içinde SMS atılmış, henüz dönüşmemiş hatırlatmaların TAMAMI taranır.
     * (Eski hali sırasız `limit(500)` idi: bekleyenler 500'ü aşınca hep aynı eski kayıtlar
     * taranıyor, yeni SMS'lerin dönüşümü HİÇ yazılmıyordu → panelde dönüşüm/ciro eksikti.)
     *
     * @return array{checked:int,converted:int,revenue:float}
     */
    public function attribute(int $tenantId, int $windowDays = 30): array
    {
        // metadata'daki sent_at ISO-8601 UTC (+00:00) yazılıyor → lexicographic >= güvenli.
        $sinceIso = now()->subDays($windowDays)->toIso8601String();

        $checked = 0;
        $converted = 0;
        $revenue = 0.0;

        WheelSpin::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereRaw("(metadata->>'coupon_reminder_reason') = 'sent'")
            ->whereRaw("(metadata->>'coupon_reminder_converted_at') is null")
            ->whereRaw("(metadata->>'coupon_reminder_sent_at') >= ?", [$sinceIso])
            ->whereNotNull('coupon_code')
            ->with('lead')
            ->chunkById(200, function ($spins) use ($tenantId, &$checked, &$converted, &$revenue) {
                $checked += $spins->count();

                // Chunk başına TEK TOPLU sorgu (kupon kodlarıyla whereIn — indeksli);
                // spin başına sorgu YOK.
                $prep = []; // spin_id => [code, sent_tr]
                foreach ($spins as $spin) {
                    $meta = $spin->metadata ?? [];
                    $sentAt = isset($meta['coupon_reminder_sent_at'])
                        ? Carbon::parse($meta['coupon_reminder_sent_at'])
                        : ($spin->created_at ?? now()->subDays(7));
                    $prep[$spin->id] = [
                        'code' => (string) $spin->coupon_code,
                        // orders.order_date Ticimax'tan TR YEREL saat gelir (UTC değil) —
                        // eşiği İstanbul'a çevirmeden karşılaştırmak 3 saat kaydırıyordu.
                        'sent_tr' => $sentAt->copy()->setTimezone('Europe/Istanbul')->format('Y-m-d H:i:s'),
                    ];
                }

                $codes = array_values(array_filter(array_column($prep, 'code')));
                $minSent = min(array_column($prep, 'sent_tr'));

                $paidish = function ($w) {
                    $w->where('status', '>', 0)->orWhere('payment_status', 1)->orWhere('paid_amount', '>', 0);
                };

                $byCode = empty($codes) ? collect() : Order::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereIn('coupon_code', $codes)
                    ->where('order_date', '>=', $minSent)
                    ->where($paidish)
                    ->orderBy('order_date')
                    ->get()
                    ->groupBy(fn ($o) => (string) $o->coupon_code);

                foreach ($spins as $spin) {
                    $p = $prep[$spin->id];
                    // Sipariş bu spin'in SMS'inden sonra mı? (ikisi de TR yerel 'Y-m-d H:i:s')
                    $after = fn ($o) => $o->order_date && $o->order_date->format('Y-m-d H:i:s') >= $p['sent_tr'];

                    // YALNIZ kuponlu sipariş sayılır (en son tarihli). Kupon kullanılmadan
                    // verilen sipariş bu otomasyonun başarısı değildir.
                    $order = $byCode->get($p['code'], collect())->filter($after)->last();

                    if (! $order) {
                        continue;
                    }

                    $rev = (float) ($order->paid_amount ?: $order->total_amount);

                    // İlgili SMS log kaydına ciro/dönüşüm yaz (panel & analitik buradan okur)
                    $meta = $spin->metadata ?? [];
                    $msgId = $meta['coupon_reminder_message_id'] ?? null;
                    if ($msgId) {
                        MarketingMessage::withoutGlobalScopes()
                            ->where('id', $msgId)->where('tenant_id', $tenantId)
                            ->update(['revenue' => $rev, 'converted_at' => now()]);
                    }

                    $meta['coupon_reminder_converted_at'] = now()->toIso8601String();
                    $meta['coupon_reminder_order_id'] = $order->id;
                    $meta['coupon_reminder_revenue'] = $rev;
                    $meta['coupon_reminder_coupon_used'] = true;
                    $spin->update(['metadata' => $meta]);

                    $converted++;
                    $revenue += $rev;
                }
            });

        return ['checked' => $checked, 'converted' => $converted, 'revenue' => round($revenue, 2)];
    }

    protected function mark(WheelSpin $spin, string $reason, ?int $messageId = null): void
    {
        $meta = $spin->metadata ?? [];
        $meta['coupon_reminder_sent_at'] = now()->toIso8601String();
        $meta['coupon_reminder_reason'] = $reason;
        if ($messageId) {
            $meta['coupon_reminder_message_id'] = $messageId;
        }
        $spin->update(['metadata' => $meta]);
    }

    /** Kupon kullanıldı / sipariş verildi mi? (yanlış kişiye SMS engeli) */
    protected function hasOrdered(int $tenantId, WheelSpin $spin, $lead): bool
    {
        $code = (string) $spin->coupon_code;
        $email = trim((string) ($lead->email ?? ''));
        $since = $spin->created_at ?? now()->subDays(7);

        return Order::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('order_date', '>=', $since)
            ->where(function ($w) {
                $w->where('status', '>', 0)->orWhere('payment_status', 1)->orWhere('paid_amount', '>', 0);
            })
            ->where(function ($w) use ($code, $email) {
                $w->where('coupon_code', $code);          // kuponu kullandı
                if ($email !== '') {
                    $w->orWhere('customer_email', $email); // ya da yeni sipariş verdi
                }
            })
            ->exists();
    }

    /** @return array<string,mixed> */
    public function buildSms(int $tenantId, WheelSpin $spin, $lead): array
    {
        $s = $this->settings($tenantId);
        $shop = (string) (Tenant::withoutGlobalScopes()->find($tenantId)?->name ?? '');
        // Çark kuponunda sepet boştur → anasayfa (shop_url) önceliklidir, kişi gezip
        // sepete eklesin ve kodu ödemede girsin. shop_url yoksa cart_url'e düşer.
        $url = (string) ($s['shop_url'] ?? $s['cart_url'] ?? '');
        $remaining = max(1, (int) ceil(now()->diffInMinutes($spin->coupon_expires_at) / 60));
        $code = (string) $spin->coupon_code;
        $prize = trim((string) ($spin->prize_label ?? ''));

        $vars = [
            'shop_name' => $shop,
            'coupon_code' => $code,
            'prize' => $prize,
            'hours' => (string) $remaining,
            'url' => $url,
        ];

        $tpl = trim((string) ($s['wheel_reminder_sms_template'] ?? ''));
        if ($tpl !== '') {
            $text = MarketingEmailTemplate::interpolate($tpl, $vars);
        } else {
            $text = 'Carkta kazandiginiz'
                . ($prize !== '' ? " {$prize}" : '')
                . " kuponun son {$remaining} saati! Hemen alisverise basla:"
                . ($url !== '' ? " {$url}" : '')
                . " Kod: {$code}";
        }

        // İYS/ret hakkı: SMS sonuna red linki eklenir (yoksa atlanır, varsa tekrar etmez).
        $optOut = $this->optOutUrl($tenantId);
        if ($optOut !== '' && stripos($text, $optOut) === false) {
            $text = rtrim($text) . " Red: {$optOut}";
        }

        return ['body' => $text, 'header' => $s['sms_header'] ?? null];
    }

    /** WhatsApp kanalı panel ayarıyla açılır (varsayılan kapalı → mevcut SMS akışı değişmez). */
    protected function whatsappEnabled(int $tenantId): bool
    {
        return (bool) ($this->settings($tenantId)['wheel_reminder_whatsapp'] ?? false);
    }

    /**
     * Meta onaylı 'cark_kupon_hatirlatma' şablonu için mesaj payload'u.
     * Param sırası onaylı şablonla birebir (teslimat testiyle doğrulandı 2026-07-09):
     * {{1}}=ödül, {{2}}=kalan saat, {{3}}=kupon kodu.
     */
    protected function buildWhatsApp(int $tenantId, WheelSpin $spin): array
    {
        $s = $this->settings($tenantId);
        $remaining = max(1, (int) ceil(now()->diffInMinutes($spin->coupon_expires_at) / 60));
        $prize = trim((string) ($spin->prize_label ?? ''));
        $code = (string) $spin->coupon_code;

        return [
            'template' => [
                'name' => (string) ($s['wheel_reminder_whatsapp_template_name'] ?? 'cark_kupon_hatirlatma'),
                'lang' => 'tr',
                'params' => [
                    $prize !== '' ? $prize : 'indirim',   // boş param Meta'da reddedilir
                    (string) $remaining,
                    $code,
                ],
            ],
            // Log/önizleme için düz metin karşılığı
            'body' => "Carkta kazandiginiz {$prize} kuponun son {$remaining} saati! Kod: {$code}",
        ];
    }
}
