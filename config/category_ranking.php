<?php

/**
 * Akıllı Kategori Sıralaması — kategori-içi dinamik ürün sırası (Ticimax Sira geri beslemesi).
 * Tüm sinyaller KATEGORİ HAVUZU İÇİNDE normalize edilir (kategori kendi içinde yarışır).
 * Tenant kill-switch: tenants.settings['category_ranking_enabled'] (yoksa --live yazmaz).
 */
return [
    'enabled' => env('CATEGORY_RANKING_ENABLED', true),

    // Ağırlıklar (toplam 1.0)
    'weights' => [
        'sales' => 0.24,      // satış penceresi içindeki ödenmiş satış adedi (log)
        'engagement' => 0.14, // GA4 90g views + add_to_carts ("inceleniyor")
        'trend' => 0.10,      // son 14g satışın pencere içindeki payı (ivme)
        'favorites' => 0.12,  // son 180g favori sayısı (log)
        'reviews' => 0.10,    // Bayesian yorum puanı (C=20)
        'conversion' => 0.08, // GA4 purchases/views
        'freshness' => 0.10,  // exp(-yaş/45g)
        'stock' => 0.12,      // satılabilir stok derinliği (log)
    ],

    'review_bayes_c' => 20,          // Bayesian shrink sabiti
    'freshness_tau_days' => 45,      // yenilik yarılanması
    'favorites_window_days' => 180,
    // 90→60 (2026-07-06, kullanıcı kararı): sezonluk katalogda daha taze bakış;
    // 60g'de 1.528 üründe sinyal var (90g: 1.923) — kabul edilebilir kayıp.
    'sales_window_days' => 60,
    'trend_window_days' => 14,

    // Beden-kırığı cezası: kategorinin yaygın bedenleri (havuzun ≥%25'inde stoklu)
    // içinden ürünün stokta kapsadığı oran → çarpan 0.6 + 0.4×kapsama.
    'size_coverage_min_share' => 0.25,
    // 2026-09-27 (kullanıcı kararı, Tonny "bedeni olmayan ürün ilk sırada" şikâyeti): taban 0.6 → 0.25.
    // Çekirdek bedenlerin yarısı yoksa skor en az %62 kırpılır; hiç yoksa %75.
    'size_coverage_floor' => 0.25,

    // Cinsiyet/yaş bazlı ÇEKİRDEK BEDEN ARALIĞI: kategori kökü (path'in ilk parçası, küçük harf,
    // "başlar" eşleşmesi) → [min,max]. Kapsama ve stok derinliği YALNIZ bu aralıkta ölçülür;
    // unisex ürünün 36-39 stoğu Erkek kategorisinde sayılmaz (ve tersi). Kök eşleşmezse
    // (kampanya kategorileri) eski havuz-bazlı yaygın beden mantığı çalışır.
    // Veri (t1, stoklu ürün payı): Erkek 40-44 %8-13 / 45 %2; Kadın 36-40 %12-15 / 41 %3; Çocuk 22-35.
    'size_ranges' => [
        'erkek' => [40, 46],
        'kadın' => [36, 41],
        'kadin' => [36, 41],
        'çocuk' => [19, 35],
        'cocuk' => [19, 35],
        'bebek' => [16, 27],
    ],
    // Stok derinliği sinyali çekirdek aralıktaki stokla hesaplanır (aralık varsa).
    'core_stock_depth' => true,
    // Keşif slotu adayı olmak için çekirdek beden kapsaması en az bu kadar olmalı.
    'discovery_min_coverage' => 0.5,
    // 2026-09-27: keşif slotu adayı da TAM BEDEN (katman 4) olmalı — slot kırık ürünü öne çekmesin.
    'discovery_require_full_tier' => true,

    'out_of_stock_multiplier' => 0.3, // stok 0 → dibe (listeden çıkarılmaz)

    // KATMANLI SIRALAMA (2026-09-27, kullanıcı kararı "ilk sıralar bedeni olan ürünlerin olmalı"):
    // önce çekirdek bedenlerinin ≥ coverage_tier_min'i stokta olanlar, sonra zayıf bedenliler,
    // sonra kendi cinsiyet aralığında hiç bedeni olmayanlar, en sonda stoksuzlar. Skor katman içinde.
    'coverage_tiering' => true,
    'coverage_tier_min' => 0.5,
    // 2026-09-27 kullanıcı kararı: en üst katman (4) = çekirdek bedenlerden en fazla 1 eksik ("kırıksız").
    'coverage_full_max_missing' => 1,

    // Keşif slotu: her N sırada 1 slot yeni ürüne (sıra 4, 8, 12, ...).
    // 2026-09-01 kullanıcı kararı: aralık 8→4, yaş 60→120 gün, SATIŞ ŞARTI KALDIRILDI
    // ("satış olsa da olmasa da 4. ve katları hep yeni ürün olsun") — yani yeni =
    // yaş ≤ max_age_days VE stok > 0. require_no_sales=true yapılırsa eski davranış
    // (yalnız hiç satmamış ürün) geri gelir.
    // Tenant override: settings['category_ranking_discovery'] — PANELDEN yönetilir.
    // 2026-09-27 kullanıcı kararı ("her 4'te 1 kaba geldi"): varsayılan mod 'bonus' —
    // slot yok; yeni ürüne yaşıyla doğrusal azalan yenilik bonusu (ilk gün bonus_max, max_age'de 0),
    // yalnız kendi cinsiyet aralığında çekirdek bedeni tam olan (tier 3) ürünlere. Ek olarak ilk
    // guarantee_within sırada hiç yeni ürün yoksa en iyi tier-3 yeni ürün guarantee_position'a
    // terfi eder (tek garanti). 'slot' modu eski her-N-sırada-1 davranışıdır.
    'discovery_mode' => 'slot',
    'discovery_novelty_bonus_max' => 0.08,   // t1 ölçümü: 6.→12. sıra skor farkı ≈0,06-0,09
    'discovery_guarantee_within' => 12,
    'discovery_guarantee_position' => 8,
    'discovery_slot_interval' => 4,
    'discovery_new_max_age_days' => 120,
    'discovery_require_no_sales' => false,

    // Histerezis: kategoride hiçbir ürün bu kadar pozisyon oynamıyorsa (ve sırasız
    // ürün yoksa) kategoriye YAZMA — gecelik "titreme" engeli.
    // Renk dağıtma: aynı modelin (stok kodu) iki rengi arasında en az bu kadar başka ürün (0 = kapalı).
    // Yalnız aynı beden katmanı içinde yer değiştirir.
    'color_spread_gap' => 8,

    // SEZONSALLIK (2026-10-04, kullanıcı: "kış geldi, Kız Çocuk'ta hâlâ sandalet/bez ayakkabı önde"):
    // ürünün sezonu yaprak kategorisinden (adında anahtar kelime) türetilir; ürün ADINDAKİ kelime
    // yaprağı ezer (kürklü terlik = kış, keten spor ayakkabı = yaz). Aktif sezonun TERSİ olan stoklu
    // ürün, sezona uygun tüm stoklu ürünlerden SONRA gelir (stoksuzlardan önce); kendi içinde katman+skor
    // korunur. Tek sezonlu havuzda (ör. Kız Çocuk Sandalet) etkisizdir → pratikte yalnız üst kategoriler.
    // Takvim MM-DD; iki pencerenin dışı = geçiş (ceza yok). mode: 'tier' (sert) | 'soft' (skor × soft_multiplier).
    // Tenant override: settings['category_ranking_season'] = {enabled, mode, winter:[from,to], summer:[from,to]}.
    'season' => [
        'enabled' => true,
        'mode' => 'tier',
        'soft_multiplier' => 0.35,
        'winter' => ['10-01', '03-15'],
        'summer' => ['04-15', '08-31'],
        'leaf_keywords' => [
            'winter' => 'kar botu|bot|çizme|mont|yağmurluk|ev terli|yelek|ceket',
            'summer' => 'sandalet|terlik|tshirt|t-shirt|gözlük',
        ],
        // SEZON KARIŞIMI (2026-10-04, kullanıcı: "üst kategorilerde botlar spor ayakkabıyla karışık öne çıksın"):
        // ilk `within` sırada her `interval` üründen en az 1'i aktif sezonun ürünü olur. Aday yalnız beden katmanı
        // ≥ min_tier (tam / 1 eksik) ve satış penceresinde ≥ min_sales satmış stoklu üründür; yalnız TERFİ eder,
        // aday yoksa sıra boş kalmaz (doğal sıra devam). interval 0 = kapalı.
        'mix' => ['interval' => 3, 'within' => 48, 'min_tier' => 4, 'min_sales' => 5],
        'name_keywords' => [
            'winter' => 'kürklü|kürk|kışlık|polar|şardonlu|yünlü|peluş',
            'summer' => 'keten|hasır|espadril|kanvas|canvas|bez ayakkabı|plaj',
        ],
    ],

    'hysteresis_min_move' => 3,

    'min_pool_size' => 5,       // bundan küçük havuzlar sıralanmaz
    'write_chunk' => 200,       // SaveUrunKategori batch boyu
];
