<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Beden Seçimi (CRO): ürün detayda varsayılan beden seçimini kaldırır ve adresteki parametreyle (?beden=38)
 * bedeni seçili açar. Panel ayarları + mağaza betiğinin (widget/variant.js) okuduğu genel ayar ucu.
 * Ayarlar tenant.settings içinde: variant_select_enabled / _deselect / _param / _feed_links.
 */
class VariantSelectController extends Controller
{
    public const DEFAULT_PARAM = 'beden';

    /** @return array{enabled:bool, deselect:bool, param:string, feed_links:bool} */
    public static function settingsFor(?Tenant $tenant): array
    {
        $s = $tenant?->settings ?? [];
        $param = (string) ($s['variant_select_param'] ?? self::DEFAULT_PARAM);

        return [
            'enabled' => filter_var($s['variant_select_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'deselect' => filter_var($s['variant_select_deselect'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'param' => preg_match('/^[a-z][a-z0-9_]{1,19}$/', $param) ? $param : self::DEFAULT_PARAM,
            'feed_links' => filter_var($s['variant_select_feed_links'] ?? false, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    protected function tenant(): ?Tenant
    {
        $user = auth()->user();
        if ($user && $user->tenant_id) {
            return $user->tenant;
        }
        $id = request()->header('X-Tenant-Id');

        return $id ? Tenant::find((int) $id) : null;
    }

    protected function payload(Tenant $tenant): array
    {
        $ts = $tenant->settings ?? [];
        // Beden düzeyinde (her beden ayrı satır) üretilen Google feed'i var mı — link parametresi yalnız orada anlamlı
        $feed = null; // Google feed modülü bu üründe yok

        return self::settingsFor($tenant) + [
            'ui' => \App\Services\Cro\VariantUiService::settings($tenant),
            'ui_defaults' => \App\Services\Cro\VariantUiService::DEFAULTS,
            'slug' => $tenant->slug,
            'base_url' => rtrim((string) config('app.url'), '/'),
            'shop_url' => rtrim((string) ($ts['storefront_url'] ?? ($ts['shop_url'] ?? '')), '/'),
            'has_variant_feed' => (bool) $feed,
            'feed_rows' => $feed?->product_count,
        ];
    }

    public function settings(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }

        return response()->json($this->payload($tenant));
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'deselect' => 'sometimes|boolean',
            'param' => ['sometimes', 'string', 'regex:/^[a-z][a-z0-9_]{1,19}$/'],
            'feed_links' => 'sometimes|boolean',
        ] + \App\Services\Cro\VariantUiService::rules(), [
            'param.regex' => 'Parametre adı küçük harfle başlamalı; yalnız küçük harf, rakam ve alt çizgi (2–20 karakter).',
            'ui.colors.accent.regex' => 'Renk #RRGGBB biçiminde olmalı.',
            'ui.low_stock.color.regex' => 'Renk #RRGGBB biçiminde olmalı.',
        ]);

        $ui = $data['ui'] ?? null;
        unset($data['ui']);
        $settings = $tenant->settings ?? [];
        foreach ($data as $k => $v) {
            $settings['variant_select_'.$k] = $v;
        }
        $tenant->update(['settings' => $settings]);
        if (is_array($ui)) {
            \App\Services\Cro\VariantUiService::save($tenant->fresh(), $ui);
        }

        return response()->json($this->payload($tenant->fresh()));
    }

    /** Panel önizlemesi için örnek model (gerçek ürün görselleri + popülerlik verisi). */
    public function preview(): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }

        return response()->json(\App\Services\Cro\VariantUiService::previewSample($tenant));
    }

