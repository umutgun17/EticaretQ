<?php

namespace App\Services\ForYou;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * "Sana Özel" öneri kulakçığı (CRO) — ziyaretçi dolaştıkça kişiselleşen 3-4 ürünlük yan panel.
 * Anahtarlar: foryou_enabled, foryou_domains, foryou_rules (JSON).
 *
 * Kademeli kaynak (ziyaretçi ne kadar sinyal verdiyse o kadar kişisel):
 *   bestseller → category (ürün/kategori sayfasının kategorisinde çok satanlar) → viewed (gezdiği ürünler)
 *   → cart (sepeti) → history (üyenin önceki siparişleri, use_history açıksa)
 */
class TenantForYouSettings
{
    public const MODES = ['bestseller', 'category', 'viewed', 'cart', 'history'];

    public const DEFAULT_RULES = [
        'title' => 'Sana Özel',
        'tab_text' => 'SANA ÖZEL',
        'subtitle_bestseller' => 'Şu an en çok sevilenler',
        'subtitle_category' => '{category} içinde en çok satanlar',
        'subtitle_viewed' => 'Baktığın ürünlere göre seçtik',
        'subtitle_cart' => 'Sepetindekilere yakışır',
        'subtitle_history' => 'Önceki alışverişlerine göre',
        'count' => 6,
        'accent' => '#111111',
        'side' => 'right',               // right | left
        'show_add' => true,              // panelde "Sepete ekle"
        'nudge_after' => 3,              // oturumda bu kadar ürün gezince kulakçık bir kez küçük balon gösterir (0 = hiç)
        'nudge_text' => 'Sana özel {count} ürün hazır',
        'product_page' => 'subtle',      // ürün sayfasında kulakçık: subtle (silik) | normal | hidden
        'hide_paths' => '/checkout, /cart',
        'bestseller_days' => 30,
        'use_history' => true,           // üye tanındıysa önceki siparişleri de hesaba kat
        'pulse' => true,                 // kulakçık arada yumuşakça nefes alır (dikkat)
        // Otomatik açılma: ürün/ödeme sayfasında ASLA; günde en fazla auto_daily kez; kapatan o gün bir daha görmez
        'auto_open' => true,
        'auto_views' => 3,               // oturumda bu kadar ürün gezip ürün dışı sayfaya dönünce aç (0 = kapalı)
        'auto_delay' => 8,               // ...ama sayfaya gelir gelmez değil: bu kadar saniye sonra (sayfa önce algılansın)
        'auto_idle' => 25,               // ana sayfa/kategori sayfasında bu kadar saniye durunca aç (0 = kapalı)
        'auto_exit' => true,             // masaüstünde imleç sekmeyi terk ederken aç
        'auto_daily' => 1,
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("foryou:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $rules = $s['foryou_rules'] ?? null;
            if (is_string($rules)) {
                $rules = json_decode($rules, true);
            }

            return [
                'enabled' => filter_var($s['foryou_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['foryou_domains'] ?? ''),
                'rules' => static::sanitizeRules(array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : [])),
            ];
        });
    }

    public static function sanitizeRules(array $r): array
    {
        $out = [];
        foreach (self::DEFAULT_RULES as $k => $def) {
            $v = $r[$k] ?? $def;
            $out[$k] = match (true) {
                is_bool($def) => filter_var($v, FILTER_VALIDATE_BOOLEAN),
                is_int($def) => (int) $v,
                default => mb_substr(trim((string) $v), 0, 200),
            };
        }
        $out['count'] = max(2, min(8, $out['count']));
        $out['nudge_after'] = max(0, min(20, $out['nudge_after']));
        $out['bestseller_days'] = max(7, min(180, $out['bestseller_days']));
        $out['auto_views'] = max(0, min(20, $out['auto_views']));
        $out['auto_delay'] = max(0, min(120, $out['auto_delay']));
        $out['auto_idle'] = max(0, min(300, $out['auto_idle']));
        $out['auto_daily'] = max(1, min(5, $out['auto_daily']));
        $out['side'] = $out['side'] === 'left' ? 'left' : 'right';
        $out['product_page'] = in_array($out['product_page'], ['subtle', 'normal', 'hidden'], true) ? $out['product_page'] : 'subtle';
        $out['accent'] = preg_match('/^#[0-9a-fA-F]{6}$/', $out['accent']) ? strtolower($out['accent']) : self::DEFAULT_RULES['accent'];
        foreach (['title', 'tab_text', 'nudge_text'] as $k) {
            if ($out[$k] === '') {
                $out[$k] = self::DEFAULT_RULES[$k];
            }
        }

        return $out;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("foryou:tsettings:{$tenantId}");
    }
}
