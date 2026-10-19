<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\StockAlert;
use App\Models\Tenant;
use App\Services\NetgsmService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * "Gelince haber ver" bildirimcisi: aktif talepleri, ürünün güncel stok
 * kopyasıyla (Ticimax: crm:sync-stock, ikas: ürün sync + stok webhook'u)
 * karşılaştırır; stok POZİTİFSE SMS gönderir (NetGSM kanalı olan tenant).
 * SMS kanalı yoksa yalnız işaretler + loglar (panelde görünür kalır).
 * Varsayılan DRY-RUN; gönderim için --live.
 */
class MarketingStockAlerts extends Command
{
    protected $signature = 'marketing:stock-alerts {--tenant= : Boşsa tüm aktif tenant\'lar} {--live : Gerçek SMS gönder} {--limit=100 : Çalıştırma başına azami bildirim}';

    protected $description = 'Stoğa gelen ürünler için "gelince haber ver" bildirimlerini gönderir';

    public function handle(): int
    {
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->orderBy('id')->pluck('id')->all();

        $live = (bool) $this->option('live');
        $limit = max(1, (int) $this->option('limit'));

        foreach ($tenantIds as $tenantId) {
            $alerts = StockAlert::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereHas('product', fn ($q) => $q->where('stock_quantity', '>', 0))
                ->with('product:id,name,stock_quantity,url')
                ->orderBy('id')
                ->limit($limit)
                ->get();

            if ($alerts->isEmpty()) {
                continue;
            }

            $sms = $this->smsFor($tenantId);
            $this->line("— tenant {$tenantId}: {$alerts->count()} bildirilecek talep" . ($sms ? '' : ' (SMS kanalı yok)'));

            foreach ($alerts as $alert) {
                $sent = false;
                if ($sms && $alert->phone && $live && $this->smsHeader($tenantId)) {
                    $msg = mb_substr(($alert->product->name ?? 'Beklediğiniz ürün') . ' yeniden stokta! Tükenmeden inceleyin.', 0, 155);
                    try {
                        $sms->sendSms($alert->phone, $msg, $this->smsHeader($tenantId));
                        $sent = true;
                    } catch (\Throwable $e) {
                        Log::warning('stock-alert SMS hatası', ['alert_id' => $alert->id, 'error' => $e->getMessage()]);
                    }
                }

                if ($live) {
                    $alert->update(['status' => 'notified', 'notified_at' => now()]);
                }

                $this->line(sprintf(
                    '  #%d %s → %s %s',
                    $alert->id,
                    mb_substr($alert->product->name ?? $alert->platform_product_id, 0, 40),
                    $alert->phone ?: $alert->email,
                    $live ? ($sent ? '[SMS ✓]' : '[işaretlendi]') : '[DRY]'
                ));
            }
        }

        return self::SUCCESS;
    }

    protected function smsHeader(int $tenantId): string
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('type', 'netgsm-call')->where('is_active', true)->first();

        return (string) (($channel->settings ?? [])['sms_header'] ?? '');
    }

    protected function smsFor(int $tenantId): ?NetgsmService
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'netgsm-call')
            ->where('is_active', true)
            ->first();

        try {
            return $channel ? NetgsmService::fromChannel($channel) : null;
        } catch (\Throwable) {
            return null;
        }
    }
}
