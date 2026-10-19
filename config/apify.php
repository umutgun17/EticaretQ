<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Apify API Configuration
    |--------------------------------------------------------------------------
    |
    | Trendyol'un public review/product endpoint'leri Cloudflare bot-management
    | arkasinda; sunucu-tarafi dogrudan istekler 403/556 aliyor. Bu yuzden
    | yorum ve fiyat verisi Apify aktorleri uzerinden cekiliyor.
    |
    */

    'token' => env('APIFY_TOKEN'),

    'base_url' => env('APIFY_BASE_URL', 'https://api.apify.com/v2'),

    // Senkron aktor calismasi icin timeout (saniye). Aktor cold-start + scrape.
    'run_timeout' => (int) env('APIFY_RUN_TIMEOUT', 240),

    'actors' => [
        // Fiyat + urun bilgisi (barkod/varyant/ortalama puan). Onay gerekmez.
        // 2026-07-06'dan beri YORUMLAR da bu aktorden cekiliyor (includeReviews=true):
        // caa_software $0.075/run iken maximedupre ~$0.0005/yorum (~10x ucuz).
        'product' => env('APIFY_ACTOR_PRODUCT', 'maximedupre~trendyol-scraper'),

        // ESKI yorum aktoru — artik kullanilmiyor (pahali + 0-yorumlu urunde
        // KeyError crash). fetchReviewsRaw ile rollback icin tutuluyor.
        'reviews' => env('APIFY_ACTOR_REVIEWS', 'caa_software~trendyol-product-reviews-api'),

        // 2026-10-15'ten beri YORUMLAR bu aktorden: reviewSort=newest destekliyor
        // (maximedupre "default" sirasi karisik → az yorum isteyince yenileri
        // kaciriyordu). $0.00099/urun + $0.0007/yorum. Bos deger = maximedupre'ye don.
        'reviews_newest' => env('APIFY_ACTOR_REVIEWS_NEWEST', 'fatihtahta~trendyol-scraper'),

        // TikTok trend taramasi (TR): Creative Center aktorleri Turkiye'yi
        // desteklemedigi icin trend sinyali TikTok'un kendisinden alinir
        // (hashtag/arama top sonuclari, proxyCountryCode=TR). ~$1.70/1000 video.
        'tiktok' => env('APIFY_ACTOR_TIKTOK', 'clockworks~tiktok-scraper'),

        // Meta Ad Library kreatif istihbarati. Resmi Ad Library API TR'deki
        // TICARI reklamlari vermez (yalnizca siyasi + AB ulkeleri), bu yuzden
        // scraper zorunlu. Girdi: Ad Library arama URL'leri + count limiti.
        // $0.75/1000 reklam. Cikti semasi 2026-07-17'de canli testle dogrulandi
        // (start_date epoch, is_active, collation_count, snapshot.cards/videos).
        'ads_library' => env('APIFY_ACTOR_ADS_LIBRARY', 'curious_coder~facebook-ads-library-scraper'),
    ],

    // Uygulama tarafi harcama freni: Apify'in AYLIK toplam kullanimi (USD) bu
    // degeri gecince yeni aktor calismasi baslatilmaz. Kademeli/kontrollu
    // harcama icin; bosaltmak = frensiz. Apify hesabindaki hard limit ayridir.
    'monthly_budget_usd' => env('APIFY_BUDGET_USD') !== null ? (float) env('APIFY_BUDGET_USD') : null,

    // Yorum cekiminde urun basina en yeni kac yorum istensin (maximedupre
    // maxReviewsPerProduct). Incremental'da yeni yorumlar az; buyuk aciklar
    // icin komut --full ile calistirilip bu deger .env'den yukseltilebilir.
    'max_reviews_per_product' => (int) env('APIFY_MAX_REVIEWS_PER_PRODUCT', 100),
];
