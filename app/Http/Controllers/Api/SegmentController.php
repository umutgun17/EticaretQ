<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MarketingSegment;
use App\Models\Tenant;
use App\Services\SegmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Pazarlama segmentasyonu — kural tabanlı dinamik segmentler + alan seçmeli CSV export.
 * permission:settings.
 */
class SegmentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $t = $tenant->id;

        $profiles = DB::table('marketing_profiles')->where('tenant_id', $t);
        $profileStats = [
            'total' => (clone $profiles)->count(),
            'with_phone' => (clone $profiles)->whereNotNull('phone')->count(),
            'with_email' => (clone $profiles)->whereNotNull('email')->count(),
            'refreshed_at' => (clone $profiles)->max('updated_at'),
        ];

        $segments = MarketingSegment::where('tenant_id', $t)
            ->orderBy('sort')->orderBy('id')
            ->get()
            ->map(fn (MarketingSegment $s) => array_merge(
                $s->toArray(),
                ['counts' => SegmentService::cachedCounts($t, $s)],
            ));

        return response()->json([
            'profiles' => $profileStats,
            'segments' => $segments,
            'export_fields' => SegmentService::EXPORT_FIELDS,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return $this->save($request, null);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        return $this->save($request, $id);
    }

    protected function save(Request $request, ?int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $request->validate([
            'name' => 'required|string|max:120',
            'description' => 'nullable|string|max:500',
            'definition' => 'required|array',
        ]);
        $def = SegmentService::sanitizeDefinition($data['definition']);

        if ($id !== null) {
            $seg = MarketingSegment::where('tenant_id', $tenant->id)->findOrFail($id);
            if ($seg->is_system) {
                return response()->json(['message' => 'Sistem havuzları düzenlenemez.'], 422);
            }
            $seg->update(['name' => $data['name'], 'description' => $data['description'] ?? null, 'definition' => $def]);
        } else {
            $seg = MarketingSegment::create([
                'tenant_id' => $tenant->id,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'definition' => $def,
                'is_system' => false,
                'sort' => 100,
            ]);
        }

        return response()->json(['segment' => $seg->fresh()]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $seg = MarketingSegment::where('tenant_id', $tenant->id)->findOrFail($id);
        if ($seg->is_system) {
            return response()->json(['message' => 'Sistem havuzları silinemez.'], 422);
        }
        $seg->delete();

        return response()->json(['ok' => true]);
    }

    /** Kural taslağının canlı sayımı + örnek 10 kişi (kaydetmeden dene). */
    public function preview(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $def = SegmentService::sanitizeDefinition((array) $request->input('definition', []));
        $q = SegmentService::query($tenant->id, $def);

        return response()->json([
            'definition' => $def,
            'total' => (clone $q)->count(),
            'with_phone' => (clone $q)->whereNotNull('phone')->count(),
            'with_email' => (clone $q)->whereNotNull('email')->count(),
            'sample' => (clone $q)->orderByDesc('total_spent')->limit(10)
                ->get(['name', 'phone', 'email', 'is_member', 'orders_count', 'total_spent', 'last_order_at']),
        ]);
    }

    /** Profilleri siparişlerden yeniden üretir (gecelik cron da aynı işi yapar). */
    public function refresh(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        set_time_limit(300);
        $count = SegmentService::refreshProfiles($tenant->id);
        SegmentService::seedDefaults($tenant->id);
        Cache::increment("seg-ver-{$tenant->id}"); // sayım cache'lerini geçersiz kılar

        return response()->json(['profiles' => $count]);
    }

    /** Alan seçmeli CSV export. fields=name,phone,email&require=phone|email */
    public function export(Request $request, int $id): StreamedResponse|JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $seg = MarketingSegment::where('tenant_id', $tenant->id)->findOrFail($id);

        $fields = array_values(array_intersect(
            explode(',', (string) $request->query('fields', 'name,phone,email')),
            array_keys(SegmentService::EXPORT_FIELDS),
        ));
        if ($fields === []) {
            return response()->json(['message' => 'Geçerli alan seçilmedi.'], 422);
        }

        $q = SegmentService::query($tenant->id, $seg->definition ?? []);
        $require = $request->query('require');
        if ($require === 'phone') {
            $q->whereNotNull('phone');
        } elseif ($require === 'email') {
            $q->whereNotNull('email');
        }

        set_time_limit(300);
        $filename = 'segment-'.\Illuminate\Support\Str::slug($seg->name).'-'.now('Europe/Istanbul')->format('Ymd-Hi').'.csv';

        return response()->streamDownload(function () use ($q, $fields) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // BOM — Excel Türkçe karakterler
            fputcsv($out, array_map(fn ($f) => SegmentService::EXPORT_FIELDS[$f], $fields), ';');
            foreach ($q->orderBy('id')->cursor() as $row) {
                fputcsv($out, array_map(function ($f) use ($row) {
                    $v = $row->{$f};
                    if ($f === 'is_member') {
                        return $v ? 'Üyelikli' : 'Üyeliksiz';
                    }

                    return $v;
                }, $fields), ';');
            }
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
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
