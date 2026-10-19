<?php

namespace App\Enums;

enum RefundMethod: string
{
    case Original = 'original';          // Karta/bankaya iade (iyzico/PayTR) — "14 iş günü"
    case StoreCredit = 'store_credit';   // Anlık indirim kuponu (Ticimax) — promote edilen seçenek
    // KAPIDA ÖDEME İADESİ: para nakit/kapıda kartla tahsil edildiği için karta iade İMKÂNSIZ →
    // müşteriden banka + ad soyad + IBAN alınır, ödeme finans ekibince havaleyle yapılır ve
    // panelden "Havale yapıldı" ile kapatılır (kullanıcı kararı 2026-09-01).
    case BankTransfer = 'bank_transfer';
    // KAPIDA ÖDEME İPTALİ: müşteri hiç ödeme yapmamıştır → iade edilecek para YOK.
    // Bu yöntemdeki talepler para onayı kuyruğuna DÜŞMEZ, ERP iptali sonrası otomatik kapanır.
    case None = 'none';

    public function label(): string
    {
        return match ($this) {
            self::Original => 'Karta İade',
            self::StoreCredit => 'İndirim Kodu (Anında)',
            self::BankTransfer => 'Havale / EFT ile İade',
            self::None => 'İade Yok (Kapıda Ödeme)',
        };
    }

    /** Bu yöntem gerçek bir para hareketi gerektiriyor mu? (None = hayır) */
    public function needsPayout(): bool
    {
        return $this !== self::None;
    }
}
