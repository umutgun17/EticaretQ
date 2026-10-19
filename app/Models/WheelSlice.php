<?php

namespace App\Models;

use App\Enums\WheelPrizeType;
use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WheelSlice extends Model
{
    use BelongsToTenant;

    /** settings.min_basket'i panele düz alan olarak yayınla (Ticimax MinimumUrunTutari). */
    protected $appends = ['min_basket'];

    protected $fillable = [
        'tenant_id',
        'wheel_campaign_id',
        'label',
        'prize_type',
        'prize_value',
        'weight',
        'color',
        'sort_order',
        'coupon_code_template',
        'stock_limit',
        'stock_used',
        'settings',
    ];

    protected function casts(): array
    {
        return [
            'prize_type' => WheelPrizeType::class,
            'prize_value' => 'decimal:2',
            'weight' => 'integer',
            'sort_order' => 'integer',
            'stock_limit' => 'integer',
            'stock_used' => 'integer',
            'settings' => 'array',
        ];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(WheelCampaign::class, 'wheel_campaign_id');
    }

    /** Min. sepet tutarı (TL) — settings.min_basket. 0/yok = koşulsuz. */
    protected function minBasket(): Attribute
    {
        return Attribute::get(fn () => (float) ($this->settings['min_basket'] ?? 0));
    }

    /**
     * Bu dilim hâlâ kazandırılabilir mi? (stok kontrolü)
     * Ağırlığı 0 olan dilim seçilmez; stoğu dolan dilim devre dışı.
     */
    public function isSelectable(): bool
    {
        if ($this->weight <= 0) {
            return false;
        }
        if ($this->stock_limit !== null && $this->stock_used >= $this->stock_limit) {
            return false;
        }

        return true;
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
