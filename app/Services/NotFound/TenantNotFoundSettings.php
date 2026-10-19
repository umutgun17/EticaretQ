<?php

namespace App\Services\NotFound;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * 404 Sayfası (CRO) — mağazanın "sayfa bulunamadı" ekranını eğlenceli bir şablon + ürün önerisiyle değiştirir.
 * Firma panelden bir şablon SEÇER, seçili şablon canlıya çıkar (tek aktif şablon).
 * Anahtarlar: notfound_enabled, notfound_domains, notfound_template, notfound_content (JSON), notfound_rules (JSON).
 *
 * Ürün kaynakları (hepsi gerçek veri):
 *  - "Bunu mu arıyordunuz?": kırık URL'deki kelimeler/ürün kodu Akıllı Arama motorunda aranır (silinen ürünün kardeşleri).
 *  - Öneri rafı: bestseller (son N gün ödenmiş satış) | new (son açılan stoklu) | manual (seçilen ürünler).
 */
class TenantNotFoundSettings
{
    /** Şablon kimlikleri — widget (notfound.js) ve panel aynı listeyi kullanır. */
    public const TEMPLATES = ['lost_pair', 'space', 'balloons', 'detective', 'arcade', 'minimal'];

    public const SOURCES = ['bestseller', 'new', 'manual'];

    public const MAX_MANUAL = 24;

    public const DEFAULT_CONTENT = [
        // Boş metin = şablonun kendi varsayılan metni (notfound.js içinde)
        'title' => '',
        'subtitle' => '',
        'show_search' => true,
        'show_matched' => true,          // kırık URL'den "Bunu mu arıyordunuz?"
        'matched_title' => 'Bunu mu arıyordunuz?',
        'show_products' => true,
        'products_title' => 'Herkesin kapıştığı ürünler',
        'products_source' => 'bestseller',
        'products_days' => 7,
        'product_count' => 8,
        'product_ids' => [],             // manual kaynak: products.id sırası
        'show_categories' => true,
        'categories' => [],              // boş = en çok ürünlü kategoriler otomatik; dolu = [{name,url}]
        'home_text' => 'Ana sayfaya dön',
        'coupon_code' => '',             // yalnız mağazanın GERÇEK kuponu; boşsa kupon alanı hiç çizilmez
        'coupon_text' => '',
        'accent' => '',                  // boş = şablonun kendi rengi
    ];

    public const DEFAULT_RULES = [
        'display' => 'overlay',          // overlay (tam ekran, kendi başlığıyla) | inline (tema içerik alanına) | auto (alan bulunursa inline)
        'mount_selector' => '#ContentArea, .pageNotFound, .notFoundPage, .error-page, main, #mainContent, .mainContent',
        'hide_selectors' => '',          // inline modda gizlenecek tema 404 öğeleri
        'search_url' => '/arama?q={q}',  // Akıllı Arama yoksa bu adrese gidilir
        // Tespit (widget varsayılanlarına EK; embed koduna data-* olarak yazılır)
        'detect_paths' => '',
        'detect_selectors' => '',
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("notfound:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $content = static::json($s['notfound_content'] ?? null);
            $rules = static::json($s['notfound_rules'] ?? null);
            $tpl = (string) ($s['notfound_template'] ?? 'lost_pair');

            return [
                'enabled' => filter_var($s['notfound_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['notfound_domains'] ?? ''),
                'template' => in_array($tpl, self::TEMPLATES, true) ? $tpl : 'lost_pair',
                'content' => static::sanitizeContent(array_merge(self::DEFAULT_CONTENT, is_array($content) ? $content : [])),
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
            ];
        });
    }

    public static function sanitizeContent(array $c): array
    {
        if (! in_array($c['products_source'], self::SOURCES, true)) {
            $c['products_source'] = 'bestseller';
        }
        $c['product_count'] = max(2, min(16, (int) $c['product_count']));
        $c['products_days'] = max(1, min(90, (int) $c['products_days']));
        $c['product_ids'] = array_values(array_unique(array_slice(array_map('intval', array_filter((array) $c['product_ids'], 'is_numeric')), 0, self::MAX_MANUAL)));
        $cats = [];
        foreach ((array) $c['categories'] as $cat) {
            $name = mb_substr(trim((string) ($cat['name'] ?? '')), 0, 40);
            $url = trim((string) ($cat['url'] ?? ''));
            if ($name !== '' && $url !== '' && preg_match('~^(/|https?://)~', $url) && count($cats) < 10) {
                $cats[] = ['name' => $name, 'url' => mb_substr($url, 0, 300)];
            }
        }
        $c['categories'] = $cats;
        $c['accent'] = preg_match('/^#[0-9a-fA-F]{6}$/', (string) $c['accent']) ? $c['accent'] : '';

        return $c;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("notfound:tsettings:{$tenantId}");
        Cache::forget("notfound:rail:{$tenantId}");
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
