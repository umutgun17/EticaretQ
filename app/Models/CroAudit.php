<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CroAudit extends Model
{
    protected $fillable = [
        'tenant_id', 'run_id', 'page_type', 'url', 'http_status', 'ttfb_ms', 'total_ms',
        'html_bytes', 'score', 'checks', 'meta',
    ];

    protected function casts(): array
    {
        return [
            'checks' => 'array',
            'meta' => 'array',
        ];
    }
}
