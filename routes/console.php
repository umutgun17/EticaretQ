<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Zamanlanmış görevler — tüm tenant'lar için (tek cron: * * * * * artisan schedule:run)
|--------------------------------------------------------------------------
| Her görev tenant-bağımsızdır; tek-tenant varsayılanı olan komutlar aktif tenant
| listesi üzerinde döngüyle koşturulur.
*/

$log = fn (string $name) => storage_path("logs/{$name}.log");

// Kuyruk işçisi — her dakika taze proses, 55 sn boyunca kuyruğu dinler (webhook mesajları ~1-2 sn).
Schedule::command("queue:work --sleep=1 --max-time=55 --tries=3")
    ->everyMinute()->runInBackground()->withoutOverlapping(2)->appendOutputTo($log("queue-worker"));

// Faturalama: deneme bitişi, yenileme tahsilatı, hatırlatma (her gün 06:00 TR)
Schedule::command("billing:renew")->dailyAt("03:00")->withoutOverlapping(60)->appendOutputTo($log("billing"));

// Kullanıcı aktivitesi: 90 günden eski kayıtları sil
Schedule::command("activity:prune")->dailyAt("04:10")->withoutOverlapping(60);

// Tek-tenant varsayılanı olan komutları aktif tenant'lar üzerinde döndür.
$forEachTenant = function (string $command, array $args = []) {
    return function () use ($command, $args) {
        \App\Models\Tenant::where("is_active", true)->orderBy("id")->each(function ($t) use ($command, $args) {
            try { Artisan::call($command, ["--tenant" => $t->id] + $args); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning("schedule.$command", ["tenant" => $t->id, "error" => $e->getMessage()]); }
        });
    };
};

// ── Mağaza senkronu (Ticimax / ikas) ──
Schedule::command("crm:sync-orders-live --mode=new")->everyMinute()->withoutOverlapping(5)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:sync-orders-live --mode=changes")->everyTwoMinutes()->withoutOverlapping(5)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:sync-orders-live --mode=status")->hourlyAt(7)->withoutOverlapping(30)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:refresh-open-orders")->everyFifteenMinutes()->withoutOverlapping(14)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:refresh-open-orders --scope=moving")->dailyAt("02:00")->withoutOverlapping(120)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:sync-orders-live --mode=safety")->dailyAt("04:00")->withoutOverlapping(60)->appendOutputTo($log("crm-orders"));
Schedule::command("crm:sync-stock --minutes=10")->everyFiveMinutes()->withoutOverlapping(5)->appendOutputTo($log("crm-stock"));
Schedule::command("crm:sync-members --limit=100")->dailyAt("03:30")->withoutOverlapping(120)->appendOutputTo($log("crm-members"));
Schedule::command("crm:sync-members --full --limit=100")->monthlyOn(1, "02:00")->withoutOverlapping(600)->appendOutputTo($log("crm-members"));
Schedule::command("crm:sync-products --limit=100")->dailyAt("03:00")->withoutOverlapping(120)->appendOutputTo($log("crm-products"));
Schedule::command("crm:sync-favorites --days=3")->everySixHours()->withoutOverlapping(60)->appendOutputTo($log("crm-favorites"));
Schedule::command("ikas:sync --what=orders")->everyFifteenMinutes()->withoutOverlapping(10)->appendOutputTo($log("ikas-sync"));
Schedule::command("ikas:sync --what=customers")->hourly()->withoutOverlapping(30)->appendOutputTo($log("ikas-sync"));
Schedule::command("ikas:sync --what=carts")->hourlyAt(30)->withoutOverlapping(30)->appendOutputTo($log("ikas-sync"));
Schedule::command("embeddings:generate --target=products --limit=100")->hourly()->withoutOverlapping(30)->appendOutputTo($log("embeddings"));
Schedule::command("search:verify-images")->dailyAt("03:45")->withoutOverlapping(60)->appendOutputTo($log("search-images"));

// ── Yorumlar (Trendyol) ──
Schedule::command("trendyol:sync-catalog")->dailyAt("00:30")->withoutOverlapping(120)->appendOutputTo($log("trendyol-catalog"));
Schedule::command("widget:generate-cache")->hourly()->withoutOverlapping(30)->appendOutputTo($log("widget-cache"));

// ── İade ──
Schedule::command("returns:track-shipments")->everyThirtyMinutes()->withoutOverlapping(25)->appendOutputTo($log("returns-track"));
Schedule::command("returns:retry-cargo")->everyFifteenMinutes()->withoutOverlapping(10)->appendOutputTo($log("returns-retry"));
Schedule::command("returns:expire-shipments")->dailyAt("03:40")->withoutOverlapping(60)->appendOutputTo($log("returns-expire"));

