<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\PlatformCategory;
use App\Models\Tenant;
use App\Services\Ranking\CategoryRanker;
use App\Services\TicimaxService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * "Fırsat Ürünleri" seçici — her yaprak kategoriden UYGUN FİYATLI + YENİ + ÖN PLANDA OLMAYAN
 * (kategori sırasında geride, az satan) ama satılabilir (stok + beden kapsaması) ürünleri seçer ve
 * hedef kampanya kategorisine (vars. Fırsat Ürünleri) Sira=1..N ile atar (Ticimax SaveUrunKategori).
 *
 * VARSAYILAN DRY-RUN. --live yazar; --clear hedefteki mevcut atamaları önce siler (DeleteUrunKategori).
 * Skor (kategori içi): 0.35 ucuzluk (fiyat yüzdeliği) + 0.25 tazelik + 0.25 gölgede kalma
 * (0.5 sıra yüzdeliği + 0.5 düşük satış) + 0.15 beden kapsaması. Fiyatı kategori medyanının üstündekiler elenir.
 */
class CatalogPickOpportunity extends Command
{
    protected $signature = 'catalog:pick-opportunity
        {--tenant= : Tenant id}
        {--category=2196 : Hedef kampanya kategorisi (platform id)}
        {--per=5 : Yaprak kategori başına en fazla ürün}
        {--min-pool=15 : Bundan az stoklu ürünü olan yaprak kategoriler atlanır}
        {--max-price-pct=0.5 : Kategori içi fiyat yüzdeliği tavanı (0.5 = medyanın altı)}
        {--min-coverage=0.34 : En düşük beden kapsaması}
        {--live : Ticimax\'a yaz}
        {--clear : Hedef kategorideki mevcut atamaları önce sil (yalnız --live)}';

    protected $description = 'Her kategoriden uygun fiyatlı, yeni ve ön planda olmayan ürünleri seçip kampanya kategorisine atar (vars. dry-run).';

    public function handle(CategoryRanker $ranker): int
    {
        $tenant = Tenant::findOrFail((int) $this->option('tenant'));
        $target = (int) $this->option('category');
        $per = max(1, (int) $this->option('per'));
        $minPool = max(2, (int) $this->option('min-pool'));
        $maxPct = (float) $this->option('max-price-pct');
        $minCov = (float) $this->option('min-coverage');
        $live = (bool) $this->option('live');

        $targetCat = PlatformCategory::forTenant($tenant->id)->where('platform_category_id', $target)->first();
        if (! $targetCat) {
            $this->error("Hedef kategori {$target} Yunbi'de yok (catalog:sync-categories çalıştır).");

            return self::FAILURE;
        }

        $leaves = PlatformCategory::forTenant($tenant->id)->where('is_active', true)->where('is_assignable', true)
            ->where('children_count', 0)->orderBy('path')->get();

        $this->info(($live ? '🔴 LIVE' : '🟢 DRY-RUN')." — hedef: {$targetCat->path} [{$target}], {$leaves->count()} yaprak kategori, sinyaller hazırlanıyor...");
        $ranker->buildSignals($tenant);

        $picked = [];
        $seen = [];
        foreach ($leaves as $leaf) {
            $rows = DB::table('product_platform_categories as ppc')
                ->join('products as p', 'p.id', '=', 'ppc.product_id')
                ->where('ppc.tenant_id', $tenant->id)->where('ppc.platform_category_id', $leaf->platform_category_id)
                ->where('p.is_active', true)->where('p.stock_quantity', '>', 0)
                ->whereNotNull('p.images')->whereRaw("jsonb_typeof(p.images::jsonb) = 'array' and jsonb_array_length(p.images::jsonb) > 0")
                ->get(['ppc.product_id', 'ppc.sira', 'p.name', 'p.price', 'p.discounted_price', 'p.platform_product_id']);
            if ($rows->count() < $minPool) {
                continue;
            }
            $ranked = $ranker->rank($rows->pluck('product_id')->map(fn ($v) => (int) $v)->all(), $leaf->path ?? null);
            if (! $ranked) {
                continue;
            }
            $sig = [];
            foreach ($ranked as $r) {
                $sig[$r['product_id']] = $r;
            }
            $n = $rows->count();
            $eff = fn ($r) => ((float) $r->discounted_price > 0 && (float) $r->discounted_price < (float) $r->price) ? (float) $r->discounted_price : (float) $r->price;
            $byPrice = $rows->sortBy(fn ($r) => $eff($r))->values();
            $pricePct = [];
            foreach ($byPrice as $i => $r) {
                $pricePct[$r->product_id] = $n > 1 ? $i / ($n - 1) : 0;
            }
            $cands = [];
            foreach ($rows as $r) {
                $pid = (int) $r->product_id;
                if (isset($seen[$pid]) || ! isset($sig[$pid])) {
                    continue;
                }
                $s = $sig[$pid]['signals'];
                if ($pricePct[$pid] > $maxPct || $s['size_coverage'] < $minCov || $s['stock_qty'] < 3) {
                    continue;
                }
                $sira = (int) $r->sira;
                $siraPct = $sira >= 9999 ? 1.0 : ($n > 1 ? min(1.0, ($sira - 1) / ($n - 1)) : 0);
                $cheap = 1 - $pricePct[$pid];
                $hidden = 0.5 * (1 - $s['sales']) + 0.5 * $siraPct;
                $score = 0.35 * $cheap + 0.25 * $s['freshness'] + 0.25 * $hidden + 0.15 * $s['size_coverage'];
                $cands[] = [
                    'product_id' => $pid, 'ppid' => (int) $r->platform_product_id, 'name' => $r->name, 'leaf' => $leaf->path,
                    'price' => $eff($r), 'sira' => $sira, 'q90' => $s['q90'], 'fresh' => $s['freshness'], 'cov' => $s['size_coverage'], 'score' => round($score, 4),
                ];
            }
            usort($cands, fn ($a, $b) => $b['score'] <=> $a['score']);
            // Aynı modelin renk varyantları (ad ilk 4 kelime) kategori başına en fazla 1 kez: çeşitlilik
            $fam = [];
            $take = 0;
            foreach ($cands as $c) {
                $key = implode(' ', array_slice(preg_split('/\s+/', mb_strtolower($c['name'])), 0, 4));
                if (isset($fam[$key])) {
                    continue;
                }
                $fam[$key] = true;
                $picked[] = $c;
                $seen[$c['product_id']] = true;
                if (++$take >= $per) {
                    break;
                }
            }
        }

        usort($picked, fn ($a, $b) => $b['score'] <=> $a['score']);
        $this->newLine();
        $this->info(count($picked).' ürün seçildi');
        $rowsOut = [];
        foreach ($picked as $i => $c) {
            $rowsOut[] = [$i + 1, mb_substr(str_replace(['Kadın > ', 'Erkek > ', 'Çocuk > '], ['K> ', 'E> ', 'Ç> '], $c['leaf']), 0, 34), mb_substr($c['name'], 0, 42), number_format($c['price'], 0, ',', '.'), $c['sira'] >= 9999 ? '-' : $c['sira'], $c['q90'], $c['fresh'], $c['cov'], $c['score']];
        }
        $this->table(['#', 'Kategori', 'Ürün', 'Fiyat', 'Sıra', 'Satış90', 'Taze', 'Beden', 'Skor'], $rowsOut);
        $bySeg = [];
        foreach ($picked as $c) {
            $seg = explode(' > ', $c['leaf'])[0];
            $bySeg[$seg] = ($bySeg[$seg] ?? 0) + 1;
        }
        $this->line('Segment dağılımı: '.json_encode($bySeg, JSON_UNESCAPED_UNICODE));

        if (! $live) {
            $this->line('Yazmak için: --live (isteğe bağlı --clear: hedefteki mevcut atamaları önce siler).');

            return self::SUCCESS;
        }
        if (! $picked) {
            return self::SUCCESS;
        }

        $channel = Channel::where('tenant_id', $tenant->id)->where('type', 'ticimax-ecommerce')->where('is_active', true)->firstOrFail();
        $svc = TicimaxService::fromChannel($channel);

        if ($this->option('clear')) {
            $existing = DB::table('product_platform_categories')->where('tenant_id', $tenant->id)->where('platform_category_id', $target)->pluck('platform_product_id')->all();
            if ($existing) {
                $del = array_map(fn ($ppid) => ['UrunKartiID' => (int) $ppid, 'KategoriID' => $target], $existing);
                foreach (array_chunk($del, 200) as $chunk) {
                    $res = $svc->deleteProductCategories($chunk);
                    if (! ($res['success'] ?? false)) {
                        $this->error('DeleteUrunKategori hatası: '.($res['error'] ?? '?'));

                        return self::FAILURE;
                    }
                }
                DB::table('product_platform_categories')->where('tenant_id', $tenant->id)->where('platform_category_id', $target)->delete();
                $this->info('Hedefteki '.count($existing).' mevcut atama silindi.');
            }
        }

        $list = [];
        foreach ($picked as $i => $c) {
            $list[] = ['UrunKartiID' => $c['ppid'], 'KategoriID' => $target, 'Sira' => $i + 1];
        }
        foreach (array_chunk($list, 200) as $chunk) {
            $res = $svc->saveProductCategories($chunk);
            if (! ($res['success'] ?? false)) {
                $this->error('SaveUrunKategori hatası: '.($res['error'] ?? '?'));

                return self::FAILURE;
            }
        }
        $now = now();
        foreach ($picked as $i => $c) {
            DB::table('product_platform_categories')->updateOrInsert(
                ['tenant_id' => $tenant->id, 'product_id' => $c['product_id'], 'platform_category_id' => $target],
                ['platform_product_id' => $c['ppid'], 'sira' => $i + 1, 'is_primary' => false, 'synced_at' => $now, 'created_at' => $now, 'updated_at' => $now]
            );
        }
        $cnt = DB::table('product_platform_categories')->where('tenant_id', $tenant->id)->where('platform_category_id', $target)->count();
        PlatformCategory::forTenant($tenant->id)->where('platform_category_id', $target)->update(['product_count' => $cnt]);
        foreach (["menu:data:{$tenant->id}", "menu:tsettings:{$tenant->id}", "filter:catids:{$tenant->id}:{$target}", "filter:paths:{$tenant->id}"] as $k) {
            Cache::forget($k);
        }
        Cache::forever("menu:scopecount:ver:{$tenant->id}", (int) Cache::get("menu:scopecount:ver:{$tenant->id}", 0) + 1); // menü kart sayıları
        $this->info("✓ ".count($picked)." ürün {$targetCat->path} kategorisine yazıldı (Sira 1..".count($picked)."), hedefte toplam {$cnt} atama.");

        return self::SUCCESS;
    }
}
