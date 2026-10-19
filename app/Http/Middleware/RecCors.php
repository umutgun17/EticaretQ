<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sepet Önerisi (Ürün Öneri) widget'ı için CORS.
 * ShippingCors ile aynı model: tenant slug + rec_cart_enabled + domain whitelist.
 */
class RecCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');

        // Origin yoksa (curl, same-origin) — engelleme ama gömmeye karşı başlık ekle
        if (! $origin) {
            $response = $request->isMethod('OPTIONS')
                ? response('', 204)
                : $next($request);

            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('X-Frame-Options', 'DENY');

            return $response;
        }

        $slug = $request->route('slug');
        if (! $slug) {
            return $this->forbidden();
        }

        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return $this->forbidden();
        }

        $settings = $tenant->settings ?? [];

        if (! filter_var($settings['rec_cart_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }

        // Domain whitelist ZORUNLU — boş whitelist = erişim yok
        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['rec_widget_domains'] ?? '')));
        if (empty($allowedDomains)) {
            return $this->forbidden();
        }

        $originHost = parse_url($origin, PHP_URL_HOST);
        if (! $originHost) {
            return $this->forbidden();
        }

        // Hub'ın kendi origin'i (demo/test sayfaları) her zaman izinli — event'leri
        // isTestTraffic zaten is_test=true işaretler, analitik kirlenmez.
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $allowed = $hubHost !== '' && strtolower($originHost) === $hubHost;
        foreach ($allowedDomains as $domain) {
            $domain = strtolower($domain);
            $originHostLower = strtolower($originHost);

            if (str_starts_with($domain, '*.')) {
                $baseDomain = substr($domain, 2);
                if ($originHostLower === $baseDomain || str_ends_with($originHostLower, '.'.$baseDomain)) {
                    $allowed = true;
                    break;
                }
            } elseif ($originHostLower === $domain) {
                $allowed = true;
                break;
            }
        }

        if (! $allowed) {
            return $this->forbidden();
        }

        if ($request->isMethod('OPTIONS')) {
            $response = response('', 204);
        } else {
            $response = $next($request);
        }

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
