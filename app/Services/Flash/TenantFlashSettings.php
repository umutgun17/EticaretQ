<?php

namespace App\Services\Flash;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * "Flaş İndirim" ana sayfa vitrini (CRO) — tenant ayarları (tenants.settings).
 * Anahtarlar: flash_enabled, flash_domains, flash_theme (JSON), flash_rules (JSON), flash_sets (JSON liste).
 *
 * Mantık: ana sayfa slider'ının yerine (veya önüne) gömülen, süreli flaş indirim vitrini. Panelden seçilen
 * 4–12 gerçek ürün, gerçek sayaç (bu gece 23:59 / set bitişi), gerçek satış & stok verisi, sepette ekstra kupon.
 * 6 yerleşim (spotlight|grid|rail|split|tabs|stories) × 6 renk ön ayarı (rain|night|red|ember|forest|mono).
 * Set = bir dönemin vitrini: {id, title, subtitle, eyebrow, start_date, end_date, products[], coupon, coupon_text, enabled}.
 * Bugün geçerli İLK etkin set gösterilir (tarihli setler önce, tarihsiz yedek).
 */
class TenantFlashSettings
{
    public const PRESETS = ['tonny', 'tonnywhite', 'rain', 'night', 'red', 'ember', 'forest', 'mono'];

    public const LAYOUTS = ['spotlight', 'grid', 'rail', 'split', 'tabs', 'stories'];

    public const TIMER_MODES = ['midnight', 'set_end', 'off', 'zero'];

    public const MOUNT_MODES = ['replace', 'before', 'after', 'prepend'];

    public const MAX_PRODUCTS = 24;

    public const DEFAULT_THEME = [
        'preset' => 'rain',
        'layout' => 'spotlight',
        'accent' => '#1d4ed8',      // vurgu (sayaç kutuları, CTA)
        'accent2' => '#0b1a3f',     // zemin gradyanının koyu ucu
        'bg' => '#0f1f4a',          // poster/başlık zemini
        'ink' => '#111827',         // kart metni (açık kartlar)
        'card_bg' => '#ffffff',
        'radius' => 18,
        'rain' => true,             // yağmur animasyonu (reduced-motion'da kapanır)
        'font' => '',               // boş = mağaza yazı tipi
        'container_width' => 1200,  // px; 0 = tam genişlik
        'width' => 'container',     // container (yuvarlak köşeli kutu) | full (kenardan kenara, Tonny tarzı)
        'dark_cards' => false,      // kartlar koyu zeminde (night preset)
    ];

    public const DEFAULT_RULES = [
        'eyebrow' => 'FLAŞ İNDİRİM',
        'title' => 'Bu Geceye Özel',
        'subtitle' => 'Yağmurlu günlerin botları, yalnızca bu gece bu fiyata.',
        'timer_mode' => 'midnight',
        'timer_label' => 'Bitimine',
        'pages' => ['home'],             // hangi sayfa tiplerinde (home|category|product|other)
        'mount' => '#sliderblok_0, [id^="sliderblok_"]', // çapa seçici (ilk eşleşen)
        'mount_mode' => 'replace',       // replace (çapayı gizle, yerine) | before | after | prepend (çapanın içine en üste)
        'mount_fallback' => '#mainHolder_divDesign, #divIcerik, main', // çapa yoksa buraya prepend
        'max_products' => 8,
        'rotate_hours' => 0,             // >0: set listesi bu kadar saatte bir rotate_step kadar kaydırılır (ana sayfadaki 4'lü değişir)
        'rotate_step' => 4,
        'rotate_mode' => 'time',         // time: herkes aynı anda aynı 4'lü, periyotla döner | visitor: her ziyaretçi (oturum) rastgele pencere görür
        'rows' => 1,                     // grid/tabs masaüstü satır sayısı (1–3; mobil en çok 2×2)
        'quick_add' => true,             // Ticimax AddToCartV3 ile kart içinden beden seçip sepete ekle
        'show_sold' => true,             // gerçek 14 gün satış adedi ("Bu hafta 275 satıldı")
        'sold_threshold' => 10,          // bu adedin altında gösterme
        'show_stock' => true,            // gerçek stok ≤ eşik → "Son N adet"
        'stock_threshold' => 5,
        'min_sizes' => 3,                // bedenli üründe en az bu kadar beden stokta olmalı (yoksa vitrine girmez)
        'show_bar' => true,              // satıldı/kaldı çubuğu (gerçek oran)
        'show_segment' => true,          // Kadın/Erkek/Çocuk çipi
        'cta_text' => 'Hemen Al',
        'view_text' => 'İncele',
        'footer_text' => 'Tüm flaş ürünleri gör',
        'footer_url' => '',
        'coupon_label' => 'Sepette ekstra',
        'hover_swap' => true,            // masaüstünde ikinci fotoğrafa geçiş
        'min_width' => 0,
        'max_width' => 0,
        'hide_paths' => '/checkout,/sepet,/odeme,/Sepetim',
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("flash:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['flash_theme'] ?? null);
            $rules = static::json($s['flash_rules'] ?? null);
            $sets = static::json($s['flash_sets'] ?? null);
            $theme = array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []);
            if (! in_array($theme['preset'], self::PRESETS, true)) {
                $theme['preset'] = 'rain';
            }
            if (! in_array($theme['layout'], self::LAYOUTS, true)) {
                $theme['layout'] = 'spotlight';
            }

            return [
                'enabled' => filter_var($s['flash_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['flash_domains'] ?? ''),
                'theme' => $theme,
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
                'sets' => is_array($sets) ? static::sanitizeSets($sets) : [],
            ];
        });
    }

