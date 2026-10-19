<?php

namespace App\Http\Controllers\Api;

use App\Enums\WheelCampaignStatus;
use App\Enums\WheelPrizeType;
use App\Http\Controllers\Controller;
use App\Models\WheelCampaign;
use App\Models\WheelLead;
use App\Models\WheelSlice;
use App\Models\WheelSpin;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Çark Kampanya Yönetim Paneli (Faz 1). Auth + permission:wheel.
 *
 * - Tüm sorgular tenant global-scope ile otomatik filtrelenir (BelongsToTenant).
 * - Dilim ağırlıkları/stok burada (panelde) yönetilir; public widget'a sızdırılmaz.
 * - Sayısal alanlar config/wheel.php limitlerine sabitlenir (clamp).
 */
class WheelCampaignController extends Controller
{
    public function __construct()
    {
        ini_set('serialize_precision', '-1');
    }

    // ───────────────────────── LİSTE ─────────────────────────

    public function index(Request $request): JsonResponse
    {
        $query = WheelCampaign::query()->withCount(['slices', 'leads', 'spins']);

        if ($status = $request->query('status')) {
            if (WheelCampaignStatus::tryFrom($status)) {
                $query->where('status', $status);
            }
        }
        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where('name', 'ilike', $like);
        }
        // Oyun türü filtresi (A/B eşi seçiminde kazı kazan kampanyalarını listelemek için)
        if (in_array($gt = $request->query('game_type'), ['wheel', 'scratch'], true)) {
            $query->where('game_type', $gt);
        }

        $query->orderByDesc('created_at');
        $perPage = min((int) ($request->query('per_page', 25)), 100);

        // Liste satırına oyun bilgisi: tür + (çarkta) A/B eşi, (kazı kazanda) süre.
        $page = $query->paginate($perPage);
        $page->getCollection()->transform(function (WheelCampaign $c) {
            $row = $c->toArray();
            $row['game_type'] = $c->game_type ?: 'wheel';
            $row['ab_percent'] = $c->abSettings()['percent'];
            [$va, $vb] = $c->abVariants();
            $row['ab_a_name'] = $va?->name;
            $row['ab_b_name'] = $vb?->name;
            $row['ab_a_game'] = $va?->game_type;
            $row['ab_b_game'] = $vb?->game_type;
            // Oyun kampanyası yayında bir A/B'nin A'sı ise bilgi
            $row['ab_owner_name'] = ($o = $c->abOwner()) ? $o->name : null;
            $row['scratch_valid_minutes'] = $c->isScratch() ? $c->scratchSettings()['valid_minutes'] : null;
            $row['scratch_skip_form'] = $c->isScratch() ? $c->scratchSettings()['skip_form'] : null;

            return $row;
        });

