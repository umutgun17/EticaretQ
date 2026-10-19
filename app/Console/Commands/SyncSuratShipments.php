<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Cargo\SuratShipmentFeed;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/** Sürat carilerinin gönderi listesini yerel cargo_shipments tablosuna çeker (Gecikmeler › Kargo kontrolü). */
class SyncSuratShipments extends Command
{
    protected $signature = 'cargo:sync-surat-shipments {--tenant=1} {--days=2 : bugün dahil geriye kaç gün}';

    protected $description = 'Sürat Kargo cari gönderilerini (normal + kapıda ödeme) yerel tabloya çeker';

    public function handle(): int
    {
        ini_set('memory_limit', '512M');
        $tenant = Tenant::findOrFail((int) $this->option('tenant'));
        if (! SuratShipmentFeed::enabled($tenant)) {
            return self::SUCCESS; // Gecikmeler › kargo kontrolü pasif — Sürat'a istek yok
        }
        $feed = new SuratShipmentFeed($tenant);
        $to = CarbonImmutable::now('Europe/Istanbul')->startOfDay();
        $from = $to->subDays(max(1, (int) $this->option('days')) - 1);

        $t = microtime(true);
        foreach ($feed->sync($from, $to) as $key => $r) {
            $this->line(sprintf('[%s] %s: %d gün, %d gönderi%s', now('Europe/Istanbul')->format('Y-m-d H:i:s'), $key, $r['days'], $r['rows'],
                $r['errors'] ? ' · HATA: ' . implode(' | ', $r['errors']) : ''));
        }
        $this->line(sprintf('  süre %.1f sn', microtime(true) - $t));

        return self::SUCCESS;
    }
}
