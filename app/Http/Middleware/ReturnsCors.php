<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * İade/İptal public uçları için CORS + güvenlik başlıkları.
 *
 * Bu uçlar çerez/oturum KULLANMAZ; kimlik, lookup'ta verilen açık bilgiler (order_no +
 * email/telefon) ve sonrasında şifreli token ile sağlanır. Dolayısıyla klasik CSRF vektörü
 * yoktur. Yine de:
 *  - Sayfa iframe içine gömülemesin diye X-Frame-Options: DENY.
 *  - Credentials (çerez) İZİN VERİLMEZ.
 *  - Origin yansıtılır; canlı dağıtımda tenant bazlı origin whitelist'e daraltılacak (TODO).
 */
class ReturnsCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');

        if ($request->isMethod('OPTIONS')) {
            $response = response('', 204);
        } else {
            $response = $next($request);
        }

        if ($origin) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Vary', 'Origin');
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Accept');
            $response->headers->set('Access-Control-Max-Age', '86400');
            // Access-Control-Allow-Credentials BİLEREK ayarlanmıyor (çerez yok).
        }

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');

        return $response;
    }
}
