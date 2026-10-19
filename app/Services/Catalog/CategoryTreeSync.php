<?php

namespace App\Services\Catalog;

use App\Models\Channel;
use App\Models\PlatformCategory;
use App\Models\Product;
use App\Models\ProductPlatformCategory;
use App\Models\Tenant;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Kategori Denetçisi — Ticimax kategori ağacını ve ürün↔kategori atamalarını
 * yerel aynaya (platform_categories / product_platform_categories) çeker,
 * ağaç sağlık raporu üretir. Salt-okuma; Ticimax'a hiçbir şey yazmaz.
 */
class CategoryTreeSync
{
    /** Kampanya/vitrin kategorisi kalıpları — sınıflandırıcı hedefi DEĞİL (üründe varsa korunur). */
    protected const NON_ASSIGNABLE_PATTERNS = [
        'tek fiyat', 'fırsat', 'firsat', 'indirim', 'outlet', 'kampanya', 'yeni sezon',
        'çok satan', 'cok satan', 'vitrin', '1 alana', 'sepette', 'kategorisiz',
    ];

    public function __construct(protected ?TicimaxService $service = null)
    {
    }

    protected function serviceFor(Tenant $tenant): TicimaxService
    {
        if ($this->service) {
            return $this->service;
        }

        $channel = Channel::where('tenant_id', $tenant->id)
            ->where('type', 'ticimax-ecommerce')
            ->where('is_active', true)
            ->firstOrFail();

        return $this->service = TicimaxService::fromChannel($channel);
    }

    /**
     * SelectKategori → platform_categories. Path/depth burada hesaplanır.
     *
     * @return array{total:int, active:int, assignable:int}
     */
    public function syncTree(Tenant $tenant): array
    {
        $svc = $this->serviceFor($tenant);
        $res = $svc->getCategories();

        if (! ($res['success'] ?? false)) {
            throw new \RuntimeException('SelectKategori başarısız: ' . ($res['error'] ?? '?'));
        }

        $items = $res['data']['SelectKategoriResult']['Kategori'] ?? [];
        if (isset($items['ID'])) {
            $items = [$items];
        }

        $byId = [];
        foreach ($items as $c) {
            $byId[(int) $c['ID']] = $c;
        }

        $now = now();
        $seen = [];
        $stats = ['total' => 0, 'active' => 0, 'assignable' => 0];

        foreach ($items as $c) {
            $id = (int) $c['ID'];
            [$path, $depth] = $this->buildPath($id, $byId);
            $name = trim((string) ($c['Tanim'] ?? ''));
            $assignable = $this->isAssignable($name, $path);

            PlatformCategory::updateOrCreate(
                ['tenant_id' => $tenant->id, 'platform_category_id' => $id],
                [
                    'parent_platform_id' => (int) ($c['PID'] ?? 0),
                    'name' => $name,
                    'path' => $path,
                    'depth' => $depth,
                    'url' => $c['Url'] ?? null,
                    'is_active' => (bool) ($c['Aktif'] ?? true),
                    'children_count' => (int) ($c['AltKategoriSayisi'] ?? 0),
                    'is_assignable' => $assignable,
                    'synced_at' => $now,
                ]
            );

            $seen[] = $id;
            $stats['total']++;
            if ($c['Aktif'] ?? true) {
                $stats['active']++;
            }
            if ($assignable) {
                $stats['assignable']++;
            }
        }

        // Ticimax'tan silinmiş kategorileri pasifle (kaydı silme — atama geçmişi kalsın)
        if ($seen) {
            PlatformCategory::where('tenant_id', $tenant->id)
                ->whereNotIn('platform_category_id', $seen)
                ->update(['is_active' => false]);
        }

        return $stats;
    }

