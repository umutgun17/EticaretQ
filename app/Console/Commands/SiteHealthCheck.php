<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\Tenant;
use App\Services\TicimaxService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Mağaza sitesi + ödeme adımları sağlık kontrolü (yalnız okur; mağazaya/Ticimax'a yazmaz).
 *
 * İki katman:
 *  1) YOKLAMA: mağazanın sepet API'si (Cloudflare arkasındaki Ticimax origin'i), Ticimax web servisi ve ödeme
 *     kuruluşlarına erişim + yanıt süresi. Mağaza HTML sayfaları sunucu IP'sine Cloudflare doğrulaması
 *     çıkarabildiği için "blocked" sayılır, alarm üretmez.
 *  2) HUNİ: gerçek müşteri akışı — sepet görüntüleme → ödemeye geç → ödeme sayfası → sipariş denemesi →
 *     onaylı sipariş + ödeme başarı oranı (iyzico / PayTR ayrı, sipariş bazında). Son 60 dk, günün önceki 6 saatine oranlanıp
 *     önceki günlerin aynı saat oranıyla kıyaslanır; böylece trafik seviyesi değişse de "site geliyor ama
 *     sepet/ödeme ilerlemiyor" durumu yakalanır.
 *
 * Ayar: tenant settings.site_health = {enabled, store_url}. Aynı sorun üst üste 3 koşuda (~15 dk) görülürse alarm.
 */
class SiteHealthCheck extends Command
{
    protected $signature = 'site:health-check {--tenant= : Yalnız bu tenant} {--at= : Huniyi bu ana göre değerlendir (TR saati, geriye dönük test; yoklama yapılmaz)} {--dry : Kaydetme, yalnız göster} {--report= : Son N saatin özetini göster, kontrol yapma}';

    protected $description = 'Mağaza sitesi ve ödeme adımlarının sağlığını kontrol eder (yoklama + gerçek müşteri hunisi)';

    private const TZ = 'Europe/Istanbul';

    private const SITE_SOURCES = ['TicimaxWeb', 'NativeAndroid', 'NativeIOS'];

    private const GATEWAYS = [17 => 'iyzico', 25 => 'paytr'];

    /** Sipariş senkronu ~5 dk geriden gelir; pencere bu kadar geriden kapanır. */
    private const LAG_MIN = 6;

    private const WINDOW_MIN = 60;

    private const PRIOR_MIN = 360;

    private const BASELINE_DAYS = 7;

    public function handle(): int
    {
        $q = Tenant::query();
        if ($this->option('tenant')) {
            $q->where('id', (int) $this->option('tenant'));
        }
        foreach ($q->get() as $tenant) {
            $cfg = $tenant->settings['site_health'] ?? [];
            if (empty($cfg['enabled'])) {
                continue;
            }
            if ($this->option('report')) {
                $this->report($tenant, (int) $this->option('report'));

                continue;
            }

            $now = $this->option('at') ? Carbon::parse($this->option('at'), self::TZ) : now(self::TZ);
            $rows = $this->option('at') ? [] : $this->probes($tenant, $cfg);
            $rows = array_merge($rows, $this->funnel($tenant, $now));

            foreach ($rows as $r) {
                $this->line(sprintf('  %-6s %-22s %-7s %10s %10s  %s', $r['kind'], $r['key'], strtoupper($r['status']),
                    $r['value'] === null ? '-' : round($r['value'], 1), $r['expected'] === null ? '-' : round($r['expected'], 1), $r['note'] ?? ''));
            }
            if ($this->option('dry') || $this->option('at')) {
                continue;
            }
            $this->storeAndAlert($tenant, $rows);
        }

        return self::SUCCESS;
    }

