<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CroAction extends Model
{
    public const STATUSES = ['idea', 'planned', 'running', 'done', 'discarded'];

    public const CATEGORIES = [
        'pdp', 'category', 'cart', 'checkout', 'trust', 'speed', 'mobile',
        'search', 'personalization', 'retention', 'other',
    ];

    protected $fillable = [
        'tenant_id', 'key', 'title', 'category', 'surface', 'hypothesis', 'description',
        'status', 'impact', 'confidence', 'ease', 'expected_uplift', 'feature', 'feature_url',
        'started_at', 'finished_at', 'result', 'result_uplift', 'sort_order', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'result_uplift' => 'float',
        ];
    }

    /** ICE puanı: etki × güven × kolaylık (1-125) — panelde sıralama için. */
    public function iceScore(): int
    {
        return (int) $this->impact * (int) $this->confidence * (int) $this->ease;
    }

    public function toArray(): array
    {
        $arr = parent::toArray();
        $arr['ice'] = $this->iceScore();

        return $arr;
    }
}
