<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\WheelCouponReminder;
use Illuminate\Console\Command;

/**
 * Çark Entegrasyonu — kazanılmış ama kullanılmamış kuponlar için son hatırlatma SMS'i.
 * GÜVENLİK: gerçek gönderim yalnızca --live VE settings wheel_reminder_enabled=true ise.
 *
 *   php artisan marketing:wheel-reminder --tenant=1 [--live]
 */
class MarketingWheelReminder extends Command
{
    protected $signature = 'marketing:wheel-reminder
        {--tenant= : Tenant ID (boşsa tüm aktif tenant\'lar)}
        {--live : Gerçek gönderim (yalnızca wheel_reminder_enabled=true ise)}
        {--limit=200 : Azami kupon}';

    protected $description = 'Çark: süresi dolmak üzere kullanılmamış kuponlara hatırlatma SMS gönderir';

    public function handle(WheelCouponReminder $reminder): int
    {
        // --tenant verilmezse tüm aktif tenant'lar işlenir; gönderim kararı
        // tenant-bazlı kill-switch'te (wheel_reminder_enabled) kalır.
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->orderBy('id')->pluck('id')->all();

        foreach ($tenantIds as $tenantId) {
            $this->line("— tenant {$tenantId} —");
            $r = $reminder->run($tenantId, (bool) $this->option('live'), (int) $this->option('limit'));
            $mode = $r['simulated'] ? 'SİMÜLASYON' : 'CANLI';
            $this->info("[wheel-reminder] mod={$mode} uygun={$r['eligible']} gönderildi={$r['sent']} sipariş-vermiş={$r['ordered']} atlanan={$r['skipped']} ertelenen={$r['deferred']} | dönüşüm={$r['attributed']} ciro={$r['revenue']}₺");
        }

        return self::SUCCESS;
    }
}
