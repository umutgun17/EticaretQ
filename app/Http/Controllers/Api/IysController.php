<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IysContact;
use App\Models\Tenant;
use App\Services\IysService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * İYS Aktarım paneli — tek sayfa yönetim: durum, ayarlar, günlük seri, son gönderimler.
 * permission:settings.
 */
class IysController extends Controller
{
    public function overview(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $s = IysService::settings($tenant);
        $svc = IysService::fromTenant($tenant);
        $t = $tenant->id;

        $byStatus = IysContact::where('tenant_id', $t)
            ->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status');
        $total = (int) $byStatus->sum();
        $sent = (int) ($byStatus['sent'] ?? 0);
        $remaining = $total - $sent;

        // Gün sınırı İstanbul saatiyle (dispatcher ile aynı mantık)
        $ist = now('Europe/Istanbul');
        $dayStartUtc = $ist->copy()->startOfDay()->utc();
        $quota = IysService::dailyQuota($t, (int) $s['daily_target'], $ist->toDateString());
        $attemptedToday = IysContact::where('tenant_id', $t)->where('last_attempt_at', '>=', $dayStartUtc)->count();
        $sentToday = IysContact::where('tenant_id', $t)->where('sent_at', '>=', $dayStartUtc)->count();

        // Son 30 günün serisi
        $series = DB::table('iys_contacts')
            ->where('tenant_id', $t)
            ->whereNotNull('last_attempt_at')
            ->where('last_attempt_at', '>=', now()->subDays(30)->startOfDay())
            ->selectRaw("(last_attempt_at at time zone 'UTC' at time zone 'Europe/Istanbul')::date as d, count(*) attempted, count(*) filter (where status = 'sent') sent")
            ->groupBy('d')->orderBy('d')->get();

        // 7 günlük ortalamayla tahmini bitiş
        $avg7 = (float) DB::table('iys_contacts')->where('tenant_id', $t)
            ->where('last_attempt_at', '>=', now()->subDays(7))->count() / 7;
        $etaDays = $avg7 > 0 ? (int) ceil($remaining / $avg7) : null;

        $recent = IysContact::where('tenant_id', $t)
            ->whereNotNull('last_attempt_at')
            ->orderByDesc('last_attempt_at')
            ->limit(50)
            ->get(['id', 'name', 'phone', 'email', 'first_order_at', 'first_order_no', 'order_source', 'status', 'types_result', 'attempts', 'last_attempt_at', 'last_error']);

        return response()->json([
            'settings' => $s,
            'config' => [
                'ready' => $svc->isConfigured(),
                'missing' => $svc->missingConfig(),
            ],
            'stock' => [
                'total' => $total,
                'pending' => (int) ($byStatus['pending'] ?? 0),
                'sent' => $sent,
                'partial' => (int) ($byStatus['partial'] ?? 0),
                'failed' => (int) ($byStatus['failed'] ?? 0),
                'remaining' => $remaining,
                'seeded' => $total > 0,
            ],
            'today' => [
                'date' => $ist->toDateString(),
                'quota' => $quota,
                'attempted' => $attemptedToday,
                'sent' => $sentToday,
            ],
            'series' => $series,
            'eta_days' => $etaDays,
            'recent' => $recent,
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'daily_target' => 'sometimes|integer|min:1|max:20000',
            'window_start' => 'sometimes|date_format:H:i',
            'window_end' => 'sometimes|date_format:H:i',
            'brand_code' => 'sometimes|nullable|string|max:64',
            'recipient_type' => 'sometimes|in:BIREYSEL,TACIR',
            'source' => 'sometimes|string|max:32',
        ]);

        $settings = $tenant->settings ?? [];
        $settings['iys'] = array_merge(IysService::settings($tenant), $data);
        $tenant->settings = $settings;
        $tenant->save();

        return response()->json(['settings' => IysService::settings($tenant->fresh())]);
    }

    /** Kuyruğu siparişlerden doldurur (idempotent — yalnız yeni kişiler eklenir). */
    public function seed(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        set_time_limit(300);
        $before = IysContact::where('tenant_id', $tenant->id)->count();
        Artisan::call('iys:seed', ['--tenant' => $tenant->id]);
        $after = IysContact::where('tenant_id', $tenant->id)->count();

        return response()->json(['added' => $after - $before, 'total' => $after]);
    }

    /** Canlı doğrulama: verilen numara/e-posta için tek izin kaydı gönderir. */
    public function test(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $request->validate([
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:255',
        ]);
        if (empty($data['phone']) && empty($data['email'])) {
            return response()->json(['message' => 'Telefon veya e-posta girin.'], 422);
        }

        $svc = IysService::fromTenant($tenant);
        if (! $svc->isConfigured()) {
            return response()->json(['message' => 'İYS yapılandırması eksik: '.implode(', ', $svc->missingConfig())], 422);
        }

        $s = IysService::settings($tenant);
        $results = [];
        if (! empty($data['phone'])) {
            $tel = preg_replace('/\D+/', '', $data['phone']);
            if (! preg_match('/^(90|0)?5\d{9}$/', $tel)) {
                return response()->json(['message' => 'Geçersiz mobil numara.'], 422);
            }
            $tel = '90'.substr($tel, -10);
            foreach (['ARAMA', 'MESAJ'] as $type) {
                $results[$type] = $svc->addConsent($type, $tel, $s['recipient_type'], $s['source'], 'test-t'.$tenant->id);
            }
        }
        if (! empty($data['email'])) {
            $results['EPOSTA'] = $svc->addConsent('EPOSTA', strtolower($data['email']), $s['recipient_type'], $s['source'], 'test-t'.$tenant->id);
        }

        return response()->json(['results' => $results]);
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        $user = $request->user();
        if ($user->tenant_id) {
            return $user->tenant;
        }
        if ($request->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) $request->header('X-Tenant-Id'));
        }

        return null;
    }
}
