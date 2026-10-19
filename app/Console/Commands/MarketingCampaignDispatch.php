<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\CampaignDispatcher;
use Illuminate\Console\Command;

class MarketingCampaignDispatch extends Command
{
    protected $signature = 'marketing:campaign-dispatch {--tenant=} {--live}';

    protected $description = 'Toplu WhatsApp kampanyalarını ısıtma hızında, 24s kapasiteye uyarak gönderir + dönüşüm atfı yapar';

    public function handle(CampaignDispatcher $dispatcher): int
    {
        $live = (bool) $this->option('live');
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->pluck('id')->all();

        foreach ($tenantIds as $tenantId) {
            $res = $dispatcher->run($tenantId, $live);
            $any = $res['sent'] || $res['skipped'] || $res['failed'] || $res['attributed']
                || ($res['email_sent'] ?? 0) || ($res['email_skipped'] ?? 0) || ($res['email_failed'] ?? 0);
            if ($any || $res['note'] !== 'no_active_campaign') {
                $this->info(sprintf(
                    '[%s] t%d wa=%d/%d/%d email=%d/%d/%d (sent/skip/fail) attributed=%d%s%s',
                    now()->toDateTimeString(),
                    $tenantId,
                    $res['sent'], $res['skipped'], $res['failed'],
                    $res['email_sent'] ?? 0, $res['email_skipped'] ?? 0, $res['email_failed'] ?? 0,
                    $res['attributed'],
                    $res['note'] ? ' note='.$res['note'] : '',
                    $live ? '' : ' (DRY)'
                ));
            }
        }

        return self::SUCCESS;
    }
}
