<?php

namespace App\Models;

use App\Enums\WheelCampaignStatus;
use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WheelCampaign extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'name',
        'slug',
        'status',
        'game_type',
        'design',
        'trigger_rules',
        'form_fields',
        'starts_at',
        'ends_at',
        'coupon_provider',
        'coupon_valid_hours',
        'settings',
    ];

    protected function casts(): array
    {
        return [
            'status' => WheelCampaignStatus::class,
            'design' => 'array',
            'trigger_rules' => 'array',
            'form_fields' => 'array',
            'settings' => 'array',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'coupon_valid_hours' => 'integer',
        ];
    }

    // ── İlişkiler ──

    public function slices(): HasMany
    {
        return $this->hasMany(WheelSlice::class)->orderBy('sort_order');
    }

    public function leads(): HasMany
    {
        return $this->hasMany(WheelLead::class);
    }

    public function spins(): HasMany
    {
        return $this->hasMany(WheelSpin::class);
    }

    // ── Yardımcılar ──

    /**
     * Kampanya şu an widget'ta çevrilebilir mi?
     * Aktif statü + (varsa) tarih penceresi içinde.
     */
    /**
     * Kazı kazan A/B ayarları (settings jsonb + config varsayılanları, sınırlı).
     * ab_percent 0 → herkes çark görür; 50 → ziyaretçilerin yarısı kazı kazan.
     */
    /** Oyun türü: wheel (çark) | scratch (kazı kazan). */
    public function isScratch(): bool
    {
        return ($this->game_type ?? 'wheel') === 'scratch';
    }

    /**
     * KAZI KAZAN kampanyasının kendi ayarları (settings jsonb + config varsayılanları, sınırlı).
     * Başlık/alt başlık/buton/kulakçık metinleri design alanlarından gelir (çarkla aynı editör).
     */
    public function scratchSettings(): array
    {
        $s = $this->settings ?? [];
        $cfg = config('wheel.scratch');
        $lim = config('wheel.limits_scratch');
        $min = (int) (($s['scratch_valid_minutes'] ?? null) ?: $cfg['valid_minutes']);

        return [
            'valid_minutes' => max($lim['valid_minutes']['min'], min($lim['valid_minutes']['max'], $min)),
            'skip_form' => (bool) ($s['scratch_skip_form'] ?? $cfg['skip_form'] ?? false),
        ];
    }

    /** A/B TESTİ kampanyası: iki oyun kampanyasını (A ve B) karşılaştırır, kendi oyunu yoktur. */
    public function isAb(): bool
    {
        return ($this->game_type ?? 'wheel') === 'ab';
    }

    /**
     * A/B kampanyasının ayarı: A (varsayılan gösterilen) ve B kampanyaları + B'nin yüzdesi.
     * Tek gömme kodu (A/B kampanyasının ya da A'nın slug'ı); kura widget'ta kalıcı; kayıt/kupon
     * ilgili oyun kampanyasına düşer; istatistik A/B kampanyasında yan yana görünür.
     */
    public function abSettings(): array
    {
        $s = $this->settings ?? [];
        $lim = config('wheel.limits_scratch');
        $pct = (int) ($s['ab_percent'] ?? 0);

        return [
            'percent' => max($lim['ab_percent']['min'], min($lim['ab_percent']['max'], $pct)), // B'yi görecek %
            'a_campaign_id' => (int) ($s['ab_campaign_a_id'] ?? 0) ?: null,
            'b_campaign_id' => (int) ($s['ab_campaign_b_id'] ?? 0) ?: null,
        ];
    }

    /** A/B kampanyasının A ve B oyun kampanyaları (slices yüklü). @return array{0:?WheelCampaign,1:?WheelCampaign} */
    public function abVariants(): array
    {
        if (! $this->isAb()) {
            return [null, null];
        }
        $ab = $this->abSettings();
        $load = fn (?int $id) => $id ? WheelCampaign::query()
            ->where('tenant_id', $this->tenant_id)
            ->whereIn('game_type', ['wheel', 'scratch'])
            ->with(['slices' => fn ($q) => $q->orderBy('sort_order')])
            ->find($id) : null;

        return [$load($ab['a_campaign_id']), $load($ab['b_campaign_id'])];
    }

    /**
     * Bu oyun kampanyasını A olarak kullanan YAYINDAKİ A/B kampanyası (varsa). Böylece sitede
     * A'nın gömme kodu dururken A/B kampanyası açılınca kura devreye girer (tema değişmez).
     */
    public function abOwner(): ?WheelCampaign
    {
        if ($this->isAb()) {
            return null;
        }

        return WheelCampaign::query()
            ->where('tenant_id', $this->tenant_id)
            ->where('game_type', 'ab')
            ->where('status', 'active')
            ->whereRaw("(settings->>'ab_campaign_a_id')::int = ?", [$this->id])
            ->orderByDesc('id')
            ->first();
    }

    public function isLiveNow(): bool
    {
        if (! $this->status->isLive()) {
            return false;
        }
        $now = now();
        if ($this->starts_at && $now->lt($this->starts_at)) {
            return false;
        }
        if ($this->ends_at && $now->gt($this->ends_at)) {
            return false;
        }

        return true;
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
