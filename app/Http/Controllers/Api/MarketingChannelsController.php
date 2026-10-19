<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Models\Tenant;
use App\Services\WhatsAppService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Pazarlama kanalları — birleşik ayar paneli (e-posta / SMS / WhatsApp / web push).
 * Her kanalın aç/kapa + kendi ayarları. permission:settings.
 */
class MarketingChannelsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        return response()->json($this->payload($tenant));
    }

    public function update(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $s = $tenant->settings ?? [];
        $in = $request->all();

        // E-posta
        if (isset($in['email'])) {
            $e = $in['email'];
            if (array_key_exists('enabled', $e)) {
                $s['email_enabled'] = (bool) $e['enabled'];
            }
            if (array_key_exists('from_name', $e)) {
                $s['email_from_name'] = (string) $e['from_name'];
            }
            if (! empty($e['from_address'])) {
                $domain = strtolower(substr(strrchr($e['from_address'], '@') ?: '@', 1));
                $sending = strtolower((string) ($s['email_sending_domain'] ?? ''));
                if ($sending !== '' && $domain !== $sending) {
                    return response()->json(['message' => "E-posta adresi gönderim domaininde olmalı (@{$sending})."], 422);
                }
                $s['email_from_address'] = (string) $e['from_address'];
            }
        }

        // SMS
        if (isset($in['sms'])) {
            if (array_key_exists('enabled', $in['sms'])) {
                $s['sms_enabled'] = (bool) $in['sms']['enabled'];
            }
            if (array_key_exists('header', $in['sms'])) {
                $s['sms_header'] = mb_substr((string) $in['sms']['header'], 0, 11);
            }
        }

        // WhatsApp
        if (isset($in['whatsapp']) && array_key_exists('enabled', $in['whatsapp'])) {
            $s['whatsapp_enabled'] = (bool) $in['whatsapp']['enabled'];
        }

        // Web Push
        if (isset($in['push'])) {
            $p = $in['push'];
            if (array_key_exists('enabled', $p)) {
                $s['push_enabled'] = (bool) $p['enabled'];
            }
            if (array_key_exists('domains', $p)) {
                $s['push_domains'] = (string) $p['domains'];
            }
            foreach (['title', 'body', 'allow', 'deny', 'color', 'position'] as $k) {
                if (isset($p['prompt'][$k])) {
                    $s["push_prompt_{$k}"] = (string) $p['prompt'][$k];
                }
            }
            foreach (['delay', 'snooze_days'] as $k) {
                if (isset($p['prompt'][$k])) {
                    $s["push_prompt_{$k}"] = (int) $p['prompt'][$k];
                }
            }
        }

        $tenant->update(['settings' => $s]);

        return response()->json($this->payload($tenant->fresh()));
    }

    /** @return array<string,mixed> */
    protected function payload(Tenant $tenant): array
    {
        $s = $tenant->settings ?? [];
        $base = rtrim((string) config('app.url'), '/');
        $slug = $tenant->slug;

        // WhatsApp kanal/phone_number_id durumu
        $waCh = Channel::withoutGlobalScopes()->where('tenant_id', $tenant->id)
            ->where(fn ($q) => $q->where('type', 'like', '%whatsapp%')->orWhere('type', 'like', 'meta%'))
            ->where('is_active', true)->first();
        $waSvc = new WhatsAppService();
        $waConfigured = $waCh && $waSvc->getAccessToken($waCh->credentials ?? []) && $waSvc->getPhoneNumberId($waCh->settings ?? []);

        // NetGSM kanal durumu
        $smsCh = Channel::withoutGlobalScopes()->where('tenant_id', $tenant->id)
            ->where('type', 'like', 'netgsm%')->where('is_active', true)->exists();

        return [
            'email' => [
                'enabled' => (bool) ($s['email_enabled'] ?? false),
                'from_name' => $s['email_from_name'] ?? null,
                'from_address' => $s['email_from_address'] ?? null,
                'sending_domain' => $s['email_sending_domain'] ?? null,
                'dkim_ready' => ! empty($s['email_dkim_public']),
            ],
            'sms' => [
                'enabled' => (bool) ($s['sms_enabled'] ?? false),
                'header' => $s['sms_header'] ?? null,
                'connected' => (bool) $smsCh,
            ],
            'whatsapp' => [
                'enabled' => (bool) ($s['whatsapp_enabled'] ?? false),
                'configured' => (bool) $waConfigured,
            ],
            'push' => [
                'enabled' => (bool) ($s['push_enabled'] ?? false),
                'domains' => $s['push_domains'] ?? '',
                'prompt' => [
                    'title' => $s['push_prompt_title'] ?? 'bildirim göndermek istiyor',
                    'body' => $s['push_prompt_body'] ?? 'İndirim ve kampanyalardan haberdar ol',
                    'allow' => $s['push_prompt_allow'] ?? 'İzin Ver',
                    'deny' => $s['push_prompt_deny'] ?? 'Engelle',
                    'color' => $s['push_prompt_color'] ?? '#4f46e5',
                    'position' => $s['push_prompt_position'] ?? 'top-left',
                    'delay' => (int) ($s['push_prompt_delay'] ?? 4),
                    'snooze_days' => (int) ($s['push_prompt_snooze_days'] ?? 7),
                ],
                'embed_script' => '<script src="' . $base . '/widget/push.js?v=6" data-tenant="' . $slug . '" data-sw="/yunbi-push-sw.js"></script>',
                'sw_file' => 'yunbi-push-sw.js',
                'sw_content' => "importScripts('" . $base . "/widget/push-sw.js')",
            ],
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
