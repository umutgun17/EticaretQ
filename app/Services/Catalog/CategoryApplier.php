<?php

namespace App\Services\Catalog;

use App\Models\CategorySuggestion;
use App\Models\Channel;
use App\Models\PlatformCategory;
use App\Models\Product;
use App\Models\ProductPlatformCategory;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Log;

/**
 * Kategori Denetçisi — onaylı/otomatik önerileri Ticimax'a yazar.
 * Plan: hedef yapraklar + ataları eklenir (SaveUrunKategori), hedefte olmayan
 * ağaç-içi atamalar çıkarılır (DeleteUrunKategori), ana kategori değiştiyse
 * UrunKartiGuncelle (AnaKategoriGuncelle). Kampanya kategorileri KORUNUR;
 * "Kategorisiz" her zaman çıkarılabilir. create_category önerileri burada
 * İŞLENMEZ (kategori açma ayrı, her zaman kullanıcı onayıyla).
 */
class CategoryApplier
{
    protected array $services = [];

    protected function serviceFor(int $tenantId): TicimaxService
    {
        if (! isset($this->services[$tenantId])) {
            $channel = Channel::where('tenant_id', $tenantId)
                ->where('type', 'ticimax-ecommerce')
                ->where('is_active', true)
                ->firstOrFail();
            $this->services[$tenantId] = TicimaxService::fromChannel($channel);
        }

        return $this->services[$tenantId];
    }

    /**
     * Öneriden yazma planı çıkarır (Ticimax'a DOKUNMAZ).
     *
     * @return array{adds:array, removes:array, primary_change:?array}|null
     */
    public function plan(CategorySuggestion $s): ?array
    {
        if ($s->action !== 'recategorize' || ! $s->suggested_primary_id) {
            return null;
        }

        $product = Product::find($s->product_id);
        if (! $product) {
            return null;
        }

        $cats = PlatformCategory::forTenant($s->tenant_id)->get()->keyBy('platform_category_id');

        // Hedef küme: birincil + ikinciller + tüm ataları
        $target = [];
        foreach (array_merge([(int) $s->suggested_primary_id], array_map('intval', $s->suggested_category_ids ?? [])) as $leaf) {
            foreach ($this->withAncestors($leaf, $cats) as $id) {
                $target[$id] = true;
            }
        }

        $ppid = (int) $product->platform_product_id;
        $current = ProductPlatformCategory::forTenant($s->tenant_id)
            ->where('platform_product_id', $ppid)
            ->pluck('platform_category_id')
            ->map(fn ($v) => (int) $v)
            ->all();
        $currentSet = array_flip($current);

        $adds = [];
        foreach (array_keys($target) as $id) {
            if (! isset($currentSet[$id])) {
                $adds[] = ['UrunKartiID' => $ppid, 'KategoriID' => $id, 'Sira' => 9999];
            }
        }

        $removes = [];
        foreach ($current as $id) {
            if (isset($target[$id])) {
                continue;
            }
            $cat = $cats[$id] ?? null;
            if (! $cat) {
                continue; // aynada olmayan kategori — dokunma
            }
            $isKategorisiz = mb_strtolower($cat->name) === 'kategorisiz';
            if ($cat->is_assignable || $isKategorisiz) {
                $removes[] = ['UrunKartiID' => $ppid, 'KategoriID' => $id];
            }
            // kampanya/vitrin kategorileri (is_assignable=false) korunur
        }

        $currentPrimary = (int) ($product->metadata['ana_kategori_id'] ?? 0);
        $primaryChange = null;
        if ($currentPrimary !== (int) $s->suggested_primary_id) {
            $primaryChange = ['from' => $currentPrimary, 'to' => (int) $s->suggested_primary_id];
        }

        return ['product' => $product, 'adds' => $adds, 'removes' => $removes, 'primary_change' => $primaryChange];
    }

