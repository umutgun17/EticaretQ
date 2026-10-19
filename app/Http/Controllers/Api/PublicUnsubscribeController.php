<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\EmailSuppression;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * HALKA AÇIK abonelikten-çıkış (auth yok; imzalı URL ile doğrulanır).
 *
 * GET  → adresi bastırır + kullanıcıya onay sayfası gösterir (link tıklaması).
 * POST → tek-tık (RFC 8058 One-Click): Gmail/Outlook arka planda POST atar; bastır + 200.
 *
 * URL `marketing.unsubscribe` imzalı route'undan üretilir (UnsubscribeLink::for).
 * 'signed' middleware imzayı doğrular; tenant+email tahrif edilemez.
 */
class PublicUnsubscribeController extends Controller
{
    public function handle(Request $request): Response
    {
        $tenantId = (int) $request->query('tenant');
        $email = mb_strtolower(trim((string) $request->query('email')));

        if ($tenantId > 0 && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            EmailSuppression::suppress($tenantId, $email, 'unsubscribe', 'one-click');

            // Üyeyse mail iznini de kapat
            Customer::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('email', $email)
                ->update(['mail_consent' => false]);
        }

        // Tek-tık (POST) → gövdesiz 200 yeter
        if ($request->isMethod('post')) {
            return response('', 200);
        }

        return response($this->page($email), 200, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    protected function page(string $email): string
    {
        $safe = htmlspecialchars($email, ENT_QUOTES);

        return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>Abonelik İptal Edildi</title></head>'
            . '<body style="margin:0;font-family:system-ui,Arial,sans-serif;background:#f3f4f6;">'
            . '<div style="max-width:440px;margin:64px auto;background:#fff;border-radius:14px;padding:36px 28px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.06)">'
            . '<div style="font-size:40px;line-height:1">✅</div>'
            . '<h1 style="font-size:19px;color:#111827;margin:14px 0 8px">Aboneliğiniz iptal edildi</h1>'
            . '<p style="color:#6b7280;font-size:14px;line-height:1.5">'
            . ($safe !== '' ? "<b>{$safe}</b> adresine" : 'Bu adrese') . ' artık pazarlama e-postası gönderilmeyecek.</p>'
            . '<p style="color:#9ca3af;font-size:12px;margin-top:18px">Yanlışlıkla mı çıktınız? İlgili firmayla iletişime geçebilirsiniz.</p>'
            . '</div></body></html>';
    }
}