    /** @return array<int, array{kind:string,key:string,status:string,value:?float,expected:?float,note:?string}> */
    private function probes(Tenant $tenant, array $cfg): array
    {
        $out = [];
        $base = rtrim((string) ($cfg['store_url'] ?? ''), '/');
        $ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 YunbiHealth/1.0';

        if ($base !== '') {
            // Sepet API'si: önbelleğe alınmaz, her istekte Ticimax uygulama sunucusu + veritabanı çalışır.
            $out[] = $this->httpProbe('store_cart_api', "{$base}/api/cart/GetCart", $ua, fn ($resp) => is_array($resp->json('cart')), 3000);
            $out[] = $this->httpProbe('store_home_html', "{$base}/", $ua, fn ($resp) => stripos($resp->body(), '</html>') !== false, 4000);
        }

        $channel = Channel::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('is_active', true)->where('type', 'ticimax-ecommerce')->first();
        if ($channel) {
            $t = microtime(true);
            $ok = false;
            $note = null;
            try {
                $now = now(self::TZ);
                $res = TicimaxService::fromChannel($channel)->getOrders([
                    'SiparisTarihiBas' => $now->copy()->subMinutes(10)->format('Y-m-d\TH:i:s'),
                    'SiparisTarihiSon' => $now->format('Y-m-d\TH:i:s'),
                ], 1, 1, false);
                $ok = (bool) ($res['success'] ?? false);
                $note = $ok ? null : mb_substr((string) ($res['error'] ?? 'başarısız'), 0, 200);
            } catch (\Throwable $e) {
                $note = mb_substr($e->getMessage(), 0, 200);
            }
            $ms = (microtime(true) - $t) * 1000;
            $out[] = ['kind' => 'probe', 'key' => 'ticimax_ws', 'status' => ! $ok ? 'fail' : ($ms > 8000 ? 'warn' : 'ok'), 'value' => $ms, 'expected' => null, 'note' => $note];
        }

        // Ödeme kuruluşları: yalnız erişilebilirlik (işlem yapılmaz). Gerçek onay oranı huni katmanında.
        $out[] = $this->httpProbe('gw_iyzico', 'https://api.iyzipay.com/payment/test', $ua, fn ($resp) => $resp->json('status') === 'success', 4000);
        $out[] = $this->httpProbe('gw_paytr', 'https://www.paytr.com/', $ua, fn ($resp) => true, 4000);

        return $out;
    }

    private function httpProbe(string $key, string $url, string $ua, callable $valid, int $slowMs): array
    {
        $t = microtime(true);
        $status = 'fail';
        $note = null;
        try {
            $resp = Http::withHeaders(['User-Agent' => $ua, 'Accept' => '*/*'])->timeout(15)->connectTimeout(8)->get($url);
            $ms = (microtime(true) - $t) * 1000;
            if ($resp->header('cf-mitigated') === 'challenge') {
                $status = 'blocked';
                $note = 'Cloudflare doğrulaması (sunucu IP\'si) — ölçülemedi';
            } elseif ($resp->status() >= 500 || $resp->status() === 429 || ($resp->successful() && ! $valid($resp))) {
                $note = 'HTTP '.$resp->status().($resp->successful() ? ' ama içerik beklenen gibi değil' : '');
            } elseif (! $resp->successful() && $key !== 'gw_paytr') {
                $note = 'HTTP '.$resp->status();
            } else {
                $status = $ms > $slowMs ? 'warn' : 'ok';
                $note = $status === 'warn' ? 'yavaş yanıt' : null;
            }
        } catch (\Throwable $e) {
            $ms = (microtime(true) - $t) * 1000;
            $note = mb_substr($e->getMessage(), 0, 200);
        }

        return ['kind' => 'probe', 'key' => $key, 'status' => $status, 'value' => $ms, 'expected' => null, 'note' => $note];
    }

