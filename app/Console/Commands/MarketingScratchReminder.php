<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\WheelCouponReminder;
use Illuminate\Console\Command;

/**
 * Kazı Kazan (30 dk kupon) — bitmeden ~10 dk önce kullanılmamış kuponlara SMS hatırlatma.
 * Her dakika çalışır (pencere dar). GÜVENLİK: gerçek gönderim yalnızca --live VE
 * tenant ayarı wheel_reminder_enabled=true ise (çark hatırlatmasıyla aynı anahtar).
 *
 *   php artisan marketing:scratch-reminder --tenant=1 [--live]
 */
class MarketingScratchReminder extends Command
{
    protected $signature = 'marketing:scratch-reminder
        {--tenant= : Tenant ID (boşsa tüm aktif tenant\'lar)}
        {--live : Gerçek gönderim (yalnızca wheel_reminder_enabled=true ise)}
        {--limit=200 : Azami kupon}';

    protected $description = 'Kazı Kazan: süresi dolmak üzere kullanılmamış 30 dk kuponlara SMS hatırlatma';

    public function handle(WheelCouponReminder $reminder): int
    {
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->orderBy('id')->pluck('id')->all();

        foreach ($tenantIds as $tenantId) {
            $r = $reminder->runScratch($tenantId, (bool) $this->option('live'), (int) $this->option('limit'));
            if ($r['eligible'] === 0) {
                continue; // sessiz: her dakika çalışır, boş turları loglama
            }
            $mode = $r['simulated'] ? 'SİMÜLASYON' : 'CANLI';
            $this->info("[scratch-reminder] tenant={$tenantId} mod={$mode} uygun={$r['eligible']} gönderildi={$r['sent']} sipariş-vermiş={$r['ordered']} atlanan={$r['skipped']} ertelenen={$r['deferred']}");
        }

        return self::SUCCESS;
    }
}