    /**
     * Planı Ticimax'a uygular + yerel aynayı/products'ı günceller.
     * ⛔ CANLI YAZMA — çağıran katman dry-run kararını vermiş olmalı.
     */
    public function apply(CategorySuggestion $s): bool
    {
        $plan = $this->plan($s);
        if (! $plan) {
            $s->update(['status' => 'failed', 'error' => 'Plan üretilemedi (ürün/birincil kategori eksik)']);

            return false;
        }

        $svc = $this->serviceFor($s->tenant_id);
        $product = $plan['product'];
        $ppid = (int) $product->platform_product_id;

        try {
            if ($plan['adds']) {
                $res = $svc->saveProductCategories($plan['adds']);
                if (! ($res['success'] ?? false)) {
                    throw new \RuntimeException('SaveUrunKategori: ' . ($res['error'] ?? '?'));
                }
            }

            if ($plan['removes']) {
                $res = $svc->deleteProductCategories($plan['removes']);
                if (! ($res['success'] ?? false)) {
                    throw new \RuntimeException('DeleteUrunKategori: ' . ($res['error'] ?? '?'));
                }
            }

            if ($plan['primary_change']) {
                $res = $svc->updateProductCard(
                    ['ID' => $ppid, 'AnaKategoriID' => $plan['primary_change']['to']],
                    ['AnaKategoriGuncelle' => true]
                );
                if (! ($res['success'] ?? false)) {
                    throw new \RuntimeException('UrunKartiGuncelle(AnaKategori): ' . ($res['error'] ?? '?'));
                }
            }
        } catch (\Throwable $e) {
            Log::error('CategoryApplier: yazma hatası', ['suggestion' => $s->id, 'error' => $e->getMessage()]);
            $s->update(['status' => 'failed', 'error' => $e->getMessage()]);

            return false;
        }

        $this->syncLocal($s, $plan);

        $s->update([
            'status' => $s->tier === 'auto' ? 'auto_applied' : 'applied',
            'applied_at' => now(),
            'error' => null,
        ]);

        return true;
    }

    /** Yazım sonrası yerel ayna + products satırını güncelle (gecelik sync'i beklemeden tutarlılık). */
    protected function syncLocal(CategorySuggestion $s, array $plan): void
    {
        $product = $plan['product'];
        $ppid = (int) $product->platform_product_id;
        $now = now();

        foreach ($plan['adds'] as $a) {
            ProductPlatformCategory::updateOrCreate(
                ['tenant_id' => $s->tenant_id, 'platform_product_id' => $ppid, 'platform_category_id' => $a['KategoriID']],
                ['product_id' => $product->id, 'sira' => $a['Sira'], 'synced_at' => $now]
            );
        }
        if ($plan['removes']) {
            ProductPlatformCategory::forTenant($s->tenant_id)
                ->where('platform_product_id', $ppid)
                ->whereIn('platform_category_id', array_column($plan['removes'], 'KategoriID'))
                ->delete();
        }

        $primary = (int) $s->suggested_primary_id;
        $cat = PlatformCategory::forTenant($s->tenant_id)
            ->where('platform_category_id', $primary)->first();

        ProductPlatformCategory::forTenant($s->tenant_id)
            ->where('platform_product_id', $ppid)
            ->update(['is_primary' => false]);
        ProductPlatformCategory::forTenant($s->tenant_id)
            ->where('platform_product_id', $ppid)
            ->where('platform_category_id', $primary)
            ->update(['is_primary' => true]);

        if ($cat) {
            $meta = $product->metadata ?? [];
            $meta['ana_kategori_id'] = $primary;
            $product->update([
                'category' => $cat->name,
                'category_path' => $cat->path,
                'metadata' => $meta,
            ]);
        }
    }

    /** Yaprak + tüm ataları (kök hariç 0'a kadar). */
    protected function withAncestors(int $id, $cats): array
    {
        $out = [];
        $cursor = $id;
        $guard = 0;
        while ($cursor > 0 && isset($cats[$cursor]) && $guard++ < 10) {
            $out[] = $cursor;
            $cursor = (int) $cats[$cursor]->parent_platform_id;
        }

        return $out;
    }
}
