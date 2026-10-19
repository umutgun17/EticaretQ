import { useCallback, useEffect, useState } from 'react'
import {
  Users2, RefreshCw, Plus, Pencil, Trash2, Download, X, FlaskConical,
  Phone, Mail, Lock, ShoppingBag,
} from 'lucide-react'
import clsx from 'clsx'
import {
  segmentApi, type Segment, type SegmentDefinition, type SegmentPreview, type SegmentsOverview,
} from '@/lib/segmentApi'

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
const nf = new Intl.NumberFormat('tr-TR')
const SOURCES = [
  { key: 'TicimaxWeb', label: 'Web Sitesi' },
  { key: 'NativeAndroid', label: 'Android App' },
  { key: 'NativeIOS', label: 'iOS App' },
  { key: 'Uye', label: 'Üye (siparişsiz)' },
]

function numOrU(v: string): number | undefined {
  const n = Number(v)
  return v === '' || Number.isNaN(n) ? undefined : n
}

function ruleSummary(d: SegmentDefinition): string[] {
  const parts: string[] = []
  if (d.membership === 'member') parts.push('Üyelikli')
  if (d.membership === 'guest') parts.push('Üyeliksiz')
  if (d.max_orders === 0) parts.push('hiç sipariş vermemiş')
  else if (d.min_orders !== undefined && d.max_orders !== undefined) parts.push(`${d.min_orders}-${d.max_orders} sipariş`)
  else if (d.min_orders !== undefined) parts.push(`≥${d.min_orders} sipariş`)
  else if (d.max_orders !== undefined) parts.push(`≤${d.max_orders} sipariş`)
  if (d.min_total !== undefined) parts.push(`toplam ≥${nf.format(d.min_total)} TL`)
  if (d.max_total !== undefined) parts.push(`toplam ≤${nf.format(d.max_total)} TL`)
  if (d.min_max_order !== undefined) parts.push(`tek sipariş ≥${nf.format(d.min_max_order)} TL`)
  if (d.last_order_older_days !== undefined) parts.push(`${d.last_order_older_days}+ gündür sessiz`)
  if (d.last_order_within_days !== undefined) parts.push(`son ${d.last_order_within_days} günde aktif`)
  if (d.first_order_within_days !== undefined) parts.push(`ilk sipariş son ${d.first_order_within_days} gün`)
  if (d.has_phone) parts.push('telefonu var')
  if (d.has_email) parts.push('e-postası var')
  if (d.sources?.length) parts.push(d.sources.map(s => SOURCES.find(x => x.key === s)?.label ?? s).join('/'))
  return parts.length ? parts : ['Tüm profiller']
}

