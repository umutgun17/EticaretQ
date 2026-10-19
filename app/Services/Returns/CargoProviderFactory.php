<?php

namespace App\Services\Returns;

use App\Contracts\CargoProviderInterface;
use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Models\Tenant;

/**
 * Tenant'ın iade kargo sağlayıcısını seçer ve yapılandırılmış servis döner.
 *
 * Seçim: tenant.settings['returns_integrations']['cargo_provider'] ('surat-kargo' | 'dhl-kargo');
 * ayar yoksa 'surat-kargo' (mevcut tenant 1 davranışı birebir korunur — Tonny Black'te
 * bu anahtar hiç yazılmadı ve akış değişmemeli).
 *
 * Config birleştirme deseni eski suratFor() kopyalarıyla aynı: config/returns.php
 * integrations.{key} + tenant.settings['returns_integrations'][key] (array_replace_recursive).
 * Kimlik ayrıca opsiyonel kanaldan da (type = provider key) okunabilir — Sürat'ta kanal
 * kullanılmıyor (kimlik tenant ayarında), DHL'de de aynı desen geçerli.
 */
class CargoProviderFactory
{
    public const PROVIDERS = ['surat-kargo', 'dhl-kargo'];

    public const DEFAULT_PROVIDER = 'surat-kargo';

    /** Tenant'ın seçili kargo sağlayıcı anahtarı ('surat-kargo' | 'dhl-kargo'). */
    public static function providerKeyFor(?Tenant $tenant): string
    {
        $key = (string) ($tenant?->settings['returns_integrations']['cargo_provider'] ?? '');

        return in_array($key, self::PROVIDERS, true) ? $key : self::DEFAULT_PROVIDER;
    }

    public static function forTenant(?Tenant $tenant): CargoProviderInterface
    {
        $key = self::providerKeyFor($tenant);
        $cfgKey = str_replace('-', '_', $key); // surat-kargo → surat_kargo

        $cfg = (array) config('returns.integrations.' . $cfgKey, []);
        $tenantCfg = $tenant?->settings['returns_integrations'][$cfgKey] ?? [];
        if (is_array($tenantCfg) && $tenantCfg) {
            $cfg = array_replace_recursive($cfg, $tenantCfg);
        }

        $channel = $tenant ? Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('type', $key)
            ->where('is_active', true)
            ->first() : null;

        return match ($key) {
            'dhl-kargo' => DhlKargoService::fromChannel($channel, $cfg),
            default => SuratKargoService::fromChannel($channel, $cfg),
        };
    }

    public static function forRequest(ReturnRequest $r): CargoProviderInterface
    {
        return self::forTenant($r->tenant);
    }

    /** Sağlayıcı anahtarı → müşteriye gösterilen ad (SMS {kargo} + panel etiketi). */
    public static function displayName(?string $providerKey): string
    {
        return match ($providerKey) {
            'dhl-kargo' => 'DHL Kargo',
            'surat-kargo', 'surat' => 'Sürat Kargo',
            default => 'Kargo',
        };
    }
}
