<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductReviewSummary extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'product_id',
        'trendyol_content_id',
        'avg_rate',
        'reviews_synced_rating',
        'rate_count',
        'comment_count',
        'rate_five',
        'rate_four',
        'rate_three',
        'rate_two',
        'rate_one',
        'ai_summary',
        'last_synced_at',
    ];

    protected function casts(): array
    {
        return [
            'trendyol_content_id' => 'integer',
            'avg_rate' => 'decimal:2',
            'last_synced_at' => 'datetime',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