/* ---------- Segment düzenleme modalı ---------- */
function EditorModal({ segment, onClose, onSaved }: {
  segment: Segment | null
  onClose: () => void
  onSaved: () => void
}) {
  const d = segment?.definition ?? {}
  const [name, setName] = useState(segment?.name ?? '')
  const [desc, setDesc] = useState(segment?.description ?? '')
  const [membership, setMembership] = useState<'any' | 'member' | 'guest'>(d.membership ?? 'any')
  const [hasPhone, setHasPhone] = useState(!!d.has_phone)
  const [hasEmail, setHasEmail] = useState(!!d.has_email)
  const [minOrders, setMinOrders] = useState(d.min_orders?.toString() ?? '')
  const [maxOrders, setMaxOrders] = useState(d.max_orders?.toString() ?? '')
  const [minTotal, setMinTotal] = useState(d.min_total?.toString() ?? '')
  const [maxTotal, setMaxTotal] = useState(d.max_total?.toString() ?? '')
  const [minMaxOrder, setMinMaxOrder] = useState(d.min_max_order?.toString() ?? '')
  const [olderDays, setOlderDays] = useState(d.last_order_older_days?.toString() ?? '')
  const [withinDays, setWithinDays] = useState(d.last_order_within_days?.toString() ?? '')
  const [firstWithin, setFirstWithin] = useState(d.first_order_within_days?.toString() ?? '')
  const [sources, setSources] = useState<string[]>(d.sources ?? [])
  const [preview, setPreview] = useState<SegmentPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const buildDef = (): SegmentDefinition => ({
    ...(membership !== 'any' ? { membership } : {}),
    ...(hasPhone ? { has_phone: true } : {}),
    ...(hasEmail ? { has_email: true } : {}),
    ...(numOrU(minOrders) !== undefined ? { min_orders: numOrU(minOrders) } : {}),
    ...(numOrU(maxOrders) !== undefined ? { max_orders: numOrU(maxOrders) } : {}),
    ...(numOrU(minTotal) !== undefined ? { min_total: numOrU(minTotal) } : {}),
    ...(numOrU(maxTotal) !== undefined ? { max_total: numOrU(maxTotal) } : {}),
    ...(numOrU(minMaxOrder) !== undefined ? { min_max_order: numOrU(minMaxOrder) } : {}),
    ...(numOrU(olderDays) !== undefined ? { last_order_older_days: numOrU(olderDays) } : {}),
    ...(numOrU(withinDays) !== undefined ? { last_order_within_days: numOrU(withinDays) } : {}),
    ...(numOrU(firstWithin) !== undefined ? { first_order_within_days: numOrU(firstWithin) } : {}),
    ...(sources.length ? { sources } : {}),
  })

  const runPreview = async () => {
    setBusy(true); setErr(null)
    try { setPreview(await segmentApi.preview(buildDef())) }
    catch { setErr('Önizleme alınamadı.') }
    finally { setBusy(false) }
  }

  const save = async () => {
    if (!name.trim()) { setErr('Segment adı gerekli.'); return }
    setBusy(true); setErr(null)
    try {
      const payload = { name: name.trim(), description: desc.trim() || undefined, definition: buildDef() }
      if (segment) await segmentApi.update(segment.id, payload)
      else await segmentApi.create(payload)
      onSaved()
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setErr(m ?? 'Kaydedilemedi.')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mt-8 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{segment ? 'Segmenti Düzenle' : 'Yeni Segment'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm sm:col-span-2">
            <span className="text-gray-600">Segment adı</span>
            <input className={clsx(inputCls, 'w-full mt-1')} value={name} onChange={e => setName(e.target.value)} placeholder="ör. VIP Müşteriler" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-gray-600">Açıklama (opsiyonel)</span>
            <input className={clsx(inputCls, 'w-full mt-1')} value={desc} onChange={e => setDesc(e.target.value)} />
          </label>

          <label className="text-sm">
            <span className="text-gray-600">Üyelik durumu</span>
            <select className={clsx(inputCls, 'w-full mt-1')} value={membership} onChange={e => setMembership(e.target.value as typeof membership)}>
              <option value="any">Fark etmez</option>
              <option value="member">Üyelikli alışveriş</option>
              <option value="guest">Üyeliksiz (misafir)</option>
            </select>
          </label>
          <div className="text-sm">
            <span className="text-gray-600">İletişim şartı</span>
            <div className="flex gap-4 mt-2">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} /> Telefonu olsun</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={hasEmail} onChange={e => setHasEmail(e.target.checked)} /> E-postası olsun</label>
            </div>
          </div>

          <label className="text-sm">
            <span className="text-gray-600">Sipariş adedi (min)</span>
            <input type="number" min={0} className={clsx(inputCls, 'w-full mt-1')} value={minOrders} onChange={e => setMinOrders(e.target.value)} placeholder="ör. 1" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Sipariş adedi (max)</span>
            <input type="number" min={0} className={clsx(inputCls, 'w-full mt-1')} value={maxOrders} onChange={e => setMaxOrders(e.target.value)} placeholder="boş = sınırsız" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Toplam harcama min (TL)</span>
            <input type="number" min={0} className={clsx(inputCls, 'w-full mt-1')} value={minTotal} onChange={e => setMinTotal(e.target.value)} placeholder="ör. 10000" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Toplam harcama max (TL)</span>
            <input type="number" min={0} className={clsx(inputCls, 'w-full mt-1')} value={maxTotal} onChange={e => setMaxTotal(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Tek siparişte en az (TL)</span>
            <input type="number" min={0} className={clsx(inputCls, 'w-full mt-1')} value={minMaxOrder} onChange={e => setMinMaxOrder(e.target.value)} placeholder="yüksek sepet" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Son siparişi şu kadar günden ESKİ</span>
            <input type="number" min={1} className={clsx(inputCls, 'w-full mt-1')} value={olderDays} onChange={e => setOlderDays(e.target.value)} placeholder="almış-bırakmış: 180" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">Son X günde sipariş vermiş</span>
            <input type="number" min={1} className={clsx(inputCls, 'w-full mt-1')} value={withinDays} onChange={e => setWithinDays(e.target.value)} placeholder="aktif müşteri" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">İlk siparişi son X günde</span>
            <input type="number" min={1} className={clsx(inputCls, 'w-full mt-1')} value={firstWithin} onChange={e => setFirstWithin(e.target.value)} placeholder="yeni müşteri" />
          </label>
          <div className="text-sm">
            <span className="text-gray-600">Kanal (ilk sipariş)</span>
            <div className="flex gap-3 mt-2 flex-wrap">
              {SOURCES.map(s => (
                <label key={s.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={sources.includes(s.key)}
                    onChange={e => setSources(v => e.target.checked ? [...v, s.key] : v.filter(x => x !== s.key))} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {preview && (
          <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm">
            <div className="font-medium text-indigo-900">
              Önizleme: {nf.format(preview.total)} kişi
              <span className="font-normal text-indigo-700"> — {nf.format(preview.with_phone)} telefonlu, {nf.format(preview.with_email)} e-postalı</span>
            </div>
            {preview.sample.length > 0 && (
              <div className="mt-2 text-xs text-indigo-800 space-y-0.5 max-h-32 overflow-y-auto">
                {preview.sample.map((p, i) => (
                  <div key={i}>{p.name ?? '—'} · {p.orders_count} sipariş · {nf.format(Math.round(Number(p.total_spent)))} TL</div>
                ))}
              </div>
            )}
          </div>
        )}
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

        <div className="flex justify-between mt-5">
          <button onClick={runPreview} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-50">
            <FlaskConical size={15} /> Önizle
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Vazgeç</button>
            <button onClick={save} disabled={busy}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {segment ? 'Kaydet' : 'Oluştur'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Export modalı ---------- */
function ExportModal({ segment, fields, onClose }: {
  segment: Segment
  fields: Record<string, string>
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>(['name', 'phone', 'email'])
  const [require, setRequire] = useState<'' | 'phone' | 'email'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    if (!selected.length) { setErr('En az bir alan seçin.'); return }
    setBusy(true); setErr(null)
    try {
      await segmentApi.export(segment.id, selected, require || undefined)
      onClose()
    } catch { setErr('Export alınamadı.') }
    finally { setBusy(false) }
  }

  const estimate = require === 'phone' ? segment.counts.with_phone
    : require === 'email' ? segment.counts.with_email : segment.counts.total

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mt-16 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">CSV Export</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="text-sm text-gray-500 mb-4">{segment.name} — ~{nf.format(estimate)} satır</div>

        <div className="text-sm font-medium text-gray-700 mb-2">Alanlar</div>
        <div className="grid grid-cols-2 gap-1.5 text-sm">
          {Object.entries(fields).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={selected.includes(k)}
                onChange={e => setSelected(v => e.target.checked ? [...v, k] : v.filter(x => x !== k))} />
              {label}
            </label>
          ))}
        </div>

        <div className="text-sm font-medium text-gray-700 mt-4 mb-2">Satır filtresi</div>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={require === ''} onChange={() => setRequire('')} /> Tümü</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={require === 'phone'} onChange={() => setRequire('phone')} /> Sadece telefonu olanlar</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={require === 'email'} onChange={() => setRequire('email')} /> Sadece e-postası olanlar</label>
        </div>

        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <button onClick={run} disabled={busy}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          <Download size={15} /> {busy ? 'Hazırlanıyor…' : 'CSV İndir'}
        </button>
      </div>
    </div>
  )
}

/* ---------- Ana sayfa ---------- */
export default function SegmentsPage() {
  const [data, setData] = useState<SegmentsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; segment: Segment | null }>({ open: false, segment: null })
  const [exporting, setExporting] = useState<Segment | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try { setData(await segmentApi.list()) }
    catch { setMsg({ ok: false, text: 'Veriler yüklenemedi.' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 5000)
  }

  const runRefresh = async () => {
    setRefreshing(true)
    try {
      const r = await segmentApi.refresh()
      flash(true, `Profiller yenilendi: ${nf.format(r.profiles)} kişi.`)
      await load()
    } catch { flash(false, 'Yenileme başarısız.') }
    finally { setRefreshing(false) }
  }

  const remove = async (s: Segment) => {
    if (!window.confirm(`"${s.name}" segmenti silinsin mi? (Veri silinmez, yalnız tanım.)`)) return
    try { await segmentApi.remove(s.id); flash(true, 'Segment silindi.'); await load() }
    catch { flash(false, 'Silinemedi.') }
  }

  if (loading) return <div className="p-6 text-gray-500">Yükleniyor…</div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Users2 className="text-violet-600" size={22} /> Segmentler
        </h1>
        <div className="flex gap-2">
          <button onClick={runRefresh} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Profilleri Yenile
          </button>
          <button onClick={() => setEditor({ open: true, segment: null })}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            <Plus size={15} /> Yeni Segment
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Site + mobil uygulama siparişlerinden ve sipariş vermemiş site üyelerinden türeyen kişi profilleri
        üzerinde kural tabanlı dinamik segmentler. Segmentler WhatsApp ve e-posta kampanyalarında hedef olarak seçilebilir.
        {data?.profiles.refreshed_at && <> Son yenileme: {new Date(data.profiles.refreshed_at).toLocaleString('tr-TR')} (her gece otomatik).</>}
      </p>

      {msg && (
        <div className={clsx('mb-4 px-4 py-2.5 rounded-lg text-sm', msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
          {msg.text}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-500 flex items-center gap-1"><ShoppingBag size={13} /> Toplam profil</div>
            <div className="text-2xl font-semibold mt-1">{nf.format(data.profiles.total)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-500 flex items-center gap-1"><Phone size={13} /> Telefonlu</div>
            <div className="text-2xl font-semibold mt-1">{nf.format(data.profiles.with_phone)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-500 flex items-center gap-1"><Mail size={13} /> E-postalı</div>
            <div className="text-2xl font-semibold mt-1">{nf.format(data.profiles.with_email)}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data?.segments.map(s => (
          <div key={s.id} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{s.name}</span>
                  {s.is_system && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-medium">
                      <Lock size={9} /> Havuz
                    </span>
                  )}
                </div>
                {s.description && <div className="text-xs text-gray-500 mt-0.5">{s.description}</div>}
                <div className="flex flex-wrap gap-1 mt-2">
                  {ruleSummary(s.definition).map((r, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px]">{r}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button title="CSV Export" onClick={() => setExporting(s)}
                  className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Download size={16} /></button>
                {!s.is_system && (
                  <>
                    <button title="Düzenle" onClick={() => setEditor({ open: true, segment: s })}
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Pencil size={16} /></button>
                    <button title="Sil" onClick={() => remove(s)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={16} /></button>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-sm">
              <div><span className="text-lg font-semibold">{nf.format(s.counts.total)}</span> <span className="text-gray-500 text-xs">kişi</span></div>
              <div className="flex items-center gap-1 text-gray-500 text-xs"><Phone size={12} /> {nf.format(s.counts.with_phone)}</div>
              <div className="flex items-center gap-1 text-gray-500 text-xs"><Mail size={12} /> {nf.format(s.counts.with_email)}</div>
            </div>
          </div>
        ))}
      </div>

      {editor.open && (
        <EditorModal segment={editor.segment}
          onClose={() => setEditor({ open: false, segment: null })}
          onSaved={() => { setEditor({ open: false, segment: null }); flash(true, 'Segment kaydedildi.'); load() }} />
      )}
      {exporting && data && (
        <ExportModal segment={exporting} fields={data.export_fields} onClose={() => setExporting(null)} />
      )}
    </div>
  )
}
