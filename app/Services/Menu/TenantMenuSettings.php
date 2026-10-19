<?php

namespace App\Services\Menu;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Menü (CRO) — tenant ayarları (tenants.settings). Anahtarlar: menu_enabled, menu_domains,
 * menu_theme (JSON), menu_rules (JSON), menu_virtual (JSON liste), menu_overrides (JSON: pinned/hidden/labels/images/order/segments_hidden).
 */
class TenantMenuSettings
{
    /** menu.js sürümü — her widget değişikliğinde artır (Cloudflare edge cache). */
    public const WIDGET_VERSION = 22;

    public const PRESETS = ['cards', 'list', 'bento', 'story', 'mono', 'dark'];

    public const DEFAULT_THEME = [
        'preset' => 'cards',
        'accent' => '#111827',   // vurgu (aktif sekme, rozet)
        'bg' => '#ffffff',       // panel zemini
        'ink' => '#111827',      // metin
        'tile_bg' => '#f3f4f6',  // kart zemini
        'radius' => 14,          // kart köşesi (px)
        'label_case' => 'normal', // normal|upper
        'columns' => 2,          // kart sütunu (cards/mono)
        'image_fit' => 'cover',  // cover|contain
        'show_shadow' => false,
        'full_width' => false,   // true: panel ekranın tamamını kaplar (430px sınırı kalkar)
        'logo_url' => '',        // boş: temanın header logosu sayfadan otomatik alınır; yoksa mağaza adı yazılır
    ];

    public const DEFAULT_RULES = [
        'mount' => 'both',            // hamburger|bottombar|both — menü nereden açılır
        'max_width' => 899,           // bu genişliğin üstünde widget devreye girmez (masaüstü tema menüsü kalır)
        'default_tab' => 'remember',  // remember (cihaz hafızası → satış) | sales | catalog
        'sort' => 'sales_30d',        // sales_30d|sales_7d|catalog — kart sırası
        'season_boost' => true,       // 13 aylık satış eğrisine göre sezon çarpanı + "Sezon ↑" rozeti
        'personalize' => true,        // cihazda gezilen kategoriler öne, "Son baktığın" rozeti
        'show_recent' => true,        // en üstte "Kaldığın yer" satırı (son gezilen kategoriler/ürün)
        'badges' => true,             // Çok satan / Yeni / Sezon rozetleri
        'show_counts' => true,        // kartta ürün sayısı
        'hide_min_products' => 3,     // bu sayının altında ürünü olan kategori gizlenir
        'max_tiles' => 0,             // segment başına en fazla kart; 0 = hepsi (kaydırarak)
        'group_headers' => false,     // ara başlık (Ayakkabı / Sandalet & Terlik…) göster
        'virtual_position' => 'top',  // top (çip satırı) | bottom (kartlar) | both
        'show_products' => true,      // "Şu an en çok satanlar / Sana özel" ürün satırı
        'products_count' => 6,
        'product_name_max' => 34,     // ürün satırında ad uzunluğu (SKU kodu atılır, kelime sınırında kısaltılır)
        'products_source' => 'auto',  // auto (üye ise kişisel, değilse popüler) | popular | personal
        'show_search' => true,        // panel üstünde arama kutusu (Akıllı Arama'yı açar)
        'show_all_link' => true,      // segment altında "Tüm Kadın →"
        'segments_max' => 3,
        'footer_links' => true,       // Hesabım / Siparişlerim / İletişim
        'hide_paths' => '',
        'count_assigned' => false,    // kart sayısı: ürünün TÜM kategori atamaları (Ticimax listesiyle aynı; product_platform_categories) — false = yalnız birincil category_path
        'nav_promo' => false,         // masaüstü tema menüsünde (Ticimax .newHeaderNavUl) 'Üst bant' kampanyalarını aynı renk/rozetle vurgula
    ];

    /** Varsayılan sanal kategoriler — Ticimax URL parametreleriyle çalışır ({seg} = aktif segment yolu). */
    public static function defaultVirtual(): array
    {
        return [
            ['key' => 'price', 'label' => '{min}–{max} TL', 'url' => '{seg}?min={min}&max={max}', 'style' => 'chip', 'icon' => 'tag', 'emoji' => '🏷️', 'look' => 'gradient', 'color' => '#d97706', 'auto_price' => true, 'enabled' => true],
            ['key' => 'bestsellers', 'label' => 'Çok Satanlar', 'url' => '{seg}?sira=satis-adedi|azalan', 'style' => 'chip', 'icon' => 'fire', 'emoji' => '🔥', 'look' => 'solid', 'color' => '#e11d48', 'enabled' => true],
            ['key' => 'new', 'label' => 'Yeni Gelenler', 'url' => '{seg}?sira=eklenme-tarihi|azalan', 'style' => 'chip', 'icon' => 'sparkles', 'emoji' => '✨', 'look' => 'solid', 'color' => '#0284c7', 'enabled' => true],
            ['key' => 'discount', 'label' => 'İndirimliler', 'url' => '{seg}?indirimli=1', 'style' => 'chip', 'icon' => 'percent', 'enabled' => true],
        ];
    }

