<?php

namespace App\Services\Menu;

use App\Models\Tenant;
use App\Services\Ranking\CategoryRanker;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Kategori kapak seçici: her yaprak kategori için Akıllı Sıralama'nın (CategoryRanker) en üst N ürününü aday alır,
 * her adayın ilk 2 fotoğrafını (Ticimax thumb) indirip GD ile puanlar — temiz/açık zemin, ürünün kadraja oturması
 * (kaplama %25-65), ortalanma — ve sıra puanıyla harmanlayıp en iyi kapağı menu_category_images'a yazar.
 * Panel adayları listeler; elle seçim overrides.images ile bunu ezer.
 */
class MenuImagePicker
{
    public const CANDIDATES = 6;   // kategori başına aday ürün

    public const IMAGES_PER = 2;   // aday başına incelenen fotoğraf

    public const CONCURRENCY = 8;

    /** @return array{categories:int, picked:int, downloaded:int, seconds:float} */
    public function pickForTenant(int $tenantId, ?array $onlyPaths = null): array
    {
        $t0 = microtime(true);
        $tenant = Tenant::find($tenantId);
        if (! $tenant) {
            return ['categories' => 0, 'picked' => 0, 'downloaded' => 0, 'seconds' => 0];
        }
        Cache::put("menu:picking:{$tenantId}", ['started' => now()->toIso8601String()], 1800);

        $data = MenuDataService::build($tenantId);
        $paths = [];
        foreach ($data['segments'] as $seg) {
            foreach ($seg['tiles'] as $tile) {
                $paths[$tile['path']] = $tile['path'];
            }
        }
        if ($onlyPaths) {
            $paths = array_intersect_key($paths, array_flip($onlyPaths)) ?: array_flip($onlyPaths);
        }

        $ranker = null;
        try {
            $ranker = new CategoryRanker;
            $ranker->buildSignals($tenant);
        } catch (\Throwable $e) {
            Log::warning('menu picker: ranker signals failed, falling back to performance_score', ['err' => $e->getMessage()]);
            $ranker = null;
        }

        $picked = 0;
        $downloaded = 0;
        foreach ($paths as $path) {
            try {
                $res = $this->pickCategory($tenantId, $path, $ranker);
                if ($res) {
                    $picked++;
                    $downloaded += $res['downloaded'];
                }
            } catch (\Throwable $e) {
                Log::warning('menu picker: category failed', ['path' => $path, 'err' => $e->getMessage()]);
            }
        }
        Cache::forget("menu:picking:{$tenantId}");
        Cache::forget("menu:images:{$tenantId}");
        TenantMenuSettings::forget($tenantId);

        return ['categories' => count($paths), 'picked' => $picked, 'downloaded' => $downloaded, 'seconds' => round(microtime(true) - $t0, 1)];
    }

    /** Tek kategori: adaylar → görsel puanı → kayıt. */
    public function pickCategory(int $tenantId, string $path, ?CategoryRanker $ranker = null): ?array
    {
        $pool = DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)
            ->where(function ($q) use ($path) {
                $q->where('category_path', $path)->orWhere('category_path', 'like', $path.' > %');
            })
            ->whereNotNull('images')->whereRaw("images::text not in ('[]','null')")
            ->orderByDesc(DB::raw('case when stock_quantity > 0 then 1 else 0 end'))
            ->orderByDesc('performance_score')->limit(60)
            ->get(['id', 'name', 'url', 'images', 'stock_quantity', 'performance_score']);
        if ($pool->isEmpty()) {
            return null;
        }
        $byId = $pool->keyBy('id');

        // Akıllı Sıralama sırası (stoklu havuz); yoksa performans puanı
        $ordered = [];
        if ($ranker) {
            $ids = $pool->filter(fn ($p) => (int) $p->stock_quantity > 0)->pluck('id')->map(fn ($i) => (int) $i)->all();
            $ranked = $ids ? $ranker->rank($ids) : [];
            foreach ($ranked as $r) {
                $ordered[] = (int) $r['product_id'];
            }
        }
        foreach ($pool as $p) {
            if (! in_array((int) $p->id, $ordered, true)) {
                $ordered[] = (int) $p->id;
            }
        }
        $candIds = array_slice($ordered, 0, self::CANDIDATES);

