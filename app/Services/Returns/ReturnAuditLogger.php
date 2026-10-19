<?php

namespace App\Services\Returns;

use App\Enums\ReturnActorType;
use App\Models\ReturnRequest;
use App\Models\ReturnRequestEvent;
use Illuminate\Http\Request;

/**
 * İade/İptal denetim günlüğü — append-only.
 *
 * Müşteri (public), personel, yönetici ve sistem tarafından yapılan HER işlem;
 * tutar/zaman/durum geçişi/IP ile birlikte kalıcı kaydedilir. Geriye dönük inceleme
 * ve suistimal analizi için tek doğru kaynak budur. Kayıtlar güncellenmez/silinmez.
 */
class ReturnAuditLogger
{
    /**
     * @param  array  $opts  [
     *   'actor_type'  => ReturnActorType|string (varsayılan system),
     *   'actor_id'    => ?int,
     *   'from_status' => ?string, 'to_status' => ?string,
     *   'amount'      => ?float,
     *   'payload'     => ?array,  (hassas tam kart verisi ASLA yazılmaz)
     *   'request'     => ?Request (IP/User-Agent otomatik alınır),
     * ]
     */
    public function log(ReturnRequest $returnRequest, string $action, array $opts = []): ReturnRequestEvent
    {
        $actorType = $opts['actor_type'] ?? ReturnActorType::System;
        if ($actorType instanceof ReturnActorType) {
            $actorType = $actorType->value;
        }

        $request = $opts['request'] ?? (app()->bound('request') ? request() : null);
        $ip = $opts['ip_address'] ?? ($request instanceof Request ? $request->ip() : null);
        $ua = $opts['user_agent'] ?? ($request instanceof Request ? substr((string) $request->userAgent(), 0, 255) : null);

        return ReturnRequestEvent::create([
            // Public/müşteri bağlamında auth yok → tenant_id'yi açıkça talepten al
            'tenant_id' => $returnRequest->tenant_id,
            'return_request_id' => $returnRequest->id,
            'actor_type' => $actorType,
            'actor_id' => $opts['actor_id'] ?? null,
            'action' => $action,
            'from_status' => $opts['from_status'] ?? null,
            'to_status' => $opts['to_status'] ?? null,
            'amount' => $opts['amount'] ?? null,
            'payload' => $opts['payload'] ?? null,
            'ip_address' => $ip,
            'user_agent' => $ua,
        ]);
    }
}
