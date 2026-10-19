<?php

namespace App\Services\BottomBar;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Mobil Alt Bar — tenant ayarları (tenants.settings). Anahtarlar: bottombar_enabled, bottombar_domains,
 * bottombar_theme (JSON), bottombar_items (JSON sıralı liste), bottombar_rules (JSON).
 */
class TenantBottomBarSettings
{
    public const PRESETS = ['classic', 'soft', 'expand', 'pill', 'float', 'gradient', 'dark', 'minimal'];

    public const ITEM_TYPES = ['home', 'categories', 'search', 'cart', 'account', 'favorites', 'campaign', 'whatsapp', 'custom'];

    public const ICONS = ['home', 'grid', 'search', 'bag', 'cart', 'user', 'heart', 'bell', 'tag', 'percent', 'gift', 'whatsapp', 'chat', 'star', 'phone', 'sparkles', 'truck'];

    public const DEFAULT_THEME = [
        'preset' => 'classic',
        'accent' => '#111827',
        'bg' => '#ffffff',
        'ink' => '#374151',
        'labels' => true,        // sekme etiketleri
        'icon_style' => 'line',  // line|solid
        'radius' => 18,          // pill/float için köşe
        'hide_on_scroll' => false,
        'show_shadow' => true,
        'center_item' => '',     // float teması: yükseltilmiş orta butona hangi sekme (item key); boş = ortadaki
    ];

    public const DEFAULT_RULES = [
        'cart_badge' => true,          // sepet adedi rozeti
        'account_name' => true,        // giriş yapmışsa "Hesabım" yerine ad
        'categories_source' => 'yunbi', // yunbi (kendi alt sayfamız) | theme (temanın menüsü)
        'search_action' => 'yunbi',    // yunbi (Akıllı Arama) | theme (tema araması)
        'cart_action' => 'page',       // page (sepet sayfası) | side (Ticimax yan sepet)
        // sepet ve sonrası (ödeme akışı) + üyelik sayfaları: müşteri ödeme adımından geri dönmesin
        'hide_paths' => '',
        // sayfa tipine göre gizleme (cart daima gizli): home|category|product|account|other
        'hide_page_types' => ['product'],
        'max_width' => 899,            // bu genişliğin üstünde gösterilmez
        'sheet_levels' => 2,           // kategori alt sayfasında derinlik
    ];

    public static function defaultItems(): array
    {
        return [
            ['key' => 'home', 'type' => 'home', 'label' => 'Anasayfa', 'icon' => 'home', 'url' => '/', 'enabled' => true],
            ['key' => 'categories', 'type' => 'categories', 'label' => 'Kategoriler', 'icon' => 'grid', 'url' => '', 'enabled' => true],
            ['key' => 'search', 'type' => 'search', 'label' => 'Ara', 'icon' => 'search', 'url' => '', 'enabled' => true],
            ['key' => 'favorites', 'type' => 'favorites', 'label' => 'Favoriler', 'icon' => 'heart', 'url' => '/Hesabim.aspx#/Favorilerim', 'enabled' => false],
            ['key' => 'campaign', 'type' => 'campaign', 'label' => 'Kampanya', 'icon' => 'percent', 'url' => '/firsat-urunleri', 'enabled' => false],
            ['key' => 'account', 'type' => 'account', 'label' => 'Hesabım', 'icon' => 'user', 'url' => '/Hesabim', 'enabled' => true],
            ['key' => 'cart', 'type' => 'cart', 'label' => 'Sepetim', 'icon' => 'bag', 'url' => '', 'enabled' => true],
        ];
    }

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("bottombar:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['bottombar_theme'] ?? null);
            $rules = static::json($s['bottombar_rules'] ?? null);
            $items = static::json($s['bottombar_items'] ?? null);
            $theme = array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []);
            if (! in_array($theme['preset'], self::PRESETS, true)) {
                $theme['preset'] = 'classic';
            }

            return [
                'enabled' => filter_var($s['bottombar_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['bottombar_domains'] ?? ''),
                'theme' => $theme,
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
                'items' => is_array($items) && $items ? static::sanitizeItems($items) : self::defaultItems(),
                'items_customized' => is_array($items) && $items,
            ];
        });
    }

    public static function sanitizeItems(array $items): array
    {
        $out = [];
        $i = 0;
        foreach ($items as $it) {
            if (! is_array($it)) {
                continue;
            }
            $type = in_array($it['type'] ?? '', self::ITEM_TYPES, true) ? $it['type'] : 'custom';
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($it['key'] ?? ($type === 'custom' ? 'custom'.$i : $type)))) ?: $type.$i;
            $out[] = [
                'key' => mb_substr($key, 0, 32),
                'type' => $type,
                'label' => mb_substr(trim((string) ($it['label'] ?? '')), 0, 20) ?: ucfirst($type),
                'icon' => in_array($it['icon'] ?? '', self::ICONS, true) ? $it['icon'] : 'star',
                'url' => mb_substr(trim((string) ($it['url'] ?? '')), 0, 200),
                'enabled' => filter_var($it['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            ];
            if (++$i >= 8) {
                break;
            }
        }

        return $out;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("bottombar:tsettings:{$tenantId}");
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
