<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Sürat carisinden çekilen gönderi (bkz. App\Services\Cargo\SuratShipmentFeed). */
class CargoShipment extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'raw' => 'array',
            'amount' => 'float',
            'shipped_at' => 'datetime',
        ];
    }
}
