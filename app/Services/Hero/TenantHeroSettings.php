<?php

namespace App\Services\Hero;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * "Bugüne Özel" Hero Ürün kulakçığı (CRO) — tenant ayarları (tenants.settings).
 * Anahtarlar: hero_enabled, hero_domains, hero_theme (JSON), hero_rules (JSON), hero_sets (JSON liste).
 *
 * Set = bir günün/dönemin hero ürünleri: {id, title, subtitle, start_date, end_date, products:[products.id…],
 * coupon, enabled, eyebrow (kulakçık/şerit metni — boşsa genel), badge (foto rozeti — boşsa Kadın/Erkek/Çocuk otomatik)}. Widget o gün geçerli İLK etkin seti gösterir (tarihli setler önce, tarihsiz "her zaman" seti yedek).
 */
class TenantHeroSettings
{
    public const PRESETS = ['red', 'black', 'gradient', 'royal', 'emerald', 'sunset'];

    public const TAB_STYLES = ['ribbon', 'pill', 'badge'];

    public const TAB_POSITIONS = ['right-middle', 'right-bottom', 'left-middle', 'left-bottom'];

    public const TIMER_MODES = ['midnight', 'set_end', 'off'];

    public const FREQUENCIES = ['day', 'session', 'always'];

    public const MAX_PRODUCTS = 4;

    public const DEFAULT_THEME = [
        'preset' => 'red',
        'accent' => '#dc2626',      // kulakçık + CTA rengi
        'accent2' => '#7f1d1d',     // başlık gradyanının koyu ucu
        'ink' => '#111827',
        'bg' => '#ffffff',
        'radius' => 20,
        'tab_style' => 'ribbon',    // ribbon (dikey şerit) | pill (yuvarlak hap) | badge (küçük rozet)
        'tab_position' => 'right-middle',
        'tab_text' => 'BUGÜNE ÖZEL',
        'tab_emoji' => '⚡',
        'tab_pulse' => true,        // nefes alan parıltı halkası
        'tab_timer' => true,        // kulakçıkta mini sayaç
        'drawer_width' => 440,      // masaüstü çekmece genişliği
        'card_layout' => 'row',     // row (yatay kart) | grid (2 sütun)
        'layout' => 'panel',        // panel (kulakçıktan yana büyüyen yan panel, ürünler yan yana) | minimal (ufak kart: tek ürün, renkler) | full (kapsamlı çekmece: beden+sepete ekle)
        'font' => '',               // boş = mağaza yazı tipi
    ];

    public const DEFAULT_RULES = [
        'eyebrow' => 'BUGÜNE ÖZEL',
        'title' => 'Günün Fırsatları',
        'subtitle' => 'Yalnızca bugün geçerli, seçili ürünlerde özel fiyat.',
        'timer_mode' => 'midnight',      // midnight (gece 23:59'a) | set_end (setin bitiş günü 23:59) | off
        'timer_label' => 'Kampanya bitimine',
        'auto_open' => true,
        'auto_open_delay' => 12,         // saniye — kulakçık açılmazsa çekmece kendiliğinden açılır
        'auto_open_scroll' => 0,         // % — 0 kapalı; bu kaydırma derinliğinde açılır (delay'den önce gelirse)
        'exit_intent' => true,           // masaüstünde fare üstten çıkarsa açılır
        'frequency' => 'day',            // day | session | always — otomatik açılma sıklığı
        'no_auto_page_types' => ['product'], // bu sayfa tiplerinde kulakçık durur ama KENDİLİĞİNDEN açılmaz (ürün sayfasında satın alma niyetini bozmasın)
        'quick_add' => true,             // Ticimax AddToCartV3 ile çekmeceden sepete ekle (beden çipleri)
        'show_stock' => true,            // gerçek stok ≤ eşiğe düştüyse "Son N adet" (sahte aciliyet YOK)
        'stock_threshold' => 5,
        'show_discount_badge' => true,
        'best_color' => true,            // gösterilen renk kartı = modelin en çok satan (90g) + en çok tıklanan (30g) rengi
        'cta_text' => 'Sepete Ekle',
        'view_text' => 'Ürünü İncele',
        'footer_text' => '',             // örn. "Tüm kampanyaları gör"
        'footer_url' => '',
        'hide_paths' => '/checkout,/sepet,/odeme,/Sepetim,/UyeGiris,/Hesabim',
        'hide_page_types' => [],         // home|category|product|account|other
        'mobile_sheet' => true,          // mobilde alt sayfa (bottom sheet); false = yandan çekmece
        'max_width' => 0,                // 0 = her ekranda; >0 = yalnız bu genişliğe kadar (mobil)
        'min_width' => 0,                // >0 = yalnız bu genişlikten büyük (masaüstü)
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("hero:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['hero_theme'] ?? null);
            $rules = static::json($s['hero_rules'] ?? null);
            $sets = static::json($s['hero_sets'] ?? null);
            $theme = array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []);
            if (! in_array($theme['preset'], self::PRESETS, true)) {
                $theme['preset'] = 'red';
            }

            return [
                'enabled' => filter_var($s['hero_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['hero_domains'] ?? ''),
                'theme' => $theme,
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
                'sets' => is_array($sets) ? static::sanitizeSets($sets) : [],
            ];
        });
    }

    /** Setleri temizler: id, başlık, kulakçık metni, rozet, tarih (Y-m-d), ürün id listesi (max 4), kupon, etkin. */
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
            $id = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($st['id'] ?? ''))) ?: ('s'.substr(md5((string) microtime(true).$i), 0, 8));
            $out[] = [
                'id' => mb_substr($id, 0, 24),
                'title' => mb_substr(trim((string) ($st['title'] ?? '')), 0, 60),
                'subtitle' => mb_substr(trim((string) ($st['subtitle'] ?? '')), 0, 140),
                'eyebrow' => mb_substr(trim((string) ($st['eyebrow'] ?? '')), 0, 24),
                'badge' => mb_substr(trim((string) ($st['badge'] ?? '')), 0, 20),
                'start_date' => static::date($st['start_date'] ?? null),
                'end_date' => static::date($st['end_date'] ?? null),
                'products' => $ids,
                'coupon' => mb_substr(strtoupper(trim((string) ($st['coupon'] ?? ''))), 0, 32),
                'coupon_text' => mb_substr(trim((string) ($st['coupon_text'] ?? '')), 0, 100),
                'enabled' => filter_var($st['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            ];
            if (++$i >= 60) {
                break;
            }
        }

        return $out;
    }

    /**
     * Bugün (TR) geçerli set: tarihli & etkin & ürünlü setler önce (en dar aralık kazanır), sonra tarihsiz yedek.
     * $day Y-m-d (varsayılan bugün, Europe/Istanbul).
     */
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
        Cache::forget("hero:tsettings:{$tenantId}");
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