        return response()->json($page);
    }

    // ───────────────────────── DETAY ─────────────────────────

    public function show(int $id): JsonResponse
    {
        $c = WheelCampaign::with(['slices' => fn ($q) => $q->orderBy('sort_order')])->findOrFail($id);

        return response()->json($this->campaignView($c));
    }

    // ───────────────────────── OLUŞTUR ─────────────────────────

    public function store(Request $request): JsonResponse
    {
        $data = $this->validatePayload($request, null);

        $campaign = DB::transaction(function () use ($data, $request) {
            $c = new WheelCampaign();
            $c->name = $data['name'];
            $c->slug = $this->uniqueSlug($data['slug'] ?? $data['name'], $request);
            $c->status = $data['status'] ?? WheelCampaignStatus::Draft->value;
            $c->game_type = $data['game_type'] ?? 'wheel';
            // Kazı kazan kampanyası: başlık/buton/kulakçık varsayılanları oyuna özel.
            $designDefaults = $c->game_type === 'scratch'
                ? array_merge(config('wheel.default_design'), config('wheel.scratch.default_design'))
                : config('wheel.default_design');
            $c->design = $this->mergeArray($designDefaults, $data['design'] ?? []);
            $c->trigger_rules = $this->sanitizeTrigger($data['trigger_rules'] ?? []);
            $c->form_fields = $this->sanitizeForm($data['form_fields'] ?? []);
            $c->starts_at = $data['starts_at'] ?? null;
            $c->ends_at = $data['ends_at'] ?? null;
            $c->coupon_provider = $data['coupon_provider'] ?? 'display';
            $c->coupon_valid_hours = $this->clamp((int) ($data['coupon_valid_hours'] ?? config('wheel.coupon.valid_hours', 48)), 'coupon_valid_hours');
            $c->settings = $this->mergeScratchSettings(null, $data['settings'] ?? []);
            $c->save();

            $this->syncSlices($c, $data['slices'] ?? []);

            return $c;
        });

        $campaign->load(['slices' => fn ($q) => $q->orderBy('sort_order')]);

        return response()->json($this->campaignView($campaign), 201);
    }

    // ───────────────────────── GÜNCELLE ─────────────────────────

    public function update(Request $request, int $id): JsonResponse
    {
        $c = WheelCampaign::findOrFail($id);
        $data = $this->validatePayload($request, $c->id);

        DB::transaction(function () use ($c, $data, $request) {
            if (array_key_exists('name', $data)) {
                $c->name = $data['name'];
            }
            if (! empty($data['slug']) && $data['slug'] !== $c->slug) {
                $c->slug = $this->uniqueSlug($data['slug'], $request, $c->id);
            }
            if (array_key_exists('status', $data)) {
                $c->status = $data['status'];
            }
            if (array_key_exists('design', $data)) {
                $c->design = $this->mergeArray(config('wheel.default_design'), $data['design'] ?? []);
            }
            if (array_key_exists('trigger_rules', $data)) {
                $c->trigger_rules = $this->sanitizeTrigger($data['trigger_rules'] ?? []);
            }
            if (array_key_exists('form_fields', $data)) {
                $c->form_fields = $this->sanitizeForm($data['form_fields'] ?? []);
            }
            if (array_key_exists('starts_at', $data)) {
                $c->starts_at = $data['starts_at'];
            }
            if (array_key_exists('ends_at', $data)) {
                $c->ends_at = $data['ends_at'];
            }
            if (array_key_exists('coupon_provider', $data)) {
                $c->coupon_provider = $data['coupon_provider'];
            }
            if (array_key_exists('coupon_valid_hours', $data)) {
                $c->coupon_valid_hours = $this->clamp((int) $data['coupon_valid_hours'], 'coupon_valid_hours');
            }
            if (array_key_exists('settings', $data)) {
                // Yalnız bilinen kazı kazan anahtarları; diğer settings anahtarları korunur.
                $c->settings = $this->mergeScratchSettings($c->settings, $data['settings'] ?? []);
            }
            $c->save();

            if (array_key_exists('slices', $data)) {
                $this->syncSlices($c, $data['slices'] ?? []);
            }
        });

        $c->load(['slices' => fn ($q) => $q->orderBy('sort_order')]);

        return response()->json($this->campaignView($c));
    }

    // ───────────────────────── SİL ─────────────────────────

    public function destroy(int $id): JsonResponse
    {
        $c = WheelCampaign::findOrFail($id);
        $c->delete(); // slices/leads/spins cascade (FK)

        return response()->json(['deleted' => true]);
    }

    // ───────────────────────── LEAD'LER ─────────────────────────

    public function leads(Request $request, int $id): JsonResponse
    {
        $c = WheelCampaign::findOrFail($id);
        $perPage = min((int) ($request->query('per_page', 50)), 200);

        return response()->json($this->leadsQuery($c, $request)->paginate($perPage));
    }

    /**
     * Katılımcı raporu sorgusu: lead + çevirme (spin) + (varsa) o kuponla verilen sipariş.
     * Sipariş eşleşmesi orders.coupon_code = wheel_spins.coupon_code (tenant içinde) →
     * kesin kullanım tarihi (used_at), sipariş no ve tutarı. Tarih filtresi from/to = çevirme anı.
     */
    private function leadsQuery(WheelCampaign $c, Request $request): \Illuminate\Database\Eloquent\Builder
    {
        // Aynı kupon kodu birden fazla siparişte yer alabilir (ör. müşteri ödenmemiş bir
        // sipariş + ardından ödenmiş sipariş oluşturur). Düz join satırı çoğaltırdı → her
        // katılımcı 2 kez görünürdü. LATERAL ile kupon başına yalnız 1 ÖDENMİŞ
        // (payment_status=1) sipariş eşlenir; ödenmemiş/iptal siparişler kullanım sayılmaz.
        $orderLateral = 'lateral (select o.id, o.order_no, o.order_date, o.total_amount '
            . 'from orders o '
            . 'where o.coupon_code = wheel_spins.coupon_code '
            . 'and o.tenant_id = wheel_leads.tenant_id '
            . 'and o.payment_status = 1 '
            . 'order by o.order_date desc limit 1) as ord';

        $ids = $this->statsCampaignIds($c);
        $query = WheelLead::query()->whereIn('wheel_leads.wheel_campaign_id', $ids)
            ->leftJoin('wheel_spins', 'wheel_spins.wheel_lead_id', '=', 'wheel_leads.id')
            ->leftJoin(DB::raw($orderLateral), fn ($join) => $join->on(DB::raw('1'), '=', DB::raw('1')))
            ->select(
                'wheel_leads.*',
                'wheel_spins.prize_label',
                'wheel_spins.coupon_code',
                'wheel_spins.variant',
                'wheel_spins.is_win',
                'wheel_spins.coupon_status',
                'wheel_spins.coupon_provider',
                'wheel_spins.coupon_expires_at',
                'wheel_spins.redeemed_at',
                // created_at UTC saklanır; çevirme tarihi Türkiye saatiyle gösterilsin
                // (order_date Ticimax'tan zaten Türkiye saatiyle gelir, ona dokunulmaz).
                DB::raw("(wheel_spins.created_at at time zone 'UTC' at time zone 'Europe/Istanbul') as spun_at"),
                'ord.id as order_id',
                'ord.order_no',
                'ord.order_date as used_at',
                'ord.total_amount as order_total',
            )
            ->orderByDesc('wheel_leads.created_at');

        // Ödüle göre filtre (dilim etiketi)
        if (($prize = $request->query('prize')) !== null && $prize !== '') {
            $query->where('wheel_spins.prize_label', $prize);
        }

        // Oyun türü filtresi (A/B): wheel | scratch
        $variant = $request->query('variant');
        if ($variant === 'wheel' || $variant === 'scratch') {
            $query->where('wheel_spins.variant', $variant);
        }

        // Kullanıldı/kullanılmadı filtresi (ödenmiş sipariş var/yok). used=1 → kullanıldı,
        // used=0 → kupon aldı ama ödenmiş siparişte kullanmadı.
        $used = $request->query('used');
        if ($used === '1' || $used === '0') {
            $paidExists = function ($q) {
                $q->select(DB::raw(1))->from('orders')
                    ->whereColumn('orders.coupon_code', 'wheel_spins.coupon_code')
                    ->whereColumn('orders.tenant_id', 'wheel_leads.tenant_id')
                    ->where('orders.payment_status', 1);
            };
            if ($used === '1') {
                $query->whereExists($paidExists);
            } else {
                $query->whereNotNull('wheel_spins.coupon_code')->whereNotExists($paidExists);
            }
        }

        // Serbest metin arama: ad-soyad / e-posta / telefon. Telefon DB'de düz rakam
        // saklandığı için arama metninin rakamları da telefonla eşleştirilir.
        if (($q = trim((string) $request->query('q', ''))) !== '') {
            $digits = preg_replace('/\D+/', '', $q);
            $query->where(function ($w) use ($q, $digits) {
                $w->where('wheel_leads.full_name', 'ilike', "%{$q}%")
                    ->orWhere('wheel_leads.email', 'ilike', "%{$q}%");
                if ($digits !== '') {
                    $w->orWhereRaw("regexp_replace(wheel_leads.phone, '\\D', '', 'g') like ?", ["%{$digits}%"]);
                } else {
                    $w->orWhere('wheel_leads.phone', 'ilike', "%{$q}%");
                }
            });
        }

        // Test çevirmeleri normalde raporlara karılmaz; ?include_test=1 ile görüntülenebilir.
        if (! filter_var($request->query('include_test', false), FILTER_VALIDATE_BOOLEAN)) {
            $query->where('wheel_leads.is_test', false);
        }

        // Tarih filtresi TÜRKİYE gününe göre (created_at UTC saklanır; aksi halde gece
        // yarısı sonrası TR kayıtları bir önceki UTC gününe düşüp yanlış filtrelenirdi).
        $dateOk = fn ($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);
        if (($from = $request->query('from')) && $dateOk($from)) {
            $query->whereRaw("(wheel_leads.created_at at time zone 'UTC' at time zone 'Europe/Istanbul')::date >= ?", [$from]);
        }
        if (($to = $request->query('to')) && $dateOk($to)) {
            $query->whereRaw("(wheel_leads.created_at at time zone 'UTC' at time zone 'Europe/Istanbul')::date <= ?", [$to]);
        }

        return $query;
    }

    /**
     * Katılımcı raporunu CSV (UTF-8 BOM, Excel uyumlu) olarak indirir. leads() ile aynı
     * filtreler; sayfalamasız tüm kayıtlar (chunk ile bellek dostu).
     */
    public function leadsExport(Request $request, int $id): StreamedResponse
    {
        $c = WheelCampaign::findOrFail($id);
        $query = $this->leadsQuery($c, $request);

        $statusLabels = [
            'none' => '—', 'pending' => 'Bekliyor', 'issued' => 'Verildi',
            'failed' => 'Başarısız', 'redeemed' => 'Kullanıldı', 'expired' => 'Süresi doldu',
        ];

        $filename = 'cark-' . $c->slug . '-katilimcilar-' . now()->format('Ymd-Hi') . '.csv';

        return response()->streamDownload(function () use ($query, $statusLabels) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM → Excel Türkçe karakterleri doğru açar
            fputcsv($out, [
                'Ad Soyad', 'E-posta', 'Telefon', 'KVKK', 'İleti İzni', 'Çevirme Tarihi', 'Oyun',
                'Ödül', 'Kupon Kodu', 'Kupon Durumu', 'Son Kullanma',
                'Sipariş Verildi mi', 'Sipariş Tarihi', 'Sipariş No', 'Sipariş Tutarı',
            ], ';');

            $query->chunk(500, function ($rows) use ($out, $statusLabels) {
                foreach ($rows as $r) {
                    $ordered = ! empty($r->order_no) || ! empty($r->used_at);
                    // coupon_status aliaslı kolon → WheelLead'de cast yok, string gelir.
                    $status = is_object($r->coupon_status) ? $r->coupon_status->value : (string) $r->coupon_status;
                    fputcsv($out, [
                        $r->full_name ?? '',
                        $r->email ?? '',
                        $r->phone ?? '',
                        $r->kvkk_consent ? 'Evet' : 'Hayır',
                        $r->comms_consent ? 'Evet' : 'Hayır',
                        $r->spun_at ?? '',
                        ($r->variant ?? 'wheel') === 'scratch' ? 'Kazı Kazan' : 'Çark',
                        $r->prize_label ?? '',
                        $r->coupon_code ?? '',
                        $statusLabels[$status] ?? $status,
                        $r->coupon_expires_at ?? '',
                        $ordered ? 'Evet' : 'Hayır',
                        $r->used_at ?? '',
                        $r->order_no ?? '',
                        $r->order_total !== null ? number_format((float) $r->order_total, 2, ',', '.') : '',
                    ], ';');
                }
            });

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /**
     * Test verilerini temizler: bu kampanyanın is_test lead/spin kayıtlarını siler ve
     * test kuponlarının Ticimax karşılıklarını "kullanıldı" işaretleyerek pasifleştirir
     * (Ticimax silme API'si yok). Canlı/gerçek müşteri kayıtlarına dokunmaz.
     */
    public function purgeTest(int $id): JsonResponse
    {
        $c = WheelCampaign::findOrFail($id);

        $testSpins = WheelSpin::where('wheel_campaign_id', $c->id)->where('is_test', true)->get();

        // Test kuponlarını Ticimax'ta pasifleştir (varsa ticimax_id).
        $neutralized = 0;
        $service = null;
        foreach ($testSpins as $spin) {
            $ticimaxId = (int) ($spin->metadata['ticimax_id'] ?? 0);
            if ($ticimaxId <= 0) {
                continue;
            }
            $service ??= $this->ticimaxFor($c->tenant_id);
            if ($service && ($service->markGiftVoucherUsed($ticimaxId)['success'] ?? false)) {
                $neutralized++;
            }
        }

        $leadIds = $testSpins->pluck('wheel_lead_id')->filter()->unique()->all();
        $spinCount = $testSpins->count();

        WheelSpin::where('wheel_campaign_id', $c->id)->where('is_test', true)->forceDelete();
        if ($leadIds) {
            WheelLead::whereIn('id', $leadIds)->where('is_test', true)->forceDelete();
        }
        // Artakalan test lead'leri (spin'siz) de temizle.
        WheelLead::where('wheel_campaign_id', $c->id)->where('is_test', true)->forceDelete();

        return response()->json([
            'deleted_spins' => $spinCount,
            'neutralized_coupons' => $neutralized,
        ]);
    }

    private function ticimaxFor(int $tenantId): ?\App\Services\TicimaxService
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
        $s = \App\Services\TicimaxService::fromChannel($channel);

        return $s->isAvailable() ? $s : null;
    }

    // ───────────────────────── ÖNİZLEME TOKEN ─────────────────────────

    /**
     * Yunbi üzerinde test için kısa ömürlü (30dk) imzalı önizleme token'ı.
     * Bu token ile public widget, taslak kampanyayı da gösterir ve çevirmeler kaydedilmez.
     */
    public function previewToken(int $id): JsonResponse
    {
        $c = WheelCampaign::with('tenant')->findOrFail($id);

        $token = Crypt::encryptString(json_encode([
            't' => $c->tenant_id,
            'c' => $c->id,
            'exp' => now()->addMinutes(30)->timestamp,
        ]));

        return response()->json([
            'token' => $token,
            'tenant' => $c->tenant?->slug,
            'campaign' => $c->slug,
        ]);
    }

    // ───────────────────────── İSTATİSTİK ─────────────────────────

    public function stats(Request $request, int $id): JsonResponse
    {
        $c = WheelCampaign::findOrFail($id);

        // Tarih filtresi (Türkiye günü) — leadsQuery ile aynı mantık; spin + lead + ciro
        // hepsi bu aralığa göre hesaplanır. created_at UTC → Europe/Istanbul'a çevrilir.
        $dateOk = fn ($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);
        $from = $dateOk($request->query('from')) ? $request->query('from') : null;
        $to = $dateOk($request->query('to')) ? $request->query('to') : null;
        $applyDate = function ($q, string $col) use ($from, $to) {
            if ($from) {
                $q->whereRaw("($col at time zone 'UTC' at time zone 'Europe/Istanbul')::date >= ?", [$from]);
            }
            if ($to) {
                $q->whereRaw("($col at time zone 'UTC' at time zone 'Europe/Istanbul')::date <= ?", [$to]);
            }

            return $q;
        };

        // Test çevirmeleri istatistiğe karılmaz.
        $ids = $this->statsCampaignIds($c); // A/B kampanyasında A+B'nin toplamı
        $spins = WheelSpin::query()->whereIn('wheel_spins.wheel_campaign_id', $ids)->where('is_test', false);
        $applyDate($spins, 'wheel_spins.created_at');
        $totalSpins = (clone $spins)->count();
        $wins = (clone $spins)->where('is_win', true)->count();
        $couponsIssued = (clone $spins)->whereNotNull('coupon_code')->count();
        // "Kullanıldı" = kupon koduyla EŞLEŞEN ÖDENMİŞ sipariş var (tablo/ciro ile birebir
        // tutarlı; coupon_status saatlik senkronla geciktiği için ona bakmıyoruz).
        $paidExists = "exists (select 1 from orders o where o.coupon_code = wheel_spins.coupon_code and o.tenant_id = {$c->tenant_id} and o.payment_status = 1)";
        $couponsRedeemed = (clone $spins)->whereNotNull('coupon_code')->whereRaw($paidExists)->count();
        $leads = $applyDate(WheelLead::query()->whereIn('wheel_leads.wheel_campaign_id', $ids)->where('is_test', false), 'wheel_leads.created_at')->count();

        // Ciro: bu kampanyanın (test olmayan, tarih aralığındaki) kuponlarıyla verilen
        // ödenmiş siparişlerin toplam tutarı.
        $revenueQuery = DB::table('orders')
            ->join('wheel_spins', 'orders.coupon_code', '=', 'wheel_spins.coupon_code')
            ->where('orders.tenant_id', $c->tenant_id)
            ->where('orders.payment_status', 1) // sadece ödenmiş siparişler ciroya girer
            ->whereIn('wheel_spins.wheel_campaign_id', $ids)
            ->where('wheel_spins.is_test', false)
            ->whereNotNull('wheel_spins.coupon_code');
        $applyDate($revenueQuery, 'wheel_spins.created_at');
        $revenue = (float) $revenueQuery->sum('orders.total_amount');

        // Kupon durum dağılımı (pending = Ticimax'a yazılmayı bekliyor, failed = yazılamadı)
        $byStatus = (clone $spins)
            ->select('coupon_status', DB::raw('count(*) as total'))
            ->whereNotNull('coupon_code')
            ->groupBy('coupon_status')
            ->pluck('total', 'coupon_status');

        // Dilim bazlı dağılım: dağıtılan + kullanılan (kullanım oranı raporu)
        $bySlice = (clone $spins)
            ->select(
                'prize_label',
                DB::raw('count(*) as total'),
                DB::raw("count(*) filter (where {$paidExists}) as redeemed"),
            )
            ->groupBy('prize_label')
            ->orderByDesc('total')
            ->get();

        // A/B karşılaştırması: bu kampanya + (çarksa) A/B eşi kazı kazan kampanyası — aynı tarih
        // aralığında oynanma / kupon / kullanım / ciro. Kazı kazan kampanyasında ise onu eş
        // olarak gösteren çark kampanyası eklenir. Ciro kupon kodu eşleşmesiyle (ödenmiş sipariş).
        $compare = [$c];
        $ab = $c->isAb() ? $c : $c->abOwner();
        if ($ab) {
            [$va, $vb] = $ab->abVariants();
            $compare = array_values(array_filter([$va, $vb]));
        }
        $byVariant = collect($compare)->map(function (WheelCampaign $cc) use ($applyDate, $paidExists) {
            $q = $cc->spins()->getQuery()->where('is_test', false);
            $applyDate($q, 'wheel_spins.created_at');
            $r = $q->selectRaw(
                'count(*) as spins, count(*) filter (where is_win) as wins, '
                . 'count(*) filter (where coupon_code is not null) as coupons_issued, '
                . "count(*) filter (where coupon_code is not null and {$paidExists}) as coupons_redeemed, "
                . "coalesce(sum((select max(o.total_amount) from orders o where o.coupon_code = wheel_spins.coupon_code and o.tenant_id = {$cc->tenant_id} and o.payment_status = 1)), 0) as revenue"
            )->first();

            return [
                'campaign_id' => $cc->id,
                'name' => $cc->name,
                'variant' => $cc->isScratch() ? 'scratch' : 'wheel',
                'valid_minutes' => $cc->isScratch() ? $cc->scratchSettings()['valid_minutes'] : null,
                'spins' => (int) $r->spins,
                'wins' => (int) $r->wins,
                'coupons_issued' => (int) $r->coupons_issued,
                'coupons_redeemed' => (int) $r->coupons_redeemed,
                'redeem_rate' => (int) $r->coupons_issued > 0 ? round((int) $r->coupons_redeemed / (int) $r->coupons_issued * 100, 1) : 0,
                'revenue' => round((float) $r->revenue, 2),
            ];
        })->values();

        return response()->json([
            'leads' => $leads,
            'spins' => $totalSpins,
            'by_variant' => $byVariant,
            'wins' => $wins,
            'win_rate' => $totalSpins > 0 ? round($wins / $totalSpins * 100, 1) : 0,
            'coupons_issued' => $couponsIssued,
            'coupons_redeemed' => $couponsRedeemed,
            'redeem_rate' => $couponsIssued > 0 ? round($couponsRedeemed / $couponsIssued * 100, 1) : 0,
            'coupons_pending' => (int) ($byStatus['pending'] ?? 0),
            'coupons_failed' => (int) ($byStatus['failed'] ?? 0),
            'revenue' => round($revenue, 2),
            'by_slice' => $bySlice,
        ]);
    }

    // ───────────────────────── yardımcılar ─────────────────────────

    private function validatePayload(Request $request, ?int $campaignId): array
    {
        $required = $campaignId === null ? 'required' : 'sometimes';

        return $request->validate([
            'name' => "$required|string|max:190",
            'slug' => 'nullable|string|max:120|regex:/^[a-z0-9\-]+$/i',
            'status' => ['sometimes', Rule::enum(WheelCampaignStatus::class)],
            'design' => 'sometimes|array',
            'trigger_rules' => 'sometimes|array',
            'form_fields' => 'sometimes|array',
            'starts_at' => 'sometimes|nullable|date',
            'ends_at' => 'sometimes|nullable|date',
            'coupon_provider' => 'sometimes|in:display,ticimax',
            'coupon_valid_hours' => 'sometimes|integer',
            // Oyun türü yalnız oluştururken (sonradan değişmez; kayıtlar oyuna bağlı)
            'game_type' => 'sometimes|in:wheel,scratch,ab',
            // settings jsonb: çark → A/B eşi; kazı kazan → süre + formsuz mod
            'settings' => 'sometimes|array',
            'settings.ab_percent' => 'sometimes|integer|min:0|max:100',
            'settings.ab_campaign_a_id' => 'sometimes|nullable|integer',
            'settings.ab_campaign_b_id' => 'sometimes|nullable|integer',
            'settings.scratch_valid_minutes' => 'sometimes|integer|min:5|max:1440',
            'settings.scratch_skip_form' => 'sometimes|boolean',

            'slices' => 'sometimes|array|min:2|max:12',
            'slices.*.id' => 'sometimes|integer',
            'slices.*.label' => 'required_with:slices|string|max:120',
            'slices.*.prize_type' => ['required_with:slices', Rule::enum(WheelPrizeType::class)],
            'slices.*.prize_value' => 'sometimes|numeric|min:0',
            'slices.*.weight' => 'sometimes|integer|min:0',
            'slices.*.color' => 'sometimes|nullable|string|max:32',
            'slices.*.coupon_code_template' => 'sometimes|nullable|string|max:64',
            'slices.*.stock_limit' => 'sometimes|nullable|integer|min:0',
            // Min. sepet tutarı (TL) — Ticimax kuponunda MinimumUrunTutari koşulu (0/boş = koşulsuz).
            'slices.*.min_basket' => 'sometimes|nullable|numeric|min:0',
        ]);
    }

    /**
     * Dilimleri senkronize et: gelen listede olmayan eski dilimler silinir,
     * id'li olanlar güncellenir, yeniler eklenir. sort_order gelen sıraya göre.
     * stock_used korunur (panel sıfırlamaz).
     */
    private function syncSlices(WheelCampaign $c, array $slices): void
    {
        if (empty($slices)) {
            return;
        }

        $keepIds = [];
        foreach (array_values($slices) as $i => $s) {
            $existing = ! empty($s['id'])
                ? WheelSlice::where('wheel_campaign_id', $c->id)->find($s['id'])
                : null;

            $attrs = [
                'tenant_id' => $c->tenant_id,
                'wheel_campaign_id' => $c->id,
                'label' => $s['label'],
                'prize_type' => $s['prize_type'],
                'prize_value' => round((float) ($s['prize_value'] ?? 0), 2),
                'weight' => $this->clamp((int) ($s['weight'] ?? 1), 'weight'),
                'color' => $s['color'] ?? null,
                'sort_order' => $i,
                'coupon_code_template' => $s['coupon_code_template'] ?? null,
                'stock_limit' => isset($s['stock_limit']) ? (int) $s['stock_limit'] : null,
                'settings' => $this->mergeSliceSettings($existing?->settings, $s),
            ];

            if ($existing) {
                $existing->fill($attrs)->save();
                $keepIds[] = $existing->id;

                continue;
            }
            $created = WheelSlice::create($attrs);
            $keepIds[] = $created->id;
        }

        // Listede olmayan eski dilimleri sil
        WheelSlice::where('wheel_campaign_id', $c->id)
            ->whereNotIn('id', $keepIds)
            ->delete();
    }

    /**
     * Dilim settings jsonb'sini günceller: mevcut anahtarları (ör. 'code') korur,
     * min_basket geldiyse set/unset eder. Ticimax kuponu MinimumUrunTutari'nı buradan okur.
     */
    private function mergeSliceSettings(?array $existing, array $incoming): ?array
    {
        $settings = is_array($existing) ? $existing : [];

        if (array_key_exists('min_basket', $incoming)) {
            $mb = round((float) ($incoming['min_basket'] ?? 0), 2);
            if ($mb > 0) {
                $settings['min_basket'] = $mb;
            } else {
                unset($settings['min_basket']);
            }
        }

        return $settings ?: null;
    }

    private function uniqueSlug(string $base, Request $request, ?int $ignoreId = null): string
    {
        $slug = Str::slug($base) ?: 'cark';
        $tenantId = auth()->user()->tenant_id ?? (int) $request->header('X-Tenant-Id');

        $original = $slug;
        $n = 1;
        while (
            WheelCampaign::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('slug', $slug)
                ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
                ->exists()
        ) {
            $slug = $original . '-' . (++$n);
        }

        return $slug;
    }

    /**
     * settings jsonb'de oyun anahtarlarını günceller; bilinmeyen anahtarlara dokunmaz.
     * Çark: ab_percent + ab_partner_campaign_id (aynı tenant'ta kazı kazan kampanyası olmalı).
     * Kazı kazan: scratch_valid_minutes + scratch_skip_form.
     */
    private function mergeScratchSettings(?array $existing, array $incoming): array
    {
        $s = is_array($existing) ? $existing : [];
        $lim = config('wheel.limits_scratch');
        if (array_key_exists('ab_percent', $incoming)) {
            $s['ab_percent'] = max($lim['ab_percent']['min'], min($lim['ab_percent']['max'], (int) $incoming['ab_percent']));
        }
        foreach (['ab_campaign_a_id', 'ab_campaign_b_id'] as $k) {
            if (array_key_exists($k, $incoming)) {
                $pid = (int) ($incoming[$k] ?? 0);
                // Yalnız bu tenant'ın OYUN kampanyası (çark/kazı kazan) A/B tarafı olabilir (tenant scope aktif).
                $ok = $pid > 0 && WheelCampaign::where('id', $pid)->whereIn('game_type', ['wheel', 'scratch'])->exists();
                if ($ok) {
                    $s[$k] = $pid;
                } else {
                    unset($s[$k]);
                }
            }
        }
        if (array_key_exists('scratch_valid_minutes', $incoming)) {
            $s['scratch_valid_minutes'] = max($lim['valid_minutes']['min'], min($lim['valid_minutes']['max'], (int) $incoming['scratch_valid_minutes']));
        }
        if (array_key_exists('scratch_skip_form', $incoming)) {
            $s['scratch_skip_form'] = filter_var($incoming['scratch_skip_form'], FILTER_VALIDATE_BOOLEAN);
        }

        return $s;
    }

    /** İstatistik/katılımcı için kampanya id listesi: A/B kampanyasında A+B, yoksa kendisi. */
    private function statsCampaignIds(WheelCampaign $c): array
    {
        if ($c->isAb()) {
            [$a, $b] = $c->abVariants();
            $ids = array_values(array_filter([$a?->id, $b?->id]));

            return $ids ?: [0];
        }

        return [$c->id];
    }

    private function sanitizeTrigger(array $t): array
    {
        $d = config('wheel.default_trigger');
        $out = array_merge($d, array_intersect_key($t, $d));
        $out['type'] = in_array($out['type'] ?? null, ['delay', 'exit_intent', 'manual'], true) ? $out['type'] : $d['type'];
        $out['device'] = in_array($out['device'] ?? null, ['all', 'desktop', 'mobile'], true) ? $out['device'] : $d['device'];
        $out['delay_seconds'] = $this->clamp((int) ($out['delay_seconds'] ?? $d['delay_seconds']), 'delay_seconds');
        $out['frequency_days'] = $this->clamp((int) ($out['frequency_days'] ?? $d['frequency_days']), 'frequency_days');
        $out['show_once_per_win'] = (bool) ($out['show_once_per_win'] ?? true);

        return $out;
    }

    private function sanitizeForm(array $f): array
    {
        $d = config('wheel.default_form');
        $out = array_merge($d, array_intersect_key($f, $d));
        foreach (['collect_name', 'collect_email', 'collect_phone', 'require_name', 'require_email', 'require_phone', 'kvkk_required', 'comms_required'] as $b) {
            $out[$b] = (bool) ($out[$b] ?? $d[$b]);
        }
        $out['kvkk_text'] = (string) ($out['kvkk_text'] ?? $d['kvkk_text']);
        $out['kvkk_version'] = (string) ($out['kvkk_version'] ?? $d['kvkk_version']);
        $out['comms_text'] = (string) ($out['comms_text'] ?? $d['comms_text']);

        return $out;
    }

    private function clamp(int $value, string $key): int
    {
        $limits = config("wheel.limits.$key");
        if (! $limits) {
            return $value;
        }

        return max($limits['min'], min($limits['max'], $value));
    }

    private function mergeArray(array $defaults, array $given): array
    {
        return array_merge($defaults, array_intersect_key($given, $defaults));
    }

    private function campaignView(WheelCampaign $c): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'slug' => $c->slug,
            'tenant_slug' => optional($c->tenant)->slug,
            'status' => $c->status->value,
            'status_label' => $c->status->label(),
            'design' => array_merge(config('wheel.default_design'), $c->design ?? []),
            'trigger_rules' => array_merge(config('wheel.default_trigger'), $c->trigger_rules ?? []),
            'form_fields' => array_merge(config('wheel.default_form'), $c->form_fields ?? []),
            'starts_at' => optional($c->starts_at)->format('Y-m-d H:i:s'),
            'ends_at' => optional($c->ends_at)->format('Y-m-d H:i:s'),
            'coupon_provider' => $c->coupon_provider,
            'coupon_valid_hours' => (int) $c->coupon_valid_hours,
            'game_type' => $c->game_type ?: 'wheel',
            // Oyun ayarları (panel formu bu anahtarları aynen geri gönderir)
            'settings' => [
                'ab_percent' => $c->abSettings()['percent'],
                'ab_campaign_a_id' => $c->abSettings()['a_campaign_id'],
                'ab_campaign_b_id' => $c->abSettings()['b_campaign_id'],
                'scratch_valid_minutes' => $c->scratchSettings()['valid_minutes'],
                'scratch_skip_form' => $c->scratchSettings()['skip_form'],
            ],
            // A/B eşinin adı (çark kampanyasında gösterim için)
            'ab_a_name' => ($vv = $c->abVariants())[0]?->name,
            'ab_b_name' => $vv[1]?->name,
            'ab_owner_name' => ($o = $c->abOwner()) ? $o->name : null,
            'is_live_now' => $c->isLiveNow(),
            'slices' => $c->slices->map(fn (WheelSlice $s) => [
                'id' => $s->id,
                'label' => $s->label,
                'prize_type' => $s->prize_type->value,
                'prize_value' => (float) $s->prize_value,
                'weight' => (int) $s->weight,
                'color' => $s->color,
                'sort_order' => (int) $s->sort_order,
                'coupon_code_template' => $s->coupon_code_template,
                'stock_limit' => $s->stock_limit,
                'stock_used' => (int) $s->stock_used,
                'min_basket' => (float) $s->min_basket,
            ])->values(),
        ];
    }
}
