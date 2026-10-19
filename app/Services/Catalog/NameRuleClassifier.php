<?php

namespace App\Services\Catalog;

use App\Models\PlatformCategory;
use App\Models\Product;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Kural-bazlı (LLM'siz) kategori denetçisi — ürün ADINDAN cinsiyet + tip çıkarır,
 * mevcut atamalarla karşılaştırır ve düzeltme/tamamlama önerisi üretir:
 *   • "Unisex" adlı yetişkin ürün → Kadın ve Erkek'te eşdeğer yaprakların İKİSİ de olmalı
 *   • addaki cinsiyet ↔ atanmış kök çelişkisi (adı "Kadın", Erkek dalında vb.)
 *   • addaki tip ↔ yaprak tipi çelişkisi (adı "Terlik", Sandalet yaprağında vb.)
 *   • addaki tip için eksik yaprak (adı "Sneaker", Spor Ayakkabı yaprağı atanmamış)
 * TÜM öneriler tier=review (panelde onay bekler); Ticimax'a asla doğrudan yazmaz.
 * Beden-seti yaş bekçisi: ad ile beden çelişiyorsa cinsiyet kuralları uygulanmaz.
 */
class NameRuleClassifier
{
    /**
     * Tip sözlüğü — SIRALI (özgül olan önce; ilk eşleşme kazanır).
     * name: ürün adı deseni, leaf: yaprak kategori adı deseni,
     * compat: bu ad-tipiyle ÇELİŞMEYEN yaprak tipleri (kendisi hariç).
     */
    protected const TYPES = [
        'kar_botu' => ['name' => '/kar\s*bot/iu', 'leaf' => '/kar bot/iu', 'compat' => ['bot', 'cizme', 'trekking', 'topuklu'], 'fallback' => ['bot']],
        'trekking' => ['name' => '/trekking|outdoor/iu', 'leaf' => '/trekking|outdoor/iu', 'compat' => ['bot', 'kar_botu', 'cizme', 'spor']],
        'cizme' => ['name' => '/çizme/iu', 'leaf' => '/çizme/iu', 'compat' => ['bot', 'kar_botu', 'trekking', 'topuklu'], 'fallback' => ['bot']],
        'bot' => ['name' => '/\bbotu?\b/iu', 'leaf' => '/\bbot\b|bot\s*&|bot ve/iu', 'compat' => ['kar_botu', 'cizme', 'trekking', 'topuklu']],
        'sneaker' => ['name' => '/sneaker/iu', 'leaf' => '/sneaker/iu', 'compat' => ['spor', 'casual'], 'fallback' => ['spor']],
        'patenli' => ['name' => '/paten/iu', 'leaf' => '/paten/iu', 'compat' => ['spor', 'sneaker'], 'fallback' => ['spor']],
        'futbol' => ['name' => '/futbol|krampon|halı saha/iu', 'leaf' => '/futbol/iu', 'compat' => ['spor', 'sneaker'], 'fallback' => ['spor']],
        'babet' => ['name' => '/babet/iu', 'leaf' => '/babet/iu', 'compat' => ['casual']],
        'loafer' => ['name' => '/loafer|makosen/iu', 'leaf' => '/loafer/iu', 'compat' => ['casual', 'babet']],
        'ev_terligi' => ['name' => '/ev terli/iu', 'leaf' => '/ev terli/iu', 'compat' => ['terlik'], 'fallback' => ['terlik']],
        'sandalet' => ['name' => '/sandalet/iu', 'leaf' => '/sandalet/iu', 'compat' => ['topuklu']],
        'terlik' => ['name' => '/terlik|parmak aras/iu', 'leaf' => '/terli/iu', 'compat' => ['ev_terligi', 'topuklu']],
        'topuklu' => ['name' => '/topuk/iu', 'leaf' => '/topuklu/iu', 'compat' => ['sandalet', 'terlik', 'bot', 'cizme']],
        'spor' => ['name' => '/spor ayakkab|koşu ayakkab|yürüyüş ayakkab|tenis ayakkab|basketbol/iu', 'leaf' => '/spor ayakkab/iu', 'compat' => ['sneaker', 'trekking', 'futbol', 'patenli', 'casual'], 'fallback' => ['sneaker']],
        'casual' => ['name' => '/casual/iu', 'leaf' => '/casual|günlük/iu', 'compat' => ['spor', 'sneaker', 'babet', 'loafer'], 'fallback' => ['spor']],
        'sirt_cantasi' => ['name' => '/sırt çanta/iu', 'leaf' => '/sırt çanta/iu', 'compat' => ['canta'], 'fallback' => ['canta']],
        'omuz_cantasi' => ['name' => '/omuz çanta/iu', 'leaf' => '/omuz çanta/iu', 'compat' => ['canta'], 'fallback' => ['canta']],
        'el_cantasi' => ['name' => '/el çanta/iu', 'leaf' => '/el çanta/iu', 'compat' => ['canta'], 'fallback' => ['canta']],
        'spor_cantasi' => ['name' => '/spor çanta/iu', 'leaf' => '/spor çanta/iu', 'compat' => ['canta'], 'fallback' => ['canta']],
        'canta' => ['name' => '/çanta/iu', 'leaf' => '/çanta/iu', 'compat' => ['sirt_cantasi', 'omuz_cantasi', 'el_cantasi', 'spor_cantasi']],
        'valiz' => ['name' => '/valiz/iu', 'leaf' => '/valiz/iu', 'compat' => []],
        'cuzdan' => ['name' => '/cüzdan/iu', 'leaf' => '/cüzdan/iu', 'compat' => []],
        'gozluk' => ['name' => '/gözlük/iu', 'leaf' => '/gözlük/iu', 'compat' => []],
        'corap' => ['name' => '/çorap/iu', 'leaf' => '/çorap/iu', 'compat' => []],
        'mont' => ['name' => '/\bmont\b/iu', 'leaf' => '/mont/iu', 'compat' => ['ceket', 'yagmurluk']],
        'ceket' => ['name' => '/ceket/iu', 'leaf' => '/ceket/iu', 'compat' => ['mont']],
        'yelek' => ['name' => '/yelek/iu', 'leaf' => '/yelek/iu', 'compat' => []],
        'yagmurluk' => ['name' => '/yağmurluk/iu', 'leaf' => '/yağmurluk/iu', 'compat' => ['mont']],
        'tshirt' => ['name' => '/t-?shirt|tişört/iu', 'leaf' => '/tshirt|t-?shirt/iu', 'compat' => []],
    ];

    /** Tip/cinsiyet denetimi dışı tutulan yapraklar (malzeme/kampanya kategorileri). */
    protected const NEUTRAL_LEAF = '/hakiki deri|fırsat|kategorisiz/iu';

    protected array $ctx = [];

    public function buildContext(Tenant $tenant): void
    {
        $cats = PlatformCategory::forTenant($tenant->id)
            ->where('is_active', true)
            ->get()
            ->keyBy('platform_category_id');

        $leaves = $cats->filter(fn ($c) => $c->is_assignable && $c->children_count === 0);

        // Yaprak indeksi: kök segmenti (Kadın|Erkek|Çocuk>Kız Çocuk|Çocuk>Erkek Çocuk) → tip → yaprak
        $index = [];
        foreach ($leaves as $leaf) {
            if (preg_match(self::NEUTRAL_LEAF, $leaf->name)) {
                continue;
            }
            $branch = $this->branchOf($leaf->path);
            $type = $this->leafType($leaf->name);
            if (! $branch || ! $type) {
                continue;
            }
            // Aynı dal+tipte birden çok yaprak varsa EN SADE adlı kazanır: az tip-deseni
            // eşleşen önce ("Kadın Çizme" > "Kadın Topuklu Bot&Çizme"), eşitse ürünü çok olan.
            $cur = $index[$branch][$type] ?? null;
            if (! $cur
                || $this->typeMatchCount($leaf->name) < $this->typeMatchCount($cur->name)
                || ($this->typeMatchCount($leaf->name) === $this->typeMatchCount($cur->name)
                    && ($leaf->product_count ?? 0) > ($cur->product_count ?? 0))) {
                $index[$branch][$type] = $leaf;
            }
        }

        $this->ctx = [
            'tenant_id' => $tenant->id,
            'cats' => $cats,
            'leaves' => $leaves,
            'index' => $index,
        ];
    }

    /** Cinsiyet dalı anahtarı: Kadın | Erkek | Çocuk/Kız | Çocuk/Erkek (diğer kökler null). */
    protected function branchOf(?string $path): ?string
    {
        $segs = explode(' > ', (string) $path);
        $root = $segs[0] ?? '';
        if ($root === 'Kadın' || $root === 'Erkek') {
            return $root;
        }
        if ($root === 'Çocuk') {
            $sub = $segs[1] ?? '';
            if (str_contains($sub, 'Kız')) {
                return 'Çocuk/Kız';
            }
            if (str_contains($sub, 'Erkek')) {
                return 'Çocuk/Erkek';
            }

            return 'Çocuk/Kız'; // dalsız çocuk yaprağı (ör. Patenli) — pratik varsayım
        }

        return null;
    }

    /** Dal+tip için yaprak bul; doğrudan yoksa GÜVENLİ fallback zincirinden (sneaker→spor gibi). */
    public function findLeaf(string $branch, string $type): ?PlatformCategory
    {
        $index = $this->ctx['index'];
        if (isset($index[$branch][$type])) {
            return $index[$branch][$type];
        }
        foreach (self::TYPES[$type]['fallback'] ?? [] as $fb) {
            if (isset($index[$branch][$fb])) {
                return $index[$branch][$fb];
            }
        }

        return null;
    }

    protected function leafType(string $leafName): ?string
    {
        foreach (self::TYPES as $key => $t) {
            if (preg_match($t['leaf'], $leafName)) {
                return $key;
            }
        }

        return null;
    }

    /** Yaprak adında kaç tip deseni eşleşiyor (sadelik ölçüsü — index tercihi için). */
    protected function typeMatchCount(string $leafName): int
    {
        $n = 0;
        foreach (self::TYPES as $t) {
            if (preg_match($t['leaf'], $leafName)) {
                $n++;
            }
        }

        return $n;
    }

    public function nameType(string $productName): ?string
    {
        foreach (self::TYPES as $key => $t) {
            if (preg_match($t['name'], $productName)) {
                return $key;
            }
        }

        return null;
    }

    /** Ad-tipi ile yaprak-tipi çelişiyor mu (simetrik uyumluluk kontrolü)? */
    protected function conflicts(string $nameType, string $leafType): bool
    {
        if ($nameType === $leafType) {
            return false;
        }
        if (in_array($leafType, self::TYPES[$nameType]['compat'], true)) {
            return false;
        }
        if (in_array($nameType, self::TYPES[$leafType]['compat'], true)) {
            return false;
        }

        return true;
    }

    /**
     * Addan cinsiyet sinyali:
     *  ['age' => 'yetiskin'|'cocuk'|null, 'unisex' => bool, 'branches' => hedef dallar]
     */
    public function nameGender(string $name): array
    {
        $isChild = (bool) preg_match('/çocuk|bebek|patik|garson|filet/iu', $name);
        $unisex = (bool) preg_match('/un[ıi]sex/iu', $name);
        $kadin = (bool) preg_match('/\bkad[ıi]n/iu', $name);
        $erkek = (bool) preg_match('/\berkek/iu', $name) && ! preg_match('/erkek\s+çocuk/iu', $name);

        if ($isChild) {
            $kiz = (bool) preg_match('/kız/iu', $name);
            $erkekC = (bool) preg_match('/erkek\s+çocuk/iu', $name);
            $branches = [];
            if ($kiz) {
                $branches[] = 'Çocuk/Kız';
            }
            if ($erkekC) {
                $branches[] = 'Çocuk/Erkek';
            }
            if (! $branches) { // "Çocuk Unisex ..." veya sadece "Çocuk ..." → iki dal
                $branches = ['Çocuk/Kız', 'Çocuk/Erkek'];
            }

            return ['age' => 'cocuk', 'unisex' => $unisex || count($branches) === 2, 'branches' => $branches];
        }

        if ($unisex) {
            return ['age' => 'yetiskin', 'unisex' => true, 'branches' => ['Kadın', 'Erkek']];
        }
        if ($kadin && ! $erkek) {
            return ['age' => 'yetiskin', 'unisex' => false, 'branches' => ['Kadın']];
        }
        if ($erkek && ! $kadin) {
            return ['age' => 'yetiskin', 'unisex' => false, 'branches' => ['Erkek']];
        }

        return ['age' => null, 'unisex' => false, 'branches' => []];
    }

    /**
     * Kategorili bir ürünü denetler; düzeltme gerekiyorsa CategorySuggestion verisi döner.
     * Tüm öneriler tier=review — panelden onaylanmadan hiçbir şey yazılmaz.
     */
    public function audit(Product $product, array $currentLeafIds): ?array
    {
        $leaves = $this->ctx['leaves'];

        // Mevcut atanabilir yapraklar (nötr olanlar korunur ama kurala girmez)
        $current = [];   // id => leaf model (kurala tabi)
        $neutral = [];   // id => leaf model (dokunulmaz)
        foreach ($currentLeafIds as $id) {
            $leaf = $leaves[$id] ?? null;
            if (! $leaf) {
                continue;
            }
            if (preg_match(self::NEUTRAL_LEAF, $leaf->name) || ! $this->branchOf($leaf->path)) {
                $neutral[$id] = $leaf;
            } else {
                $current[$id] = $leaf;
            }
        }
        if (! $current) {
            return null; // kategorisiz/karışık — bunlar catalog:categorize'ın işi
        }

        $gender = $this->nameGender($product->name);
        $nameType = $this->nameType($product->name);
        $findings = [];
        $target = $current; // id => leaf

        // ── Yaş bekçisi: beden seti ad ile çelişiyorsa cinsiyet kuralları atlanır ──
        $sizeAge = $this->ageGroupFromSizes($this->productSizes($product));
        $genderSafe = ! ($gender['age'] && $sizeAge && $gender['age'] !== $sizeAge);

        if ($genderSafe && $gender['branches']) {
            $wanted = $gender['branches'];
            $adultScope = $gender['age'] === 'yetiskin' ? ['Kadın', 'Erkek'] : ['Çocuk/Kız', 'Çocuk/Erkek'];

            // 1) Yanlış daldakileri doğru dala taşı (yalnız aynı yaş kapsamı içinde)
            foreach ($target as $id => $leaf) {
                $b = $this->branchOf($leaf->path);
                if (! in_array($b, $adultScope, true) || in_array($b, $wanted, true)) {
                    continue;
                }
                $type = $this->leafType($leaf->name);
                unset($target[$id]);
                $findings[] = "Adı '{$this->genderLabel($wanted)}' diyor ama ürün {$leaf->path} dalında — çıkarılması önerildi";
                foreach ($wanted as $w) {
                    $eq = $type ? $this->findLeaf($w, $type) : null;
                    if ($eq && ! isset($target[$eq->platform_category_id])) {
                        $target[$eq->platform_category_id] = $eq;
                        $findings[] = "→ yerine {$eq->path} eklendi";
                    }
                }
            }

            // 2) Unisex/çift-dal tamamlama: bir dalda olan tip diğer dalda da olsun
            if (count($wanted) === 2) {
                foreach ($target as $leaf) {
                    $b = $this->branchOf($leaf->path);
                    $type = $this->leafType($leaf->name);
                    if (! $type || ! in_array($b, $wanted, true)) {
                        continue;
                    }
                    foreach ($wanted as $w) {
                        if ($w === $b) {
                            continue;
                        }
                        $eq = $this->findLeaf($w, $type);
                        if ($eq && ! isset($target[$eq->platform_category_id])) {
                            $target[$eq->platform_category_id] = $eq;
                            $findings[] = "Adında 'Unisex' — {$leaf->path} karşılığı {$eq->path} eksikti, eklenmesi önerildi";
                        }
                    }
                }
            }
        }

        // ── Tip kuralları: hedefteki dallar için addaki tip yaprağı olsun, çelişen çıksın ──
        if ($nameType) {
            $branches = [];
            foreach ($target as $leaf) {
                $branches[$this->branchOf($leaf->path)] = true;
            }
            foreach (array_keys($branches) as $b) {
                // çelişen yaprakları çıkar
                foreach ($target as $id => $leaf) {
                    if ($this->branchOf($leaf->path) !== $b) {
                        continue;
                    }
                    $lt = $this->leafType($leaf->name);
                    if ($lt && $this->conflicts($nameType, $lt)) {
                        unset($target[$id]);
                        $findings[] = "Adındaki tip '{$nameType}' ile {$leaf->path} çelişiyor — çıkarılması önerildi";
                    }
                }
                // doğru tip yaprağını ekle
                $eq = $this->findLeaf($b, $nameType);
                if ($eq && ! isset($target[$eq->platform_category_id])) {
                    $target[$eq->platform_category_id] = $eq;
                    $findings[] = "Adındaki tip için {$eq->path} eksikti, eklenmesi önerildi";
                }
            }
        }

        if (! $target) {
            return null; // her şeyi çıkarmak isteyen öneri üretme — güvenli değil
        }

        $targetIds = array_keys($target);
        $currentIds = array_keys($current);
        sort($targetIds);
        sort($currentIds);
        if ($targetIds === $currentIds) {
            return null; // değişiklik yok
        }

        // Birincil: mevcut birincil hedefte kaldıysa o; yoksa ad-tipine uyan; yoksa en dolu yaprak
        $curPrimary = (int) ($product->metadata['ana_kategori_id'] ?? 0);
        $primary = in_array($curPrimary, $targetIds, true) ? $curPrimary : 0;
        if (! $primary && $nameType) {
            foreach ($target as $id => $leaf) {
                if ($this->leafType($leaf->name) === $nameType) {
                    $primary = $id;
                    break;
                }
            }
        }
        if (! $primary) {
            $best = collect($target)->sortByDesc(fn ($l) => $l->product_count ?? 0)->first();
            $primary = $best->platform_category_id;
        }

        // Nötr yapraklar (FIRSAT vb.) korunsun diye ikincillere eklenir
        $secondaries = array_values(array_unique(array_merge(
            array_diff($targetIds, [$primary]),
            array_keys($neutral)
        )));

        return [
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'action' => 'recategorize',
            'current' => [
                'primary_id' => $curPrimary,
                'category' => $product->category,
                'path' => $product->category_path,
                'category_ids' => $currentLeafIds,
            ],
            'suggested_primary_id' => $primary,
            'suggested_category_ids' => $secondaries,
            'new_category' => null,
            'confidence' => $gender['unisex'] ? 0.8 : 0.7,
            'tier' => 'review',
            'sources' => [
                'family' => null,
                'knn' => null,
                'rules' => $findings,
                'agree' => [],
                'age_group' => $sizeAge,
            ],
            'rationale' => implode('; ', $findings),
        ];
    }

    protected function genderLabel(array $branches): string
    {
        return implode('+', array_map(fn ($b) => str_replace('Çocuk/', '', $b) . (str_starts_with($b, 'Çocuk') ? ' Çocuk' : ''), $branches));
    }

    protected function productSizes(Product $product): array
    {
        return DB::table('product_variants')
            ->where('product_id', $product->id)
            ->whereRaw("attributes->>'Beden' ~ '^[0-9]+$'")
            ->selectRaw("distinct (attributes->>'Beden')::int as beden")
            ->pluck('beden')
            ->sort()->values()->all();
    }

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
}
