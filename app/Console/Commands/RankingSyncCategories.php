<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\PlatformCategory;
use App\Models\Tenant;
use App\Services\Ranking\CategoryRanker;
use App\Services\TicimaxService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Kategori Sıralaması — kategori havuzlarını skorlar, Sira=1..N hesaplar,
 * histerezis geçen kategorileri Ticimax'a yazar (SaveUrunKategori batch).
 * VARSAYILAN DRY-RUN. --live için tenant settings['category_ranking_enabled']=true şart.
 * ⚠ Yazılan Sira'nın vitrine yansıması için kategorinin Ticimax panel
 * "Sıralama Tipi" = Manuel/Vitrin olmalı — pilotta önce bu doğrulanır.
 */
class RankingSyncCategories extends Command
{
    protected $signature = 'ranking:sync-categories
        {--tenant= : Tenant id (boşsa tüm aktif tenant\'lar)}
        {--category= : Virgüllü platform kategori id listesi (pilot)}
        {--live : Ticimax\'a yaz (yoksa dry-run rapor)}
        {--top=10 : Dry-run\'da kategori başına gösterilecek satır}
        {--force : Histerezisi atla, tüm kategorileri yaz}';

    protected $description = 'Kategori-içi akıllı ürün sıralamasını hesaplar ve Ticimax Sira alanına yazar (varsayılan dry-run).';

    public function handle(CategoryRanker $ranker): int
    {
        // --tenant verilmezse tüm aktif tenant'lar için kendini çağırır
        // (opsiyonlar önce yakalanır; iç çağrı $input'u değiştirir).
        if (! $this->option('tenant')) {
            $opts = array_filter([
                '--category' => $this->option('category'),
                '--live' => $this->option('live'),
                '--top' => $this->option('top'),
                '--force' => $this->option('force'),
            ]);

            // --live'da kill-switch'i kapalı tenant'lar baştan elenir ki gecelik
            // cron her gece FAILURE ile bitmesin (tek-tenant çağrı semantiği aynı).
            $tenants = Tenant::where('is_active', true)->orderBy('id')->get();
            if ($this->option('live')) {
                $tenants = $tenants->filter(
                    fn ($t) => (bool) (($t->settings ?? [])['category_ranking_enabled'] ?? false)
                );
            }

            $exit = self::SUCCESS;
            foreach ($tenants->pluck('id') as $tid) {
                $this->line("— tenant {$tid} —");
                $exit = max($exit, $this->call('ranking:sync-categories', $opts + ['--tenant' => $tid]));
            }

            return $exit;
        }

        $tenant = Tenant::find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('--tenant geçersiz.');

            return self::FAILURE;
        }

        $cfg = config('category_ranking');
        $live = (bool) $this->option('live');

        if (! $cfg['enabled']) {
            $this->error('category_ranking.enabled=false (env CATEGORY_RANKING_ENABLED).');

            return self::FAILURE;
        }
        if ($live && ! (bool) (($tenant->settings ?? [])['category_ranking_enabled'] ?? false)) {
            $this->error("Kill-switch kapalı: tenant settings['category_ranking_enabled'] true değil — --live reddedildi.");

            return self::FAILURE;
        }

        // Kampanya/vitrin kategorileri (is_assignable=false) varsayılan olarak sıralanmaz; tenant settings
        // ['category_ranking_include'] (id listesi) veya --category ile açıkça istenirse havuza girer.
        $include = ($tenant->settings ?? [])['category_ranking_include'] ?? [];
        if (is_string($include)) {
            $include = array_filter(array_map('intval', explode(',', $include)));
        }
        $include = array_values(array_filter(array_map('intval', (array) $include)));
        if ($this->option('category')) {
            $include = array_merge($include, array_map('intval', explode(',', (string) $this->option('category'))));
        }
        $catQuery = PlatformCategory::forTenant($tenant->id)
            ->where('is_active', true)
            ->where(function ($q) use ($include) {
                $q->where('is_assignable', true);
                if ($include) {
                    $q->orWhereIn('platform_category_id', $include);
                }
            })
            ->where('product_count', '>=', (int) $cfg['min_pool_size']);

        if ($this->option('category')) {
            $ids = array_map('intval', explode(',', (string) $this->option('category')));
            $catQuery->whereIn('platform_category_id', $ids);
        } else {
            // Pilot kapsamı: tenant settings'te liste varsa gecelik cron YALNIZ o
            // kategorilere yazar (tam yayılım = ayarı boşalt).
            $pilot = ($tenant->settings ?? [])['category_ranking_categories'] ?? null;
            if (is_string($pilot) && trim($pilot) !== '') {
                $pilot = array_map('intval', explode(',', $pilot));
            }
            if (is_array($pilot) && count($pilot) > 0) {
                $catQuery->whereIn('platform_category_id', array_map('intval', $pilot));
                $this->line('Pilot kapsamı aktif: ' . implode(',', array_map('intval', $pilot)));
            }
        }

        $categories = $catQuery->orderBy('path')->get();
        if ($categories->isEmpty()) {
            $this->warn('Uygun kategori yok.');

            return self::SUCCESS;
        }

        $this->info(($live ? '🔴 LIVE' : '🟢 DRY-RUN') . " — {$categories->count()} kategori, sinyaller hazırlanıyor...");
        $ranker->buildSignals($tenant);

        $svc = null;
        if ($live) {
            $channel = Channel::where('tenant_id', $tenant->id)
                ->where('type', 'ticimax-ecommerce')->where('is_active', true)->firstOrFail();
            $svc = TicimaxService::fromChannel($channel);
        }

        $written = $skipped = 0;

        foreach ($categories as $cat) {
            // Havuz: bu kategorideki aktif ürünler + mevcut Sira (diff/histerezis için)
            $rows = DB::table('product_platform_categories as ppc')
                ->join('products as p', 'p.id', '=', 'ppc.product_id')
                ->where('ppc.tenant_id', $tenant->id)
                ->where('ppc.platform_category_id', $cat->platform_category_id)
                ->where('p.is_active', true)
                ->get(['ppc.product_id', 'ppc.sira']);

            if ($rows->count() < (int) $cfg['min_pool_size']) {
                continue;
            }

            $currentSira = $rows->pluck('sira', 'product_id');
            $pins = CategoryRanker::effectivePins($tenant, (int) $cat->platform_category_id);
            $ranked = $ranker->rank($rows->pluck('product_id')->map(fn ($v) => (int) $v)->all(), $cat->path ?? null, $pins, (int) $cat->platform_category_id);
            if (! $ranked) {
                continue;
            }
            $pinReport = $ranker->lastPins;

            // Histerezis: sırasız (9999) ürün yoksa ve kimse eşikten fazla oynamıyorsa yazma
            $maxMove = 0;
            $hasUnranked = false;
            $currentOrder = $rows->sortBy([['sira', 'asc'], ['product_id', 'asc']])->pluck('product_id')->values();
            $currentPos = array_flip($currentOrder->all());
            foreach ($ranked as $i => $r) {
                $cs = (int) ($currentSira[$r['product_id']] ?? 9999);
                if ($cs >= 9999) {
                    $hasUnranked = true;
                } else {
                    $maxMove = max($maxMove, abs(($currentPos[$r['product_id']] ?? $i) - $i));
                }
            }

            // Manuel sabitlenen ilk sıralar vitrinde birebir değilse histerezis beklenmez
            $pinMismatch = false;
            foreach ($ranked as $i => $r) {
                if (! $r['pinned']) {
                    break;
                }
                if (($currentOrder[$i] ?? null) != $r['product_id'] || (int) ($currentSira[$r['product_id']] ?? 9999) >= 9999) {
                    $pinMismatch = true;
                    break;
                }
            }

            $needsWrite = $this->option('force') || $hasUnranked || $pinMismatch || $maxMove >= (int) $cfg['hysteresis_min_move'];

            $this->newLine();
            $this->info(sprintf(
                '%s [%d] — %d ürün, maxMove=%d%s%s',
                $cat->path, $cat->platform_category_id, count($ranked), $maxMove,
                $hasUnranked ? ', sırasız var' : '',
                $needsWrite ? '' : ' → HİSTEREZİS: yazılmayacak'
            ));
            foreach ($pinReport as $pr) {
                if ($pr['status'] !== 'ok') {
                    $this->warn("  📌 {$pr['code']}: " . ($pr['status'] === 'out_of_stock' ? 'tüm renkleri stoksuz — sabitlenmedi' : 'bu kategoride bulunamadı — sabitlenmedi'));
                }
            }

            if (! $live) {
                foreach (array_slice($ranked, 0, (int) $this->option('top')) as $i => $r) {
                    $sig = $r['signals'];
                    $this->line(sprintf(
                        '  %2d. %s%-48s skor=%.3f satış90=%g stok=%g kapsama=%.2f%s',
                        $i + 1,
                        $r['pinned'] ? '📌' : ($r['discovery'] ? '🆕' : '  '),
                        mb_substr($r['name'], 0, 46),
                        $r['score'], $sig['q90'], $sig['stock_qty'], $sig['size_coverage'],
                        ((int) ($currentSira[$r['product_id']] ?? 9999)) < 9999 ? ' (eski sıra ' . $currentSira[$r['product_id']] . ')' : ''
                    ));
                }

                continue;
            }

            if (! $needsWrite) {
                $skipped++;

                continue;
            }

            // Yaz: Sira = 1..N (tam kategori, batch)
            $list = [];
            foreach ($ranked as $i => $r) {
                $list[] = [
                    'UrunKartiID' => $r['ppid'],
                    'KategoriID' => $cat->platform_category_id,
                    'Sira' => $i + 1,
                ];
            }

            $ok = true;
            foreach (array_chunk($list, (int) $cfg['write_chunk']) as $chunk) {
                $res = $svc->saveProductCategories($chunk);
                if (! ($res['success'] ?? false)) {
                    $this->error('  SaveUrunKategori hatası: ' . ($res['error'] ?? '?'));
                    $ok = false;
                    break;
                }
            }

            if ($ok) {
                // Yerel aynayı güncelle
                foreach ($ranked as $i => $r) {
                    DB::table('product_platform_categories')
                        ->where('tenant_id', $tenant->id)
                        ->where('platform_category_id', $cat->platform_category_id)
                        ->where('product_id', $r['product_id'])
                        ->update(['sira' => $i + 1, 'updated_at' => now()]);
                }
                $written++;
                $this->line('  ✓ yazıldı (' . count($list) . ' sıra)');
            }
        }

        $this->newLine();
        $this->info($live
            ? "Bitti: {$written} kategori yazıldı, {$skipped} histerezisle atlandı."
            : 'Dry-run bitti. Yazmak için: --live (tenant kill-switch açık olmalı).');

        return self::SUCCESS;
    }
}
