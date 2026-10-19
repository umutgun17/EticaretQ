<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * "Bugün Kargoda" widget'ı — public config endpoint'i (auth yok, slug ile tenant).
 *
 * Sayaç HESABI client'ta yapılır ama saat SUNUCUDAN verilir (now): client saati
 * yanlış olsa bile widget drift düzeltmesiyle doğru geri sayar. Cutoff/geceyarısı
 * hesabı Europe/Istanbul'a göredir (TR'de DST yok, sabit UTC+3).
 */
class PublicShippingController extends Controller
{
    /** GET w/{slug}/shipping/config */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $s = $tenant->settings ?? [];

        if (! filter_var($s['shipping_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['enabled' => false]);
        }

        // Kargo günleri: ISO 1=Pzt … 7=Paz (virgüllü string olarak saklanır)
        $days = array_values(array_filter(array_map('intval', explode(',', (string) ($s['shipping_days'] ?? '1,2,3,4,5,6'))), fn ($d) => $d >= 1 && $d <= 7));
        if (empty($days)) {
            $days = [1, 2, 3, 4, 5, 6];
        }

        $cutoff = (string) ($s['shipping_cutoff_time'] ?? '16:00');
        if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $cutoff)) {
            $cutoff = '16:00';
        }

        $urgent = (int) ($s['shipping_urgent_minutes'] ?? 60);
        $urgent = max(5, min(720, $urgent ?: 60));

        // Cuma istisnası (eski model): Cuma 23:59:59'a kadar verilen siparişler Cumartesi
        // kargoda → gün-bazlı takvimde "Cmt = önceki gün 23:59" satırına çevrilir.
        $fridayExt = filter_var($s['shipping_friday_extension'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if ($fridayExt) {
            $daysWithoutSat = array_values(array_filter($days, fn ($d) => $d !== 6));
            if (! empty($daysWithoutSat)) {
                $days = $daysWithoutSat;
            }
        }

        // Gün-bazlı kesim takvimi: her KARGO gününün kendi kesim saati vardır; kesim
        // önceki güne de düşebilir (prev=true → "Cmt kargosu için Cuma 23:59'a kadar sipariş").
        // shipping_day_cutoffs (JSON {"6":{"t":"23:59","prev":true},...}) varsa o kullanılır;
        // yoksa eski days+cutoff(+friday_ext) ayarlarından türetilir. cutoff/days/friday_ext
        // alanları CF'te bayat kalmış eski widget sürümleri için yanıtta korunur.
        $schedule = $this->parseDayCutoffs((string) ($s['shipping_day_cutoffs'] ?? ''));
        if ($schedule === null) {
            $schedule = array_map(fn ($d) => ['d' => $d, 't' => $cutoff, 'prev' => false], $days);
            if ($fridayExt) {
                $schedule[] = ['d' => 6, 't' => '23:59', 'prev' => true];
            }
            usort($schedule, fn ($a, $b) => $a['d'] <=> $b['d']);
        }

        return response()
            ->json([
                'enabled' => true,
                'cutoff' => $cutoff,
                'days' => $days,
                'urgent_minutes' => $urgent,
                'friday_ext' => $fridayExt,
                'schedule' => $schedule,
                'selector' => trim((string) ($s['shipping_widget_selector'] ?? '')),
                // Kargo günü 2+ gün sonraysa (ör. Cuma/Cmt siparişi → Pazartesi) gün adı yerine bu ifade
                // (ör. "1 iş gününde"); boşsa eski davranış: "Pazartesi günü kargoda".
                // Ürün detay güven barı (hızlı kargo / ücretsiz kargo / iade) — yalnız tanımlı tenant'ta
                'trust' => $this->parseTrust((string) ($s['shipping_trust_items'] ?? '')),
                'trust_target' => trim((string) ($s['shipping_trust_target'] ?? '')),
                'hide_selector' => trim((string) ($s['shipping_hide_selector'] ?? '')),
                'later_label' => mb_substr(trim((string) ($s['shipping_later_label'] ?? '')), 0, 40),
                // Sunucu saati (epoch ms) — client drift düzeltmesi için, cache'lenemez
                'now' => (int) round(microtime(true) * 1000),
            ])
            ->header('Cache-Control', 'no-store');
    }

    /**
     * shipping_day_cutoffs JSON'unu doğrulanmış takvim listesine çevirir.
     * Dönen liste: [{d: 1-7, t: "HH:MM", prev: bool}, …] (gün sırasında).
     * Bozuk/boş JSON veya geçerli satır yoksa null → eski ayarlardan türetilir.
     */
    protected function parseDayCutoffs(string $json): ?array
    {
        if ($json === '') {
            return null;
        }
        $raw = json_decode($json, true);
        if (! is_array($raw)) {
            return null;
        }

        $schedule = [];
        foreach ($raw as $day => $row) {
            $d = (int) $day;
            if ($d < 1 || $d > 7 || ! is_array($row)) {
                continue;
            }
            $t = (string) ($row['t'] ?? '');
            if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t)) {
                continue;
            }
            $schedule[] = ['d' => $d, 't' => $t, 'prev' => (bool) ($row['prev'] ?? false)];
        }
        if (empty($schedule)) {
            return null;
        }
        usort($schedule, fn ($a, $b) => $a['d'] <=> $b['d']);

        return $schedule;
    }

    /** shipping_trust_items JSON → [{k: fast|free|return|secure, t, s}] (en fazla 4, metinler kısaltılır). */
    protected function parseTrust(string $json): array
    {
        $raw = $json !== '' ? json_decode($json, true) : null;
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach (array_slice($raw, 0, 4) as $it) {
            if (! is_array($it) || trim((string) ($it['t'] ?? '')) === '') {
                continue;
            }
            $k = (string) ($it['k'] ?? '');
            $out[] = [
                'k' => in_array($k, ['fast', 'free', 'return', 'secure'], true) ? $k : 'fast',
                't' => mb_substr(trim((string) $it['t']), 0, 40),
                's' => mb_substr(trim((string) ($it['s'] ?? '')), 0, 60),
            ];
        }

        return $out;
    }

    protected function resolveTenant(string $slug): ?Tenant
    {
        return Cache::remember(
            "shipping:tenant:{$slug}",
            300,
            fn () => Tenant::where('slug', $slug)->where('is_active', true)->first()
        ) ?: null;
    }
}
