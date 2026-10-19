<?php

namespace App\Services\Catalog;

use App\Models\PlatformCategory;
use App\Models\Product;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Kategori Denetçisi — 3 katmanlı ürün sınıflandırıcı (TAMAMEN LLM'siz, 2026-07-06):
 *   1) Stok-kodu ailesi: aynı model kodunun temiz-kategorili kardeşleri (neredeyse bedava, çok isabetli)
 *   2) Ad kuralları: NameRuleClassifier — addan cinsiyet (unisex→Kadın+Erkek) + tip (sneaker/babet/bot...)
 *   3) Embedding kNN: pgvector komşu kategori dağılımı + beden seti yaş bekçisi
 * Karma politika: ad kuralı + kNN hemfikir → tier=auto; tek katman → tier=review.
 * (LLM katmanı kullanıcı kararıyla KALDIRILDI — kredi bağımlılığı yok.)
 */
class ProductCategorizer
{
    /** Katmanlar hemfikirken otomatik uygulama eşiği. */
    public const AUTO_CONFIDENCE = 0.85;

    protected array $ctx = [];

    public function __construct(protected NameRuleClassifier $rules)
    {
    }

    /** Tenant başına bir kez kurulan bağlam: yaprak listesi, aile indeksi, kategori cinsiyeti. */
    public function buildContext(Tenant $tenant): void
    {
        $cats = PlatformCategory::forTenant($tenant->id)
            ->where('is_active', true)
            ->get()
            ->keyBy('platform_category_id');

        $leaves = $cats->filter(fn ($c) => $c->is_assignable && $c->children_count === 0);

        // Aile indeksi: model kodu → temiz-kategorili kardeşlerin birincil kategori oyları
        $family = [];
        $clean = Product::forTenant($tenant->id)
            ->where('is_active', true)
            ->whereNotNull('category_path')
            ->where('category_path', '!=', '')
            ->where('category', '!=', 'Kategorisiz')
            ->get(['id', 'name', 'sku', 'metadata']);

        foreach ($clean as $p) {
            $primary = (int) ($p->metadata['ana_kategori_id'] ?? 0);
            if ($primary <= 0 || ! isset($cats[$primary]) || ! $cats[$primary]->is_assignable) {
                continue;
            }
            foreach ($this->extractCodes($p->name, $p->sku) as $code) {
                $family[$code][] = $primary;
            }
        }

        $this->ctx = [
            'tenant_id' => $tenant->id,
            'cats' => $cats,
            'leaves' => $leaves,
            'family' => $family,
        ];

        $this->rules->buildContext($tenant);

        // HNSW post-filter tuzağı: sorunlu ürünlerin en yakın komşuları çoğunlukla yine
        // sorunlu (filtreyle elenen) ürünler → varsayılan ef_search(40) 20 temiz komşu
        // bulamıyor. CLI süreci tek PG oturumu, ayar süreç boyunca kalır.
        DB::statement('SET hnsw.ef_search = 400');
    }

