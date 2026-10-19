<?php

namespace App\Jobs;

use App\Models\CategorySuggestion;
use App\Services\Catalog\CategoryApplier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Toplu onaylanan kategori önerisini arka planda Ticimax'a uygular.
 * Panel toplu onayda önerileri approved işaretleyip her biri için bu job'u kuyruğa
 * atar — SOAP yazımları HTTP isteğini bloklamaz. Applier hatayı kendi yakalar ve
 * öneriyi failed işaretler (panelde görünür), o yüzden tek deneme yeterli.
 */
class ApplyCategorySuggestion implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(public int $suggestionId)
    {
    }

    public function handle(CategoryApplier $applier): void
    {
        $s = CategorySuggestion::find($this->suggestionId);
        if (! $s || $s->status !== 'approved' || $s->action === 'create_category') {
            return; // bu arada işlendi/reddedildi ya da kategori-açma (elle yapılır)
        }

        $applier->apply($s);
    }
}
