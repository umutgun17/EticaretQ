<?php

namespace App\Jobs;

use App\Enums\WheelCouponStatus;
use App\Models\WheelSpin;
use App\Services\Wheel\WheelCouponIssuer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Çevirme anında Ticimax'a hediye çeki yazımı başarısız olduysa (SOAP/ağ hatası),
 * kuponu arka planda yeniden dener. Spin pending kaldığı sürece çalışır; başarıda
 * issuer spin'i issued'a çeker. Kod müşteriye zaten gösterildi → aynı kodu yazar.
 */
class IssueWheelCoupon implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries;

    /** Denemeler arası artan bekleme (saniye). */
    public array $backoff = [60, 300, 900, 3600];

    public function __construct(public int $spinId)
    {
        $this->tries = (int) config('wheel.coupon.ticimax.retry_attempts', 5);
    }

    public function handle(WheelCouponIssuer $issuer): void
    {
        $spin = WheelSpin::withoutGlobalScopes()->find($this->spinId);

        if (! $spin) {
            Log::warning('IssueWheelCoupon: spin bulunamadı', ['spin_id' => $this->spinId]);

            return;
        }

        // Zaten yazılmış (issued/redeemed) ya da iptal → tekrar deneme.
        if ($spin->coupon_status !== WheelCouponStatus::Pending) {
            return;
        }

        if (! $issuer->pushToTicimax($spin)) {
            // Tekrar denemek için exception fırlat (queue backoff devreye girer).
            // Son denemede de başarısızsa failed() coupon_status'u failed yapar.
            throw new \RuntimeException("Ticimax hediye çeki yazılamadı (spin {$spin->id})");
        }
    }

    /**
     * Tüm denemeler tükendiğinde: kuponu failed işaretle (rapor/manuel müdahale için).
     */
    public function failed(\Throwable $e): void
    {
        $spin = WheelSpin::withoutGlobalScopes()->find($this->spinId);

        if ($spin && $spin->coupon_status === WheelCouponStatus::Pending) {
            $spin->update(['coupon_status' => WheelCouponStatus::Failed]);
            Log::error('IssueWheelCoupon: tüm denemeler tükendi, failed işaretlendi', [
                'spin_id' => $this->spinId,
            ]);
        }
    }
}
