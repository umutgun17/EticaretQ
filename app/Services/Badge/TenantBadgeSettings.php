<?php

namespace App\Services\Badge;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Ürün Rozetleri (CRO) — ürün liste kartlarında ve ürün detayda GERÇEK veriye dayalı rozetler
 * (kampanya kategorisi, çok satan, popüler, yeni, son N adet, yüksek puan) + ürün detayda sosyal kanıt satırları.
 * Anahtarlar: badge_enabled, badge_domains, badge_theme (JSON), badge_types (JSON sıralı liste = öncelik), badge_rules (JSON).
 *
 * Rozet tipi: {id, kind, label, color, icon, enabled, list, pdp, params}
 *  kind=category   params{category_id}                 → kategorideki kartlar (Ticimax canlı + DB)
 *  kind=tag        params{tag_id}                      → Ticimax ETİKETİNDEKİ kartlar (SelectUrunEtiket canlı; örn. Flaş Ürünler → "Sepette %5")
 *  kind=bestseller params{days, top, min_qty}          → son N günde en çok satan kartlar (ödenmiş sipariş)
 *  kind=popular    params{days, top, min_views}        → GA4 görüntülenme (itemsViewed) en yüksek kartlar
 *  kind=new        params{days}                        → Ticimax'ta son N günde açılmış, stoklu kartlar
 *  kind=low_stock  params{threshold}                   → kart toplam stoğu 1..threshold ({n} = adet)
 *  kind=top_rated  params{min_rate, min_count}         → Trendyol puan özeti ({rate}, {count})
 */
class TenantBadgeSettings
{
    public const KINDS = ['category', 'tag', 'bestseller', 'popular', 'new', 'low_stock', 'top_rated'];

    public const ICONS = ['none', 'gift', 'flame', 'eye', 'sparkle', 'hourglass', 'star', 'tag', 'bolt', 'trophy', 'heart', 'truck'];

    public const STYLES = ['solid', 'soft', 'outline', 'glass'];

    public const SHAPES = ['pill', 'rounded', 'square', 'ribbon'];

    public const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

    /** Tip görünümü: standard (tema stili) | spotlight (gösterişli kampanya etiketi: büyük ilk kelime + renkli şerit, parıltı) */
    public const DESIGNS = ['standard', 'spotlight', 'bar'];

    public const MAX_TYPES = 16;

    public const DEFAULT_THEME = [
        'style' => 'solid',          // solid (dolu) | soft (açık zemin) | outline | glass (buzlu beyaz)
        'shape' => 'rounded',        // pill | rounded | square | ribbon (köşeden şerit)
        'size' => 'm',               // s | m | l
        'uppercase' => true,
        'list_position' => 'top-left',
        'list_direction' => 'column', // column (alt alta) | row (yan yana)
        'list_offset' => 8,          // görsel kenarından px
        'mobile_bottom' => false,    // mobilde (<600px) üst köşeler alta iner: sol üst→sol alt, sağ üst→sağ alt (liste + ürün detay görseli)
        'mobile_compact' => false,   // mobilde (<600px) liste kartı rozetleri küçük + kartta tek gösterişli rozet (görseli kapatmasın)
        'shadow' => true,
        'font' => '',                // boş = mağaza yazı tipi
        'pdp_style' => 'chips',      // chips (başlık altında rozet satırı)
        'proof_style' => 'card',     // card (çerçeveli kutu) | plain (yalın satırlar)
        'proof_accent' => '#111827',
    ];

    public const DEFAULT_TYPES = [
        ['id' => 'bestseller', 'kind' => 'bestseller', 'label' => 'Çok Satan', 'color' => '#ea580c', 'icon' => 'flame', 'enabled' => true, 'list' => true, 'pdp' => true, 'params' => ['days' => 7, 'top' => 60, 'min_qty' => 20]],
        ['id' => 'low_stock', 'kind' => 'low_stock', 'label' => 'Son {n} Adet', 'color' => '#c2410c', 'icon' => 'hourglass', 'enabled' => true, 'list' => true, 'pdp' => true, 'params' => ['threshold' => 5]],
        ['id' => 'new', 'kind' => 'new', 'label' => 'Yeni', 'color' => '#059669', 'icon' => 'sparkle', 'enabled' => true, 'list' => true, 'pdp' => true, 'params' => ['days' => 21]],
        ['id' => 'popular', 'kind' => 'popular', 'label' => 'Popüler', 'color' => '#2563eb', 'icon' => 'eye', 'enabled' => true, 'list' => true, 'pdp' => true, 'params' => ['days' => 7, 'top' => 60, 'min_views' => 300]],
        ['id' => 'top_rated', 'kind' => 'top_rated', 'label' => '{rate} Puan', 'color' => '#ca8a04', 'icon' => 'star', 'enabled' => false, 'list' => true, 'pdp' => false, 'params' => ['min_rate' => 4.5, 'min_count' => 20]],
    ];

