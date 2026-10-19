import { Outlet } from 'react-router-dom'
import { Building2, ArrowUp } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Marketing sayfaları tenant (mağaza) bazlıdır. Süper-admin "Tüm Şirketler" seçiliyken
 * hiçbir mağaza seçili olmaz → API'ler X-Tenant-Id alamaz → 404. Bu durumda sayfalar
 * sonsuz "Yükleniyor"da kalmasın diye, net bir "mağaza seç" uyarısı gösterilir.
 */
export default function MarketingTenantGuard() {
  const { user } = useAuth()
  const tenantMissing = !!user?.is_super_admin && !localStorage.getItem('selected_tenant_id')

  if (!tenantMissing) {
    return <Outlet />
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mt-10 bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-600 mb-4">
          <Building2 size={24} />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Önce bir mağaza seçin</h2>
        <p className="text-sm text-gray-600 mb-1">
          Pazarlama otomasyonları mağaza bazlıdır. Şu an <b>"Tüm Şirketler"</b> seçili olduğu için
          veriler yüklenemiyor.
        </p>
        <p className="text-sm text-gray-600 inline-flex items-center gap-1.5 justify-center">
          <ArrowUp size={14} className="text-amber-600" />
          Sol menüdeki <b>Şirket</b> listesinden bir mağaza seçin.
        </p>
      </div>
    </div>
  )
}
