<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Models\ReturnRefund;
use App\Models\ReturnRequest;
use App\Services\Returns\Payment\IyzicoRefundService;
use App\Services\Returns\Payment\PaymentRefundManager;
use App\Services\Returns\ReturnAuditLogger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * GEÇMİŞ tam iade/iptallerde iyzico'da kalmış VADE FARKINI müşteriye iade eder (backfill).
 *
 * Doğuş sebebi (2026-08-11 tespiti): kod "vade farkını ödeme kuruluşu otomatik düşer" varsayıyordu —
 * iyzico için YANLIŞ. Taksitli ödemede iyzico vade farkını kalem tutarlarının üstüne ekler
 * (paidPrice > price); tam iadede onaylanan tutar kalem fiyatlarından hesaplandığı için vade farkı
 * iyzico'da "iade edilebilir kalan bakiye" olarak kaldı, müşteri eksik aldı (#118/#92/#201, toplam
 * 231,13 TL). Yeni taleplerde kalıcı fix RefundService akışında (refund_installment_fee kuralı);
 * bu komut eski talepleri kapatır.
 *
 * Yöntem: ödeme detayından vade = paidPrice − price − kargo; geçmiş iadenin kalem dağılımı
 * deterministik greedy planla yeniden kurulur → kalem başına kalan tavan → vade bu tavanlara
 * planlanıp kalem kalem iade edilir (iyzico kalem tavanını kendisi de doğrular — fazla iade imkânsız).
 * SMS GÖNDERİLMEZ, Ticimax'a YAZILMAZ (statü zaten İadeOdemeYapildi).
 *
 * Kullanım:  php artisan returns:refund-installment-fee tbp70841298 [--dry-run]
 */
class RefundReturnInstallmentFee extends Command
{
    protected $signature = 'returns:refund-installment-fee
        {id : İade talebi ID veya public_code}
        {--dry-run : Yalnızca hesaplanan planı göster, iade yapma}';

    protected $description = 'Tam iadesi bitmiş taleplerde iyzico\'da kalan taksit vade farkını müşteriye iade eder (backfill)';

