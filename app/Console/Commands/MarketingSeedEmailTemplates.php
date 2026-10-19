<?php

namespace App\Console\Commands;

use App\Models\MarketingEmailTemplate;
use App\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Klasik pazarlama e-posta şablonlarını bir tenant için seed eder.
 * Panelden (GrapesJS) düzenlenebilir; bu komut yalnızca başlangıç içeriğini kurar.
 *
 *   php artisan marketing:seed-email-templates --tenant=1
 *   php artisan marketing:seed-email-templates --tenant=1 --force   (mevcutları üzerine yaz)
 */
class MarketingSeedEmailTemplates extends Command
{
    protected $signature = 'marketing:seed-email-templates
        {--tenant= : Tenant ID (zorunlu)}
        {--force : Mevcut sistem şablonlarını üzerine yaz}';

    protected $description = 'Klasik HTML e-posta şablonlarını (karşılama, sepet, kargo, doğum günü...) seed eder';

    public function handle(): int
    {
        $tenantId = (int) $this->option('tenant');
        if (! $tenantId || ! Tenant::withoutGlobalScopes()->find($tenantId)) {
            $this->error('Geçerli --tenant zorunludur.');

            return self::FAILURE;
        }

        $force = (bool) $this->option('force');
        $created = 0;
        $updated = 0;
        $skipped = 0;

        foreach ($this->templates() as $tpl) {
            $existing = MarketingEmailTemplate::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('key', $tpl['key'])
                ->first();

            if ($existing && ! $force) {
                $skipped++;
                continue;
            }

            $payload = array_merge($tpl, [
                'tenant_id' => $tenantId,
                'is_system' => true,
                'is_active' => true,
                'html' => $this->layout($tpl['subject'], $tpl['content']),
            ]);
            unset($payload['content']);

            if ($existing) {
                // Kullanıcı düzenlemişse (design var) dokunma; sadece dokunulmamış sistem şablonunu güncelle
                if ($existing->design && ! $force) {
                    $skipped++;
                    continue;
                }
                $existing->update($payload);
                $updated++;
            } else {
                MarketingEmailTemplate::create($payload);
                $created++;
            }
        }

        $this->info("Şablonlar: {$created} oluşturuldu, {$updated} güncellendi, {$skipped} atlandı (tenant={$tenantId}).");

        return self::SUCCESS;
    }

    /** Ortak e-posta gövdesi (header + içerik + footer). */
    protected function layout(string $title, string $content): string
    {
        return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>' . e($title) . '</title></head>'
            . '<body style="margin:0;padding:0;background:#f3f4f6;">'
            . '<div style="display:none;max-height:0;overflow:hidden;">{{preheader}}</div>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">'
            . '<tr><td align="center">'
            . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">'
            // header
            . '<tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f3;text-align:center;">'
            . '<a href="{{shop_url}}" style="font-size:20px;font-weight:bold;color:#111827;text-decoration:none;">{{shop_name}}</a>'
            . '</td></tr>'
            // body
            . '<tr><td style="padding:30px 28px;color:#1f2937;font-size:15px;line-height:1.6;">'
            . $content
            . '</td></tr>'
            // footer
            . '<tr><td style="padding:20px 28px;border-top:1px solid #eef0f3;color:#9ca3af;font-size:12px;line-height:1.5;text-align:center;">'
            . '{{shop_name}} • <a href="{{unsubscribe_url}}" style="color:#9ca3af;">Abonelikten çık</a>'
            . '</td></tr>'
            . '</table></td></tr></table></body></html>';
    }

    /** Tek bir CTA butonu. */
    protected function button(string $label, string $hrefVar): string
    {
        return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>'
            . '<td style="border-radius:8px;background:#4f46e5;">'
            . '<a href="' . $hrefVar . '" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px;">' . $label . '</a>'
            . '</td></tr></table>';
    }

