<?php

return [
    /**
     * Çark (Spin-to-Win) modülü VARSAYILANLARI.
     *
     * Kampanya bazlı değerler DB'de (wheel_campaigns.design / trigger_rules / form_fields)
     * saklanır; burası yeni kampanya oluştururken kullanılan başlangıç şablonu + güvenlik
     * sınırlarıdır. Kayıtlı bozuk/eksik veriye körü körüne güvenilmez (clamp).
     */

    // ── Çark tasarımı (görsel) varsayılanları ──
    // Renkler hazır şablonlardan türer (bkz frontend wheelTemplates.ts). Müşteri panelden
    // şablon seçer; aşağıdakiler şablon seçilmeden önceki güvenli başlangıçtır (Şenlik).
    'default_design' => [
        'template' => 'festive',
        'primary_color' => '#e11d48',
        'primary_2' => '#9f1239',
        'accent_color' => '#fbbf24',
        'text_color' => '#ffffff',
        'pointer_color' => '#111827',
        'logo_url' => null,
        'title' => 'Çark Çevir',
        'subtitle' => 'Merhaba, hemen çarkı çevirmeye ne dersin?',
        'button_label' => 'Çevir Kazan',
        'win_message' => 'Tebrikler! Kazandığın kod:',
        'lose_message' => 'Bu sefer olmadı, bir dahaki sefere!',
        'tab_position' => 'right', // kapatınca beliren kulakçık: left | right
        'tab_label' => 'Çark',
    ],

    // ── Tetikleme kuralları varsayılanları ──
    'default_trigger' => [
        'type' => 'delay',          // delay | exit_intent | manual
        'delay_seconds' => 6,        // araştırma (Sleeknote 2025): 6sn en yüksek dönüşüm (timer-led, scroll'dan %67 iyi)
        'device' => 'all',          // all | desktop | mobile
        // Görüp ÇEVİRMEYEN ziyaretçiye kaç günde bir tekrar göster (0 = sadece bir kez).
        // ÇEVİREN (kupon alan) ziyaretçi bu süreden bağımsız olarak BİR DAHA ASLA görmez.
        'frequency_days' => 7,
        'show_once_per_win' => true, // kazanan tekrar göremesin
    ],

    // ── Form alanları varsayılanları (hangi bilgiler toplanacak) ──
    'default_form' => [
        'collect_name' => true,
        'collect_email' => true,
        'collect_phone' => true,
        'require_name' => true,
        'require_email' => true,
        'require_phone' => false,
        // KVKK açık rıza (kişisel verilerin işlenmesi) — zorunlu olabilir.
        'kvkk_required' => true,
        'kvkk_text' => 'Kişisel verilerimin işlenmesine ilişkin Aydınlatma Metni’ni okudum, kabul ediyorum.',
        'kvkk_version' => 'v1',
        // Ticari elektronik ileti (SMS/e-posta/WhatsApp) izni — KVKK’dan AYRI. İleti gönderimi için
        // gerekli; çark yalnızca bu izin verilince çevrilebilir (zorunluysa).
        'comms_required' => true,
        'comms_text' => 'Kampanya, fırsat ve indirimlerden SMS, e-posta ve WhatsApp ile haberdar olmak istiyorum.',
    ],

    // ── Sayısal alanların güvenli sınırları (clamp) ──
    'limits' => [
        'delay_seconds' => ['min' => 0, 'max' => 120],
        'frequency_days' => ['min' => 0, 'max' => 365],
        'slices' => ['min' => 2, 'max' => 12],
        'weight' => ['min' => 0, 'max' => 100000],
        'discount_percent' => ['min' => 0, 'max' => 100],
        'coupon_valid_hours' => ['min' => 1, 'max' => 8760],
    ],

    // ── Kupon ──
    'coupon' => [
        // Üretim modu:
        //   display  → kod bizim tarafta üretilir, yalnızca ekranda gösterilir (MEVCUT)
        //   ticimax  → Ticimax HediyeCekiOlustur ile GERÇEK tek kullanımlık kupon (CANLI YAZMA)
        'provider' => env('WHEEL_COUPON_PROVIDER', 'display'),
        'dry_run' => env('WHEEL_COUPON_DRY_RUN', false), // true → ticimax'a yazmaz, payload'ı loglar
        'code_prefix' => 'CARK',
        // Kazanılan kuponun varsayılan geçerlilik süresi (aciliyet). Kampanya bazında
        // panelden değiştirilebilir (wheel_campaigns.coupon_valid_hours).
        'valid_hours' => 24,

        // ── Ticimax HediyeCekiOlustur eşlemesi ──
        'ticimax' => [
            // IndirimTipi (xs:int) — Ticimax konvansiyonu: 0 = Tutar (TL), 1 = Yüzde.
            // Smoke-test'te SelectHediyeCeki ile geri okunup doğrulanır.
            'indirim_tipi' => [
                'amount' => 0,   // discount_amount → TL tutar
                'percent' => 1,  // discount_percent → yüzde
            ],
            // Her kod tek kullanımlık: toplam kullanım hakkı ve üye başı limit.
            'usage_count' => 1,
            'member_max_usage' => 1,
            // Kupon hangi kanallarda geçerli olsun.
            'web_active' => true,
            'mobile_active' => true,
            'android_active' => true,
            'ios_active' => true,
            // Çark kuponlarını panelde gruplamak için ön ek (GrupAdi).
            'grup_adi' => 'Çark Kampanyası',
            // Anlık oluşturma başarısız olursa kaç kez arka planda yeniden denensin.
            'retry_attempts' => 5,
        ],
    ],

    // ── Kazı Kazan (A/B ikinci oyun) varsayılanları ──
    // Aynı kampanyada ziyaretçilerin bir yüzdesine çark yerine "Sana Özel" kazı kazan kartı
    // gösterilir. Teklifler (dilimler) aynıdır; fark: KISA süreli kupon (dakika) + sayaç.
    // Kampanya bazlı değerler wheel_campaigns.settings içinde (ab_scratch_percent, scratch_*).
    // Oyun Kampanyaları: her kampanya tek oyun (game_type wheel|scratch). Çark kampanyası
    // settings.ab_partner_campaign_id + ab_percent ile bir kazı kazan kampanyasını A/B eşi yapar.
    'scratch' => [
        'valid_minutes' => 30,          // kazı kazan kuponu geçerlilik (dakika)
        'code_prefix' => 'KAZI',        // kod ön eki (çark CARK-xxxxx, kazı kazan KAZI-xxxxx → raporda ayrışır)
        // Yeni kazı kazan kampanyası oluşturulurken design varsayılan metinleri
        'default_design' => [
            'title' => 'Sana Özel Kazı Kazan',
            'subtitle' => 'Kartı kazı, sana özel indirimi hemen kullan.',
            'button_label' => 'Kartımı Aç',
            'tab_label' => 'Sana Özel Hediye',
            'win_message' => 'Sana özel kuponun hazır!',
        ],
        'reminder_minutes_before' => 10, // bitmeden N dk önce SMS hatırlatma (kullanılmamışsa)
        // true → kazı kazanda FORM YOK: kart açılır açılmaz herkes kazır (lead toplanmaz, KVKK
        // onayı istenmez; kişisel veri alınmadığı için gerekmez). Hile kilidi: parmak izi + IP (24s).
        'skip_form' => true,
        'ip_dedup_hours' => 24,
    ],
    'limits_scratch' => [
        'ab_percent' => ['min' => 0, 'max' => 100],
        'valid_minutes' => ['min' => 5, 'max' => 1440],
    ],

    // ── Hile önleme ──
    'abuse' => [
        // Aynı kişi bir kampanyada tek kez çevirebilir; eşleştirme anahtarları:
        'dedup_by' => ['email', 'phone', 'fingerprint'],
    ],
];
