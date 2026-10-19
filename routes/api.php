<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChannelController;
use App\Http\Controllers\Api\MetaOAuthController;
use App\Http\Controllers\Api\CrmCustomerController;
use App\Http\Controllers\Api\CrmFavoriteController;
use App\Http\Controllers\Api\CrmOrderController;
use App\Http\Controllers\Api\CrmProductController;
use App\Http\Controllers\Api\ReportReturnController;
use App\Http\Controllers\Api\ReturnController;
use App\Http\Controllers\Api\WheelCampaignController;
use App\Http\Controllers\Api\PublicReviewController;
use App\Http\Controllers\Api\IysController;
use App\Http\Controllers\Api\SegmentController;
use App\Http\Controllers\Api\MarketingAutomationController;
use App\Http\Controllers\Api\MarketingCampaignController;
use App\Http\Controllers\Api\MarketingChannelsController;
use App\Http\Controllers\Api\MarketingEmailController;
use App\Http\Controllers\Api\MarketingEmailTemplateController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\TenantController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\WebhookController;
use Illuminate\Support\Facades\Route;

// ── Public ──
Route::get('/health', fn () => response()->json(['status' => 'ok']));
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

// ── Meta Webhook (public, no auth) — throttle: yetkisiz kuyruk taşırma/DoS önlemi ──
Route::get('/webhook/meta', [WebhookController::class, 'verify'])->middleware('throttle:60,1');
Route::post('/webhook/meta', [WebhookController::class, 'handle'])->middleware('throttle:300,1');

// ── Meta OAuth (callback is public — uses encrypted state for auth) ──
Route::get('/meta/oauth/callback', [MetaOAuthController::class, 'callback'])->middleware('throttle:30,1');

Route::post('/webhook/ikas', [\App\Http\Controllers\Api\IkasWebhookController::class, 'handle'])->middleware('throttle:600,1');

// Widget routes are registered in bootstrap/app.php under /w/ prefix (outside api/ to avoid HandleCors)

// ── SaaS: kayıt, şifre, faturalama, kurulum ──
require __DIR__.'/saas.php';

