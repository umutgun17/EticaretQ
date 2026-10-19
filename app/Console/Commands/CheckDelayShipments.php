<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Crm\DelayShipmentChecker;
use App\Services\OrderDelayService;
use Illuminate\Console\Command;

/** Geciken siparişlerin Nebim + Sürat (iki cari) kargo kontrolü → order_shipment_checks. */
class CheckDelayShipments extends Command
{
    protected $signature = 'crm:check-delay-shipments {--tenant=1}';

    protected $description = 'Geciken siparişler gerçekten çıkmadı mı? Nebim + Sürat cari kontrolü';

    public function handle(): int
    {
        $tenant = Tenant::findOrFail((int) $this->option('tenant'));
        $orders = (new OrderDelayService($tenant))->delayedOrders()->pluck('order');

        $t = microtime(true);
        $counts = (new DelayShipmentChecker($tenant))->checkMany($orders);
        ksort($counts);
        $this->line(sprintf('[%s] %d sipariş · %s · %.1f sn', now('Europe/Istanbul')->format('Y-m-d H:i:s'), $orders->count(),
            json_encode($counts), microtime(true) - $t));

        return self::SUCCESS;
    }
}