    public const DEFAULT_OVERRIDES = [
        'pinned' => [],          // kategori url listesi — sıradan bağımsız en başta
        'hidden' => [],          // kategori url listesi — gösterilmez
        'labels' => [],          // url => kısa etiket
        'images' => [],          // url => görsel url
        'order' => [],           // segment url => [url,...] (sort=catalog iken elle sıra)
        'segments_hidden' => [], // kök kategori url listesi
        'segments_order' => [],  // kök url sırası
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("menu:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = array_merge(self::DEFAULT_THEME, static::json($s['menu_theme'] ?? null) ?? []);
            if (! in_array($theme['preset'], self::PRESETS, true)) {
                $theme['preset'] = 'cards';
            }
            $virtual = static::json($s['menu_virtual'] ?? null);

            return [
                'enabled' => filter_var($s['menu_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['menu_domains'] ?? ''),
                'theme' => $theme,
                'rules' => array_merge(self::DEFAULT_RULES, static::json($s['menu_rules'] ?? null) ?? []),
                'virtual' => is_array($virtual) ? static::sanitizeVirtual($virtual) : self::defaultVirtual(),
                'virtual_customized' => is_array($virtual),
                'overrides' => array_merge(self::DEFAULT_OVERRIDES, static::json($s['menu_overrides'] ?? null) ?? []),
            ];
        });
    }

    /** @return array<string,string> segment url (küçük harf) → hedef url; en fazla 8 kayıt */
    protected static function sanitizeUrls($urls): array
    {
        $out = [];
        if (! is_array($urls)) {
            return $out;
        }
        foreach ($urls as $seg => $u) {
            $seg = strtolower(trim((string) $seg));
            $u = mb_substr(trim((string) $u), 0, 300);
            if ($seg === '' || $u === '' || ! str_starts_with($seg, '/')) {
                continue;
            }
            $out[$seg] = $u;
            if (count($out) >= 8) {
                break;
            }
        }

        return $out;
    }

    public static function sanitizeVirtual(array $items): array
    {
        $out = [];
        $i = 0;
        foreach ($items as $it) {
            if (! is_array($it)) {
                continue;
            }
            $label = mb_substr(trim((string) ($it['label'] ?? '')), 0, 40);
            $url = mb_substr(trim((string) ($it['url'] ?? '')), 0, 300);
            if ($label === '' || $url === '') {
                continue;
            }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($it['key'] ?? ''))) ?: 'v'.$i;
            $out[] = [
                'key' => mb_substr($key, 0, 32),
                'label' => $label,
                'url' => $url,
                'style' => in_array($it['style'] ?? '', ['chip', 'card', 'hero'], true) ? $it['style'] : 'chip',
                'icon' => preg_replace('/[^a-z]/', '', (string) ($it['icon'] ?? '')) ?: 'tag',
                'emoji' => mb_substr(trim((string) ($it['emoji'] ?? '')), 0, 6), // rozet metni de olabilir ("10/10")
                'look' => in_array($it['look'] ?? '', ['plain', 'solid', 'gradient', 'glow'], true) ? $it['look'] : 'plain',
                'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($it['color'] ?? '')) ? strtolower($it['color']) : '',
                'color2' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($it['color2'] ?? '')) ? strtolower($it['color2']) : '', // hero: gradyan bitiş rengi
                'auto_price' => filter_var($it['auto_price'] ?? false, FILTER_VALIDATE_BOOLEAN), // segment başına otomatik fiyat bandı ({min}/{max} hesaplanır)
                'image' => mb_substr(trim((string) ($it['image'] ?? '')), 0, 400),
                'note' => mb_substr(trim((string) ($it['note'] ?? '')), 0, 60),
                'nav' => in_array($it['nav'] ?? '', ['text', 'dot'], true) ? $it['nav'] : 'pill', // hero: masaüstü menü vurgusu — pill (rozetli kapsül) | dot (kapsül, rozet yerine nokta) | text (yalnız renkli kalın yazı)
                'enabled' => filter_var($it['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
                // segment başına ayrı hedef (segment url → link); {seg} şablonunu ezer. Ör. kampanya + Ticimax native cinsiyet filtresi
                'urls' => self::sanitizeUrls($it['urls'] ?? null),
            ];
            if (++$i >= 12) {
                break;
            }
        }

        return $out;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("menu:tsettings:{$tenantId}");
        Cache::forget("menu:data:{$tenantId}");
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
