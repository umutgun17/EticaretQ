<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Marketing\EmailDnsRecords;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Pazarlama e-posta gönderim kimliği — panel (gönderici, DNS kayıtları, doğrulama).
 * permission:settings. DKIM özel anahtarı asla dönmez.
 */
class MarketingEmailController extends Controller
{
    /** GET — gönderim yapılandırması + eklenecek DNS kayıtları (canlı doğrulama yapmadan). */
    public function sending(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $s = $tenant->settings ?? [];

        return response()->json([
            'config' => $this->config($s),
            'records' => EmailDnsRecords::records($s),
        ]);
    }

    /** POST — DNS kayıtlarını canlı kontrol et. */
    public function verify(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $s = $tenant->settings ?? [];
        if (trim((string) ($s['email_sending_domain'] ?? '')) === '') {
            return response()->json(['message' => 'Önce gönderim domaini kurulmalı (marketing:email-setup).'], 422);
        }

        return response()->json(EmailDnsRecords::verify($s));
    }

    /** GET — gönderici bilgileri (SMS başlığı + e-posta gönderen). */
    public function senderInfo(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $s = $tenant->settings ?? [];

        return response()->json([
            'sms_header' => $s['sms_header'] ?? null,
            'email_from_address' => $s['email_from_address'] ?? null,
            'email_from_name' => $s['email_from_name'] ?? null,
            'sending_domain' => $s['email_sending_domain'] ?? null,
        ]);
    }

    /** PUT — gönderici bilgilerini güncelle. */
    public function updateSender(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $request->validate([
            'sms_header' => 'nullable|string|max:11',          // NetGSM başlık limiti
            'email_from_name' => 'nullable|string|max:100',
            'email_from_address' => 'nullable|email|max:150',
        ]);

        $s = $tenant->settings ?? [];
        $sendingDomain = trim((string) ($s['email_sending_domain'] ?? ''));

        // E-posta adresi değişiyorsa: DKIM hizası bozulmasın → gönderim domaininde olmalı
        if (! empty($data['email_from_address']) && $sendingDomain !== '') {
            $domain = strtolower(substr(strrchr($data['email_from_address'], '@'), 1));
            if ($domain !== strtolower($sendingDomain)) {
                return response()->json([
                    'message' => "E-posta adresi gönderim domaininde olmalı (@{$sendingDomain}). DKIM imzası için zorunlu.",
                ], 422);
            }
        }

        foreach (['sms_header', 'email_from_name', 'email_from_address'] as $k) {
            if (array_key_exists($k, $data) && $data[$k] !== null) {
                $s[$k] = $data[$k];
            }
        }
        $tenant->update(['settings' => $s]);

        return response()->json([
            'sms_header' => $s['sms_header'] ?? null,
            'email_from_address' => $s['email_from_address'] ?? null,
            'email_from_name' => $s['email_from_name'] ?? null,
        ]);
    }

    /** POST — e-posta kanalını aç/kapat (DNS doğrulanmış olmalı önerilir). */
    public function toggle(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $enabled = (bool) $request->boolean('enabled');
        $s = $tenant->settings ?? [];

        if ($enabled && trim((string) ($s['email_from_address'] ?? '')) === '') {
            return response()->json(['message' => 'Önce gönderici adresi/DKIM kurulmalı.'], 422);
        }

        $s['email_enabled'] = $enabled;
        $tenant->update(['settings' => $s]);

        return response()->json(['email_enabled' => $enabled]);
    }

    /** @return array<string,mixed> */
    protected function config(array $s): array
    {
        return [
            'sending_domain' => $s['email_sending_domain'] ?? null,
            'from_address' => $s['email_from_address'] ?? null,
            'from_name' => $s['email_from_name'] ?? null,
            'selector' => $s['email_dkim_selector'] ?? null,
            'ip' => $s['email_sending_ip'] ?? null,
            'enabled' => (bool) ($s['email_enabled'] ?? false),
            'configured' => ! empty($s['email_dkim_public']) && ! empty($s['email_sending_domain']),
        ];
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        $user = $request->user();
        if ($user->tenant_id) {
            return $user->tenant;
        }
        if ($request->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) $request->header('X-Tenant-Id'));
        }

        return null;
    }
}
