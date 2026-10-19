import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Plus, Sparkles, Loader2, Pencil, Trash2, X, Save, ExternalLink, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { croApi, CATEGORY_LABELS, STATUS_CLASSES, STATUS_LABELS, type CroAction, type CroCategory, type CroStatus } from '@/lib/croApi'

/* Aksiyon Planı — CRO deney/aksiyon backlog'u. ICE (etki×güven×kolaylık) ile sıralanır,
   durum satır üzerinden değiştirilir, katalogdan hazır aksiyonlar tohumlanabilir. */

type Form = {
  title: string; category: CroCategory; surface: string; hypothesis: string; description: string; status: CroStatus
  impact: number; confidence: number; ease: number; expected_uplift: string; feature_url: string; result: string; result_uplift: string
}
const emptyForm: Form = { title: '', category: 'pdp', surface: '', hypothesis: '', description: '', status: 'idea', impact: 3, confidence: 3, ease: 3, expected_uplift: '', feature_url: '', result: '', result_uplift: '' }

export default function CroActionsPage() {
  const [items, setItems] = useState<CroAction[]>([])
  const [catalogSize, setCatalogSize] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | CroStatus>('all')
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; id?: number } | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    croApi.actions().then((d) => { setItems(d.data); setCatalogSize(d.catalog_size) }).catch(() => setError('Aksiyonlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => items.reduce<Record<string, number>>((a, i) => { a[i.status] = (a[i.status] ?? 0) + 1; return a }, {}), [items])
  const visible = filter === 'all' ? items : items.filter((i) => i.status === filter)

  const openCreate = () => { setForm(emptyForm); setModal({ mode: 'create' }) }
  const openEdit = (a: CroAction) => {
    setForm({ title: a.title, category: a.category, surface: a.surface ?? '', hypothesis: a.hypothesis ?? '', description: a.description ?? '', status: a.status, impact: a.impact, confidence: a.confidence, ease: a.ease, expected_uplift: a.expected_uplift ?? '', feature_url: a.feature_url ?? '', result: a.result ?? '', result_uplift: a.result_uplift?.toString() ?? '' })
    setModal({ mode: 'edit', id: a.id })
  }

  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    setError('')
    const payload: Partial<CroAction> = {
      title: form.title.trim(), category: form.category, surface: form.surface || null, hypothesis: form.hypothesis || null, description: form.description || null,
      status: form.status, impact: form.impact, confidence: form.confidence, ease: form.ease, expected_uplift: form.expected_uplift || null,
      feature_url: form.feature_url || null, result: form.result || null, result_uplift: form.result_uplift === '' ? null : Number(form.result_uplift),
    }
    try {
      if (modal?.mode === 'edit' && modal.id) await croApi.updateAction(modal.id, payload)
      else await croApi.createAction(payload)
      setModal(null)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err?.response?.data?.message || 'Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (a: CroAction, status: CroStatus) => {
    if (status === a.status) return
    setItems((prev) => prev.map((i) => (i.id === a.id ? { ...i, status } : i)))
    try { await croApi.updateAction(a.id, { status }) } catch { load() }
  }

  const remove = async (a: CroAction) => {
    if (!confirm(`"${a.title}" silinsin mi?`)) return
    await croApi.deleteAction(a.id)
    load()
  }

  const seed = async () => {
    setSeeding(true)
    try { const r = await croApi.seedActions(); if (r.added === 0) setError('Katalogdaki tüm aksiyonlar zaten planda.'); load() } finally { setSeeding(false) }
  }

  const Score = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <div>
      <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} className={clsx('w-9 h-9 rounded-xl text-sm font-bold transition-colors', value === n ? 'bg-[var(--primary-soft)] text-[var(--primary-strong)]' : 'bg-[var(--app-bg)] text-gray-500 hover:text-gray-700')}>{n}</button>
        ))}
      </div>
    </div>
  )

  const inputCls = 'w-full rounded-xl bg-[var(--app-bg)] border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-strong)]/30 focus:bg-white'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><ClipboardList size={24} /> Aksiyon Planı</h1>
          <p className="text-sm text-gray-500 mt-1">Dönüşümü artıracak fikirleri ICE puanıyla önceliklendir, yayına al, sonucu kaydet.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} disabled={seeding} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-[var(--app-bg)] text-gray-700 text-sm font-semibold rounded-full disabled:opacity-60">
            {seeding ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Katalogdan ekle ({catalogSize})
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Plus size={16} /> Yeni aksiyon</button>
        </div>
      </div>

      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm flex items-center justify-between">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'running', 'planned', 'idea', 'done', 'discarded'] as const).map((st) => (
          <button key={st} onClick={() => setFilter(st)} className={clsx('px-3 py-1.5 rounded-full text-xs font-semibold transition-colors', filter === st ? 'bg-[var(--primary-soft)] text-[var(--primary-strong)]' : 'bg-white border border-gray-100 text-gray-500 hover:text-gray-700')}>
            {st === 'all' ? `Tümü ${items.length}` : `${STATUS_LABELS[st]} ${counts[st] ?? 0}`}
          </button>
        ))}
      </div>

      {loading && <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>}

      {!loading && visible.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <ClipboardList size={44} className="mx-auto text-gray-300 mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Bu filtrede aksiyon yok</h2>
          <p className="text-sm text-gray-500 mt-1">"Katalogdan ekle" ile Yunbi'nin hazır CRO aksiyonlarını plana alabilirsin.</p>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((a) => (
            <div key={a.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 shrink-0 text-center">
                  <div className="rounded-xl bg-orange-100 text-orange-700 font-extrabold text-sm py-1.5">{a.ice}</div>
                  <p className="text-[10px] text-gray-400 mt-0.5">ICE</p>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-gray-900">{a.title}</h3>
                    <span className="text-[11px] font-semibold rounded-full bg-[var(--app-bg)] text-gray-600 px-2 py-0.5">{CATEGORY_LABELS[a.category] ?? a.category}</span>
                    {a.surface && a.surface !== CATEGORY_LABELS[a.category] && <span className="text-[11px] text-gray-400">{a.surface}</span>}
                  </div>
                  {a.hypothesis && <p className="text-sm text-gray-600 mt-1 leading-snug">{a.hypothesis}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-500">
                    <span>Etki <b className="text-gray-700">{a.impact}</b> · Güven <b className="text-gray-700">{a.confidence}</b> · Kolaylık <b className="text-gray-700">{a.ease}</b></span>
                    {a.expected_uplift && <span>Beklenti: <b className="text-gray-700">{a.expected_uplift}</b></span>}
                    {a.result_uplift !== null && a.result_uplift !== undefined && <span>Ölçülen: <b className={a.result_uplift >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{a.result_uplift > 0 ? '+' : ''}{a.result_uplift}%</b></span>}
                    {a.feature_url && <Link to={a.feature_url} className="inline-flex items-center gap-1 text-[var(--primary-strong)] font-semibold">Araca git <ExternalLink size={11} /></Link>}
                    {(a.description || a.result) && <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600">Detay <ChevronDown size={12} className={clsx('transition-transform', expanded === a.id && 'rotate-180')} /></button>}
                  </div>
                  {expanded === a.id && (
                    <div className="mt-2 rounded-xl bg-[var(--app-bg)] p-3 text-sm text-gray-700 space-y-1">
                      {a.description && <p className="whitespace-pre-wrap">{a.description}</p>}
                      {a.result && <p className="whitespace-pre-wrap"><b>Sonuç:</b> {a.result}</p>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <select value={a.status} onChange={(e) => setStatus(a, e.target.value as CroStatus)} className={clsx('text-xs font-semibold rounded-full px-2.5 py-1.5 border-0 focus:ring-2 focus:ring-[var(--primary-strong)]/30 cursor-pointer', STATUS_CLASSES[a.status])}>
                    {(Object.keys(STATUS_LABELS) as CroStatus[]).map((st) => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                  </select>
                  <button onClick={() => openEdit(a)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Düzenle"><Pencil size={15} /></button>
                  <button onClick={() => remove(a)} className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50" title="Sil"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold text-gray-900">{modal.mode === 'create' ? 'Yeni aksiyon' : 'Aksiyonu düzenle'}</h2>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div><label className="text-xs font-semibold text-gray-600">Başlık</label><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ör. Mobilde yapışkan sepete ekle barı" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="text-xs font-semibold text-gray-600">Alan</label>
                  <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CroCategory })}>
                    {(Object.keys(CATEGORY_LABELS) as CroCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select></div>
                <div><label className="text-xs font-semibold text-gray-600">Yüzey</label><input className={inputCls} value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} placeholder="Ürün sayfası, Sepet…" /></div>
                <div><label className="text-xs font-semibold text-gray-600">Durum</label>
                  <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CroStatus })}>
                    {(Object.keys(STATUS_LABELS) as CroStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600">Hipotez</label><textarea rows={2} className={inputCls} value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} placeholder="X yaparsak Y olur, çünkü Z." /></div>
              <div><label className="text-xs font-semibold text-gray-600">Açıklama / uygulama notu</label><textarea rows={3} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Score label="Etki" value={form.impact} onChange={(v) => setForm({ ...form, impact: v })} />
                <Score label="Güven" value={form.confidence} onChange={(v) => setForm({ ...form, confidence: v })} />
                <Score label="Kolaylık" value={form.ease} onChange={(v) => setForm({ ...form, ease: v })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600">Beklenen etki</label><input className={inputCls} value={form.expected_uplift} onChange={(e) => setForm({ ...form, expected_uplift: e.target.value })} placeholder="+%5-10 sepete ekleme" /></div>
                <div><label className="text-xs font-semibold text-gray-600">Panel sayfası (opsiyonel)</label><input className={inputCls} value={form.feature_url} onChange={(e) => setForm({ ...form, feature_url: e.target.value })} placeholder="/shipping-widget" /></div>
              </div>
              {(form.status === 'done' || form.status === 'running' || form.result) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2"><label className="text-xs font-semibold text-gray-600">Sonuç notu</label><textarea rows={2} className={inputCls} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} /></div>
                  <div><label className="text-xs font-semibold text-gray-600">Ölçülen etki (%)</label><input type="number" step="0.1" className={inputCls} value={form.result_uplift} onChange={(e) => setForm({ ...form, result_uplift: e.target.value })} placeholder="+7.5" /></div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold text-gray-600 rounded-full hover:bg-gray-100">Vazgeç</button>
              <button onClick={save} disabled={saving || !form.title.trim()} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-full">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
