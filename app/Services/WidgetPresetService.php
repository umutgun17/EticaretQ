<?php

namespace App\Services;

class WidgetPresetService
{
    /**
     * All available platform presets.
     * Each preset defines CSS selectors for the widget to find
     * the correct DOM elements on the e-commerce platform.
     */
    private static array $presets = [
        'ticimax' => [
            'label' => 'Ticimax',
            'selectors' => [
                'header_stars_target' => '#divUrunKodu',
                'widget_insert_before' => '#BenzerUrunDiv',
                'widget_insert_fallback' => '#divTabYorumlar,.urunOzellik,#divUrunOzellikAlani',
                'detail_container' => '.product-detail,#urunDetay,.detay_sag,.detaySliderContainer,#divTabYorumlar',
                'listing_card' => '.productItem,.product-item,.urunKutu',
                'listing_product_id' => '.detailLink[data-id],.detailUrl[data-id],.productDetail[data-id],.productName[data-id]',
                'listing_product_id_attr' => 'data-id',
                'listing_badge_after' => '.productName,.product-name,.urunAdi',
                'product_id_js_var' => 'productDetailModel.productId',
            ],
        ],
        'tsoft' => [
            'label' => 'T-Soft',
            'selectors' => [
                'header_stars_target' => '.product-code,.productCode',
                'widget_insert_before' => '.similar-products,.benzerUrunler',
                'widget_insert_fallback' => '.product-tabs,.urunDetayTab,.product-description',
                'detail_container' => '.product-detail-page,.productDetailPage,.detay_sag',
                'listing_card' => '.product-card,.productCard,.product-item',
                'listing_product_id' => 'a[data-product-id],a[data-id],.product-card[data-id]',
                'listing_product_id_attr' => 'data-product-id',
                'listing_badge_after' => '.product-title,.productTitle,.product-name',
                'product_id_js_var' => 'product.id',
            ],
        ],
        'ideasoft' => [
            'label' => 'IdeaSoft',
            'selectors' => [
                'header_stars_target' => '.product-code-holder,.product-sku',
                'widget_insert_before' => '.related-products,.relatedProducts',
                'widget_insert_fallback' => '#product-tabs,.product-tabs,.product-detail-tab',
                'detail_container' => '.product-detail,.productDetail,.product-info',
                'listing_card' => '.product-list-item,.product-item,.productItem',
                'listing_product_id' => '[data-product-id],[data-id],.product-item[data-id]',
                'listing_product_id_attr' => 'data-product-id',
                'listing_badge_after' => '.product-title,.product-name',
                'product_id_js_var' => 'IdeasoftProduct.id',
            ],
        ],
        'shopify' => [
            'label' => 'Shopify',
            'selectors' => [
                'header_stars_target' => '.product__title,.product-single__title',
                'widget_insert_before' => '.product-recommendations,.related-products',
                'widget_insert_fallback' => '.product__description,.product-single__description,.product__info-container',
                'detail_container' => '.product,.product-single,.product-template',
                'listing_card' => '.product-card,.grid__item,.collection-product-card',
                'listing_product_id' => '[data-product-id],[data-id],.product-card[data-product-id]',
                'listing_product_id_attr' => 'data-product-id',
                'listing_badge_after' => '.product-card__title,.card__heading,.grid-product__title',
                'product_id_js_var' => 'ShopifyAnalytics.meta.product.id',
            ],
        ],
    ];

    /**
     * Get all preset names with labels (for frontend dropdown).
     */
    public static function list(): array
    {
        $list = [];
        foreach (self::$presets as $key => $preset) {
            $list[$key] = $preset['label'];
        }
        $list['custom'] = 'Ozel';

        return $list;
    }

    /**
     * Get selectors for a given platform preset.
     * Returns null for 'custom' or unknown platforms.
     */
    public static function getSelectors(string $platform): ?array
    {
        return self::$presets[$platform]['selectors'] ?? null;
    }

    /**
     * Resolve effective selectors for a tenant based on their settings.
     * If platform is a known preset AND no custom overrides exist, use preset defaults.
     * If platform is 'custom' or individual selectors are set, use those.
     */
    public static function resolveSelectors(array $settings): array
    {
        $platform = $settings['review_widget_platform'] ?? 'ticimax';
        $presetSelectors = self::getSelectors($platform);

        // Start from preset defaults (or ticimax fallback)
        $base = $presetSelectors ?? self::$presets['ticimax']['selectors'];

        // Settings key → selector key mapping
        $map = [
            'review_widget_header_target' => 'header_stars_target',
            'review_widget_insert_before' => 'widget_insert_before',
            'review_widget_insert_fallback' => 'widget_insert_fallback',
            'review_widget_detail_container' => 'detail_container',
            'review_widget_listing_card' => 'listing_card',
            'review_widget_listing_id_selector' => 'listing_product_id',
            'review_widget_listing_id_attr' => 'listing_product_id_attr',
            'review_widget_listing_badge_after' => 'listing_badge_after',
            'review_widget_product_id_var' => 'product_id_js_var',
        ];

        $result = $base;
        foreach ($map as $settingKey => $selectorKey) {
            if (! empty($settings[$settingKey])) {
                $result[$selectorKey] = $settings[$settingKey];
            }
        }

        return $result;
    }

    /**
     * Get the settings key mapping (for frontend to know which setting maps where).
     */
    public static function settingsKeyMap(): array
    {
        return [
            'review_widget_header_target' => 'header_stars_target',
            'review_widget_insert_before' => 'widget_insert_before',
            'review_widget_insert_fallback' => 'widget_insert_fallback',
            'review_widget_detail_container' => 'detail_container',
            'review_widget_listing_card' => 'listing_card',
            'review_widget_listing_id_selector' => 'listing_product_id',
            'review_widget_listing_id_attr' => 'listing_product_id_attr',
            'review_widget_listing_badge_after' => 'listing_badge_after',
            'review_widget_product_id_var' => 'product_id_js_var',
        ];
    }
}
