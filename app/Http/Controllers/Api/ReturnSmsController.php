<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReturnRequestEvent;
use App\Models\Tenant;
use App\Services\Returns\ReturnNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * İade Yönetimi → SMS Yönetimi (kullanıcı isteği 2026-07-21).
 *  - Gönderim geçmişi: iade akışında atılan TÜM SMS'ler (dry-run/hata dahil; kaynak
 *    return_request_events, action=sms_*; append-only olduğundan geçmiş değiştirilemez).
 *  - Ayarlar: olay bazlı AÇ/KAPA + şablon override (tenant settings
 *    returns_integrations.sms.events.{olay}) + genel gönderim anahtarı.
 * Tüm uçlar permission:returns arkasında; ayar YAZMA yalnız yönetici/superadmin.
 */
class ReturnSmsController extends Controller
{
    // ───────────────────────── GÖNDERİM GEÇMİŞİ ─────────────────────────

    public function log(Request $request): JsonResponse
    {
        $query = ReturnRequestEvent::query()
            ->where('action', 'like', 'sms\_%')
            ->with('returnRequest:id,public_code,customer_name,customer_phone,type')
            ->orderByDesc('id');

        if ($event = $request->query('event')) {
            $query->where('action', 'sms_' . $event);
        }

        // Durum filtresi payload üzerinden (Postgres jsonb).
        if ($status = $request->query('status')) {
            if ($status === 'sent') {
                $query->whereRaw("(payload->>'sent')::boolean IS TRUE");
            } elseif ($status === 'error') {
                $query->whereRaw("COALESCE(payload->>'error','') <> ''");
            } elseif ($status === 'not_sent') {
                $query->whereRaw("(payload->>'sent')::boolean IS NOT TRUE")
                    ->whereRaw("COALESCE(payload->>'error','') = ''");
            }
        }

        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->whereHas('returnRequest', function ($w) use ($like) {
                $w->where(function ($x) use ($like) {
                    $x->where('public_code', 'ilike', $like)
                        ->orWhere('customer_name', 'ilike', $like)
                        ->orWhere('customer_phone', 'ilike', $like);
                });
            });
        }

        if ($from = $request->query('from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        $perPage = min((int) ($request->query('per_page', 25)), 100);
        $catalog = ReturnNotifier::templateCatalog();

        $page = $query->paginate($perPage)->through(function (ReturnRequestEvent $e) use ($catalog) {
            $p = (array) ($e->payload ?? []);
            $event = (string) ($p['event'] ?? substr((string) $e->action, 4));

            return [
                'id' => $e->id,
                'event' => $event,
                'event_label' => $catalog[$event]['label'] ?? ($event === 'staff_approved' ? 'Depo onayı (eski akış)' : $event),
                'sent' => (bool) ($p['sent'] ?? false),
                'dry_run' => (bool) ($p['dry_run'] ?? false),
                'event_disabled' => (bool) ($p['event_disabled'] ?? false),
                'message' => $p['message'] ?? null,
                'error' => $p['error'] ?? null,
                'created_at' => optional($e->created_at)->format('Y-m-d H:i:s'),
                'request' => $e->returnRequest ? [
                    'id' => $e->returnRequest->id,
                    'public_code' => $e->returnRequest->public_code,
                    'customer_name' => $e->returnRequest->customer_name,
                    'customer_phone' => $e->returnRequest->customer_phone,
                    'type' => $e->returnRequest->type?->value,
                ] : null,
            ];
        });

        return response()->json($page);
    }

    // ───────────────────────── AYARLAR ─────────────────────────

    public function settings(): JsonResponse
    {
        $cfg = $this->smsConfig();
        $events = (array) ($cfg['events'] ?? []);

        $rows = [];
        foreach (ReturnNotifier::templateCatalog() as $key => $def) {
            $ev = (array) ($events[$key] ?? []);
            $rows[] = [
                'key' => $key,
                'label' => $def['label'],
                'default_template' => $def['default'],
                'enabled' => (bool) ($ev['enabled'] ?? true),
                'template' => ($t = trim((string) ($ev['template'] ?? ''))) !== '' ? $t : null,
            ];
        }

        return response()->json([
            'enabled' => (bool) ($cfg['enabled'] ?? false),
            'dry_run' => (bool) ($cfg['dry_run'] ?? true),
            'msgheader' => $cfg['msgheader'] ?? null,
            'events' => $rows,
            'placeholders' => ['{ad}', '{kod}', '{siparis}', '{takip}', '{tutar}', '{kupon}', '{kupon_tutar}', '{gun}', '{tur}', '{kargo}', '{neden}'],
        ]);
    }

    public function saveSettings(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->canManagerApproveReturns()) {
            return response()->json(['message' => 'SMS ayarlarını yalnızca yönetici değiştirebilir.'], 403);
        }

        $catalog = ReturnNotifier::templateCatalog();
        $data = $request->validate([
            'enabled' => 'required|boolean',
            'events' => 'required|array',
            'events.*.key' => 'required|string|in:' . implode(',', array_keys($catalog)),
            'events.*.enabled' => 'required|boolean',
            'events.*.template' => 'nullable|string|max:500',
        ]);

        $tenant = $this->resolveTenant();
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadı.'], 422);
        }

        $settings = $tenant->settings ?? [];
        $sms = (array) ($settings['returns_integrations']['sms'] ?? []);
        $sms['enabled'] = (bool) $data['enabled'];

        $events = [];
        foreach ($data['events'] as $ev) {
            $tpl = trim((string) ($ev['template'] ?? ''));
            // Varsayılanla aynıysa override olarak SAKLAMA (varsayılan güncellenince otomatik takip etsin).
            if ($tpl === trim($catalog[$ev['key']]['default'])) {
                $tpl = '';
            }
            $row = ['enabled' => (bool) $ev['enabled']];
            if ($tpl !== '') {
                $row['template'] = $tpl;
            }
            // Varsayılan durumda (açık + şablon override yok) kayıt tutma — settings temiz kalsın.
            if (! $row['enabled'] || isset($row['template'])) {
                $events[$ev['key']] = $row;
            }
        }
        if ($events) {
            $sms['events'] = $events;
        } else {
            unset($sms['events']);
        }

        $settings['returns_integrations']['sms'] = $sms;
        $tenant->settings = $settings;
        $tenant->save();

        return $this->settings();
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    private function smsConfig(): array
    {
        $base = (array) config('returns.integrations.sms', []);
        $tenantCfg = $this->resolveTenant()?->settings['returns_integrations']['sms'] ?? [];

        return array_merge($base, is_array($tenantCfg) ? $tenantCfg : []);
    }

    private function resolveTenant(): ?Tenant
    {
        $user = auth()->user();
        if ($user?->tenant_id) {
            return $user->tenant;
        }
        if (request()->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) request()->header('X-Tenant-Id'));
        }

        return null;
    }
}
