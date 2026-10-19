<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;

/**
 * Panelden "Kaydet ve şimdi uygula" denince tek kategorinin sıralamasını gece koşusunu
 * beklemeden Ticimax'a yazar (ranking:sync-categories --live; kill-switch komutta denetlenir).
 */
class ApplyCategoryRanking implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(public int $tenantId, public int $categoryId)
    {
    }

    public function handle(): void
    {
        $exit = Artisan::call('ranking:sync-categories', [
            '--tenant' => $this->tenantId,
            '--category' => (string) $this->categoryId,
            '--live' => true,
            '--force' => true,
        ]);
        Log::info('ApplyCategoryRanking', ['tenant' => $this->tenantId, 'category' => $this->categoryId, 'exit' => $exit]);
    }
}
