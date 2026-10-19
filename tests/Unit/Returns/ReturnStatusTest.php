<?php

namespace Tests\Unit\Returns;

use App\Enums\ReturnStatus;
use PHPUnit\Framework\TestCase;

/**
 * State machine — revize akış: ERP/statü otomatik; yönetici onayı = SADECE para gate'i.
 *   İPTAL: Pending → Processing → ManagerApproved → Refunding
 *   İADE:  ... Received → StaffApproved → ManagerApproved → Refunding
 */
class ReturnStatusTest extends TestCase
{
    public function test_pending_allows_processing_and_awaiting_but_not_direct_manager_approved(): void
    {
        $this->assertTrue(ReturnStatus::Pending->canTransitionTo(ReturnStatus::Processing));
        $this->assertTrue(ReturnStatus::Pending->canTransitionTo(ReturnStatus::AwaitingShipment));
        // Eski tek-onay iptal yolu KALDIRILDI: Pending'den doğrudan ManagerApproved'a geçilemez.
        $this->assertFalse(ReturnStatus::Pending->canTransitionTo(ReturnStatus::ManagerApproved));
    }

    public function test_cancel_processing_goes_to_manager_approved_not_directly_to_refunding(): void
    {
        // İptal ERP'si işlendi (Processing) → yalnızca PARA onayına (ManagerApproved) geçer.
        $this->assertTrue(ReturnStatus::Processing->canTransitionTo(ReturnStatus::ManagerApproved));
        // Para gate'i atlanamaz: Processing'den doğrudan Refunding'e geçilemez.
        $this->assertFalse(ReturnStatus::Processing->canTransitionTo(ReturnStatus::Refunding));
    }

    public function test_money_gate_is_manager_approved_to_refunding(): void
    {
        $this->assertTrue(ReturnStatus::StaffApproved->canTransitionTo(ReturnStatus::ManagerApproved));
        $this->assertTrue(ReturnStatus::ManagerApproved->canTransitionTo(ReturnStatus::Refunding));
    }

    public function test_auto_cargo_tracking_transitions(): void
    {
        // Kargo otomatik takibi: AwaitingShipment → InTransit → Received (ve şube teslimi için doğrudan Received).
        $this->assertTrue(ReturnStatus::AwaitingShipment->canTransitionTo(ReturnStatus::InTransit));
        $this->assertTrue(ReturnStatus::AwaitingShipment->canTransitionTo(ReturnStatus::Received));
        $this->assertTrue(ReturnStatus::InTransit->canTransitionTo(ReturnStatus::Received));
    }

    public function test_terminal_states_have_no_transitions(): void
    {
        foreach ([ReturnStatus::Completed, ReturnStatus::Rejected] as $s) {
            $this->assertTrue($s->isTerminal());
            $this->assertSame([], ReturnStatus::transitions()[$s->value]);
        }
    }

    public function test_cancelled_request_can_only_be_reopened_as_received(): void
    {
        // 2026-10-03: ürün iade kodu dışında (firmanın cari numarasıyla) depoya ulaşırsa elle yeniden açılır.
        $this->assertTrue(ReturnStatus::CancelledByCustomer->isTerminal());
        $this->assertSame([ReturnStatus::Received], ReturnStatus::transitions()[ReturnStatus::CancelledByCustomer->value]);
    }
}
