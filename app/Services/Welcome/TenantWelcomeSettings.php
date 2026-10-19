<?php

namespace App\Services\Welcome;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * "Hoş geldin" ilk alışveriş hediyesi (CRO) — ilk kez gelen ziyaretçiye köşeden süzülen zarif bir kart,
 * tek tıkla açılan + kopyalanan kupon kodu, sonrasında küçük hatırlatıcı pil. Pop-up/karartma yok.
 * Anahtarlar: welcome_enabled, welcome_domains, welcome_rules (JSON). Kuponun kendisi mağazada (ikas) tanımlıdır.
 */
class TenantWelcomeSettings
{
    public const DEFAULT_RULES = [
        'code' => 'HOS10',
        'percent' => 10,
        'eyebrow' => 'HOŞ GELDİN',
        'title' => 'İlk alışverişine %10 hediye',
        'text' => 'Mağazamıza hoş geldin. Kodunu al, ilk siparişinde ödeme adımında kullan.',
        'cta' => 'Kodumu al',
        'revealed_title' => 'Kodun hazır',
        'revealed_text' => 'Ödeme adımındaki kupon alanına yaz. İlk siparişinde, tek sefer geçerli.',
        'shop_cta' => 'Alışverişe başla',
        'shop_url' => '/',
        'image_url' => '',               // boşsa tipografik "%10" alanı; doluysa kartın üstünde görsel
        'accent' => '#111111',
        'position' => 'right',           // right | left (masaüstü köşe; mobilde alttan panel)
        'delay' => 10,                   // saniye; ilk sayfada bu kadar durunca (0 = kapalı)
        'min_pages' => 2,                // ya da bu kadarıncı sayfada hemen (0 = kapalı)
        'exit_intent' => true,           // masaüstünde çıkarken
        'product_page' => false,         // ürün sayfasında kart açılsın mı (varsayılan hayır: satın alma kararını bölmez)
        'hide_paths' => '/checkout',
        'dismiss_days' => 7,             // kapatan bu kadar gün görmez
        'hide_customers' => true,        // sipariş geçmişi olan üyeye hiç gösterme
        'remind' => true,                // kod açıldıktan sonra küçük hatırlatıcı pil
        'remind_text' => 'İlk siparişe %{percent} · {code}',
        'remind_days' => 7,
        'started_at' => '',              // analitik: bu tarihten sonraki kuponlu siparişler sayılır (açılınca otomatik dolar)
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("welcome:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $rules = $s['welcome_rules'] ?? null;
            if (is_string($rules)) {
                $rules = json_decode($rules, true);
            }

            return [
                'enabled' => filter_var($s['welcome_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['welcome_domains'] ?? ''),
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
                default => mb_substr(trim((string) $v), 0, 300),
            };
        }
        $out['code'] = mb_substr(strtoupper(preg_replace('/[^A-Za-z0-9_\-]/', '', $out['code'])), 0, 40) ?: 'HOS10';
        $out['percent'] = max(1, min(90, $out['percent']));
        $out['delay'] = max(0, min(300, $out['delay']));
        $out['min_pages'] = max(0, min(20, $out['min_pages']));
        $out['dismiss_days'] = max(1, min(90, $out['dismiss_days']));
        $out['remind_days'] = max(1, min(90, $out['remind_days']));
        $out['position'] = $out['position'] === 'left' ? 'left' : 'right';
        $out['accent'] = preg_match('/^#[0-9a-fA-F]{6}$/', $out['accent']) ? strtolower($out['accent']) : self::DEFAULT_RULES['accent'];
        $out['image_url'] = preg_match('~^https?://~', $out['image_url']) ? $out['image_url'] : '';
        $out['shop_url'] = $out['shop_url'] !== '' && preg_match('~^(/|https?://)~', $out['shop_url']) ? $out['shop_url'] : '/';
        foreach (['eyebrow', 'title', 'cta', 'revealed_title', 'shop_cta', 'remind_text'] as $k) {
            if ($out[$k] === '') {
                $out[$k] = self::DEFAULT_RULES[$k];
            }
        }

        return $out;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("welcome:tsettings:{$tenantId}");
    }
}
