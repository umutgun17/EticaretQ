<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Trendyol Seller API katalogunun barkod bazli kopyasi (bkz. trendyol:sync-catalog).
 * Bilincli olarak BelongsToTenant KULLANMAZ — komutlar ve kiyas servisi tenant'i
 * acikca verir (Product ile ayni yaklasim).
 */
class TrendyolProduct extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'images' => 'array',
            'attributes' => 'array',
            'approved' => 'boolean',
            'on_sale' => 'boolean',
            'archived' => 'boolean',
            'locked' => 'boolean',
            'blacklisted' => 'boolean',
            'rejected' => 'boolean',
            'has_active_campaign' => 'boolean',
            'is_missing' => 'boolean',
            'list_price' => 'decimal:2',
            'sale_price' => 'decimal:2',
            'platform_created_at' => 'datetime',
            'platform_updated_at' => 'datetime',
            'last_seen_at' => 'datetime',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }
}
