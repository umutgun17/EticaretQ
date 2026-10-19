<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Kampanya Duyuruları widget'ı — public config endpoint'i (auth yok, slug ile tenant).
 *
 * Üç alt özellik tek endpoint'ten beslenir (tek istek = host sitede tek round-trip):
 *  - bell   : bildirim çanı (kampanya listesi; tarih penceresi SUNUCUDA filtrelenir)
 *  - topbar : sticky üst bar yuvası — sayaçlı kampanya barı VEYA kayan madde barı (ayrı toggle'lar)
 *  - trust  : ürün detay güven rozetleri (kargo bedava / hızlı kargo / iade garantisi …)
 *
 * Saat SUNUCUDAN verilir (now): client saati yanlış olsa bile sayaç drift düzeltmesiyle
 * doğru geri sayar. Tarihler panelde Europe/Istanbul girilir (TR'de DST yok, sabit UTC+3).
 */
class PublicAnnounceController extends Controller
{
    /** GET w/{slug}/announce/config */
    public function config(Request $request, string $slug): JsonResponse
    {
        $tenant = $this->resolveTenant($slug);
        if (! $tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $s = $tenant->settings ?? [];

        if (! filter_var($s['announce_widget_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return response()->json(['enabled' => false]);
        }

        $nowMs = (int) round(microtime(true) * 1000);

        return response()
            ->json([
                'enabled' => true,
                'bell' => $this->bell($s, $nowMs),
                'topbar' => $this->topbar($s, $nowMs),
                'trust' => $this->trust($s),
                // Sunucu saati (epoch ms) — client drift düzeltmesi için, cache'lenemez
                'now' => $nowMs,
            ])
            ->header('Cache-Control', 'no-store');
    }

    /** Bildirim çanı: yalnız tarih penceresi içindeki duyurular döner. */
    private function bell(array $s, int $nowMs): array
    {
        if (! filter_var($s['announce_bell_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return ['enabled' => false];
        }

        $items = [];
        foreach ($this->jsonItems($s['announce_bell_items'] ?? '') as $it) {
            $startsAt = $this->trMs($it['starts_at'] ?? null);
            $endsAt = $this->trMs($it['ends_at'] ?? null);
            if ($startsAt !== null && $nowMs < $startsAt) {
                continue;
            }
            if ($endsAt !== null && $nowMs > $endsAt) {
                continue;
            }
            $items[] = [
                'id' => (string) ($it['id'] ?? ''),
                'title' => (string) ($it['title'] ?? ''),
                'text' => (string) ($it['text'] ?? ''),
                'url' => (string) ($it['url'] ?? ''),
                'ends_at' => $endsAt,
            ];
        }

        return [
            'enabled' => count($items) > 0,
            'position' => ($s['announce_bell_position'] ?? 'right') === 'left' ? 'left' : 'right',
            'items' => $items,
        ];
    }

    /**
     * Üst bar yuvası — iki BAĞIMSIZ özellik, tek yuva (aynı anda tek bar basılır):
     *  - sayaçlı kampanya barı (announce_topbar_enabled): tek metin + GERÇEK-deadline sayacı
     *  - kayan madde barı     (announce_ticker_enabled): "24 saatte kargo" · "3 taksit" … sırayla kayar
     * İkisi de açıksa geçerli sayaçlı kampanya öncelikli; süresi dolunca/metin boşsa kayan bar gösterilir.
     * Eski widget sürümleri (v≤6) ticker yanıtında text='' gördüğünden sessizce hiç bar basmaz.
     */
    private function topbar(array $s, int $nowMs): array
    {
        if (filter_var($s['announce_topbar_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $timer = $this->topbarTimer($s, $nowMs);
            if ($timer) {
                return $timer;
            }
        }
        if (filter_var($s['announce_ticker_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $ticker = $this->topbarTicker($s);
            if ($ticker) {
                return $ticker;
            }
        }

        return ['enabled' => false];
    }

    /** Sayaçlı bar: süresi (ends_at) geçmişse null — sahte aciliyet YOK, sayaç gerçek deadline. */
    private function topbarTimer(array $s, int $nowMs): ?array
    {
        $text = trim((string) ($s['announce_topbar_text'] ?? ''));
        if ($text === '') {
            return null;
        }

        $endsAt = $this->trMs($s['announce_topbar_ends_at'] ?? null);
        if ($endsAt !== null && $nowMs > $endsAt) {
            return null;
        }

        return [
            'enabled' => true,
            'kind' => 'timer',
            'text' => $text,
            'url' => trim((string) ($s['announce_topbar_url'] ?? '')),
            'link_text' => trim((string) ($s['announce_topbar_link_text'] ?? '')) ?: 'İncele',
            'highlights' => $this->topbarHighlights($s, $text),
            'ends_at' => $endsAt,
            'bg' => $this->hexColor($s['announce_topbar_bg'] ?? '', '#111827'),
            'fg' => $this->hexColor($s['announce_topbar_fg'] ?? '', '#ffffff'),
            'dismissible' => filter_var($s['announce_topbar_dismissible'] ?? true, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    /** Metin içi vurgular: metinde geçen ifade renkli + (varsa) linkli basılır; metinde olmayan atlanır. */
    private function topbarHighlights(array $s, string $text): array
    {
        $out = [];
        foreach ($this->jsonItems($s['announce_topbar_highlights'] ?? '') as $it) {
            $phrase = trim((string) ($it['text'] ?? ''));
            if ($phrase === '' || mb_stripos($text, $phrase) === false) {
                continue;
            }
            $out[] = [
                'text' => $phrase,
                'url' => trim((string) ($it['url'] ?? '')),
                'color' => $this->hexColor($it['color'] ?? '', '#f97316'),
            ];
        }

        return $out;
    }

    /** Kayan madde barı: maddeler sırayla kayarak geçer; madde yoksa null. */
    private function topbarTicker(array $s): ?array
    {
        $items = [];
        foreach ($this->jsonItems($s['announce_ticker_items'] ?? '') as $it) {
            $text = trim((string) ($it['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $items[] = [
                'icon' => (string) ($it['icon'] ?? 'check'),
                'text' => $text,
                'url' => trim((string) ($it['url'] ?? '')),
            ];
        }
        if (! $items) {
            return null;
        }

        $interval = (int) ($s['announce_ticker_interval'] ?? 4);

        return [
            'enabled' => true,
            'kind' => 'ticker',
            'text' => '', // eski widget sürümleri (v≤6) bu alana bakar → boş = bar basmaz
            'items' => $items,
            'interval' => max(2, min(15, $interval ?: 4)),
            'bg' => $this->hexColor($s['announce_ticker_bg'] ?? '', '#111827'),
            'fg' => $this->hexColor($s['announce_ticker_fg'] ?? '', '#ffffff'),
            'dismissible' => filter_var($s['announce_ticker_dismissible'] ?? true, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    /** Güven rozetleri: statik liste + yerleşim selector'ü (shipping widget modeli). */
    private function trust(array $s): array
    {
        if (! filter_var($s['announce_trust_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return ['enabled' => false];
        }

        $items = [];
        foreach ($this->jsonItems($s['announce_trust_items'] ?? '') as $it) {
            $title = trim((string) ($it['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $items[] = [
                'icon' => (string) ($it['icon'] ?? 'check'),
                'title' => $title,
                'subtitle' => trim((string) ($it['subtitle'] ?? '')),
            ];
        }

        return [
            'enabled' => count($items) > 0,
            'selector' => trim((string) ($s['announce_trust_selector'] ?? '')),
            'items' => $items,
        ];
    }

    /** JSON string → dizi (bozuksa boş). */
    private function jsonItems(string $json): array
    {
        $arr = json_decode($json, true);

        return is_array($arr) ? array_values(array_filter($arr, 'is_array')) : [];
    }

    /** "YYYY-MM-DDTHH:MM" (TR saati) → epoch ms. TR sabit UTC+3 (DST yok). */
    private function trMs($value): ?int
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $value)) {
            return null;
        }

        $ts = strtotime($value . ':00+03:00');

        return $ts === false ? null : $ts * 1000;
    }

    private function hexColor($value, string $default): string
    {
        $value = trim((string) ($value ?? ''));

        return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? strtolower($value) : $default;
    }

    protected function resolveTenant(string $slug): ?Tenant
    {
        return Cache::remember(
            "announce:tenant:{$slug}",
            300,
            fn () => Tenant::where('slug', $slug)->where('is_active', true)->first()
        ) ?: null;
    }
}
