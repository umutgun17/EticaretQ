<?php

/**
 * EticaretQ — SaaS ürün ailesi yapılandırması (marka, planlar, kayıt varsayılanları).
 */
return [
    'site_maintenance' => (bool) env('SITE_MAINTENANCE', false),
    'family' => 'eticaretq',
    'app_base' => env('SAAS_APP_BASE', rtrim(env('APP_URL', 'https://eticaretq.com'), '/') . '/app'),

    'brand' => [
        'name' => 'EticaretQ',
        'tagline' => 'İade, yorum, pazarlama ve dönüşüm — tek panelde',
        'domain' => 'eticaretq.com',
        'legal_name' => env('SAAS_LEGAL_NAME', 'EticaretQ'),
        'support_email' => env('SAAS_SUPPORT_EMAIL', 'destek@eticaretq.com'),
        'color' => '#0f766e',
    ],

    'products' => ['store', 'return', 'comments', 'marketing', 'cro'],

    'billing' => [
        'trial_days' => (int) env('SAAS_TRIAL_DAYS', 14),
        'grace_days' => (int) env('SAAS_GRACE_DAYS', 7),
        'tax_rate' => (float) env('SAAS_TAX_RATE', 20),
        'yearly_discount' => (float) env('SAAS_YEARLY_DISCOUNT', 0.25),
        'invoice_prefix' => 'EQ',
        'bank_transfer' => [
            'enabled' => (bool) env('SAAS_BANK_TRANSFER', true),
            'bank' => env('SAAS_BANK_NAME', ''),
            'iban' => env('SAAS_BANK_IBAN', ''),
            'holder' => env('SAAS_BANK_HOLDER', ''),
            'note' => 'Açıklamaya fatura numaranızı yazın; ödeme aynı iş günü hesabınıza yansıtılır.',
        ],
    ],

    'iyzico' => [
        'api_key' => env('IYZICO_API_KEY', ''),
        'secret_key' => env('IYZICO_SECRET_KEY', ''),
        'base_url' => env('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com'),
    ],

    'metrics' => [
        'returns' => 'İade talebi',
        'reviews_synced' => 'Senkronize yorum',
        'wa_notifications' => 'WhatsApp bildirimi',
    ],

    'default_channels' => [
        ['type' => 'whatsapp', 'name' => 'WhatsApp', 'category' => 'Bildirim'],
        ['type' => 'trendyol-product', 'name' => 'Trendyol', 'category' => 'Pazaryeri'],
    ],

    'onboarding' => [
        ['key' => 'verify', 'check' => 'email_verified', 'title' => 'E-postanı doğrula', 'desc' => 'Gelen kutundaki doğrulama bağlantısına tıkla.', 'to' => '/profile'],
        ['key' => 'store', 'check' => 'store_connected', 'title' => 'Mağazanı bağla', 'desc' => 'Ticimax veya ikas API bilgilerini gir; ürün, sipariş ve müşteriler otomatik çekilir.', 'to' => '/settings/channels'],
        ['key' => 'returns', 'check' => 'returns_configured', 'title' => 'İade kurallarını ayarla', 'desc' => 'İade süresi, kargo ve iade yöntemi; müşteri portalı linkini sitene ekle.', 'to' => '/returns/settings'],
        ['key' => 'widget', 'check' => 'widget_installed', 'title' => 'İlk widget\'ı yayınla', 'desc' => 'Yorum, sepet ya da akıllı arama scriptini temana ekle.', 'to' => '/cro'],
        ['key' => 'billing', 'check' => 'billing_profile', 'title' => 'Fatura bilgilerini gir', 'desc' => 'Deneme bitince kesintisiz devam için.', 'to' => '/billing'],
    ],
];
