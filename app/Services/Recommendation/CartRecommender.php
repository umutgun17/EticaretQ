<?php

namespace App\Services\Recommendation;

/**
 * GERİYE-UYUM CEPHESİ — asıl mantık RecommendationEngine'dedir.
 *
 * İlk sürümde tüm öneri mantığı bu sınıftaydı; motorlaşma refactor'ünde
 * (2026-08-03) çekirdek RecommendationEngine + Sources/* altına taşındı.
 * Mevcut controller'lar bu imzaları kullandığından cephe korunuyor.
 * Yeni kod DOĞRUDAN RecommendationEngine kullanmalı:
 *   forAnchor()   — tek tetikleyici ürün
 *   forCart()     — sepet satırları
 *   forCustomer() — kişi-bazlı (e-posta / WhatsApp / ana sayfa)
 */
class CartRecommender
{
    public function __construct(protected RecommendationEngine $engine)
    {
    }

    /** @see RecommendationEngine::forAnchor() */
    public function recommend(
        int $tenantId,
        ?string $platformProductId,
        ?string $platformVariantId = null,
        ?string $platformMemberId = null,
        int $limit = 4
    ): array {
        return $this->engine->forAnchor(
            $tenantId,
            $platformProductId,
            $platformVariantId,
            $platformMemberId,
            max(1, min(8, $limit)),
            'atc'
        );
    }

    /** @see RecommendationEngine::forCart() */
    public function recommendForCart(
        int $tenantId,
        array $lines,
        ?string $platformMemberId = null,
        int $limit = 6
    ): array {
        return $this->engine->forCart(
            $tenantId,
            $lines,
            $platformMemberId,
            max(1, min(10, $limit)),
            'checkout'
        );
    }

    /** @see RecommendationEngine::forCustomer() */
    public function recommendForCustomer(
        int $tenantId,
        int|string $customer,
        int $limit = 8
    ): array {
        return $this->engine->forCustomer($tenantId, $customer, max(1, min(24, $limit)), 'customer');
    }
}
