<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockAlert extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'channel_id', 'product_id', 'customer_id',
        'platform_product_id', 'variant_label', 'name', 'email', 'phone',
        'status', 'notified_at',
    ];

    protected function casts(): array
    {
        return ['notified_at' => 'datetime'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