// ── Pazarlama (ayar kapalıyken simülasyon; panelden açılınca canlı) ──
Schedule::command("marketing:stock-alerts --live")->everyFifteenMinutes()->withoutOverlapping(10)->appendOutputTo($log("marketing-stock-alerts"));
Schedule::command("marketing:cart-recovery --live")->everyTenMinutes()->withoutOverlapping(9)->appendOutputTo($log("marketing-cart-recovery"));
Schedule::command("marketing:order-notify --live")->everyFiveMinutes()->withoutOverlapping(5)->appendOutputTo($log("marketing-order-notify"));
Schedule::command("marketing:campaign-dispatch --live")->everyFiveMinutes()->withoutOverlapping(5)->appendOutputTo($log("marketing-campaigns"));
Schedule::command("marketing:wheel-reminder --live")->everyFifteenMinutes()->withoutOverlapping(10)->appendOutputTo($log("marketing-wheel"));
Schedule::command("marketing:scratch-reminder --live")->everyMinute()->withoutOverlapping(1)->appendOutputTo($log("marketing-wheel"));
Schedule::command("wheel:sync-redemptions")->hourly()->withoutOverlapping(30)->appendOutputTo($log("wheel"));
Schedule::command("wheel:expire-scratch-coupons")->everyMinute()->withoutOverlapping(1)->appendOutputTo($log("wheel"));
Schedule::command("iys:dispatch")->everyFiveMinutes()->withoutOverlapping(5)->appendOutputTo($log("iys"));
Schedule::call($forEachTenant("segments:refresh"))->dailyAt("05:15")->name("segments-refresh")->withoutOverlapping(120);

// ── CRO: arama / öneri / rozet / menü / atıf ──
Schedule::command("search:agentic-audit --days=7 --min=3")->dailyAt("05:30")->withoutOverlapping(60)->appendOutputTo($log("search-audit"));
Schedule::command("search:attribute-conversions --days=2")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("rec:build-copurchases")->dailyAt("04:50")->withoutOverlapping(60)->appendOutputTo($log("rec"));
Schedule::command("rec:attribute-conversions --days=2")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("hero:attribute-conversions --days=2")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("foryou:attribute-conversions --days=3")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("welcome:attribute-conversions --days=3")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("flash:attribute-conversions --days=2")->hourly()->withoutOverlapping(30)->appendOutputTo($log("attribution"));
Schedule::command("badges:build")->everyFifteenMinutes()->withoutOverlapping(14)->appendOutputTo($log("badges"));
Schedule::command("menu:pick-images")->dailyAt("05:10")->withoutOverlapping(60)->appendOutputTo($log("menu"));
Schedule::command("site:health-check")->everyFiveMinutes()->withoutOverlapping(4)->appendOutputTo($log("site-health"));

// ── Kategori zekâsı / akıllı sıralama (tenant ayarı kapalıyken yazmaz) ──
Schedule::command("catalog:sync-categories")->dailyAt("03:40")->withoutOverlapping(120)->appendOutputTo($log("catalog"));
Schedule::command("catalog:categorize --limit=200 --live")->dailyAt("04:10")->withoutOverlapping(120)->appendOutputTo($log("catalog"));
Schedule::command("catalog:audit-names")->dailyAt("04:20")->withoutOverlapping(60)->appendOutputTo($log("catalog"));
Schedule::command("ranking:sync-categories --live")->twiceDailyAt(4, 13, 30)->withoutOverlapping(120)->appendOutputTo($log("ranking"));
Schedule::call(function () {
    foreach (\App\Models\Tenant::where("is_active", true)->get() as $t) {
        try {
            if (\App\Http\Controllers\Api\VariantSelectController::settingsFor($t)["enabled"]
                && \App\Services\Cro\VariantUiService::settings($t)["colors"]["sort"] === "ranking") {
                \App\Services\Cro\VariantUiService::rankMap($t, true);
            }
        } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning("variant-color-rank", ["tenant" => $t->id, "error" => $e->getMessage()]); }
    }
})->everyThirtyMinutes()->name("variant-color-rank")->withoutOverlapping(20);
Schedule::call(fn () => \Illuminate\Support\Facades\DB::table("variant_events")->where("created_at", "<", now()->subDays(90))->delete())->dailyAt("04:40")->name("variant-events-prune");
