<?php

return [
    /**
     * Tenant başına iptal/iade kuralları için VARSAYILAN şema.
     * Gerçek değerler tenant.settings['returns'] altında saklanır ve
     * ReturnRulesService::forTenant() ile bu varsayılanlarla birleştirilip
     * güvenli aralıklara sabitlenir (clamp). Böylece kayıtlı kötü/eksik veriye
     * körü körüne güvenilmez.
     */
    'default_rules' => [
        'enabled' => true,

        // ── İade penceresi ──
        'return_enabled' => true,
        // ⚠ SİPARİŞ tarihinden itibaren kaç gün (teslim tarihinden DEĞİL). İade modülünde
        // siparişin teslim tarihi alanı yok (Sürat'ın TeslimTarihi'si yalnızca İADE gönderisine ait),
        // bu yüzden pencere daima order_date bazlı. Eski 'window_basis' ayarı kaldırıldı (2026-08-01).
        'return_window_days' => 30,

        // ── İptal ──
        'cancel_enabled' => true,
        'cancel_block_if_shipped' => true, // kargoya verildiyse iptal edilemez

        /**
         * Sipariş DURUM kodlarına göre uygunluk (Ticimax Durum kodu).
         * fail-closed: bu listelerde olmayan statüde işlem YAPILAMAZ.
         * TB taksonomisi: 0 Alındı, 3 Ödeme Bekliyor, 4 Paketleniyor, 5 Tedarik,
         *   6 Kargoya Verildi, 7 Teslim Edildi, 8 İptal, 9 İade, 11+ iade/iptal süreçleri.
         */
        'cancellable_statuses' => [0, 3, 4, 5],  // kargoya verilmeden önce
        'returnable_statuses' => [7],            // yalnızca teslim edilmiş siparişler
        // KARGODAKİ siparişte iade (2026-10-10, t1 talebi): Ticimax'ta 'Teslim Edildi' statüsü
        // geç güncellendiği için ürünü almış müşteri iade açamıyordu. Açıkken durum 6 (Kargoya
        // Verildi) de iadeye açılır. KAPIDA ÖDEMEDE açılmaz (teslim/tahsilat teyidi yok).
        'return_in_transit' => false,

        // ── Kargo ──
        'refund_shipping' => false,                // İADE/KUSUR'da kargo ücreti iade tutarına dahil mi (yalnızca tam iadede)
        // İPTAL'de kargo ücreti DAİMA iade edilir (kullanıcı kararı 2026-08-03): sipariş hiç
        // kargoya verilmediği için kargo hizmeti verilmemiştir → müşteriden kesilmesi yanlış.
        // Normal iadede kural değişmedi (yukarıdaki refund_shipping geçerli).
        'refund_shipping_cancel' => true,

        // ── Vade farkı (taksit komisyonu) ──
        // iyzico taksitli ödemede vade farkını Ticimax kalem tutarlarının ÜSTÜNE ekler
        // (ödeme detayında paidPrice > price) ve iade edilmedikçe "kalan bakiye" olarak tutar —
        // "ödeme kuruluşu otomatik düşer" eski varsayımı YANLIŞTI (2026-08-11 tespiti; #118/#92/#201
        // taleplerinde toplam 231,13 TL iyzico'da kalmıştı). Bu kural açıkken TAM iade/iptalde
        // vade farkı (paidPrice − price − kargo) iade tutarına eklenir; müşteri ödediğinin
        // tamamını alır. PayTR'de vade satır fiyatlarına gömülü geldiği için ek gerekmez.
        'refund_installment_fee' => true,

        // ── Sepet kampanyası telafisi ──
        // "2. ürüne sepette ekstra indirim" tipi kampanyalarda, KAMPANYASIZ (baz) ürün iade
        // edilirse kampanya şartı bozulur: kalan en pahalı kampanyalı ürünün indirimi geri
        // alınır ve iade tutarından düşülür (Ticimax kalem KampanyaIndirimTutari'ndan tespit).
        // Varsayılan KAPALI — yalnızca bu tarz kampanyası olan tenant'larda açılır (t1 açık).
        'campaign_discount_recovery' => false,

        // ── Hariç tutma ──
        'excluded_categories' => [],
        'excluded_skus' => [],

        // ── İade yöntemi ──
        'allow_store_credit' => true,
        'allow_original_refund' => true,
        'promote_store_credit' => true,    // müşteriyi indirim koduna yönlendir

        // ── Kullanım sonrası kusur bildirimi ──
        // İade penceresi DOLDUKTAN sonra müşteri kusur bildirebilir; kargo kodu YOK, önce
        // YÖNETİCİ (admin) onay/red kararı verir. Onayda Sürat kodu + SMS, normal iade akışına bağlanır.
        'defect_enabled' => false,
        'defect_max_days' => 365,          // sipariş tarihinden itibaren en geç (0 = sınırsız)
        'defect_reject_reasons' => [       // yönetici red ekranındaki seçenekler (tenant panelden düzenler)
            'Kullanım kaynaklı aşınma/yıpranma tespit edildi',
            'Üretim kusuru tespit edilemedi',
            'Fotoğraflar değerlendirme için yetersiz',
            'Ürün garanti/değerlendirme kapsamı dışında',
        ],

        // ── Kargo kodu geçerlilik süresi ──
        // Müşteri iade kargo kodunu bu sürede kullanmazsa returns:expire-shipments
        // sağlayıcı kaydını siler (Sürat GonderiSil / DHL cancelorder) ve talebi kapatır.
        // Tenant panelden değiştirebilir (İade Ayarları). 7→14 gün: kullanıcı kararı 2026-08-11.
        'shipment_expire_days' => 14,

        // ── Genel kısıtlar ──
        'min_items' => 1,
        'require_condition_declaration' => true,
        'block_if_open_request_exists' => true, // aynı sipariş için açık talep varken yeni talep engeli

        // ── Onay zamanlayıcı ──
        // Depo (personel) onayı: iade depoya ulaştığında (received_at) 2 günden (48 saat) geri sayar.
        'staff_review_hours' => 48,
        // Yönetici para onayı: personel onayından (staff_approved_at) itibaren 2 gün (48 saat).
        'manager_review_hours' => 48,
    ],

    /**
     * Sayısal alanların güvenli sınırları (clamp).
     */
    'limits' => [
        'return_window_days' => ['min' => 0, 'max' => 365],
        'defect_max_days' => ['min' => 0, 'max' => 1095],
        'staff_review_hours' => ['min' => 1, 'max' => 168],
        'manager_review_hours' => ['min' => 1, 'max' => 720],
        'min_items' => ['min' => 1, 'max' => 100],
        'shipment_expire_days' => ['min' => 1, 'max' => 60],
    ],

    /**
     * KAPIDA ÖDEME (COD) — Ticimax `OdemeTipi` kodları.
     * 2 = kapıda nakit, 3 = kapıda kredi kartı (canlı doğrulama 2026-09-01). Kapıda ödeme
     * hizmet bedeli (`KapidaOdemeTutari > 0`) zaten tek başına yeterli ayraçtır; bu liste
     * hizmet bedeli 0 olan kurulumlar için ikinci ayraçtır. {@see CodDetector}
     */
    'cod_odeme_tipleri' => [2, 3],

    /**
     * Faz 2 — Dış entegrasyonlar (Sürat Kargo iade kodu + NetGSM SMS).
     *
     * ⛔ CANLI ORTAM KURALI: ilk denemeler DRY-RUN'dır → payload loglanır, dış servise
     * İSTEK GÖNDERİLMEZ. Kullanıcı onayıyla (ve gerçek kimlik/doküman girilince) canlıya alınır.
     * Tenant bazında da `tenant.settings['returns']['integrations']` ile override edilebilir.
     */
    'integrations' => [
        'sms' => [
            'enabled' => env('RETURNS_SMS_ENABLED', false),
            'dry_run' => env('RETURNS_SMS_DRY_RUN', true),   // true: SMS gönderme, sadece logla
            // Onaylı gönderici başlığı (NetGSM msgheader) — kullanıcıdan alınacak.
            'msgheader' => env('RETURNS_SMS_MSGHEADER', null),
        ],
        'surat_kargo' => [
            'enabled' => env('RETURNS_SURAT_ENABLED', false),
            'dry_run' => env('RETURNS_SURAT_DRY_RUN', true),  // true: gönderi oluşturma, sadece logla
            // Takip (WebSiparis... servisi) Sürat WEB SERVİSİ şifresi — gönderi/API şifresinden FARKLI
            // olabilir; boşsa API şifresine düşer. (powerspeed ayrı `kargoSuratWebPassword` kullanıyor.)
            'web_password' => env('RETURNS_SURAT_WEB_PASSWORD', null),
            // Gönderi paketleme: KargoTuru 3=KOLİ (kutu/paket), BirimDesi/BirimKg (varsayılan 1;
            // KOLİ'de ikisi de sıfırdan büyük olmalı — Sürat Response 006). Kg boşsa desi kullanılır.
            'kargo_turu' => (int) env('RETURNS_SURAT_KARGO_TURU', 3),
            'desi' => (float) env('RETURNS_SURAT_DESI', 1),
            'kg' => (float) env('RETURNS_SURAT_KG', env('RETURNS_SURAT_DESI', 1)),
            // Gönderi oluşturmada TAŞIMA hatası (SoapFault/timeout) için deneme sayısı. 6-7 Eylül
            // 2026 olayı: Sürat aralıklı "Internal Server Error" verdi, tek deneme yapıldığı için
            // 5 talep kalıcı kodsuz kaldı. Denemeler arası 1.5s→3s; her denemeden önce kodun
            // Sürat'ta kaydı sorulur (mükerrer gönderi açılmaz). 1 = yeniden deneme kapalı.
            'send_attempts' => (int) env('RETURNS_SURAT_SEND_ATTEMPTS', 3),
            // Otomatik takip (returns:track-shipments): SozlesmeyeGoreKargoTakip — iade
            // (Iademi=true) gönderilerini gören tek metot (2026-07-20'de canlıda doğrulandı;
            // eski WebSiparisKodundanKargoTeslimatBilgisi iade gönderilerini bulamıyor).
            // İade kodu geçerlilik süresi (gün) — YALNIZCA tenant kuralı okunamadığında
            // fallback; asıl kaynak default_rules.shipment_expire_days (tenant panelden ayarlar).
            'expire_days' => (int) env('RETURNS_SURAT_EXPIRE_DAYS', 14),
            // Merchant (iade adresi) — Sürat gönderisinde alıcı bilgisi olarak kullanılır.
            'merchant' => [
                'name' => env('RETURNS_SURAT_MERCHANT_NAME', null),
                'phone' => env('RETURNS_SURAT_MERCHANT_PHONE', null),
                'address' => env('RETURNS_SURAT_MERCHANT_ADDRESS', null),
                'city' => env('RETURNS_SURAT_MERCHANT_CITY', null),
                'district' => env('RETURNS_SURAT_MERCHANT_DISTRICT', null),
            ],
        ],

        /**
         * DHL Kargo (eski MNG Kargo — Mayıs 2025'ten beri "DHL eCommerce") — Boise Atelier (tenant 13)
         * ve DHL/MNG ile çalışan diğer tenant'lar için iade gönderisi. REST API (MNG apizone).
         *
         * Sağlayıcı seçimi tenant ayarındadır: settings['returns_integrations']['cargo_provider']
         * = 'dhl-kargo' (yoksa 'surat-kargo' varsayılır — CargoProviderFactory).
         * Kimlikler (client_id/client_secret + customer_number/password) config'e GÖMÜLMEZ;
         * tenant ayarından (returns_integrations.dhl_kargo.*) gelir.
         *
         * ⛔ dry_run=true iken DHL/MNG'ye HTTP isteği atılmaz; payload loglanır.
         */
        'dhl_kargo' => [
            'enabled' => env('RETURNS_DHL_ENABLED', false),
            'dry_run' => env('RETURNS_DHL_DRY_RUN', true),
            // test_mode=true → testapi.mngkargo.com.tr (sandbox kimlikleri ayrıdır).
            'test_mode' => (bool) env('RETURNS_DHL_TEST_MODE', false),
            // Paketleme/ölçü: packagingType 1=Dosya 2=Mini 3=Paket 4=Koli; desi/kg tam sayı, en az 1.
            'packaging_type' => (int) env('RETURNS_DHL_PACKAGING_TYPE', 3),
            'desi' => (float) env('RETURNS_DHL_DESI', 1),
            'kg' => (float) env('RETURNS_DHL_KG', env('RETURNS_DHL_DESI', 1)),
            // paymentType 2 = Alıcı Ödemeli (merchant öder → müşteri şubeden ücretsiz gönderir).
            'payment_type' => (int) env('RETURNS_DHL_PAYMENT_TYPE', 2),
            // deliveryType 1 = Adrese Teslim (varış: cari hesabın kayıtlı iade adresi).
            'delivery_type' => (int) env('RETURNS_DHL_DELIVERY_TYPE', 1),
            // İade kodu geçerlilik süresi (gün) — fallback; asıl kaynak default_rules.shipment_expire_days.
            'expire_days' => (int) env('RETURNS_DHL_EXPIRE_DAYS', 14),
        ],

        /**
         * Nebim V3 ERP — iptal/iade belgesi (ModelType 34). Faz 5.
         *
         * ⛔ dry_run=true iken canlı ERP'ye POST YAPILMAZ (para/muhasebe kritik); payload loglanır.
         * Okuma (usp_OrderDetail / RunProc) her zaman serbesttir. Parametresiz Connect TBSQL/TonnyBlack
         * (TB01) context'ine düştüğü için ayrı kimlik/şirket parametresi gerekmez.
         */
        'nebim' => [
            'enabled' => env('RETURNS_NEBIM_ENABLED', false),
            'dry_run' => env('RETURNS_NEBIM_DRY_RUN', true),    // true: ModelType 34 POST etme, sadece logla
            // Müşteri ERP adresi/DB'si koda gömülmez (.env veya tenant kanal
            // ayarı); boşken NebimService kullanılamaz sayılır — yanlış
            // şirketin ERP'sine belge yazmaktan iyidir.
            'base_host' => env('RETURNS_NEBIM_HOST'),
            'port_read' => (int) env('RETURNS_NEBIM_PORT_READ', 34555),   // Connect + RunProc (okuma)
            'port_write' => (int) env('RETURNS_NEBIM_PORT_WRITE', 34554),  // POST (ModelType 34 yazma)
            'database' => env('RETURNS_NEBIM_DB'),
            'proc_order_detail' => env('RETURNS_NEBIM_PROC', 'usp_OrderDetail'),
            'cancel_reason_code' => env('RETURNS_NEBIM_REASON', 'N02'),
        ],

        /**
         * Ticimax — sipariş durumu yazma (iptal akışı, Faz 5). `SetSiparisDurum` ile statü "Iptal".
         *
         * ⛔ dry_run=true iken canlı siparişe YAZILMAZ; payload loglanır. Statü değişikliği geri
         * alınabilir ama notify_customer=true ise Ticimax müşteriye mail atar → varsayılan kapalı
         * (kendi SMS bildirimimiz ReturnNotifier ile yönetilir).
         */
        'ticimax' => [
            'enabled' => env('RETURNS_TICIMAX_WRITE_ENABLED', false),
            'dry_run' => env('RETURNS_TICIMAX_WRITE_DRY_RUN', true),
            'notify_customer' => env('RETURNS_TICIMAX_NOTIFY', false),  // SetSiparisDurum MailBilgilendir
            'cancel_status' => env('RETURNS_TICIMAX_CANCEL_STATUS', 'Iptal'),  // TAM iptal statüsü (WebSiparisDurumlari)
            // İADE statüsü — para iadesi TAMAMLANINCA yazılır (kullanıcı kararı 2026-07-21):
            // 'Iade' değil 'IadeOdemeYapildi' (WebSiparisDurumlari enum). İPTAL ödemeleri de bu
            // statüyü alır (kullanıcı kararı 2026-08-07 — 'Iptal'in üzerine yazılır).
            'return_status' => env('RETURNS_TICIMAX_RETURN_STATUS', 'IadeOdemeYapildi'),
            // KISMİ kapsam (siparişin tamamı iade/iptal edilmediyse) ödeme sonrası statüsü
            // (kullanıcı kararı 2026-08-07): siparişin bir kısmı müşteride kalıyor.
            'return_status_partial' => env('RETURNS_TICIMAX_RETURN_STATUS_PARTIAL', 'KismiIadeYapildi'),
            // İade talebi alınıp kargo kodu oluştuğunda yazılan statü (müşteri submit anı, best-effort).
            'return_requested_status' => env('RETURNS_TICIMAX_RETURN_REQUESTED_STATUS', 'IadeTalepAlindi'),
            // Personel onayında (ürün depoya ulaşıp kontrol edildiğinde) yazılan statü
            // (kullanıcı kararı 2026-08-07 — 21 Tem "personel onayında statü değişmez" kararını revize eder).
            'staff_approved_status' => env('RETURNS_TICIMAX_STAFF_APPROVED_STATUS', 'IadeUlastiOdemeYapilacak'),
            // Red / süre dolumunda sipariş statüsü geri çekilir: öncelik submit anında kaydedilen
            // ticimax_prev_status; yoksa bu fallback. ⚠ VARSAYILAN KAPALI (kullanıcı kararı
            // 2026-08-07): enum'da "İade Reddedildi" yok; TeslimEdildi'ye dönüş Ticimax'ın statü
            // SMS otomasyonunu tetikleyip müşteriye İKİNCİ KEZ teslim SMS'i gönderebilir
            // (SetSiparisDurum'da SMS'i kapatan parametre yok, MailBilgilendir yalnız maili keser).
            'reject_revert_enabled' => env('RETURNS_TICIMAX_REJECT_REVERT_ENABLED', false),
            'reject_fallback_status' => env('RETURNS_TICIMAX_REJECT_FALLBACK_STATUS', 'TeslimEdildi'),
            // KISMI iptal (SiparisUrunIptalIade) kalem kodları — bu tenant'ta kalem 'İptal' durumu TANIMLI
            // DEĞİL; canlı kısmi iptal için Ticimax ekibinden alınıp girilecek (0 ise canlı çağrı engellenir).
            'item_islem' => (int) env('RETURNS_TICIMAX_ITEM_ISLEM', 0),
            'item_durum_id' => (int) env('RETURNS_TICIMAX_ITEM_DURUM_ID', 0),
            'item_iade_neden_id' => (int) env('RETURNS_TICIMAX_ITEM_IADE_NEDEN_ID', 0),
            // ÜRÜN KIRILIMI statüleri (SetSiparisUrunDurum) — iade akışında kalemler Ticimax panelde
            // işaretlenir ki hangi ürünün iade edildiği görünsün (kullanıcı isteği 2026-07-30).
            // DurumID/Islem kodları tenant'ın "Sipariş Ürün Durumları" tanımından (t1 canlı doğrulandı:
            // 7=İade Talebi/islem 0, 8=İade Edildi/islem 2, 1=İşlemde/islem 1). Best-effort; para/mail
            // alanları servis katmanında daima kapalı. enabled=false iken hiç çağrılmaz.
            'item_status' => [
                'enabled' => env('RETURNS_TICIMAX_ITEM_STATUS_ENABLED', false),
                'return_requested' => ['durum_id' => 7, 'islem' => 0], // müşteri talebi + kargo kodu anı
                'refunded' => ['durum_id' => 8, 'islem' => 2],         // para iadesi fiilen tamamlanınca
                'reverted' => ['durum_id' => 1, 'islem' => 1],         // red/süre dolumu → İşlemde'ye dön
            ],
        ],

        /**
         * EKSİK / HATALI ÜRÜN İADESİ (personel başlatır — ReturnType::Shortage, ShortageService).
         *
         * Depo siparişi çıkaramıyor (eksik/hatalı/stok hatası), müşteri yeni ürün istemiyor →
         * personel panelden ilgili kalemi seçip para iadesi başlatır; kalan ürünler kargolanır.
         * Talep doğrudan yönetici PARA onayına düşer. Ticimax sipariş STATÜSÜ değiştirilmez
         * (sipariş yine kargoya verilecek); yalnız kalem işaretlenir + özel alana not yazılır.
         * Seçim siparişin TAMAMINI kapsıyorsa iptal gibi davranılır (statü cancel_status).
         * Nebim'e HİÇBİR yazma yapılmaz (kullanıcı kararı 2026-09-23).
         *
         * Para iadesi onaylanınca müşteriye ÖZÜR SMS'i + özel indirim kuponu (Ticimax
         * HediyeCekiOlustur, refund.dry_run'a uyar). Tenant panelden yönetir
         * (settings['returns_integrations']['shortage']).
         *
         * 2026-09-25: İKİNCİ AŞAMA `delivered` — sipariş kargoda/teslim edilmiş (durum 6 / returnable_statuses)
         * ve müşteri eksik/hatalı ürün bildirdi. Aynı para akışı + aynı kupon; AMA Ticimax'a hiçbir yazma yok,
         * SMS olayı `shortage_delivered_refunded` (daha genel özür metni). Kargo ücreti tam kapsamda
         * iade edilir (2026-10-05'e kadar bu aşamada edilmiyordu).
         * Aşama sipariş durumundan otomatik seçilir (metadata.shortage.stage).
         */
        'shortage' => [
            'coupon_enabled' => true,
            'coupon_amount' => 100,          // TL — özür kuponu tutarı
            'coupon_days' => 90,             // kupon geçerlilik süresi (gün)
            'coupon_prefix' => 'OZUR',       // kupon kodu öneki (OZUR-XXXXXX)
            'coupon_grup_adi' => 'Özür Kuponu',
            'coupon_min_amount' => 0,        // kuponun geçerli olduğu minimum sepet tutarı (0 = yok)
            // Kalem işaretleme: 0 = iptal akışının kalem kodu kullanılır (ticimax.item_durum_id/item_islem,
            // t1'de 2/2 = "İptal Edildi" — kısmi iptallerde canlıda kanıtlı). Tenant panelde farklı bir
            // "Sipariş Ürün Durumu" (örn. "Gönderilemedi") tanımlayıp ID/işlem girerse o kullanılır.
            'item_durum_id' => 0,
            'item_islem' => 0,
            // Ticimax'ta personel notu API'si yok. Özel alana (OzelAlan1..3) yazma DENENDİ ama
            // KAPATILDI (kullanıcı kararı 2026-09-23: özel alan 3 başka amaçla kullanılıyor) → 0.
            // Not Yunbi tarafında tutulur: metadata.shortage.staff_note/summary + staff_note audit.
            'note_field' => 0,
        ],

        /**
         * Faz 4 — Para iadesi. İki yöntem:
         *   - store_credit → Ticimax HediyeCekiOlustur ile ANINDA indirim kuponu (dış anahtar GEREKMEZ).
         *   - original     → iyzico/PayTR karta iade (API anahtarı + transaction id gerektirir; henüz YOK,
         *                     bu yöntem seçilirse "manuel" işaretlenir, otomatik para hareketi yapılmaz).
         *
         * ⛔ dry_run=true iken Ticimax'a GERÇEK kupon yazılmaz (payload loglanır); ReturnRefund kaydı
         * `dry_run` statüsüyle açılır ve akış test için Refunded'a ilerletilir (SMS de dry-run olur).
         * Canlıya almak: tenant `returns_integrations.refund.dry_run=false` (+ Ticimax kanalı aktif).
         */
        'refund' => [
            'enabled' => env('RETURNS_REFUND_ENABLED', true),
            'dry_run' => env('RETURNS_REFUND_DRY_RUN', true),  // true: Ticimax kupon yazma, sadece logla
            'store_credit' => [
                // Üretilen indirim kuponu kaç gün geçerli (gün başı→gün sonu, Türkiye TZ).
                'valid_days' => (int) env('RETURNS_REFUND_COUPON_DAYS', 180),
                // Kupon kodu öneki (IADE-XXXXXX).
                'code_prefix' => env('RETURNS_REFUND_COUPON_PREFIX', 'IADE'),
                // HediyeCekiOlustur tip kodu: TUTAR (TL) bazlı indirim = 0 (yüzde=1). Çark ile aynı taban:
                // config/wheel.php indirim_tipi.amount=0. ⚠ 1 verilirse YÜZDE indirim olur (para-kritik).
                'indirim_tipi_tutar' => (int) env('RETURNS_REFUND_INDIRIM_TIPI', 0),
                'grup_adi' => env('RETURNS_REFUND_GRUP_ADI', 'İade Bakiyesi'),
            ],

            /**
             * original = KARTA İADE (iyzico + PayTR). Sağlayıcı + iade referansı siparişin Ticimax ödeme
             * bloğundan (WebSiparisOdeme: OdemeTipi, OdemeSiparisID, PosReferansID) çözülür.
             *
             * ⛔ dry_run=true (varsayılan) iken sağlayıcı API'sine GERÇEK iade isteği GİTMEZ; istek payload'ı
             * (PayTR token / iyzico request) loglanır, ReturnRefund `dry_run` açılır. Kimlikler henüz YOK →
             * canlı kapalı. Kimlikler Ayarlar/`.env` ile girilip dry_run=false yapılınca canlıya alınır.
             *
             * SAĞLAYICI AYRIMI (2026-06-22 canlı keşif): iyzico ve PayTR Ticimax'ta AYNI OdemeTipi=17 ile
             * görünür. Ayraç = `PosReferansID` (iyzico=numerik paymentId / PayTR=boş) → PaymentRefundManager
             * ::resolveProvider otomatik belirler. `odeme_tipi_map` artık SADECE açık ZORLAYICI override için
             * (boş bırakılır; doldurulursa o OdemeTipi'ni belirtilen sağlayıcıya sabitler). Belirlenemezse →
             * talep `pending_manual` (personel manuel iade eder).
             */
            'original' => [
                'enabled' => env('RETURNS_REFUND_ORIGINAL_ENABLED', true),
                'dry_run' => env('RETURNS_REFUND_ORIGINAL_DRY_RUN', true),
                'odeme_tipi_map' => [
                    // '17' => 'paytr',
                    // '14' => 'iyzico',
                ],
                'iyzico' => [
                    'base_url' => env('RETURNS_IYZICO_BASE_URL', 'https://api.iyzipay.com'),
                    'api_key' => env('RETURNS_IYZICO_API_KEY', ''),
                    'secret_key' => env('RETURNS_IYZICO_SECRET_KEY', ''),
                ],
                'paytr' => [
                    'endpoint' => env('RETURNS_PAYTR_REFUND_URL', 'https://www.paytr.com/odeme/iade'),
                    'merchant_id' => env('RETURNS_PAYTR_MERCHANT_ID', ''),
                    'merchant_key' => env('RETURNS_PAYTR_MERCHANT_KEY', ''),
                    'merchant_salt' => env('RETURNS_PAYTR_MERCHANT_SALT', ''),
                ],
            ],
        ],
    ],
];
