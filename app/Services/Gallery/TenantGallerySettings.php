<?php

namespace App\Services\Gallery;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Ürün Galerisi (CRO) — ürün detay sayfasında temanın görsel slider'ını Yunbi galerisiyle değiştirir:
 * üstte büyük ana görsel (kaydırmalı), altında küçük görseller, dokununca tam ekran inceleme
 * (pinch/çift dokunuş yakınlaştırma, kaydırma, küçük görsel şeridi).
 * Anahtarlar: gallery_enabled, gallery_domains, gallery_theme (JSON), gallery_rules (JSON).
 */
class TenantGallerySettings
{
    public const DEVICES = ['mobile', 'all', 'desktop'];

    public const THUMB_STYLES = ['square', 'round', 'tall', 'photo'];

    public const DOT_STYLES = ['dots', 'counter', 'both', 'none'];

    public const DEFAULT_THEME = [
        'accent' => '#111827',      // aktif küçük görsel çerçevesi + sayaç
        'bg' => '#ffffff',
        'thumb_size' => 64,         // küçük görsel kenarı (px, mobil)
        'thumb_style' => 'square',  // square | round | tall (3:4)
        'thumb_gap' => 8,
        'radius' => 10,             // ana görsel köşe
        'indicator' => 'both',      // dots | counter | both | none
        'aspect' => 'photo',        // ana görsel oranı: photo (fotoğrafın kendi oranı, kırpma yok) | 1:1 | 2:3 | 3:4 | 4:5 | auto
        'fit' => 'cover',           // cover | contain
        'zoom_hint' => true,        // sağ altta "büyüt" ikonu
        'viewer_bg' => '#000000',   // tam ekran zemin
        'font' => '',
    ];

    public const DEFAULT_RULES = [
        'devices' => 'mobile',       // mobile | all | desktop
        'max_width' => 991,          // mobile modunda bu genişliğe kadar
        'max_zoom' => 4,             // tam ekran maksimum yakınlaştırma
        'double_tap_zoom' => 2.5,
        'viewer_enabled' => true,    // ana görsele dokununca tam ekran inceleme
        'show_title' => true,        // tam ekranda ürün adı
        'share_button' => true,      // tam ekranda paylaş (Web Share / bağlantı kopyala)
        'download_button' => true,   // tam ekranda görseli indir
        'zoom_enabled' => true,      // tam ekranda yakınlaştırma (pinch/çift dokunuş/tekerlek)
        'indicator_arrows' => true,  // masaüstünde ok butonları
        'thumbs_on_page' => true,    // sayfada küçük görseller
        'thumbs_in_viewer' => true,  // tam ekranda alt şerit
        'swipe_main' => true,        // ana görselde yana kaydırma
        'autoplay' => false,
        'source_selector' => '#divMobileImageList .owl-item:not(.cloned) a.lightItem, .Images .imageZoomPreview a, #divUrunResimleri a, .productImages a',
        'hide_selector' => '#divMobileImageList, .Images.imageZoomPreview, .leftImage .owl-dots',
        'mount_selector' => 'before:#divMobileImageList, before:.Images.imageZoomPreview, replace:.leftImage',
        'preload' => 2,              // ilk N görsel önden yüklenir
        'hide_paths' => '',
        'video_ab' => false,         // ürün videosu A/B: A = video gösterilir, B = gizlenir (ziyaretçiye sabit)
        'video_ab_share' => 50,      // A kovasının yüzdesi
        'video_ab_since' => '',      // A/B'nin (son) açıldığı an (UTC, karne başlangıcı)
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("gallery:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['gallery_theme'] ?? null);
            $rules = static::json($s['gallery_rules'] ?? null);
            $theme = array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []);
            $rules = array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []);
            if (! in_array($rules['devices'], self::DEVICES, true)) {
                $rules['devices'] = 'mobile';
            }
            if (! in_array($theme['thumb_style'], self::THUMB_STYLES, true)) {
                $theme['thumb_style'] = 'square';
            }
            if (! in_array($theme['indicator'], self::DOT_STYLES, true)) {
                $theme['indicator'] = 'both';
            }

            return [
                'enabled' => filter_var($s['gallery_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['gallery_domains'] ?? ''),
                'theme' => $theme,
                'rules' => $rules,
            ];
        });
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("gallery:tsettings:{$tenantId}");
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
