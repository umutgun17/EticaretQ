import { useCallback, useEffect, useState } from 'react'
import { ScanSearch, Loader2, Play, CheckCircle2, AlertTriangle, XCircle, Info, ExternalLink, Clock } from 'lucide-react'
import clsx from 'clsx'
import { croApi, PAGE_TYPE_LABELS, type CroAuditHistory, type CroAuditPage as AuditPage, type CroCheck } from '@/lib/croApi'

/* Site Denetimi — mağazanın ana/kategori/ürün/sepet sayfaları çekilir, CRO kontrol listesi koşulur.
   Headless tarayıcı yok; JS ile sonradan basılan öğeler "bilgi" olarak işaretlenir. */
export default function CroAuditPage() {
  const [pages, setPages] = useState<AuditPage[]>([])
  const [history, setHistory] = useState<CroAuditHistory[]>([])
  const [runAt, setRunAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string>('home')

  const load = useCallback(() => {
    setLoading(true)
    croApi.audits()
      .then((d) => { setPages(d.pages); setHistory(d.history); setRunAt(d.run?.at ?? null); if (d.pages.length && !d.pages.find((p) => p.page_type === selected)) setSelected(d.pages[0].page_type) })
      .catch((e) => setError(e?.response?.data?.message || 'Denetim verisi yüklenemedi'))
      .finally(() => setLoading(false))
  }, [selected])

  useEffect(() => { load() }, [load])

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      await croApi.runAudit()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err?.response?.data?.message || 'Denetim çalıştırılamadı')
    } finally {
      setRunning(false)
    }
  }

  const avg = pages.length ? Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length) : 0
  const scoreClass = (s: number) => (s >= 80 ? 'bg-emerald-100 text-emerald-700' : s >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')
  const current = pages.find((p) => p.page_type === selected)

  const statusIcon = (st: CroCheck['status']) =>
    st === 'pass' ? <CheckCircle2 size={16} className="text-emerald-500" /> :
    st === 'warn' ? <AlertTriangle size={16} className="text-amber-500" /> :
    st === 'fail' ? <XCircle size={16} className="text-rose-500" /> :
    <Info size={16} className="text-gray-300" />

  const grouped = (current?.checks ?? []).reduce<Record<string, CroCheck[]>>((acc, c) => { (acc[c.group] ??= []).push(c); return acc }, {})
  const order: Record<string, number> = { pass: 3, info: 2, warn: 1, fail: 0 }
  const counts = (current?.checks ?? []).reduce<Record<string, number>>((a, c) => { a[c.status] = (a[c.status] ?? 0) + 1; return a }, {})

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><ScanSearch size={24} /> Site Denetimi</h1>
          <p className="text-sm text-gray-500 mt-1">Ana sayfa, kategori, ürün ve sepet sayfaları CRO kontrol listesinden geçirilir; hız, güven, mobil ve sayfa-özel öğeler puanlanır.</p>
        </div>
        <button onClick={run} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-full">
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {running ? 'Sayfalar taranıyor…' : 'Denetimi çalıştır'}
        </button>
      </div>

      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error}</div>}
      {loading && <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>}

      {!loading && pages.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <ScanSearch size={44} className="mx-auto text-gray-300 mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Henüz denetim yok</h2>
          <p className="text-sm text-gray-500 mt-1">"Denetimi çalıştır" ile mağaza sayfaları birkaç saniyede taranır.</p>
        </div>
      )}

      {!loading && pages.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
              <div className={clsx('w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-extrabold', scoreClass(avg))}>{avg}</div>
              <div><p className="text-[11px] font-semibold text-gray-400 uppercase">Genel puan</p><p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Clock size={11} /> {runAt ? new Date(runAt).toLocaleString('tr-TR') : ''}</p></div>
            </div>
            {pages.map((p) => (
              <button key={p.id} onClick={() => setSelected(p.page_type)} className={clsx('text-left bg-white rounded-xl shadow-sm border p-4 transition-colors', selected === p.page_type ? 'border-[var(--primary-strong)]' : 'border-gray-100 hover:border-gray-200')}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">{PAGE_TYPE_LABELS[p.page_type] ?? p.page_type}</p>
                  <span className={clsx('text-sm font-extrabold rounded-lg px-2 py-0.5', scoreClass(p.score))}>{p.score}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{p.ttfb_ms} ms TTFB · {Math.round(p.html_bytes / 1024)} KB · HTTP {p.http_status}</p>
              </button>
            ))}
          </div>

          {current && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="min-w-0">
                  <h2 className="font-bold text-gray-900">{PAGE_TYPE_LABELS[current.page_type] ?? current.page_type}</h2>
                  <a href={current.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-strong)] inline-flex items-center gap-1 truncate max-w-full">{current.url} <ExternalLink size={11} /></a>
                </div>
                <div className="flex gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">{counts.pass ?? 0} geçti</span>
                  <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5">{counts.warn ?? 0} uyarı</span>
                  <span className="rounded-full bg-rose-50 text-rose-700 px-2 py-0.5">{counts.fail ?? 0} hata</span>
                  <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">{counts.info ?? 0} bilgi</span>
                </div>
              </div>
              <div className="space-y-5">
                {Object.entries(grouped).map(([group, checks]) => (
                  <div key={group}>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{group}</h3>
                    <ul className="divide-y divide-gray-50">
                      {[...checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => (
                        <li key={c.key} className="py-2.5 flex items-start gap-3">
                          <span className="mt-0.5 shrink-0">{statusIcon(c.status)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <p className="text-sm font-semibold text-gray-800">{c.label}</p>
                              <p className="text-xs text-gray-400">{c.detail}</p>
                            </div>
                            {c.advice && c.status !== 'pass' && <p className="text-xs text-gray-600 mt-0.5 leading-snug">{c.advice}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 1 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-900 mb-3">Geçmiş koşular</h2>
              <ul className="divide-y divide-gray-50 text-sm">
                {history.map((h) => (
                  <li key={h.run_id} className="py-2 flex items-center justify-between">
                    <span className="text-gray-600">{new Date(h.at).toLocaleString('tr-TR')} · {h.pages} sayfa</span>
                    <span className={clsx('font-extrabold rounded-lg px-2 py-0.5', scoreClass(h.avg_score))}>{h.avg_score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
