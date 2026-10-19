<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class WidgetCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');
        $slug = $request->route('slug');

        // No origin header = direct server-to-server or same-origin (non-browser)
        // Block these too unless it's a health check — widget is browser-only
        if (! $origin) {
            // Allow requests without Origin header (curl, server-side, same-origin nav)
            // but add security headers to prevent embedding
            $response = $request->isMethod('OPTIONS')
                ? response('', 204)
                : $next($request);

            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('X-Frame-Options', 'DENY');

            return $response;
        }

        // Resolve tenant and validate domain whitelist
        if (! $slug) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return $this->forbidden();
        }

        $settings = $tenant->settings ?? [];

        // Widget must be enabled
        if (! filter_var($settings['review_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }

        // Domain whitelist is REQUIRED — no whitelist = no access
        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['review_widget_domains'] ?? '')));
        if (empty($allowedDomains)) {
            return $this->forbidden();
        }

        // Check if origin matches any allowed domain
        $originHost = parse_url($origin, PHP_URL_HOST);
        if (! $originHost) {
            return $this->forbidden();
        }

        $allowed = false;
        foreach ($allowedDomains as $domain) {
            $domain = strtolower($domain);
            $originHostLower = strtolower($originHost);

            // Support wildcard: *.example.com
            if (str_starts_with($domain, '*.')) {
                $baseDomain = substr($domain, 2);
                if ($originHostLower === $baseDomain || str_ends_with($originHostLower, '.' . $baseDomain)) {
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

        // Preflight
        if ($request->isMethod('OPTIONS')) {
            $response = response('', 204);
        } else {
            $response = $next($request);
        }

        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
