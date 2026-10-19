<?php

namespace App\Console\Commands;

use App\Services\Marketing\UnifiedSender;
use Illuminate\Console\Command;

/**
 * Pazarlama Otomasyonu — kanal gönderim testi.
 *
 * Örnek:
 *   php artisan marketing:send-test --tenant=1 --channel=sms \
 *       --to=+905435285600 --message="Yunbi test" --header="Tonny Black"
 *
 * Kapılar (consent/sessiz saat/frekans) test için atlanır (skip_gates).
 */
class MarketingSendTest extends Command
{
    protected $signature = 'marketing:send-test
        {--tenant= : Tenant ID}
        {--channel=sms : Kanal (sms|email|whatsapp|push)}
        {--to= : Alıcı (telefon/e-posta)}
        {--message= : Mesaj metni}
        {--subject= : E-posta konusu (email kanalı için zorunlu)}
        {--header= : SMS gönderici başlığı (msgheader)}';

    protected $description = 'Pazarlama kanalları üzerinden test mesajı gönderir (Unified Sender)';

    public function handle(UnifiedSender $sender): int
    {
        $tenantId = (int) $this->option('tenant');
        $channel = (string) $this->option('channel');
        $to = (string) $this->option('to');
        $body = (string) $this->option('message');

        if (! $tenantId || ! $to || $body === '') {
            $this->error('--tenant, --to ve --message zorunludur.');

            return self::FAILURE;
        }

        $message = ['body' => $body];
        if ($this->option('header')) {
            $message['header'] = (string) $this->option('header');
        }
        if ($this->option('subject')) {
            $message['subject'] = (string) $this->option('subject');
        }

        $this->info("Gönderiliyor → tenant={$tenantId} kanal={$channel} alıcı={$to}");

        $log = $sender->send($tenantId, $channel, $to, $message, [
            'source' => 'test',
            'source_type' => 'test',
            'skip_gates' => true,
        ]);

        $this->line('');
        $this->table(['Alan', 'Değer'], [
            ['log_id', $log->id],
            ['status', $log->status],
            ['skip_reason', $log->skip_reason ?? '-'],
            ['provider', $log->provider ?? '-'],
            ['provider_message_id', $log->provider_message_id ?? '-'],
            ['error', $log->error ?? '-'],
        ]);

        return $log->status === 'sent' ? self::SUCCESS : self::FAILURE;
    }
}
