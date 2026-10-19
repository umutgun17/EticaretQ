<?php

namespace App\Services\Cro;

use App\Models\CroAudit;
use App\Models\Tenant;
use App\Services\GoogleAnalyticsService;
use Illuminate\Support\Str;

/**
 * Mağaza sayfalarının otomatik CRO/UX denetimi.
 *
 * Ana sayfa + (en çok ziyaret alan) kategori + o kategoriden bir ürün sayfası çekilir,
 * her sayfa için CRO kontrol listesi koşulur ve 0-100 puan üretilir. Sonuçlar
 * cro_audits'e yazılır. Headless tarayıcı YOK (Cloudflare bot challenge) — düz HTML
 * üzerinde sezgisel kontroller; JS ile sonradan basılan öğeler "bilgi" olarak işaretlenir.
 */
class CroAuditService
{
    private const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 YunbiCRO/1.0';

    /** Yunbi widget'ları — sayfada gömülü mü? (script dosya adı → etiket) */
    private const YUNBI_WIDGETS = [
        'announce.js' => 'Kampanya Duyuruları (çan + üst bar + güven rozetleri)',
        'shipping.js' => 'Bugün Kargoda sayacı',
        'reviews.js' => 'Trendyol Yorum Widget\'ı',
        'search.js' => 'Akıllı Arama',
        'chat.js' => 'AI Chatbot',
        'wheel.js' => 'Şans Çarkı',
        'cart-rec.js' => 'Sepet / Ödeme Önerisi',
        'push.js' => 'Web Push',
        'stock-alert.js' => 'Gelince Haber Ver',
    ];

    public function run(Tenant $tenant): array
    {
        $runId = (string) Str::uuid();
        $urls = $this->discoverUrls($tenant);
        $results = [];

        foreach ($urls as $type => $url) {
            if (! $url) {
                continue;
            }
            // GÜVENLİK (SSRF): kiracı ayarından gelen adres iç ağa/localhost'a işaret edemez
            if (! \App\Support\SafeUrl::isPublicHttpUrl($url)) {
                continue;
            }
            $page = $this->fetch($url);
            $checks = $this->checks($type, $page, $url);
            $score = $this->score($checks);

            $results[] = CroAudit::create([
                'tenant_id' => $tenant->id,
                'run_id' => $runId,
                'page_type' => $type,
                'url' => $url,
                'http_status' => $page['status'],
                'ttfb_ms' => $page['ttfb_ms'],
                'total_ms' => $page['total_ms'],
                'html_bytes' => $page['bytes'],
                'score' => $score,
                'checks' => $checks,
                'meta' => $page['meta'],
            ]);
        }

        return ['run_id' => $runId, 'pages' => $results];
    }

    /** Ana sayfa + en çok oturum alan kategori (GA4 varsa) + o kategoriden ilk ürün. */
    public function discoverUrls(Tenant $tenant): array
    {
        $s = $tenant->settings ?? [];
        $base = rtrim((string) ($s['storefront_url'] ?? $s['shop_url'] ?? ''), '/');
        if ($base === '') {
            return [];
        }

        $urls = ['home' => $base.'/', 'category' => null, 'product' => null, 'cart' => null];

        // Kategori adayı: GA4 landing sayfalarından ana sayfa/checkout dışı ilk yol
        $ga4 = GoogleAnalyticsService::fromTenant($tenant);
        if ($ga4->isAvailable()) {
            $landing = $ga4->getLandingPages(now()->subDays(30)->format('Y-m-d'), now()->subDay()->format('Y-m-d')) ?? [];
            foreach ($landing as $row) {
                $path = (string) ($row['landing_page'] ?? '');
                if ($path !== '' && $path !== '/' && ! str_contains($path, 'checkout') && ! str_contains($path, '?') && preg_match('#^/[a-z0-9\-/]+$#i', $path)) {
                    $urls['category'] = $base.$path;
                    break;
                }
            }
        }

        $home = $this->fetch($urls['home']);
        if (! $urls['category']) {
            $urls['category'] = $this->firstCategoryLink($home['html'], $base);
        }

        if ($urls['category']) {
            $cat = $this->fetch($urls['category']);
            $urls['product'] = $this->firstProductLink($cat['html'], $base);
        }

        if (! empty($s['cart_url'])) {
            $urls['cart'] = (string) $s['cart_url'];
        }

        return array_filter($urls);
    }

