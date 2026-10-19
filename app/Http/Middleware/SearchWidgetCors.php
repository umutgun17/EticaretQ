<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Akıllı Arama storefront widget'ı için CORS + güvenlik geçidi.
 * WidgetCors (reviews) desenini izler ama search_widget_enabled / search_widget_domains
 * kontrol eder ve POST'a (event log) izin verir. Tenant slug ile çözülür; domain whitelist zorunlu.
 */
class SearchWidgetCors
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

        if (! filter_var($settings['search_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return $this->forbidden();
        }

        $allowedDomains = array_filter(array_map('trim', explode(',', $settings['search_widget_domains'] ?? '')));
        if (empty($allowedDomains)) {
            return $this->forbidden();
        }

        $originHost = parse_url($origin, PHP_URL_HOST);
        if (! $originHost) {
            return $this->forbidden();
        }

        // Hub'ın kendi origin'i (demo/test sayfaları) her zaman izinli — merchant'ın
        // domain listesi yalnız KENDİ sitelerini yönetir, demo'yu düşünmek zorunda kalmaz
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $allowed = $hubHost !== '' && strtolower($originHost) === $hubHost;
        foreach ($allowed ? [] : $allowedDomains as $domain) {
            $domain = strtolower(ltrim($domain, '*.'));
            $originHostLower = strtolower($originHost);

            // Çıplak domain, kendisini VE tüm alt alan adlarını kapsar:
            // "tonnyblack.com.tr" → www.tonnyblack.com.tr, m.tonnyblack.com.tr…
            // (merchant tek satır yazar, www'yu düşünmek zorunda kalmaz)
            if ($originHostLower === $domain || str_ends_with($originHostLower, '.' . $domain)) {
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
