<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Models\MarketingCampaign;
use App\Models\MarketingCampaignRecipient;
use App\Models\MarketingList;
use App\Models\MarketingListContact;
use App\Models\MarketingSegment;
use App\Models\MarketingSuppression;
use App\Models\Tenant;
use App\Services\Marketing\CampaignDispatcher;
use App\Services\Marketing\EmailCampaignRenderer;
use App\Services\Marketing\UnifiedSender;
use App\Services\Marketing\WaCapacity;
use App\Services\Marketing\WaPhone;
use App\Services\SegmentService;
use App\Services\WhatsAppService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Toplu WhatsApp kampanyaları: müşteri listeleri + kampanya yaşam döngüsü +
 * 24s kapasite paneli + WABA şablon listeleme/oluşturma.
 */
class MarketingCampaignController extends Controller
{
    public function __construct(protected WhatsAppService $wa)
    {
    }

    // ---------------------------------------------------------------- kapasite

    /** GET /marketing/campaigns */
    public function index(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $s = $tenant->settings ?? [];
        $capacity = WaCapacity::summary($tenant->id, $s);

        $campaigns = MarketingCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn ($c) => $this->campaignPayload($c, $s, $capacity));

        // Kampanya hedef seçicisi için segmentler (sayımlar segment sayfasıyla ortak cache'ten)
        $segments = MarketingSegment::where('tenant_id', $tenant->id)
            ->orderBy('sort')->orderBy('id')
            ->get()
            ->map(fn (MarketingSegment $seg) => array_merge(
                ['id' => $seg->id, 'name' => $seg->name],
                SegmentService::cachedCounts($tenant->id, $seg),
            ));