    public const DEFAULT_RULES = [
        'list_enabled' => true,
        'pdp_enabled' => true,
        'list_max' => 2,             // kart başına en fazla rozet (öncelik sırası = liste sırası)
        'pdp_max' => 4,
        'exclusive' => ['bestseller', 'popular'], // aynı kartta bu tiplerden yalnız ilki (gürültüyü azaltır)
        'new_skip_category' => true, // kampanya (kategori) rozetli kartta "Yeni" gösterme (1+1 kopya kartları yeni açılır ama ürün eskidir)
        'hide_out_of_stock' => true, // stoksuz kartta rozet yok (Ticimax "Tükendi" gösterir)
        // Ürün detay sosyal kanıt satırları (gerçek sayılar; eşik altı gösterilmez)
        'proof_enabled' => true,
        // Satış satırı ürün başına EN GÜÇLÜ gerçek pencereyi kullanır: 24 saat eşiği tutmazsa 7 gün, o da tutmazsa 30 gün
        'proof_round' => true,       // 237 → "200+" (aşağı yuvarlama; sayı her zaman gerçeğin altında kalır)
        'proof_max_lines' => 3,      // kutuda en fazla satır (öncelik: sıralama, satış, sepette, favori, azalan beden, sepete ekleme, inceleme)
        'proof_sold_24h' => true, 'proof_sold_24h_min' => 5, 'proof_sold_24h_text' => 'Son 24 saatte {n} adet satıldı',
        'proof_sold_7d' => true, 'proof_sold_7d_min' => 20, 'proof_sold_7d_text' => 'Son 7 günde {n} adet satıldı',
        'proof_sold_30d' => true, 'proof_sold_30d_min' => 50, 'proof_sold_30d_text' => 'Son 30 günde {n} adet satıldı',
        'proof_rank' => true, 'proof_rank_max' => 3, 'proof_rank_min_qty' => 10, 'proof_rank_text' => '{category} kategorisinde en çok satan #{rank}',
        'proof_cart' => true, 'proof_cart_min' => 3, 'proof_cart_hours' => 24, 'proof_cart_text' => '{n} kişinin sepetinde', // ödemesi tamamlanmamış denemeler
        'proof_fav' => true, 'proof_fav_min' => 50, 'proof_fav_text' => '{n} kişi favorilerine ekledi',
        'proof_atc' => true, 'proof_atc_min' => 50, 'proof_atc_text' => 'Son 7 günde {n} kez sepete eklendi',
        'proof_views' => true, 'proof_views_min' => 200, 'proof_views_text' => 'Son 7 günde {n} kez incelendi',
        'proof_sizes' => true, 'proof_sizes_max_stock' => 3, 'proof_sizes_text' => '{sizes} bedenlerinde son ürünler',
        // Yerleşim (Ticimax varsayılanları; before:/after:/append:/prepend: SEL, virgülle aday)
        'list_card_selector' => '.productItem',
        'list_id_selector' => '.detailLink[data-id],.productDetail[data-id],.detailUrl[data-id]',
        'list_image_selector' => '.productImage',
        'bar_list_mount' => 'after:.ozelAlan1, after:.productPrice, append:.productDetail', // design=bar: kartta fiyat/özel alan altı
        'bar_pdp_mount' => 'after:#divOzelAlan1, after:#pnlFiyatlar, before:#divSatinAl',
        'pdp_badge_position' => 'image', // image (ana görselin köşesi, liste kartıyla aynı) | price (fiyatın altı) | title (başlık altı)
        'pdp_image_mount' => 'before:#yunbi-gallery, before:#divMobileImageList, prepend:.leftImage .Images, before:.leftImage',
        'pdp_price_mount' => 'after:#pnlFiyatlar, after:.PriceList',
        'pdp_badge_mount' => 'after:.ProductName, after:h1',
        'pdp_proof_mount' => 'before:#divSatinAl, before:.buybutton, after:#pnlFiyatlar', // Sepete Ekle bloğunun hemen üstü
        'hide_paths' => '/sepet,/Sepetim,/checkout,/odeme',
    ];

    protected static array $memo = [];

