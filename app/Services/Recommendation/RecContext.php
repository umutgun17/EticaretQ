<?php

namespace App\Services\Recommendation;

/**
 * Öneri isteği bağlamı — motorun tek girdisi.
 *
 * Her yüzey (sepete-ekleme, checkout, ana sayfa, e-posta, WhatsApp...) bu bağlamı
 * doldurur; motor yüzeyi TANIMAZ, yalnız bağlamı işler. Yeni yüzey eklemek =
 * bağlamı kurup bir pipeline seçmek.
 *
 * anchors: öneriyi tetikleyen ürün satırları (sepet satırları, son alımlar...).
 *   Her anchor: ['id'=>internal product id, 'brand'=>, 'category'=>, 'size'=>?string, 'qty'=>int]
 * preferredSizes: kişi-bazlı akışlarda müşterinin bilinen bedenleri (anchor'sız
 *   adaylar bu bedenlerden biri stokta olacak şekilde filtrelenir).
 */
class RecContext
{
    public int $tenantId;

    public string $surface = 'generic';

    public int $limit = 6;

    /** @var array<int, array{id:int, brand:?string, category:?string, size:?string, qty:int}> */
    public array $anchors = [];

    public ?int $customerId = null;

    /** @var int[] öneriden düşülecek ürünler (anchor'lar + müşterinin aldıkları + ...) */
    public array $excludeIds = [];

    /** Dışlanan MODEL anahtarları (sepetteki ürünün renk kardeşleri önerilmez). @var string[] */
    public array $excludeModels = [];

    /** @var string[] */
    public array $boostBrands = [];

    /** @var string[] */
    public array $boostCategories = [];

    /** @var string[] kişi-bazlı beden filtresi (boşsa anchor bedenleri kullanılır) */
    public array $preferredSizes = [];

    /** Sepet önerisi karışım modu (tenant ayarı rec_cart_mix): kategori harmanı + geçmiş alım + çeşitlendirme */
    public bool $cartMix = false;

    public function __construct(int $tenantId, string $surface, int $limit)
    {
        $this->tenantId = $tenantId;
        $this->surface = $surface;
        $this->limit = max(1, min(24, $limit));
    }

    /** @return int[] */
    public function anchorIds(): array
    {
        return array_values(array_unique(array_map(fn ($a) => (int) $a['id'], $this->anchors)));
    }

    /** Anchor'lardaki benzersiz bedenler (null'lar hariç). @return string[] */
    public function anchorSizes(): array
    {
        return array_values(array_unique(array_filter(array_map(fn ($a) => $a['size'], $this->anchors))));
    }

    /** Aday filtrelemede kullanılacak beden seti: anchor bedenleri yoksa preferredSizes. @return string[] */
    public function sizePool(): array
    {
        $sizes = $this->anchorSizes();

        return $sizes ?: $this->preferredSizes;
    }
}