        return response()->json([
            'campaigns' => $campaigns,
            'segments' => $segments,
            'email' => [
                'enabled' => ! empty($s['email_enabled']) && ! empty($s['email_from_address']),
                'from' => $s['email_from_address'] ?? null,
                'daily_limit' => CampaignDispatcher::emailDailyLimit($s),
                'sent_today' => CampaignDispatcher::emailSentToday($tenant->id),
            ],
            'capacity' => $capacity,
            'settings' => [
                'wa_daily_unique_limit' => WaCapacity::limit($s),
                'wa_reserve_for_automations' => WaCapacity::reserve($s),
                'email_daily_limit' => CampaignDispatcher::emailDailyLimit($s),
            ],
            'limit_sync' => [
                'tier' => $s['wa_limit_tier'] ?? null,
                'synced_at' => $s['wa_limit_synced_at'] ?? null,
            ],
            'quality' => $this->phoneQuality($tenant->id),
            'quality_state' => \App\Services\Marketing\PhoneQualityGuard::state($tenant->id),
        ]);
    }

    // ---------------------------------------------------------------- karaliste

    /** GET /marketing/blacklist — WhatsApp karalistesi (suppression: whatsapp + all) */
    public function blacklist(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $q = trim((string) $request->query('q', ''));

        $rows = MarketingSuppression::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('channel', ['whatsapp', 'all'])
            ->when($q !== '', function ($query) use ($q) {
                $digits = preg_replace('/\D+/', '', $q);
                $query->where('identifier', 'like', '%'.($digits !== '' ? $digits : $q).'%');
            })
            ->orderByDesc('id')
            ->paginate(min(200, (int) $request->query('per_page', 50)));

        return response()->json(['blacklist' => $rows]);
    }

    /** POST /marketing/blacklist  {numbers_text} — satır başına bir numara */
    public function addBlacklist(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $data = $request->validate(['numbers_text' => 'required|string|max:500000']);

        $added = 0;
        $invalid = 0;
        foreach (preg_split('/\r\n|\r|\n|,|;/', $data['numbers_text']) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $phone = WaPhone::normalize($line);
            if (! $phone) {
                $invalid++;

                continue;
            }
            MarketingSuppression::add($tenant->id, 'whatsapp', $phone, 'Panelden karalisteye eklendi', 'panel');
            $added++;
        }

        return response()->json(['added' => $added, 'invalid' => $invalid]);
    }

    /** DELETE /marketing/blacklist/{id} */
    public function removeBlacklist(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $row = MarketingSuppression::query()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($id);
        $row->delete();

        return response()->json(['ok' => true]);
    }

    /** PUT /marketing/campaign-settings */
    public function updateSettings(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $data = $request->validate([
            'wa_daily_unique_limit' => 'sometimes|integer|min:0|max:100000',
            'wa_reserve_for_automations' => 'sometimes|integer|min:0|max:20000',
            'email_daily_limit' => 'sometimes|integer|min:0|max:100000',
        ]);

        $s = $tenant->settings ?? [];
        foreach ($data as $k => $v) {
            $s[$k] = (int) $v;
        }
        $tenant->update(['settings' => $s]);

        return response()->json([
            'capacity' => WaCapacity::summary($tenant->id, $s),
            'settings' => [
                'wa_daily_unique_limit' => WaCapacity::limit($s),
                'wa_reserve_for_automations' => WaCapacity::reserve($s),
                'email_daily_limit' => CampaignDispatcher::emailDailyLimit($s),
            ],
        ]);
    }

    // ---------------------------------------------------------------- listeler

    /** GET /marketing/lists */
    public function lists(Request $request)
    {
        $tenant = $this->resolveTenant($request);

        $lists = MarketingList::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('id')
            ->get(['id', 'name', 'description', 'contacts_count', 'created_at']);

        return response()->json(['lists' => $lists]);
    }

    /** POST /marketing/lists  {name, description?, contacts_text?} */
    public function createList(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $data = $request->validate([
            'name' => 'required|string|max:150',
            'description' => 'nullable|string|max:500',
            'contacts_text' => 'nullable|string|max:2000000',
        ]);

        $list = MarketingList::create([
            'tenant_id' => $tenant->id,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
        ]);

        $import = ['added' => 0, 'invalid' => 0, 'duplicate' => 0, 'invalid_samples' => []];
        if (! empty($data['contacts_text'])) {
            $import = $this->importContacts($tenant->id, $list, $data['contacts_text']);
        }

        return response()->json(['list' => $list->fresh(), 'import' => $import]);
    }

    /** POST /marketing/lists/{id}/contacts  {contacts_text} */
    public function addContacts(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $list = MarketingList::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);
        $data = $request->validate(['contacts_text' => 'required|string|max:2000000']);

        $import = $this->importContacts($tenant->id, $list, $data['contacts_text']);

        return response()->json(['list' => $list->fresh(), 'import' => $import]);
    }

    /** POST /marketing/lists/{id}/fill-from-customers  {min_total_spent?, last_order_days?, limit?} */
    public function fillFromCustomers(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $list = MarketingList::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);
        $data = $request->validate([
            'min_total_spent' => 'nullable|numeric|min:0',
            'last_order_days' => 'nullable|integer|min:1|max:3650',
            'limit' => 'nullable|integer|min:1|max:50000',
        ]);

        $q = DB::table('customers')
            ->where('tenant_id', $tenant->id)
            ->whereRaw("length(regexp_replace(coalesce(phone,''), '\\D', '', 'g')) >= 10");
        if (! empty($data['min_total_spent'])) {
            $q->where('total_spent', '>=', (float) $data['min_total_spent']);
        }
        if (! empty($data['last_order_days'])) {
            $q->whereIn('id', function ($sub) use ($tenant, $data) {
                $sub->select('customer_id')->from('orders')
                    ->where('tenant_id', $tenant->id)
                    ->whereNotNull('customer_id')
                    ->where('order_date', '>=', now()->subDays((int) $data['last_order_days']));
            });
        }
        $customers = $q->orderByDesc('total_spent')
            ->limit((int) ($data['limit'] ?? 10000))
            ->get(['id', 'name', 'surname', 'phone']);

        $added = $invalid = 0;
        foreach ($customers->chunk(500) as $chunk) {
            $rows = [];
            foreach ($chunk as $c) {
                $phone = WaPhone::normalize($c->phone);
                if (! $phone) {
                    $invalid++;

                    continue;
                }
                $rows[$phone] = [
                    'tenant_id' => $tenant->id,
                    'list_id' => $list->id,
                    'phone' => $phone,
                    'name' => trim(($c->name ?? '').' '.($c->surname ?? '')) ?: null,
                    'customer_id' => $c->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            if ($rows) {
                $added += MarketingListContact::withoutGlobalScopes()->upsert(
                    array_values($rows), ['list_id', 'phone'], ['name', 'customer_id', 'updated_at']
                );
            }
        }
        $this->refreshListCount($list);

        return response()->json([
            'list' => $list->fresh(),
            'import' => ['added' => $added, 'invalid' => $invalid, 'duplicate' => 0, 'invalid_samples' => []],
        ]);
    }

    /** GET /marketing/lists/{id} */
    public function showList(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $list = MarketingList::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        $contacts = MarketingListContact::withoutGlobalScopes()
            ->where('list_id', $list->id)
            ->orderBy('id')
            ->paginate(min(200, (int) $request->query('per_page', 50)));

        return response()->json(['list' => $list, 'contacts' => $contacts]);
    }

    /** DELETE /marketing/lists/{id} */
    public function deleteList(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $list = MarketingList::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        $inUse = MarketingCampaign::withoutGlobalScopes()
            ->where('list_id', $list->id)
            ->whereIn('status', ['sending', 'paused'])
            ->exists();
        if ($inUse) {
            return response()->json(['message' => 'Bu liste aktif bir kampanyada kullanılıyor, önce kampanyayı bitirin.'], 422);
        }
        $list->delete();

        return response()->json(['ok' => true]);
    }

    // ---------------------------------------------------------------- kampanyalar

    /** POST /marketing/campaigns */
    public function store(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $data = $this->validateCampaign($request);

        $channel = in_array($data['channel'] ?? 'whatsapp', ['whatsapp', 'email'], true)
            ? ($data['channel'] ?? 'whatsapp') : 'whatsapp';
        unset($data['channel']);

        if ($channel === 'email' && empty($data['segment_id'])) {
            return response()->json(['message' => 'E-posta kampanyası için segment seçin.'], 422);
        }
        if ($channel === 'whatsapp' && empty($data['list_id']) && empty($data['segment_id'])) {
            return response()->json(['message' => 'Hedef olarak liste veya segment seçin.'], 422);
        }
        if (! empty($data['segment_id'])) {
            $ok = MarketingSegment::where('tenant_id', $tenant->id)->whereKey($data['segment_id'])->exists();
            if (! $ok) {
                return response()->json(['message' => 'Segment bulunamadı.'], 422);
            }
        }

        $campaign = MarketingCampaign::create(array_merge($data, [
            'tenant_id' => $tenant->id,
            'channel' => $channel,
            'status' => 'draft',
        ]));

        return response()->json(['campaign' => $this->campaignPayload($campaign)]);
    }

    /** POST /marketing/campaigns/{id}/test-email  {to} — içeriği gerçek akışla test adresine yollar */
    public function testEmail(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $campaign = MarketingCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        if ($campaign->channel !== 'email') {
            return response()->json(['message' => 'Yalnız e-posta kampanyalarında test gönderilebilir.'], 422);
        }
        if (trim((string) $campaign->subject) === '' || trim((string) $campaign->body_html) === '') {
            return response()->json(['message' => 'Önce konu ve içeriği kaydedin.'], 422);
        }
        $data = $request->validate(['to' => 'required|email']);

        $token = \Illuminate\Support\Str::random(40);
        $rendered = EmailCampaignRenderer::render($campaign, 'Test Alıcısı', $data['to'], $token);

        $msg = app(UnifiedSender::class)->send($tenant->id, 'email', $data['to'], [
            'subject' => '[TEST] '.$rendered['subject'],
            'html' => $rendered['html'],
            'body' => $rendered['body'],
            'unsubscribe_url' => $rendered['unsubscribe_url'],
        ], [
            'source' => 'campaign-test:'.$campaign->id,
            'source_type' => 'manual',
            'tracking_token' => $token,
            'skip_gates' => true,
        ]);

        if ($msg->status !== 'sent') {
            return response()->json(['message' => $msg->error ?: ('Gönderilemedi ('.$msg->skip_reason.')')], 422);
        }

        return response()->json(['ok' => true]);
    }

    /** GET /marketing/campaigns/{id} */
    public function show(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $campaign = MarketingCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        $status = $request->query('status');
        $q = trim((string) $request->query('q', ''));

        $recipients = MarketingCampaignRecipient::withoutGlobalScopes()
            ->where('campaign_id', $campaign->id)
            ->when($status === 'clicked', function ($query) {
                $query->whereIn('message_id', fn ($sub) => $sub->select('id')
                    ->from('marketing_messages')->whereNotNull('clicked_at'));
            }, function ($query) use ($status) {
                $query->when($status === 'converted', fn ($qq) => $qq->whereNotNull('converted_at'))
                    ->when(in_array($status, ['pending', 'sent', 'skipped', 'failed'], true),
                        fn ($qq) => $qq->where('status', $status));
            })
            ->when($q !== '', function ($query) use ($q) {
                $digits = preg_replace('/\D+/', '', $q);
                $query->where(function ($qq) use ($q, $digits) {
                    $qq->where('name', 'ilike', "%{$q}%")
                        ->orWhere('email', 'ilike', "%{$q}%");
                    if ($digits !== '') {
                        $qq->orWhere('phone', 'like', "%{$digits}%");
                    }
                });
            })
            ->with('message:id,delivered_at,opened_at,clicked_at,error,skip_reason')
            ->orderBy('id')
            ->paginate(min(200, (int) $request->query('per_page', 50)));

        return response()->json([
            'campaign' => $this->campaignPayload($campaign),
            'recipients' => $recipients,
        ]);
    }

    /** PUT /marketing/campaigns/{id} — alan güncelleme (draft) ve/veya action: start|pause|resume|cancel */
    public function update(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $campaign = MarketingCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        $action = $request->input('action');

        if (! $action || $request->hasAny(['name', 'list_id', 'segment_id', 'template_name', 'template_params', 'url_button', 'coupon_code', 'subject', 'body_html', 'send_window_hours', 'cooldown_days', 'attribution_days'])) {
            if (! in_array($campaign->status, ['draft', 'paused'], true)) {
                if (! $action) {
                    return response()->json(['message' => 'Yalnız taslak veya duraklatılmış kampanya düzenlenebilir.'], 422);
                }
            } else {
                $campaign->update($this->validateCampaign($request, partial: true));
            }
        }

        if ($action) {
            $err = $this->applyAction($tenant, $campaign, $action);
            if ($err) {
                return response()->json(['message' => $err], 422);
            }
        }

        return response()->json(['campaign' => $this->campaignPayload($campaign->fresh())]);
    }

    /** DELETE /marketing/campaigns/{id} — yalnız draft/cancelled */
    public function destroy(Request $request, int $id)
    {
        $tenant = $this->resolveTenant($request);
        $campaign = MarketingCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->findOrFail($id);

        if (! in_array($campaign->status, ['draft', 'cancelled'], true)) {
            return response()->json(['message' => 'Yalnız taslak veya iptal edilmiş kampanya silinebilir.'], 422);
        }
        $campaign->delete();

        return response()->json(['ok' => true]);
    }

    // ---------------------------------------------------------------- şablonlar

    /** GET /marketing/wa-templates */
    public function templates(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $fresh = $request->boolean('fresh');

        $key = "wa_templates_{$tenant->id}";
        if ($fresh) {
            Cache::forget($key);
        }
        $data = Cache::remember($key, 300, function () use ($tenant) {
            [$wabaId, $token] = $this->wabaCredentials($tenant->id);
            if (! $wabaId || ! $token) {
                return ['success' => false, 'error' => 'WhatsApp kanalı yapılandırılmamış', 'data' => []];
            }

            return $this->wa->listTemplates($wabaId, $token);
        });

        return response()->json($data);
    }

    /** POST /marketing/wa-templates — MARKETING şablonu oluşturur (Meta onayına gider) */
    public function createTemplate(Request $request)
    {
        $tenant = $this->resolveTenant($request);
        $data = $request->validate([
            'name' => 'required|string|max:120|regex:/^[a-z0-9_]+$/',
            'body_text' => 'required|string|max:1024',
            'example_params' => 'nullable|array|max:10',
            'example_params.*' => 'string|max:100',
            'footer_text' => 'nullable|string|max:60',
            'button_text' => 'nullable|string|max:25',
            'optout_button' => 'sometimes|boolean',
        ]);

        [$wabaId, $token] = $this->wabaCredentials($tenant->id);
        if (! $wabaId || ! $token) {
            return response()->json(['message' => 'WhatsApp kanalı yapılandırılmamış'], 422);
        }

        $components = [];
        $body = ['type' => 'BODY', 'text' => $data['body_text']];
        if (! empty($data['example_params'])) {
            $body['example'] = ['body_text' => [array_values($data['example_params'])]];
        }
        $components[] = $body;
        if (! empty($data['footer_text'])) {
            $components[] = ['type' => 'FOOTER', 'text' => $data['footer_text']];
        }
        $buttons = [];
        if (! empty($data['button_text'])) {
            // Dinamik URL butonu → tık takibi (/e/c/{token})
            $buttons[] = [
                'type' => 'URL',
                'text' => $data['button_text'],
                'url' => 'https://hub.yunbi.ai/e/c/{{1}}',
                'example' => ['https://hub.yunbi.ai/e/c/ornek123token'],
            ];
        }
        if (! empty($data['optout_button'])) {
            // Hızlı yanıt: basılınca gelen mesaj panele düşer + numara otomatik karalisteye girer
            $buttons[] = ['type' => 'QUICK_REPLY', 'text' => 'Listeden Çık'];
        }
        if ($buttons) {
            $components[] = ['type' => 'BUTTONS', 'buttons' => $buttons];
        }

        $res = $this->wa->createTemplate($wabaId, $token, [
            'name' => $data['name'],
            'category' => 'MARKETING',
            'language' => 'tr',
            'allow_category_change' => true,
            'components' => $components,
        ]);

        if (empty($res['success'])) {
            $err = $res['error']['error']['error_user_msg']
                ?? $res['error']['error']['message']
                ?? 'Şablon oluşturulamadı';

            return response()->json(['message' => $err, 'error' => $res['error'] ?? null], 422);
        }
        Cache::forget("wa_templates_{$tenant->id}");

        return response()->json(['ok' => true, 'data' => $res['data']]);
    }

    // ---------------------------------------------------------------- iç yardımcılar

    protected function validateCampaign(Request $request, bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        $data = $request->validate([
            'name' => "{$req}|string|max:150",
            'channel' => 'sometimes|in:whatsapp,email',
            'list_id' => 'sometimes|nullable|integer',
            'segment_id' => 'sometimes|nullable|integer',
            'subject' => 'sometimes|nullable|string|max:255',
            'body_html' => 'sometimes|nullable|string|max:300000',
            'template_name' => 'sometimes|nullable|string|max:190',
            'template_lang' => 'sometimes|string|max:10',
            'template_params' => 'sometimes|array|max:10',
            'template_params.*.source' => 'required_with:template_params|in:name,coupon,static',
            'template_params.*.value' => 'nullable|string|max:200',
            'url_button' => 'sometimes|array',
            'url_button.enabled' => 'sometimes|boolean',
            'url_button.target_url' => 'nullable|url|max:500',
            'coupon_code' => 'nullable|string|max:64',
            'send_window_hours' => 'sometimes|integer|min:1|max:72',
            'cooldown_days' => 'sometimes|integer|min:0|max:90',
            'attribution_days' => 'sometimes|integer|min:1|max:30',
        ]);

        if (array_key_exists('coupon_code', $data) && $data['coupon_code'] !== null) {
            $data['coupon_code'] = trim($data['coupon_code']) ?: null;
        }

        return $data;
    }

    protected function applyAction(Tenant $tenant, MarketingCampaign $campaign, string $action): ?string
    {
        switch ($action) {
            case 'start':
                if (! in_array($campaign->status, ['draft', 'paused'], true)) {
                    return 'Kampanya bu durumda başlatılamaz.';
                }
                if ($campaign->status === 'draft') {
                    if ($campaign->channel === 'email') {
                        if (trim((string) $campaign->subject) === '' || trim((string) $campaign->body_html) === '') {
                            return 'Önce e-posta konusunu ve içeriğini girin.';
                        }
                        $s = $tenant->settings ?? [];
                        if (empty($s['email_enabled']) || empty($s['email_from_address'])) {
                            return 'E-posta kanalı kapalı — Pazarlama Ayarları\'ndan gönderici adresini tanımlayıp kanalı açın.';
                        }
                    } else {
                        if (! $campaign->template_name) {
                            return 'Önce şablon seçin.';
                        }
                        // Boş değişken Meta'da hata üretir — baştan engelle
                        foreach ($campaign->template_params ?? [] as $i => $p) {
                            $src = $p['source'] ?? 'static';
                            if ($src === 'static' && trim((string) ($p['value'] ?? '')) === '') {
                                return 'Şablon değişkeni {{'.($i + 1).'}} boş. Sabit metin girin veya kaynağını "Müşteri adı"/"Kupon kodu" yapın.';
                            }
                            if ($src === 'coupon' && ! trim((string) $campaign->coupon_code)) {
                                return 'Şablon değişkeni {{'.($i + 1).'}} kupon koduna bağlı ama kampanyada kupon kodu yok.';
                            }
                        }
                        $tplErr = $this->assertTemplateApproved($tenant->id, $campaign);
                        if ($tplErr) {
                            return $tplErr;
                        }
                    }
                    $count = $this->snapshotRecipients($campaign);
                    if ($count === 0) {
                        return $campaign->channel === 'email'
                            ? 'Segmentte geçerli e-posta adresi yok.'
                            : 'Hedefte geçerli telefon numarası yok.';
                    }
                    $campaign->update([
                        'status' => 'sending',
                        'started_at' => now(),
                        'recipients_total' => $count,
                        'paused_reason' => null,
                    ]);
                } else {
                    $campaign->update(['status' => 'sending', 'paused_reason' => null]);
                }

                return null;

            case 'pause':
                if ($campaign->status !== 'sending') {
                    return 'Yalnız gönderimdeki kampanya duraklatılabilir.';
                }
                $campaign->update(['status' => 'paused', 'paused_reason' => 'Kullanıcı duraklattı']);

                return null;

            case 'resume':
                if ($campaign->status !== 'paused') {
                    return 'Yalnız duraklatılmış kampanya devam ettirilebilir.';
                }
                $campaign->update(['status' => 'sending', 'paused_reason' => null]);

                return null;

            case 'cancel':
                if (in_array($campaign->status, ['completed', 'cancelled'], true)) {
                    return 'Kampanya zaten bitmiş.';
                }
                MarketingCampaignRecipient::withoutGlobalScopes()
                    ->where('campaign_id', $campaign->id)
                    ->where('status', 'pending')
                    ->update(['status' => 'skipped', 'skip_reason' => 'campaign_cancelled']);
                $campaign->update(['status' => 'cancelled']);

                return null;
        }

        return 'Bilinmeyen işlem.';
    }

    /** Kampanya başlarken hedef (liste veya segment) alıcı tablosuna kopyalanır. */
    protected function snapshotRecipients(MarketingCampaign $campaign): int
    {
        if ($campaign->segment_id) {
            return $this->snapshotFromSegment($campaign);
        }

        $contacts = MarketingListContact::withoutGlobalScopes()
            ->where('list_id', $campaign->list_id)
            ->orderBy('id')
            ->get(['phone', 'name', 'customer_id']);

        $rows = [];
        foreach ($contacts as $c) {
            $phone = WaPhone::normalize($c->phone);
            if (! $phone) {
                continue;
            }
            $rows[$phone] = [
                'tenant_id' => $campaign->tenant_id,
                'campaign_id' => $campaign->id,
                'phone' => $phone,
                'name' => $c->name,
                'customer_id' => $c->customer_id,
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        foreach (array_chunk(array_values($rows), 500) as $chunk) {
            MarketingCampaignRecipient::withoutGlobalScopes()->upsert(
                $chunk, ['campaign_id', 'phone'], ['name', 'customer_id', 'updated_at']
            );
        }

        return count($rows);
    }

    /**
     * Segmentten alıcı anlık görüntüsü — kanal WA ise telefonlular, e-posta ise
     * e-postalılar. Büyük segmentler (300k+) için tek insert...select ile yazılır;
     * telefon/e-posta profillerde tenant bazında zaten tekildir.
     */
    protected function snapshotFromSegment(MarketingCampaign $campaign): int
    {
        $segment = MarketingSegment::where('tenant_id', $campaign->tenant_id)
            ->find($campaign->segment_id);
        if (! $segment) {
            return 0;
        }

        $q = SegmentService::query($campaign->tenant_id, (array) ($segment->definition ?? []));
        $t = (int) $campaign->tenant_id;
        $cid = (int) $campaign->id;

        if ($campaign->channel === 'email') {
            $q->whereNotNull('email')
                ->selectRaw("{$t}, {$cid}, email, name, 'pending', now(), now()");
            $cols = ['tenant_id', 'campaign_id', 'email', 'name', 'status', 'created_at', 'updated_at'];
        } else {
            $q->whereNotNull('phone')
                ->selectRaw("{$t}, {$cid}, phone, name, 'pending', now(), now()");
            $cols = ['tenant_id', 'campaign_id', 'phone', 'name', 'status', 'created_at', 'updated_at'];
        }

        DB::table('marketing_campaign_recipients')->insertUsing($cols, $q);

        return (int) MarketingCampaignRecipient::withoutGlobalScopes()
            ->where('campaign_id', $campaign->id)->count();
    }

    /** Şablon Meta'da APPROVED mı? API'ye ulaşılamazsa engellemez (log yeter). */
    protected function assertTemplateApproved(int $tenantId, MarketingCampaign $campaign): ?string
    {
        [$wabaId, $token] = $this->wabaCredentials($tenantId);
        if (! $wabaId || ! $token) {
            return 'WhatsApp kanalı yapılandırılmamış.';
        }
        $res = $this->wa->listTemplates($wabaId, $token);
        if (empty($res['success'])) {
            return null; // API erişilemedi → engelleme; gönderimde Meta zaten reddeder
        }
        foreach ($res['data'] as $tpl) {
            if (($tpl['name'] ?? '') === $campaign->template_name
                && ($tpl['language'] ?? '') === ($campaign->template_lang ?: 'tr')) {
                return ($tpl['status'] ?? '') === 'APPROVED'
                    ? null
                    : "Şablon henüz onaylı değil (durum: {$tpl['status']}). Onaylanınca başlatın.";
            }
        }

        return 'Şablon WABA\'da bulunamadı. Adı ve dili kontrol edin.';
    }

    protected function campaignPayload(MarketingCampaign $c, ?array $tenantSettings = null, ?array $capacity = null): array
    {
        $tenantSettings ??= Tenant::find($c->tenant_id)?->settings ?? [];
        $stats = MarketingCampaignRecipient::withoutGlobalScopes()
            ->where('campaign_id', $c->id)
            ->selectRaw("
                count(*) as total,
                count(*) filter (where status = 'pending') as pending,
                count(*) filter (where status = 'sent') as sent,
                count(*) filter (where status = 'skipped') as skipped,
                count(*) filter (where status = 'failed') as failed,
                count(*) filter (where converted_at is not null) as converted,
                count(*) filter (where coupon_used) as coupon_used,
                coalesce(sum(revenue), 0) as revenue
            ")
            ->first();

        $msgStats = DB::table('marketing_messages')
            ->where('tenant_id', $c->tenant_id)
            ->where('source', 'campaign:'.$c->id)
            ->selectRaw('
                count(*) filter (where delivered_at is not null) as delivered,
                count(*) filter (where opened_at is not null) as read,
                count(*) filter (where clicked_at is not null) as clicked
            ')
            ->first();

        // Bu kampanyanın alıcılarından şu an karalistede/çıkmış olanlar
        if ($c->channel === 'email') {
            $blacklisted = (int) DB::table('marketing_campaign_recipients as r')
                ->join('email_suppressions as s', function ($j) use ($c) {
                    $j->on('s.email', '=', 'r.email')->where('s.tenant_id', $c->tenant_id);
                })
                ->where('r.campaign_id', $c->id)
                ->count();
        } else {
            $blacklisted = (int) DB::table('marketing_campaign_recipients as r')
                ->join('marketing_suppressions as s', function ($j) use ($c) {
                    $j->on(DB::raw("right(regexp_replace(coalesce(r.phone, ''), '\\D', '', 'g'), 10)"), '=', 's.identifier')
                        ->where('s.tenant_id', $c->tenant_id)
                        ->whereIn('s.channel', ['whatsapp', 'all']);
                })
                ->where('r.campaign_id', $c->id)
                ->distinct('r.id')
                ->count('r.id');
        }

        $couponOrders = 0;
        if ($c->coupon_code && $c->started_at) {
            $couponOrders = DB::table('orders')
                ->where('tenant_id', $c->tenant_id)
                ->whereRaw('lower(coupon_code) = ?', [mb_strtolower(trim($c->coupon_code))])
                ->where('order_date', '>=', $c->started_at)
                ->count();
        }

        $listName = $c->list_id
            ? MarketingList::withoutGlobalScopes()->where('id', $c->list_id)->value('name')
            : null;
        $listCount = $c->list_id
            ? (int) MarketingListContact::withoutGlobalScopes()->where('list_id', $c->list_id)->count()
            : 0;

        // Segment hedefli kampanya: hedef adı segment, sayı kanala göre (tel/e-posta)
        $segmentName = null;
        if ($c->segment_id) {
            $segment = MarketingSegment::withoutGlobalScopes()
                ->where('tenant_id', $c->tenant_id)->find($c->segment_id);
            if ($segment) {
                $segmentName = $segment->name;
                $counts = SegmentService::cachedCounts($c->tenant_id, $segment);
                $listName = $segment->name.' (segment)';
                $listCount = $c->channel === 'email' ? $counts['with_email'] : $counts['with_phone'];
            }
        }

        // İlerleme + tahmini bitiş: günlük bütçe (WA: limit - rezerv; e-posta: günlük
        // e-posta limiti) pencere saatine yayılır; bugünkü kalan hak biterse artan günlere bölünür.
        $processed = (int) $stats->total - (int) $stats->pending;
        $progressPct = $stats->total > 0 ? (int) round($processed / $stats->total * 100) : 0;
        $etaAt = null;
        if ($c->status === 'sending' && (int) $stats->pending > 0) {
            if ($c->channel === 'email') {
                $dailyBudget = max(1, CampaignDispatcher::emailDailyLimit($tenantSettings));
                $todayRemaining = max(0, $dailyBudget - CampaignDispatcher::emailSentToday($c->tenant_id));
            } else {
                $dailyBudget = max(1, WaCapacity::limit($tenantSettings) - WaCapacity::reserve($tenantSettings));
                $todayRemaining = $capacity['remaining'] ?? WaCapacity::remainingForCampaigns($c->tenant_id, $tenantSettings);
            }
            $ratePerHour = $dailyBudget / max(1, (int) $c->send_window_hours);
            $todayCan = min((int) $stats->pending, max(0, $todayRemaining));
            $hoursToday = $ratePerHour > 0 ? $todayCan / $ratePerHour : 0;
            $restDays = (int) ceil(max(0, (int) $stats->pending - $todayCan) / $dailyBudget);
            $etaAt = now()->addMinutes((int) round($hoursToday * 60))->addDays($restDays)->toIso8601String();
        }

        return [
            'progress_pct' => $progressPct,
            'eta_at' => $etaAt,
            'id' => $c->id,
            'name' => $c->name,
            'channel' => $c->channel ?: 'whatsapp',
            'segment_id' => $c->segment_id,
            'segment_name' => $segmentName,
            'subject' => $c->subject,
            'body_html' => $c->body_html,
            'status' => $c->status,
            'paused_reason' => $c->paused_reason,
            'auto_paused_quality' => $c->status === 'paused'
                && $c->paused_reason === \App\Services\Marketing\PhoneQualityGuard::PAUSE_REASON,
            'list_id' => $c->list_id,
            'list_name' => $listName,
            'list_count' => $listCount,
            'template_name' => $c->template_name,
            'template_lang' => $c->template_lang,
            'template_params' => $c->template_params ?? [],
            'url_button' => $c->url_button ?? ['enabled' => false, 'target_url' => null],
            'coupon_code' => $c->coupon_code,
            'send_window_hours' => $c->send_window_hours,
            'cooldown_days' => $c->cooldown_days,
            'attribution_days' => $c->attribution_days,
            'recipients_total' => $c->recipients_total,
            'started_at' => $c->started_at?->toIso8601String(),
            'completed_at' => $c->completed_at?->toIso8601String(),
            'created_at' => $c->created_at?->toIso8601String(),
            'stats' => [
                'total' => (int) $stats->total,
                'pending' => (int) $stats->pending,
                'sent' => (int) $stats->sent,
                'skipped' => (int) $stats->skipped,
                'failed' => (int) $stats->failed,
                'delivered' => (int) ($msgStats->delivered ?? 0),
                'read' => (int) ($msgStats->read ?? 0),
                'clicked' => (int) ($msgStats->clicked ?? 0),
                'converted' => (int) $stats->converted,
                'coupon_used' => (int) $stats->coupon_used,
                'blacklisted' => $blacklisted,
                'revenue' => (float) $stats->revenue,
                'coupon_orders_total' => $couponOrders,
            ],
        ];
    }

    protected function wabaCredentials(int $tenantId): array
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'like', '%whatsapp%')
            ->where('is_active', true)
            ->first();
        if (! $channel) {
            return [null, null];
        }

        return [
            $channel->settings['business_account_id'] ?? null,
            $this->wa->getAccessToken($channel->credentials ?? []),
        ];
    }

    protected function phoneQuality(int $tenantId): array
    {
        // Tek kaynak: kalite bekçisiyle aynı cache'i paylaşır (10 dk).
        return \App\Services\Marketing\PhoneQualityGuard::info($tenantId);
    }

    /** İçe aktarma: satır başına "telefon[;|,|tab] isim". */
    protected function importContacts(int $tenantId, MarketingList $list, string $text): array
    {
        $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
        $rows = [];
        $invalid = 0;
        $invalidSamples = [];

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $parts = preg_split('/[;,\t]+/', $line, 2) ?: [$line];
            $phone = WaPhone::normalize($parts[0] ?? '');
            if (! $phone) {
                $invalid++;
                if (count($invalidSamples) < 5) {
                    $invalidSamples[] = mb_substr($line, 0, 40);
                }

                continue;
            }
            $name = isset($parts[1]) ? trim($parts[1]) : null;
            $rows[$phone] = ['phone' => $phone, 'name' => $name ?: ($rows[$phone]['name'] ?? null)];
        }

        if (count($rows) > 50000) {
            abort(422, 'Tek listede en fazla 50.000 kişi olabilir.');
        }

        $existing = MarketingListContact::withoutGlobalScopes()
            ->where('list_id', $list->id)
            ->whereIn('phone', array_keys($rows))
            ->pluck('phone')
            ->all();
        $duplicate = count($existing);

        // Müşteri eşleştirme (son 10 hane)
        $p10map = [];
        foreach ($rows as $phone => $r) {
            $p10map[substr($phone, -10)] = $phone;
        }
        $customerByPhone = [];
        foreach (array_chunk(array_keys($p10map), 500) as $chunk) {
            $found = DB::table('customers')
                ->where('tenant_id', $tenantId)
                ->whereIn(DB::raw("right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10)"), $chunk)
                ->orderBy('id')
                ->get(['id', DB::raw("right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) as p10")]);
            foreach ($found as $f) {
                $customerByPhone[$f->p10] ??= $f->id;
            }
        }

        $inserts = [];
        foreach ($rows as $phone => $r) {
            $inserts[] = [
                'tenant_id' => $tenantId,
                'list_id' => $list->id,
                'phone' => $phone,
                'name' => $r['name'],
                'customer_id' => $customerByPhone[substr($phone, -10)] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        foreach (array_chunk($inserts, 500) as $chunk) {
            MarketingListContact::withoutGlobalScopes()->upsert(
                $chunk, ['list_id', 'phone'], ['name', 'customer_id', 'updated_at']
            );
        }
        $this->refreshListCount($list);

        return [
            'added' => count($rows) - $duplicate,
            'duplicate' => $duplicate,
            'invalid' => $invalid,
            'invalid_samples' => $invalidSamples,
        ];
    }

    protected function refreshListCount(MarketingList $list): void
    {
        $list->update([
            'contacts_count' => MarketingListContact::withoutGlobalScopes()
                ->where('list_id', $list->id)->count(),
        ]);
    }

    protected function resolveTenant(Request $request): Tenant
    {
        $user = $request->user();
        $tenant = $user->tenant_id ? $user->tenant : Tenant::find($request->header('X-Tenant-Id'));
        abort_unless($tenant, 404, 'Tenant bulunamadı');

        return $tenant;
    }
}
