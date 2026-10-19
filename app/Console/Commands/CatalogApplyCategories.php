<?php

namespace App\Console\Commands;

use App\Models\CategorySuggestion;
use App\Models\Tenant;
use App\Services\Catalog\CategoryApplier;
use Illuminate\Console\Command;

/**
 * Kategori Denetçisi — bekleyen önerileri Ticimax'a uygular.
 * Varsayılan: yalnız status=approved (kullanıcı onaylı). --auto ile status=suggested
 * + tier=auto olanlar da uygulanır (catalog:categorize --live ile aynı etki).
 * --dry: yazmadan planı göster.
 */
class CatalogApplyCategories extends Command
{
    protected $signature = 'catalog:apply-categories
        {--tenant= : Tenant id (zorunlu)}
        {--auto : Onaylıların yanında tier=auto suggested\'ları da uygula}
        {--id= : Tek öneri id}
        {--limit=200}
        {--dry : Yazma, sadece planı göster}';

    protected $description = 'Onaylı (ve --auto ile otomatik-katmanlı) kategori önerilerini Ticimax\'a yazar.';

    public function handle(CategoryApplier $applier): int
    {
        $tenant = Tenant::find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('--tenant zorunlu.');

            return self::FAILURE;
        }

        $query = CategorySuggestion::forTenant($tenant->id)
            ->where('action', 'recategorize')
            ->orderBy('id');

        if ($this->option('id')) {
            $query->where('id', (int) $this->option('id'));
        } elseif ($this->option('auto')) {
            $query->where(function ($q) {
                $q->where('status', 'approved')
                    ->orWhere(fn ($qq) => $qq->where('status', 'suggested')->where('tier', 'auto'));
            });
        } else {
            $query->where('status', 'approved');
        }

        $suggestions = $query->limit((int) $this->option('limit'))->get();
        if ($suggestions->isEmpty()) {
            $this->info('Uygulanacak öneri yok.');

            return self::SUCCESS;
        }

        $dry = (bool) $this->option('dry');
        $ok = $fail = 0;

        foreach ($suggestions as $s) {
            $plan = $applier->plan($s);
            if (! $plan) {
                $this->warn("  #{$s->id} ürün {$s->product_id}: plan üretilemedi");
                $fail++;

                continue;
            }

            $this->line(sprintf(
                '  #%d ürün %d (%s): +%d kategori, -%d kategori%s',
                $s->id, $s->product_id, mb_substr($plan['product']->name, 0, 40),
                count($plan['adds']), count($plan['removes']),
                $plan['primary_change'] ? ", ana {$plan['primary_change']['from']}→{$plan['primary_change']['to']}" : ''
            ));

            if ($dry) {
                continue;
            }

            if ($applier->apply($s)) {
                $ok++;
            } else {
                $fail++;
                $this->warn("    ⚠ hata: {$s->fresh()->error}");
            }
        }

        if (! $dry) {
            $this->info("Bitti: {$ok} uygulandı, {$fail} hata.");
        }

        return self::SUCCESS;
    }
}
