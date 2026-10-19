<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReturnRefund extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'return_request_id',
        'provider',
        'idempotency_key',
        'amount',
        'currency',
        'status',
        'provider_txn_id',
        'coupon_code',
        'attempts',
        'error_message',
        'request_payload',
        'response_payload',
        'processed_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'attempts' => 'integer',
            'request_payload' => 'array',
            'response_payload' => 'array',
            'processed_at' => 'datetime',
        ];
    }

    public function returnRequest(): BelongsTo
    {
        return $this->belongsTo(ReturnRequest::class);
    }
}
