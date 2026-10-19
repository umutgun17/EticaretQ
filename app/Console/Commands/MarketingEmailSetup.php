<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;

/**
 * Pazarlama e-posta gönderimi için tenant'a DKIM kimliği kurar.
 *
 * Uygulama-seviyesi DKIM (Symfony DkimSigner) kullanır → root/Exim config gerekmez.
 * RSA anahtar çifti üretir, özel anahtarı şifreli saklar, açık anahtarı + SPF/DMARC
 * için eklenecek DNS kayıtlarını yazdırır. Müşteri bu kayıtları DNS'ine ekler.
 *
 *   php artisan marketing:email-setup --tenant=1 --domain=pazarlama.tonnyblack.com.tr \
 *       --from=bilgi@pazarlama.tonnyblack.com.tr --name="Tonny Black"
 */
class MarketingEmailSetup extends Command
{
    protected $signature = 'marketing:email-setup
        {--tenant= : Tenant ID (zorunlu)}
        {--domain= : Gönderim (alt) domaini, örn. pazarlama.tonnyblack.com.tr (zorunlu)}
        {--from= : Gönderici e-posta (varsayılan bilgi@<domain>)}
        {--name= : Gönderici görünen ad (varsayılan tenant adı)}
        {--selector=yunbi : DKIM selector}
        {--ip= : Gönderim sunucu IPv4 (SPF için, varsayılan otomatik)}
        {--force : Mevcut DKIM anahtarını yeniden üret}';

    protected $description = 'Tenant için DKIM anahtarı üretir ve gönderim DNS kayıtlarını verir';

    public function handle(): int
    {
        $tenant = Tenant::withoutGlobalScopes()->find((int) $this->option('tenant'));
        if (! $tenant) {
            $this->error('Geçerli --tenant zorunludur.');

            return self::FAILURE;
        }

        $domain = strtolower(trim((string) $this->option('domain')));
        if ($domain === '' || ! preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain)) {
            $this->error('Geçerli bir --domain verin (örn. pazarlama.tonnyblack.com.tr).');

            return self::FAILURE;
        }

        $from = strtolower(trim((string) ($this->option('from') ?: ('bilgi@' . $domain))));
        if (! filter_var($from, FILTER_VALIDATE_EMAIL)) {
            $this->error('Geçersiz --from e-posta adresi.');

            return self::FAILURE;
        }

        $selector = preg_replace('/[^a-z0-9]/', '', strtolower((string) $this->option('selector'))) ?: 'yunbi';
        $ip = trim((string) ($this->option('ip') ?: gethostbyname(gethostname()) ?: ''));
        $settings = $tenant->settings ?? [];

        // Anahtar üret (yoksa veya --force)
        if (empty($settings['email_dkim_private']) || $this->option('force')) {
            $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            if (! $res) {
                $this->error('OpenSSL anahtar üretimi başarısız: ' . openssl_error_string());

                return self::FAILURE;
            }
            openssl_pkey_export($res, $privatePem);
            $publicPem = openssl_pkey_get_details($res)['key'];
            $settings['email_dkim_private'] = Crypt::encryptString($privatePem);
            $settings['email_dkim_public'] = preg_replace('/-----[^-]+-----|\s+/', '', $publicPem); // base64 DER
            $this->info('Yeni DKIM anahtar çifti üretildi (2048-bit RSA).');
        } else {
            $this->line('Mevcut DKIM anahtarı korunuyor (--force ile yenilenebilir).');
        }

        $settings['email_sending_domain'] = $domain;
        $settings['email_sending_ip'] = $ip;
        $settings['email_from_address'] = $from;
        $settings['email_from_name'] = (string) ($this->option('name') ?: $settings['email_from_name'] ?? $tenant->name);
        $settings['email_dkim_selector'] = $selector;
        // email_enabled'ı kullanıcı aktive edene kadar otomatik açma
        $settings['email_enabled'] = $settings['email_enabled'] ?? false;
        $tenant->update(['settings' => $settings]);

        $pub = $settings['email_dkim_public'];
        $this->printDns($domain, $selector, $pub, $ip, $from);

        return self::SUCCESS;
    }

    protected function printDns(string $domain, string $selector, string $pub, string $ip, string $from): void
    {
        $spf = 'v=spf1' . ($ip !== '' ? " ip4:{$ip}" : '') . ' ~all';
        $dkim = 'v=DKIM1; h=sha256; k=rsa; p=' . $pub;
        $dmarc = 'v=DMARC1; p=none; rua=mailto:dmarc@' . $domain;

        $this->newLine();
        $this->info('Gönderici: ' . $from . '  |  DKIM selector: ' . $selector . '  |  Sunucu IP: ' . ($ip ?: 'BELİRSİZ — --ip verin'));
        $this->info('Aşağıdaki 3 DNS kaydını müşterinin DNS yönetimine ekleyin (hepsi TXT):');
        $this->newLine();

        $this->line("1) SPF");
        $this->line("   Tip: TXT   Host: {$domain}");
        $this->line("   Değer: {$spf}");
        $this->newLine();
        $this->line("2) DKIM");
        $this->line("   Tip: TXT   Host: {$selector}._domainkey.{$domain}");
        $this->line("   Değer: {$dkim}");
        $this->newLine();
        $this->line("3) DMARC");
        $this->line("   Tip: TXT   Host: _dmarc.{$domain}");
        $this->line("   Değer: {$dmarc}");
        $this->newLine();
        $this->comment('Kayıtlar yayıldıktan sonra:  php artisan marketing:email-verify --tenant=' . $this->option('tenant'));
        $this->comment('Doğrulanınca panelden email_enabled=true yapıp test gönderin.');
    }
}
