<?php

namespace App\Services\Filter;

use App\Models\Channel;
use App\Services\TicimaxService;
use Illuminate\Support\Facades\Cache;

/**
 * Ticimax'ın kendi filtre URL parametresini (?filtre=td-135|455,419;s-2|371) Yunbi diline çevirir.
 * Yalnız teknik detay (td) bölümleri anlamlandırılır: özellik id → özellik adı (Cinsiyet), değer id → değer adı (Kadın).
 * Kullanım: kampanya sayfasında segment daraltması id taşımadan Ticimax'ın sunucu tarafı filtresiyle yapılır;
 * Yunbi filtresi de aynı daraltmayı (facet sayıları, beden aralığı, ürün id'leri) uygular.
 */
class NativeFilter
{
    /** @return array{specs: array<string, string[]>, label: string}|null */
    public static function resolve(int $tenantId, string $filtre): ?array
    {
        $filtre = trim($filtre);
        if ($filtre === '' || mb_strlen($filtre) > 300) {
            return null;
        }
        $map = self::specMap($tenantId);
        if (! $map) {
            return null;
        }
        $specs = [];
        foreach (explode(';', $filtre) as $part) {
            if (! preg_match('/^td-(\d+)\|([\d,]+)$/', trim($part), $m)) {
                continue;
            }
            $specName = $map['props'][(int) $m[1]] ?? null;
            if (! $specName) {
                continue;
            }
            foreach (array_filter(explode(',', $m[2])) as $vid) {
                $vn = $map['values'][(int) $vid] ?? null;
                if ($vn !== null) {
                    $specs[$specName][] = $vn;
                }
            }
        }
        $specs = array_filter(array_map(fn ($v) => array_values(array_unique($v)), $specs));
        if (! $specs) {
            return null;
        }

        return ['specs' => $specs, 'label' => self::label($specs)];
    }

    /** Kısa çip etiketi: "Kadın / Unisex", 3+ değerde ortak kelime varsa o ("Çocuk"), yoksa "Kadın +2". */
    protected static function label(array $specs): string
    {
        $vals = array_merge(...array_values($specs));
        if (count($vals) <= 2) {
            return implode(' / ', $vals);
        }
        $common = null;
        foreach ($vals as $v) {
            $words = preg_split('/\s+/', mb_strtolower($v)) ?: [];
            $common = $common === null ? $words : array_values(array_intersect($common, $words));
        }
        if ($common) {
            return mb_convert_case($common[0], MB_CASE_TITLE, 'UTF-8');
        }

        return $vals[0].' +'.(count($vals) - 1);
    }

    /** Ticimax teknik detay özellik/değer sözlüğü (günlük cache). */
    public static function specMap(int $tenantId): ?array
    {
        return Cache::remember("filter:ticimax-specs:{$tenantId}", 86400, function () use ($tenantId) {
            $ch = Channel::where('tenant_id', $tenantId)->where('type', 'ticimax-ecommerce')->where('is_active', true)->first();
            if (! $ch) {
                return null;
            }
            try {
                $svc = TicimaxService::fromChannel($ch);
                $props = $svc->getTechSpecProperties(-1)['data']['SelectTeknikDetayOzellikResult']['TeknikDetayOzellik'] ?? [];
                $vals = $svc->getTechSpecValues(-1)['data']['SelectTeknikDetayDegerResult']['TeknikDetayDeger'] ?? [];
            } catch (\Throwable $e) {
                return null;
            }
            $one = fn ($x) => isset($x['ID']) ? [$x] : $x;
            $out = ['props' => [], 'values' => []];
            foreach ($one($props) as $p) {
                $out['props'][(int) $p['ID']] = (string) $p['Tanim'];
            }
            foreach ($one($vals) as $v) {
                $out['values'][(int) $v['ID']] = (string) $v['Tanim'];
            }

            return $out['props'] ? $out : null;
        });
    }
}
