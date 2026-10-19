<?php

namespace App\Console\Commands;

use App\Services\SegmentService;
use Illuminate\Console\Command;

/**
 * marketing_profiles tablosunu siparişlerden yeniden kurar; varsayılan segmentleri
 * (yoksa) oluşturur. Scheduler gecelik çağırır; panelden "Profilleri Yenile" de bunu koşar.
 */
class SegmentsRefresh extends Command
{
    protected $signature = 'segments:refresh {--tenant=1}';

    protected $description = 'Pazarlama segmentasyon profillerini siparişlerden yeniden üretir';

    public function handle(): int
    {
        $t = (int) $this->option('tenant');
        $count = SegmentService::refreshProfiles($t);
        SegmentService::seedDefaults($t);
        $this->info("Tenant {$t}: {$count} profil üretildi.");

        return self::SUCCESS;
    }
}