    /**
     * Bir ürünü sınıflandırır. Dönen dizi CategorySuggestion alanlarıyla uyumludur;
     * hiçbir öneri üretilemezse null döner. Ticimax'a YAZMAZ.
     */
    public function classify(Product $product): ?array
    {
        $cats = $this->ctx['cats'];

        $sizes = $this->productSizes($product);
        $ageGroup = $this->ageGroupFromSizes($sizes); // cocuk|yetiskin|null

        $familyVote = $this->familyVote($product);
        $knnVote = $this->knnVote($product);

        // Kısa devre: aile ≥3 temiz kardeş ve ≥%80 aynı kategoriyse LLM'e gerek yok
        if ($familyVote && $familyVote['count'] >= 3 && $familyVote['share'] >= 0.8) {
            $primary = $familyVote['category_id'];
            $secondaries = $this->siblingSecondaries($product, $primary);

            return $this->buildSuggestion($product, $primary, $secondaries, 0.95, 'auto', [
                'family' => $familyVote,
                'knn' => $knnVote,
                'llm' => null,
            ], "Model ailesi ({$familyVote['count']} kardeş, %" . round($familyVote['share'] * 100) . ") aynı kategoride: " . ($cats[$primary]->path ?? $primary));
        }

        // ── Katman 2: ad kuralları (LLM'in yerini aldı) ──
        $gender = $this->rules->nameGender($product->name);
        $nameType = $this->rules->nameType($product->name);

        // Beden bekçisi: ad-cinsiyeti beden yaş grubuyla çelişiyorsa ad dalları güvenilmez
        $branches = $gender['branches'];
        if ($ageGroup && $gender['age'] && $ageGroup !== $gender['age']) {
            $branches = [];
        }
        // Ad cinsiyet vermiyorsa beden yaş grubu daraltır: çocuksa iki çocuk dalı
        if (! $branches && $ageGroup === 'cocuk') {
            $branches = ['Çocuk/Kız', 'Çocuk/Erkek'];
        }

        $candidates = []; // id => leaf (ad kuralının önerdiği yapraklar)
        if ($nameType) {
            foreach ($branches as $b) {
                if ($leaf = $this->rules->findLeaf($b, $nameType)) {
                    $candidates[$leaf->platform_category_id] = $leaf;
                }
            }
        }

        $knnCat = $knnVote['category_id'] ?? 0;
        $knnStrong = $knnVote && $knnVote['share'] >= 0.4;
        $knnAgrees = false;
        if ($knnStrong && $candidates) {
            $knnName = mb_strtolower($cats[$knnCat]->name ?? '');
            foreach ($candidates as $id => $leaf) {
                if ($id === $knnCat || mb_strtolower($leaf->name) === $knnName) {
                    $knnAgrees = true;
                    break;
                }
            }
        }

        if ($candidates && $knnAgrees) {
            // Ad kuralı + kNN hemfikir → auto (karma politika, LLM'siz)
            $primary = isset($candidates[$knnCat]) ? $knnCat : array_key_first($candidates);
            $secondaries = array_values(array_diff(array_keys($candidates), [$primary]));

            return $this->buildSuggestion($product, $primary, $secondaries, 0.9, 'auto', [
                'family' => $familyVote, 'knn' => $knnVote,
                'rules' => ["Ad kuralı: tip '{$nameType}'" . ($gender['unisex'] ? " + unisex çift dal" : '')],
                'agree' => ['name', 'knn'], 'age_group' => $ageGroup,
            ], "Ad kuralı ({$cats[$primary]->path}) ile kNN komşuları hemfikir (%" . round(($knnVote['share'] ?? 0) * 100) . ')');
        }

        if ($candidates) {
            // Yalnız ad kuralı → onay kuyruğu
            $best = collect($candidates)->sortByDesc(fn ($l) => $l->product_count ?? 0)->first();
            $primary = $best->platform_category_id;
            $secondaries = array_values(array_diff(array_keys($candidates), [$primary]));

            return $this->buildSuggestion($product, $primary, $secondaries, 0.65, 'review', [
                'family' => $familyVote, 'knn' => $knnVote,
                'rules' => ["Ad kuralı: tip '{$nameType}', dallar: " . implode('+', $branches)],
                'agree' => [], 'age_group' => $ageGroup,
            ], 'Ad kuralından türetildi (kNN teyidi yok): ' . $cats[$primary]->path);
        }

        if ($knnStrong && $knnVote['share'] >= 0.5 && isset($cats[$knnCat])) {
            // Yalnız kNN → onay kuyruğu (yaş bekçisiyle)
            $pathRoot = mb_strtolower(explode(' > ', (string) $cats[$knnCat]->path)[0] ?? '');
            $isChildBranch = str_starts_with($pathRoot, 'çocuk');
            if (($ageGroup === 'cocuk' && ! $isChildBranch) || ($ageGroup === 'yetiskin' && $isChildBranch)) {
                return null; // komşular yanlış yaş grubuna işaret ediyor — öneri üretme
            }

            return $this->buildSuggestion($product, $knnCat, [], round(min(0.7, $knnVote['share']), 3), 'review', [
                'family' => $familyVote, 'knn' => $knnVote, 'rules' => [],
                'agree' => [], 'age_group' => $ageGroup,
            ], 'Embedding komşularının çoğunluğu: ' . $cats[$knnCat]->path);
        }

        return null; // hiçbir katman yeterince emin değil
    }

    // ── Katman 1: model ailesi ──

    /** Üründeki model kodlarının temiz kardeş oyları: en yaygın birincil kategori + pay. */
    protected function familyVote(Product $product): ?array
    {
        $votes = [];
        foreach ($this->extractCodes($product->name, $product->sku) as $code) {
            foreach ($this->ctx['family'][$code] ?? [] as $catId) {
                $votes[] = $catId;
            }
        }
        if (! $votes) {
            return null;
        }

        $counts = array_count_values($votes);
        arsort($counts);
        $top = array_key_first($counts);

        return [
            'category_id' => (int) $top,
            'count' => count($votes),
            'share' => $counts[$top] / count($votes),
            'path' => $this->ctx['cats'][$top]->path ?? null,
        ];
    }

