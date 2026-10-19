<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Catalog\CategoryTreeSync;
use Illuminate\Console\Command;

/**
 * Kategori Denetçisi — Ticimax kategori ağacı + ürün↔kategori atamalarını
 * yerel aynaya çeker ve ağaç sağlık raporu basar. SALT-OKUMA (Ticimax'a yazmaz).
 */
class CatalogSyncCategories extends Command
{
    protected $signature = 'catalog:sync-categories
        {--tenant= : Tenant id}
        {--tree-only : Sadece ağacı çek, atamaları atlama}
        {--audit : Senkron sonrası sağlık raporu bas}';

    protected $description = 'Ticimax kategori ağacını ve ürün-kategori atamalarını yerel aynaya senkronlar (salt-okuma).';

    public function handle(CategoryTreeSync $sync): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::where('id', (int) $this->option('tenant'))->get()
            : Tenant::where('is_active', true)->get();

        foreach ($tenants as $tenant) {
            $this->info("── {$tenant->slug} ──");

            try {
                $tree = $sync->syncTree($tenant);
            } catch (\Throwable $e) {
                $this->error("Ağaç senkronu başarısız: {$e->getMessage()}");

                continue;
            }
            $this->line("Ağaç: {$tree['total']} kategori ({$tree['active']} aktif, {$tree['assignable']} atanabilir)");

            if (! $this->option('tree-only')) {
                $res = $sync->syncAssignments($tenant, function ($name, $count) {
                    $this->line(sprintf('  %-40s %d ürün', mb_substr($name, 0, 40), $count));
                });
                $this->line("Atamalar: {$res['assignments']} kayıt / {$res['categories']} kategori"
                    . ($res['unmatched_products'] ? " (⚠ {$res['unmatched_products']} platform ürünü yerelde yok)" : ''));
            }

            if ($this->option('audit')) {
                $audit = $sync->audit($tenant);
                $this->newLine();
                $this->info('AĞAÇ SAĞLIK RAPORU');

                $this->line('Dublike kategori adları (paralel dallar): ' . $audit['duplicate_names']->count());
                foreach ($audit['duplicate_names'] as $d) {
                    $this->line("  \"{$d->lname}\" ×{$d->c}: {$d->paths}");
                }

                $this->line('Boş yaprak kategoriler (0 ürün): ' . $audit['empty_categories']->count());
                foreach ($audit['empty_categories'] as $ec) {
                    $this->line("  [{$ec->platform_category_id}] {$ec->path}");
                }

                $this->line("Sahipsiz ürünler (hiçbir gerçek kategoride değil): {$audit['orphan_products']}");
                foreach ($audit['orphan_sample'] as $o) {
                    $this->line("  {$o}");
                }
            }
        }

        return self::SUCCESS;
    }
}
