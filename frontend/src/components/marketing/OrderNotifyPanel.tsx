import { useEffect, useState } from 'react'
import { Truck, PackageCheck, PackageOpen, MessageSquare, Save, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import api from '@/lib/api'

// Sipariş Bilgilendirme — alındı / kargoya verildi / teslim edildi bildirimleri.
// İşlemsel (utility) mesajlar: müşterinin beklediği bildirimlerdir; saat penceresi uygulanmaz.

interface OrderNotifyData {
  settings: {
    enabled: boolean
    channels: { email: boolean; sms: boolean; whatsapp: boolean }
    stages: { placed: boolean; shipped: boolean; delivered: boolean }
  }
  stats: {
    sent_total: number
    failed: number
    by_stage: { placed: number; shipped: number; delivered: number }
  }
  deliveries: {
    id: number; at: string | null; channel: string; recipient: string
    customer_name: string | null; order_no: string | null; stage: string | null
    cargo: string | null; tracking_no: string | null
    status: string; error: string | null; is_test: boolean
  }[]
}

const STAGE_LABELS: Record<string, string> = {
  placed: 'Sipariş alındı',
  shipped: 'Kargoya verildi',
  delivered: 'Teslim edildi',
}
const STAGE_ICONS = { placed: PackageOpen, shipped: Truck, delivered: PackageCheck } as const
const WA_TEMPLATES: Record<string, string> = {
  placed: 'siparis_alindi',
  shipped: 'siparis_kargoda',
  delivered: 'siparis_teslim_edildi',
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className={clsx('relative w-10 h-[22px] rounded-full transition-colors shrink-0', on ? 'bg-emerald-500' : 'bg-gray-300', disabled && 'opacity-60')}>
      <span className={clsx('absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow transition-transform', on ? 'translate-x-[20px]' : 'translate-x-[2px]')} />
    </button>
  )
}