    /**
     * Son 60 dk'nın huni sayıları; beklenen = (önceki günlerde aynı saat penceresi / ondan önceki 6 saat) × bugünün önceki 6 saati.
     */
    private function funnel(Tenant $tenant, Carbon $now): array
    {
        $end = $now->copy()->subMinutes(self::LAG_MIN);
        $start = $end->copy()->subMinutes(self::WINDOW_MIN);
        $priorStart = $start->copy()->subMinutes(self::PRIOR_MIN);

        $today = $this->counts($tenant->id, $priorStart, $start, $end);
        $base = ['w' => [], 'p' => []];
        $days = 0;
        for ($d = 1; $d <= self::BASELINE_DAYS; $d++) {
            $c = $this->counts($tenant->id, $priorStart->copy()->subDays($d), $start->copy()->subDays($d), $end->copy()->subDays($d));
            foreach (['w', 'p'] as $part) {
                foreach ($c[$part] as $k => $v) {
                    $base[$part][$k] = ($base[$part][$k] ?? 0) + $v;
                }
            }
            $days++;
        }

        $out = [];
        $labels = ['cart_views' => 'sepet görüntüleme', 'checkout_clicks' => 'ödemeye geç tıklaması', 'checkout_sessions' => 'ödeme sayfası oturumu', 'order_attempts' => 'sipariş denemesi', 'paid_orders' => 'onaylı sipariş'];
        foreach ($labels as $k => $label) {
            $actual = (float) ($today['w'][$k] ?? 0);
            $bp = (float) ($base['p'][$k] ?? 0);
            $bw = (float) ($base['w'][$k] ?? 0);
            $tp = (float) ($today['p'][$k] ?? 0);
            // Sepet olayları 27 Eyl 2026'da başladı; taban yoksa ya da gece gibi hacim azsa değerlendirme yapılmaz.
            if ($bp < 30 || $tp < 10) {
                $out[] = ['kind' => 'funnel', 'key' => $k, 'status' => 'skip', 'value' => $actual, 'expected' => null, 'note' => 'kıyas için hacim yetersiz'];

                continue;
            }
            $expected = $bw / $bp * $tp;
            $ratio = $expected > 0 ? $actual / $expected : 1;
            $status = 'ok';
            if ($expected >= 10) {
                $status = $ratio < 0.6 ? 'fail' : ($ratio < 0.75 ? 'warn' : 'ok');
            }
            // Üst adımlar (sepet/tıklama) tek başına alarm sebebi değil; asıl sinyal ödeme sayfası sonrası.
            if ($status === 'fail' && in_array($k, ['cart_views', 'checkout_clicks'], true)) {
                $status = 'warn';
            }
            $out[] = ['kind' => 'funnel', 'key' => $k, 'status' => $status, 'value' => $actual, 'expected' => $expected,
                'note' => $status === 'ok' ? null : sprintf('%s beklenenin %%%d\'i (son 60 dk)', $label, round($ratio * 100))];
        }

        // Ödeme onay oranı: sipariş bazında ve ödeme kuruluşu bazında (deneme satırlarından).
        $rates = ['pay_rate' => ['paid_orders', 'order_attempts', 20]];
        foreach (self::GATEWAYS as $name) {
            $rates["pay_rate_{$name}"] = ["{$name}_ok", "{$name}_try", 12];
        }
        foreach ($rates as $key => [$okKey, $tryKey, $minN]) {
            $n = (float) ($today['w'][$tryKey] ?? 0);
            $bn = (float) ($base['w'][$tryKey] ?? 0) + (float) ($base['p'][$tryKey] ?? 0);
            if ($n < $minN || $bn < 100) {
                $out[] = ['kind' => 'funnel', 'key' => $key, 'status' => 'skip', 'value' => $n > 0 ? round(($today['w'][$okKey] ?? 0) / $n * 100, 1) : null, 'expected' => null, 'note' => "deneme az (n={$n})"];

                continue;
            }
            $rate = ($today['w'][$okKey] ?? 0) / $n * 100;
            $bRate = (($base['w'][$okKey] ?? 0) + ($base['p'][$okKey] ?? 0)) / $bn * 100;
            $rel = $bRate > 0 ? $rate / $bRate : 1;
            $status = $rel < 0.55 ? 'fail' : ($rel < 0.72 ? 'warn' : 'ok');
            $out[] = ['kind' => 'funnel', 'key' => $key, 'status' => $status, 'value' => $rate, 'expected' => $bRate,
                'note' => $status === 'ok' ? null : sprintf('ödeme onay oranı %%%d (normali %%%d, n=%d)', round($rate), round($bRate), $n)];
        }

        return $out;
    }

