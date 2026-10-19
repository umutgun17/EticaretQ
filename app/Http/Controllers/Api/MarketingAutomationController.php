<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MarketingJourney;
use App\Models\MarketingMessage;
use App\Models\Tenant;
use App\Services\Marketing\CartRecoveryAutomation;
use App\Services\Marketing\WheelCouponReminder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Sepet kurtarma otomasyonu — panel ayarları + canlı istatistik (loglardan).
 * permission:settings.
 */
class MarketingAutomationController extends Controller
{
    public function cartRecovery(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        return response()->json([
            'settings' => $this->settingsPayload($tenant->settings ?? []),
            'stats' => $this->stats($tenant->id),
            'deliveries' => $this->deliveries($tenant->id),
        ]);
    }

    public function updateCartRecovery(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $data = $request->validate([
            'cart_recovery_enabled' => 'sometimes|boolean',
            'cart_recovery_coupon_amount' => 'sometimes|numeric|min:0|max:100000',
            'cart_recovery_coupon_min_basket' => 'sometimes|numeric|min:0|max:1000000',
            'cart_recovery_coupon_valid_hours' => 'sometimes|integer|min:1|max:720',
            'cart_recovery_coupon_mode' => 'sometimes|in:percent,fixed',
            'cart_recovery_coupon_percent' => 'sometimes|numeric|min:1|max:50',
            'cart_recovery_coupon_round' => 'sometimes|integer|min:5|max:500',
            'cart_recovery_process_limit' => 'sometimes|integer|min:0|max:1000',
            'cart_recovery_channels' => 'sometimes|array',
            'cart_recovery_channels.email' => 'sometimes|boolean',
            'cart_recovery_channels.sms' => 'sometimes|boolean',
            'cart_recovery_channels.whatsapp' => 'sometimes|boolean',
            'cart_recovery_delay_email' => 'sometimes|integer|min:5|max:10080',
            'cart_recovery_delay_sms' => 'sometimes|integer|min:5|max:10080',
            'cart_recovery_delay_whatsapp' => 'sometimes|integer|min:5|max:10080',
            'shop_url' => 'sometimes|nullable|string|max:255',
            'cart_url' => 'sometimes|nullable|string|max:255',
            'cart_recovery_sms_template' => 'sometimes|nullable|string|max:500',
            'cart_recovery_whatsapp_template' => 'sometimes|nullable|string|max:1000',
        ]);

        $s = $tenant->settings ?? [];
        foreach ($data as $k => $v) {
            $s[$k] = $v;
        }
        $tenant->update(['settings' => $s]);

        return response()->json(['settings' => $this->settingsPayload($s)]);
    }

    /**
     * GET — Full Otomasyon genel bakış: her otomasyon modülü için
     * durum + gönderim + dönüşüm + ciro (modül-modül kart/tablo için).
     */
    public function overview(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $tid = $tenant->id;
        $s = $tenant->settings ?? [];

        // Sepet Kurtarma — gönderim (marketing_messages) + dönüşüm/ciro (journeys)
        $crSent = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid)
            ->where('source', CartRecoveryAutomation::KEY)->where('status', 'sent')->count();
        $crConvBase = MarketingJourney::withoutGlobalScopes()->where('tenant_id', $tid)
            ->where('automation', CartRecoveryAutomation::KEY)
            ->where('status', 'converted')->where('current_step', '>', 0);
        $crConv = (clone $crConvBase)->count();
        $crRevenue = round((float) (clone $crConvBase)->where('stopped_reason', 'paid_with_coupon')->sum('revenue'), 2);

