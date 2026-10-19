<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\NotFound\TenantNotFoundSettings;
use App\Services\Search\DiscoveryEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** 404 Sayfası storefront API — /w/{slug}/notfound/config|event (NotFoundCors). */
class PublicNotFoundController extends Controller
{
    public const EVENT_TYPES = ['view', 'click', 'search', 'game', 'coupon'];

    public const TARGETS = ['matched', 'product', 'category', 'home', 'logo'];

    /** Kırık URL'den arama sorgusu çıkarırken atılan kelimeler (yol parçaları, Ticimax/ASP.NET artıkları). */
    protected const STOP = ['www', 'http', 'https', 'html', 'aspx', 'php', 'index', 'urun', 'urunler', 'kategori', 'detay', 'pagenotfound',
        'aspxerrorpath', 'utm', 'source', 'medium', 'campaign', 'fbclid', 'gclid', 'tr', 'en', 've', 'ile', 'icin', 'amp', 'page', 'sayfa', 'null', 'undefined'];

    /** GET config?path=/kirik/adres&tpl=space — şablon, metinler, eşleşen + önerilen ürünler, kategoriler. */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $s = TenantNotFoundSettings::get($tenant->id);
        $ts = $tenant->settings ?? [];
        $shop = rtrim((string) ($ts['shop_url'] ?? ''), '/');
        $c = $s['content'];

        // Demo/önizleme: hub sayfası şablonu ve içerik taslağını query ile geçebilir (kaydetmeden önizleme)
        $tpl = $s['template'];
        if ($this->fromHub($request)) {
            $q = (string) $request->query('tpl', '');
            if (in_array($q, TenantNotFoundSettings::TEMPLATES, true)) {
                $tpl = $q;
            }
            $draft = json_decode((string) $request->query('content', ''), true);
            if (is_array($draft)) {
                $c = TenantNotFoundSettings::sanitizeContent(array_merge($c, array_intersect_key($draft, TenantNotFoundSettings::DEFAULT_CONTENT)));
            }
        }

        $matched = [];
        if ($c['show_matched']) {
            $query = self::queryFromPath((string) $request->query('path', ''));
            if ($query !== '') {
                $matched = $this->matched($tenant->id, $query, $shop);
            }
        }
        $exclude = array_column($matched, 'id');
        $rail = $c['show_products'] ? array_values(array_filter($this->rail($tenant->id, $c, $shop), fn ($p) => ! in_array($p['id'], $exclude, true))) : [];

