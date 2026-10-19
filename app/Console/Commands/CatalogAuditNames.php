<?php

namespace App\Console\Commands;

use App\Models\CategorySuggestion;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\NameRuleClassifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Kural-bazlı ad denetimi (LLM'siz) — kategorili TÜM aktif ürünleri tarar,
 * ad↔atama tutarsızlıklarını (unisex çift-dal eksiği, cinsiyet/tip çelişkisi,
 * eksik tip yaprağı) category_suggestions'a tier=review olarak yazar.
 * Ticimax'a HİÇBİR ŞEY yazmaz — öneriler panelden ("Kategori Zekası") onaylanır.
 */
class CatalogAuditNames extends Command
{
    protected $signature = 'catalog:audit-names
        {--tenant= : Tenant id (boşsa tüm aktif tenant\'lar)}
        {--limit=0 : Maks öneri sayısı (0 = sınırsız)}
        {--product= : Tek ürün id (test)}
        {--dry : Öneri YAZMA, sadece raporla}
        {--sweep-only : Sadece bayat önerileri kapat, yeni öneri üretme}';

    protected $description = 'Ürün adlarından kural-bazlı kategori denetimi yapar, önerileri panele yazar (LLM kullanmaz).';

    public function handle(NameRuleClassifier $rules): int
    {
        // --tenant verilmezse tüm aktif tenant'lar için kendini çağırır
        // (opsiyonlar önce yakalanır; iç çağrı $input'u değiştirir).
        if (! $this->option('tenant')) {
            $opts = array_filter([
                '--limit' => $this->option('limit'),
                '--product' => $this->option('product'),
                '--dry' => $this->option('dry'),
                '--sweep-only' => $this->option('sweep-only'),
            ]);

            $exit = self::SUCCESS;
            foreach (Tenant::where('is_active', true)->orderBy('id')->pluck('id') as $tid) {
                $this->line("— tenant {$tid} —");
                $exit = max($exit, $this->call('catalog:audit-names', $opts + ['--tenant' => $tid]));
            }

            return $exit;
        }

        $tenant = Tenant::find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('--tenant geçersiz.');

            return self::FAILURE;
        }

        $dry = (bool) $this->option('dry');
        $limit = max(0, (int) $this->option('limit'));

        $rules->buildContext($tenant);

        // Tüm atamaları tek sorguda önyükle: platform_product_id → [kategori id]
        $assignments = [];
        foreach (DB::table('product_platform_categories')
            ->where('tenant_id', $tenant->id)
            ->get(['platform_product_id', 'platform_category_id']) as $row) {
            $assignments[(int) $row->platform_product_id][] = (int) $row->platform_category_id;
        }

        // Bekleyen öneriler yazıldıktan sonra ürün Ticimax'ta elle taşınmış olabilir;
        // önerilen kategorilerin tamamı zaten atanmışsa öneri karşılanmıştır → stale.
        // (Panelde bayat "mevcut: Erkek Çocuk" kartları bunlardan çıkıyordu.)
        $stale = 0;
        $pendingSuggestions = CategorySuggestion::where('tenant_id', $tenant->id)
            ->where('status', 'suggested')->where('action', 'recategorize')->get();
        if ($pendingSuggestions->isNotEmpty()) {
            $platformIds = DB::table('products')
                ->whereIn('id', $pendingSuggestions->pluck('product_id'))
                ->pluck('platform_product_id', 'id');
            foreach ($pendingSuggestions as $s) {
                $want = (array) ($s->suggested_category_ids ?? []);
                $cur = $assignments[(int) ($platformIds[$s->product_id] ?? 0)] ?? [];
                if ($want && ! array_diff($want, $cur)) {
                    $stale++;
                    $this->line("  ~ öneri {$s->id} (ürün {$s->product_id}) zaten karşılanmış → stale");
                    if (! $dry) {
                        $s->update(['status' => 'stale']);
                    }
                }
            }
        }
        $this->info("Süpürme: {$stale} bayat öneri kapatıldı" . ($dry ? ' (DRY)' : ''));

        if ($this->option('sweep-only')) {
            return self::SUCCESS;
        }

        $query = Product::forTenant($tenant->id)->where('is_active', true);
        if ($this->option('product')) {
            $query->where('id', (int) $this->option('product'));
        }
        // Bekleyen/uygulanmış/karara bağlanmış önerisi olan ürüne mükerrer öneri üretme.
        // 'rejected' ve 'stale' de listede: kullanıcının reddettiği veya elle çözdüğü
        // ürünü her gece yeniden önermeyelim.
        $query->whereNotExists(function ($q) use ($tenant) {
            $q->selectRaw('1')
                ->from('category_suggestions')
                ->whereColumn('category_suggestions.product_id', 'products.id')
                ->where('category_suggestions.tenant_id', $tenant->id)
                ->whereIn('category_suggestions.status', ['suggested', 'approved', 'auto_applied', 'applied', 'rejected', 'stale']);
        });

        $stats = ['incelenen' => 0, 'oneri' => 0, 'temiz' => 0, 'kategorisiz' => 0];

        foreach ($query->orderBy('id')->cursor() as $product) {
            if ($limit && $stats['oneri'] >= $limit) {
                break;
            }
            $stats['incelenen']++;

            $current = $assignments[(int) $product->platform_product_id] ?? [];
            $data = $rules->audit($product, $current);
            if (! $data) {
                // audit() kategorisiz ürünlerde null döner — istatistik için ayır
                $current ? $stats['temiz']++ : $stats['kategorisiz']++;

                continue;
            }

            $stats['oneri']++;
            $this->line(sprintf(
                '  ? %d %s%s',
                $product->id,
                mb_substr($product->name, 0, 52),
                $this->output->isVerbose() ? "\n      " . $data['rationale'] : ''
            ));

            if (! $dry) {
                CategorySuggestion::create($data);
            }
        }

        $this->newLine();
        $this->info(sprintf(
            'Bitti: %d incelendi → %d öneri%s, %d temiz, %d kategorisiz (categorize kapsamı)',
            $stats['incelenen'], $stats['oneri'], $dry ? ' (DRY — yazılmadı)' : ' panele yazıldı',
            $stats['temiz'], $stats['kategorisiz']
        ));

        return self::SUCCESS;
    }
}
