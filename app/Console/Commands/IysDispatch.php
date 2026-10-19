<?php

namespace App\Console\Commands;

use App\Models\IysContact;
use App\Models\Tenant;
use App\Services\IysService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * İYS damla gönderici — scheduler her 5 dk çağırır.
 *
 * Akış (tenant başına):
 *  1) settings.iys.enabled değilse / pencere dışıysa / kota dolduysa çık.
 *  2) Günün kotası = hedef ±%25 (deterministik, IysService::dailyQuota).
 *  3) Pencere içinde eşit tempoda ilerle: şu ana kadar gönderilmesi "beklenen"
 *     sayı ile fiilen gönderilen arasındaki fark kadar kişi işle (slice).
 *  4) Kişiler ilk sipariş tarihine göre ESKİDEN YENİYE gider; her kişi için
 *     telefon → ARAMA+MESAJ, e-posta → EPOSTA izinleri gönderilir
 *     (consentDate = gönderim anı). Kişiler arasında rastgele bekleme:
 *     ortalama aralık = pencere/kota, %40-%160 jitter, 2-90 sn clamp.
 *  5) Çalışma bütçesi ~240 sn — artan iş sonraki 5 dk'lık koşuya kalır.
 */
class IysDispatch extends Command
{
    protected $signature = 'iys:dispatch {--tenant=} {--dry-run : API çağrısı yapmadan seçilecek kişileri listele}';

    protected $description = 'İYS kuyruğundan günün kotası dahilinde rastgele aralıklarla izin kaydı gönderir';

    private const MAX_ATTEMPTS = 4;
    private const RUN_BUDGET_SEC = 240;
    private const MAX_SLICE = 60;

    public function handle(): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey((int) $this->option('tenant'))->get()
            : Tenant::all();

        foreach ($tenants as $tenant) {
            $s = IysService::settings($tenant);
            if (! ($s['enabled'] ?? false) && ! $this->option('dry-run')) {
                continue;
            }
            $lock = Cache::lock('iys-dispatch-'.$tenant->id, 290);
            if (! $lock->get()) {
                $this->warn("t{$tenant->id}: önceki koşu sürüyor, atlandı.");
                continue;
            }
            try {
                $this->runTenant($tenant, $s);
            } finally {
                $lock->release();
            }
        }

