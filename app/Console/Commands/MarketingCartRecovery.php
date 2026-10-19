<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\CartRecoveryAutomation;
use Illuminate\Console\Command;

/**
 * Sepet Kurtarma otomasyonu — terk edilmiş sepetleri tarar, kaydeder ve
 * zamanı gelmiş hatırlatma adımlarını işler.
 *
 * GÜVENLİK: gerçek e-posta yalnızca --live VE tenant settings
 * ['cart_recovery_enabled']=true ise gönderilir. Varsayılan dry-run (simülasyon).
 *
 * Örnek (güvenli simülasyon):  php artisan marketing:cart-recovery --tenant=1
 * Canlı gönderim:              php artisan marketing:cart-recovery --tenant=1 --live
 */
class MarketingCartRecovery extends Command
{
    protected $signature = 'marketing:cart-recovery
        {--tenant= : Tenant ID (boşsa tüm aktif tenant\'lar)}
        {--live : Gerçek gönderim yap (yalnızca cart_recovery_enabled=true ise)}
        {--no-enroll : Yeni terk taramasını atla, sadece bekleyen adımları işle}
        {--limit=200 : İşlenecek azami journey sayısı}';

    protected $description = 'Sepet kurtarma: terk edilmiş sepetleri kaydet ve hatırlatma adımlarını gönder';

    public function handle(CartRecoveryAutomation $automation): int
    {
        // --tenant verilmezse tüm aktif tenant'lar işlenir; gönderim kararı
        // tenant-bazlı kill-switch'te (cart_recovery_enabled) kalır.
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::where('is_active', true)->orderBy('id')->pluck('id')->all();

        foreach ($tenantIds as $tenantId) {
            $this->line("— tenant {$tenantId} —");
            $this->runForTenant($automation, $tenantId);
        }

        return self::SUCCESS;
    }

    protected function runForTenant(CartRecoveryAutomation $automation, int $tenantId): void
    {
        $live = (bool) $this->option('live');
        $enabled = $automation->isEnabled($tenantId);

        if (! $this->option('no-enroll')) {
            $e = $automation->enroll($tenantId);
            $this->info("[enroll] taranan={$e['scanned']} kaydedilen={$e['enrolled']} atlanan={$e['skipped']}");
        }

        $p = $automation->process($tenantId, $live, (int) $this->option('limit'));

        $mode = $p['simulated'] ? 'SİMÜLASYON (gönderim yok)' : 'CANLI';
        if ($live && ! $enabled) {
            $this->warn('--live verildi ama cart_recovery_enabled=false → yine de SİMÜLASYON. Aktive etmek için ayarı açın.');
        }

        $this->info("[process] mod={$mode} due={$p['due']} gönderildi={$p['sent']} dönüşüm={$p['converted']} atlanan/başarısız={$p['skipped']} tükenen={$p['exhausted']}");

        // Adımları bitmiş journey'lerde dönüşüm süpürmesi — mesaj göndermez,
        // bu yüzden canlı/simülasyon ayrımı yoktur (çark attribute() deseni)
        $s = $automation->sweepExhausted($tenantId);
        $this->info("[sweep] taranan={$s['scanned']} dönüşüm={$s['converted']}");
    }
}
