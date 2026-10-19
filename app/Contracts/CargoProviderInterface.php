<?php

namespace App\Contracts;

use App\Models\ReturnRequest;

/**
 * İade kargo sağlayıcısı sözleşmesi (Sürat Kargo, DHL Kargo/MNG...).
 *
 * Dönüş yapıları SuratKargoService'in mevcut (canlıda kanıtlı) sözleşmesiyle birebirdir —
 * çağrı noktaları (PublicReturnController, ReturnController, Track/Expire cron'ları)
 * sağlayıcıdan bağımsız aynı alanları okur.
 */
interface CargoProviderInterface
{
    /** Kanonik sağlayıcı anahtarı — ReturnRequest.cargo_provider'a yazılır (örn 'surat-kargo', 'dhl-kargo'). */
    public function providerKey(): string;

    /** Müşteriye gösterilen kargo firması adı (SMS {kargo} değişkeni + panel etiketi). */
    public function displayName(): string;

    /** Entegrasyon anahtarı (tenant returns_integrations.{key}.enabled). Kapalıyken hiçbir işlem yapılmaz. */
    public function isEnabled(): bool;

    /** dry_run=true iken sağlayıcıya canlı istek atılmaz; payload loglanır. */
    public function isDryRun(): bool;

    /** Kimlik bilgileri eksiksiz mi? */
    public function isConfigured(): bool;

    /** İade kodunun geçerlilik süresi (gün) — returns:expire-shipments + müşteri SMS'i kullanır. */
    public function expireDays(): int;

    /**
     * İade gönderisi oluştur → müşteriye verilecek iade kargo kodu.
     *
     * @return array{success:bool, dry_run:bool, provider:string, tracking_code:?string, label_url:?string, error:?string, payload:array}
     */
    public function createReturnShipment(ReturnRequest $r): array;

    /**
     * Kargo durumu sorgula (returns:track-shipments cron'u).
     *
     * @return array{success:bool, dry_run:bool, status:?string, in_transit:bool, delivered:bool, error:?string}
     */
    public function queryShipment(string $code): array;

    /**
     * Kargoya verilmemiş gönderi kaydını sağlayıcıda iptal et/sil (returns:expire-shipments).
     * İdempotent: kayıt zaten yoksa başarı sayılır.
     *
     * @return array{success:bool, dry_run:bool, result:?string, error:?string}
     */
    public function cancelShipment(string $code): array;
}
