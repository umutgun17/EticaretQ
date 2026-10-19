<?php

namespace App\Console\Commands;

use App\Support\CargoTracking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * orders.cargo_tracking_url alanını App\Support\CargoTracking ile YENİDEN kurar.
 *
 * Neden (8 Eyl 2026): Sürat Kargo takip sayfasını yeniledi ve eski
 * `www.suratkargo.com.tr/gonderi-takip?code=…` adresi **404** vermeye başladı.
 * Bu adres siparişlerde saklanıyor ve müşteriye üç yerden gidiyordu: chatbot
 * sipariş durumu cevabı, "kargoya verildi" SMS'i ve panel sipariş detayı.
 * Aynı gün bir müşteri sohbette "takip nosunu yazıyorum ama göremiyorum" dedi.
 * Hepsijet'in `/gonderi-takip/` yolu da 404; doğrusu `/gonderi-takibi/`.
 *
 * Komut idempotenttir: yalnız DEĞİŞEN satırları günceller, ikinci çalıştırmada
 * 0 güncelleme yapar. --dry-run ile önce sayıyı görebilirsiniz.
 */
class FixCargoTrackingUrls extends Command
{
    protected $signature = 'orders:fix-cargo-urls
        {--tenant= : Yalnız bu tenant}
        {--dry-run : Yazma, yalnız kaç satırın değişeceğini raporla}
        {--fill-empty : Linki hiç olmayan siparişlere de link yaz (varsayılan: yalnız YANLIŞ linkleri düzelt)}
        {--chunk=2000 : Parti büyüklüğü}';

    protected $description = 'Sipariş kargo takip linklerini güncel sağlayıcı adresleriyle yeniden kurar';

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');
        // Varsayılan KAPALI: amaç 404 veren linkleri düzeltmek. Linki hiç olmayan
        // eski siparişlere toplu link yazmak, adresini bu sunucudan doğrulayamadığımız
        // sağlayıcılar (Sendeo, PTT) için doğrulanmamış link üretmek olurdu.
        $fillEmpty = (bool) $this->option('fill-empty');
        $chunk = max(100, (int) $this->option('chunk'));

        $query = DB::table('orders')
            ->whereNotNull('cargo_company')
            ->where('cargo_company', '<>', '')
            ->select('id', 'order_no', 'cargo_company', 'cargo_tracking_no', 'cargo_tracking_url');

        if ($tenant = $this->option('tenant')) {
            $query->where('tenant_id', (int) $tenant);
        }

        $total = 0;
        $changed = 0;
        $added = 0;

        $query->orderBy('id')->chunkById($chunk, function ($rows) use ($dry, $fillEmpty, &$total, &$changed, &$added) {
            $updates = [];

            foreach ($rows as $r) {
                $total++;

                // Takip numarası olmayan sipariş henüz kargoya çıkmamıştır —
                // ona link yazmak panelde/SMS'te yanlış beklenti yaratır.
                if (trim((string) $r->cargo_tracking_no) === '') {
                    continue;
                }

                if (! $fillEmpty && trim((string) $r->cargo_tracking_url) === '') {
                    continue;
                }

                $new = CargoTracking::url($r->cargo_company, $r->cargo_tracking_no);
                $old = $r->cargo_tracking_url;

                // Bilinmeyen sağlayıcıda link ÜRETİLMEZ; eskiden yazılmış yanlış
                // linki de silmeyiz (elle girilmiş doğru bir adres olabilir).
                if ($new === null || $new === $old) {
                    continue;
                }

                $updates[$r->id] = $new;
                $changed++;
                if ($old === null || $old === '') {
                    $added++;
                }
            }

            if ($updates === [] || $dry) {
                return;
            }

            DB::transaction(function () use ($updates) {
                foreach ($updates as $id => $url) {
                    DB::table('orders')->where('id', $id)->update(['cargo_tracking_url' => $url]);
                }
            });
        });

        $this->info(($dry ? '[KURU] ' : '') . "Taranan: {$total} · Değişen: {$changed} (bunların {$added} tanesi boştu)");

        return self::SUCCESS;
    }
}