    public function handle(ReturnAuditLogger $audit, IyzicoRefundService $iyzico, PaymentRefundManager $manager): int
    {
        $key = (string) $this->argument('id');
        $r = ReturnRequest::withoutGlobalScopes()
            ->when(ctype_digit($key), fn ($q) => $q->where('id', (int) $key))
            ->when(! ctype_digit($key), fn ($q) => $q->whereRaw('UPPER(public_code) = UPPER(?)', [$key]))
            ->first();

        if (! $r) {
            $this->error("Talep bulunamadı: {$key}");

            return self::FAILURE;
        }
        if (! in_array($r->status->value, ['refunded', 'completed'], true)) {
            $this->error("Talep {$r->public_code} refunded/completed değil ({$r->status->value}) — bu komut yalnız tamamlanmış iadeler içindir; açık talepler normal akışta (kural açıkken) vade farkını zaten alır.");

            return self::FAILURE;
        }

        $breakdown = (array) data_get($r->metadata, 'calculation.breakdown', []);
        if (! ($breakdown['full_return'] ?? false)) {
            $this->error("Talep {$r->public_code} TAM iade değil — vade telafisi yalnız tam iade/iptalde uygulanır.");

            return self::FAILURE;
        }
        if (data_get($r->metadata, 'installment_fee_topup')) {
            $this->error("Talep {$r->public_code} için vade farkı DAHA ÖNCE iade edilmiş (metadata.installment_fee_topup) — çift iade engellendi.");

            return self::FAILURE;
        }

        /** @var ReturnRefund|null $prev */
        $prev = ReturnRefund::where('idempotency_key', 'refund:original:' . $r->id)
            ->where('provider', 'iyzico')->where('status', 'succeeded')->first();
        if (! $prev) {
            $this->error("Talep {$r->public_code} için başarılı iyzico iade kaydı yok — vade telafisi yalnız iyzico iadelerinde gerekir (PayTR'de vade satır fiyatlarına gömülüdür).");

            return self::FAILURE;
        }

        $paymentId = $this->extractPaymentId((array) $prev->response_payload);
        if ($paymentId === '') {
            $this->error('iyzico paymentId iade kaydından çıkarılamadı — manuel inceleme gerekli.');

            return self::FAILURE;
        }

        $cfg = $manager->config($r);
        $iyzCfg = (array) ($cfg['iyzico'] ?? []);
        $det = $iyzico->retrievePayment($iyzCfg, 'vade-topup-' . $r->id, $paymentId);
        if (! ($det['success'] ?? false)) {
            $this->error('iyzico ödeme detayı alınamadı: ' . ($det['error'] ?? 'bilinmeyen'));

            return self::FAILURE;
        }

        $raw = (array) $det['response'];
        $shipping = max(0.0, (float) ($breakdown['shipping_cost'] ?? 0));
        $topup = $iyzico->installmentFeeTopup($raw, $shipping);
        if ($topup <= 0) {
            $this->info("Talep {$r->public_code}: vade farkı yok (taksit=" . ($raw['installment'] ?? '?') . ', paidPrice−price−kargo ≤ 0) — yapılacak iş yok.');

            return self::SUCCESS;
        }

        // Geçmiş iadenin kalem dağılımını deterministik greedy ile yeniden kur → kalem başına kalan tavan.
        $txns = (array) ($det['transactions'] ?? []);
        $prevTotal = round((float) data_get($prev->response_payload, 'progress.refunded_total', (float) $prev->amount), 2);
        $replay = $iyzico->planRefund($prevTotal, $txns);
        if (! $replay['ok']) {
            $this->error('Geçmiş iade dağılımı yeniden kurulamadı: ' . $replay['error']);

            return self::FAILURE;
        }
        $consumed = [];
        foreach ($replay['plan'] as $step) {
            $consumed[$step['id']] = ($consumed[$step['id']] ?? 0) + $step['price'];
        }
        $remainingTxns = [];
        foreach ($txns as $t) {
            $rem = round((float) $t['paid_price'] - ($consumed[$t['id']] ?? 0), 2);
            if ($rem > 0.01) {
                $remainingTxns[] = ['id' => $t['id'], 'paid_price' => $rem];
            }
        }

        $plan = $iyzico->planRefund($topup, $remainingTxns);
        if (! $plan['ok']) {
            $this->error('Vade farkı kalan kalem tavanlarına sığmadı: ' . $plan['error']);

            return self::FAILURE;
        }

        $this->table(['Alan', 'Değer'], array_merge([
            ['Talep', "#{$r->id} {$r->public_code} (tenant {$r->tenant_id}, {$r->type->value})"],
            ['Ödenen (iyzico)', number_format((float) $raw['paidPrice'], 2, ',', '.') . ' / taksit ' . ($raw['installment'] ?? '?')],
            ['Şu ana kadar iade', number_format($prevTotal, 2, ',', '.')],
            ['İade edilecek vade farkı', number_format($topup, 2, ',', '.')],
        ], array_map(fn ($s) => ['  → kalem ' . $s['id'], number_format($s['price'], 2, ',', '.')], $plan['plan'])));

        if ($this->option('dry-run')) {
            $this->info('DRY-RUN: iade yapılmadı.');

            return self::SUCCESS;
        }

        // Kalem kalem canlı iade (tek-kalem modu; iyzico kalem tavanını kendi tarafında da doğrular).
        $succeeded = [];
        $refundedTotal = 0.0;
        $responses = [];
        foreach ($plan['plan'] as $step) {
            $res = $iyzico->refund($iyzCfg, [
                'payment' => [],
                'payment_transaction_id' => $step['id'],
                'amount' => $step['price'],
                'currency' => $r->currency ?? 'TRY',
                'public_code' => (string) $r->public_code,
                'ip' => '127.0.0.1',
            ], false);
            $responses[] = ['txn' => $step['id'], 'price' => $step['price'], 'response' => $res['response'] ?? null];
            if (! ($res['success'] ?? false)) {
                $this->error('iyzico kalem ' . $step['id'] . ' iadesi başarısız: ' . ($res['error'] ?? 'bilinmeyen')
                    . ($succeeded ? sprintf(' — %.2f iade edildi, kalan manuel incelenmeli.', $refundedTotal) : ''));
                if ($succeeded) {
                    $this->persist($r, $audit, round($refundedTotal, 2), $succeeded, $responses, partial: true);
                }

                return self::FAILURE;
            }
            $succeeded[] = $step['id'];
            $refundedTotal = round($refundedTotal + $step['price'], 2);
        }

        $this->persist($r, $audit, $refundedTotal, $succeeded, $responses, partial: false);
        $this->info(sprintf('Talep %s: vade farkı %.2f TL iyzico üzerinden iade edildi (kalemler: %s). SMS/Ticimax yazması yapılmadı.',
            $r->public_code, $refundedTotal, implode(',', $succeeded)));

        return self::SUCCESS;
    }