    /**
     * Şablon tanımları. content = gövde HTML'i (layout içine gömülür).
     *
     * @return list<array<string,mixed>>
     */
    protected function templates(): array
    {
        return [
            [
                'key' => 'welcome', 'name' => 'Karşılama (Yeni Üyelik)', 'category' => 'membership',
                'subject' => 'Aramıza hoş geldin {{customer_name}}! 🎉',
                'preheader' => 'Üyeliğin için teşekkürler — sana özel bir hediyemiz var.',
                'variables' => ['customer_name', 'shop_name', 'shop_url', 'coupon_code', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:22px;margin:0 0 12px;">Hoş geldin {{customer_name}} 👋</h1>'
                    . '<p>{{shop_name}} ailesine katıldığın için çok mutluyuz. İlk alışverişine özel <b>{{coupon_code}}</b> kuponunla indirim seni bekliyor.</p>'
                    . $this->button('Alışverişe Başla', '{{shop_url}}')
                    . '<p style="color:#6b7280;font-size:13px;">Kampanya ve yeniliklerden ilk sen haberdar olacaksın.</p>',
            ],
            [
                'key' => 'cart_recovery_1', 'name' => 'Sepet Hatırlatma #1', 'category' => 'cart_recovery',
                'subject' => 'Sepetinde ürünler seni bekliyor 🛒',
                'preheader' => 'Alışverişini tamamlamayı unuttun gibi görünüyor.',
                'variables' => ['customer_name', 'cart_total', 'cart_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Bir şey mi unuttun?</h1>'
                    . '<p>Merhaba {{customer_name}}, sepetindeki ürünler hâlâ seni bekliyor.</p>'
                    . '<p style="font-size:16px;"><b>Sepet tutarı:</b> {{cart_total}}</p>'
                    . $this->button('Sepetimi Tamamla', '{{cart_url}}'),
            ],
            [
                'key' => 'cart_recovery_2', 'name' => 'Sepet Hatırlatma #2', 'category' => 'cart_recovery',
                'subject' => 'Sepetini unutma — ürünlerin tükenebilir',
                'preheader' => 'Beğendiğin ürünler stoklar tükenmeden seni bekliyor.',
                'variables' => ['customer_name', 'cart_total', 'cart_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Ürünlerin tükenmeden...</h1>'
                    . '<p>Merhaba {{customer_name}}, beğendiğin ürünler hâlâ sepetinde. Stoklar tükenmeden siparişini tamamla.</p>'
                    . '<p style="font-size:16px;"><b>Sepet tutarı:</b> {{cart_total}}</p>'
                    . $this->button('Hemen Tamamla', '{{cart_url}}'),
            ],
            [
                'key' => 'cart_recovery_3', 'name' => 'Sepet Hatırlatma #3 (Kupon)', 'category' => 'cart_recovery',
                'subject' => 'Sana özel indirim: sepetini tamamla 🎁',
                'preheader' => 'Son hatırlatma — sepetine özel bir indirim ekledik.',
                'variables' => ['customer_name', 'cart_total', 'cart_url', 'coupon_code', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Sana özel bir indirim 🎁</h1>'
                    . '<p>Merhaba {{customer_name}}, sepetini tamamlaman için sana özel <b>{{coupon_code}}</b> kuponunu hazırladık.</p>'
                    . '<p style="font-size:16px;"><b>Sepet tutarı:</b> {{cart_total}}</p>'
                    . $this->button('İndirimi Kullan', '{{cart_url}}'),
            ],
            [
                'key' => 'order_confirmation', 'name' => 'Sipariş Onayı', 'category' => 'transactional',
                'subject' => 'Siparişin alındı ✅ ({{order_no}})',
                'preheader' => 'Siparişini aldık, hazırlamaya başlıyoruz.',
                'variables' => ['customer_name', 'order_no', 'order_total', 'order_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Teşekkürler {{customer_name}}!</h1>'
                    . '<p><b>{{order_no}}</b> numaralı siparişini aldık ve hazırlamaya başlıyoruz.</p>'
                    . '<p style="font-size:16px;"><b>Tutar:</b> {{order_total}}</p>'
                    . $this->button('Siparişimi Görüntüle', '{{order_url}}'),
            ],
            [
                'key' => 'shipping', 'name' => 'Kargo Bilgilendirme', 'category' => 'transactional',
                'subject' => 'Siparişin yola çıktı 🚚 ({{order_no}})',
                'preheader' => 'Kargon yolda — takip et.',
                'variables' => ['customer_name', 'order_no', 'cargo_company', 'tracking_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Siparişin yola çıktı 🚚</h1>'
                    . '<p>Merhaba {{customer_name}}, <b>{{order_no}}</b> numaralı siparişin {{cargo_company}} ile kargoya verildi.</p>'
                    . $this->button('Kargomu Takip Et', '{{tracking_url}}'),
            ],
            [
                'key' => 'birthday', 'name' => 'Doğum Günü', 'category' => 'lifecycle',
                'subject' => 'İyi ki doğdun {{customer_name}} 🎂',
                'preheader' => 'Doğum gününe özel bir hediyemiz var.',
                'variables' => ['customer_name', 'coupon_code', 'shop_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:22px;margin:0 0 12px;">İyi ki doğdun! 🎂</h1>'
                    . '<p>Merhaba {{customer_name}}, doğum gününü kutluyoruz! Sana özel <b>{{coupon_code}}</b> hediye kuponun hazır.</p>'
                    . $this->button('Hediyeni Kullan', '{{shop_url}}'),
            ],
            [
                'key' => 'win_back', 'name' => 'Geri Kazanım (Seni Özledik)', 'category' => 'lifecycle',
                'subject' => 'Seni özledik {{customer_name}} 💜',
                'preheader' => 'Uzun zamandır görüşemedik — sana özel bir teklif.',
                'variables' => ['customer_name', 'coupon_code', 'shop_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Seni özledik 💜</h1>'
                    . '<p>Merhaba {{customer_name}}, bir süredir uğramadın. Geri dönmen için sana özel <b>{{coupon_code}}</b> kuponu hazırladık.</p>'
                    . $this->button('Yeniliklere Göz At', '{{shop_url}}'),
            ],
            [
                'key' => 'back_in_stock', 'name' => 'Stok Bildirimi', 'category' => 'product',
                'subject' => 'Beklediğin ürün geldi: {{product_name}}',
                'preheader' => 'Takip ettiğin ürün yeniden stokta.',
                'variables' => ['customer_name', 'product_name', 'product_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Tekrar stokta! 🎉</h1>'
                    . '<p>Merhaba {{customer_name}}, beklediğin <b>{{product_name}}</b> yeniden stoklarımızda. Tükenmeden al.</p>'
                    . $this->button('Ürüne Git', '{{product_url}}'),
            ],
            [
                'key' => 'price_drop', 'name' => 'Fiyat Düştü', 'category' => 'product',
                'subject' => 'Takip ettiğin ürün indirimde: {{product_name}}',
                'preheader' => 'Fiyatı düştü — kaçırma.',
                'variables' => ['customer_name', 'product_name', 'product_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Fiyat düştü 📉</h1>'
                    . '<p>Merhaba {{customer_name}}, takip ettiğin <b>{{product_name}}</b> artık daha uygun fiyatlı. Fırsatı kaçırma.</p>'
                    . $this->button('İndirimli Fiyatı Gör', '{{product_url}}'),
            ],
            [
                'key' => 'review_request', 'name' => 'Değerlendirme İsteği', 'category' => 'lifecycle',
                'subject' => 'Siparişini değerlendirir misin? ⭐',
                'preheader' => 'Deneyimin bizim için değerli.',
                'variables' => ['customer_name', 'product_name', 'review_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">Görüşün bizim için değerli ⭐</h1>'
                    . '<p>Merhaba {{customer_name}}, <b>{{product_name}}</b> ürününü nasıl buldun? Kısa bir değerlendirme bırakır mısın?</p>'
                    . $this->button('Değerlendirme Yap', '{{review_url}}'),
            ],
            [
                'key' => 'first_order_incentive', 'name' => 'İlk Siparişe Teşvik', 'category' => 'membership',
                'subject' => 'İlk siparişine özel indirim 🛍️',
                'preheader' => 'Henüz ilk siparişini vermedin — sana özel fırsat.',
                'variables' => ['customer_name', 'coupon_code', 'shop_url', 'shop_name', 'unsubscribe_url'],
                'content' => '<h1 style="font-size:21px;margin:0 0 12px;">İlk siparişine özel 🛍️</h1>'
                    . '<p>Merhaba {{customer_name}}, ilk alışverişine özel <b>{{coupon_code}}</b> kuponunla başla.</p>'
                    . $this->button('Alışverişe Başla', '{{shop_url}}'),
            ],
        ];
    }
}
