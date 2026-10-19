<?php

use App\Http\Controllers\Api\PublicAnnounceController;
use App\Http\Controllers\Api\PublicPushController;
use App\Http\Controllers\Api\PublicEmailTrackController;
use App\Http\Controllers\Api\PublicReturnController;
use App\Http\Controllers\Api\PublicReviewController;
use App\Http\Controllers\Api\PublicSearchController;
use App\Http\Controllers\Api\PublicShippingController;
use App\Http\Controllers\Api\PublicUnsubscribeController;
use App\Http\Controllers\Api\PublicWheelController;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function () {
            // Widget routes — outside api/ prefix to bypass HandleCors
            Route::prefix('w/{slug}/stock-alert')
                ->middleware(['stock-alert-cors', 'throttle:30,1'])
                ->group(function () {
                    Route::match(['POST', 'OPTIONS'], '/', [\App\Http\Controllers\Api\PublicStockAlertController::class, 'subscribe']);
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicStockAlertController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/resolve', [\App\Http\Controllers\Api\PublicStockAlertController::class, 'resolve']);
                });

            Route::prefix('w/{slug}/reviews')
                ->middleware(['widget-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicReviewController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/product/{barcode}', [PublicReviewController::class, 'product']);
                    Route::match(['GET', 'OPTIONS'], '/product-id/{id}', [PublicReviewController::class, 'productById']);
                    // Batch endpoint: stricter rate limit (20 req/min per IP)
                    Route::match(['GET', 'OPTIONS'], '/batch', [PublicReviewController::class, 'batch'])
                        ->middleware('throttle:20,1');
                });

            // İade/İptal — public müşteri akışı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('r/{slug}/returns')
                ->middleware(['returns-cors', 'throttle:returns-public'])
                ->group(function () {
                    Route::match(['POST', 'OPTIONS'], '/lookup', [PublicReturnController::class, 'lookup'])
                        ->middleware('throttle:returns-lookup');
                    Route::match(['POST', 'OPTIONS'], '/preview', [PublicReturnController::class, 'preview']);
                    Route::match(['POST', 'OPTIONS'], '/submit', [PublicReturnController::class, 'submit']);
                    Route::match(['GET', 'OPTIONS'], '/status/{code}', [PublicReturnController::class, 'status']);
                });

            // Çark (Spin-to-Win) — public widget akışı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/wheel/{campaign}')
                ->middleware(['wheel-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicWheelController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/coupon-status', [PublicWheelController::class, 'couponStatus']);
                    Route::match(['POST', 'OPTIONS'], '/spin', [PublicWheelController::class, 'spin'])
                        ->middleware('throttle:wheel-spin');
                });

            // Akıllı Arama — public storefront widget akışı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/search')
                ->middleware(['search-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/', [PublicSearchController::class, 'search']);
                    Route::match(['GET', 'OPTIONS'], '/autocomplete', [PublicSearchController::class, 'autocomplete']);
                    Route::match(['GET', 'OPTIONS'], '/popular', [PublicSearchController::class, 'popular']);
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicSearchController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [PublicSearchController::class, 'event']);
                });

            // Akıllı Filtre (CRO) — kategori sayfası filtre/liste widget'ı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/filter')
                ->middleware(['filter-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicFilterController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/list', [\App\Http\Controllers\Api\PublicFilterController::class, 'list']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicFilterController::class, 'event']);
                });

            // Mobil Alt Bar (CRO) — yalnız mobilde görünen alt navigasyon (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/gallery')
                ->middleware(['gallery-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicGalleryController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicGalleryController::class, 'event']);
                });

            // Beden Seçimi (CRO) — ürün detayda varsayılan beden seçimi + ?beden= parametresi; yalnız genel ayar okur
            Route::match(['GET', 'OPTIONS'], 'w/{slug}/variant/config', [\App\Http\Controllers\Api\VariantSelectController::class, 'publicConfig'])
                ->middleware('throttle:search-widget');
            Route::match(['GET', 'OPTIONS'], 'w/{slug}/variant/data', [\App\Http\Controllers\Api\VariantSelectController::class, 'publicData'])
                ->middleware('throttle:search-widget');
            Route::match(['GET', 'OPTIONS'], 'w/{slug}/variant/similar', [\App\Http\Controllers\Api\VariantSelectController::class, 'publicSimilar'])
                ->middleware('throttle:search-widget');
            Route::match(['POST', 'OPTIONS'], 'w/{slug}/variant/event', [\App\Http\Controllers\Api\VariantSelectController::class, 'publicEvent'])
                ->middleware('throttle:search-widget');

            // Sepet Kampanyası (CRO) — yan sepet + checkout kademeli kampanya çubuğu (auth yok, slug ile tenant; HandleCors dışı)
            Route::match(['GET', 'OPTIONS'], 'w/cart-resolve', [\App\Http\Controllers\Api\PublicCartController::class, 'resolve'])->middleware('throttle:search-widget');
            Route::prefix('w/{slug}/cart')
                ->middleware(['cart-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicCartController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicCartController::class, 'event']);
                    Route::match(['GET', 'OPTIONS'], '/suggest', [\App\Http\Controllers\Api\PublicCartController::class, 'suggest']);
                });

            Route::prefix('w/{slug}/bottombar')
                ->middleware(['bottombar-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicBottomBarController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicBottomBarController::class, 'event']);
                });

            // Akıllı Menü (CRO) — görselli/dinamik mobil menü (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/menu')
                ->middleware(['menu-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicMenuController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/personal', [\App\Http\Controllers\Api\PublicMenuController::class, 'personal']);
                    Route::match(['GET', 'OPTIONS'], '/prices', [\App\Http\Controllers\Api\PublicMenuController::class, 'prices']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicMenuController::class, 'event']);
                });

            // Ürün Rozetleri (CRO) — liste kartı + ürün detay rozetleri ve sosyal kanıt (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/badges')
                ->middleware(['badge-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicBadgeController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/demo', [\App\Http\Controllers\Api\PublicBadgeController::class, 'demo']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicBadgeController::class, 'event']);
                });

            // 404 Sayfası (CRO) — eğlenceli şablon + ürün önerisi, yalnız "sayfa bulunamadı" ekranında (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/notfound')
                ->middleware(['notfound-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicNotFoundController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicNotFoundController::class, 'event']);
                });

            // "Sana Özel" öneri kulakçığı (CRO) — gezdikçe kişiselleşen 3-4 ürünlük yan panel (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/foryou')
                ->middleware(['foryou-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicForYouController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/suggest', [\App\Http\Controllers\Api\PublicForYouController::class, 'suggest']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicForYouController::class, 'event']);
                });

            // "Hoş geldin" ilk alışveriş hediyesi (CRO) — ilk gelen ziyaretçiye kupon kartı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/welcome')
                ->middleware(['welcome-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicWelcomeController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicWelcomeController::class, 'event']);
                });

            // "Bugüne Özel" Hero Ürün kulakçığı (CRO) — seçili ürünler + sayaç çekmecesi (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/hero')
                ->middleware(['hero-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicHeroController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicHeroController::class, 'event']);
                });

            // "Flaş İndirim" ana sayfa vitrini (CRO) — slider yerine süreli flaş ürünler (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/flash')
                ->middleware(['flash-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicFlashController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicFlashController::class, 'event']);
                });

            // "Uygulamaya Özel" kulakçığı (CRO) — kod + QR + /go yönlendirmesi (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/app')
                ->middleware(['apppromo-cors', 'throttle:search-widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicAppPromoController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicAppPromoController::class, 'event']);
                    Route::get('/go', [\App\Http\Controllers\Api\PublicAppPromoController::class, 'go']);
                });

            // "Bugün Kargoda" — kargo cutoff sayacı, public widget (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/shipping')
                ->middleware(['shipping-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicShippingController::class, 'config']);
                });

            // Kampanya Duyuruları (çan + üst bar + güven rozetleri) — public widget (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/announce')
                ->middleware(['announce-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicAnnounceController::class, 'config']);
                });

            // Sepet Önerisi (Ürün Öneri) — public widget akışı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/rec')
                ->middleware(['rec-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [\App\Http\Controllers\Api\PublicRecController::class, 'config']);
                    Route::match(['GET', 'OPTIONS'], '/cart-offer', [\App\Http\Controllers\Api\PublicRecController::class, 'cartOffer']);
                    Route::match(['GET', 'OPTIONS'], '/checkout-offer', [\App\Http\Controllers\Api\PublicRecController::class, 'checkoutOffer']);
                    Route::match(['POST', 'OPTIONS'], '/event', [\App\Http\Controllers\Api\PublicRecController::class, 'event']);
                    Route::match(['POST', 'OPTIONS'], '/claim', [\App\Http\Controllers\Api\PublicRecController::class, 'claim']);
                });

            // Web Push — public widget akışı (auth yok, slug ile tenant; HandleCors dışı)
            Route::prefix('w/{slug}/push')
                ->middleware(['push-cors', 'throttle:widget'])
                ->group(function () {
                    Route::match(['GET', 'OPTIONS'], '/config', [PublicPushController::class, 'config']);
                    Route::match(['POST', 'OPTIONS'], '/subscribe', [PublicPushController::class, 'subscribe']);
                    Route::match(['POST', 'OPTIONS'], '/unsubscribe', [PublicPushController::class, 'unsubscribe']);
                });

            // Abonelikten çıkış — public, auth yok, imzalı URL (one-click unsubscribe)
            Route::match(['GET', 'POST', 'OPTIONS'], '/u', [PublicUnsubscribeController::class, 'handle'])
                ->middleware(['signed', 'throttle:60,1'])
                ->name('marketing.unsubscribe');

            // E-posta açılma/tıklama takibi — public, auth yok
            Route::middleware('throttle:240,1')->group(function () {
                Route::get('/e/o/{token}.gif', [PublicEmailTrackController::class, 'open']);
                Route::get('/e/c/{token}', [PublicEmailTrackController::class, 'click']);
            });

        },
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'tenant' => \App\Http\Middleware\EnsureTenantAccess::class,
            'track-activity' => \App\Http\Middleware\TrackUserActivity::class,
            'role' => \App\Http\Middleware\CheckRole::class,
            'permission' => \App\Http\Middleware\CheckPermission::class,
            'subscription' => \App\Http\Middleware\EnsureSubscriptionActive::class,
            'widget-cors' => \App\Http\Middleware\WidgetCors::class,
            'stock-alert-cors' => \App\Http\Middleware\StockAlertCors::class,
            'returns-cors' => \App\Http\Middleware\ReturnsCors::class,
            'wheel-cors' => \App\Http\Middleware\WheelCors::class,
            'push-cors' => \App\Http\Middleware\PushCors::class,
            'search-cors' => \App\Http\Middleware\SearchWidgetCors::class,
            'filter-cors' => \App\Http\Middleware\FilterWidgetCors::class,
            'bottombar-cors' => \App\Http\Middleware\BottomBarCors::class,
            'gallery-cors' => \App\Http\Middleware\GalleryCors::class,
            'cart-cors' => \App\Http\Middleware\CartCors::class,
            'menu-cors' => \App\Http\Middleware\MenuWidgetCors::class,
            'hero-cors' => \App\Http\Middleware\HeroCors::class,
            'flash-cors' => \App\Http\Middleware\FlashCors::class,
            'badge-cors' => \App\Http\Middleware\BadgeCors::class,
            'notfound-cors' => \App\Http\Middleware\NotFoundCors::class,
            'foryou-cors' => \App\Http\Middleware\ForYouCors::class,
            'welcome-cors' => \App\Http\Middleware\WelcomeCors::class,
            'apppromo-cors' => \App\Http\Middleware\AppPromoCors::class,
            'shipping-cors' => \App\Http\Middleware\ShippingCors::class,
            'announce-cors' => \App\Http\Middleware\AnnounceCors::class,
            'rec-cors' => \App\Http\Middleware\RecCors::class,
        ]);

        $middleware->statefulApi();

        // Exclude webhook routes from CSRF/stateful verification
        $middleware->validateCsrfTokens(except: [
            'api/webhook/*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
