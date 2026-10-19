<?php

namespace App\Http\Controllers\Api;

use App\Enums\WheelCouponStatus;
use App\Http\Controllers\Controller;
use App\Jobs\IssueWheelCoupon;
use App\Models\Tenant;
use App\Models\WheelCampaign;
use App\Models\WheelLead;
use App\Models\WheelSlice;
use App\Models\WheelSpin;
use App\Services\TicimaxService;
use App\Services\Wheel\WheelCouponIssuer;
use App\Services\Wheel\WheelSpinEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * HALKA AÇIK çark akışı (tenant'ın site ziyaretçisi). Auth YOK.
 *
 * Güvenlik ilkeleri:
 *  - Kazanan dilim & kupon SUNUCUDA belirlenir; frontend yalnızca sonucu animasyona çevirir.
 *  - Dilim ağırlıkları (olasılıklar) ve stok bilgisi client'a HİÇ gönderilmez.
 *  - Public bağlamda Eloquent tenant global-scope pasif → her sorgu açıkça tenant_id ile filtrelenir.
 *  - Kişi başı tek çevirme: e-posta/telefon/cihaz parmak izi ile yinelenen çevirme engellenir.
 *  - KVKK açık rıza zorunluysa onaysız çevirme yapılamaz; rıza kanıtı (zaman+IP+metin) saklanır.
 *  - Dış sisteme yazma yok (display kupon); yalnızca bizim DB'ye yazılır.
 */
class PublicWheelController extends Controller
{
    public function __construct(
        private readonly WheelSpinEngine $engine,
        private readonly WheelCouponIssuer $issuer,
    ) {
        ini_set('serialize_precision', '-1');
    }

    /**
     * GET w/{slug}/wheel/{campaign}/config
     * Widget'ın render için ihtiyaç duyduğu PUBLIC veri (ağırlık/stok HARİÇ).
     */
    public function config(Request $request, string $slug, string $campaign): JsonResponse
    {
        $c = $this->resolveCampaign($slug, $campaign);
        if (! $c) {
            return response()->json(['error' => 'not_found'], 404);
        }
        // Önizleme token'ı varsa taslak/duraklatılmış kampanya da gösterilir (panelden test).
        if (! $this->isPreview($request, $c) && ! $c->isLiveNow()) {
            return response()->json(['active' => false], 200);
        }

        $preview = $this->isPreview($request, $c);

        // A/B çözümleme: gömülü slug bir A/B kampanyasıysa A gösterilir, B eş olur. Gömülü slug
        // bir oyun kampanyasıysa ve onu A yapan YAYINDA bir A/B kampanyası varsa aynı şey (tema
        // değişmeden A/B açılır). Kura widget'ta (localStorage, kalıcı); kayıt ilgili oyuna düşer.
        $ab = $c->isAb() ? $c : $c->abOwner();
        $a = $c; $b = null;
        if ($ab) {
            [$va, $vb] = $ab->abVariants();
            if ($c->isAb()) {
                if (! $va || (! $preview && ! $va->isLiveNow())) {
                    return response()->json(['active' => false], 200);
                }
                $a = $va;
            }
            $b = $vb;
        }

        $trigger = array_merge(config('wheel.default_trigger'), $c->trigger_rules ?? []);
        $out = $this->publicCampaign($a);
        $out['active'] = true;
        $out['embedded'] = $c->slug;
        $out['trigger'] = $this->publicTrigger($trigger);
        $out['ab'] = null;
        // B yayında değilse (taslak/duraklatılmış) A/B sessizce kapanır → herkes A'yı görür.
        if ($ab && $b && $b->id !== $a->id && ($preview || $b->isLiveNow())) {
            $out['ab'] = [
                'campaign' => $ab->slug,
                'percent' => $ab->abSettings()['percent'],
                'partner' => $this->publicCampaign($b),
            ];
        }

        return response()->json($out);
    }

    /** Bir kampanyanın widget'a giden public görünümü (tetik hariç — tetik gömülü kampanyadan). */
    private function publicCampaign(WheelCampaign $c): array
    {
        $design = array_merge(config('wheel.default_design'), $c->design ?? []);
        $form = array_merge(config('wheel.default_form'), $c->form_fields ?? []);
        $out = [
            'campaign' => $c->slug,
            'game' => $c->isScratch() ? 'scratch' : 'wheel',
            'design' => $design,
            'form' => $this->publicForm($form),
            // Dilimler yalnızca görsel sırada (ağırlık/stok/kupon şablonu GİZLİ)
            'slices' => $c->slices->map(fn (WheelSlice $s) => [
                'id' => $s->id,
                'label' => $s->label,
                'color' => $s->color,
            ])->values(),
        ];
        if ($c->isScratch()) {
            $sc = $c->scratchSettings();
            $out['scratch'] = ['valid_minutes' => $sc['valid_minutes'], 'skip_form' => $sc['skip_form']];
        }

        return $out;
    }

    /**
     * GET w/{slug}/wheel/{campaign}/coupon-status?code=XXX
     * Kazanılan kuponun hâlâ geçerli olup olmadığını döner. Widget, kulakçığı buna göre
     * gizler: kupon SÜRESİ DOLDUYSA veya KULLANILDIYSA (sipariş/ödeme) → active:false.
     */
    public function couponStatus(Request $request, string $slug, string $campaign): JsonResponse
    {
        $c = $this->resolveCampaign($slug, $campaign);
        $code = trim((string) $request->query('code', ''));
        if (! $c || $code === '') {
            return response()->json(['active' => false]);
        }

        $spin = WheelSpin::query()
            ->where('tenant_id', $c->tenant_id)
            ->where('wheel_campaign_id', $c->id)
            ->where('coupon_code', $code)
            ->first();

        if (! $spin) {
            return response()->json(['active' => false]);
        }

        // Süre doldu mu?
        if ($spin->coupon_expires_at && $spin->coupon_expires_at->isPast()) {
            return response()->json(['active' => false, 'reason' => 'expired']);
        }

        // Zaten kullanıldı (redemption sync / sipariş eşleşmesi) işaretliyse → gizle.
        if ($spin->coupon_status === WheelCouponStatus::Redeemed) {
            return response()->json(['active' => false, 'reason' => 'used']);
        }

        // Ticimax'ta oluşturulamamış (failed), kuponsuz veya süresi dolup pasifleştirilmiş → gizle.
        if (in_array($spin->coupon_status, [WheelCouponStatus::Failed, WheelCouponStatus::None, WheelCouponStatus::Expired], true)) {
            return response()->json(['active' => false, 'reason' => 'invalid']);
        }

        // Ticimax kuponu için canlı kullanım kontrolü (60sn cache'li — SOAP'ı yormaz).
        if ($spin->coupon_provider === 'ticimax') {
            $used = Cache::remember('wheel_coupon_used_' . $spin->id, 60, function () use ($c, $code) {
                $svc = $this->resolveTicimax($c->tenant_id);
                if (! $svc) {
                    return false;
                }
                $res = $svc->getGiftVoucher($code);
                if (! ($res['success'] ?? false)) {
                    return false;
                }
                $v = $res['voucher'];
                $qty = (int) ($v['Quantity'] ?? 0);
                $rem = (int) ($v['RemainingUse'] ?? 0);

                return $qty > 0 && $rem < $qty;
            });

            if ($used) {
                return response()->json(['active' => false, 'reason' => 'used']);
            }
        }

        return response()->json(['active' => true]);
    }

    private function resolveTicimax(int $tenantId): ?TicimaxService
    {
        $channel = \App\Models\Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'like', 'ticimax%')
            ->where('is_active', true)
            ->orderByRaw("CASE WHEN type = 'ticimax-ecommerce' THEN 0 ELSE 1 END")
            ->first();
        if (! $channel) {
            return null;
        }
        $s = TicimaxService::fromChannel($channel);

        return $s->isAvailable() ? $s : null;
    }

    /**
     * POST w/{slug}/wheel/{campaign}/spin
     * Body: full_name?, email?, phone?, kvkk_consent, fingerprint?, source_url?
     */
    public function spin(Request $request, string $slug, string $campaign): JsonResponse
    {
        $c = $this->resolveCampaign($slug, $campaign);
        if (! $c) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $preview = $this->isPreview($request, $c);
        if (! $preview && ! $c->isLiveNow()) {
            return response()->json(['error' => 'Kampanya aktif değil.'], 422);
        }

        // Anti-bot honeypot: gizli alan dolu geldiyse otomasyon → sessizce reddet (lead/kupon üretme).
        // Loglanır: tarayıcı autofill'i gerçek kullanıcıları da yakalayabiliyor (widget'ta readOnly
        // ile önlendi) — tekrar artarsa buradan teşhis edilir.
        if (trim((string) $request->input('hp', '')) !== '') {
            \Log::warning('[wheel] spin honeypot reject', [
                'ip' => $request->ip(),
                'ua' => substr((string) $request->userAgent(), 0, 160),
            ]);

            return response()->json(['error' => 'Geçersiz istek.'], 422);
        }

        $form = array_merge(config('wheel.default_form'), $c->form_fields ?? []);

        // Form alanları kampanya ayarına göre doğrulanır (sunucu tarafı = asıl güvenlik katmanı).
        // Ad yalnızca harf/boşluk/.- ; telefon yalnızca rakam ve ayraçlar.
        $nameRule = ['string', 'max:190', 'regex:/^[\pL\s.\-]+$/u'];
        $phoneRule = ['string', 'max:32', 'regex:/^[0-9 ()+\-]+$/'];
        // Kazı kazan "formsuz" modu: kişisel veri toplanmaz → alanlar zorunlu değil, KVKK/ileti
        // onayı istenmez. Hile kilidi parmak izi + IP ile (aşağıda).
        // Oyun türü kampanyanın kendisinden (client'ın gönderdiği 'variant' yok sayılır).
        $variant = $c->isScratch() ? 'scratch' : 'wheel';
        $formless = $c->isScratch() && $c->scratchSettings()['skip_form'];

        $rules = ['fingerprint' => 'nullable|string|max:128', 'source_url' => 'nullable|string|max:512'];
        $rules['full_name'] = array_merge([(! $formless && $form['collect_name'] && $form['require_name']) ? 'required' : 'nullable'], $nameRule);
        $rules['email'] = (! $formless && $form['collect_email'] && $form['require_email']) ? 'required|email|max:190' : 'nullable|email|max:190';
        $rules['phone'] = array_merge([(! $formless && $form['collect_phone'] && $form['require_phone']) ? 'required' : 'nullable'], $phoneRule);

        try {
            $data = $request->validate($rules);
        } catch (\Illuminate\Validation\ValidationException $e) {
            // Hangi alanın takıldığını logla — "çeviremedik" şikayetlerinin teşhisi
            // (ör. Türkçe karakterli e-posta widget'tan geçip burada takılıyordu).
            \Log::warning('[wheel] spin validation reject', [
                'fields' => array_keys($e->errors()),
                'ip' => $request->ip(),
                'ua' => substr((string) $request->userAgent(), 0, 160),
            ]);

            throw $e;
        }

        $email = $data['email'] ?? null;
        $phone = $data['phone'] ?? null;
        $fingerprint = $data['fingerprint'] ?? null;
        // Telefon: en az 10 rakam (TR cep/numara) — ayraçlar temizlenip kontrol edilir.
        if ($phone !== null && $phone !== '') {
            $digits = preg_replace('/\D+/', '', $phone);
            if (strlen($digits) < 10 || strlen($digits) > 13) {
                return response()->json(['error' => 'Geçerli bir telefon numarası girin.'], 422);
            }
            // DB'ye düz rakam kaydet (maske/ayraç YOK). TR numarası → son 10 hane
            // (baştaki 0 / 90 / +90 atılır): "543 491 66 52" → "5434916652".
            $phone = substr($digits, -10);
        }

        // KVKK açık rıza (kişisel veri işleme)
        $consent = filter_var($request->input('kvkk_consent'), FILTER_VALIDATE_BOOLEAN);
        if (! $formless && $form['kvkk_required'] && ! $consent) {
            return response()->json(['error' => 'Devam etmek için KVKK onayı gereklidir.'], 422);
        }

        // Ticari ileti izni (SMS/e-posta/WhatsApp) — KVKK'dan ayrı
        $commsConsent = filter_var($request->input('comms_consent'), FILTER_VALIDATE_BOOLEAN);
        if (! $formless && ($form['comms_required'] ?? true) && ! $commsConsent) {
            return response()->json(['error' => 'Devam etmek için ileti iznini onaylayın.'], 422);
        }

        // Formsuz kazı kazanda ek hile kilidi: aynı IP'den son 24 saatte formsuz kazı kazan
        // yapıldıysa yeni kupon YOK (parmak izi localStorage silinince değişir; IP tek sabit).
        if ($formless && ! $preview && ! $fingerprint) {
            return response()->json(['error' => 'Geçersiz istek.'], 422);
        }
        if ($formless && ! $preview) {
            // Operatör ağlarında (CGNAT) bir IP'yi onlarca kişi paylaşır → kilit IP + tarayıcı (UA)
            // birlikte. Eşleşmede BAŞKASININ kupon kodu ASLA döndürülmez: kod olmadan already_spun
            // → widget hiçbir şey göstermez (kendi kodu zaten kulakçığında/localStorage'ında).
            $priorIp = WheelSpin::query()
                ->where('tenant_id', $c->tenant_id)
                ->where('wheel_campaign_id', $c->id)
                ->where('variant', 'scratch')
                ->where('is_test', false) // panel testleri gerçek ziyaretçiyi kilitlemesin
                ->where('ip_address', $request->ip())
                ->where('created_at', '>', now()->subHours((int) config('wheel.scratch.ip_dedup_hours', 24)))
                ->whereHas('lead', fn ($l) => $l->where('user_agent', substr((string) $request->userAgent(), 0, 512)))
                ->latest('id')
                ->first();
            if ($priorIp) {
                $view = $this->spinResultView($c, $priorIp);
                $view['coupon_code'] = null;
                $view['coupon_expires_at'] = null;

                return response()->json(['already_spun' => true, 'result' => $view], 200);
            }
        }

        // ── ÖNİZLEME/TEST (panelden) GERÇEK akış gibi: is_test işaretli kayıt + gerçek
        //    Ticimax kuponu üretir; ama dedup/stok/frekans atlanır (sınırsız test). Test
        //    kayıtları raporlara karılmaz ve "Test verilerini temizle" ile silinir. ──

        // ── Kişi başı tek çevirme (hile kilidi) — testte atlanır ──
        // Hızlı yol: transaction'a girmeden önce kontrol (yaygın durum). ASIL garanti
        // transaction İÇİNDE (dilim kilidi sonrası) tekrar yapılır → eşzamanlı çift-tık yarışı kapanır.
        if (! $preview) {
            $prior = $this->findPriorSpin($c, $email, $phone, $fingerprint);
            if ($prior) {
                return response()->json([
                    'already_spun' => true,
                    'result' => $this->spinResultView($c, $prior),
                ], 200);
            }
        }

        // ── Atomik çevirme: dilimleri kilitle, seç, stok düş, kaydet ──
        try {
            $result = DB::transaction(function () use ($c, $request, $email, $phone, $fingerprint, $consent, $commsConsent, $form, $data, $preview, $variant) {
                $slices = WheelSlice::query()
                    ->where('tenant_id', $c->tenant_id)
                    ->where('wheel_campaign_id', $c->id)
                    ->orderBy('sort_order')
                    ->lockForUpdate()
                    ->get();

                // Yarış koşulu kilidi: dilim lock'u eşzamanlı çevirmeleri sıraya sokar; burada
                // tekrar kontrol edince ikinci istek, ilkinin commit'lediği çevirmeyi görür.
                if (! $preview) {
                    $prior = $this->findPriorSpin($c, $email, $phone, $fingerprint);
                    if ($prior) {
                        return ['already' => true, 'spin' => $prior];
                    }
                }

                $chosen = $this->engine->pick($slices);
                if (! $chosen) {
                    return null;
                }

                // Stok düş (limit varsa) — test çevirmesinde gerçek stok TÜKETİLMEZ.
                if (! $preview && $chosen->stock_limit !== null) {
                    $chosen->increment('stock_used');
                }

                $lead = WheelLead::create([
                    'tenant_id' => $c->tenant_id,
                    'wheel_campaign_id' => $c->id,
                    'is_test' => $preview,
                    'full_name' => $data['full_name'] ?? null,
                    'email' => $email,
                    'phone' => $phone,
                    'kvkk_consent' => $consent,
                    'kvkk_consent_version' => $consent ? ($form['kvkk_version'] ?? null) : null,
                    'kvkk_consent_text' => $consent ? ($form['kvkk_text'] ?? null) : null,
                    'kvkk_consent_at' => $consent ? now() : null,
                    'comms_consent' => $commsConsent,
                    'comms_consent_text' => $commsConsent ? ($form['comms_text'] ?? null) : null,
                    'comms_consent_at' => $commsConsent ? now() : null,
                    // varchar(255) — uzun URL'lerde (ör. önizleme token'lı URL) taşmasın.
                    'source_url' => substr((string) ($data['source_url'] ?? $request->header('Referer') ?? ''), 0, 255) ?: null,
                    'ip_address' => $request->ip(),
                    'user_agent' => substr((string) $request->userAgent(), 0, 512),
                    'device_fingerprint' => $fingerprint,
                ]);

                // Kod + (ticimax modunda) gönderilecek payload hazırlanır. Gerçek SOAP
                // yazımı transaction DIŞINDA (commit sonrası) yapılır — kilit kısa kalsın,
                // rollback'te Ticimax'ta öksüz kupon oluşmasın.
                $coupon = $this->issuer->prepare($c, $chosen, $variant);

                $spin = WheelSpin::create([
                    'tenant_id' => $c->tenant_id,
                    'wheel_campaign_id' => $c->id,
                    'wheel_lead_id' => $lead->id,
                    'wheel_slice_id' => $chosen->id,
                    'is_test' => $preview,
                    'variant' => $variant,
                    'prize_label' => $chosen->label,
                    'prize_type' => $chosen->prize_type,
                    'prize_value' => $chosen->prize_value,
                    'is_win' => $chosen->prize_type->isWinning(),
                    'coupon_code' => $coupon['code'],
                    'coupon_provider' => $coupon['provider'],
                    'coupon_status' => $coupon['status'],
                    'coupon_expires_at' => $coupon['expires_at'],
                    'ip_address' => $request->ip(),
                    'device_fingerprint' => $fingerprint,
                    // Pending ticimax kuponunun payload'ı — push/retry buradan okur.
                    'metadata' => $coupon['request'] ? ['ticimax_request' => $coupon['request']] : null,
                ]);

                return ['already' => false, 'spin' => $spin];
            });
        } catch (\Throwable $e) {
            report($e);

            return response()->json(['error' => 'Çevirme sırasında bir hata oluştu, lütfen tekrar deneyin.'], 500);
        }

        if (! $result) {
            return response()->json(['error' => 'Şu anda çevrilebilir ödül kalmadı.'], 422);
        }

        // Eşzamanlı yarış: transaction içinde önceki çevirme bulunduysa onu döndür (yeni kupon YOK).
        if ($result['already']) {
            return response()->json([
                'already_spun' => true,
                'result' => $this->spinResultView($c, $result['spin']),
            ], 200);
        }

        $spin = $result['spin'];

        // ── Commit sonrası: Ticimax'a gerçek hediye çeki yaz (senkron, hata→retry job) ──
        if ($spin->coupon_status === WheelCouponStatus::Pending && $spin->coupon_provider === 'ticimax') {
            try {
                if (! $this->issuer->pushToTicimax($spin)) {
                    IssueWheelCoupon::dispatch($spin->id);
                }
            } catch (\Throwable $e) {
                report($e);
                IssueWheelCoupon::dispatch($spin->id);
            }
            $spin->refresh();
        }

        return response()->json([
            'already_spun' => false,
            'preview' => $preview,
            'result' => $this->spinResultView($c, $spin),
        ], 201);
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    /**
     * Panelden gelen kısa ömürlü imzalı önizleme token'ı geçerli mi?
     * Geçerliyse: taslak kampanya gösterilir, çevirme kaydedilmez, dedup atlanır.
     */
    private function isPreview(Request $request, WheelCampaign $c): bool
    {
        $token = (string) ($request->input('preview_token') ?: $request->query('preview_token', ''));
        if ($token === '') {
            return false;
        }
        try {
            $data = json_decode(Crypt::decryptString($token), true);
        } catch (\Throwable) {
            return false;
        }
        if (! is_array($data) || ($data['exp'] ?? 0) < now()->timestamp) {
            return false;
        }

        if ((int) ($data['t'] ?? 0) !== (int) $c->tenant_id) {
            return false;
        }
        if ((int) ($data['c'] ?? 0) === (int) $c->id) {
            return true;
        }
        // A/B kampanyasının önizleme token'ı A ve B oyun kampanyaları için de geçerli
        // (panelde "A'yı / B'yi test et": spin ilgili oyun kampanyasına gider, is_test).
        $owner = WheelCampaign::query()->where('tenant_id', $c->tenant_id)->find((int) ($data['c'] ?? 0));
        if (! $owner || ! $owner->isAb()) {
            return false;
        }
        $ab = $owner->abSettings();

        return in_array((int) $c->id, [(int) $ab['a_campaign_id'], (int) $ab['b_campaign_id']], true);
    }

    private function resolveCampaign(string $slug, string $campaignSlug): ?WheelCampaign
    {
        $tenant = Tenant::where('slug', $slug)->where('is_active', true)->first();
        if (! $tenant) {
            return null;
        }

        return WheelCampaign::query()
            ->where('tenant_id', $tenant->id)
            ->where('slug', $campaignSlug)
            ->with(['slices' => fn ($q) => $q->orderBy('sort_order')])
            ->first();
    }

    /** Aynı kişinin (email/telefon/parmak izi) bu kampanyadaki önceki çevirmesi. */
    private function findPriorSpin(WheelCampaign $c, ?string $email, ?string $phone, ?string $fingerprint): ?WheelSpin
    {
        $normPhone = $phone ? preg_replace('/\D+/', '', $phone) : null;

        return WheelSpin::query()
            ->where('tenant_id', $c->tenant_id)
            ->where('wheel_campaign_id', $c->id)
            ->where(function ($q) use ($email, $normPhone, $fingerprint) {
                $matched = false;
                if ($fingerprint) {
                    $q->orWhere('device_fingerprint', $fingerprint);
                    $matched = true;
                }
                if ($email || $normPhone) {
                    $q->orWhereHas('lead', function ($l) use ($email, $normPhone) {
                        $l->where(function ($w) use ($email, $normPhone) {
                            if ($email) {
                                $w->orWhereRaw('LOWER(email) = ?', [strtolower($email)]);
                            }
                            if ($normPhone && strlen($normPhone) >= 10) {
                                $w->orWhereRaw("RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = ?", [substr($normPhone, -10)]);
                            }
                        });
                    });
                    $matched = true;
                }
                if (! $matched) {
                    // Hiç eşleştirme anahtarı yoksa (anonim) → önceki çevirme bulunamaz
                    $q->whereRaw('1 = 0');
                }
            })
            ->latest('id')
            ->first();
    }

    private function spinResultView(WheelCampaign $c, WheelSpin $spin): array
    {
        // Kazanan dilimin görsel sırada indeksi (frontend animasyonu için)
        $index = $c->slices->search(fn (WheelSlice $s) => $s->id === $spin->wheel_slice_id);
        $slice = $index === false ? null : $c->slices->get($index);

        return [
            'slice_id' => $spin->wheel_slice_id,
            'slice_index' => $index === false ? null : $index,
            'variant' => $spin->variant ?: 'wheel',
            'is_win' => (bool) $spin->is_win,
            'prize_label' => $spin->prize_label,
            // Dilim silinmişse 0 — widget yalnızca >0 iken minimum sepet notu gösterir.
            'min_basket' => $slice ? (float) $slice->min_basket : 0,
            'coupon_code' => $spin->coupon_status === WheelCouponStatus::None ? null : $spin->coupon_code,
            // ISO-8601 + offset → tarayıcı saat dilimi fark etmeksizin mutlak zamanı doğru
            // çözer (geri sayım tam 24 saat; aksi halde UTC naive string yerel sanılıp kayıyordu).
            'coupon_expires_at' => optional($spin->coupon_expires_at)->toIso8601String(),
        ];
    }

    private function publicTrigger(array $trigger): array
    {
        return [
            'type' => $trigger['type'] ?? 'delay',
            'delay_seconds' => (int) ($trigger['delay_seconds'] ?? 6),
            'device' => $trigger['device'] ?? 'all',
            'frequency_days' => (int) ($trigger['frequency_days'] ?? 7),
            'show_once_per_win' => (bool) ($trigger['show_once_per_win'] ?? true),
        ];
    }

    private function publicForm(array $form): array
    {
        return [
            'collect_name' => (bool) $form['collect_name'],
            'collect_email' => (bool) $form['collect_email'],
            'collect_phone' => (bool) $form['collect_phone'],
            'require_name' => (bool) $form['require_name'],
            'require_email' => (bool) $form['require_email'],
            'require_phone' => (bool) $form['require_phone'],
            'kvkk_required' => (bool) $form['kvkk_required'],
            'kvkk_text' => $form['kvkk_text'] ?? '',
            'comms_required' => (bool) ($form['comms_required'] ?? true),
            'comms_text' => $form['comms_text'] ?? '',
        ];
    }
}