    /** Mağaza betiği: seçilen numara stokta değilse o numarası stokta olan benzer ürünler. */
    public function publicSimilar(Request $request, string $slug): JsonResponse|Response
    {
        $cors = ['Access-Control-Allow-Origin' => '*', 'Access-Control-Allow-Methods' => 'GET, OPTIONS', 'X-Content-Type-Options' => 'nosniff'];
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)->withHeaders($cors);
        }
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant || ! self::settingsFor($tenant)['enabled']) {
            return response()->json([], 404)->withHeaders($cors);
        }
        $ui = \App\Services\Cro\VariantUiService::settings($tenant);

        $pid = (string) $request->query('pid', '');
        $size = (string) $request->query('size', '');

        return response()->json([
            'items' => \App\Services\Cro\VariantUiService::similar($tenant, $pid, $size, (int) $ui['sheet']['similar_count']),
            'category_url' => \App\Services\Cro\VariantUiService::categoryUrl($tenant, $pid, $size),
        ])
            ->withHeaders($cors + ['Cache-Control' => 'public, max-age=300']);
    }

    public const EVENT_TYPES = ['view', 'sheet_open', 'size_select', 'add_cart', 'oos_select', 'notify', 'similar_click', 'color_click', 'fit_shown', 'alert'];

    /** Mağaza betiği: olay kaydı (sendBeacon, text/plain gövde). */
    public function publicEvent(Request $request, string $slug): JsonResponse|Response
    {
        $cors = ['Access-Control-Allow-Origin' => '*', 'Access-Control-Allow-Methods' => 'POST, OPTIONS', 'Access-Control-Allow-Headers' => 'Content-Type'];
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)->withHeaders($cors);
        }
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['ok' => false], 404)->withHeaders($cors);
        }
        $d = json_decode((string) $request->getContent(), true);
        $d = is_array($d) ? $d : $request->all();
        $type = (string) ($d['type'] ?? '');
        if (! in_array($type, self::EVENT_TYPES, true)) {
            return response()->json(['ok' => false], 422)->withHeaders($cors);
        }
        $src = $request->header('Origin') ?: $request->header('Referer');
        $hubHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));
        $pid = (int) ($d['pid'] ?? 0);
        \Illuminate\Support\Facades\DB::table('variant_events')->insert([
            'tenant_id' => $tenant->id,
            'session_id' => mb_substr(trim((string) ($d['sid'] ?? '')), 0, 64) ?: null,
            'bucket' => in_array($d['b'] ?? 'A', ['A', 'B'], true) ? $d['b'] : 'A',
            'type' => $type,
            'product_id' => $pid > 0 ? $pid : null,
            'value' => mb_substr((string) ($d['v'] ?? ''), 0, 120) ?: null,
            'device' => in_array($d['dev'] ?? null, ['m', 'd'], true) ? $d['dev'] : null,
            'is_test' => (bool) ($src && strtolower((string) parse_url($src, PHP_URL_HOST)) === $hubHost) || ! empty($d['test']),
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true])->withHeaders($cors);
    }

    /** Panel: olay özeti (A/B kova bazında), son N gün. */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->tenant();
        if (! $tenant) {
            return response()->json(['error' => 'no_tenant'], 422);
        }
        $days = max(1, min(90, (int) $request->query('days', 7)));
        $rows = \Illuminate\Support\Facades\DB::select("select bucket, device, type, count(*) n, count(distinct session_id) s
            from variant_events where tenant_id = ? and not is_test and created_at >= now() - (? || ' days')::interval
            group by 1, 2, 3", [$tenant->id, $days]);
        $out = [];
        foreach ($rows as $r) {
            $k = $r->bucket.'|'.($r->device ?? '-');
            $out[$k]['bucket'] = $r->bucket;
            $out[$k]['device'] = $r->device;
            $out[$k][$r->type] = (int) $r->n;
            $out[$k][$r->type.'_sessions'] = (int) $r->s;
        }
        $fit = \Illuminate\Support\Facades\DB::selectOne("select count(*) n from variant_events where tenant_id = ? and type = 'fit_shown' and created_at >= now() - (? || ' days')::interval", [$tenant->id, $days]);

        return response()->json(['days' => $days, 'rows' => array_values($out), 'fit_shown' => (int) ($fit->n ?? 0)]);
    }

    /** Mağaza betiği: sayfadaki renk ürünleri için sıra / popüler / stoksuz / renk adı + az kalan numaralar. */
    public function publicData(Request $request, string $slug): JsonResponse|Response
    {
        $cors = ['Access-Control-Allow-Origin' => '*', 'Access-Control-Allow-Methods' => 'GET, OPTIONS', 'X-Content-Type-Options' => 'nosniff'];
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)->withHeaders($cors);
        }
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant || ! self::settingsFor($tenant)['enabled']) {
            return response()->json(['error' => 'off'], 404)->withHeaders($cors);
        }
        $ids = array_slice(explode(',', (string) $request->query('ids', '')), 0, 40);
        $pid = $request->query('pid');

        return response()->json(\App\Services\Cro\VariantUiService::data($tenant, $ids, $pid !== null ? (string) $pid : null))
            ->withHeaders($cors + ['Cache-Control' => 'public, max-age=300']);
    }

    /** Mağaza betiğinin okuduğu ayar (giriş gerektirmez, gizli veri içermez). */
    public function publicConfig(Request $request, string $slug): JsonResponse|Response
    {
        $cors = ['Access-Control-Allow-Origin' => '*', 'Access-Control-Allow-Methods' => 'GET, OPTIONS', 'X-Content-Type-Options' => 'nosniff'];
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)->withHeaders($cors);
        }
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return response()->json(['enabled' => false], 404)->withHeaders($cors);
        }
        $s = self::settingsFor($tenant);
        $ui = \App\Services\Cro\VariantUiService::settings($tenant);
        unset($ui['colors']['popular_min_sales'], $ui['colors']['popular_days'], $ui['colors']['popular_count']); // sunucuda uygulanır

        // Çekirdek betiğin sürümü (dosya değişiklik zamanı) — kalıcı yükleyici bununla ?b= ekleyip CDN önbelleğini aşar
        $build = @filemtime(public_path('widget/variant-core.js')) ?: 0;

        return response()->json(['enabled' => $s['enabled'], 'deselect' => $s['deselect'], 'param' => $s['param'], 'ui' => $ui, 'build' => (string) $build])
            ->withHeaders($cors + ['Cache-Control' => 'public, max-age=120']);
    }
}
