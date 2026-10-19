<?php

namespace App\Services\Filter;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Tenant kataloğundan çıkarılabilecek filtre başlıkları + CRO'ya göre varsayılan sıra.
 *
 * Baymard (2025): 5 temel filtre — Fiyat, Puan, Renk, Beden, Marka; kategoriye özel
 * özellik filtreleri (topuk boyu, taban tipi...) ve tematik filtreler (indirimli, yeni)
 * ayrıca dönüşümü artırır. Bu katalog hepsini tek listede toplar; panelde sıra/etiket
 * düzenlenir, kapsama oranı (kaç üründe dolu) gösterilir.
 *
 * Facet türleri: price | rating | color | size | brand | flag | spec | category
 */
class FacetCatalog
{
    /** Sabit (veri modelinden gelen) facet'ler — her tenant'ta vardır. */
    public const CORE = [
        ['key' => 'category', 'label' => 'Alt Kategori', 'type' => 'category'],
        ['key' => 'price', 'label' => 'Fiyat', 'type' => 'price'],
        ['key' => 'color', 'label' => 'Renk', 'type' => 'color'],
        ['key' => 'size', 'label' => 'Beden', 'type' => 'size'],
        ['key' => 'discount', 'label' => 'İndirimli Ürünler', 'type' => 'flag'],
        ['key' => 'new', 'label' => 'Yeni Gelenler', 'type' => 'flag'],
        ['key' => 'rating', 'label' => 'Müşteri Puanı', 'type' => 'rating'],
        ['key' => 'brand', 'label' => 'Marka', 'type' => 'brand'],
    ];

    /** Özellik (specifications) anahtarlarından facet olmaya değmeyenler. */
    public const SPEC_BLACKLIST = ['Trendyol', 'Menşei', 'Ürün Detayı', 'Ek Özellik', 'Materyal Bileşeni'];

    /** Katalog: çekirdek + tenant'ın spec anahtarları, kapsama istatistiğiyle. */
    public static function forTenant(int $tenantId): array
    {
        return Cache::remember("filter:catalog:{$tenantId}", 3600, function () use ($tenantId) {
            $active = (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)->count();
            $out = [];

            $variantCov = fn (string $attr) => (int) DB::table('product_variants as v')
                ->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('p.tenant_id', $tenantId)->where('p.is_active', true)->where('p.stock_quantity', '>', 0)
                ->whereRaw("jsonb_typeof(v.attributes) = 'object' and coalesce(v.attributes->>?, '') <> ''", [$attr])
                ->distinct()->count('p.id');

            foreach (self::CORE as $f) {
                $cov = match ($f['key']) {
                    'color' => $variantCov('Renk'),
                    'size' => $variantCov('Beden'),
                    'brand' => (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)->whereNotNull('brand')->count(),
                    'rating' => (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)->whereNotNull('trendyol_rating')->count(),
                    'discount' => (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)->whereColumn('discounted_price', '<', 'price')->where('discounted_price', '>', 0)->count(),
                    default => $active,
                };
                $distinct = match ($f['key']) {
                    'brand' => (int) DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->distinct()->count('brand'),
                    default => null,
                };
                $out[] = $f + ['coverage' => $cov, 'coverage_pct' => $active ? round($cov / $active * 100) : 0, 'distinct' => $distinct, 'source' => 'core'];
            }

            $specs = DB::select(
                "select k, count(*) c, count(distinct v) dv from products, jsonb_each_text(specifications) as e(k,v)
                 where tenant_id = ? and is_active and stock_quantity > 0 and jsonb_typeof(specifications) = 'object'
                 group by k having count(distinct v) between 2 and 40 order by c desc limit 30",
                [$tenantId]
            );
            foreach ($specs as $r) {
                if (in_array($r->k, self::SPEC_BLACKLIST, true)) {
                    continue;
                }
                $out[] = [
                    'key' => 'spec:'.$r->k, 'label' => $r->k, 'type' => 'spec',
                    'coverage' => (int) $r->c, 'coverage_pct' => $active ? round($r->c / $active * 100) : 0,
                    'distinct' => (int) $r->dv, 'source' => 'spec',
                ];
            }

            return ['active_products' => $active, 'facets' => $out];
        });
    }

    /**
     * Tenant'ın etkin facet listesi: panel ayarı varsa o; yoksa CRO varsayılanı
     * (çekirdek 8 + kapsaması ≥%40 olan ilk 6 özellik).
     */
    public static function effective(int $tenantId, ?array $configured): array
    {
        $catalog = self::forTenant($tenantId)['facets'];
        $byKey = [];
        foreach ($catalog as $f) {
            $byKey[$f['key']] = $f;
        }

        if ($configured) {
            $list = [];
            foreach ($configured as $c) {
                $key = (string) ($c['key'] ?? '');
                if ($key === '' || ! isset($byKey[$key])) {
                    continue;
                }
                $list[] = [
                    'key' => $key,
                    'label' => trim((string) ($c['label'] ?? '')) ?: $byKey[$key]['label'],
                    'type' => $byKey[$key]['type'],
                    'enabled' => filter_var($c['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
                    'collapsed' => filter_var($c['collapsed'] ?? false, FILTER_VALIDATE_BOOLEAN),
                ];
            }

            return $list;
        }

        $list = [];
        foreach (self::CORE as $f) {
            $c = $byKey[$f['key']] ?? null;
            $list[] = ['key' => $f['key'], 'label' => $f['label'], 'type' => $f['type'], 'enabled' => $c ? $c['coverage'] > 0 : false, 'collapsed' => in_array($f['key'], ['brand', 'rating'], true)];
        }
        $specs = array_values(array_filter($catalog, fn ($f) => $f['source'] === 'spec' && $f['coverage_pct'] >= 40));
        foreach (array_slice($specs, 0, 6) as $f) {
            $list[] = ['key' => $f['key'], 'label' => $f['label'], 'type' => 'spec', 'enabled' => true, 'collapsed' => true];
        }

        return $list;
    }

    public static function forget(int $tenantId): void
    {
        Cache::forget("filter:catalog:{$tenantId}");
    }
}
