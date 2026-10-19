<?php

namespace App\Enums;

/**
 * İade/İptal durum makinesi.
 *
 * Onay modeli: ERP/statü işlemleri OTOMATİK yürür; YÖNETİCİ onayı yalnızca PARA iadesi gate'idir
 * (manager_approved → refunding). Refunding ve sonrası = Faz 4 (gerçek para hareketi).
 *
 * İADE akışı:
 *   pending → awaiting_shipment → in_transit → received   (kargo otomatik takip)
 *           → staff_approved (personel onayında Ticimax 'Iade' otomatik)
 *           → manager_approved (SADECE para) → refunding → refunded → completed
 *   (yan dal) → rejected / cancelled_by_customer
 *
 * İPTAL akışı:
 *   pending → processing (submit anında Nebim+Ticimax iptal OTOMATİK)
 *           → manager_approved (SADECE para) → refunding → refunded → completed
 *   (yan dal) → rejected
 *   KAPIDA ÖDEME iptali: pending → processing → completed (para onayı YOK — müşteri hiç ödeme
 *   yapmadığı için iade edilecek tutar yoktur; RefundService::closeWithoutRefund)
 */
enum ReturnStatus: string
{
    case Pending = 'pending';                       // Talep oluşturuldu
    case AwaitingShipment = 'awaiting_shipment';    // Kargo kodu verildi, müşteri gönderecek (iade)
    case InTransit = 'in_transit';                  // Kargoya verildi / yolda
    case Received = 'received';                     // Bize ulaştı (48s timer başlar)
    case StaffApproved = 'staff_approved';          // İade personeli onayladı (1. onay)
    case ManagerApproved = 'manager_approved';      // Yönetici onayladı (2. onay)
    case Processing = 'processing';                 // İptal: Ticimax/Nebim işleniyor
    case Refunding = 'refunding';                   // Para iadesi / kupon işleniyor
    case Refunded = 'refunded';                     // İade gerçekleşti
    case Completed = 'completed';                   // Süreç tamam
    case Rejected = 'rejected';                     // Reddedildi (görsel + gerekçe)
    case CancelledByCustomer = 'cancelled_by_customer';
    case DefectReview = 'defect_review';            // Kusur bildirimi: YÖNETİCİ onay/red kararı bekliyor

    /**
     * İzin verilen durum geçişleri. Para-kritik: her geçiş burada açıkça tanımlı.
     *
     * @return array<string, list<self>>
     */
    public static function transitions(): array
    {
        return [
            // İADE: Pending → AwaitingShipment (kargo). İPTAL: Pending → Processing (submit anında ERP
            // otomatik çalışır). Her iki akışta ManagerApproved = SADECE para gate'i (ERP'siz).
            self::Pending->value => [self::AwaitingShipment, self::Processing, self::Rejected, self::CancelledByCustomer],
            // Kargo otomatik takipte AwaitingShipment'tan doğrudan Received'a düşebilir (şube teslimi gibi).
            self::AwaitingShipment->value => [self::InTransit, self::Received, self::Rejected, self::CancelledByCustomer],
            self::InTransit->value => [self::Received, self::Rejected],
            self::Received->value => [self::StaffApproved, self::Rejected],
            self::StaffApproved->value => [self::ManagerApproved, self::Rejected],
            // İPTAL: ERP işlendi, yönetici PARA onayı bekliyor.
            // Completed: KAPIDA ÖDEME iptali — tahsilat yapılmadığı için iade edilecek para yoktur,
            // talep para onayına düşmeden otomatik kapanır (kullanıcı kararı 2026-09-01). Bu geçiş
            // yalnızca RefundService::closeWithoutRefund() üzerinden yapılır (transition ucu bloklu:
            // TRANSITION_TARGETS'ta Completed yok).
            self::Processing->value => [self::ManagerApproved, self::Completed, self::Rejected],
            self::ManagerApproved->value => [self::Refunding],
            self::Refunding->value => [self::Refunded, self::Rejected],
            self::Refunded->value => [self::Completed],
            self::Completed->value => [],
            self::Rejected->value => [],
            // YENİDEN AÇMA (kullanıcı isteği 2026-10-03): müşteri paketi iade koduyla değil firmanın
            // cari numarasıyla gönderirse kod süresi dolup talep kapanır ama ürün depoya ulaşır →
            // personel/yönetici talebi elle "Depoya ulaştı"ya çekebilir (yalnız transition ucu, guard'lı).
            self::CancelledByCustomer->value => [self::Received],
            // KUSUR: yönetici onayı → kargo koduyla normal iade akışına bağlanır; red → SMS'li Rejected.
            // Bu karar YALNIZCA defect-approve/defect-reject uçlarından verilir (transition ucu bloklu).
            self::DefectReview->value => [self::AwaitingShipment, self::Rejected, self::CancelledByCustomer],
        ];
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, self::transitions()[$this->value] ?? [], true);
    }

    public function isTerminal(): bool
    {
        return in_array($this, [self::Refunded, self::Completed, self::Rejected, self::CancelledByCustomer], true);
    }

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Talep alındı',
            self::AwaitingShipment => 'Kargo bekleniyor',
            self::InTransit => 'Yolda',
            self::Received => 'Depoya ulaştı',
            self::StaffApproved => 'Personel onayladı',
            self::ManagerApproved => 'Yönetici onayladı',
            self::Processing => 'İptal işlendi, ödeme onayı bekliyor',
            self::Refunding => 'İade işleniyor',
            self::Refunded => 'İade edildi',
            self::Completed => 'Tamamlandı',
            self::Rejected => 'Reddedildi',
            self::CancelledByCustomer => 'Müşteri vazgeçti',
            self::DefectReview => 'Yönetici onayı bekliyor',
        };
    }
}
