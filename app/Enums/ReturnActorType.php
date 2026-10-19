<?php

namespace App\Enums;

enum ReturnActorType: string
{
    case Customer = 'customer';   // Tenant'ın müşterisi (public sayfa)
    case Staff = 'staff';         // İade personeli (1. onay)
    case Manager = 'manager';     // Yönetici (2. onay)
    case System = 'system';       // Otomatik (cron/job)
}
