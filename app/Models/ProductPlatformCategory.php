<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class ProductPlatformCategory extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'product_id',
        'platform_product_id',
        'platform_category_id',
        'sira',
        'is_primary',
        'synced_at',
    ];

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'synced_at' => 'datetime',
        ];
    }
}