        // indirilecek görseller
        $jobs = [];
        foreach ($candIds as $pos => $pid) {
            $p = $byId[$pid];
            $imgs = json_decode((string) $p->images, true);
            if (! is_array($imgs)) {
                continue;
            }
            foreach (array_slice($imgs, 0, self::IMAGES_PER) as $ix => $im) {
                $u = is_array($im) ? ($im['url'] ?? $im['src'] ?? null) : $im;
                if (! is_string($u) || $u === '') {
                    continue;
                }
                $jobs[] = ['pid' => $pid, 'pos' => $pos, 'ix' => $ix, 'url' => $u, 'thumb' => static::thumbUrl($u)];
            }
        }
        $scores = $this->analyzeMany($jobs);
        $downloaded = $scores['downloaded'];

        $n = max(1, count($candIds));
        $cands = [];
        foreach ($candIds as $pos => $pid) {
            $p = $byId[$pid];
            $best = null;
            foreach ($jobs as $j) {
                if ($j['pid'] !== $pid) {
                    continue;
                }
                $s = $scores['by_url'][$j['url']] ?? null;
                if ($s === null) {
                    continue;
                }
                if (! $best || $s['score'] > $best['score']) {
                    $best = $s + ['image' => $j['url'], 'thumb' => $j['thumb'], 'ix' => $j['ix']];
                }
            }
            $rankNorm = 1 - $pos / $n;
            $imgScore = $best ? $best['score'] : 0.0;
            $total = $best ? 0.75 * $imgScore + 0.25 * $rankNorm : 0.15 * $rankNorm;
            $cands[] = [
                'product_id' => $pid,
                'name' => mb_substr((string) $p->name, 0, 80),
                'url' => (string) $p->url,
                'in_stock' => (int) $p->stock_quantity > 0,
                'rank' => $pos + 1,
                'image' => $best['image'] ?? static::firstImage((string) $p->images),
                'thumb' => $best['thumb'] ?? static::thumbUrl((string) static::firstImage((string) $p->images)),
                'image_score' => round($imgScore, 3),
                'whiteness' => $best['whiteness'] ?? null,
                'coverage' => $best['coverage'] ?? null,
                'score' => round($total, 3),
            ];
        }
        usort($cands, fn ($a, $b) => $b['score'] <=> $a['score']);
        $top = $cands[0] ?? null;

        DB::table('menu_category_images')->updateOrInsert(
            ['tenant_id' => $tenantId, 'category_path' => $path],
            ['product_id' => $top['product_id'] ?? null, 'image_url' => $top['image'] ?? null, 'score' => $top['score'] ?? null,
                'candidates' => json_encode($cands, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'picked_at' => now()]
        );

        return ['top' => $top, 'candidates' => $cands, 'downloaded' => $downloaded];
    }

    /** Ticimax "buyuk" → "thumb" (400×600, ~25KB); başka CDN ise orijinal. */
    public static function thumbUrl(?string $u): ?string
    {
        if (! $u) {
            return null;
        }

        return str_contains($u, '/UrunResimleri/buyuk/') ? str_replace('/UrunResimleri/buyuk/', '/UrunResimleri/thumb/', $u) : $u;
    }

    public static function firstImage(string $json): ?string
    {
        $imgs = json_decode($json, true);
        if (! is_array($imgs) || ! $imgs) {
            return null;
        }
        $f = $imgs[0];
        $u = is_array($f) ? ($f['url'] ?? $f['src'] ?? null) : $f;

        return is_string($u) ? $u : null;
    }

