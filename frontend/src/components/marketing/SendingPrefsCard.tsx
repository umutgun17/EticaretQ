import { useEffect, useState } from 'react'
import { Clock, Gauge, Save } from 'lucide-react'
import clsx from 'clsx'
import { marketingPrefsApi, type MarketingPrefs } from '@/lib/cartRecoveryApi'

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0', on ? 'bg-indigo-600' : 'bg-gray-300')}>
      <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

export default function SendingPrefsCard() {
  const [p, setP] = useState<MarketingPrefs | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { marketingPrefsApi.get().then(setP) }, [])
  if (!p) return <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4 text-sm text-gray-400">Yükleniyor…</div>

  const w = p.window, fq = p.frequency
  async function save() {
    setSaving(true)
    try { setP(await marketingPrefsApi.update(p!)); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Clock size={17} className="text-indigo-600" />
          <h2 className="font-medium text-gray-900">Gönderim saatleri & frekans</h2>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
            <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-4">Bu kurallar tüm pazarlama gönderimlerinde uygulanır. Uygun saat dışındaki/limite takılan mesajlar <b>atlanmaz</b>, ilk uygun zamana ertelenir.</p>

      {/* Tek gönderim penceresi */}
      <div className="border border-gray-100 rounded-lg p-4 mb-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Clock size={14} className="text-gray-500" /> Gönderim saat aralığı</span>
          <Toggle on={w.enabled} onToggle={() => setP({ ...p, window: { ...w, enabled: !w.enabled } })} />
        </div>
        {w.enabled ? (
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Başlangıç</label>
              <input type="time" value={w.start} onChange={(e) => setP({ ...p, window: { ...w, start: e.target.value } })} className={inputCls} />
            </div>
            <span className="text-gray-400 mt-5">—</span>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bitiş</label>
              <input type="time" value={w.end} onChange={(e) => setP({ ...p, window: { ...w, end: e.target.value } })} className={inputCls} />
            </div>
            <p className="text-[11px] text-gray-400 mt-5 ml-2">Yalnızca bu saatler arasında gönderilir (Türkiye saati). Dışında kalanlar ertesi gün bu saate ertelenir.</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Kapalı — gönderimler saat kısıtı olmadan (7/24) yapılır.</p>
        )}
      </div>

      {/* Frekans limiti */}
      <div className="border border-gray-100 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Gauge size={14} className="text-gray-500" /> Frekans limiti</span>
          <Toggle on={fq.enabled} onToggle={() => setP({ ...p, frequency: { ...fq, enabled: !fq.enabled } })} />
        </div>
        {fq.enabled ? (
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Günde en fazla</label>
              <input type="number" min={0} value={fq.per_day} onChange={(e) => setP({ ...p, frequency: { ...fq, per_day: +e.target.value } })} className={clsx(inputCls, 'w-full')} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Haftada en fazla</label>
              <input type="number" min={0} value={fq.per_week} onChange={(e) => setP({ ...p, frequency: { ...fq, per_week: +e.target.value } })} className={clsx(inputCls, 'w-full')} />
            </div>
            <p className="text-[11px] text-gray-400 col-span-2">Aynı kişiye bu sayıdan fazla mesaj gitmez (kanallar arası toplam). <b>0 = sınırsız.</b> Limite takılanlar ertelenir.</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Kapalı — frekans sınırı uygulanmaz.</p>
        )}
      </div>
    </div>
  )
}
