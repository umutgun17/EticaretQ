<?php

namespace App\Console\Commands;

use App\Models\WebPushSubscription;
use App\Services\Marketing\UnifiedSender;
use Illuminate\Console\Command;

/**
 * Web Push test gönderimi (Unified Sender → PushDriver).
 *
 *   php artisan marketing:push-test --tenant=1 --last --title="Merhaba" --body="..."
 *   php artisan marketing:push-test --tenant=1 --endpoint="https://..." --body="..."
 */
class MarketingPushTest extends Command
{
    protected $signature = 'marketing:push-test
        {--tenant= : Tenant ID}
        {--endpoint= : Hedef abonelik endpoint (boşsa --last gerekir)}
        {--last : Tenant\'ın en son aktif aboneliğine gönder}
        {--title=Yunbi : Bildirim başlığı}
        {--body=Test bildirimi : Bildirim metni}
        {--url=/ : Tıklama hedefi}';

    protected $description = 'Web Push test bildirimi gönderir';

    public function handle(UnifiedSender $sender): int
    {
        $tenantId = (int) $this->option('tenant');
        if (! $tenantId) {
            $this->error('--tenant zorunludur.');

            return self::FAILURE;
        }

        $endpoint = (string) $this->option('endpoint');
        if ($endpoint === '' && $this->option('last')) {
            $sub = WebPushSubscription::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('is_active', true)
                ->latest('id')
                ->first();
            if (! $sub) {
                $this->error("Tenant {$tenantId} için aktif abonelik yok. Önce /widget/push-demo.html üzerinden abone ol.");

                return self::FAILURE;
            }
            $endpoint = $sub->endpoint;
            $this->info("Son abonelik: #{$sub->id} ({$sub->origin})");
        }

        if ($endpoint === '') {
            $this->error('--endpoint ya da --last gerekli.');

            return self::FAILURE;
        }

        $log = $sender->send($tenantId, 'push', $endpoint, [
            'subject' => (string) $this->option('title'),
            'body' => (string) $this->option('body'),
            'url' => (string) $this->option('url'),
        ], ['source' => 'test', 'source_type' => 'test', 'skip_gates' => true]);

        $this->table(['Alan', 'Değer'], [
            ['log_id', $log->id],
            ['status', $log->status],
            ['skip_reason', $log->skip_reason ?? '-'],
            ['provider', $log->provider ?? '-'],
            ['error', $log->error ?? '-'],
        ]);

        return $log->status === 'sent' ? self::SUCCESS : self::FAILURE;
    }
}