        return response()->json([
            'template' => $tpl,
            'content' => array_diff_key($c, array_flip(['product_ids', 'products_days'])),
            'rules' => array_intersect_key($s['rules'], array_flip(['display', 'mount_selector', 'hide_selectors', 'search_url'])),
            'query' => $query ?? '',
            'matched' => array_slice($matched, 0, 8),
            'products' => array_slice($rail, 0, $c['product_count']),
            'categories' => $c['show_categories'] ? ($c['categories'] ?: $this->autoCategories($tenant->id)) : [],
            'shop_url' => $shop,
            'shop_name' => (string) ($tenant->name ?? ''),
            'logo_url' => self::trimmedLogo((string) ($ts['creative_logo_url'] ?? '')),
        ])->header('Cache-Control', 'private, max-age=120');
    }

    /**
     * Kırık adresten arama sorgusu: /kalin-eva-taban-...-bej-bot-tbgzgn506-9404 → "kalin eva taban ... bej bot tbgzgn506".
     * Sondaki Ticimax kart ID'si ve saf sayılar atılır; ürün kodu (harf+rakam) korunur — silinen ürünün kardeşlerini bulur.
     */
    public static function queryFromPath(string $path): string
    {
        $path = rawurldecode(mb_substr($path, 0, 400));
        // ASP.NET hata yönlendirmesi: /PageNotFound.aspx?aspxerrorpath=/asil-adres
        if (preg_match('~aspxerrorpath=([^&#]+)~i', $path, $m)) {
            $path = rawurldecode($m[1]);
        }
        $path = preg_replace('~[?#].*$~', '', $path) ?? '';
        $words = preg_split('~[^\p{L}\p{N}]+~u', mb_strtolower($path, 'UTF-8'), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $out = [];
        foreach ($words as $w) {
            if (ctype_digit($w) || mb_strlen($w) < 2 || in_array($w, self::STOP, true) || in_array($w, $out, true)) {
                continue;
            }
            $out[] = $w;
        }

        // Ürün kodu (harf+rakam karışık, örn. tbgzgn506) en güçlü sinyal → başa; uzun adreslerde kesilmesin
        usort($out, fn ($a, $b) => (int) self::isCode($b) <=> (int) self::isCode($a));

        return implode(' ', array_slice($out, 0, 10));
    }

    protected static function isCode(string $w): bool
    {
        return mb_strlen($w) >= 4 && preg_match('~\p{L}~u', $w) && preg_match('~\d~', $w);
    }

    /** "Bunu mu arıyordunuz?" — Akıllı Arama motoru (stoklu, görselli). Sorgu başına 6 saat önbellek. */
    protected function matched(int $tenantId, string $query, string $shop): array
    {
        return Cache::remember("notfound:match:{$tenantId}:".md5($query), 6 * 3600, function () use ($tenantId, $query, $shop) {
            try {
                $r = DiscoveryEngine::forTenant($tenantId)->search($query, []);
                $ids = array_slice(array_map(fn ($p) => (int) ($p['id'] ?? 0), $r['results'] ?? []), 0, 16);
            } catch (\Throwable $e) {
                Log::warning('notfound match failed', ['tenant' => $tenantId, 'q' => $query, 'e' => $e->getMessage()]);

                return [];
            }

            return array_slice(self::cards($tenantId, $ids, $shop), 0, 8);
        });
    }

    /** Öneri rafı (çok satan / yeni / elle seçilen) — 10 dk önbellek. */
    protected function rail(int $tenantId, array $c, string $shop): array
    {
        $key = "notfound:rail:{$tenantId}";
        $sig = md5(json_encode([$c['products_source'], $c['products_days'], $c['product_ids']]));
        $hit = Cache::get($key);
        if (is_array($hit) && ($hit['sig'] ?? '') === $sig) {
            return $hit['items'];
        }
        $ids = match ($c['products_source']) {
            'manual' => $c['product_ids'],
            'new' => DB::table('products')->where('tenant_id', $tenantId)->where('is_active', true)->where('stock_quantity', '>', 0)
                ->orderByDesc('platform_created_at')->limit(48)->pluck('id')->all(),
            default => DB::table('order_items as oi')->join('orders as o', 'o.id', '=', 'oi.order_id')
                ->where('o.tenant_id', $tenantId)
                // order_date TR yerel saatle tutulur, uygulama UTC
                ->where('o.order_date', '>=', now('Europe/Istanbul')->subDays($c['products_days'])->format('Y-m-d H:i:s'))
                ->where('o.payment_status', 1)->where('o.status', '<>', 8)->whereNotNull('oi.product_id')
                ->groupBy('oi.product_id')->orderByRaw('sum(oi.quantity) desc')->limit(48)->pluck('oi.product_id')->all(),
        };
        $items = self::cards($tenantId, array_map('intval', $ids), $shop);
        Cache::put($key, ['sig' => $sig, 'items' => $items], 600);

        return $items;
    }

    /**
     * Kreatif logosu çoğu zaman kare tuvalde ince yazı (1024×1024 içinde 993×184) → başlık çubuğunda minicik kalır.
     * Hub'daki PNG'nin şeffaf/düz kenarları bir kez kırpılır (GD), "-trim.png" olarak yanına yazılır.
     */
    public static function trimmedLogo(string $url): string
    {
        $base = rtrim((string) config('app.url'), '/');
        if ($url === '' || ! str_starts_with($url, $base.'/') || ! str_ends_with(strtolower($url), '.png')) {
            return $url;
        }
        $rel = substr($url, strlen($base));
        $src = public_path(ltrim($rel, '/'));
        $dst = preg_replace('~\.png$~i', '-trim.png', $src);
        if (str_contains($rel, '..') || ! is_file($src)) {
            return $url;
        }
        if (! is_file($dst) || filemtime($dst) < filemtime($src)) {
            try {
                $im = @imagecreatefrompng($src);
                $t = $im ? imagecropauto($im, IMG_CROP_SIDES) : false;
                if (! $t) {
                    return $url;
                }
                imagesavealpha($t, true);
                imagepng($t, $dst, 9);
            } catch (\Throwable $e) {
                return $url;
            }
        }

        return $base.preg_replace('~\.png$~i', '-trim.png', $rel);
    }

    /** Hafif ürün kartı (stoksuz/görselsiz elenir, sıra korunur). */
    public static function cards(int $tenantId, array $ids, string $shop): array
    {
        if (! $ids) {
            return [];
        }
        $out = [];
        foreach (PublicHeroController::resolveProducts($tenantId, $ids, $shop) as $p) {
            if (! $p['in_stock']) {
                continue;
            }
            $out[] = array_intersect_key($p, array_flip(['id', 'pid', 'name', 'url', 'price', 'dprice', 'discount_pct', 'img', 'rating']));
        }

        return $out;
    }

    /** Kategori kısayolları: 1. seviye, en çok ürünlü, kampanya (TAMAMI BÜYÜK HARF) adları hariç. */
    protected function autoCategories(int $tenantId): array
    {
        return Cache::remember("notfound:cats:{$tenantId}", 3600, function () use ($tenantId) {
            $rows = DB::table('platform_categories')->where('tenant_id', $tenantId)->where('is_active', true)->where('depth', 1)
                ->whereNotNull('url')->where('product_count', '>', 0)->orderByDesc('product_count')->limit(20)->get(['name', 'url']);
            $out = [];
            foreach ($rows as $r) {
                if (mb_strtoupper($r->name, 'UTF-8') === $r->name) {
                    continue;
                }
                $out[] = ['name' => $r->name, 'url' => $r->url];
                if (count($out) >= 6) {
                    break;
                }
            }

            return $out;
        });
    }

    public function event(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['ok' => false], 404);
        }
        if (! $request->isJson() && $request->getContent() !== '') {
            $decoded = json_decode($request->getContent(), true);
            if (is_array($decoded)) {
                $request->merge($decoded);
            }
        }
        $type = (string) $request->input('type', '');
        if (! in_array($type, self::EVENT_TYPES, true)) {
            return response()->json(['ok' => false], 422);
        }
        $target = (string) $request->input('target', '');
        $tpl = (string) $request->input('template', '');

        DB::table('notfound_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) $request->input('sid', '')), 0, 64) ?: null,
            'type' => $type,
            'template' => in_array($tpl, TenantNotFoundSettings::TEMPLATES, true) ? $tpl : null,
            'target' => in_array($target, self::TARGETS, true) ? $target : null,
            'product_id' => mb_substr(preg_replace('/[^0-9]/', '', (string) $request->input('product_id', '')), 0, 32) ?: null,
            'query' => mb_substr(trim((string) $request->input('query', '')), 0, 120) ?: null,
            'page_path' => mb_substr((string) $request->input('path', ''), 0, 300) ?: null,
            'referrer' => mb_substr((string) $request->input('ref', ''), 0, 300) ?: null,
            'matched' => $type === 'view' ? max(0, min(99, (int) $request->input('matched', 0))) : null,
            'device' => in_array($request->input('device'), ['m', 'd'], true) ? $request->input('device') : null,
            'is_test' => $this->fromHub($request),
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }

    protected function fromHub(Request $request): bool
    {
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));

        return $src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost;
    }
}