    /** Temiz kardeşlerin ikincil kategorileri (aynadan) — kısa devrede ikincilleri de kopyalar. */
    protected function siblingSecondaries(Product $product, int $primary): array
    {
        $codes = $this->extractCodes($product->name, $product->sku);
        if (! $codes) {
            return [];
        }

        $like = array_map(fn ($c) => '%' . $c . '%', $codes);
        $sibs = Product::forTenant($product->tenant_id)
            ->where('id', '!=', $product->id)
            ->where('metadata->ana_kategori_id', $primary)
            ->where(function ($q) use ($like) {
                foreach ($like as $l) {
                    $q->orWhere('name', 'ilike', $l);
                }
            })
            ->limit(5)
            ->pluck('platform_product_id')
            ->map(fn ($v) => (int) $v);

        if ($sibs->isEmpty()) {
            return [];
        }

        $rows = DB::table('product_platform_categories as ppc')
            ->join('platform_categories as pc', function ($j) {
                $j->on('pc.tenant_id', '=', 'ppc.tenant_id')
                    ->on('pc.platform_category_id', '=', 'ppc.platform_category_id');
            })
            ->where('ppc.tenant_id', $product->tenant_id)
            ->whereIn('ppc.platform_product_id', $sibs)
            ->where('pc.is_assignable', true)
            ->where('pc.children_count', 0)
            ->where('ppc.platform_category_id', '!=', $primary)
            ->selectRaw('ppc.platform_category_id, count(distinct ppc.platform_product_id) as c')
            ->groupBy('ppc.platform_category_id')
            ->havingRaw('count(distinct ppc.platform_product_id) >= ?', [max(1, (int) ceil($sibs->count() / 2))])
            ->pluck('ppc.platform_category_id')
            ->map(fn ($v) => (int) $v)
            ->all();

        return $rows;
    }

    // ── Katman 2: kurallar + kNN ──

    protected function productSizes(Product $product): array
    {
        return DB::table('product_variants')
            ->where('product_id', $product->id)
            ->whereRaw("attributes->>'Beden' ~ '^[0-9]+$'")
            ->selectRaw("distinct (attributes->>'Beden')::int as beden")
            ->pluck('beden')
            ->sort()->values()->all();
    }

    /** Beden setinden yaş grubu: hepsi ≤35 → çocuk, hepsi ≥36 → yetişkin, karışıksa null. */
    protected function ageGroupFromSizes(array $sizes): ?string
    {
        if (! $sizes) {
            return null;
        }
        if (max($sizes) <= 35 && min($sizes) >= 20) {
            return 'cocuk';
        }
        if (min($sizes) >= 36) {
            return 'yetiskin';
        }

        return null;
    }

    /** pgvector komşularının birincil kategori dağılımı (temiz-kategorili ilk 20 komşu). */
    protected function knnVote(Product $product): ?array
    {
        if ($product->embedding === null) {
            return null;
        }

        $rows = DB::select("
            select (p.metadata->>'ana_kategori_id')::int as cat_id, count(*) as c
            from (
                select metadata
                from products
                where tenant_id = ? and id != ? and is_active = true
                  and embedding is not null
                  and category != 'Kategorisiz'
                  and coalesce(category_path, '') != ''
                order by embedding <=> (select embedding from products where id = ?)
                limit 20
            ) p
            where coalesce(p.metadata->>'ana_kategori_id', '') != ''
            group by 1 order by c desc
        ", [$product->tenant_id, $product->id, $product->id]);

        if (! $rows) {
            return null;
        }

        $total = array_sum(array_column($rows, 'c'));
        $top = $rows[0];
        if (! isset($this->ctx['cats'][(int) $top->cat_id])) {
            return null;
        }

        return [
            'category_id' => (int) $top->cat_id,
            'share' => $top->c / max(1, $total),
            'neighbors' => $total,
            'path' => $this->ctx['cats'][(int) $top->cat_id]->path ?? null,
        ];
    }

    // ── Yardımcılar ──

    /** Ürün adı/sku'dan model kodları: "013M101210", "TBOKTY015" gibi harf+rakam karışık token'lar. */
    protected function extractCodes(?string $name, ?string $sku): array
    {
        $codes = [];
        $hay = trim(($name ?? '') . ' ' . ($sku ?? ''));
        if (preg_match_all('/\b(?=[A-Z0-9-]{6,})(?:[A-Z]+\d|\d+[A-Z])[A-Z0-9-]{4,}\b/u', mb_strtoupper($hay), $m)) {
            $codes = array_unique($m[0]);
        }

        return array_values($codes);
    }

    protected function currentState(Product $product): array
    {
        $current = DB::table('product_platform_categories')
            ->where('tenant_id', $product->tenant_id)
            ->where('platform_product_id', (int) $product->platform_product_id)
            ->pluck('platform_category_id')
            ->map(fn ($v) => (int) $v)
            ->all();

        return [
            'primary_id' => (int) ($product->metadata['ana_kategori_id'] ?? 0),
            'category' => $product->category,
            'path' => $product->category_path,
            'category_ids' => $current,
        ];
    }

    protected function buildSuggestion(Product $product, int $primary, array $secondaries, float $conf, string $tier, array $sources, string $rationale): array
    {
        return [
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'action' => 'recategorize',
            'current' => $this->currentState($product),
            'suggested_primary_id' => $primary,
            'suggested_category_ids' => $secondaries,
            'new_category' => null,
            'confidence' => $conf,
            'tier' => $tier,
            'sources' => $sources,
            'rationale' => $rationale,
        ];
    }
}
