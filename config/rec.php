<?php

/**
 * Sepet Önerisi (Ürün Öneri) motoru ayarları.
 * Tenant-bazlı görünüm/metin ayarları tenants.settings rec_* anahtarlarındadır;
 * buradakiler motorun global davranış parametreleridir.
 */
return [

    'copurchase' => [
        // Birlikte-alım matrisi kaç günlük ödenmiş siparişten kurulur
        'days' => (int) env('REC_COPURCHASE_DAYS', 365),
        // Ürün başına saklanacak en güçlü partner sayısı
        'top_partners' => (int) env('REC_TOP_PARTNERS', 60),
        // Çiftin matrise girmesi için gereken asgari birlikte-alım sayısı
        'min_together' => (int) env('REC_MIN_TOGETHER', 2),
    ],

    'offer' => [
        // Skor harmanı: birlikte-alım gücü + genel performans (ciro maksimizasyonu)
        'w_together' => 0.70,
        'w_performance' => 0.30,
        // Üye geçmişi kişiselleştirmesi
        'history_days' => 180,        // bu penceredeki alımlar "zaten aldı" sayılır (öneriden düşülür)
        'history_boost' => 0.15,      // müşterinin geçmişte aldığı marka/kategoriye küçük artı
    ],

    'attribution' => [
        'window_hours' => 24,
        'order_tz_offset_hours' => 3, // orders.order_date TR(+3), rec_events UTC
    ],

    /*
     * Motor pipeline'ları — yüzey başına aday kaynak sırası.
     * Kaynak anahtarları: copurchase | embedding | category_top | category_mix | global_top
     * Yeni yüzey eklemek = buraya bir satır + RecommendationEngine'de bağlam kuran giriş.
     * Anahtar yoksa motor giriş kapısının kendi varsayılanını kullanır.
     */
    'pipelines' => [
        'atc' => ['copurchase', 'category_top', 'global_top'],
        'checkout' => ['copurchase', 'category_mix', 'global_top'],
        // Kişi-bazlı (e-posta / WhatsApp / ana sayfa "sana özel"): birlikte-alım
        // genişlemesi + içerik benzerliği + sık kategorilerden liderler
        'customer' => ['copurchase', 'embedding', 'category_mix', 'global_top'],
        // "Sana Özel" kulakçığı: sinyalli ziyaretçi (sepet/gezilen/geçmiş); sinyalsiz akış motorda sabit (recent_top → global_top)
        'foryou' => ['copurchase', 'embedding', 'category_mix', 'recent_top', 'global_top'],
    ],

    'engine' => [
        'copurchase_per_anchor' => 12,  // çok-anchor'lı akışta anchor başına aday
        'customer_anchor_days' => 365,  // kişi-bazlı: son alımlar bu pencereden anchor olur
        'customer_anchor_count' => 6,
        'customer_size_days' => 720,    // beden histogramı penceresi
        'recent_sales_days' => 30,      // recent_top kaynağı: son N günün ödenmiş satış adedi
    ],
];