    // ───────────────────────── fetch ─────────────────────────

    public function fetch(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => self::UA,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml', 'Accept-Language: tr-TR,tr;q=0.9'],
        ]);
        $html = (string) curl_exec($ch);
        $info = curl_getinfo($ch);
        curl_close($ch);

        return [
            'url' => $url,
            'final_url' => (string) ($info['url'] ?? $url),
            'status' => (int) ($info['http_code'] ?? 0),
            'ttfb_ms' => (int) round(($info['starttransfer_time'] ?? 0) * 1000),
            'total_ms' => (int) round(($info['total_time'] ?? 0) * 1000),
            'bytes' => strlen($html),
            'html' => $html,
            'meta' => $this->meta($html),
        ];
    }

    private function meta(string $html): array
    {
        $lower = mb_strtolower($html);
        preg_match('#<title[^>]*>(.*?)</title>#is', $html, $t);
        preg_match('#<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)#i', $html, $d);
        $widgets = [];
        foreach (self::YUNBI_WIDGETS as $file => $label) {
            if (str_contains($lower, 'hub.yunbi.ai/widget/'.$file)) {
                $widgets[] = $file;
            }
        }
        $imgs = preg_match_all('#<img\b[^>]*>#i', $html, $imgTags);

        return [
            'title' => trim(html_entity_decode(strip_tags($t[1] ?? ''))),
            'title_len' => mb_strlen(trim(strip_tags($t[1] ?? ''))),
            'description_len' => mb_strlen($d[1] ?? ''),
            'script_count' => preg_match_all('#<script\b#i', $html),
            'external_script_count' => preg_match_all('#<script\b[^>]*\bsrc=#i', $html),
            'img_count' => $imgs,
            'img_no_alt' => count(array_filter($imgTags[0] ?? [], fn ($tag) => ! preg_match('#\balt=#i', $tag))),
            'img_lazy' => preg_match_all('#loading=["\']lazy["\']#i', $html),
            'iframe_count' => preg_match_all('#<iframe\b#i', $html),
            'inline_style_blocks' => preg_match_all('#<style\b#i', $html),
            'h1_count' => preg_match_all('#<h1\b#i', $html),
            'has_viewport' => (bool) preg_match('#<meta[^>]+name=["\']viewport["\']#i', $html),
            'has_canonical' => (bool) preg_match('#<link[^>]+rel=["\']canonical["\']#i', $html),
            'has_ldjson' => str_contains($lower, 'application/ld+json'),
            'has_whatsapp' => (bool) preg_match('#wa\.me/|api\.whatsapp\.com|whatsapp://#i', $html),
            'has_search_box' => (bool) preg_match('#<input[^>]+(type=["\']search["\']|name=["\'][^"\']*(ara|search|q)[^"\']*["\']|placeholder=["\'][^"\']*ara)#i', $html),
            'yunbi_widgets' => $widgets,
        ];
    }

    // ───────────────────────── link discovery ─────────────────────────

    private function firstCategoryLink(string $html, string $base): ?string
    {
        preg_match_all('#<a\b[^>]*href=["\'](/[a-z0-9\-]{4,60})["\']#i', $html, $m);
        $skip = ['/iletisim', '/hakkimizda', '/sss', '/blog', '/uyelik', '/giris', '/kayit', '/sepet', '/checkout', '/hesabim', '/favorilerim', '/iade', '/kvkk', '/gizlilik', '/mesafeli', '/kisisel'];
        $counts = array_count_values(array_map('strtolower', $m[1] ?? []));
        arsort($counts);
        foreach (array_keys($counts) as $path) {
            foreach ($skip as $sk) {
                if (str_starts_with($path, $sk)) {
                    continue 2;
                }
            }

            return $base.$path;
        }

        return null;
    }

    private function firstProductLink(string $html, string $base): ?string
    {
        // Ticimax / genel temalar: ürün kartı sarmalayıcısında class'ta "product" geçer
        if (preg_match('#<[^>]+class=["\'][^"\']*product[^"\']*["\'][^>]*>.*?<a\b[^>]*href=["\']([^"\']+)["\']#is', $html, $m)) {
            $href = $m[1];
            if (str_starts_with($href, '/')) {
                return $base.$href;
            }
            if (str_starts_with($href, 'http')) {
                return $href;
            }
        }
        // Yedek: yolunda en az iki tire ve rakam olan ilk link (ürün slug'ları uzundur)
        preg_match_all('#<a\b[^>]*href=["\'](/[a-z0-9\-]{12,120})["\']#i', $html, $all);
        foreach ($all[1] ?? [] as $href) {
            if (substr_count($href, '-') >= 3 && preg_match('/\d/', $href)) {
                return $base.$href;
            }
        }

        return null;
    }

    // ───────────────────────── checks ─────────────────────────

    /**
     * @return array<int, array{key:string,label:string,status:string,detail:string,advice:?string,weight:int,group:string}>
     */
    public function checks(string $type, array $page, string $url): array
    {
        $html = $page['html'];
        $lower = mb_strtolower($html);
        $m = $page['meta'];
        $c = [];

        $add = function (string $key, string $label, string $status, string $detail, ?string $advice = null, int $weight = 2, string $group = 'Genel') use (&$c) {
            $c[] = compact('key', 'label', 'status', 'detail', 'advice', 'weight', 'group');
        };

        // ── Erişilebilirlik & hız ──
        $add('http', 'Sayfa yanıtı', $page['status'] === 200 ? 'pass' : 'fail', 'HTTP '.$page['status'], $page['status'] === 200 ? null : 'Sayfa 200 dönmeli; yönlendirme zinciri ya da hata var.', 3, 'Hız');
        $add('https', 'HTTPS', str_starts_with($page['final_url'], 'https://') ? 'pass' : 'fail', $page['final_url'], null, 3, 'Güven');
        $ttfb = $page['ttfb_ms'];
        $add('ttfb', 'Sunucu yanıt süresi (TTFB)', $ttfb <= 500 ? 'pass' : ($ttfb <= 1200 ? 'warn' : 'fail'), $ttfb.' ms', $ttfb <= 500 ? null : 'Her +100 ms gecikme dönüşümü ~%1 düşürür; sayfa önbelleği / CDN kontrol edilmeli.', 3, 'Hız');
        $kb = (int) round($page['bytes'] / 1024);
        $add('html_size', 'HTML boyutu', $kb <= 300 ? 'pass' : ($kb <= 800 ? 'warn' : 'fail'), $kb.' KB', $kb <= 300 ? null : 'HTML çok büyük (inline CSS/JS ve gizli menüler). Mobilde ilk boyama gecikir.', 2, 'Hız');
        $sc = $m['script_count'];
        $add('scripts', 'Script sayısı', $sc <= 25 ? 'pass' : ($sc <= 45 ? 'warn' : 'fail'), $sc.' script ('.$m['external_script_count'].' harici)', $sc <= 25 ? null : 'Üçüncü parti script yükü etkileşim süresini uzatır; kullanılmayan pixel/eklentiler kaldırılmalı, kalanlar defer/async yüklenmeli.', 2, 'Hız');
        $add('lazy', 'Görsellerde lazy-loading', $m['img_count'] === 0 ? 'info' : ($m['img_lazy'] > 0 ? 'pass' : 'warn'), $m['img_lazy'].' / '.$m['img_count'].' görsel lazy', $m['img_lazy'] > 0 ? null : 'Ekran dışı görsellere loading="lazy" eklenmeli; mobil LCP iyileşir.', 2, 'Hız');
        $add('iframes', 'Iframe kullanımı', $m['iframe_count'] <= 1 ? 'pass' : ($m['iframe_count'] <= 3 ? 'warn' : 'fail'), $m['iframe_count'].' iframe', $m['iframe_count'] <= 1 ? null : 'Her iframe ayrı bir sayfa yüküdür; gerekmeyenler kaldırılmalı.', 1, 'Hız');

        // ── Mobil & temel SEO/UX ──
        $add('viewport', 'Mobil viewport', $m['has_viewport'] ? 'pass' : 'fail', $m['has_viewport'] ? 'Tanımlı' : 'Yok', $m['has_viewport'] ? null : 'Mobil ölçekleme için viewport meta şart.', 3, 'Mobil');
        $add('title', 'Sayfa başlığı', $m['title_len'] === 0 ? 'fail' : ($m['title_len'] > 70 ? 'warn' : 'pass'), $m['title_len'] > 0 ? '"'.Str::limit($m['title'], 70).'" ('.$m['title_len'].' kr.)' : 'Yok', $m['title_len'] === 0 ? 'Başlık boş.' : ($m['title_len'] > 70 ? 'Google\'da kırpılır; 70 karakteri geçmemeli.' : null), 1, 'SEO');
        $add('meta_desc', 'Meta açıklama', $m['description_len'] === 0 ? 'warn' : 'pass', $m['description_len'].' karakter', $m['description_len'] === 0 ? 'Arama sonucunda tıklama oranını (CTR) etkiler.' : null, 1, 'SEO');
        $add('h1', 'Tek H1', $m['h1_count'] === 1 ? 'pass' : 'warn', $m['h1_count'].' adet H1', $m['h1_count'] === 1 ? null : 'Sayfada tam bir H1 olmalı.', 1, 'SEO');
        $add('canonical', 'Canonical etiketi', $m['has_canonical'] ? 'pass' : 'warn', $m['has_canonical'] ? 'Var' : 'Yok', $m['has_canonical'] ? null : 'Filtre/sıralama parametreli kopya URL\'ler için canonical şart.', 1, 'SEO');
        $add('ldjson', 'Yapısal veri (schema.org)', $m['has_ldjson'] ? 'pass' : 'warn', $m['has_ldjson'] ? 'Var' : 'Yok', $m['has_ldjson'] ? null : 'Product/Offer/AggregateRating şeması Google\'da fiyat+puan zengin sonucu getirir.', 1, 'SEO');
        $add('img_alt', 'Görsel alt metinleri', $m['img_no_alt'] === 0 ? 'pass' : ($m['img_no_alt'] <= 5 ? 'warn' : 'fail'), $m['img_no_alt'].' görsel alt\'sız', $m['img_no_alt'] === 0 ? null : 'Erişilebilirlik + görsel arama trafiği.', 1, 'SEO');

        // ── Güven & iletişim ──
        $add('whatsapp', 'WhatsApp iletişim butonu', $m['has_whatsapp'] ? 'pass' : 'warn', $m['has_whatsapp'] ? 'Var' : 'Bulunamadı', $m['has_whatsapp'] ? null : 'Türkiye\'de satın alma öncesi soru kanalı #1; sayfada wa.me linki olmalı.', 2, 'Güven');
        $add('trust_payment', 'Güvenli ödeme ibaresi', preg_match('#güvenli\s+(ödeme|alışveriş)|ssl|3d\s*secure|iyzico|paytr#iu', $html) ? 'pass' : 'warn', 'Metin taraması', null, 1, 'Güven');
        $add('trust_return', 'İade koşulu görünürlüğü', preg_match('#\d+\s*gün[^<]{0,40}iade|iade\s+garantisi|kolay\s+iade|ücretsiz\s+iade#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Ürün sayfasında "14/30 gün kolay iade" rozeti sepete ekleme oranını artırır.', 2, 'Güven');
        $add('trust_shipping', 'Kargo koşulu görünürlüğü', preg_match('#ücretsiz\s+kargo|kargo\s+bedava|aynı\s+gün\s+kargo|bugün\s+kargo#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Ücretsiz kargo eşiği ve teslim süresi ürün sayfasında fiyatın yanında olmalı.', 2, 'Güven');

        // ── Yunbi araçları ──
        $installed = $m['yunbi_widgets'];
        foreach (['announce.js', 'shipping.js', 'search.js', 'reviews.js', 'chat.js', 'wheel.js', 'cart-rec.js'] as $file) {
            $on = in_array($file, $installed, true);
            $add('yunbi_'.str_replace('.js', '', $file), self::YUNBI_WIDGETS[$file], $on ? 'pass' : 'info', $on ? 'Sayfada gömülü' : 'Bu sayfada gömülü değil', $on ? null : 'Yunbi panelinden embed kodu alınıp temaya eklenebilir.', 0, 'Yunbi');
        }

        // ── Sayfa tipine özel ──
        if ($type === 'home') {
            $add('search_box', 'Arama kutusu', $m['has_search_box'] ? 'pass' : 'fail', $m['has_search_box'] ? 'Var' : 'Bulunamadı', $m['has_search_box'] ? null : 'Arama kullanan ziyaretçi 2-3 kat daha yüksek oranda satın alır; kutu görünür olmalı.', 3, 'Ana sayfa');
            $add('campaign_bar', 'Kampanya/duyuru barı', (in_array('announce.js', $installed, true) || preg_match('#(topbar|top-bar|announcement|duyuru)#i', $html)) ? 'pass' : 'warn', 'Üst bar/duyuru', 'Aktif kampanya ve ücretsiz kargo eşiği ilk ekranda görünmeli.', 2, 'Ana sayfa');
            $add('social_proof_home', 'Sosyal kanıt (yorum/puan)', preg_match('#yorum|değerlendirme|müşteri\s+görüş#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Ana sayfada gerçek müşteri yorumu/puanı güven kurar.', 1, 'Ana sayfa');
        }

        if ($type === 'category') {
            $cards = preg_match_all('#class=["\'][^"\']*product(item|-item|card|-card|box)[^"\']*["\']#i', $html);
            $add('product_cards', 'Listede ürün kartı', $cards >= 8 ? 'pass' : ($cards > 0 ? 'warn' : 'info'), $cards.' kart (HTML)', $cards >= 8 ? null : 'Ürünler JS ile sonradan basılıyorsa ilk boyama boş görünür; SSR tercih edilmeli.', 1, 'Kategori');
            $add('filters', 'Filtreleme', preg_match('#filtre|filter#i', $html) ? 'pass' : 'warn', 'Metin taraması', 'Beden/renk/fiyat filtresi olmayan listede terk yükselir.', 2, 'Kategori');
            $add('sorting', 'Sıralama', preg_match('#sırala|sort#iu', $html) ? 'pass' : 'warn', 'Metin taraması', null, 1, 'Kategori');
            $add('quick_add', 'Listeden hızlı sepete ekleme', preg_match('#sepete\s+ekle#iu', $html) ? 'pass' : 'info', 'Metin taraması', 'Beden seçimli hızlı ekleme ürün sayfasına gitme zorunluluğunu kaldırır.', 1, 'Kategori');
            $add('badges', 'Kart rozetleri (indirim/yeni/çok satan)', preg_match('#indirim|yeni|çok\s+satan|%\s*\d+|son\s+\d+#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Rozetler listede dikkat çekip tıklamayı artırır.', 1, 'Kategori');
        }

        if ($type === 'product') {
            $add('atc', 'Sepete ekle butonu', preg_match('#sepete\s+ekle|divSatinAl|add-to-cart|addtocart#iu', $html) ? 'pass' : 'fail', 'Metin/ID taraması', null, 3, 'Ürün sayfası');
            $add('size_guide', 'Beden tablosu / rehberi', preg_match('#beden\s+(tablosu|rehberi|ölçü)|ölçü\s+tablosu|size\s+guide#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Beden kararsızlığı ayakkabı/giyimde 1 numaralı terk ve iade sebebi; beden rehberi + "kalıbı nasıl" notu ekleyin.', 3, 'Ürün sayfası');
            $add('stock_info', 'Stok/azlık bilgisi', preg_match('#son\s+\d+\s*(adet|ürün)|stokta\s+(var|yok)|tükendi|kalan#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Gerçek stok azlığı ("Son 3 adet") aciliyet yaratır; Ticimax stoğuyla beslenmeli.', 2, 'Ürün sayfası');
            $add('reviews_pdp', 'Ürün yorumları', (in_array('reviews.js', $installed, true) || preg_match('#yorum|değerlendirme|review#iu', $html)) ? 'pass' : 'fail', 'Metin taraması', 'Yorumu olan ürünler %50+ daha yüksek dönüşüm alır.', 3, 'Ürün sayfası');
            $add('installment', 'Taksit bilgisi', preg_match('#taksit#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Fiyatın altında "X taksit" ibaresi yüksek sepetlerde karar hızlandırır.', 1, 'Ürün sayfası');
            $add('breadcrumb', 'Breadcrumb', preg_match('#breadcrumb#i', $html) ? 'pass' : 'warn', 'Metin taraması', 'Kategoriye geri dönüş yolu keşfi kolaylaştırır.', 1, 'Ürün sayfası');
            $imgs = $m['img_count'];
            $add('gallery', 'Ürün görselleri', $imgs >= 4 ? 'pass' : 'warn', $imgs.' img etiketi', 'Ürün başına en az 4 fotoğraf (ön/yan/arka/ayakta) hedeflenmeli.', 2, 'Ürün sayfası');
            $add('video', 'Ürün videosu', preg_match('#<video\b|youtube\.com/embed|\.mp4#i', $html) ? 'pass' : 'info', 'Etiket taraması', 'Ürün videosu olan sayfalarda dönüşüm belirgin yüksek (Yunbi Kreatif Stüdyo videoları kullanılabilir).', 1, 'Ürün sayfası');
            $add('sticky_atc', 'Mobil yapışkan sepete ekle', preg_match('#(sticky|fixed)[^"\']*(basket|sepet|cart|buy)|mobile-?basket|fixedBasket#i', $html) ? 'pass' : 'info', 'Class taraması', 'Mobilde aşağı kaydırınca sepete ekle butonu ekranda kalmalı (+%8-12 sepete ekleme).', 2, 'Ürün sayfası');
            $add('cross_sell', 'Tamamlayıcı / benzer ürün bloğu', preg_match('#benzer\s+ürün|bunları\s+da|birlikte\s+al|tamamlayıcı|ilginizi\s+çekebilecek|related#iu', $html) ? 'pass' : 'warn', 'Metin taraması', 'Ürün sayfasında öneri bloğu sepet tutarını artırır (Yunbi öneri motoru bağlanabilir).', 2, 'Ürün sayfası');
            $add('delivery_eta', 'Teslimat tarihi tahmini', (in_array('shipping.js', $installed, true) || preg_match('#tahmini\s+teslim|bugün\s+kargo|yarın\s+kargo|kargoya\s+verilir#iu', $html)) ? 'pass' : 'warn', 'Metin taraması', '"Şimdi sipariş ver, yarın kargoda" bilgisi belirsizliği kaldırır (Yunbi Bugün Kargoda widget\'ı).', 2, 'Ürün sayfası');
        }

        if ($type === 'cart') {
            $add('cart_reachable', 'Sepet sayfası erişimi', $page['status'] === 200 ? 'pass' : 'warn', 'HTTP '.$page['status'], null, 1, 'Sepet');
            $add('cart_shipping_bar', 'Ücretsiz kargo ilerleme çubuğu', preg_match('#ücretsiz\s+kargo(ya)?\s+[^<]{0,30}(kaldı|için)#iu', $html) ? 'pass' : 'info', 'Metin taraması', '"Ücretsiz kargoya 150 TL kaldı" çubuğu sepet ortalamasını yükseltir.', 2, 'Sepet');
            $add('cart_coupon', 'Kupon alanı', preg_match('#kupon|indirim\s+kodu#iu', $html) ? 'info' : 'info', 'Metin taraması', 'Açık kupon kutusu "kupon arama" terkine yol açar; katlanabilir olmalı.', 0, 'Sepet');
        }

        return $c;
    }

    /** Ağırlıklı puan: pass=1, warn=0.5, fail=0; info/ağırlıksız kontroller hesaba girmez. */
    public function score(array $checks): int
    {
        $tot = 0;
        $got = 0.0;
        foreach ($checks as $ch) {
            $w = (int) ($ch['weight'] ?? 0);
            if ($w === 0 || $ch['status'] === 'info') {
                continue;
            }
            $tot += $w;
            $got += $w * match ($ch['status']) {
                'pass' => 1.0,
                'warn' => 0.5,
                default => 0.0,
            };
        }

        return $tot > 0 ? (int) round($got / $tot * 100) : 0;
    }
}
