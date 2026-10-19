<?php

namespace App\Console\Commands;

use App\Models\CategorySuggestion;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\CategoryApplier;
use App\Services\Catalog\ProductCategorizer;
use Illuminate\Console\Command;

/**
 * Kategori Denetçisi — sorunlu (Kategorisiz / path'siz) ürünleri sınıflandırır,
 * category_suggestions'a yazar. VARSAYILAN GÜVENLİ: Ticimax'a YAZMAZ.
 * --live: yalnız tier=auto (katmanlar hemfikir, güven ≥0.85) önerileri uygular;
 * tier=review olanlar her durumda onay kuyruğunda bekler.
 */
class CatalogCategorize extends Command
{
    protected $signature = 'catalog:categorize
        {--tenant= : Tenant id (boşsa tüm aktif tenant\'lar)}
        {--limit=50 : Bu çalıştırmada işlenecek maks ürün}
        {--product= : Tek ürün id (test)}
        {--ids-file= : products.id listesi içeren JSON dosyası (şüpheli denetimi)}
        {--all : Sorunlu filtre yerine tüm aktif ürünleri denetle}
        {--live : tier=auto önerileri Ticimax\'a uygula (yoksa sadece öneri yazılır)}';

    protected $description = 'Sorunlu ürünleri sınıflandırıp kategori önerileri üretir (varsayılan dry-run, --live: auto-tier yazılır).';

    public function handle(ProductCategorizer $categorizer, CategoryApplier $applier): int
    {
        // --tenant verilmezse tüm aktif tenant'lar için kendini çağırır
        // (opsiyonlar önce yakalanır; iç çağrı $input'u değiştirir).
        if (! $this->option('tenant')) {
            $opts = array_filter([
                '--limit' => $this->option('limit'),
                '--product' => $this->option('product'),
                '--ids-file' => $this->option('ids-file'),
                '--all' => $this->option('all'),
                '--live' => $this->option('live'),
            ]);

            $exit = self::SUCCESS;
            foreach (Tenant::where('is_active', true)->orderBy('id')->pluck('id') as $tid) {
                $this->line("— tenant {$tid} —");
                $exit = max($exit, $this->call('catalog:categorize', $opts + ['--tenant' => $tid]));
            }

            return $exit;
        }

        $tenant = Tenant::find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('--tenant geçersiz.');

            return self::FAILURE;
        }

        $live = (bool) $this->option('live');
        $limit = max(1, (int) $this->option('limit'));

        $query = Product::forTenant($tenant->id)->where('is_active', true);

        if ($this->option('product')) {
            $query->where('id', (int) $this->option('product'));
        } elseif ($this->option('ids-file')) {
            $raw = json_decode((string) file_get_contents((string) $this->option('ids-file')), true) ?: [];
            $ids = array_values(array_filter(array_map(
                fn ($r) => is_array($r) ? (int) ($r['product_id'] ?? 0) : (int) $r,
                $raw
            )));
            if (! $ids) {
                $this->error('ids-file boş/okunamadı.');

                return self::FAILURE;
            }
            $query->whereIn('id', $ids);
        } elseif (! $this->option('all')) {
            // Sorunlu küme: Kategorisiz ana kategori VEYA boş path
            $query->where(function ($q) {
                $q->where('category', 'Kategorisiz')
                    ->orWhereNull('category_path')
                    ->orWhere('category_path', '');
            });
        }

        // Bekleyen/uygulanmış önerisi olan ürünleri atla (aynı ürüne mükerrer öneri yok)
        $query->whereNotExists(function ($q) use ($tenant) {
            $q->selectRaw('1')
                ->from('category_suggestions')
                ->whereColumn('category_suggestions.product_id', 'products.id')
                ->where('category_suggestions.tenant_id', $tenant->id)
                ->whereIn('category_suggestions.status', ['suggested', 'approved', 'auto_applied', 'applied']);
        });

        $products = $query->orderBy('id')->limit($limit)->get();
        if ($products->isEmpty()) {
            $this->info('İşlenecek ürün yok (hepsi işlendi ya da bekleyen önerisi var).');

            return self::SUCCESS;
        }

        $this->info("{$products->count()} ürün sınıflandırılacak" . ($live ? ' (LIVE: auto-tier uygulanır)' : ' (dry-run: sadece öneri yazılır)'));
        $categorizer->buildContext($tenant);

        $stats = ['auto' => 0, 'review' => 0, 'new_cat' => 0, 'none' => 0, 'applied' => 0, 'failed' => 0];

        foreach ($products as $product) {
            $data = $categorizer->classify($product);
            if (! $data) {
                $stats['none']++;
                $this->line("  ∅ {$product->id} {$product->name} — öneri üretilemedi");

                continue;
            }

            $suggestion = CategorySuggestion::create($data);

            if ($data['action'] === 'create_category') {
                $stats['new_cat']++;
                $this->line("  🆕 {$product->id} {$product->name} → YENİ KATEGORİ önerisi: "
                    . ($data['new_category']['name'] ?? '?') . " (onay bekliyor)");

                continue;
            }

            $catPath = \App\Models\PlatformCategory::forTenant($tenant->id)
                ->where('platform_category_id', $data['suggested_primary_id'])->value('path');
            $tierIcon = $data['tier'] === 'auto' ? '✓' : '?';
            $this->line(sprintf(
                '  %s %d %s → %s  (güven %.2f, %s, +%d ikincil)',
                $tierIcon, $product->id, mb_substr($product->name, 0, 45), $catPath,
                $data['confidence'], $data['tier'], count($data['suggested_category_ids'] ?? [])
            ));

            if ($data['tier'] === 'auto') {
                $stats['auto']++;
                if ($live) {
                    if ($applier->apply($suggestion)) {
                        $stats['applied']++;
                    } else {
                        $stats['failed']++;
                        $this->warn("    ⚠ uygulama hatası: {$suggestion->fresh()->error}");
                    }
                }
            } else {
                $stats['review']++;
            }
        }

        $this->newLine();
        $this->info(sprintf(
            'Bitti: %d auto, %d review, %d yeni-kategori, %d önerisiz%s',
            $stats['auto'], $stats['review'], $stats['new_cat'], $stats['none'],
            $live ? sprintf(' | %d uygulandı, %d hata', $stats['applied'], $stats['failed']) : ''
        ));
        if (! $live && $stats['auto'] > 0) {
            $this->line('auto-tier önerileri uygulamak için: --live (veya catalog:apply-categories)');
        }

        return self::SUCCESS;
    }
}
