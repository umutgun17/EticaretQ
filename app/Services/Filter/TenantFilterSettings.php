<?php

namespace App\Services\Filter;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Filtre — tenant ayarları (tenants.settings jsonb, panelden yönetilir).
 *
 * Anahtarlar: filter_widget_enabled, filter_widget_domains, filter_widget_template
 * (sidebar|topbar|drawer), filter_widget_theme (JSON), filter_facets (JSON sıralı liste),
 * filter_rules (JSON), filter_selectors (JSON: hide/mount).
 */
class TenantFilterSettings
{
    public const TEMPLATES = ['sidebar', 'topbar', 'drawer'];

    /**
     * native  : mağazanın KENDİ ürün listesi kalır (lazy load, sonsuz kaydırma, sepete ekle, sıralama
     *           Ticimax'ın); Yunbi yalnız filtre panelini değiştirir ve eşleşen ürün ID'lerini
     *           Ticimax'a verir (filterModel.filter.StrProductIds → getProducts(), URL'de ukids=).
     * takeover: filtre + ürün listesini Yunbi çizer (Ticimax dışı platformlar / demo).
     */
    public const MODES = ['native', 'takeover'];

    public const THEME_PRESETS = ['minimal', 'soft', 'bold'];

    /** Ticimax v8 temaları için varsayılan seçiciler (panelden değiştirilebilir). */
    public const DEFAULT_SELECTORS = [
        'hide' => '.filterBlock, .ProductListContent, .pageNumber, #divSayfalamaUst, #divSayfalamaAlt, .productFilter, .brandlistselection',
        'mount' => 'before:.ProductListContent',
        // native mod: tema filtre bloğu + mobil filtre butonu + tema sıralama/sayaç (.brandlistselection, .Uadet)
        // + alt kategori nav'ı (.katlink) gizlenir; sayaç/sıralama/çipler Yunbi araç çubuğundan çalışır (v2)
        'hide_native' => '.filterBlock, .mobilFilterOpenBtn, .brandlistselection, .Uadet, .katlink',
        'mount_native' => 'after:.filterBlock',
        // native mod tema düzeltme CSS'i: gizlenen sıralama/sayaç çubuğunun bıraktığı boşluğu toplar (Tonny teması)
        'css_native' => '.katcontent{margin-bottom:24px!important}#divSayfalamaUst,.categoryTitle{margin-bottom:0!important}',
    ];

    public const DEFAULT_RULES = [
        'hide_out_of_stock' => true,   // toplam stoğu 0 olan ürün listelenmez
        'require_image' => true,       // görseli olmayan ürün sayılmaz (Ticimax listesi de görselsiz ürünü göstermiyor — 11 Eyl kıyası: 300 vs 286'nın 13'ü)
        'size_in_stock_only' => true,  // beden facet'inde yalnız stoktaki bedenler
        'show_counts' => true,         // facet değerlerinin yanında ürün sayısı
        'per_page' => 24,
        'sort_default' => 'recommended',
        'show_more_limit' => 8,        // uzun listelerde "daha fazla" eşiği
        'sticky_apply' => true,        // mobil: altta yapışkan "X ürün göster"
        'price_buckets' => true,       // fiyat facet'inde hızlı aralık butonları
        'quick_add' => false,          // karttan beden seçip hızlı sepete ekleme (v2)
        // Segment bazlı beden aralığı: kategori URL'sindeki kelimeye göre beden facet'inde yalnız bu aralıktaki
        // SAYISAL bedenler listelenir (ör. erkek sayfasında çocuk 27 görünmez; ürün 27-43 arası tek üründe olsa da).
        // Sıra önemli: ilk eşleşen kazanır (çocuk kelimesi 'erkek-cocuk' yolunda erkekten önce yakalanır). Harf bedenler (S/M/L) etkilenmez.
        // Alt Kategori başlığında GÖSTERİLMEYECEK kategoriler (platform_category_id listesi, panelden seçilir):
        // ör. henüz dağıtımı yapılmamış "Ayakkabı" gibi geçici/teknik kategoriler. Ürünler listeden düşmez, yalnız başlıkta çıkmaz.
        'hidden_categories' => [],
        'size_ranges' => [
            ['key' => 'cocuk', 'label' => 'Çocuk', 'tokens' => 'cocuk, kiz, bebek, kids', 'min' => 18, 'max' => 38],
            ['key' => 'kadin', 'label' => 'Kadın', 'tokens' => 'kadin, bayan, women', 'min' => 35, 'max' => 42],
            ['key' => 'erkek', 'label' => 'Erkek', 'tokens' => 'erkek, men', 'min' => 39, 'max' => 47],
        ],
    ];

    public const DEFAULT_THEME = [
        'preset' => 'minimal',
        'accent' => '#111827',
        'radius' => 10,
        'chip' => 'pill',      // pill|square
        'swatch' => 'circle',  // circle|square
        'font' => 'inherit',
        'drawer_width' => 560, // masaüstü çekmece genişliği (px); mobilde çekmece tam ekrandır
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("filter:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);

            $tpl = trim((string) ($s['filter_widget_template'] ?? ''));
            $mode = trim((string) ($s['filter_mode'] ?? ''));
            $theme = static::json($s['filter_widget_theme'] ?? null);
            $rules = static::json($s['filter_rules'] ?? null);
            $selectors = static::json($s['filter_selectors'] ?? null);
            $facets = static::json($s['filter_facets'] ?? null);

            return [
                'enabled' => filter_var($s['filter_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['filter_widget_domains'] ?? ''),
                'template' => in_array($tpl, self::TEMPLATES, true) ? $tpl : 'sidebar',
                'mode' => in_array($mode, self::MODES, true) ? $mode : 'native',
                'theme' => array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []),
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
                'selectors' => array_merge(self::DEFAULT_SELECTORS, is_array($selectors) ? $selectors : []),
                // null = katalogdan otomatik (FacetCatalog::defaults)
                'facets' => is_array($facets) && $facets ? array_values($facets) : null,
            ];
        });
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("filter:tsettings:{$tenantId}");
    }

    protected static function json($v): ?array
    {
        if (is_array($v)) {
            return $v;
        }
        if (is_string($v) && $v !== '') {
            $d = json_decode($v, true);

            return is_array($d) ? $d : null;
        }

        return null;
    }
}
