<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Çark (Spin-to-Win) public widget uçları için CORS + güvenlik başlıkları.
 *
 * Review widget'ından farkı: çark `spin` ucu POST kullanır (lead + KVKK gönderimi), bu yüzden
 * Allow-Methods POST içerir. Origin, tenant'ın kendi ayarladığı domain whitelist'ine
 * (tenant.settings['wheel_widget_domains']) göre doğrulanır → keyfi sitelerden çağrı engellenir.
 *
 * Origin başlığı yoksa (curl / sunucu-içi / aynı-origin test) geçişe izin verilir ama embed
 * engelleme başlıkları eklenir.
 */
class WheelCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');
        $slug = $request->route('slug');

        // Origin yok → tarayıcı dışı / aynı-origin. Geçir, embed engelle.
        if (! $origin) {
            $response = $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('X-Frame-Options', 'DENY');

            return $response;
        }

        // Kendi panel/önizleme origin'imiz (hub, aynı host) → her zaman izin (Yunbi üzerinde test için)
        $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
        if ($originHost && $originHost === strtolower($request->getHost())) {
            $response = $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Accept');
            $response->headers->set('Vary', 'Origin');
            $response->headers->set('X-Content-Type-Options', 'nosniff');

            return $response;
        }

        if (! $slug) {
            return $this->forbidden();
        }

        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return $this->forbidden();
        }

        $settings = $tenant->settings ?? [];

        // Widget tenant tarafından açık olmalı
        if (! filter_var($settings['wheel_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }

        // Domain whitelist ZORUNLU — boşsa erişim yok
        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['wheel_widget_domains'] ?? '')));
        if (empty($allowedDomains)) {
            return $this->forbidden();
        }

        $originHost = parse_url($origin, PHP_URL_HOST);
        if (! $originHost) {
            return $this->forbidden();
        }
        $originHost = strtolower($originHost);
        // www. apex ile aynı siteyi gösterir → eşleştirmede normalize et (her iki yön).
        $stripWww = static fn (string $h): string => str_starts_with($h, 'www.') ? substr($h, 4) : $h;
        $originBare = $stripWww($originHost);

        $allowed = false;
        foreach ($allowedDomains as $domain) {
            $domain = strtolower($domain);
            if (str_starts_with($domain, '*.')) {
                $base = substr($domain, 2);
                if ($originHost === $base || str_ends_with($originHost, '.' . $base)) {
                    $allowed = true;
                    break;
                }
            } elseif ($originHost === $domain || $originBare === $stripWww($domain)) {
                $allowed = true;
                break;
            }
        }

        if (! $allowed) {
            return $this->forbidden();
        }

        $response = $request->isMethod('OPTIONS') ? response('', 204) : $next($request);

        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Accept');
        $response->headers->set('Access-Control-Max-Age', '86400');
        $response->headers->set('Vary', 'Origin');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');

        return $response;
    }

    private function forbidden(): Response
    {
        return response()->json(['error' => 'forbidden'], 403);
    }
}
