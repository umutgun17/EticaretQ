<?php

namespace App\Enums;

enum ReturnType: string
{
    case Cancel = 'cancel';   // İptal — kargoya verilmeden / teslim öncesi
    case Return = 'return';   // İade — teslim sonrası
    case Defect = 'defect';   // Kusur bildirimi — iade penceresi DOLDUKTAN sonra, yönetici onaylı
    // Eksik / hatalı / stok hatası olan ürün — PERSONEL başlatır (müşteri değil): sipariş
    // gönderilemeyen kalem(ler) için para iadesi; kalan ürünler kargolanır. Kargo/depo adımı
    // YOKTUR, talep doğrudan yönetici PARA onayına düşer (ShortageService).
    case Shortage = 'shortage';

    public function label(): string
    {
        return match ($this) {
            self::Cancel => 'İptal',
            self::Return => 'İade',
            self::Defect => 'Kusur Bildirimi',
            self::Shortage => 'Eksik / Hatalı Ürün',
        };
    }
}
