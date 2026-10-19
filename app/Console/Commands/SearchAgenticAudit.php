<?php

namespace App\Console\Commands;

use App\Models\SearchSynonym;
use App\Models\Tenant;
use App\Services\Search\QueryUnderstanding;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Akıllı Arama — agentic denetim.
 * Sık tekrarlayan SONUÇSUZ aramaları tarar; katalog sözlüğüne (renk/kategori/marka/cinsiyet)
 * fuzzy (Levenshtein, deascii) yakın bir doğru karşılık bulursa YAZIM önerisi üretir:
 * "snaker"→"sneaker". status=suggested → merchant panelden onaylar; onaylanınca
 * QueryUnderstanding token'ı otomatik düzeltir. Çark/agentic döngüsünün arama ayağı.
 */
class SearchAgenticAudit extends Command
{
    protected $signature = 'search:agentic-audit {--tenant= : Sadece bu tenant id} {--days=7} {--min=3 : Min tekrar} {--dry : Yazma, sadece göster}';

    protected $description = 'Sonuçsuz/sık aramalardan otomatik yazım/sinonim önerisi üretir (status=suggested).';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $min = max(1, (int) $this->option('min'));
        $dry = (bool) $this->option('dry');

        $tenants = $this->option('tenant')
            ? Tenant::where('id', (int) $this->option('tenant'))->get()
            : Tenant::where('is_active', true)->get();

        foreach ($tenants as $tenant) {
            $vocab = $this->vocabWords($tenant->id);
            if (empty($vocab)) {
                continue;
            }

            $zero = DB::table('search_queries')
                ->where('tenant_id', $tenant->id)
                ->where('has_results', false)
                ->where('is_test', false)
                ->where('created_at', '>=', now()->subDays($days))
                ->whereNotNull('normalized_query')
                ->where('normalized_query', '!=', '')
                ->selectRaw('normalized_query, count(*) as c')
                ->groupBy('normalized_query')
                ->havingRaw('count(*) >= ?', [$min])
                ->orderByRaw('c desc')
                ->limit(100)
                ->get();

            $made = 0;
            foreach ($zero as $row) {
                $q = $row->normalized_query;

                // Zaten bir kural/öneri var mı (herhangi statü)?
                $exists = SearchSynonym::query()
                    ->where('tenant_id', $tenant->id)
                    ->whereRaw('lower(term) = ?', [mb_strtolower($q)])
                    ->exists();
                if ($exists) {
                    continue;
                }

                [$best, $dist] = $this->closest($q, $vocab);
                $maxDist = max(1, (int) floor(mb_strlen($q) * 0.34)); // ~%34 toleransa kadar
                if ($best === null || $dist === 0 || $dist > $maxDist) {
                    continue;
                }

                $this->line("  [{$tenant->slug}] \"{$q}\" → \"{$best}\"  (mesafe {$dist}, {$row->c} kez)");
                if (! $dry) {
                    SearchSynonym::create([
                        'tenant_id' => $tenant->id,
                        'term' => $q,
                        'synonyms' => [$best],
                        'type' => 'spelling',
                        'source' => 'auto',
                        'status' => 'suggested',
                        'meta' => ['count' => (int) $row->c, 'distance' => $dist],
                    ]);
                }
                $made++;
            }

            $this->info("{$tenant->slug}: {$made} öneri" . ($dry ? ' (dry-run)' : ''));
        }

        return self::SUCCESS;
    }

    /** Tenant katalog sözlüğünden doğru-yazım aday kelimeleri (sayısal bedenler hariç). */
    protected function vocabWords(int $tenantId): array
    {
        $v = QueryUnderstanding::forTenant($tenantId)->vocabulary();
        $words = [];
        foreach (['colors', 'categories', 'brands', 'genders'] as $k) {
            foreach (($v[$k] ?? []) as $value) {
                $words[] = $value;
            }
        }

        return array_values(array_unique($words));
    }

    /** Sorguya en yakın aday (deascii + Levenshtein). @return array{0:?string,1:int} */
    protected function closest(string $q, array $words): array
    {
        $qf = $this->fold($q);
        $best = null;
        $bestD = PHP_INT_MAX;
        foreach ($words as $w) {
            $d = levenshtein($qf, $this->fold($w));
            if ($d < $bestD) {
                $bestD = $d;
                $best = $w;
            }
        }

        return [$best, $bestD === PHP_INT_MAX ? -1 : $bestD];
    }

    /** Deascii + lowercase (Levenshtein'in byte-bazlı olması için Türkçe karakter sadeleştir). */
    protected function fold(string $s): string
    {
        $s = str_replace(['İ', 'I', 'Ş', 'Ğ', 'Ü', 'Ö', 'Ç'], ['i', 'ı', 'ş', 'ğ', 'ü', 'ö', 'ç'], $s);
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s, ['ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u']);

        return preg_replace('/[^a-z0-9 ]+/', '', $s) ?? '';
    }
}