    /**
     * @return array{w: array<string,int>, p: array<string,int>} w = pencere, p = önceki 6 saat
     */
    private function counts(int $tenantId, Carbon $priorStart, Carbon $start, Carbon $end): array
    {
        $out = ['w' => [], 'p' => []];
        $fmt = 'Y-m-d H:i:s';

        // orders.order_date mağaza saatiyle (TR) tutulur.
        $orders = DB::table('orders')->where('tenant_id', $tenantId)
            ->whereIn('order_source', self::SITE_SOURCES)
            ->where('order_date', '>=', $priorStart->format($fmt))->where('order_date', '<', $end->format($fmt))
            ->get(['order_date', 'paid_amount', 'payments']);
        $cut = $start->format($fmt);
        foreach ($orders as $o) {
            $part = (string) $o->order_date >= $cut ? 'w' : 'p';
            $out[$part]['order_attempts'] = ($out[$part]['order_attempts'] ?? 0) + 1;
            if ((float) $o->paid_amount > 0) {
                $out[$part]['paid_orders'] = ($out[$part]['paid_orders'] ?? 0) + 1;
            }
            // Kuruluş = siparişin son ödeme satırı; başarı = sipariş ödendi. Satırdaki "approved" bayrağı PayTR'de
            // güvenilmez (başarılıda geç işaretlenir, başarısızda hata metniyle true gelebilir).
            $pays = json_decode((string) $o->payments, true) ?: [];
            $gw = $pays ? (self::GATEWAYS[(int) (end($pays)['type'] ?? 0)] ?? null) : null;
            if ($gw) {
                $out[$part]["{$gw}_try"] = ($out[$part]["{$gw}_try"] ?? 0) + 1;
                if ((float) $o->paid_amount > 0) {
                    $out[$part]["{$gw}_ok"] = ($out[$part]["{$gw}_ok"] ?? 0) + 1;
                }
            }
        }

        // cart_events.created_at UTC.
        $utc = fn (Carbon $c) => $c->copy()->utc()->format($fmt);
        $rows = DB::select(
            "select (created_at >= ?) w, surface, type, count(*) c, count(distinct session_id) s from cart_events
             where tenant_id = ? and is_test = false and created_at >= ? and created_at < ? and type in ('view','checkout') group by 1,2,3",
            [$utc($start), $tenantId, $utc($priorStart), $utc($end)]
        );
        foreach ($rows as $r) {
            $part = $r->w ? 'w' : 'p';
            if ($r->surface === 'side' && $r->type === 'view') {
                $out[$part]['cart_views'] = (int) $r->c;
            } elseif ($r->surface === 'side' && $r->type === 'checkout') {
                $out[$part]['checkout_clicks'] = (int) $r->c;
            } elseif ($r->surface === 'checkout' && $r->type === 'view') {
                $out[$part]['checkout_sessions'] = (int) $r->s;
            }
        }

        return $out;
    }

    private function storeAndAlert(Tenant $tenant, array $rows): void
    {
        $now = now();
        $alerts = [];
        foreach ($rows as $r) {
            $alerted = false;
            if ($r['status'] === 'fail') {
                // Aynı kontrol üst üste 3 koşuda (~15 dk) başarısızsa alarm; zaten alarm verilmişse tekrar etme.
                $prev = DB::table('site_health_checks')->where('tenant_id', $tenant->id)->where('key', $r['key'])
                    ->where('checked_at', '>=', $now->copy()->subMinutes(20))->orderByDesc('id')->limit(2)->get(['status', 'alerted']);
                if ($prev->count() === 2 && $prev->every(fn ($p) => $p->status === 'fail')) {
                    $alerted = true;
                    if (! $prev->first()->alerted) {
                        $alerts[] = $r;
                    }
                }
            }
            DB::table('site_health_checks')->insert([
                'tenant_id' => $tenant->id, 'checked_at' => $now, 'kind' => $r['kind'], 'key' => $r['key'], 'status' => $r['status'],
                'value' => $r['value'] === null ? null : round($r['value'], 2), 'expected' => $r['expected'] === null ? null : round($r['expected'], 2),
                'note' => $r['note'] ?? null, 'alerted' => $alerted,
            ]);
        }
        if ($alerts) {
            $summary = implode(' | ', array_map(fn ($r) => "{$r['key']}: ".($r['note'] ?? 'başarısız'), $alerts));
            Log::error('Mağaza sağlık kontrolü ALARM', ['tenant_id' => $tenant->id, 'checks' => $summary]);
            $this->error("ALARM (tenant {$tenant->id}): {$summary}");
            $this->smsAlert($tenant, $alerts);
        }
        DB::table('site_health_checks')->where('checked_at', '<', $now->copy()->subDays(60))->delete();
    }

