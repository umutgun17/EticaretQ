<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class PlatformCategory extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'platform_category_id',
        'parent_platform_id',
        'name',
        'path',
        'depth',
        'url',
        'is_active',
        'children_count',
        'product_count',
        'is_assignable',
        'meta',
        'synced_at',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'is_assignable' => 'boolean',
            'meta' => 'array',
            'synced_at' => 'datetime',
        ];
    }
}
