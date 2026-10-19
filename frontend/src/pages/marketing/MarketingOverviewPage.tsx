import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Megaphone, Zap, Users2, Send, BarChart3, Settings2,
  TrendingUp, ShoppingCart, ArrowRight, CheckCircle2, Hammer, Disc3,
} from 'lucide-react'
import { marketingOverviewApi, type MarketingOverview } from '@/lib/cartRecoveryApi'

const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)

function Kpi({ icon: Icon, label, value, accent }: { icon: typeof Zap; label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-500 text-xs mb-2"><Icon size={15} className={accent} /> {label}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  )
}

const MODULES = [
  { to: '/marketing/automations', icon: Zap, title: 'Otomasyonlar', desc: 'Sepet kurtarma, çark, stok, fiyat, karşılama akışları', color: 'text-indigo-600' },
  { to: '/marketing/analytics', icon: BarChart3, title: 'Gönderim & Analitik', desc: 'Gönderim logu, açılma, tıklama, ciro', color: 'text-amber-600' },
  { to: '/marketing/settings', icon: Settings2, title: 'Ayarlar', desc: 'Gönderici, e-posta domaini (DKIM), kanallar', color: 'text-gray-600' },
  { to: '/marketing/segments', icon: Users2, title: 'Segmentler', desc: 'Dinamik müşteri segmentleri', color: 'text-violet-600', soon: true },
  { to: '/marketing/campaigns', icon: Send, title: 'Toplu Kampanyalar', desc: 'Segment hedefli tek seferlik gönderimler', color: 'text-blue-600', soon: true },
]

// Otomasyon anahtarı → görsel (ikon, renk, link, ikon)
const AUTO_META: Record<string, { icon: typeof ShoppingCart; color: string; to: string }> = {
  cart_recovery: { icon: ShoppingCart, color: 'text-indigo-600', to: '/marketing/automations/cart_recovery' },
  wheel_coupon: { icon: Disc3, color: 'text-rose-600', to: '/marketing/automations/wheel_coupon' },
}

export default function MarketingOverviewPage() {
  const [ov, setOv] = useState<MarketingOverview | null>(null)

  useEffect(() => {
    marketingOverviewApi.get().then(setOv).catch(() => {})
  }, [])

  const totals = ov?.totals ?? { sent: 0, conversions: 0, revenue: 0 }
  const liveCount = ov?.modules.filter((m) => m.enabled).length ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="text-indigo-600" size={26} />
        <h1 className="text-xl font-extrabold text-gray-900">Full Otomasyon</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        E-posta, SMS, WhatsApp ve web push kanallarını tek yerden yönetin. Her otomasyonun gönderimi ve sağladığı satış aşağıda modül modül.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Kpi icon={TrendingUp} label="Toplam ciro (otomasyon)" value={fmtMoney(totals.revenue)} accent="text-emerald-600" />
        <Kpi icon={Send} label="Toplam gönderim" value={fmtNum(totals.sent)} accent="text-blue-600" />
        <Kpi icon={ShoppingCart} label="Satışa dönüşüm" value={fmtNum(totals.conversions)} accent="text-indigo-600" />
        <Kpi icon={Zap} label="Aktif otomasyon" value={fmtNum(liveCount)} accent="text-amber-600" />
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mb-3">Modüller</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} className="group bg-white rounded-lg border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition">
            <div className="flex items-start justify-between">
              <m.icon size={22} className={m.color} />
              {m.soon
                ? <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 inline-flex items-center gap-1"><Hammer size={10} /> Yakında</span>
                : <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-500 transition" />}
            </div>
            <div className="mt-3 font-medium text-gray-900">{m.title}</div>
            <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
          </Link>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mb-3">Otomasyonlar — gönderim & satış</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Otomasyon</th>
              <th className="text-left px-4 py-3 font-medium">Durum</th>
              <th className="text-center px-4 py-3 font-medium">Gönderim</th>
              <th className="text-center px-4 py-3 font-medium">Satışa dönüşüm</th>
              <th className="text-right px-4 py-3 font-medium">Sağladığı ciro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(ov?.modules ?? []).map((m) => {
              const meta = AUTO_META[m.key] ?? { icon: Zap, color: 'text-gray-500', to: '/marketing/automations' }
              const Icon = meta.icon
              return (
                <tr key={m.key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={meta.to} className="font-medium text-gray-900 hover:text-indigo-600 inline-flex items-center gap-1.5">
                      <Icon size={14} className={meta.color} /> {m.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${m.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      <CheckCircle2 size={11} /> {m.enabled ? 'Canlı' : 'Hazır — kapalı'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{fmtNum(m.sent)}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{fmtNum(m.conversions)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700">{fmtMoney(m.revenue)}</td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={5} className="px-4 py-3 text-center text-xs text-gray-400">
                <Hammer size={12} className="inline mr-1" /> Diğer otomasyonlar (stok, fiyat, karşılama, doğum günü…) yapım aşamasında.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
