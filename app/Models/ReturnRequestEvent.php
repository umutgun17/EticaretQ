<?php

namespace App\Models;

use App\Enums\ReturnActorType;
use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only denetim günlüğü kaydı.
 * Bu model güncellenmez/silinmez — yalnızca oluşturulur (ReturnAuditLogger üzerinden).
 */
class ReturnRequestEvent extends Model
{
    use BelongsToTenant;

    // Yalnızca created_at — güncellenebilir kayıt değil
    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'return_request_id',
        'actor_type',
        'actor_id',
        'action',
        'from_status',
        'to_status',
        'amount',
        'payload',
        'ip_address',
        'user_agent',
    ];

    protected function casts(): array
    {
        return [
            'actor_type' => ReturnActorType::class,
            'amount' => 'decimal:2',
            'payload' => 'array',
        ];
    }

    public function returnRequest(): BelongsTo
    {
        return $this->belongsTo(ReturnRequest::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
