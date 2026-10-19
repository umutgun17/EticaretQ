<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WheelLead extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'wheel_campaign_id',
        'is_test',
        'full_name',
        'email',
        'phone',
        'kvkk_consent',
        'kvkk_consent_version',
        'kvkk_consent_text',
        'kvkk_consent_at',
        'comms_consent',
        'comms_consent_text',
        'comms_consent_at',
        'source_url',
        'ip_address',
        'user_agent',
        'device_fingerprint',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'is_test' => 'boolean',
            'kvkk_consent' => 'boolean',
            'kvkk_consent_at' => 'datetime',
            'comms_consent' => 'boolean',
            'comms_consent_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(WheelCampaign::class, 'wheel_campaign_id');
    }

    public function spins(): HasMany
    {
        return $this->hasMany(WheelSpin::class);
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
