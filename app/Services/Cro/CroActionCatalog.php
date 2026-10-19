<?php

namespace App\Services\Cro;

use App\Models\CroAction;
use App\Models\Tenant;

/**
 * Varsayılan CRO aksiyon kataloğu — yeni tenant'a "boş sayfa" yerine
 * önceliklenmiş bir başlangıç planı verir. ICE = etki × güven × kolaylık (1-5).
 * Yunbi aracı olan aksiyonlar `feature` ile panele bağlanır.
 */
class CroActionCatalog
{
    public static function items(): array
    {
        return [
            // ── Ürün sayfası ──
            ['key' => 'pdp_delivery_eta', 'title' => 'Ürün sayfasında "Bugün/yarın kargoda" sayacı', 'category' => 'pdp', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Teslimat belirsizliği kalkınca sepete ekleme artar; kesim saatine geri sayım aciliyet yaratır.',
                'impact' => 4, 'confidence' => 5, 'ease' => 5, 'expected_uplift' => '+%5-10 sepete ekleme', 'feature' => 'shipping_widget', 'feature_url' => '/shipping-widget'],
            ['key' => 'pdp_size_guide', 'title' => 'Beden rehberi + "kalıbı nasıl?" notu', 'category' => 'pdp', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Beden kararsızlığı ayakkabıda en büyük terk sebebi; ölçü tablosu + kalıp notu hem satışı artırır hem beden iadesini düşürür.',
                'impact' => 5, 'confidence' => 4, 'ease' => 3, 'expected_uplift' => '+%10 dönüşüm, -%15 beden iadesi', 'feature' => null, 'feature_url' => null],
            ['key' => 'pdp_scarcity', 'title' => 'Gerçek stok azlığı rozeti ("Son 3 adet")', 'category' => 'pdp', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Gerçek stok verisiyle azlık göstermek kararı hızlandırır; sahte aciliyet güven yakar, yalnız gerçek stok kullanılır.',
                'impact' => 3, 'confidence' => 4, 'ease' => 4, 'expected_uplift' => '+%3-6 sepete ekleme', 'feature' => null, 'feature_url' => null],
            ['key' => 'pdp_reviews', 'title' => 'Ürün sayfasında yorum + puan bloğu', 'category' => 'pdp', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Sosyal kanıt görmeyen ziyaretçi fiyat kıyasına gider; yorum bloğu güveni kurar.',
                'impact' => 4, 'confidence' => 5, 'ease' => 5, 'expected_uplift' => '+%15-25 (yorumlu ürünlerde)', 'feature' => 'review_widget', 'feature_url' => '/settings/review-widget'],
            ['key' => 'pdp_sticky_atc', 'title' => 'Mobilde yapışkan "Sepete Ekle" barı', 'category' => 'mobile', 'surface' => 'Ürün sayfası (mobil)',
                'hypothesis' => 'Trafiğin %90+\'ı mobil; kullanıcı fotoğraf/yorum için aşağı inince buton kayboluyor.',
                'impact' => 4, 'confidence' => 4, 'ease' => 3, 'expected_uplift' => '+%8-12 sepete ekleme (mobil)', 'feature' => null, 'feature_url' => null],
            ['key' => 'pdp_trust_badges', 'title' => 'Favorilere ekle altında güven rozetleri', 'category' => 'trust', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Kolay iade / güvenli ödeme / hızlı kargo rozetleri karar anındaki endişeleri giderir.',
                'impact' => 3, 'confidence' => 4, 'ease' => 5, 'expected_uplift' => '+%2-5 dönüşüm', 'feature' => 'announce_widget', 'feature_url' => '/announce-widget'],
            ['key' => 'pdp_video', 'title' => 'Ürün sayfasına ürün videosu', 'category' => 'pdp', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Ayakkabının ayakta/hareket hâli fotoğrafın anlatamadığını anlatır; Kreatif Stüdyo videoları galeriye eklenir.',
                'impact' => 3, 'confidence' => 3, 'ease' => 3, 'expected_uplift' => '+%5-10 (videolu ürünlerde)', 'feature' => 'creative_studio', 'feature_url' => '/creative/videos'],
            ['key' => 'pdp_cross_sell', 'title' => 'Ürün sayfasında "Bununla iyi gider" öneri bloğu', 'category' => 'personalization', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Birlikte alınma matrisi hazır; ürün sayfasında gösterilince sepet tutarı yükselir.',
                'impact' => 3, 'confidence' => 4, 'ease' => 4, 'expected_uplift' => '+%5-8 sepet ortalaması', 'feature' => 'recommendations', 'feature_url' => '/recommendations/cart'],

            // ── Kategori / arama ──
            ['key' => 'cat_smart_ranking', 'title' => 'Kategori sıralamasında satış + keşif dengesi', 'category' => 'category', 'surface' => 'Kategori sayfası',
                'hypothesis' => 'İlk 8 üründe stoklu ve dönüşümü yüksek ürünler durursa liste tıklaması ve dönüşüm artar.',
                'impact' => 4, 'confidence' => 4, 'ease' => 5, 'expected_uplift' => '+%3-7 kategori dönüşümü', 'feature' => 'category_ranking', 'feature_url' => '/category-intelligence'],
            ['key' => 'search_zero_results', 'title' => 'Sıfır sonuçlu aramaları eş anlamlıyla kapatma', 'category' => 'search', 'surface' => 'Arama',
                'hypothesis' => 'Arama yapan ziyaretçi 2-3 kat değerli; sıfır sonuç = kayıp satış. Panelde en sık sıfır sonuçlar eş anlamlıya bağlanır.',
                'impact' => 3, 'confidence' => 5, 'ease' => 5, 'expected_uplift' => 'Sıfır sonuç oranı <%3', 'feature' => 'smart_search', 'feature_url' => '/search-insights'],
            ['key' => 'cat_quick_add', 'title' => 'Listeden beden seçip hızlı sepete ekleme', 'category' => 'category', 'surface' => 'Kategori sayfası',
                'hypothesis' => 'Ürün sayfasına gitmeden ekleme, özellikle tek-fiyat kampanya listelerinde adım sayısını düşürür.',
                'impact' => 3, 'confidence' => 3, 'ease' => 2, 'expected_uplift' => '+%3-5 sepete ekleme', 'feature' => null, 'feature_url' => null],

            // ── Sepet / ödeme ──
            ['key' => 'cart_free_shipping_bar', 'title' => 'Sepette "Ücretsiz kargoya X TL kaldı" çubuğu', 'category' => 'cart', 'surface' => 'Sepet',
                'hypothesis' => 'Eşiğe yakın sepetler ikinci ürünü ekler; ortalama sepet yükselir.',
                'impact' => 4, 'confidence' => 5, 'ease' => 4, 'expected_uplift' => '+%5-10 sepet ortalaması', 'feature' => null, 'feature_url' => null],
            ['key' => 'cart_recommendation', 'title' => 'Sepete ekleme anında tamamlayıcı ürün önerisi', 'category' => 'cart', 'surface' => 'Sepet / Ödeme',
                'hypothesis' => 'Sepete ekleme anı en yüksek niyet anıdır; sayaçlı öneri şeridi ek ürün ekletir.',
                'impact' => 4, 'confidence' => 4, 'ease' => 5, 'expected_uplift' => '+%4-8 sepet ortalaması', 'feature' => 'recommendations', 'feature_url' => '/recommendations/cart'],
            ['key' => 'checkout_guest', 'title' => 'Ödemede üyeliksiz (misafir) akışın öne alınması', 'category' => 'checkout', 'surface' => 'Ödeme',
                'hypothesis' => 'Zorunlu üyelik ödeme terkinin ilk 3 sebebinden biri; misafir seçeneği ilk ekranda olmalı.',
                'impact' => 4, 'confidence' => 4, 'ease' => 2, 'expected_uplift' => '+%5-10 ödeme tamamlama', 'feature' => null, 'feature_url' => null],
            ['key' => 'checkout_abandon_recovery', 'title' => 'Terk edilen sepete WhatsApp/e-posta hatırlatma', 'category' => 'retention', 'surface' => 'Ödeme sonrası',
                'hypothesis' => 'Ödeme başlatıp bırakanların bir kısmı 1-24 saat içinde hatırlatmayla döner.',
                'impact' => 4, 'confidence' => 5, 'ease' => 5, 'expected_uplift' => 'Terk sepetlerin %5-10\'u geri döner', 'feature' => 'cart_recovery', 'feature_url' => '/marketing/automations'],
            ['key' => 'checkout_trust', 'title' => 'Ödeme adımında güven şeridi (3D Secure, iade, kargo)', 'category' => 'checkout', 'surface' => 'Ödeme',
                'hypothesis' => 'Kart bilgisi girerken güven ipuçları terk oranını düşürür.',
                'impact' => 3, 'confidence' => 3, 'ease' => 3, 'expected_uplift' => '+%2-4 ödeme tamamlama', 'feature' => null, 'feature_url' => null],

            // ── Site geneli ──
            ['key' => 'site_exit_intent', 'title' => 'Çıkış niyetinde çark / ilk sipariş teklifi', 'category' => 'retention', 'surface' => 'Site geneli',
                'hypothesis' => 'Ayrılmak üzere olan ziyaretçiye tek seferlik teklif hem e-posta/telefon izni toplar hem satışa çevirir.',
                'impact' => 3, 'confidence' => 4, 'ease' => 4, 'expected_uplift' => '+%2-4 dönüşüm, izinli liste büyür', 'feature' => 'wheel', 'feature_url' => '/wheel'],
            ['key' => 'site_chat_assistant', 'title' => 'AI alışveriş asistanı (beden, kargo, iade soruları)', 'category' => 'personalization', 'surface' => 'Site geneli',
                'hypothesis' => 'Satın alma öncesi sorusu anında cevaplanan ziyaretçi terk etmez.',
                'impact' => 3, 'confidence' => 4, 'ease' => 5, 'expected_uplift' => 'Sohbet eden ziyaretçide 2-4× dönüşüm', 'feature' => 'chatbot', 'feature_url' => '/chatbot'],
            ['key' => 'site_speed', 'title' => 'Mobil sayfa hızı: script sadeleştirme + lazy görsel', 'category' => 'speed', 'surface' => 'Site geneli',
                'hypothesis' => 'Her 100 ms gecikme ~%1 dönüşüm kaybı; üçüncü parti script ve lazy olmayan görseller ilk sırada.',
                'impact' => 4, 'confidence' => 4, 'ease' => 2, 'expected_uplift' => '+%3-8 dönüşüm (mobil)', 'feature' => 'cro_audit', 'feature_url' => '/cro/audit'],
            ['key' => 'site_low_cr_landing', 'title' => 'Düşük dönüşümlü giriş sayfalarını iyileştirme', 'category' => 'category', 'surface' => 'Giriş sayfaları',
                'hypothesis' => 'Yüksek trafik + düşük dönüşüm alan giriş sayfaları (reklam hedefleri) en hızlı kazanç alanı.',
                'impact' => 4, 'confidence' => 3, 'ease' => 3, 'expected_uplift' => 'Sayfa bazında +%20-50 dönüşüm', 'feature' => 'cro_overview', 'feature_url' => '/cro'],
            ['key' => 'site_back_in_stock', 'title' => '"Gelince haber ver" ile tükenen bedende talep yakalama', 'category' => 'retention', 'surface' => 'Ürün sayfası',
                'hypothesis' => 'Tükenen bedende ayrılan ziyaretçi kaybolur; izinli bildirim stok gelince satışa döner.',
                'impact' => 3, 'confidence' => 4, 'ease' => 4, 'expected_uplift' => 'Bildirim alanların %10-20\'si satın alır', 'feature' => 'stock_alert', 'feature_url' => '/crm/stock-alerts'],
        ];
    }

    /** Katalogdaki aksiyonları tenant'a tohumlar (var olan key'ler atlanır). Dönen: eklenen sayısı. */
    public static function seed(Tenant $tenant, ?int $userId = null): int
    {
        $existing = CroAction::where('tenant_id', $tenant->id)->whereNotNull('key')->pluck('key')->all();
        $added = 0;
        $order = 0;
        foreach (self::items() as $item) {
            $order += 10;
            if (in_array($item['key'], $existing, true)) {
                continue;
            }
            CroAction::create($item + [
                'tenant_id' => $tenant->id,
                'status' => 'idea',
                'sort_order' => $order,
                'created_by' => $userId,
            ]);
            $added++;
        }

        return $added;
    }
}
