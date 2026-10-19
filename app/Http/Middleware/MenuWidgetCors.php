<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Akıllı Menü (CRO) storefront widget'ı için CORS geçidi — BottomBarCors deseni (menu_enabled / menu_domains). */
class MenuWidgetCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');
        $slug = $request->route('slug');

        if (! $origin) {
            $response = $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
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
        if (! filter_var($settings['menu_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }
        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['menu_domains'] ?? '')));
        $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
        if (! $originHost) {
            return $this->forbidden();
        }
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $allowed = $hubHost !== '' && $originHost === $hubHost;
        foreach ($allowed ? [] : $allowedDomains as $domain) {
            $domain = strtolower(ltrim($domain, '*.'));
            if ($originHost === $domain || str_ends_with($originHost, '.'.$domain)) {
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

        return $response;
    }

    private function forbidden(): Response
    {
        return response()->json(['error' => 'forbidden'], 403);
    }
}
