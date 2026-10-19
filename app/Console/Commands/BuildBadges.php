<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Badge\BadgeBuilder;
use Illuminate\Console\Command;

class BuildBadges extends Command
{
    protected $signature = 'badges:build {--tenant= : Belirli tenant ID (kapalı olsa da üretir)}';

    protected $description = 'Ürün Rozetleri (CRO): satış/GA4/stok/kategori verisinden rozet haritasını üretir ve önbelleğe yazar';

    public function handle(BadgeBuilder $builder): int
    {
        // 13 Eki: 10/10 kategorisi (Ticimax canlı SelectUrun) eklenince 128M CLI sınırı aşılıp sessizce düşüyordu
        if ((int) ini_get('memory_limit') > 0 && (int) ini_get('memory_limit') < 1024) {
            ini_set('memory_limit', '1024M');
        }
        $q = Tenant::where('is_active', true);
        if ($this->option('tenant')) {
            $q->where('id', (int) $this->option('tenant'));
        } else {
            $q->whereRaw("coalesce(settings->>'badge_enabled', 'false') in ('true', '1')");
        }
        foreach ($q->get() as $tenant) {
            try {
                $out = $builder->build($tenant);
                $this->line(sprintf('%s t%d rozetli=%d kanıt=%d %s (%d ms)%s', now()->format('H:i'), $tenant->id, $out['badged'], $out['proof'],
                    json_encode($out['counts'], JSON_UNESCAPED_UNICODE), $out['duration_ms'], $out['notes'] ? ' NOT: '.implode(' | ', $out['notes']) : ''));
            } catch (\Throwable $e) {
                $this->error("t{$tenant->id} hata: ".$e->getMessage());
            }
        }

        return 0;
    }
}
