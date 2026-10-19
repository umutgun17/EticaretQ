<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Marketing\EmailDnsRecords;
use Illuminate\Console\Command;

/**
 * Tenant'ın gönderim DNS kayıtlarını (SPF / DKIM / DMARC) canlı DNS'ten kontrol eder.
 */
class MarketingEmailVerify extends Command
{
    protected $signature = 'marketing:email-verify {--tenant= : Tenant ID (zorunlu)}';

    protected $description = 'Gönderim domaini için SPF/DKIM/DMARC DNS kayıtlarını doğrular';

    public function handle(): int
    {
        $tenant = Tenant::withoutGlobalScopes()->find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('Geçerli --tenant zorunludur.');

            return self::FAILURE;
        }

        $s = $tenant->settings ?? [];
        if (trim((string) ($s['email_sending_domain'] ?? '')) === '') {
            $this->error('Önce marketing:email-setup çalıştırın (gönderim domaini/DKIM yok).');

            return self::FAILURE;
        }

        $res = EmailDnsRecords::verify($s);
        $rows = array_map(fn ($r) => [
            $r['purpose'], $r['host'], $r['ok'] ? 'VAR ✓' : 'YOK/YAYILMADI', substr($r['value'], 0, 45) . '…',
        ], $res['records']);
        $this->table(['Kayıt', 'Host', 'Durum', 'Değer'], $rows);

        if ($res['verified']) {
            $this->info('✓ Tüm kayıtlar yayında. email_enabled=true yapıp test gönderebilirsiniz.');
        } else {
            $this->warn('Eksik/yayılmamış kayıt var. DNS yayılması 1-48 saat sürebilir.');
        }

        return self::SUCCESS;
    }
}