    public static function get(int $tenantId): array
    {
        return static::$memo[$tenantId] ??= Cache::remember("badge:tsettings:{$tenantId}", 300, function () use ($tenantId) {
            $raw = DB::table('tenants')->where('id', $tenantId)->value('settings');
            $s = is_string($raw) ? (json_decode($raw, true) ?: []) : ((array) $raw);
            $theme = static::json($s['badge_theme'] ?? null);
            $rules = static::json($s['badge_rules'] ?? null);
            $types = static::json($s['badge_types'] ?? null);

            return [
                'enabled' => filter_var($s['badge_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'domains' => (string) ($s['badge_domains'] ?? ''),
                'theme' => static::sanitizeTheme(array_merge(self::DEFAULT_THEME, is_array($theme) ? $theme : [])),
                'rules' => array_merge(self::DEFAULT_RULES, is_array($rules) ? $rules : []),
                'types' => is_array($types) ? static::sanitizeTypes($types) : self::DEFAULT_TYPES,
            ];
        });
    }

    public static function sanitizeTheme(array $t): array
    {
        if (! in_array($t['style'], self::STYLES, true)) {
            $t['style'] = 'solid';
        }
        if (! in_array($t['shape'], self::SHAPES, true)) {
            $t['shape'] = 'rounded';
        }
        if (! in_array($t['list_position'], self::POSITIONS, true)) {
            $t['list_position'] = 'top-left';
        }
        if (! in_array($t['size'], ['s', 'm', 'l'], true)) {
            $t['size'] = 'm';
        }
        $t['mobile_bottom'] = filter_var($t['mobile_bottom'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $t['mobile_compact'] = filter_var($t['mobile_compact'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return $t;
    }

    /** Tip listesini temizler: geçerli kind, benzersiz id, hex renk, ikon whitelist, kind'e göre parametreler. */
    public static function sanitizeTypes(array $types): array
    {
        $out = [];
        $ids = [];
        foreach ($types as $t) {
            if (! is_array($t) || ! in_array($t['kind'] ?? '', self::KINDS, true)) {
                continue;
            }
            $kind = $t['kind'];
            $id = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($t['id'] ?? ''))) ?: $kind;
            while (in_array($id, $ids, true)) {
                $id .= '_2';
            }
            $p = (array) ($t['params'] ?? []);
            $params = match ($kind) {
                'category' => ['category_id' => max(0, (int) ($p['category_id'] ?? 0))],
                'tag' => ['tag_id' => max(0, (int) ($p['tag_id'] ?? 0)), 'cart_pct' => max(0, min(90, (int) ($p['cart_pct'] ?? 0)))], // cart_pct>0 → {price} = sepet fiyatı (indirimli × (100−pct)/100)
                'bestseller' => ['days' => max(1, min(90, (int) ($p['days'] ?? 7))), 'top' => max(1, min(1000, (int) ($p['top'] ?? 60))), 'min_qty' => max(1, (int) ($p['min_qty'] ?? 20))],
                'popular' => ['days' => max(1, min(90, (int) ($p['days'] ?? 7))), 'top' => max(1, min(1000, (int) ($p['top'] ?? 60))), 'min_views' => max(1, (int) ($p['min_views'] ?? 300))],
                'new' => ['days' => max(1, min(180, (int) ($p['days'] ?? 21)))],
                'low_stock' => ['threshold' => max(1, min(100, (int) ($p['threshold'] ?? 5)))],
                'top_rated' => ['min_rate' => max(1, min(5, (float) ($p['min_rate'] ?? 4.5))), 'min_count' => max(1, (int) ($p['min_count'] ?? 20))],
            };
            if (($kind === 'category' && $params['category_id'] <= 0) || ($kind === 'tag' && $params['tag_id'] <= 0)) {
                continue;
            }
            $color = (string) ($t['color'] ?? '');
            $ids[] = $id;
            $out[] = [
                'id' => $id,
                'kind' => $kind,
                'label' => mb_substr(trim((string) ($t['label'] ?? '')), 0, 40) ?: $kind,
                'color' => preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : '#111827',
                'icon' => in_array($t['icon'] ?? '', self::ICONS, true) ? $t['icon'] : 'none',
                'enabled' => (bool) ($t['enabled'] ?? true),
                'list' => (bool) ($t['list'] ?? true),
                'pdp' => (bool) ($t['pdp'] ?? true),
                // Kendi köşesi ('' = tema köşesi); farklı köşedeki rozetler ayrı grup olur, liste sınırına ayrıca tabidir
                'corner' => in_array($t['corner'] ?? '', self::POSITIONS, true) ? $t['corner'] : '',
                'design' => in_array($t['design'] ?? '', self::DESIGNS, true) ? $t['design'] : 'standard',
                'params' => $params,
            ];
            if (count($out) >= self::MAX_TYPES) {
                break;
            }
        }

        return $out;
    }

    public static function forget(int $tenantId): void
    {
        unset(static::$memo[$tenantId]);
        Cache::forget("badge:tsettings:{$tenantId}");
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