    private function persist(ReturnRequest $r, ReturnAuditLogger $audit, float $amount, array $txns, array $responses, bool $partial): void
    {
        DB::transaction(function () use ($r, $amount, $txns, $responses, $partial) {
            $refund = ReturnRefund::firstOrNew(['idempotency_key' => 'refund:vade-topup:' . $r->id]);
            $refund->fill([
                'tenant_id' => $r->tenant_id,
                'return_request_id' => $r->id,
                'provider' => 'iyzico',
                'currency' => $r->currency ?? 'TRY',
                'amount' => $amount,
                'status' => $partial ? 'failed' : 'succeeded',
                'error_message' => $partial ? 'Vade farkı iadesi yarım kaldı — kalan manuel incelenmeli.' : null,
            ]);
            $refund->provider_txn_id = implode(',', $txns);
            $refund->response_payload = [
                'last' => $responses,
                'progress' => ['succeeded_txns' => $txns, 'refunded_total' => $amount],
            ];
            $refund->processed_at = now();
            $refund->save();

            $r->refunded_amount = round((float) $r->refunded_amount + $amount, 2);
            $meta = $r->metadata ?? [];
            $meta['installment_fee_topup'] = ['amount' => $amount, 'txns' => $txns, 'partial' => $partial, 'at' => now()->toIso8601String(), 'source' => 'returns:refund-installment-fee'];
            $r->metadata = $meta;
            $r->save();
        });

        $audit->log($r, 'refund', [
            'actor_type' => ReturnActorType::System,
            'amount' => $amount,
            'payload' => ['method' => 'iyzico', 'provider_txn_id' => implode(',', $txns), 'dry_run' => false, 'installment_fee_topup' => true, 'partial' => $partial, 'source' => 'returns:refund-installment-fee'],
        ]);
        $audit->log($r, 'staff_note', [
            'actor_type' => ReturnActorType::System,
            'payload' => ['note' => sprintf('[Vade farkı telafisi] Taksitli ödemenin iyzico\'da kalan vade farkı (%.2f TL) müşteriye iade edildi%s. Kaynak: returns:refund-installment-fee (2026-08-11 sistemik tespit backfill\'i).', $amount, $partial ? ' (KISMİ — kalan manuel incelenmeli)' : '')],
        ]);
    }

    /** İade kaydının response_payload'ından iyzico paymentId'yi çıkarır (tek/çok kalemli her iki biçim). */
    private function extractPaymentId(array $payload): string
    {
        $last = $payload['last'] ?? [];
        if (isset($last['paymentId'])) {
            return (string) $last['paymentId'];
        }
        foreach ((array) $last as $item) {
            $pid = is_array($item) ? ($item['response']['paymentId'] ?? null) : null;
            if ($pid) {
                return (string) $pid;
            }
        }

        return '';
    }
}
