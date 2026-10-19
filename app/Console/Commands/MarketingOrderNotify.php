<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\OrderStatusNotifier;
use Illuminate\Console\Command;

/**
 * Sipariş Bilgilendirme — sipariş alındı / kargoya verildi / teslim edildi bildirimleri.
 *
 * GÜVENLİK: gerçek gönderim yalnızca --live VE tenant settings
 * ['order_notify_enabled']=true ise. Varsayılan dry-run (simülasyon).
 *
 * Örnek (güvenli simülasyon):  php artisan marketing:order-notify --tenant=1
 * Canlı gönderim:              php artisan marketing:order-notify --tenant=1 --live
 */
class MarketingOrderNotify extends Command
{
    protected $signature = 'marketing:order-notify
        {--tenant= : Tenant ID (boşsa tüm aktif tenant\'lar)}
        {--live : Gerçek gönderim yap (yalnızca order_notify_enabled=true ise)}
        {--limit=2000 : Taranacak azami sipariş sayısı}';

    protected $description = 'Sipariş bilgilendirme: alındı/kargoda/teslim edildi bildirimlerini gönder';

    public function handle(OrderStatusNotifier $notifier): int
    {
        // --tenant verilmezse tüm aktif tenant'lar işlenir; gönderim kararı
        // tenant-bazlı kill-switch'te (order_notify_enabled) kalır.
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->orderBy('id')->pluck('id')->all();

        foreach ($tenantIds as $tenantId) {
            $this->line("— tenant {$tenantId} —");
            $r = $notifier->run($tenantId, (bool) $this->option('live'), (int) $this->option('limit'));

            $mode = $r['simulated'] ? 'SİMÜLASYON (gönderim yok)' : 'CANLI';
            $this->info("[order-notify] mod={$mode} taranan={$r['scanned']} gönderilen={$r['sent']} baseline={$r['baselined']} durdurulan={$r['stopped']} atlanan={$r['skipped']}");
        }

        return self::SUCCESS;
    }
}
