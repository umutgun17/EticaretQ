<?php

namespace App\Models;

use App\Enums\RefundMethod;
use App\Enums\ReturnStatus;
use App\Enums\ReturnType;
use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReturnRequest extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'channel_id',
        'type',
        'public_code',
        'status',
        'platform_order_id',
        'order_no',
        'customer_name',
        'customer_email',
        'customer_phone',
        'currency',
        'refund_method',
        'requested_amount',
        'approved_amount',
        'refunded_amount',
        'paid_amount_snapshot',
        'eligibility_snapshot',
        'staff_approved_by',
        'staff_approved_at',
        'manager_approved_by',
        'manager_approved_at',
        'reject_reason',
        'rejected_by',
        'rejected_at',
        'cargo_provider',
        'cargo_tracking_code',
        'cargo_label_url',
        'shipment_status',
        'received_at',
        'nebim_result',
        'metadata',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'type' => ReturnType::class,
            'status' => ReturnStatus::class,
            'refund_method' => RefundMethod::class,
            'requested_amount' => 'decimal:2',
            'approved_amount' => 'decimal:2',
            'refunded_amount' => 'decimal:2',
            'paid_amount_snapshot' => 'decimal:2',
            'eligibility_snapshot' => 'array',
            'nebim_result' => 'array',
            'metadata' => 'array',
            'staff_approved_at' => 'datetime',
            'manager_approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'received_at' => 'datetime',
        ];
    }

    // ── İlişkiler ──

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(ReturnRequestItem::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(ReturnRequestEvent::class);
    }

    /** Personel notları (append-only audit içinde action=staff_note satırları). */
    public function staffNotes(): HasMany
    {
        return $this->hasMany(ReturnRequestEvent::class)->where('action', 'staff_note')->orderBy('created_at')->orderBy('id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(ReturnAttachment::class);
    }

    public function refunds(): HasMany
    {
        return $this->hasMany(ReturnRefund::class);
    }

    public function staffApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'staff_approved_by');
    }

    public function managerApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_approved_by');
    }

    /** Talebi panelden açan personel (yalnız personel kaynaklı talepler — eksik/hatalı ürün). */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    // ── Yardımcılar ──

    /**
     * Bu talep için bugüne kadar başarıyla iade edilen tutar.
     * Para tavanı kontrolünde kullanılır (refunded + yeni ≤ paid).
     */
    public function remainingRefundable(): float
    {
        $cap = (float) ($this->paid_amount_snapshot ?? 0);

        return max(0, round($cap - (float) $this->refunded_amount, 2));
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
