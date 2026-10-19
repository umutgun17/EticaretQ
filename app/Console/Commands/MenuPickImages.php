<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Menu\MenuImagePicker;
use Illuminate\Console\Command;

/** Akıllı Menü kategori kapaklarını Akıllı Sıralama + görsel puanıyla seç (gecelik + panelden). */
class MenuPickImages extends Command
{
    protected $signature = 'menu:pick-images {--tenant=} {--path=*}';

    protected $description = 'Akıllı Menü: kategori kapak görsellerini üst sıradaki ürünlerden görsel puanıyla seç';

    public function handle(MenuImagePicker $picker): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey((int) $this->option('tenant'))->get()
            : Tenant::where('is_active', true)->get()->filter(fn ($t) => filter_var(($t->settings ?? [])['menu_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN));
        foreach ($tenants as $t) {
            $paths = $this->option('path') ?: null;
            $r = $picker->pickForTenant($t->id, $paths);
            $this->info("[{$t->slug}] {$r['picked']}/{$r['categories']} kategori, {$r['downloaded']} görsel, {$r['seconds']} sn");
        }

        return self::SUCCESS;
    }
}
