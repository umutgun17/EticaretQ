<?php

namespace App\Console\Commands;

use App\Enums\ReturnActorType;
use App\Enums\ReturnStatus;
use App\Models\Channel;
use App\Models\ReturnRequest;
use App\Services\Returns\ReturnAuditLogger;
use App\Services\Returns\ReturnErpProcessor;
use App\Services\TicimaxService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Hatalı PERSONEL ONAYINI geri alır (2026-09-18).
 *
 * OLAY: 17 Eyl'de 120 talep (5 toplu parti + 6 tekil) depoda kontrol edilmeden personel onayından
 * geçirildi. Panelde geri alma yolu yok → bu komut talebi onay öncesine döndürür:
 *   - status staff_approved → received; staff_approved_by/at, approved_amount, kalem qty_approved NULL
 *     (personel onayı öncesi değerler — bekleyen 'received' taleplerle aynı durum)
 *   - Ticimax sipariş statüsü 'IadeUlastiOdemeYapilacak' ise 'IadeTalepAlindi'ya geri yazılır
 *     (MailBilgilendir=false). Başka statüdeyse DOKUNULMAZ, raporlanır.
 *   - audit: 'staff_approve_reverted'. Müşteriye SMS/mail GÖNDERİLMEZ.
 *
 * Guard: yalnız status=staff_approved, yönetici onayı yok, hiç iade (return_refunds) kaydı yok.
 */
class RevertReturnStaffApproval extends Command
{
    protected $signature = 'returns:revert-staff-approval
        {--ids= : Virgülle ayrılmış talep ID listesi (zorunlu)}
        {--by= : Geri alan kullanıcı ID (audit için)}
        {--reason= : Geri alma sebebi (audit payload)}
        {--no-ticimax : Ticimax statüsüne dokunma}
        {--dry-run : Hiçbir şey yazma, yalnız ne yapılacağını göster}';

    protected $description = 'Hatalı personel onayını geri alır (staff_approved → received) + Ticimax statüsünü geri çeker, SMS göndermez';