    /**
     * SelectUrunKategori (kategori kategori) → product_platform_categories.
     * is_primary, products.metadata.ana_kategori_id ile işaretlenir.
     *
     * @return array{assignments:int, categories:int, unmatched_products:int}
     */
    public function syncAssignments(Tenant $tenant, ?callable $progress = null): array
    {
        $svc = $this->serviceFor($tenant);
        $now = now();

        $categories = PlatformCategory::forTenant($tenant->id)->where('is_active', true)->get();

        // products.id ↔ platform_product_id eşlemesi + ana kategori
        $products = Product::forTenant($tenant->id)
            ->select('id', 'platform_product_id', 'metadata')
            ->get();
        $productMap = [];
        $primaryMap = [];
        foreach ($products as $p) {
            $pid = (int) $p->platform_product_id;
            $productMap[$pid] = $p->id;
            $primaryMap[$pid] = (int) ($p->metadata['ana_kategori_id'] ?? 0);
        }

        $total = 0;
        $unmatched = [];
        $seenIds = [];

        foreach ($categories as $cat) {
            $res = $svc->getProductCategoryAssignments($cat->platform_category_id, -1);
            if (! ($res['success'] ?? false)) {
                Log::warning('CategoryTreeSync: SelectUrunKategori başarısız', [
                    'tenant' => $tenant->id, 'category' => $cat->platform_category_id,
                    'error' => $res['error'] ?? null,
                ]);
                continue;
            }

            $rows = $res['data']['SelectUrunKategoriResult']['UrunKategori'] ?? [];
            if (isset($rows['UrunKartiID'])) {
                $rows = [$rows];
            }

            $batch = [];
            foreach ($rows as $r) {
                $ppid = (int) ($r['UrunKartiID'] ?? 0);
                $catId = (int) ($r['KategoriID'] ?? 0);
                if ($ppid <= 0 || $catId <= 0) {
                    continue;
                }
                if (! isset($productMap[$ppid])) {
                    $unmatched[$ppid] = true;
                }

                $batch[] = [
                    'tenant_id' => $tenant->id,
                    'product_id' => $productMap[$ppid] ?? null,
                    'platform_product_id' => $ppid,
                    'platform_category_id' => $catId,
                    'sira' => (int) ($r['Sira'] ?? 9999),
                    'is_primary' => ($primaryMap[$ppid] ?? 0) === $catId,
                    'synced_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            foreach (array_chunk($batch, 500) as $chunk) {
                ProductPlatformCategory::upsert(
                    $chunk,
                    ['tenant_id', 'platform_product_id', 'platform_category_id'],
                    ['product_id', 'sira', 'is_primary', 'synced_at', 'updated_at']
                );
            }

            $total += count($batch);
            $cat->update(['product_count' => count($batch)]);

            if ($progress) {
                $progress($cat->name, count($batch));
            }
        }

        // Bu senkronda görülmeyen eski atamaları temizle (Ticimax'ta kaldırılmış).
        // Bu run'ın tüm satırları synced_at = $now — daha eskiler stale demektir.
        ProductPlatformCategory::forTenant($tenant->id)
            ->where(function ($q) use ($now) {
                $q->whereNull('synced_at')->orWhere('synced_at', '<', $now);
            })
            ->delete();

        return [
            'assignments' => $total,
            'categories' => $categories->count(),
            'unmatched_products' => count($unmatched),
        ];
    }

    /**
     * Ağaç sağlık raporu: dublike yaprak adları (paralel dallar), boş kategoriler,
     * yalnız-Kategorisiz ürünler, path'siz ürünler.
     */
    public function audit(Tenant $tenant): array
    {
        $tid = $tenant->id;

        $dupes = DB::table('platform_categories')
            ->where('tenant_id', $tid)->where('is_active', true)
            ->selectRaw('lower(name) as lname, count(*) as c, string_agg(path, \' || \') as paths')
            ->groupBy('lname')->havingRaw('count(*) > 1')
            ->orderByRaw('c desc')->get();

        $empty = DB::table('platform_categories')
            ->where('tenant_id', $tid)->where('is_active', true)
            ->where('is_assignable', true)
            ->where('children_count', 0)->where('product_count', 0)
            ->orderBy('path')->get(['platform_category_id', 'name', 'path']);

        // Yalnız Kategorisiz/kampanya kategorisinde yaşayan ürünler
        $orphans = DB::select("
            select p.id, p.name
            from products p
            where p.tenant_id = ? and p.is_active = true
              and not exists (
                  select 1 from product_platform_categories ppc
                  join platform_categories pc
                    on pc.tenant_id = ppc.tenant_id
                   and pc.platform_category_id = ppc.platform_category_id
                  where ppc.tenant_id = p.tenant_id
                    and ppc.platform_product_id = cast(p.platform_product_id as integer)
                    and pc.is_assignable = true and pc.is_active = true
              )
        ", [$tid]);

        return [
            'duplicate_names' => $dupes,
            'empty_categories' => $empty,
            'orphan_products' => count($orphans),
            'orphan_sample' => array_slice(array_map(fn ($o) => "{$o->id}: {$o->name}", $orphans), 0, 20),
        ];
    }

    /** Path'i PID zinciriyle kurar: "Kadın > Kadın Ayakkabı > Babet". Döngü korumalı. */
    protected function buildPath(int $id, array $byId): array
    {
        $parts = [];
        $cursor = $id;
        $guard = 0;
        while ($cursor > 0 && isset($byId[$cursor]) && $guard++ < 10) {
            array_unshift($parts, trim((string) ($byId[$cursor]['Tanim'] ?? '')));
            $cursor = (int) ($byId[$cursor]['PID'] ?? 0);
        }

        return [implode(' > ', $parts), max(0, count($parts) - 1)];
    }

    protected function isAssignable(string $name, string $path): bool
    {
        $hay = mb_strtolower($name . ' ' . $path);
        foreach (self::NON_ASSIGNABLE_PATTERNS as $p) {
            if (str_contains($hay, $p)) {
                return false;
            }
        }

        return true;
    }
}
