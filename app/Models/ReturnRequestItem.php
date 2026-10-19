<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReturnRequestItem extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'return_request_id',
        'platform_line_id',
        'platform_product_id',
        'platform_variant_id',
        'product_name',
        'sku',
        'barcode',
        'variant_info',
        'image_url',
        'qty_ordered',
        'qty_requested',
        'qty_approved',
        'unit_price',
        'line_discount_share',
        'refundable_amount',
        'reason_code',
        'reason_note',
        'item_condition',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'qty_ordered' => 'integer',
            'qty_requested' => 'integer',
            'qty_approved' => 'integer',
            'unit_price' => 'decimal:2',
            'line_discount_share' => 'decimal:2',
            'refundable_amount' => 'decimal:2',
            'metadata' => 'array',
        ];
    }

    public function returnRequest(): BelongsTo
    {
        return $this->belongsTo(ReturnRequest::class);
    }
}
