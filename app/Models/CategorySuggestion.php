<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class CategorySuggestion extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'product_id',
        'action',
        'current',
        'suggested_primary_id',
        'suggested_category_ids',
        'new_category',
        'confidence',
        'tier',
        'sources',
        'rationale',
        'status',
        'error',
        'applied_at',
    ];

    protected function casts(): array
    {
        return [
            'current' => 'array',
            'suggested_category_ids' => 'array',
            'new_category' => 'array',
            'sources' => 'array',
            'confidence' => 'decimal:3',
            'applied_at' => 'datetime',
        ];
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
