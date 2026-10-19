import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, ShoppingCart, Package, TrendingDown, Disc3, Truck, UserPlus, Cake, CalendarHeart,
  ChevronRight, Hammer, CheckCircle2,
} from 'lucide-react'
import clsx from 'clsx'
import api from '@/lib/api'
import { cartRecoveryApi, wheelReminderApi, type CartRecoveryStats, type CartRecoverySettings, type WheelReminder } from '@/lib/cartRecoveryApi'

interface OrderNotifySummary {
  settings: { enabled: boolean }
  stats: { sent_total: number; failed: number; by_stage: { placed: number; shipped: number; delivered: number } }
}

const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)

type Reg = {
  key: string; name: string; desc: string; icon: typeof Zap
  channels: string[]; status: 'live' | 'soon'; group: string
}

const REGISTRY: Reg[] = [
  { key: 'cart_recovery', name: 'Sepet Kurtarma', desc: 'Terk edilen sepetleri e-posta → SMS+kupon → WhatsApp ile geri kazanır.', icon: ShoppingCart, channels: ['E-posta', 'SMS', 'WhatsApp'], status: 'live', group: 'Ciro' },
  { key: 'stock_reminder', name: 'Stok Hatırlatma', desc: 'Tükenen ürün geri gelince bekleyenlere haber verir.', icon: Package, channels: ['E-posta', 'Push'], status: 'soon', group: 'Ciro' },
  { key: 'price_alarm', name: 'Fiyat Alarmı', desc: 'Takip edilen ürün indirime girince bildirir.', icon: TrendingDown, channels: ['E-posta', 'Push'], status: 'soon', group: 'Ciro' },
  { key: 'wheel_coupon', name: 'Çark Entegrasyonu', desc: 'Çarkta kazanılıp kullanılmamış kuponları bitimine az kala SMS ile hatırlatır.', icon: Disc3, channels: ['SMS'], status: 'live', group: 'Ciro' },
  { key: 'order_status', name: 'Sipariş Bilgilendirme', desc: 'Sipariş alındı → kargoya verildi → teslim edildi bildirimlerini otomatik iletir.', icon: Truck, channels: ['WhatsApp', 'SMS', 'E-posta'], status: 'live', group: 'Yaşam döngüsü' },
  { key: 'welcome', name: 'Üye Karşılama', desc: 'Yeni üyelere hoş geldin + ilk alışveriş teşviki.', icon: UserPlus, channels: ['E-posta'], status: 'soon', group: 'Yaşam döngüsü' },
  { key: 'birthday', name: 'Doğum Günü', desc: 'Doğum gününde özel kupon gönderir.', icon: Cake, channels: ['SMS', 'E-posta'], status: 'soon', group: 'Yaşam döngüsü' },
  { key: 'win_back', name: 'Geri Kazanım', desc: 'Uzun süre uğramayan müşterileri geri çağırır.', icon: CalendarHeart, channels: ['E-posta', 'SMS'], status: 'soon', group: 'Yaşam döngüsü' },
]

const GROUPS = ['Ciro', 'Yaşam döngüsü']

export default function AutomationsPage() {
  const [cr, setCr] = useState<{ settings: CartRecoverySettings; stats: CartRecoveryStats } | null>(null)
  const [wheel, setWheel] = useState<WheelReminder | null>(null)
  const [orderNotify, setOrderNotify] = useState<OrderNotifySummary | null>(null)

  useEffect(() => {
    cartRecoveryApi.get().then(setCr).catch(() => {})
    wheelReminderApi.get().then(setWheel).catch(() => {})
    api.get('/marketing/order-notify').then((r) => setOrderNotify(r.data)).catch(() => {})
  }, [])

  // Canlı otomasyon için durum + istatistik kolonları (anahtar bazlı)
  function liveData(key: string): { enabled: boolean; cols: { label: string; value: string }[] } | null {
    if (key === 'cart_recovery' && cr) {
      const sent = cr.stats.channels.email.sent + cr.stats.channels.sms.sent + cr.stats.channels.whatsapp.sent
      return {
        enabled: cr.settings.enabled,
        cols: [
          { label: 'Gönderim', value: fmtNum(sent) },
          { label: 'Dönüşüm', value: fmtNum(cr.stats.journeys.converted) },
          { label: 'Kupon cirosu', value: fmtMoney(cr.stats.revenue_by_coupon) },
        ],
      }
    }
    if (key === 'wheel_coupon' && wheel) {
      return {
        enabled: wheel.settings.enabled,
        cols: [
          { label: 'SMS', value: fmtNum(wheel.stats.sms_sent) },
          { label: 'Hatırlatılan', value: fmtNum(wheel.stats.reminded) },
          { label: 'Kullanılan', value: fmtNum(wheel.stats.redeemed) },
        ],
      }
    }
    if (key === 'order_status' && orderNotify) {
      return {
        enabled: orderNotify.settings.enabled,
        cols: [
          { label: 'Bildirim', value: fmtNum(orderNotify.stats.sent_total) },
          { label: 'Kargoda', value: fmtNum(orderNotify.stats.by_stage.shipped) },
          { label: 'Teslim', value: fmtNum(orderNotify.stats.by_stage.delivered) },
        ],
      }
    }
    return null
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="text-indigo-600" size={26} />
        <h1 className="text-xl font-extrabold text-gray-900">Otomasyonlar</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Belirli olaylarda otomatik tetiklenen çok adımlı, çok kanallı akışlar. Aktif olanları düzenleyebilirsiniz; diğerleri sırayla devreye alınıyor.
      </p>

      {GROUPS.map((g) => {
        const group = REGISTRY.filter((r) => r.group === g)
        return (
          <div key={g} className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{g}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {group.map((r) => {
                const live = r.status === 'live'
                const ld = live ? liveData(r.key) : null
                const enabled = ld?.enabled ?? false

                const card = (
                  <div className={clsx(
                    'rounded-lg border p-4 flex flex-col h-full transition',
                    live ? 'bg-white border-gray-200 hover:border-indigo-300 hover:shadow-sm group' : 'bg-gray-50 border-dashed border-gray-300',
                  )}>
                    <div className="flex items-start gap-3">
                      <div className={clsx('w-11 h-11 rounded-2xl flex items-center justify-center shrink-0', live ? 'bg-indigo-50' : 'bg-gray-100')}>
                        <r.icon size={20} className={live ? 'text-indigo-600' : 'text-gray-400'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={clsx('font-medium', live ? 'text-gray-900' : 'text-gray-500')}>{r.name}</span>
                          {live ? (
                            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center gap-1',
                              enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                              <CheckCircle2 size={10} /> {enabled ? 'CANLI' : 'Hazır — kapalı'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                              <Hammer size={10} /> Yapım aşamasında
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.desc}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 mt-3">
                      {r.channels.map((c) => (
                        <span key={c} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">{c}</span>
                      ))}
                    </div>

                    {live && ld && (
                      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                        {ld.cols.map((c, i) => (
                          <div key={c.label}><div className="text-xs text-gray-400">{c.label}</div><div className={clsx('text-sm font-medium', i === 2 ? 'text-emerald-700' : 'text-gray-700')}>{c.value}</div></div>
                        ))}
                      </div>
                    )}

                    {live && (
                      <div className="mt-3 flex items-center justify-end text-xs text-indigo-600 opacity-0 group-hover:opacity-100 transition">
                        Akışı düzenle <ChevronRight size={14} />
                      </div>
                    )}
                  </div>
                )

                return live
                  ? <Link key={r.key} to={`/marketing/automations/${r.key}`}>{card}</Link>
                  : <div key={r.key}>{card}</div>
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