    /** Paralel indir (curl_multi) + puanla; URL bazında 7 gün cache. @return array{by_url:array, downloaded:int} */
    protected function analyzeMany(array $jobs): array
    {
        $byUrl = [];
        $todo = [];
        foreach ($jobs as $j) {
            $ck = 'menu:imgscore:'.md5($j['url']);
            $c = Cache::get($ck);
            if (is_array($c)) {
                $byUrl[$j['url']] = $c;
            } elseif (! isset($todo[$j['url']])) {
                $todo[$j['url']] = $j['thumb'];
            }
        }
        $downloaded = 0;
        $urls = array_keys($todo);
        for ($i = 0; $i < count($urls); $i += self::CONCURRENCY) {
            $batch = array_slice($urls, $i, self::CONCURRENCY);
            $mh = curl_multi_init();
            $hs = [];
            foreach ($batch as $u) {
                $ch = curl_init($todo[$u]);
                curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
                    CURLOPT_USERAGENT => 'Mozilla/5.0 (YunbiMenu image scorer)', CURLOPT_SSL_VERIFYPEER => true]);
                curl_multi_add_handle($mh, $ch);
                $hs[$u] = $ch;
            }
            do {
                $st = curl_multi_exec($mh, $running);
                if ($running) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running && $st === CURLM_OK);
            foreach ($hs as $u => $ch) {
                $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $body = curl_multi_getcontent($ch);
                if ($code === 404 && $todo[$u] !== $u) {
                    // thumb yoksa orijinali dene
                    $body = @file_get_contents($u, false, stream_context_create(['http' => ['timeout' => 10, 'user_agent' => 'Mozilla/5.0']]));
                    $code = $body ? 200 : 0;
                }
                $downloaded++;
                $s = ($code === 200 && $body) ? $this->analyze($body) : null;
                if ($s) {
                    $byUrl[$u] = $s;
                    Cache::put('menu:imgscore:'.md5($u), $s, 7 * 86400);
                }
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }
            curl_multi_close($mh);
        }

        return ['by_url' => $byUrl, 'downloaded' => $downloaded];
    }

    /**
     * GD ile kapak uygunluğu: 0..1.
     * whiteness: kenar şeridi açık ve düz mü (ürün fotoğrafı beyaz/gri zemin; model/sokak çekimi koyu-renkli kenar),
     * coverage: ürün karenin ne kadarını kaplıyor (ideal %25-65; ne toz ne taşma),
     * center: ürün ağırlık merkezi ortaya yakın mı. Kare kırpım (object-fit: cover) düşünülerek orta kare değerlendirilir.
     */
    public function analyze(string $bytes): ?array
    {
        $im = @imagecreatefromstring($bytes);
        if (! $im) {
            return null;
        }
        $w = imagesx($im);
        $h = imagesy($im);
        if ($w < 20 || $h < 20) {
            imagedestroy($im);

            return null;
        }
        // orta kare kırp (kapakta gösterilen alan), 48×48'e küçült
        $side = min($w, $h);
        $sx = (int) (($w - $side) / 2);
        $sy = (int) (($h - $side) / 2);
        $N = 48;
        $sm = imagecreatetruecolor($N, $N);
        imagecopyresampled($sm, $im, 0, 0, $sx, $sy, $N, $N, $side, $side);
        imagedestroy($im);

        $lum = [];
        $sat = [];
        for ($y = 0; $y < $N; $y++) {
            for ($x = 0; $x < $N; $x++) {
                $rgb = imagecolorat($sm, $x, $y);
                $r = ($rgb >> 16) & 255;
                $g = ($rgb >> 8) & 255;
                $b = $rgb & 255;
                $mx = max($r, $g, $b);
                $mn = min($r, $g, $b);
                $lum[$y][$x] = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                $sat[$y][$x] = $mx > 0 ? ($mx - $mn) / $mx : 0;
            }
        }
        imagedestroy($sm);

        // kenar şeridi (4px)
        $bl = [];
        $bs = [];
        for ($y = 0; $y < $N; $y++) {
            for ($x = 0; $x < $N; $x++) {
                if ($x < 4 || $y < 4 || $x >= $N - 4 || $y >= $N - 4) {
                    $bl[] = $lum[$y][$x];
                    $bs[] = $sat[$y][$x];
                }
            }
        }
        $bgLum = array_sum($bl) / count($bl);
        $bgSat = array_sum($bs) / count($bs);
        $var = 0;
        foreach ($bl as $v) {
            $var += ($v - $bgLum) ** 2;
        }
        $bgStd = sqrt($var / count($bl));
        $whiteness = max(0, min(1, ($bgLum - 165) / 75)) * (1 - min(1, $bgSat / 0.35)) * (1 - min(1, $bgStd / 45));

        // ürün maskesi: zeminden farklı pikseller
        $cnt = 0;
        $cx = 0;
        $cy = 0;
        for ($y = 0; $y < $N; $y++) {
            for ($x = 0; $x < $N; $x++) {
                if (abs($lum[$y][$x] - $bgLum) > 28 || $sat[$y][$x] > $bgSat + 0.2) {
                    $cnt++;
                    $cx += $x;
                    $cy += $y;
                }
            }
        }
        $coverage = $cnt / ($N * $N);
        $coverageFit = 1 - min(1, abs($coverage - 0.42) / 0.32);
        $center = 0.5;
        if ($cnt > 0) {
            $dx = ($cx / $cnt) / $N - 0.5;
            $dy = ($cy / $cnt) / $N - 0.5;
            $center = 1 - min(1, sqrt($dx * $dx + $dy * $dy) / 0.35);
        }
        $score = 0.5 * $whiteness + 0.32 * $coverageFit + 0.18 * $center;

        return ['score' => round($score, 3), 'whiteness' => round($whiteness, 2), 'coverage' => round($coverage, 2), 'center' => round($center, 2)];
    }
}