    /**
     * Alarmı SMS ile bildir (settings.site_health.alert_sms = [numaralar]). Tenant'ın NetGSM
     * kanalı + başlığı kullanılır. Aynı tenant'a 30 dk içinde en fazla bir SMS.
     */
    private function smsAlert(Tenant $tenant, array $alerts): void
    {
        $numbers = (array) (($tenant->settings['site_health'] ?? [])['alert_sms'] ?? []);
        // Gece sipariş yokken Ticimax yoklamasının boş dönmesi arıza değil — SMS atma.
        $alerts = array_values(array_filter($alerts, fn ($r) => ! ($r['key'] === 'ticimax_ws' && str_contains((string) ($r['note'] ?? ''), 'bulunamadı'))));
        if (! $numbers || ! $alerts || $this->option('dry') || $this->option('at')) {
            return;
        }
        $lock = "site_health:sms:{$tenant->id}";
        if (! \Illuminate\Support\Facades\Cache::add($lock, 1, now()->addMinutes(30))) {
            return;
        }
        try {
            $channel = Channel::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('type', 'netgsm-call')->where('is_active', true)->first();
            if (! $channel) {
                return;
            }
            $sms = \App\Services\NetgsmService::fromChannel($channel);
            $header = (string) ((($channel->settings ?? [])['sms_header'] ?? null)
                ?: ($tenant->settings['returns_integrations']['sms']['msgheader'] ?? ''));
            if ($header === '') {
                Log::error('Mağaza sağlık kontrolü SMS: gönderici başlığı tanımlı değil', ['tenant_id' => $tenant->id]);

                return;
            }
            $text = mb_substr('Yunbi ALARM '.now('Europe/Istanbul')->format('H:i').' - '.implode(' | ', array_map(fn ($r) => (string) ($r['note'] ?? $r['key']), $alerts)), 0, 300);
            foreach ($numbers as $n) {
                $res = $sms->sendSms((string) $n, $text, $header, 'tr');
                Log::warning('Mağaza sağlık kontrolü SMS', ['tenant_id' => $tenant->id, 'to' => $n, 'ok' => $res['success'] ?? false, 'error' => $res['error'] ?? null]);
            }
        } catch (\Throwable $e) {
            Log::error('Mağaza sağlık kontrolü SMS hatası', ['tenant_id' => $tenant->id, 'err' => $e->getMessage()]);
        }
    }

    private function report(Tenant $tenant, int $hours): void
    {
        $since = now()->subHours(max(1, $hours));
        $this->info("Tenant {$tenant->id} — son {$hours} saat");
        $rows = DB::select(
            "select key, kind, count(*) n, sum((status='ok')::int) ok, sum((status='warn')::int) warn, sum((status='fail')::int) fail,
                    sum((status='blocked')::int) blocked, round(avg(value)) avg_v, round(max(value)) max_v
             from site_health_checks where tenant_id = ? and checked_at >= ? group by 1,2 order by 2 desc,1",
            [$tenant->id, $since]
        );
        $this->table(['kontrol', 'tür', 'koşu', 'ok', 'uyarı', 'hata', 'engelli', 'ort', 'en yüksek'],
            array_map(fn ($r) => [$r->key, $r->kind, $r->n, $r->ok, $r->warn, $r->fail, $r->blocked, $r->avg_v, $r->max_v], $rows));
        $bad = DB::table('site_health_checks')->where('tenant_id', $tenant->id)->where('checked_at', '>=', $since)
            ->whereIn('status', ['fail', 'warn'])->orderBy('checked_at')->limit(200)->get();
        foreach ($bad as $b) {
            $this->line(sprintf('  %s  %-5s %-22s %s / %s  %s', Carbon::parse($b->checked_at, 'UTC')->setTimezone(self::TZ)->format('d.m H:i'),
                strtoupper($b->status), $b->key, $b->value, $b->expected ?? '-', $b->note));
        }
    }
}
