<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MarketingMessage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * HALKA AÇIK e-posta açılma/tıklama takibi (auth yok).
 *  - open:  1x1 piksel → opened_at işaretler.
 *  - click: hedef URL şifreli (açık-redirect yok) → clicked_at işaretler, yönlendirir.
 */
class PublicEmailTrackController extends Controller
{
    /** GET /e/o/{token}.gif */
    public function open(string $token)
    {
        $this->mark($token, 'opened_at');

        // 1x1 şeffaf GIF
        $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

        return response($gif, 200, [
            'Content-Type' => 'image/gif',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
        ]);
    }

    /** GET /e/c/{token}?u=<encrypted url> — u yoksa mesajın meta.click_url'i (WA buton tıkları) */
    public function click(string $token, Request $request)
    {
        $msg = $this->mark($token, 'clicked_at', markOpenToo: true);

        $target = '/';
        try {
            $enc = (string) $request->query('u', '');
            if ($enc !== '') {
                $url = Crypt::decryptString($enc);
                if (filter_var($url, FILTER_VALIDATE_URL) && preg_match('#^https?://#i', $url)) {
                    $target = $url;
                }
            } elseif ($msg) {
                // WhatsApp URL butonu: hedef, gönderim anında mesajın meta'sına yazılır
                $url = (string) (($msg->meta['click_url'] ?? ''));
                if (filter_var($url, FILTER_VALIDATE_URL) && preg_match('#^https?://#i', $url)) {
                    $target = $url;
                }
            }
        } catch (\Throwable) {
            // bozuk token → güvenli varsayılan
        }

        return redirect()->away($target, 302);
    }

    protected function mark(string $token, string $field, bool $markOpenToo = false): ?MarketingMessage
    {
        $msg = MarketingMessage::withoutGlobalScopes()->where('tracking_token', $token)->first();
        if (! $msg) {
            return null;
        }
        $patch = [];
        if ($msg->{$field} === null) {
            $patch[$field] = now();
        }
        if ($markOpenToo && $msg->opened_at === null) {
            $patch['opened_at'] = now(); // tıklama açılmayı da ima eder
        }
        if ($patch) {
            $msg->forceFill($patch)->save();
        }

        return $msg;
    }
}
