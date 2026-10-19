<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Web Push public uçları için CORS + güvenlik. Çark (WheelCors) ile aynı mantık:
 * Origin, tenant'ın ayarladığı domain whitelist'ine (tenant.settings['push_domains'])
 * göre doğrulanır ve push tenant tarafından açık (push_enabled) olmalıdır.
 * Böylece sadece tenant'ın kendi onayladığı alan adlarından token toplanır.
 *
 * Origin yoksa (curl / aynı-origin test) ya da origin = panel host'umuz ise geçilir.
 */
class PushCors
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

        // Kendi panel/önizleme origin'imiz (hub, aynı host) → her zaman izin (test için)
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

        // Push tenant tarafından açık olmalı
        if (! filter_var($settings['push_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }

        // Domain whitelist ZORUNLU — boşsa erişim yok
        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['push_domains'] ?? '')));
        if (empty($allowedDomains)) {
            return $this->forbidden();
        }

        if (! $originHost) {
            return $this->forbidden();
        }
        // www. apex ile aynı siteyi gösterir → eşleştirmede normalize et.
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
