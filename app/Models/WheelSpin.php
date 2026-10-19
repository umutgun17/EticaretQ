<?php

namespace App\Models;

use App\Enums\WheelCouponStatus;
use App\Enums\WheelPrizeType;
use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WheelSpin extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'wheel_campaign_id',
        'wheel_lead_id',
        'wheel_slice_id',
        'is_test',
        'variant',
        'prize_label',
        'prize_type',
        'prize_value',
        'is_win',
        'coupon_code',
        'coupon_provider',
        'coupon_status',
        'coupon_expires_at',
        'redeemed_at',
        'ip_address',
        'device_fingerprint',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'prize_type' => WheelPrizeType::class,
            'prize_value' => 'decimal:2',
            'is_win' => 'boolean',
            'is_test' => 'boolean',
            'coupon_status' => WheelCouponStatus::class,
            'coupon_expires_at' => 'datetime',
            'redeemed_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(WheelCampaign::class, 'wheel_campaign_id');
    }

    public function lead(): BelongsTo
    {
        return $this->belongsTo(WheelLead::class, 'wheel_lead_id');
    }

    public function slice(): BelongsTo
    {
        return $this->belongsTo(WheelSlice::class, 'wheel_slice_id');
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
