<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Geciken siparişin Nebim + Sürat kontrol sonucu (bkz. App\Services\Crm\DelayShipmentChecker). */
class OrderShipmentCheck extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'findings' => 'array',
            'nebim_checked_at' => 'datetime',
            'checked_at' => 'datetime',
        ];
    }
}