        // Çark Entegrasyonu — gönderim + dönüşüm/ciro (marketing_messages, test hariç)
        $whBase = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid)
            ->where('source', WheelCouponReminder::KEY)->where('source_type', '!=', 'test');
        $whSent = (clone $whBase)->where('status', 'sent')->count();
        $whConv = (clone $whBase)->whereNotNull('converted_at')->count();
        $whRevenue = round((float) (clone $whBase)->sum('revenue'), 2);

        $modules = [
            [
                'key' => 'cart_recovery',
                'name' => 'Sepet Kurtarma',
                'enabled' => (bool) ($s['cart_recovery_enabled'] ?? false),
                'sent' => $crSent,
                'conversions' => $crConv,
                'revenue' => $crRevenue,
            ],
            [
                'key' => 'wheel_coupon',
                'name' => 'Çark Entegrasyonu',
                'enabled' => (bool) ($s['wheel_reminder_enabled'] ?? false),
                'sent' => $whSent,
                'conversions' => $whConv,
                'revenue' => $whRevenue,
            ],
        ];

        // Sipariş Bilgilendirme — işlemsel bildirimler (alındı/kargoda/teslim; test hariç)
        $onSent = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid)
            ->where('source', 'order_status')->where('status', 'sent')
            ->where(fn ($q) => $q->whereNull('source_type')->orWhere('source_type', '!=', 'test'))
            ->count();
        $modules[] = [
            'key' => 'order_status',
            'name' => 'Sipariş Bilgilendirme',
            'enabled' => (bool) ($s['order_notify_enabled'] ?? false),
            'sent' => $onSent,
            'conversions' => 0,
            'revenue' => 0.0,
        ];

        return response()->json([
            'modules' => $modules,
            'totals' => [
                'sent' => $crSent + $whSent + $onSent,
                'conversions' => $crConv + $whConv,
                'revenue' => round($crRevenue + $whRevenue, 2),
            ],
        ]);
    }

    /** GET — Çark hatırlatma otomasyonu: ayarlar + istatistik. */
    public function wheelReminder(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $tid = $tenant->id;
        $s = $tenant->settings ?? [];

        // İstatistik: hatırlatılan kuponlar (wheel_spins.metadata) + dönüşüm
        $base = \App\Models\WheelSpin::withoutGlobalScopes()->where('tenant_id', $tid)
            ->whereRaw("(metadata->>'coupon_reminder_sent_at') is not null")
            ->whereRaw("(metadata->>'coupon_reminder_reason') = 'sent'");
        $reminded = (clone $base)->count();
        $redeemed = (clone $base)->where('coupon_status', \App\Enums\WheelCouponStatus::Redeemed)->count();

        // Gönderilen SMS'ler (marketing_messages) — sayaç + ciro/dönüşüm + gönderim detayı.
        // Sayaçlar yalnızca GERÇEK gönderimi sayar (test mesajları hariç).
        $msgBase = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid)
            ->where('source', WheelCouponReminder::KEY);
        $live = fn () => (clone $msgBase)->where('source_type', '!=', 'test');
        $smsSent = $live()->where('status', 'sent')->count();
        $conversions = $live()->whereNotNull('converted_at')->count();
        $revenue = round((float) $live()->sum('revenue'), 2);

        // "Kime / ne zaman / hangi SMS gitti" — son 50 gönderim (test dahil, rozetli)
        $deliveries = (clone $msgBase)->whereIn('status', ['sent', 'failed'])
            ->orderByDesc('id')->limit(50)
            ->get(['id', 'recipient', 'body', 'status', 'source_type', 'error', 'revenue', 'converted_at', 'sent_at', 'created_at'])
            ->map(fn ($m) => [
                'id' => $m->id,
                'contact' => (string) $m->recipient,
                'message' => (string) $m->body,
                'status' => $m->status,
                'is_test' => $m->source_type === 'test',
                'error' => $m->error ? mb_substr($m->error, 0, 60) : null,
                'revenue' => (float) $m->revenue,
                'converted' => $m->converted_at !== null,
                'at' => ($m->sent_at ?? $m->created_at)?->setTimezone('Europe/Istanbul')->format('Y-m-d H:i'),
            ]);

        return response()->json([
            'settings' => [
                'enabled' => (bool) ($s['wheel_reminder_enabled'] ?? false),
                'whatsapp_enabled' => (bool) ($s['wheel_reminder_whatsapp'] ?? false),
                'hours_before' => (int) ($s['wheel_reminder_hours_before'] ?? 3),
                'sms_template' => $s['wheel_reminder_sms_template'] ?? '',
                'opt_out_url' => $s['sms_opt_out_url'] ?? '',
                'shop_url' => $s['shop_url'] ?? '',
            ],
            'stats' => [
                'reminded' => $reminded,
                'redeemed' => $redeemed,
                'sms_sent' => $smsSent,
                'conversions' => $conversions,
                'revenue' => $revenue,
            ],
            'deliveries' => $deliveries,
        ]);
    }

    /** PUT — Çark hatırlatma ayarları. */
    public function updateWheelReminder(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'whatsapp_enabled' => 'sometimes|boolean',
            'hours_before' => 'sometimes|integer|min:1|max:72',
            'sms_template' => 'sometimes|nullable|string|max:500',
            'opt_out_url' => 'sometimes|nullable|url|max:255',
        ]);
        $s = $tenant->settings ?? [];
        if (array_key_exists('enabled', $data)) {
            $s['wheel_reminder_enabled'] = $data['enabled'];
        }
        if (array_key_exists('whatsapp_enabled', $data)) {
            $s['wheel_reminder_whatsapp'] = $data['whatsapp_enabled'];
        }
        if (array_key_exists('hours_before', $data)) {
            $s['wheel_reminder_hours_before'] = $data['hours_before'];
        }
        if (array_key_exists('sms_template', $data)) {
            $s['wheel_reminder_sms_template'] = $data['sms_template'];
        }
        if (array_key_exists('opt_out_url', $data)) {
            $s['sms_opt_out_url'] = $data['opt_out_url'];
        }
        $tenant->update(['settings' => $s]);

        return $this->wheelReminder($request);
    }

    /** GET — Sipariş bilgilendirme ayarları + istatistik + gönderim listesi. */
    public function orderNotify(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $s = $tenant->settings ?? [];

        $msgs = MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->where('source', 'order_status')
            ->select('channel',
                DB::raw("count(*) filter (where status='sent') as sent"),
                DB::raw("count(*) filter (where status='failed') as failed"),
                DB::raw("count(*) filter (where status='skipped') as skipped"),
            )->groupBy('channel')->get()->keyBy('channel');

        $stageCounts = MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->where('source', 'order_status')->where('status', 'sent')
            ->select(DB::raw("meta->>'stage' as stage"), DB::raw('count(*) as c'))
            ->groupBy(DB::raw("meta->>'stage'"))->pluck('c', 'stage');

        $deliveries = MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->where('source', 'order_status')
            ->orderByDesc('id')->limit(100)->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'at' => ($m->sent_at ?? $m->created_at)?->setTimezone('Europe/Istanbul')->format('d.m.Y H:i'),
                'channel' => $m->channel,
                'recipient' => $m->recipient,
                'customer_name' => $m->meta['customer_name'] ?? null,
                'order_no' => $m->meta['order_no'] ?? null,
                'stage' => $m->meta['stage'] ?? null,
                'cargo' => $m->meta['cargo_company'] ?? null,
                'tracking_no' => $m->meta['cargo_tracking_no'] ?? null,
                'status' => $m->status,
                'error' => $m->error ? mb_substr($m->error, 0, 120) : null,
                'is_test' => $m->source_type === 'test',
            ])->all();

        return response()->json([
            'settings' => [
                'enabled' => (bool) ($s['order_notify_enabled'] ?? false),
                'channels' => [
                    'email' => (bool) ($s['order_notify_channels']['email'] ?? false),
                    'sms' => (bool) ($s['order_notify_channels']['sms'] ?? false),
                    'whatsapp' => (bool) ($s['order_notify_channels']['whatsapp'] ?? true),
                ],
                'stages' => [
                    'placed' => (bool) ($s['order_notify_stages']['placed'] ?? true),
                    'shipped' => (bool) ($s['order_notify_stages']['shipped'] ?? true),
                    'delivered' => (bool) ($s['order_notify_stages']['delivered'] ?? true),
                ],
            ],
            'stats' => [
                'sent_total' => (int) $msgs->sum('sent'),
                'failed' => (int) $msgs->sum('failed'),
                'by_stage' => [
                    'placed' => (int) ($stageCounts['placed'] ?? 0),
                    'shipped' => (int) ($stageCounts['shipped'] ?? 0),
                    'delivered' => (int) ($stageCounts['delivered'] ?? 0),
                ],
            ],
            'deliveries' => $deliveries,
        ]);
    }

    /** PUT — Sipariş bilgilendirme ayarları. */
    public function updateOrderNotify(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $data = $request->validate([
            'enabled' => 'sometimes|boolean',
            'channels' => 'sometimes|array',
            'channels.email' => 'sometimes|boolean',
            'channels.sms' => 'sometimes|boolean',
            'channels.whatsapp' => 'sometimes|boolean',
            'stages' => 'sometimes|array',
            'stages.placed' => 'sometimes|boolean',
            'stages.shipped' => 'sometimes|boolean',
            'stages.delivered' => 'sometimes|boolean',
        ]);
        $s = $tenant->settings ?? [];
        if (array_key_exists('enabled', $data)) {
            $s['order_notify_enabled'] = $data['enabled'];
        }
        if (array_key_exists('channels', $data)) {
            $s['order_notify_channels'] = array_merge($s['order_notify_channels'] ?? [], $data['channels']);
        }
        if (array_key_exists('stages', $data)) {
            $s['order_notify_stages'] = array_merge($s['order_notify_stages'] ?? [], $data['stages']);
        }
        $tenant->update(['settings' => $s]);

        return $this->orderNotify($request);
    }

    /** GET — gönderim tercihleri: saat aralığı + frekans limiti. */
    public function preferences(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $s = $tenant->settings ?? [];

        return response()->json([
            'window' => [
                'enabled' => (bool) ($s['marketing_quiet_enabled'] ?? false),
                'start' => $s['marketing_send_start'] ?? '09:00',
                'end' => $s['marketing_send_end'] ?? '21:00',
            ],
            'frequency' => [
                'enabled' => (bool) ($s['marketing_freq_enabled'] ?? false),
                'per_day' => (int) ($s['marketing_freq_per_day'] ?? 1),
                'per_week' => (int) ($s['marketing_freq_per_week'] ?? 3),
            ],
        ]);
    }

    /** PUT — gönderim tercihlerini güncelle. */
    public function updatePreferences(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $data = $request->validate([
            'window.enabled' => 'required|boolean',
            'window.start' => 'required|date_format:H:i',
            'window.end' => 'required|date_format:H:i',
            'frequency.enabled' => 'required|boolean',
            'frequency.per_day' => 'required|integer|min:0|max:50',
            'frequency.per_week' => 'required|integer|min:0|max:200',
        ]);
        $s = $tenant->settings ?? [];
        $s['marketing_quiet_enabled'] = $data['window']['enabled'];
        $s['marketing_send_start'] = $data['window']['start'];
        $s['marketing_send_end'] = $data['window']['end'];
        $s['marketing_freq_enabled'] = $data['frequency']['enabled'];
        $s['marketing_freq_per_day'] = $data['frequency']['per_day'];
        $s['marketing_freq_per_week'] = $data['frequency']['per_week'];
        $tenant->update(['settings' => $s]);

        return $this->preferences($request);
    }

    /**
     * Gönderim & analitik — huni + gönderim logu (gerçek marketing_messages).
     * Dinamik filtreler: channel (email|sms|whatsapp|all), days (0=tümü), status, limit.
     */
    public function analytics(Request $request): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }
        $tid = $tenant->id;

        $channel = (string) $request->query('channel', 'all');
        $status = (string) $request->query('status', 'all');
        $days = (int) $request->query('days', 30);          // 0 = tüm zamanlar
        $limit = min(2000, max(20, (int) $request->query('limit', 500)));
        $source = (string) $request->query('source', 'all');   // otomasyon kaynağı
        $search = trim((string) $request->query('q', ''));      // isim / numara / e-posta / konu
        $dateFrom = (string) $request->query('date_from', '');  // YYYY-MM-DD (TR günü)
        $dateTo = (string) $request->query('date_to', '');
        $recipient = trim((string) $request->query('recipient', '')); // alıcı geçmişi (tıklama)

        $filtered = function () use ($tid, $channel, $days, $source, $search, $dateFrom, $dateTo, $recipient) {
            $q = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid);
            if (in_array($channel, ['email', 'sms', 'whatsapp', 'push'], true)) {
                $q->where('channel', $channel);
            }
            if ($source !== '' && $source !== 'all') {
                $q->where('source', $source);
            }
            // Açık tarih aralığı (TR günü) öncelikli; yoksa "son N gün"
            if ($dateFrom !== '' || $dateTo !== '') {
                if ($dateFrom !== '') {
                    $q->where('created_at', '>=', Carbon::parse($dateFrom, 'Europe/Istanbul')->startOfDay()->utc());
                }
                if ($dateTo !== '') {
                    $q->where('created_at', '<=', Carbon::parse($dateTo, 'Europe/Istanbul')->endOfDay()->utc());
                }
            } elseif ($days > 0) {
                $q->where('created_at', '>=', now()->subDays($days));
            }
            // Alıcı geçmişi: telefonlar son-10-hane ile eşleşir (905xx / +90 / 0 farkları),
            // e-postalar küçük-harf tam eşleşme — kanaldan bağımsız TÜM mesajlar.
            if ($recipient !== '') {
                if (str_contains($recipient, '@')) {
                    $q->whereRaw('lower(recipient) = ?', [mb_strtolower($recipient)]);
                } else {
                    $digits = substr(preg_replace('/\D/', '', $recipient), -10);
                    $q->whereRaw("right(regexp_replace(recipient, '\\D', '', 'g'), 10) = ?", [$digits]);
                }
            }
            // Serbest arama: alıcı, meta'daki müşteri adı, konu, sipariş no, kupon kodu
            if ($search !== '') {
                $like = '%' . mb_strtolower($search) . '%';
                $q->where(function ($w) use ($like) {
                    $w->whereRaw('lower(recipient) like ?', [$like])
                        ->orWhereRaw("lower(coalesce(meta->>'customer_name','')) like ?", [$like])
                        ->orWhereRaw('lower(coalesce(subject, \'\')) like ?', [$like])
                        ->orWhereRaw("lower(coalesce(meta->>'order_no','')) like ?", [$like])
                        ->orWhereRaw("lower(coalesce(meta->>'coupon_code','')) like ?", [$like]);
                });
            }

            return $q;
        };

        // Huni sayaçları GERÇEK gönderimleri sayar — test mesajları hariç (Genel Bakış ile
        // aynı taban; eskiden testler dahildi ve iki sayfa birbirini tutmuyordu).
        $real = function () use ($filtered) {
            return $filtered()->where(function ($q) {
                $q->whereNull('source_type')->orWhere('source_type', '!=', 'test');
            });
        };

        $sent = (clone $real())->where('status', 'sent')->count();
        $opened = (clone $real())->whereNotNull('opened_at')->count();
        $clicked = (clone $real())->whereNotNull('clicked_at')->count();
        $failed = (clone $real())->where('status', 'failed')->count();
        $skipped = (clone $real())->where('status', 'skipped')->count();

        // Dönüşüm + otomasyonun getirisi (ciro) MESAJ-BAZLI atıftan sayılır: her dönüşüm
        // kanal-atıf kuralıyla son gönderilen marketing_message'a (converted_at+revenue)
        // yazılır (sepet kurtarma attributeToLastMessage, çark attribute). Böylece funnel'ın
        // TÜM sayaçları aynı filtre setine (kanal/kaynak/arama/dönem/alıcı) duyarlı çalışır.
        $converted = (clone $real())->whereNotNull('converted_at')->count();
        $revenue = round((float) (clone $real())->whereNotNull('converted_at')->sum('revenue'), 2);

        $listQ = $filtered()->orderByDesc('id');
        if (in_array($status, ['sent', 'failed', 'skipped', 'queued'], true)) {
            $listQ->where('status', $status);
        } elseif ($status === 'converted') {
            // Huni "Dönüştü" kartı: sadece satışa dönüşen (converted_at atanmış) mesajlar
            $listQ->whereNotNull('converted_at');
        }
        $total = (clone $listQ)->count();

        $rows = $listQ->limit($limit)
            ->get(['id', 'channel', 'recipient', 'source', 'source_type', 'status', 'skip_reason', 'error', 'subject', 'body', 'meta', 'opened_at', 'clicked_at', 'converted_at', 'revenue', 'sent_at', 'created_at']);

        // Dönüşen sepet-kurtarma mesajlarında "kuponla mı aldı?" bilgisi journey meta'sında
        // (coupon_used, paid_with_coupon/paid_other ayrımı) — tek sorguda toplu okunur.
        // Çark hatırlatmasında dönüşüm YALNIZ kuponlu siparişle sayılır → her zaman true.
        $journeyIds = $rows->filter(fn ($m) => $m->converted_at && ! empty($m->meta['journey_id']))
            ->map(fn ($m) => (int) $m->meta['journey_id'])->unique()->values();
        $couponUsedByJourney = $journeyIds->isEmpty() ? collect() : MarketingJourney::withoutGlobalScopes()
            ->where('tenant_id', $tid)->whereIn('id', $journeyIds)
            ->get(['id', 'meta'])
            ->mapWithKeys(fn ($j) => [$j->id => $j->meta['coupon_used'] ?? null]);

        $messages = $rows
            ->map(fn ($m) => [
                'id' => $m->id,
                'channel' => $m->channel,
                'contact' => (string) $m->recipient,   // maskesiz — tam alıcı
                'name' => trim((string) ($m->meta['customer_name'] ?? '')) ?: null,
                'source' => $m->source,
                'is_test' => $m->source_type === 'test',
                'status' => $m->status,
                'reason' => $m->skip_reason ?: ($m->error ? mb_substr($m->error, 0, 60) : null),
                'subject' => $m->subject ?: ($m->body ? mb_substr($m->body, 0, 90) : null),
                'order_no' => $m->meta['order_no'] ?? null,
                'coupon_code' => $m->meta['coupon_code'] ?? null,
                'stage' => $m->meta['stage'] ?? null,
                'opened' => $m->opened_at !== null,
                'clicked' => $m->clicked_at !== null,
                'converted' => $m->converted_at !== null,
                // true = kuponu kullanarak aldı, false = kuponsuz aldı, null = bilinmiyor/dönüşmedi
                'coupon_used' => $m->converted_at === null ? null
                    : ($m->source === WheelCouponReminder::KEY ? true
                        : $couponUsedByJourney->get((int) ($m->meta['journey_id'] ?? 0))),
                'revenue' => (float) $m->revenue,
                'at' => ($m->sent_at ?? $m->created_at)?->setTimezone('Europe/Istanbul')->format('Y-m-d H:i'),
            ]);

        // Kaynak filtresi seçenekleri — tenant'ta gerçekten kullanılmış otomasyonlar
        // (test gönderimleri dropdown'ı kirletmesin)
        $sources = MarketingMessage::withoutGlobalScopes()->where('tenant_id', $tid)
            ->whereNotNull('source')
            ->where(fn ($q) => $q->whereNull('source_type')->orWhere('source_type', '!=', 'test'))
            ->distinct()->orderBy('source')->pluck('source');

        // "campaign:N" kaynakları dropdown'da kampanya ADIYLA görünsün
        $sourceLabels = [];
        $campaignIds = $sources
            ->filter(fn ($s) => str_starts_with($s, 'campaign:'))
            ->map(fn ($s) => (int) substr($s, 9))
            ->values();
        if ($campaignIds->isNotEmpty()) {
            $names = DB::table('marketing_campaigns')->whereIn('id', $campaignIds)->pluck('name', 'id');
            foreach ($campaignIds as $cid) {
                $sourceLabels['campaign:'.$cid] = 'Kampanya: '.($names[$cid] ?? '#'.$cid);
            }
        }

        return response()->json([
            'funnel' => compact('sent', 'opened', 'clicked', 'converted', 'failed', 'skipped') + ['revenue' => $revenue],
            'messages' => $messages,
            'total' => $total,
            'shown' => $messages->count(),
            'sources' => $sources,
            'source_labels' => $sourceLabels,
            'filters' => compact('channel', 'status', 'days', 'source', 'search', 'dateFrom', 'dateTo', 'recipient'),
        ]);
    }

    /** Tek mesajın TAM detayı — gönderilen içerik, kupon, zaman çizelgesi, teknik bilgiler. */
    public function messageDetail(Request $request, int $id): JsonResponse
    {
        $tenant = $this->resolveTenant($request);
        if (! $tenant) {
            return response()->json(['message' => 'Tenant bulunamadi.'], 404);
        }

        $m = MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->find($id);
        if (! $m) {
            return response()->json(['message' => 'Mesaj bulunamadi.'], 404);
        }

        $tr = fn ($v) => $v?->setTimezone('Europe/Istanbul')->format('Y-m-d H:i:s');
        $meta = $m->meta ?? [];

        // Dönüşen mesajda kuponla mı alındığı (liste ile aynı kural: çark = her zaman kuponlu,
        // sepet kurtarma = journey meta'daki coupon_used, diğerleri = bilinmiyor)
        $couponUsed = null;
        if ($m->converted_at !== null) {
            if ($m->source === WheelCouponReminder::KEY) {
                $couponUsed = true;
            } elseif (! empty($meta['journey_id'])) {
                $j = MarketingJourney::withoutGlobalScopes()
                    ->where('tenant_id', $tenant->id)->find((int) $meta['journey_id'], ['id', 'meta']);
                $couponUsed = $j?->meta['coupon_used'] ?? null;
            }
        }

        return response()->json([
            'id' => $m->id,
            'channel' => $m->channel,
            'contact' => (string) $m->recipient,
            'name' => trim((string) ($meta['customer_name'] ?? '')) ?: null,
            'source' => $m->source,
            'is_test' => $m->source_type === 'test',
            'status' => $m->status,
            'skip_reason' => $m->skip_reason,
            'error' => $m->error,
            // İçerik — gönderilen mesajın tam metni (e-postada düz metin karşılığı)
            'subject' => $m->subject,
            'body' => $m->body,
            // Bağlam
            'order_no' => $meta['order_no'] ?? null,
            'stage' => $meta['stage'] ?? null,
            'step' => $meta['step'] ?? null,
            'coupon_code' => $meta['coupon_code'] ?? null,
            'cart_total' => isset($meta['cart_total']) ? round((float) $meta['cart_total'], 2) : null,
            'cargo_company' => $meta['cargo_company'] ?? null,
            'cargo_tracking_no' => $meta['cargo_tracking_no'] ?? null,
            // Zaman çizelgesi (TR)
            'created_at' => $tr($m->created_at),
            'sent_at' => $tr($m->sent_at),
            'opened_at' => $tr($m->opened_at),
            'clicked_at' => $tr($m->clicked_at),
            'converted_at' => $tr($m->converted_at),
            'coupon_used' => $couponUsed,
            'revenue' => (float) $m->revenue,
            // Teknik
            'provider' => $m->provider,
            'provider_message_id' => $m->provider_message_id,
            'cost' => $m->cost !== null ? (float) $m->cost : null,
        ]);
    }

    /** @return array<string,mixed> */
    protected function settingsPayload(array $s): array
    {
        return [
            'enabled' => (bool) ($s['cart_recovery_enabled'] ?? false),
            'coupon_amount' => (float) ($s['cart_recovery_coupon_amount'] ?? 100),
            'coupon_min_basket' => (float) ($s['cart_recovery_coupon_min_basket'] ?? 0),
            'coupon_valid_hours' => (int) ($s['cart_recovery_coupon_valid_hours'] ?? 48),
            'coupon_mode' => (string) ($s['cart_recovery_coupon_mode'] ?? 'percent'),
            'coupon_percent' => (float) ($s['cart_recovery_coupon_percent'] ?? 10),
            'coupon_round' => (int) ($s['cart_recovery_coupon_round'] ?? 25),
            'process_limit' => (int) ($s['cart_recovery_process_limit'] ?? 0),
            'channels' => [
                'email' => (bool) ($s['cart_recovery_channels']['email'] ?? true),
                'sms' => (bool) ($s['cart_recovery_channels']['sms'] ?? true),
                'whatsapp' => (bool) ($s['cart_recovery_channels']['whatsapp'] ?? false),
            ],
            'delay_email' => (int) ($s['cart_recovery_delay_email'] ?? 60),
            'delay_sms' => (int) ($s['cart_recovery_delay_sms'] ?? 1440),
            'delay_whatsapp' => (int) ($s['cart_recovery_delay_whatsapp'] ?? 2880),
            'shop_url' => $s['shop_url'] ?? null,
            'cart_url' => $s['cart_url'] ?? null,
            'sms_template' => $s['cart_recovery_sms_template'] ?? '',
            'whatsapp_template' => $s['cart_recovery_whatsapp_template'] ?? '',
        ];
    }

    /** Loglardan canlı istatistik. @return array<string,mixed> */
    protected function stats(int $tenantId): array
    {
        $base = MarketingJourney::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('automation', CartRecoveryAutomation::KEY);

        $byStatus = (clone $base)->select('status', DB::raw('count(*) as c'))->groupBy('status')->pluck('c', 'status');

        // OTOMASYONUN GETİRİSİ = en az bir mesaj GÖNDERİLMİŞ dönüşümler (current_step>0).
        // Mesajsız dönüşüm organiktir; otomasyon cirosuna sayılmaz (kullanıcı kararı).
        $converted = (clone $base)->where('status', 'converted')->where('current_step', '>', 0);
        $revenueTotal = (float) (clone $converted)->sum('revenue');
        $revenueCoupon = (float) (clone $converted)->where('stopped_reason', 'paid_with_coupon')->sum('revenue');
        $couponUsed = (clone $converted)->where('stopped_reason', 'paid_with_coupon')->count();
        $couponsIssued = (clone $base)->whereRaw("meta->>'coupon_code' is not null")->count();

        // Kanal bazlı mesaj istatistiği + KANAL ATIFI (hangi kanaldan sonra alındıysa ciro orada)
        $msgs = MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('source', CartRecoveryAutomation::KEY)
            ->where('source_type', 'automation')
            ->select('channel',
                DB::raw("count(*) filter (where status='sent') as sent"),
                DB::raw('count(*) filter (where opened_at is not null) as opened'),
                DB::raw('count(*) filter (where clicked_at is not null) as clicked'),
                DB::raw("count(*) filter (where status='failed') as failed"),
                DB::raw("count(*) filter (where status='skipped') as skipped"),
                DB::raw('count(*) filter (where converted_at is not null) as conversions'),
                DB::raw('coalesce(sum(revenue), 0) as revenue'),
            )
            ->groupBy('channel')->get()->keyBy('channel');

        return [
            'journeys' => [
                'total' => (int) (clone $base)->count(),
                'active' => (int) ($byStatus['active'] ?? 0),
                'converted' => (int) ($byStatus['converted'] ?? 0),
                'exhausted' => (int) ($byStatus['exhausted'] ?? 0),
                'stopped' => (int) ($byStatus['stopped'] ?? 0),
            ],
            'revenue_total' => round($revenueTotal, 2),
            'revenue_by_coupon' => round($revenueCoupon, 2),
            'coupons_issued' => $couponsIssued,
            'coupons_used' => $couponUsed,
            'channels' => collect(['email', 'sms', 'whatsapp'])->mapWithKeys(fn ($c) => [$c => [
                'sent' => (int) ($msgs[$c]->sent ?? 0),
                'opened' => (int) ($msgs[$c]->opened ?? 0),
                'clicked' => (int) ($msgs[$c]->clicked ?? 0),
                'failed' => (int) ($msgs[$c]->failed ?? 0),
                'skipped' => (int) ($msgs[$c]->skipped ?? 0),
                'conversions' => (int) ($msgs[$c]->conversions ?? 0),
                'revenue' => round((float) ($msgs[$c]->revenue ?? 0), 2),
            ]])->all(),
        ];
    }

    /**
     * Gönderim gözlem listesi: kime, hangi kupon kodu, ne zaman, hangi kanal,
     * durum ve (varsa) atfedilen ciro. Panel tablosunda gösterilir.
     *
     * @return list<array<string,mixed>>
     */
    private function deliveries(int $tenantId, int $limit = 100): array
    {
        return MarketingMessage::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('source', CartRecoveryAutomation::KEY)
            ->orderByDesc('id')->limit($limit)->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'at' => ($m->sent_at ?? $m->created_at)?->setTimezone('Europe/Istanbul')->format('d.m.Y H:i'),
                'channel' => $m->channel,
                'recipient' => $m->recipient,
                'customer_name' => $m->meta['customer_name'] ?? null,
                'order_no' => $m->meta['order_no'] ?? null,
                'coupon_code' => $m->meta['coupon_code'] ?? null,
                'cart_total' => $m->meta['cart_total'] ?? null,
                'step' => $m->meta['step'] ?? null,
                'status' => $m->status,
                'skip_reason' => $m->skip_reason,
                'error' => $m->error ? mb_substr($m->error, 0, 120) : null,
                'revenue' => $m->revenue !== null ? (float) $m->revenue : null,
                'converted' => $m->converted_at !== null,
                'is_test' => $m->source_type === 'test',
            ])->all();
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        $user = $request->user();
        if ($user->tenant_id) {
            return $user->tenant;
        }
        if ($request->hasHeader('X-Tenant-Id')) {
            return Tenant::find((int) $request->header('X-Tenant-Id'));
        }

        return null;
    }
}
