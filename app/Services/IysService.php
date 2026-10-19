<?php

namespace App\Services;

use App\Models\Channel;
use App\Models\Tenant;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Netgsm İYS (İleti Yönetim Sistemi) istemcisi + modül ayarları.
 *
 * Resmî netgsm/netiys paketiyle aynı API sözleşmesi: POST {base}/iys/add,
 * gövde: header{username,password,brandCode} + body.data{type,source,recipient,
 * recipientType,status,consentDate,refid?}. Kimlik bilgisi tenant'ın kendi SMS
 * kanalından (NetgsmService ile aynı kaynak) okunur — Tonny Black'in kendi
 * Netgsm/İYS hesabı.
 *
 * KURAL (ürün kararı): consentDate DAİMA gönderim anıdır — geçmiş tarih asla gönderilmez.
 */
class IysService
{
    protected array $auth = [];
    protected string $baseUrl = 'https://api.netgsm.com.tr';

    public const DEFAULT_SETTINGS = [
        'enabled' => false,
        'daily_target' => 100,      // panelden; gerçek günlük kota = hedef ±%25 (güne göre deterministik)
        'window_start' => '09:30',
        'window_end' => '21:30',
        'brand_code' => '',
        'recipient_type' => 'BIREYSEL',
        'source' => 'HS_WEB',
    ];

    public static function fromTenant(Tenant $tenant): self
    {
        $i = new self();
        // SmsDriver ile aynı kaynak: netgsm* kanalı (ör. netgsm-call), yoksa sms kanalı
        $ch = Channel::where('tenant_id', $tenant->id)->where('type', 'like', 'netgsm%')->where('is_active', true)->first()
            ?? Channel::where('tenant_id', $tenant->id)->where('type', 'sms')->where('is_active', true)->first();
        $creds = $ch?->credentials ?? [];
        $i->auth = [
            'username' => (string) ($creds['netgsm_usercode'] ?? ''),
            'password' => (string) ($creds['netgsm_password'] ?? ''),
            'brandCode' => (string) (self::settings($tenant)['brand_code'] ?: ($creds['netgsm_brandcode'] ?? '')),
        ];

        return $i;
    }

    public static function settings(Tenant $tenant): array
    {
        return array_merge(self::DEFAULT_SETTINGS, (array) ($tenant->settings['iys'] ?? []));
    }

    public function isConfigured(): bool
    {
        return $this->auth !== [] && $this->auth['username'] !== '' && $this->auth['password'] !== '' && $this->auth['brandCode'] !== '';
    }

    public function missingConfig(): array
    {
        $m = [];
        if (($this->auth['username'] ?? '') === '' || ($this->auth['password'] ?? '') === '') {
            $m[] = 'netgsm_credentials';
        }
        if (($this->auth['brandCode'] ?? '') === '') {
            $m[] = 'brand_code';
        }

        return $m;
    }

    /**
     * Günün kotası: hedef ±%25, (tenant, gün) ikilisine göre deterministik —
     * gün içindeki her çalıştırma aynı sayıyı görür, ertesi gün değişir.
     */
    public static function dailyQuota(int $tenantId, int $target, ?string $date = null): int
    {
        if ($target <= 0) {
            return 0;
        }
        $date = $date ?: now()->toDateString();
        $frac = (crc32($tenantId.'|iys|'.$date) % 1000) / 1000; // 0..0.999

        return max(1, (int) round($target * (0.75 + $frac * 0.5))); // %75..%125
    }

    /**
     * Tek izin kaydı gönderir. consentDate = ŞU AN (gönderim anı).
     *
     * @param string $type      ARAMA | MESAJ | EPOSTA
     * @param string $recipient 905XXXXXXXXX (+ öneki burada eklenir) veya e-posta
     * @return array{ok:bool, code:?string, raw:mixed, error:?string}
     */
    public function addConsent(string $type, string $recipient, string $recipientType = 'BIREYSEL', string $source = 'HS_WEB', ?string $refid = null): array
    {
        if (! $this->isConfigured()) {
            return ['ok' => false, 'code' => null, 'raw' => null, 'error' => 'iys_not_configured: '.implode(',', $this->missingConfig())];
        }

        if ($type !== 'EPOSTA') {
            $recipient = '+'.ltrim($recipient, '+');
        }

        $data = [
            'type' => $type,
            'source' => $source,
            'recipient' => $recipient,
            'recipientType' => $recipientType,
            'status' => 'ONAY',
            'consentDate' => now()->format('Y-m-d H:i:s'),
        ];
        if ($refid !== null) {
            $data['refid'] = $refid;
        }

        try {
            $res = Http::timeout(20)->post($this->baseUrl.'/iys/add', [
                'header' => $this->auth,
                'body' => ['data' => $data],
            ]);

            $json = $res->json();
            $code = is_array($json) ? (string) ($json['code'] ?? '') : '';
            // Gerçek yanıt şeması (25 Ağu canlı test): {"code":"0","error":"false","uid":"..."}
            $ok = $res->successful()
                && strtolower((string) ($json['error'] ?? 'false')) !== 'true'
                && (
                    in_array($code, ['0', '00'], true)
                    || strtolower((string) ($json['resultstatus'] ?? '')) === 'success'
                    || ! empty($json['submitid'])
                    || ! empty($json['uid'])
                );

            if (! $ok) {
                Log::warning('IYS addConsent failed', ['type' => $type, 'status' => $res->status(), 'body' => substr($res->body(), 0, 500)]);
            }

            return [
                'ok' => $ok,
                'code' => $code !== '' ? $code : (string) $res->status(),
                'raw' => $json ?? substr($res->body(), 0, 500),
                'error' => $ok ? null : ('http_'.$res->status().' '.substr($res->body(), 0, 300)),
            ];
        } catch (\Throwable $e) {
            Log::error('IYS addConsent exception', ['type' => $type, 'err' => $e->getMessage()]);

            return ['ok' => false, 'code' => null, 'raw' => null, 'error' => substr($e->getMessage(), 0, 300)];
        }
    }
}
