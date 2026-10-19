<?php

namespace App\Services\Cart;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Sepet Kampanyası (CRO) — sepet çekmecesi (yan sepet) ve sepet/checkout sayfasında
 * kademeli kampanya çubuğu ("1.500 TL'ye 300 TL kaldı → ücretsiz kargo", "2.500 TL → sepette ek %5"…)
 * + satır fiyat/indirim gösteriminin ve sepet özetinin iyileştirilmesi.
 * Anahtarlar: cart_enabled, cart_domains, cart_theme (JSON), cart_rules (JSON).
 * Kampanyanın kendisi mağaza panelinde (Ticimax) tanımlanır; Yunbi yalnız GÖSTERİR ve ölçer.
 */
class TenantCartSettings
{
    public const TIER_TYPES = ['shipping', 'percent', 'amount', 'gift'];

    public const BASES = ['before_discount', 'after_discount'];

    public const DEFAULT_THEME = [
        'accent' => '#111827',      // çubuk dolgusu / başlık
        'accent2' => '#f59e0b',     // sıradaki kademe vurgusu (kalan tutar)
        'ok' => '#16a34a',          // kazanılan kademe / indirimli fiyat
        'ink' => '#111827',
        'muted' => '#6b7280',
        'bg' => '#ffffff',
        'track' => '#eef0f4',
        'radius' => 12,
        'font' => '',
        'style' => 'card',          // card | flat
        'badge_color' => '#dc2626', // "%50" indirim rozeti
        'celebrate' => true,        // kademe kazanılınca kısa konfeti/parlama
    ];

    public const DEFAULT_RULES = [
        'tiers' => [
            ['threshold' => 1500, 'type' => 'shipping', 'value' => 0, 'label' => 'Ücretsiz Kargo', 'short' => 'Kargo'],
            ['threshold' => 2500, 'type' => 'percent', 'value' => 5, 'label' => 'Sepette Ek %5 İndirim', 'short' => '%5'],
            ['threshold' => 5000, 'type' => 'percent', 'value' => 10, 'label' => 'Sepette Ek %10 İndirim', 'short' => '%10'],
            ['threshold' => 10000, 'type' => 'percent', 'value' => 15, 'label' => 'Sepette Ek %15 İndirim', 'short' => '%15'],
        ],
        'basis' => 'before_discount',   // eşik hangi tutara göre: kampanya öncesi sepet tutarı | kampanya sonrası
        'title' => 'Sepet Avantajları',
        'msg_next' => '{label} için {remaining} daha ekle',
        'msg_reached' => '{label} kazandın!',
        'msg_all' => 'Tebrikler, tüm sepet avantajlarını kazandın!',
        'msg_empty' => '{label} için {threshold} ve üzeri alışveriş yap',
        'show_savings' => true,          // "Bu sepette toplam kazancın: X TL"
        'show_value' => true,            // sıradaki kademenin parasal değeri: "≈ 125 TL ek indirim" / "kargo ücreti bedava"
        'shipping_fee' => 0,             // mağazanın standart kargo ücreti (0 = tutar yazılmaz); "X TL kargo bedava" vurgusu için
        'suggest_enabled' => true,       // çubukta "Sepetini tamamla" ürün önerileri (+ Ekle ile yenilemesiz sepete ekleme)
        'suggest_title' => 'Sepetini tamamla, avantajı kap',
        'suggest_unlock' => 'Bunu ekle → {label}',   // öneriyi eklemek sıradaki kademeyi açıyorsa kartta görünen etiket
        'suggest_max' => 4,              // en fazla kart (2..8)
        'suggest_side' => true,          // yan sepette
        'suggest_checkout' => true,      // sepet sayfasında
        'suggest_hide_all' => true,      // tüm kademeler kazanılınca öneri şeridi gizlensin
        'cta_text' => 'İndirimli ürünlere göz at',
        'cta_url' => '/',
        'show_cta' => false,             // ek bağlantı butonu (öneri şeridi varken gereksiz; kapalı)
        'side_enabled' => true,          // yan sepet (çekmece)
        'side_price' => true,            // yan sepette satır fiyat/indirim iyileştirme
        'side_summary' => true,          // yan sepette özet (liste fiyatı / indirim / kargo / toplam)
        'side_mount' => 'prepend:.miniCartContent',
        'checkout_enabled' => true,      // /checkout sepet adımı
        'checkout_price' => true,
        'checkout_summary' => true,
        'checkout_mount' => 'before:.cart-product-list, after:.content-header, prepend:.basket-content > div:first-child',
        'checkout_summary_mount' => 'prepend:.order-summary-list, before:.total-price-card',
        'checkout_hide_selector' => '.cargo-information, .free-cargo',  // temanın kendi "ücretsiz kargoya X kaldı" bandı (Ticimax checkout)
        'checkout_paths' => '/checkout,/sepetim',
        'hide_paths' => '',
        'currency' => 'TL',
        'max_width' => 991,
        'started_at' => '',              // kampanyanın mağazada canlıya alındığı an (TR saati, "Y-m-d H:i") — etki kıyası bu andan başlar
        'impact_sources' => 'TicimaxWeb', // etki kıyasında sayılan sipariş kaynakları (virgülle; boş = hepsi)
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("cart:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['cart_theme'] ?? null);
            $rules = static::json($s['cart_rules'] ?? null);
            $theme = array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : []);
            $rules = array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []);
            $rules['tiers'] = static::normalizeTiers($rules['tiers'] ?? []);
            if (! in_array($rules['basis'], self::BASES, true)) {
                $rules['basis'] = 'before_discount';
            }

            return [
                'enabled' => filter_var($s['cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['cart_domains'] ?? ''),
                'theme' => $theme,
                'rules' => $rules,
            ];
        });
    }

    /** Kademeler eşiğe göre sıralanır, tekrarlar atılır, alanlar tipe zorlanır (en fazla 6). */
    public static function normalizeTiers(array $tiers): array
    {
        $out = [];
        foreach ($tiers as $t) {
            if (! is_array($t)) {
                continue;
            }
            $th = (float) ($t['threshold'] ?? 0);
            if ($th <= 0) {
                continue;
            }
            $type = in_array($t['type'] ?? '', self::TIER_TYPES, true) ? $t['type'] : 'percent';
            $val = (float) ($t['value'] ?? 0);
            $label = trim((string) ($t['label'] ?? ''));
            if ($label === '') {
                $label = match ($type) {
                    'shipping' => 'Ücretsiz Kargo',
                    'percent' => 'Sepette Ek %'.rtrim(rtrim(number_format($val, 2, '.', ''), '0'), '.').' İndirim',
                    'amount' => number_format($val, 0, ',', '.').' TL İndirim',
                    default => 'Hediye',
                };
            }
            $short = trim((string) ($t['short'] ?? ''));
            if ($short === '') {
                $short = match ($type) {
                    'shipping' => 'Kargo',
                    'percent' => '%'.rtrim(rtrim(number_format($val, 2, '.', ''), '0'), '.'),
                    'amount' => number_format($val, 0, ',', '.').' TL',
                    default => 'Hediye',
                };
            }
            $out[$th] = ['threshold' => $th, 'type' => $type, 'value' => $val, 'label' => mb_substr($label, 0, 60), 'short' => mb_substr($short, 0, 14)];
        }
        ksort($out);

        return array_slice(array_values($out), 0, 6);
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("cart:tsettings:{$tenantId}");
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
