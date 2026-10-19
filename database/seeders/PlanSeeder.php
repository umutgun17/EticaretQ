<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/** EticaretQ planları (KDV hariç, TL/ay). Paket fiyatları Yunbi barem fiyatlarından türetildi; düzenlenebilir. */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        $plans = [
            [
                'code' => 'eq-baslangic', 'name' => 'Başlangıç', 'price_monthly' => 12500, 'sort_order' => 1,
                'description' => 'Markaya özel iade portalı + pazaryeri yorumları sitenizde + ücretsiz dönüşüm widget\'ları.',
                'products' => ['store', 'return', 'comments', 'cro'],
                'limits' => ['returns' => 250, 'reviews_synced' => 5000, 'wa_notifications' => 0],
                'features' => ['Ürün, sipariş, müşteri senkronu (Ticimax, ikas)', 'İade & iptal portalı (aylık 250 talep)', 'Kargo + ödeme iade entegrasyonları', 'Trendyol yorumları sitenizde (5.000 yorum)', 'Şans çarkı, Bugün Kargoda, duyuru, gelince haber ver', 'Akıllı filtre, rozet, menü, 404, sepet widget\'ları'],
            ],
            [
                'code' => 'eq-buyume', 'name' => 'Büyüme', 'price_monthly' => 45000, 'sort_order' => 2, 'highlight' => true, 'is_trial_default' => true,
                'description' => 'Başlangıç + pazarlama otomasyonu (WhatsApp/SMS sipariş bildirimi, sepet kurtarma) + akıllı arama.',
                'products' => ['store', 'return', 'comments', 'marketing', 'cro'],
                'limits' => ['returns' => 1000, 'reviews_synced' => 25000, 'wa_notifications' => 5000],
                'features' => ['Başlangıç paketindeki her şey', 'İade portalı (aylık 1.000 talep)', 'Yorum senkronu (25.000 yorum)', 'WhatsApp/SMS sipariş bildirimleri (5.000 bildirim)', 'Terk sepet kurtarma + analitik', 'Segmentler + toplu WhatsApp/e-posta kampanyaları', 'Akıllı arama + satış atıf raporu', 'Kategori zekâsı & akıllı sıralama'],
            ],
            [
                'code' => 'eq-profesyonel', 'name' => 'Profesyonel', 'price_monthly' => 59000, 'sort_order' => 3,
                'description' => 'Yüksek hacimli markalar için tüm modüller, geniş limitler, öncelikli destek.',
                'products' => ['store', 'return', 'comments', 'marketing', 'cro'],
                'limits' => ['returns' => 2500, 'reviews_synced' => 100000, 'wa_notifications' => 10000],
                'features' => ['Büyüme paketindeki her şey', 'İade portalı (aylık 2.500 talep)', 'Yorum senkronu (100.000 yorum)', 'WhatsApp bildirimi (10.000)', 'İYS entegrasyonu', 'Öncelikli destek'],
            ],
        ];

        foreach ($plans as $p) {
            Plan::updateOrCreate(['code' => $p['code']], $p + ['family' => 'eticaretq', 'currency' => 'TRY', 'trial_days' => 14, 'is_public' => true]);
        }
    }
}