// ── Authenticated ──
Route::middleware(['auth:sanctum', 'tenant', 'subscription', 'throttle:120,1', 'track-activity'])->group(function () {

    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::put('/auth/profile', [AuthController::class, 'updateProfile']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);
    Route::post('/auth/crm-sso', [AuthController::class, 'crmSso']);

    // Tenants (super admin only — controller-level isSuperAdmin check + route-level role:admin)
    Route::middleware('role:admin')->group(function () {
        Route::get('/tenants', [TenantController::class, 'index']);
        Route::post('/tenants', [TenantController::class, 'store']);
        Route::patch('/tenants/{tenant}', [TenantController::class, 'update']);
        Route::delete('/tenants/{tenant}', [TenantController::class, 'destroy']);
    });


    // Channels (read-only: tüm kullanıcılar erişebilir)
    Route::get('/channels', [ChannelController::class, 'index']);

    // Channels (yönetim: settings izni gerekli)
    Route::middleware('permission:settings')->group(function () {
        Route::get('/channels/platform/{platform}', [ChannelController::class, 'showPlatform']);
        Route::get('/channels/{channel}', [ChannelController::class, 'show']);
        Route::patch('/channels/platform/{platform}', [ChannelController::class, 'updatePlatformCredentials']);
        Route::patch('/channels/{channel}', [ChannelController::class, 'update']);

        // Meta OAuth — authenticated redirect (generates OAuth URL)
        Route::get('/meta/oauth/redirect', [MetaOAuthController::class, 'redirect']);
        // Çok-sayfa seçimi: bekleyen bağlantının sayfa listesi + seçileni bağla
        Route::get('/meta/oauth/pending/{key}', [MetaOAuthController::class, 'pendingPages']);
        Route::post('/meta/oauth/pending/{key}', [MetaOAuthController::class, 'selectPage']);
    });

    // Users
    Route::middleware('permission:settings')->group(function () {
        Route::get('/users', [UserController::class, 'index']);
        // Kullanıcı aktivitesi (giriş + sayfa izi) — yalnızca yönetici
        Route::middleware('role:admin')->group(function () {
            Route::get('/users/activity/summary', [\App\Http\Controllers\Api\UserActivityController::class, 'summary']);
            Route::get('/users/{user}/activity', [\App\Http\Controllers\Api\UserActivityController::class, 'show']);
        });
        Route::get('/users/{user}', [UserController::class, 'show']);

        Route::middleware('role:admin')->group(function () {
            Route::post('/users', [UserController::class, 'store']);
            Route::patch('/users/{user}', [UserController::class, 'update']);
            Route::delete('/users/{user}', [UserController::class, 'destroy']);
            // Kullanıcı gözünden gör (metod içinde süper admin şartı aranır)
            Route::post('/users/{user}/impersonate', [AuthController::class, 'impersonate']);
        });
    });

    // Settings
    Route::middleware('permission:settings')->group(function () {
        Route::get('/settings', [SettingsController::class, 'show']);
        Route::get('/settings/ga4/status', [SettingsController::class, 'ga4Status']);
        Route::put('/settings', [SettingsController::class, 'update']);
        Route::post('/settings/ga4', [SettingsController::class, 'saveGa4']);

        // İYS aktarımı — tek sayfa yönetim (durum + ayar + seed + canlı test)
        Route::get('/iys/overview', [IysController::class, 'overview']);
        Route::put('/iys/settings', [IysController::class, 'updateSettings']);
        Route::post('/iys/seed', [IysController::class, 'seed']);
        Route::post('/iys/test', [IysController::class, 'test']);

        // Pazarlama segmentasyonu — dinamik kural tabanlı segmentler + CSV export
        Route::get('/segments', [SegmentController::class, 'index']);
        Route::post('/segments', [SegmentController::class, 'store']);
        Route::post('/segments/preview', [SegmentController::class, 'preview']);
        Route::post('/segments/refresh', [SegmentController::class, 'refresh']);
        Route::put('/segments/{id}', [SegmentController::class, 'update']);
        Route::delete('/segments/{id}', [SegmentController::class, 'destroy']);
        Route::get('/segments/{id}/export', [SegmentController::class, 'export']);

        // Pazarlama e-posta şablonları (GrapesJS editör)
        Route::get('/marketing/email-templates', [MarketingEmailTemplateController::class, 'index']);
        Route::post('/marketing/email-templates', [MarketingEmailTemplateController::class, 'store']);
        Route::get('/marketing/email-templates/{id}', [MarketingEmailTemplateController::class, 'show']);
        Route::put('/marketing/email-templates/{id}', [MarketingEmailTemplateController::class, 'update']);
        Route::delete('/marketing/email-templates/{id}', [MarketingEmailTemplateController::class, 'destroy']);
        Route::post('/marketing/email-templates/{id}/preview', [MarketingEmailTemplateController::class, 'preview']);

        // Sepet kurtarma otomasyonu — ayarlar + istatistik
        Route::get('/marketing/overview', [MarketingAutomationController::class, 'overview']);
        Route::get('/marketing/cart-recovery', [MarketingAutomationController::class, 'cartRecovery']);
        Route::put('/marketing/cart-recovery', [MarketingAutomationController::class, 'updateCartRecovery']);
        Route::get('/marketing/analytics', [MarketingAutomationController::class, 'analytics']);
        Route::get('/marketing/messages/{id}', [MarketingAutomationController::class, 'messageDetail'])->whereNumber('id');
        Route::get('/marketing/preferences', [MarketingAutomationController::class, 'preferences']);
        Route::put('/marketing/preferences', [MarketingAutomationController::class, 'updatePreferences']);
        Route::get('/marketing/wheel-reminder', [MarketingAutomationController::class, 'wheelReminder']);
        Route::put('/marketing/wheel-reminder', [MarketingAutomationController::class, 'updateWheelReminder']);
        Route::get('/marketing/order-notify', [MarketingAutomationController::class, 'orderNotify']);
        Route::put('/marketing/order-notify', [MarketingAutomationController::class, 'updateOrderNotify']);

        // Toplu WhatsApp kampanyaları — listeler + kampanyalar + kapasite + WABA şablonları
        Route::get('/marketing/campaigns', [MarketingCampaignController::class, 'index']);
        Route::post('/marketing/campaigns', [MarketingCampaignController::class, 'store']);
        Route::put('/marketing/campaign-settings', [MarketingCampaignController::class, 'updateSettings']);
        Route::get('/marketing/campaigns/{id}', [MarketingCampaignController::class, 'show'])->whereNumber('id');
        Route::put('/marketing/campaigns/{id}', [MarketingCampaignController::class, 'update'])->whereNumber('id');
        Route::delete('/marketing/campaigns/{id}', [MarketingCampaignController::class, 'destroy'])->whereNumber('id');
        Route::post('/marketing/campaigns/{id}/test-email', [MarketingCampaignController::class, 'testEmail'])->whereNumber('id');
        Route::get('/marketing/wa-templates', [MarketingCampaignController::class, 'templates']);
        Route::post('/marketing/wa-templates', [MarketingCampaignController::class, 'createTemplate']);
        Route::get('/marketing/blacklist', [MarketingCampaignController::class, 'blacklist']);
        Route::post('/marketing/blacklist', [MarketingCampaignController::class, 'addBlacklist']);
        Route::delete('/marketing/blacklist/{id}', [MarketingCampaignController::class, 'removeBlacklist'])->whereNumber('id');
        Route::get('/marketing/lists', [MarketingCampaignController::class, 'lists']);
        Route::post('/marketing/lists', [MarketingCampaignController::class, 'createList']);
        Route::get('/marketing/lists/{id}', [MarketingCampaignController::class, 'showList'])->whereNumber('id');
        Route::post('/marketing/lists/{id}/contacts', [MarketingCampaignController::class, 'addContacts'])->whereNumber('id');
        Route::post('/marketing/lists/{id}/fill-from-customers', [MarketingCampaignController::class, 'fillFromCustomers'])->whereNumber('id');
        Route::delete('/marketing/lists/{id}', [MarketingCampaignController::class, 'deleteList'])->whereNumber('id');

        // Pazarlama kanalları (e-posta/SMS/WhatsApp/push) — birleşik ayar
        Route::get('/marketing/channels', [MarketingChannelsController::class, 'index']);
        Route::put('/marketing/channels', [MarketingChannelsController::class, 'update']);

        // Pazarlama gönderici bilgileri (SMS başlığı + e-posta gönderen)
        Route::get('/marketing/sender', [MarketingEmailController::class, 'senderInfo']);
        Route::put('/marketing/sender', [MarketingEmailController::class, 'updateSender']);

        // Pazarlama e-posta gönderim kimliği + DNS
        Route::get('/marketing/email/sending', [MarketingEmailController::class, 'sending']);
        Route::post('/marketing/email/sending/verify', [MarketingEmailController::class, 'verify']);
        Route::post('/marketing/email/sending/toggle', [MarketingEmailController::class, 'toggle']);
    });

    // CRM
    // CRM › Gecikmeler — ayrı sayfa yetkisi (Ayarlar › Kullanıcılar › Ticimax CRM › Gecikmeler)
    Route::middleware('permission:crm_delays')->group(function () {
        Route::get('/crm/delays', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'index']);
        Route::get('/crm/delays/stats', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'stats']);
        Route::get('/crm/delays/export', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'export']);
        Route::post('/crm/delays/bulk', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'bulk']);
        Route::put('/crm/delays/settings', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'settings']);
        Route::get('/crm/delays/cargo-accounts', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'cargoAccounts']);
        Route::put('/crm/delays/cargo-accounts', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'saveCargoAccount']);
        Route::put('/crm/delays/{orderId}', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'update'])->whereNumber('orderId');
        Route::get('/crm/delays/{orderId}/events', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'events'])->whereNumber('orderId');
        Route::post('/crm/delays/{orderId}/status', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'setStatus'])->whereNumber('orderId');
        Route::post('/crm/delays/{orderId}/refresh', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'refresh'])->whereNumber('orderId');
        Route::post('/crm/delays/{orderId}/shipment-check', [\App\Http\Controllers\Api\CrmOrderDelayController::class, 'shipmentCheck'])->whereNumber('orderId');
    });

    Route::middleware('permission:crm')->group(function () {
        Route::get('/crm/products/stats', [CrmProductController::class, 'stats']);
        Route::get('/crm/products/brands', [CrmProductController::class, 'brands']);
        Route::get('/crm/products/categories', [CrmProductController::class, 'categories']);
        Route::get('/crm/stock-alerts', [\App\Http\Controllers\Api\StockAlertController::class, 'index']);
        Route::get('/crm/stock-alerts/{platformProductId}', [\App\Http\Controllers\Api\StockAlertController::class, 'show']);
        Route::get('/crm/products', [CrmProductController::class, 'index']);
        Route::get('/crm/products/{id}', [CrmProductController::class, 'show']);

        // CRM Orders
        Route::get('/crm/orders/stats', [CrmOrderController::class, 'stats']);
        Route::get('/crm/orders/tab-counts', [CrmOrderController::class, 'tabCounts']);
        Route::get('/crm/orders/cargo-companies', [CrmOrderController::class, 'cargoCompanies']);
        Route::get('/crm/orders/statuses', [CrmOrderController::class, 'statuses']);
        Route::get('/crm/orders/sources', [CrmOrderController::class, 'sources']);
        Route::get('/crm/orders', [CrmOrderController::class, 'index']);
        Route::get('/crm/orders/{id}', [CrmOrderController::class, 'show']);

        // CRM Customers
        Route::get('/crm/customers/stats', [CrmCustomerController::class, 'stats']);
        Route::get('/crm/customers/cities', [CrmCustomerController::class, 'cities']);
        Route::get('/crm/customers/member-types', [CrmCustomerController::class, 'memberTypes']);
        Route::get('/crm/customers', [CrmCustomerController::class, 'index']);
        Route::get('/crm/customers/{id}', [CrmCustomerController::class, 'show']);

        // CRM Favorites
        Route::get('/crm/favorites/stats', [CrmFavoriteController::class, 'stats']);
        Route::get('/crm/favorites/chart', [CrmFavoriteController::class, 'chart']);
        Route::get('/crm/favorites/top-products', [CrmFavoriteController::class, 'topProducts']);
        Route::get('/crm/favorites', [CrmFavoriteController::class, 'index']);

        // CRM Reviews (Trendyol product reviews)
        Route::get('/crm/reviews/stats', [\App\Http\Controllers\Api\ProductReviewController::class, 'stats']);
        Route::get('/crm/reviews', [\App\Http\Controllers\Api\ProductReviewController::class, 'index']);
        Route::get('/crm/reviews/{productId}', [\App\Http\Controllers\Api\ProductReviewController::class, 'show']);

        // Fiyat Kiyaslama (site vs Trendyol)
        Route::get('/price-comparison/stats', [\App\Http\Controllers\Api\PriceComparisonController::class, 'stats']);
        Route::get('/price-comparison', [\App\Http\Controllers\Api\PriceComparisonController::class, 'index']);

        // Trendyol Kiyas (Seller API katalogu vs site: eksik urun, fiyat, gorsel, stok, beden, icerik)
        Route::get('/trendyol-compare/stats', [\App\Http\Controllers\Api\TrendyolCompareController::class, 'stats']);
        Route::get('/trendyol-compare/probe', [\App\Http\Controllers\Api\TrendyolCompareController::class, 'probe']);
        Route::get('/trendyol-compare/export', [\App\Http\Controllers\Api\TrendyolCompareController::class, 'export']);
        Route::post('/trendyol-compare/sync', [\App\Http\Controllers\Api\TrendyolCompareController::class, 'sync']);
        Route::get('/trendyol-compare', [\App\Http\Controllers\Api\TrendyolCompareController::class, 'index']);
    });

    // Reports
    Route::middleware('permission:reports')->group(function () {
        Route::get('/reports/returns/stats', [ReportReturnController::class, 'stats']);
        Route::get('/reports/returns/top-products', [ReportReturnController::class, 'topProducts']);
        Route::get('/reports/returns/trend', [ReportReturnController::class, 'trend']);
        Route::get('/reports/returns/by-source', [ReportReturnController::class, 'bySource']);
    });

    // İade Yönetim Paneli (Faz 3) — personel/yönetici
    Route::middleware('permission:returns')->group(function () {
        Route::get('/returns', [ReturnController::class, 'index']);
        Route::get('/returns/stats', [ReturnController::class, 'stats']);
        Route::get('/returns/report', [ReturnController::class, 'report']);
        // Muhasebe: kapıda ödeme havale ödeme emirleri (IBAN taşır → uçlar ayrıca yönetici yetkisi arar)
        Route::get('/returns/payouts', [ReturnController::class, 'payouts']);
        Route::get('/returns/payouts/export', [ReturnController::class, 'payoutsExport']);
        Route::post('/returns/payouts/mark-sent', [ReturnController::class, 'markAccountingSent']);
        // SMS Yönetimi (İade Yönetimi alt sayfası) — gönderim geçmişi + olay bazlı ayar/şablon
        Route::get('/returns/sms/log', [\App\Http\Controllers\Api\ReturnSmsController::class, 'log']);
        Route::get('/returns/sms/settings', [\App\Http\Controllers\Api\ReturnSmsController::class, 'settings']);
        Route::put('/returns/sms/settings', [\App\Http\Controllers\Api\ReturnSmsController::class, 'saveSettings']);
        // Eksik/hatalı ürün iadesi — PERSONEL başlatır (sipariş çıkarılamıyor, müşteri yeni ürün istemiyor)
        // Ayrı sayfa yetkisi: Personel Yönetimi → İade → "Eksik / Hatalı Ürün İadesi" (admin otomatik).
        Route::middleware('permission:returns_shortage')->group(function () {
            Route::post('/returns/shortage/lookup', [\App\Http\Controllers\Api\ReturnShortageController::class, 'lookup']);
            Route::post('/returns/shortage/preview', [\App\Http\Controllers\Api\ReturnShortageController::class, 'preview']);
            Route::post('/returns/shortage', [\App\Http\Controllers\Api\ReturnShortageController::class, 'store']);
        });
        // Geri dönen sipariş iadesi — firmadan çıkıp teslim edilemeyen, depoya dönen paketler (aynı denetleyici,
        // mode=returned). Müşteriye bildirim yok; para onayından sonra Ticimax İptal. Ayrı sayfa yetkisi.
        Route::middleware('permission:returns_returned')->group(function () {
            Route::post('/returns/returned/lookup', [\App\Http\Controllers\Api\ReturnShortageController::class, 'lookup'])->defaults('mode', 'returned');
            Route::post('/returns/returned/preview', [\App\Http\Controllers\Api\ReturnShortageController::class, 'preview'])->defaults('mode', 'returned');
            Route::post('/returns/returned', [\App\Http\Controllers\Api\ReturnShortageController::class, 'store'])->defaults('mode', 'returned');
        });
        Route::get('/returns/{id}', [ReturnController::class, 'show'])->whereNumber('id');
        Route::post('/returns/{id}/transition', [ReturnController::class, 'transition'])->whereNumber('id');
        Route::post('/returns/{id}/approve-staff', [ReturnController::class, 'approveStaff'])->whereNumber('id');
        Route::post('/returns/{id}/approve-manager', [ReturnController::class, 'approveManager'])->whereNumber('id');
        Route::post('/returns/{id}/refund', [ReturnController::class, 'refund'])->whereNumber('id');
        Route::post('/returns/{id}/reject', [ReturnController::class, 'reject'])->whereNumber('id');
        Route::post('/returns/{id}/notes', [ReturnController::class, 'addNote'])->whereNumber('id');
        // Kapıda ödeme iadesi (havale): bilgi girişi/düzeltme + "havale yapıldı" kapanışı.
        Route::put('/returns/{id}/bank-account', [ReturnController::class, 'saveBankAccount'])->whereNumber('id');
        Route::post('/returns/{id}/mark-transferred', [ReturnController::class, 'markTransferred'])->whereNumber('id');
        // Kusur bildirimi kararı — controller içinde ayrıca YALNIZCA admin/süper admin denetimi var.
        Route::post('/returns/{id}/defect-approve', [ReturnController::class, 'approveDefect'])->whereNumber('id');
        Route::post('/returns/{id}/defect-reject', [ReturnController::class, 'rejectDefect'])->whereNumber('id');
        Route::post('/returns/{id}/attachments', [ReturnController::class, 'uploadAttachment'])->whereNumber('id');
        Route::get('/returns/{id}/attachments/{attachment}', [ReturnController::class, 'downloadAttachment'])
            ->whereNumber('id')->whereNumber('attachment')->name('returns.attachment.download');
    });

    // Site Araçları durum listesi — yetki kontrolü controller'da (CRO veya Pazarlama)
    Route::get('/cro/tools/status', [\App\Http\Controllers\Api\CroController::class, 'toolStatus']);

    Route::middleware('permission:cro')->group(function () {
        Route::get('/cro/overview', [\App\Http\Controllers\Api\CroController::class, 'overview']);
        Route::get('/cro/actions', [\App\Http\Controllers\Api\CroController::class, 'actions']);
        Route::post('/cro/actions', [\App\Http\Controllers\Api\CroController::class, 'storeAction']);
        Route::post('/cro/actions/seed', [\App\Http\Controllers\Api\CroController::class, 'seedActions']);
        Route::put('/cro/actions/{id}', [\App\Http\Controllers\Api\CroController::class, 'updateAction'])->whereNumber('id');
        Route::delete('/cro/actions/{id}', [\App\Http\Controllers\Api\CroController::class, 'destroyAction'])->whereNumber('id');
        Route::get('/cro/audits', [\App\Http\Controllers\Api\CroController::class, 'audits']);
        Route::post('/cro/audits/run', [\App\Http\Controllers\Api\CroController::class, 'runAudit'])->middleware('throttle:6,1');

        // ── Akıllı Arama (CRO altında) ──
        Route::get('/search/analytics', [\App\Http\Controllers\Api\SearchController::class, 'analytics']);
        Route::get('/search/synonyms', [\App\Http\Controllers\Api\SearchController::class, 'synonyms']);
        Route::post('/search/synonyms', [\App\Http\Controllers\Api\SearchController::class, 'storeSynonym']);
        Route::put('/search/synonyms/{id}', [\App\Http\Controllers\Api\SearchController::class, 'updateSynonym'])->whereNumber('id');
        Route::delete('/search/synonyms/{id}', [\App\Http\Controllers\Api\SearchController::class, 'destroySynonym'])->whereNumber('id');
        Route::get('/search/preview', [\App\Http\Controllers\Api\SearchController::class, 'preview']);
        Route::get('/search/settings', [\App\Http\Controllers\Api\SearchController::class, 'settings']);
        Route::put('/search/settings', [\App\Http\Controllers\Api\SearchController::class, 'updateSettings']);
        Route::get('/search/detect-selectors', [\App\Http\Controllers\Api\SearchController::class, 'detectSelectors']);

        // ── Akıllı Filtre paneli ──
        Route::get('/cro/filter/settings', [\App\Http\Controllers\Api\FilterController::class, 'settings']);
        Route::put('/cro/filter/settings', [\App\Http\Controllers\Api\FilterController::class, 'updateSettings']);
        Route::post('/cro/filter/catalog/refresh', [\App\Http\Controllers\Api\FilterController::class, 'refreshCatalog']);
        Route::get('/cro/filter/facet-values', [\App\Http\Controllers\Api\FilterController::class, 'facetValues']);
        Route::get('/cro/filter/categories', [\App\Http\Controllers\Api\FilterController::class, 'categories']);
        Route::get('/cro/filter/analytics', [\App\Http\Controllers\Api\FilterController::class, 'analytics']);
        Route::get('/cro/filter/detect', [\App\Http\Controllers\Api\FilterController::class, 'detect'])->middleware('throttle:10,1');

        // ── Mobil Alt Bar paneli ──
        Route::get('/cro/bottombar/settings', [\App\Http\Controllers\Api\BottomBarController::class, 'settings']);
        Route::put('/cro/bottombar/settings', [\App\Http\Controllers\Api\BottomBarController::class, 'updateSettings']);
        Route::get('/cro/bottombar/analytics', [\App\Http\Controllers\Api\BottomBarController::class, 'analytics']);
        Route::get('/cro/gallery/settings', [\App\Http\Controllers\Api\GalleryController::class, 'settings']);
        Route::put('/cro/gallery/settings', [\App\Http\Controllers\Api\GalleryController::class, 'updateSettings']);
        Route::get('/cro/gallery/analytics', [\App\Http\Controllers\Api\GalleryController::class, 'analytics']);
        Route::get('/cro/gallery/video-ab', [\App\Http\Controllers\Api\GalleryController::class, 'videoAb']);
        Route::get('/cro/badges/settings', [\App\Http\Controllers\Api\BadgeController::class, 'settings']);
        Route::put('/cro/badges/settings', [\App\Http\Controllers\Api\BadgeController::class, 'updateSettings']);
        Route::get('/cro/badges/categories', [\App\Http\Controllers\Api\BadgeController::class, 'categories']);
        Route::get('/cro/badges/analytics', [\App\Http\Controllers\Api\BadgeController::class, 'analytics']);
        Route::get('/cro/notfound/settings', [\App\Http\Controllers\Api\NotFoundController::class, 'settings']);
        Route::put('/cro/notfound/settings', [\App\Http\Controllers\Api\NotFoundController::class, 'updateSettings']);
        Route::get('/cro/notfound/products', [\App\Http\Controllers\Api\NotFoundController::class, 'products']);
        Route::get('/cro/notfound/analytics', [\App\Http\Controllers\Api\NotFoundController::class, 'analytics']);
        Route::get('/cro/foryou/settings', [\App\Http\Controllers\Api\ForYouController::class, 'settings']);
        Route::put('/cro/foryou/settings', [\App\Http\Controllers\Api\ForYouController::class, 'updateSettings']);
        Route::get('/cro/foryou/analytics', [\App\Http\Controllers\Api\ForYouController::class, 'analytics']);
        Route::get('/cro/welcome/settings', [\App\Http\Controllers\Api\WelcomeController::class, 'settings']);
        Route::put('/cro/welcome/settings', [\App\Http\Controllers\Api\WelcomeController::class, 'updateSettings']);
        Route::get('/cro/welcome/analytics', [\App\Http\Controllers\Api\WelcomeController::class, 'analytics']);
        Route::get('/cro/variant/settings', [\App\Http\Controllers\Api\VariantSelectController::class, 'settings']);
        Route::put('/cro/variant/settings', [\App\Http\Controllers\Api\VariantSelectController::class, 'updateSettings']);
        Route::get('/cro/variant/preview', [\App\Http\Controllers\Api\VariantSelectController::class, 'preview']);
        Route::get('/cro/variant/analytics', [\App\Http\Controllers\Api\VariantSelectController::class, 'analytics']);

        // ── Sepet Kampanyası paneli ──
        Route::get('/cro/cart/settings', [\App\Http\Controllers\Api\CartController::class, 'settings']);
        Route::put('/cro/cart/settings', [\App\Http\Controllers\Api\CartController::class, 'updateSettings']);
        Route::get('/cro/cart/analytics', [\App\Http\Controllers\Api\CartController::class, 'analytics']);
        Route::get('/cro/cart/impact', [\App\Http\Controllers\Api\CartController::class, 'impact']);

        // ── Akıllı Menü paneli ──
        Route::get('/cro/menu/settings', [\App\Http\Controllers\Api\MenuController::class, 'settings']);
        Route::put('/cro/menu/settings', [\App\Http\Controllers\Api\MenuController::class, 'updateSettings']);
        Route::post('/cro/menu/refresh', [\App\Http\Controllers\Api\MenuController::class, 'refresh']);
        Route::post('/cro/menu/pick-images', [\App\Http\Controllers\Api\MenuController::class, 'pickImages']);
        Route::get('/cro/menu/analytics', [\App\Http\Controllers\Api\MenuController::class, 'analytics']);

        // ── "Bugüne Özel" Hero Ürün kulakçığı paneli ──
        Route::get('/cro/hero/settings', [\App\Http\Controllers\Api\HeroController::class, 'settings']);
        Route::put('/cro/hero/settings', [\App\Http\Controllers\Api\HeroController::class, 'updateSettings']);
        Route::get('/cro/hero/products', [\App\Http\Controllers\Api\HeroController::class, 'products']);
        Route::get('/cro/hero/suggest', [\App\Http\Controllers\Api\HeroController::class, 'suggest']);
        Route::get('/cro/hero/analytics', [\App\Http\Controllers\Api\HeroController::class, 'analytics']);
        Route::get('/cro/flash/settings', [\App\Http\Controllers\Api\FlashController::class, 'settings']);
        Route::put('/cro/flash/settings', [\App\Http\Controllers\Api\FlashController::class, 'updateSettings']);
        Route::get('/cro/flash/products', [\App\Http\Controllers\Api\FlashController::class, 'products']);
        Route::get('/cro/flash/suggest', [\App\Http\Controllers\Api\FlashController::class, 'suggest']);
        Route::get('/cro/flash/analytics', [\App\Http\Controllers\Api\FlashController::class, 'analytics']);

        // ── "Uygulamaya Özel" kulakçığı paneli ──
        Route::get('/cro/app/settings', [\App\Http\Controllers\Api\AppPromoController::class, 'settings']);
        Route::put('/cro/app/settings', [\App\Http\Controllers\Api\AppPromoController::class, 'updateSettings']);
        Route::get('/cro/app/analytics', [\App\Http\Controllers\Api\AppPromoController::class, 'analytics']);
    });

    Route::middleware('permission:marketing')->group(function () {
        Route::get('/wheel/campaigns', [WheelCampaignController::class, 'index']);
        Route::post('/wheel/campaigns', [WheelCampaignController::class, 'store']);
        Route::get('/wheel/campaigns/{id}', [WheelCampaignController::class, 'show'])->whereNumber('id');
        Route::put('/wheel/campaigns/{id}', [WheelCampaignController::class, 'update'])->whereNumber('id');
        Route::delete('/wheel/campaigns/{id}', [WheelCampaignController::class, 'destroy'])->whereNumber('id');
        Route::get('/wheel/campaigns/{id}/leads', [WheelCampaignController::class, 'leads'])->whereNumber('id');
        Route::get('/wheel/campaigns/{id}/leads/export', [WheelCampaignController::class, 'leadsExport'])->whereNumber('id');
        Route::delete('/wheel/campaigns/{id}/test-data', [WheelCampaignController::class, 'purgeTest'])->whereNumber('id');
        Route::get('/wheel/campaigns/{id}/stats', [WheelCampaignController::class, 'stats'])->whereNumber('id');
        Route::get('/wheel/campaigns/{id}/preview-token', [WheelCampaignController::class, 'previewToken'])->whereNumber('id');

        // ── Akıllı Arama (Smart Search) paneli ──
        // Ürün Öneri paneli 27 Eyl'de CRO ürününe taşındı (permission:cro grubu)

        // Akıllı Arama paneli 10 Eyl'de CRO ürününe taşındı (permission:cro grubu)

        // ── Kategori Zekası (Kategori Denetçisi + Akıllı Kategori Sıralaması) paneli ──
        Route::get('/catalog/overview', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'overview']);
        Route::get('/catalog/suggestions', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'suggestions']);
        Route::post('/catalog/suggestions/bulk', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'bulk']);
        Route::post('/catalog/suggestions/{id}/approve', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'approve'])->whereNumber('id');
        Route::post('/catalog/suggestions/{id}/reject', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'reject'])->whereNumber('id');
        Route::get('/catalog/tree-audit', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'treeAudit']);
        Route::get('/catalog/ranking/categories', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingCategories']);
        Route::get('/catalog/ranking/preview', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingPreview']);
        Route::get('/catalog/ranking/weights', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingWeights']);
        Route::post('/catalog/ranking/weights', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'saveRankingWeights']);
        Route::get('/catalog/ranking/discovery', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingDiscovery']);
        Route::post('/catalog/ranking/discovery', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'saveRankingDiscovery']);
        Route::get('/catalog/ranking/pins', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingPins']);
        Route::post('/catalog/ranking/pins', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'saveRankingPins']);
        Route::post('/catalog/ranking/ab', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingAb']);
        Route::get('/catalog/ranking/ab/results', [\App\Http\Controllers\Api\CatalogIntelligenceController::class, 'rankingAbResults']);

    });
});
