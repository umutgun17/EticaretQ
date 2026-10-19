<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductReview extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'product_id',
        'trendyol_content_id',
        'platform_review_id',
        'rate',
        'user_full_name',
        'comment',
        'comment_date_text',
        'reviewed_at',
        'images',
        'like_count',
        'seller_reply',
    ];

    protected function casts(): array
    {
        return [
            'images' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