        return self::SUCCESS;
    }

    protected function runTenant(Tenant $tenant, array $s): void
    {
        // Pencere ve gün sınırı DAİMA İstanbul saatiyle (app TZ = UTC)
        $now = now('Europe/Istanbul');
        [$wStart, $wEnd] = [$s['window_start'] ?? '09:30', $s['window_end'] ?? '21:30'];
        $start = $now->copy()->setTimeFromTimeString($wStart);
        $end = $now->copy()->setTimeFromTimeString($wEnd);
        if ($end->lte($start)) {
            $this->warn("t{$tenant->id}: pencere geçersiz ({$wStart}-{$wEnd})");

            return;
        }
        if ($now->lt($start) || $now->gt($end)) {
            $this->line("t{$tenant->id}: pencere dışı ({$wStart}-{$wEnd}), bekleniyor.");

            return;
        }

        $quota = IysService::dailyQuota($tenant->id, (int) ($s['daily_target'] ?? 0), $now->toDateString());
        $doneToday = IysContact::where('tenant_id', $tenant->id)
            ->where('last_attempt_at', '>=', $now->copy()->startOfDay()->utc())
            ->count();

        if ($doneToday >= $quota) {
            $this->line("t{$tenant->id}: günün kotası dolu ({$doneToday}/{$quota}).");

            return;
        }

        // Pencere içi eşit tempo: geçen sürenin oranı kadar kişi işlenmiş olmalı
        $windowSec = max(1, $end->diffInSeconds($start));
        $elapsedFrac = min(1.0, max(0.0, $start->diffInSeconds($now) / $windowSec));
        $expected = (int) ceil($quota * $elapsedFrac);
        $slice = min(max(0, $expected - $doneToday), $quota - $doneToday, self::MAX_SLICE);
        if ($slice <= 0) {
            $this->line("t{$tenant->id}: tempoda ({$doneToday}/{$quota}), bu koşuda iş yok.");

            return;
        }

        $contacts = IysContact::where('tenant_id', $tenant->id)
            ->whereIn('status', ['pending', 'partial', 'failed'])
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->orderBy('first_order_at')
            ->orderBy('id')
            ->limit($slice)
            ->get();

        if ($contacts->isEmpty()) {
            $this->line("t{$tenant->id}: kuyrukta işlenecek kişi kalmadı.");

            return;
        }

        if ($this->option('dry-run')) {
            $this->info("t{$tenant->id}: kota {$quota}, bugün {$doneToday}, slice {$slice} — DRY RUN:");
            foreach ($contacts as $c) {
                $this->line(sprintf('  #%d %s | %s | %s | tipler: %s', $c->id, $c->name, $c->phone ?: '-', $c->email ?: '-', implode('+', $c->missingTypes())));
            }

            return;
        }

        $svc = IysService::fromTenant($tenant);
        if (! $svc->isConfigured()) {
            $this->error("t{$tenant->id}: İYS yapılandırması eksik: ".implode(', ', $svc->missingConfig()));

            return;
        }

        $avgGap = $windowSec / max(1, $quota);
        $started = microtime(true);
        $sent = 0;

        foreach ($contacts as $c) {
            if ((microtime(true) - $started) > self::RUN_BUDGET_SEC) {
                break;
            }

            $rateLimited = $this->processContact($c, $svc, $s);
            $sent++;

            // Netgsm "Sinir asimi" (103): devam etmek anlamsız — koşuyu kes,
            // kalanlar sonraki 5 dk'lık tick'te yeniden denenir.
            if ($rateLimited) {
                $this->warn("t{$tenant->id}: Netgsm sınır aşımı (103) — koşu erken kesildi.");
                break;
            }

            // rastgele tempo: ortalama aralığın %40-%160'ı, 2-90 sn arasında
            if ($sent < $contacts->count()) {
                $gap = (int) round($avgGap * (mt_rand(40, 160) / 100));
                sleep(max(2, min(90, $gap)));
            }
        }

        $this->info("t{$tenant->id}: bu koşuda {$sent} kişi işlendi (gün: ".($doneToday + $sent)."/{$quota}).");
    }

    /** @return bool true = Netgsm hız sınırına (103) takıldı */
    protected function processContact(IysContact $c, IysService $svc, array $s): bool
    {
        $results = $c->types_result ?? [];
        $errors = [];
        $codes = [];

        foreach ($c->missingTypes() as $type) {
            $recipient = $type === 'EPOSTA' ? $c->email : $c->phone;
            $r = $svc->addConsent(
                $type,
                $recipient,
                $s['recipient_type'] ?? 'BIREYSEL',
                $s['source'] ?? 'HS_WEB',
                sprintf('t%d-c%d-%s', $c->tenant_id, $c->id, strtolower($type)),
            );
            $results[$type] = [
                'ok' => $r['ok'],
                'code' => $r['code'],
                'at' => now()->toDateTimeString(),
            ];
            if (! $r['ok']) {
                $errors[] = $type.': '.($r['error'] ?? 'unknown');
                $codes[] = (string) $r['code'];
            }
            // aynı kişinin tipleri arasında da minik nefes
            usleep(mt_rand(300_000, 1_200_000));
        }

        $okCount = collect($results)->filter(fn ($x) => $x['ok'] ?? false)->count();
        $planned = count($c->plannedTypes());

        // Tüm hatalar 103 (sınır aşımı) ise deneme hakkı YAKILMAZ — geçici durum
        $rateLimited = $errors && ! array_diff($codes, ['103']);

        $c->forceFill([
            'types_result' => $results,
            'attempts' => $rateLimited ? $c->attempts : $c->attempts + 1,
            'last_attempt_at' => now(),
            'status' => $okCount >= $planned ? 'sent' : ($okCount > 0 ? 'partial' : 'failed'),
            'sent_at' => $okCount >= $planned ? ($c->sent_at ?? now()) : $c->sent_at,
            'last_error' => $errors ? substr(implode(' | ', $errors), 0, 900) : null,
        ])->save();

        return $rateLimited;
    }
}