    public static function sanitizeSets(array $sets): array
    {
        $out = [];
        $i = 0;
        foreach ($sets as $st) {
            if (! is_array($st)) {
                continue;
            }
            $ids = [];
            foreach ((array) ($st['products'] ?? []) as $pid) {
                $pid = (int) $pid;
                if ($pid > 0 && ! in_array($pid, $ids, true)) {
                    $ids[] = $pid;
                }
                if (count($ids) >= self::MAX_PRODUCTS) {
                    break;
                }
            }
            $id = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($st['id'] ?? ''))) ?: ('f'.substr(md5((string) microtime(true).$i), 0, 8));
            $out[] = [
                'id' => mb_substr($id, 0, 24),
                'title' => mb_substr(trim((string) ($st['title'] ?? '')), 0, 60),
                'subtitle' => mb_substr(trim((string) ($st['subtitle'] ?? '')), 0, 140),
                'eyebrow' => mb_substr(trim((string) ($st['eyebrow'] ?? '')), 0, 30),
                'start_date' => static::date($st['start_date'] ?? null),
                'end_date' => static::date($st['end_date'] ?? null),
                'products' => $ids,
                'coupon' => mb_substr(strtoupper(trim((string) ($st['coupon'] ?? ''))), 0, 32),
                'coupon_mode' => in_array($st['coupon_mode'] ?? '', ['none', 'code', 'auto'], true) ? $st['coupon_mode'] : (! empty($st['coupon']) ? 'code' : 'none'), // auto = kod yok, sepette Ticimax kampanyası otomatik uygular
                'coupon_text' => mb_substr(trim((string) ($st['coupon_text'] ?? '')), 0, 100),
                'coupon_pct' => max(0, min(90, (int) ($st['coupon_pct'] ?? 0))), // sepette ekstra % (vitrinde "Sepette X TL" hesabı)
                'enabled' => filter_var($st['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            ];
            if (++$i >= 60) {
                break;
            }
        }

        return $out;
    }

    /** Bugün (TR) geçerli set: tarihli & etkin & ürünlü setler önce (en dar aralık kazanır), sonra tarihsiz yedek. */
    public static function activeSet(array $sets, ?string $day = null): ?array
    {
        $day = $day ?: now('Europe/Istanbul')->format('Y-m-d');
        $best = null;
        $bestSpan = PHP_INT_MAX;
        $fallback = null;
        foreach ($sets as $st) {
            if (! $st['enabled'] || ! $st['products']) {
                continue;
            }
            $s = $st['start_date'];
            $e = $st['end_date'];
            if ($s === null && $e === null) {
                $fallback = $fallback ?? $st;

                continue;
            }
            if (($s !== null && $day < $s) || ($e !== null && $day > $e)) {
                continue;
            }
            $span = ($s !== null && $e !== null) ? (strtotime($e) - strtotime($s)) : PHP_INT_MAX - 1;
            if ($span < $bestSpan) {
                $best = $st;
                $bestSpan = $span;
            }
        }

        return $best ?? $fallback;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("flash:tsettings:{$tenantId}");
    }

    protected static function date($v): ?string
    {
        $v = trim((string) $v);
        if ($v === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || strtotime($v) === false) {
            return null;
        }

        return $v;
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
