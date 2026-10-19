<?php

namespace App\Services\Returns;

use App\Models\Tenant;

/**
 * Tenant iptal/iade kurallarını okur, varsayılanlarla birleştirir ve
 * güvenli aralıklara sabitler (clamp). Kayıtlı veriye körü körüne güvenilmez —
 * tip/aralık doğrulaması her OKUMADA yapılır.
 */
class ReturnRulesService
{
    /**
     * @return array Birleştirilmiş + sanitize edilmiş kurallar.
     */
    public function forTenant(Tenant $tenant): array
    {
        $defaults = config('returns.default_rules', []);
        $stored = $tenant->settings['returns'] ?? [];
        if (! is_array($stored)) {
            $stored = [];
        }

        $merged = array_merge($defaults, $stored);

        return $this->sanitize($merged);
    }

    /**
     * İade kargo kodu geçerlilik süresi (gün) — tenant kuralı, panelden ayarlanır.
     * returns:expire-shipments ve kargo-kodu SMS'leri bu değeri kullanır.
     */
    public function shipmentExpireDays(Tenant $tenant): int
    {
        return (int) ($this->forTenant($tenant)['shipment_expire_days'] ?? 14);
    }

    /**
     * Tipleri ve aralıkları güvenli hale getir.
     */
    public function sanitize(array $rules): array
    {
        $defaults = config('returns.default_rules', []);
        $limits = config('returns.limits', []);

        $boolKeys = [
            'enabled', 'return_enabled', 'cancel_enabled', 'cancel_block_if_shipped',
            'cancel_block_if_prepared', 'refund_shipping', 'refund_shipping_cancel', 'refund_installment_fee', 'allow_store_credit',
            'allow_original_refund', 'promote_store_credit', 'require_condition_declaration',
            'block_if_open_request_exists', 'defect_enabled', 'campaign_discount_recovery', 'return_in_transit',
        ];
        foreach ($boolKeys as $k) {
            $rules[$k] = (bool) ($rules[$k] ?? $defaults[$k] ?? false);
        }

        $intKeys = ['return_window_days', 'staff_review_hours', 'manager_review_hours', 'min_items', 'defect_max_days', 'shipment_expire_days'];
        foreach ($intKeys as $k) {
            $val = (int) ($rules[$k] ?? $defaults[$k] ?? 0);
            if (isset($limits[$k])) {
                $val = max($limits[$k]['min'], min($limits[$k]['max'], $val));
            }
            $rules[$k] = $val;
        }

        // Eski 'window_basis' ayarı KALDIRILDI (2026-08-01): motor her zaman SİPARİŞ tarihini
        // kullanıyor (PublicReturnController::eligibility) — kayıtlı 'delivery' değeri hiçbir
        // yerde okunmuyordu ve "teslimden itibaren" yanılgısı üretiyordu. Kayıtlı kalıntı varsa
        // sessizce düşür ki panelde/ API çıktısında yanıltıcı alan görünmesin.
        unset($rules['window_basis']);

        foreach (['excluded_categories', 'excluded_skus'] as $k) {
            $rules[$k] = is_array($rules[$k] ?? null) ? array_values(array_filter(array_map('strval', $rules[$k]))) : [];
        }

        // Kusur red nedenleri — string listesi (fail-closed: boş bırakılmaz, varsayılana düşer;
        // reddetme ekranı listeden seçim zorunlu olduğu için boş liste reddi kilitler)
        $reasons = is_array($rules['defect_reject_reasons'] ?? null)
            ? array_values(array_filter(array_map(fn ($v) => trim((string) $v), $rules['defect_reject_reasons'])))
            : [];
        $rules['defect_reject_reasons'] = $reasons !== [] ? $reasons : ($defaults['defect_reject_reasons'] ?? []);

        // Durum kodu listeleri — int dizisi (fail-closed: boş bırakılmaz, varsayılana düşer)
        foreach (['cancellable_statuses', 'returnable_statuses'] as $k) {
            $src = is_array($rules[$k] ?? null) && $rules[$k] !== [] ? $rules[$k] : ($defaults[$k] ?? []);
            $rules[$k] = array_values(array_unique(array_map('intval', $src)));
        }

        // En az bir iade yöntemi açık olmalı
        if (! $rules['allow_store_credit'] && ! $rules['allow_original_refund']) {
            $rules['allow_original_refund'] = true;
        }

        return $rules;
    }
}
