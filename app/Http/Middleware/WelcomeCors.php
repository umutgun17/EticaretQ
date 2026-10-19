<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * "Hoş geldin" ilk alışveriş hediyesi (CRO) CORS'u — NotFoundCors ile aynı model:
 * tenant slug + welcome_enabled + domain whitelist (hub'ın kendi origin'i her zaman izinli; olaylar is_test).
 */
class WelcomeCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');
        $slug = $request->route('slug');

        if (! $origin) {
            $response = $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('X-Frame-Options', 'DENY');

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

        $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
        $hub = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        if ($hub !== '' && $originHost === $hub) {
            return $this->allow($request, $next, $origin);
        }
        if ($originHost === '' || ! filter_var($settings['welcome_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }
        $allowed = false;
        foreach (array_filter(array_map('trim', explode(',', (string) ($settings['welcome_domains'] ?? '')))) as $domain) {
            $domain = strtolower(ltrim($domain, '*.'));
            if ($originHost === $domain || str_ends_with($originHost, '.'.$domain)) {
                $allowed = true;
                break;
            }
        }
        if (! $allowed) {
            return $this->forbidden();
        }

        return $this->allow($request, $next, $origin);
    }

    private function allow(Request $request, Closure $next, string $origin): Response
    {
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