export default function OrderNotifyPanel() {
  const [d, setD] = useState<OrderNotifyData | null>(null)
  const [tab, setTab] = useState<'analytics' | 'flow'>('analytics')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function load() {
    const { data } = await api.get('/marketing/order-notify')
    setD(data)
  }
  useEffect(() => { load() }, [])
  if (!d) return <div className="p-6 text-center text-gray-400">Yükleniyor…</div>
  const s = d.settings

  async function save(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      const { data } = await api.put('/marketing/order-notify', patch)
      setD(data); setSaved(true); setTimeout(() => setSaved(false), 2500)
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Başlık + ana switch */}
      <div className="flex items-center gap-3 mb-1">
        <Truck className="text-sky-600" size={26} />
        <h1 className="text-xl font-semibold text-gray-900">Sipariş Bilgilendirme</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={clsx('text-sm font-medium', s.enabled ? 'text-emerald-600' : 'text-gray-400')}>{s.enabled ? 'CANLI' : 'Kapalı'}</span>
          <Toggle on={s.enabled} onToggle={() => save({ enabled: !s.enabled })} disabled={saving} />
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Sipariş alındı → kargoya verildi → teslim edildi aşamalarında müşteriye otomatik bildirim gönderir.
        Her aşama <b>yalnızca bir kez</b> bildirilir; statü atlanmaz, iptal/iade durumunda gönderim durur.
      </p>

      {!s.enabled && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Kapalı — sistem sipariş geçişlerini izliyor ama bildirim göndermiyor (simülasyon). WhatsApp şablonları Meta onayından geçtikten sonra açın.
        </div>
      )}

      {/* Sekmeler */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {([['analytics', 'Analitik'], ['flow', 'Akışı Düzenle']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
              tab === key ? 'border-sky-600 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && (<>
      {/* İstatistik */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><MessageSquare size={13} /> Toplam bildirim</div>
          <div className="text-lg font-semibold text-gray-800">{d.stats.sent_total}</div>
          {d.stats.failed > 0 && <div className="text-[11px] text-rose-500">{d.stats.failed} hata</div>}
        </div>
        {(['placed', 'shipped', 'delivered'] as const).map((st) => {
          const Icon = STAGE_ICONS[st]
          return (
            <div key={st} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Icon size={13} /> {STAGE_LABELS[st]}</div>
              <div className="text-lg font-semibold text-gray-800">{d.stats.by_stage[st]}</div>
            </div>
          )
        })}
      </div>

      {/* Gönderim geçmişi */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
          <span>Gönderim geçmişi <span className="text-gray-400 font-normal">(kime · hangi sipariş · hangi aşama · ne zaman)</span></span>
          <span className="text-xs text-gray-400">{d.deliveries.length} kayıt</span>
        </div>
        <div className="overflow-x-auto border-t border-gray-100 max-h-[480px] overflow-y-auto">
          {d.deliveries.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">Henüz bildirim yok. Otomasyon açılınca gönderimler burada listelenir.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 font-medium">Tarih</th>
                  <th className="px-3 py-2 font-medium">Aşama</th>
                  <th className="px-3 py-2 font-medium">Kanal</th>
                  <th className="px-3 py-2 font-medium">Alıcı</th>
                  <th className="px-3 py-2 font-medium">Sipariş</th>
                  <th className="px-3 py-2 font-medium">Kargo / Takip</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {d.deliveries.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.at ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                        r.stage === 'placed' ? 'bg-sky-50 text-sky-600' : r.stage === 'shipped' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600')}>
                        {STAGE_LABELS[r.stage ?? ''] ?? r.stage ?? '—'}
                      </span>
                      {r.is_test && <span className="ml-1 px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">test</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.channel === 'email' ? 'E-posta' : r.channel === 'sms' ? 'SMS' : 'WhatsApp'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <div>{r.customer_name || '—'}</div>
                      <div className="text-[10px] text-gray-400">{r.recipient}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.order_no ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {r.cargo ? <>{r.cargo}<div className="text-[10px] font-mono">{r.tracking_no}</div></> : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'sent' ? <span className="text-emerald-600">gönderildi</span>
                        : r.status === 'failed' ? <span className="text-rose-600" title={r.error ?? ''}>hata</span>
                        : <span className="text-amber-500">atlandı</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>)}

      {tab === 'flow' && (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Bildirim akışı</h2>
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
        </div>

        {/* Aşamalar */}
        <div className="space-y-2 mb-5">
          {(['placed', 'shipped', 'delivered'] as const).map((st, i) => {
            const Icon = STAGE_ICONS[st]
            return (
              <div key={st} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs flex items-center justify-center font-semibold shrink-0">{i + 1}</span>
                  <Icon size={16} className="text-gray-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800">{STAGE_LABELS[st]}</div>
                    <div className="text-[11px] text-gray-400">
                      WhatsApp şablonu: <span className="font-mono">{WA_TEMPLATES[st]}</span>
                    </div>
                  </div>
                  <Toggle on={s.stages[st]} onToggle={() => save({ stages: { ...s.stages, [st]: !s.stages[st] } })} disabled={saving} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Kanallar */}
        <h3 className="text-sm font-medium text-gray-800 mb-2">Kanallar</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {([['whatsapp', 'WhatsApp', 'Meta onaylı utility şablonlar'], ['sms', 'SMS', 'NetGSM üzerinden kısa metin'], ['email', 'E-posta', 'HTML şablon (sipariş onayı / kargo)']] as const).map(([key, label, desc]) => (
            <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-3">
              <div>
                <div className="text-sm text-gray-800">{label}</div>
                <div className="text-[11px] text-gray-400">{desc}</div>
              </div>
              <Toggle on={s.channels[key]} onToggle={() => save({ channels: { ...s.channels, [key]: !s.channels[key] } })} disabled={saving} />
            </div>
          ))}
        </div>

        <div className="text-xs text-gray-500 bg-sky-50/60 border border-sky-100 rounded-lg p-3 space-y-1">
          <p>• Bildirimler <b>işlemseldir</b>: müşterinin beklediği mesajlar olduğundan gönderim saat penceresi uygulanmaz, anında gider.</p>
          <p>• Her sipariş için her aşama <b>yalnızca bir kez</b> bildirilir. Statü atlanırsa (ör. sync arasında kargo+teslim) eksik aşamalar sırayla tamamlanır.</p>
          <p>• İptal / iade / teslim edilemedi durumlarında akış otomatik durur.</p>
          <p>• WhatsApp şablonları Meta onayı beklerken gönderim <b>otomatik ertelenir</b>; onaylandığı an kendiliğinden akar.</p>
        </div>

        <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
          <button onClick={() => save({})} disabled={saving}
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
            <Save size={15} /> Kaydet
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