    public function handle(ReturnAuditLogger $audit): int
    {
        $ids = array_values(array_filter(array_map('intval', explode(',', (string) $this->option('ids')))));
        if (! $ids) {
            $this->error('--ids zorunlu.');

            return self::FAILURE;
        }
        $dry = (bool) $this->option('dry-run');
        $byId = $this->option('by') ? (int) $this->option('by') : null;
        $reason = (string) ($this->option('reason') ?? '');
        $doTicimax = ! $this->option('no-ticimax');

        $this->info(($dry ? '[DRY-RUN] ' : '').count($ids).' talep işlenecek.');
        $stats = ['reverted' => 0, 'skipped' => 0, 'ticimax_ok' => 0, 'ticimax_skip' => 0, 'ticimax_err' => 0];
        $clients = [];

        foreach ($ids as $id) {
            $r = ReturnRequest::withoutGlobalScopes()->with('items')->find($id);
            if (! $r) {
                $this->warn("#{$id} bulunamadı — atlandı");
                $stats['skipped']++;

                continue;
            }
            $why = null;
            if ($r->status !== ReturnStatus::StaffApproved) {
                $why = 'durum '.$r->status->value;
            } elseif ($r->manager_approved_at !== null) {
                $why = 'yönetici onayı var';
            } elseif (DB::table('return_refunds')->where('return_request_id', $r->id)->exists()) {
                $why = 'iade kaydı var';
            }
            if ($why) {
                $this->warn("#{$r->id} {$r->public_code} ATLANDI: {$why}");
                $stats['skipped']++;

                continue;
            }

            $prev = [
                'staff_approved_by' => $r->staff_approved_by,
                'staff_approved_at' => $r->staff_approved_at?->toDateTimeString(),
                'approved_amount' => $r->approved_amount !== null ? (float) $r->approved_amount : null,
                'items_qty_approved' => $r->items->mapWithKeys(fn ($i) => [$i->id => $i->qty_approved])->all(),
            ];

            // ── Ticimax: mevcut statüyü oku, yalnız 'IadeUlastiOdemeYapilacak' ise geri çek ──
            $tx = ['done' => false, 'note' => 'atlandı (--no-ticimax)'];
            if ($doTicimax) {
                $channel = $clients[$r->channel_id] ??= Channel::withoutGlobalScopes()->find($r->channel_id);
                if (! $channel || $channel->type !== 'ticimax-ecommerce') {
                    $tx['note'] = 'Ticimax kanalı yok';
                    $stats['ticimax_skip']++;
                } else {
                    $svc = TicimaxService::fromChannel($channel);
                    $cur = $svc->getOrderByNo((string) $r->order_no);
                    $label = $cur['success'] ?? false ? (json_decode(json_encode($cur['order']), true)['SiparisDurumu'] ?? null) : null;
                    $enum = ReturnErpProcessor::ticimaxStatusLabelToEnum($label);
                    if ($enum !== 'IadeUlastiOdemeYapilacak') {
                        $tx['note'] = 'Ticimax statüsü "'.($label ?? 'okunamadı').'" — dokunulmadı';
                        $stats['ticimax_skip']++;
                    } elseif ($dry) {
                        $tx = ['done' => false, 'note' => "{$label} → IadeTalepAlindi (yazılacak)"];
                        $stats['ticimax_ok']++;
                    } else {
                        $res = $svc->setOrderStatus((int) $r->platform_order_id, 'IadeTalepAlindi', false, (string) $r->order_no);
                        if ($res['success'] ?? false) {
                            $tx = ['done' => true, 'note' => "{$label} → IadeTalepAlindi"];
                            $stats['ticimax_ok']++;
                        } else {
                            $tx = ['done' => false, 'note' => 'HATA: '.($res['error'] ?? 'bilinmiyor')];
                            $stats['ticimax_err']++;
                        }
                    }
                }
            }

            $this->line(sprintf('#%-5d %s %s %10s → received | Ticimax: %s',
                $r->id, $r->public_code, $r->order_no, $r->approved_amount, $tx['note']));

            if ($dry) {
                $stats['reverted']++;

                continue;
            }

            DB::transaction(function () use ($r, $audit, $prev, $byId, $reason, $tx) {
                foreach ($r->items as $it) {
                    $it->qty_approved = null;
                    $it->save();
                }
                $r->status = ReturnStatus::Received;
                $r->staff_approved_by = null;
                $r->staff_approved_at = null;
                $r->approved_amount = null;
                $meta = $r->metadata ?? [];
                $meta['staff_approve_reverted'] = [
                    'at' => now()->toDateTimeString(),
                    'by' => $byId,
                    'reason' => $reason,
                    'previous' => $prev,
                    'ticimax' => $tx,
                ];
                $r->metadata = $meta;
                $r->save();

                $audit->log($r, 'staff_approve_reverted', [
                    'actor_type' => ReturnActorType::Manager,
                    'actor_id' => $byId,
                    'from_status' => ReturnStatus::StaffApproved->value,
                    'to_status' => ReturnStatus::Received->value,
                    'amount' => $prev['approved_amount'],
                    'payload' => array_filter([
                        'reason' => $reason ?: null,
                        'previous_staff_approved_by' => $prev['staff_approved_by'],
                        'previous_staff_approved_at' => $prev['staff_approved_at'],
                        'ticimax' => $tx['note'],
                        'sms' => 'gönderilmedi',
                    ]),
                    'ip_address' => null,
                    'user_agent' => 'artisan returns:revert-staff-approval',
                ]);
            });
            $stats['reverted']++;
            usleep(150000);
        }

        $this->newLine();
        $this->info(($dry ? '[DRY-RUN] ' : '').json_encode($stats));

        return self::SUCCESS;
    }
}
