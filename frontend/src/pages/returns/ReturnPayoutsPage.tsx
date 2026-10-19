import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote, Printer, FileSpreadsheet, Search, RefreshCw, AlertTriangle, Copy, Check,
  Landmark, ArrowLeft, Send, Loader2, Info, CheckCircle2, XCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/contexts/AuthContext'
import {
  returnsAdminApi, statusBadgeClass, fmtMoney,
  type PayoutListResponse, type PayoutRow, type PayoutScope,
} from '@/lib/returnsAdminApi'

/**
 * KAPIDA ÖDEME — HAVALE BÖLÜMÜ (yönetici ekranının muhasebe kuyruğu, kullanıcı kararı 2026-09-04).
 *
 * Kapıda ödemeli siparişte para kart üzerinden geri verilemez: müşterinin beyan ettiği IBAN'a
 * havale yapılır. Akış TEK EKRANDA toplanır:
 *   1) "Ödenecek" listesi alınır (para onayı bekleyenler DÂHİL) → Yazdır / CSV ile muhasebeye gider
 *   2) muhasebe havaleyi yapar
 *   3) aynı ekrandan "Ödeme Yapıldı" ile kapatılır → talep Refunded, Ticimax statüsü + müşteriye SMS
 *
 * Adım 3, talep henüz para onayı almadıysa ÖNCE yönetici para onayını, ardından havale kapanışını
 * ardışık çalıştırır — ikisi de mevcut TEKİL uçlardan geçer, yani tüm guard'lar/audit/SMS birebir
 * tekil akıştaki gibi işler. Backend'de toplu yol YOKTUR.
 *
 * ⚠ Ekran IBAN taşır → yalnızca para onayı yetkisi olanlara açıktır (uçlar da ayrıca denetler).
 */

const SCOPES: { key: PayoutScope; label: string; hint: string }[] = [
  { key: 'payable', label: 'Ödenecek', hint: 'Para onayı bekleyen + onaylanmış kapıda ödeme iadeleri. Havale yapıldıktan sonra kapanış bu ekrandan verilir.' },
  { key: 'pipeline', label: 'Kargo Sürecinde', hint: 'Kapıda ödemeli talepler henüz depoya ulaşmadı/incelenmedi — ödeme kuyruğuna girmediler.' },
  { key: 'paid', label: 'Ödenmiş', hint: 'Havalesi yapılıp kapatılmış talepler (mutabakat).' },
]

/** IBAN'ı 4'erli gruplayarak okunur yazar (kopyalanan değer boşluksuz kalır). */
function fmtIban(iban: string | null): string {
  return iban ? (iban.match(/.{1,4}/g) ?? [iban]).join(' ') : ''
}

/** Ödeme kapanışı ilerlemesi — talep başına sonuç (hata alan atlanır, kalanlar devam eder). */
type SettleItem = { state: 'waiting' | 'running' | 'ok' | 'error'; message?: string }
type SettleState = {
  rows: PayoutRow[]
  results: Record<number, SettleItem>
  note: string
  txn: string
  running: boolean
  done: boolean
} | null

export default function ReturnPayoutsPage() {
  const { user } = useAuth()
  const canManager = !!user?.can_manager_approve_returns

  const [scope, setScope] = useState<PayoutScope>('payable')
  const [res, setRes] = useState<PayoutListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [unsentOnly, setUnsentOnly] = useState(false)
  const [missingIbanOnly, setMissingIbanOnly] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [marking, setMarking] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [settle, setSettle] = useState<SettleState>(null)

  const params = useMemo(
    () => ({
      scope,
      q: search || undefined,
      unsent_only: unsentOnly || undefined,
      missing_iban_only: missingIbanOnly || undefined,
    }),
    [scope, search, unsentOnly, missingIbanOnly]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRes(await returnsAdminApi.payouts(params))
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'Liste yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])
  // Bağlam değişince bayat seçim kalmasın (yanlış talebe ödeme/damga işlenmesin).
  useEffect(() => { setSelected(new Set()) }, [scope, search, unsentOnly, missingIbanOnly])

  const rows = res?.data ?? []
  // Ödenecek kuyruğunda seçim YALNIZ fiilen ödenebilir satırlarda açıktır (IBAN'ı olmayan seçilemez).
  const selectableRows = scope === 'payable' ? rows.filter((r) => r.payable) : rows
  const selectedRows = selectableRows.filter((r) => selected.has(r.id))
  /**
   * Çıktı/işlem kapsamı: seçim varsa seçilenler, yoksa listenin ödenebilir kısmı.
   * IBAN'ı eksik talepler ekranda görünür ama muhasebeye giden çıktıya girmez.
   */
  const outputRows = selectedRows.length > 0 ? selectedRows : selectableRows
  const outputTotal = outputRows.reduce((s, r) => s + r.amount, 0)
  const blockedCount = scope === 'payable' ? rows.length - selectableRows.length : 0

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelected((prev) =>
      selectableRows.every((r) => prev.has(r.id)) ? new Set() : new Set(selectableRows.map((r) => r.id)))

  const copyIban = (row: PayoutRow) => {
    if (!row.iban) return
    navigator.clipboard?.writeText(row.iban)
    setCopied(row.id)
    setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 1500)
  }

  /**
   * YAZDIR: kapsamdaki satırlardan muhasebeye verilecek ödeme talimatını üretir.
   * Gizli iframe kullanılır — yeni sekme açmadığı için pop-up engelleyicilerine takılmaz.
   */
  const print = () => {
    if (outputRows.length === 0) return
    const esc = (v: unknown) =>
      String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
    const firm = user?.tenant?.name ?? ''
    const now = new Date().toLocaleString('tr-TR')
    const batches = Array.from(new Set(outputRows.map((r) => r.accounting?.batch).filter(Boolean)))

    const body = outputRows
      .map(
        (r, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(r.public_code)}<div class="s">${esc(r.order_no ?? '')}</div></td>
          <td>${esc(r.customer_name ?? '')}<div class="s">${esc(r.customer_phone ?? '')}</div></td>
          <td>${esc(r.account_holder ?? '—')}</td>
          <td class="m">${esc(fmtIban(r.iban))}</td>
          <td>${esc(r.bank_name ?? '')}</td>
          <td class="r m">${r.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${esc(r.currency)}</td>
        </tr>`
      )
      .join('')

    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Havale Ödeme Listesi</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font: 11px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: #555; font-size: 11px; margin-bottom: 12px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: top; }
  th { background: #f1f1f1; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  td.c { text-align: center; width: 26px; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .m { font-family: "SFMono-Regular", Consolas, monospace; white-space: nowrap; }
  .s { color: #666; font-size: 10px; }
  tfoot td { background: #f7f7f7; font-weight: 700; }
  .sign { margin-top: 26px; display: flex; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 10px; color: #555; }
  .note { margin-top: 14px; font-size: 10px; color: #555; }
</style></head><body>
<h1>Kapıda Ödeme İadesi — Havale Ödeme Listesi</h1>
<div class="sub">${esc(firm)}</div>
<div class="meta">
  <div><b>Düzenleme:</b> ${esc(now)}${batches.length ? ` &nbsp;·&nbsp; <b>Parti:</b> ${esc(batches.join(', '))}` : ''}</div>
  <div><b>Kayıt:</b> ${outputRows.length} &nbsp;·&nbsp; <b>Toplam:</b> ${outputTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${esc(outputRows[0]?.currency ?? 'TRY')}</div>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Talep / Sipariş</th><th>Müşteri</th><th>Hesap Sahibi</th><th>IBAN</th><th>Banka</th><th class="r">Tutar</th>
  </tr></thead>
  <tbody>${body}</tbody>
  <tfoot><tr>
    <td colspan="6" class="r">TOPLAM (${outputRows.length} kayıt)</td>
    <td class="r m">${outputTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${esc(outputRows[0]?.currency ?? 'TRY')}</td>
  </tr></tfoot>
</table>
<div class="note">Ödemeler yukarıdaki IBAN'lara havale/EFT ile yapılacaktır. Havale gerçekleştikten sonra
panelde ilgili talepler <b>"Ödeme Yapıldı"</b> ile kapatılmalıdır.</div>
<div class="sign"><div>Hazırlayan</div><div>Onaylayan</div><div>Muhasebe / Teslim Alan</div></div>
</body></html>`

    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(frame)
    const doc = frame.contentWindow?.document
    if (!doc) { frame.remove(); return }
    doc.open(); doc.write(html); doc.close()
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 1000)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      // Muhasebeye giden dosya da yalnız ödenebilir satırları taşır (ekrandaki kapsamla aynı).
      await returnsAdminApi.payoutsExport({ ...params, only_payable: scope === 'payable' || undefined })
    } catch {
      setError('CSV indirilemedi.')
    } finally {
      setExporting(false)
    }
  }

  const markSent = async () => {
    if (outputRows.length === 0) return
    const ids = outputRows.map((r) => r.id)
    setMarking(true)
    setError(null)
    try {
      const r = await returnsAdminApi.markAccountingSent(ids)
      setFlash(r.message)
      setSelected(new Set())
      await load()
      setTimeout(() => setFlash(null), 6000)
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'İşaretlenemedi.')
    } finally {
      setMarking(false)
    }
  }

  // ── Ödeme kapanışı ──

  const openSettle = (rowsToSettle: PayoutRow[]) => {
    if (rowsToSettle.length === 0) return
    setSettle({
      rows: rowsToSettle,
      results: Object.fromEntries(rowsToSettle.map((r) => [r.id, { state: 'waiting' } as SettleItem])),
      note: '',
      txn: '',
      running: false,
      done: false,
    })
  }

  /**
   * Talep başına SIRAYLA çalışır (paralel DEĞİL — banka/Ticimax/SMS tarafına tekil akıştaki tempoyla
   * gidilir). Para onayı verilmemiş talepte önce approve-manager çağrılır: bu, havale emrini açar
   * (pending_manual) ve müşteriye onay SMS'i gönderir; ardından mark-transferred talebi kapatır.
   */
  const runSettle = async () => {
    if (!settle || settle.running || settle.done) return
    setSettle((b) => (b ? { ...b, running: true } : b))
    const baseNote = settle.note.trim() || 'Muhasebe havale listesinden ödendi.'

    for (const row of settle.rows) {
      setSettle((b) => (b ? { ...b, results: { ...b.results, [row.id]: { state: 'running' } } } : b))
      try {
        if (row.payment_stage === 'awaiting_approval') {
          await returnsAdminApi.approveManager(row.id, {})
        }
        await returnsAdminApi.markTransferred(row.id, {
          note: baseNote,
          txn: settle.txn.trim() || undefined,
        })
        setSettle((b) => (b ? { ...b, results: { ...b.results, [row.id]: { state: 'ok' } } } : b))
      } catch (e) {
        const err = e as { response?: { data?: { message?: string } } }
        setSettle((b) => (b
          ? { ...b, results: { ...b.results, [row.id]: { state: 'error', message: err.response?.data?.message ?? 'İşlem başarısız.' } } }
          : b))
      }
    }

    setSettle((b) => (b ? { ...b, running: false, done: true } : b))
    setSelected(new Set())
    await load()
  }

  if (!canManager) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto mt-10 p-5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          Havale bölümü müşteri IBAN bilgisi taşıdığı için yalnızca <b>para onayı yetkisi</b> olan
          kullanıcılara açıktır.
          <div className="mt-3">
            <Link to="/returns" className="text-indigo-600 hover:underline">← İade taleplerine dön</Link>
          </div>
        </div>
      </div>
    )
  }

  const activeScope = SCOPES.find((s) => s.key === scope)!
  const settleOk = settle ? Object.values(settle.results).filter((r) => r.state === 'ok').length : 0
  const settleErr = settle ? Object.values(settle.results).filter((r) => r.state === 'error').length : 0

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <Link to="/returns?view=manager" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-1">
            <ArrowLeft size={13} /> Yönetici Ekranı
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Banknote size={20} className="text-amber-600" /> Havale — Kapıda Ödeme İadeleri
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Listeyi yazdırıp muhasebeye iletin; havale yapıldıktan sonra talepleri buradan
            <b> "Ödeme Yapıldı"</b> ile kapatın.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={15} className={clsx(loading && 'animate-spin')} /> Yenile
        </button>
      </div>

      {/* Kapsam sekmeleri */}
      <div className="flex flex-wrap gap-1 mb-2">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition',
              scope === s.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {s.label}
            <span
              className={clsx(
                'min-w-[1.25rem] px-1 py-px rounded-full text-[11px] font-semibold text-center tabular-nums',
                scope === s.key ? 'bg-white/20 text-white' : (res?.counts?.[s.key] ?? 0) > 0 ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-400'
              )}
            >
              {res?.counts?.[s.key] ?? 0}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-4 inline-flex items-center gap-1"><Info size={12} /> {activeScope.hint}</p>

      {/* Özet */}
      {res && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Talep" value={String(res.summary.count)} />
          <StatCard
            label={scope === 'payable' ? 'Ödenecek tutar (IBAN girilmiş)' : 'Toplam tutar'}
            value={fmtMoney(scope === 'payable' ? res.summary.payable_amount : res.summary.amount, res.summary.currency)}
          />
          <StatCard label="IBAN eksik — ödenemez" value={String(res.summary.missing_iban)} tone={res.summary.missing_iban > 0 ? 'danger' : undefined} />
          <StatCard label="Muhasebeye iletilmemiş" value={String(res.summary.not_sent)} tone={res.summary.not_sent > 0 ? 'warn' : undefined} />
        </div>
      )}

      {/* Filtreler + aksiyonlar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={(e) => { e.preventDefault(); setSearch(q) }} className="relative">
            <Search size={16} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Müşteri, talep kodu, sipariş no, IBAN..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md w-72 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </form>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={unsentOnly} onChange={(e) => setUnsentOnly(e.target.checked)} className="rounded border-gray-300" />
            Yalnız iletilmemişler
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={missingIbanOnly} onChange={(e) => setMissingIbanOnly(e.target.checked)} className="rounded border-gray-300" />
            Yalnız IBAN'ı eksikler
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={print}
            disabled={outputRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-black disabled:opacity-40"
          >
            <Printer size={15} /> Yazdır / PDF
          </button>
          <button
            onClick={exportCsv}
            disabled={exporting || outputRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Excel (CSV)
          </button>
          {scope !== 'paid' && (
            <button
              onClick={markSent}
              disabled={marking || outputRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              title="Listenin muhasebeye iletildiğini damgala (para hareketi değildir)"
            >
              {marking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Muhasebeye İletildi
            </button>
          )}
          {scope === 'payable' && (
            <button
              onClick={() => openSettle(outputRows)}
              disabled={outputRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-40"
              title="Havalesi yapılanları kapat"
            >
              <CheckCircle2 size={15} /> Ödeme Yapıldı ({outputRows.length})
            </button>
          )}
        </div>
      </div>

      {/* Kapsam bilgisi — kullanıcı neyin yazdırılacağını/kapatılacağını tereddütsüz görsün */}
      <p className="text-xs text-gray-500 mb-3">
        İşlem kapsamı:{' '}
        <b>{selectedRows.length > 0 ? `${selectedRows.length} seçili talep` : `${outputRows.length} talep`}</b>
        {' '}· Toplam <b>{fmtMoney(outputTotal, res?.summary.currency ?? 'TRY')}</b>
        {blockedCount > 0 && (
          <span className="text-rose-600"> · {blockedCount} talep IBAN'ı olmadığı için kapsam dışı</span>
        )}
      </p>

      {flash && <div className="mb-3 px-4 py-2 bg-emerald-50 text-emerald-800 text-sm rounded-md border border-emerald-200">{flash}</div>}
      {error && <div className="mb-3 px-4 py-2 bg-rose-50 text-rose-700 text-sm rounded-md border border-rose-200">{error}</div>}
      {res?.truncated && (
        <div className="mb-3 px-4 py-2 bg-amber-50 text-amber-800 text-sm rounded-md border border-amber-200 flex items-center gap-2">
          <AlertTriangle size={15} />
          Ekranda ilk {res.limit} kayıt gösteriliyor (toplam {res.summary.count}). Tam liste için CSV indirin.
        </div>
      )}

      {/* Liste */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              <th className="pl-4 pr-1 py-2.5 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id))}
                  onChange={toggleAll}
                  title="Ödenebilir olanların tümünü seç"
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Talep / Sipariş</th>
              <th className="px-4 py-2.5 font-medium">Müşteri</th>
              <th className="px-4 py-2.5 font-medium">Havale Hesabı</th>
              <th className="px-4 py-2.5 font-medium text-right">Tutar</th>
              <th className="px-4 py-2.5 font-medium">Durum</th>
              <th className="px-4 py-2.5 font-medium">Muhasebe</th>
              {scope === 'payable' && <th className="px-4 py-2.5 font-medium w-36">İşlem</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Yükleniyor…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  <div className="font-medium text-gray-700">Bu kapsamda talep yok.</div>
                  {scope === 'payable' && (res?.counts?.pipeline ?? 0) > 0 && (
                    <div className="text-sm mt-1">
                      Kapıda ödemeli {res?.counts.pipeline} talep hâlâ kargo sürecinde —{' '}
                      <button onClick={() => setScope('pipeline')} className="text-indigo-600 hover:underline">o sekmeye bak</button>.
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={clsx('hover:bg-gray-50', selected.has(r.id) && 'bg-indigo-50/40')}>
                  <td className="pl-4 pr-1 py-3 align-top">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 disabled:opacity-30"
                      checked={selected.has(r.id)}
                      disabled={scope === 'payable' && !r.payable}
                      title={scope === 'payable' && !r.payable ? 'IBAN girilmeden ödeme yapılamaz' : undefined}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <Link to={`/returns/${r.id}`} className="font-mono text-indigo-600 hover:underline">{r.public_code}</Link>
                    <div className="text-xs text-gray-500 mt-0.5">{r.order_no ?? '—'}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{r.type_label} · {r.created_at}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-gray-900">{r.customer_name ?? '—'}</div>
                    <div className="text-xs text-gray-500">{r.customer_phone ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {r.iban ? (
                      <>
                        <div className="text-gray-900 inline-flex items-center gap-1">
                          <Landmark size={12} className="text-gray-400" /> {r.account_holder ?? '—'}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="font-mono text-xs text-gray-700">{fmtIban(r.iban)}</span>
                          <button onClick={() => copyIban(r)} title="IBAN'ı kopyala" className="text-gray-400 hover:text-gray-700">
                            {copied === r.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                          </button>
                        </div>
                        {r.bank_name && <div className="text-[11px] text-gray-400">{r.bank_name}</div>}
                      </>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                        <AlertTriangle size={12} /> IBAN yok
                        <Link to={`/returns/${r.id}`} className="underline">talepten gir</Link>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                    <div className="tabular-nums font-medium text-gray-900">{fmtMoney(r.amount, r.currency)}</div>
                    {r.cod_fee > 0 && (
                      <div className="text-[11px] text-gray-400 mt-0.5" title="Kapıda ödeme hizmet bedeli — iade tutarına dâhil değildir">
                        + {fmtMoney(r.cod_fee, r.currency)} hizmet bedeli (iade edilmez)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', statusBadgeClass(r.status))}>
                      {r.status_label}
                    </span>
                    {r.payment_stage === 'awaiting_approval' && (
                      <div className="text-[11px] text-amber-700 mt-1">Para onayı ödeme anında verilecek</div>
                    )}
                    {r.manager_approved_at && (
                      <div className="text-[11px] text-gray-400 mt-1">Para onayı: {r.manager_approved_at}</div>
                    )}
                    {r.transfer_txn && <div className="text-[11px] text-gray-500 mt-0.5">Dekont: {r.transfer_txn}</div>}
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    {r.accounting?.sent_at ? (
                      <div className="text-xs text-emerald-700">
                        <div className="inline-flex items-center gap-1"><Check size={12} /> İletildi</div>
                        <div className="text-[11px] text-gray-400">{r.accounting.sent_at}</div>
                        {r.accounting.batch && <div className="text-[11px] text-gray-400">Parti: {r.accounting.batch}</div>}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  {scope === 'payable' && (
                    <td className="px-4 py-3 align-top">
                      {r.payable ? (
                        <button
                          onClick={() => openSettle([r])}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                        >
                          <CheckCircle2 size={13} /> Ödeme Yapıldı
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400">IBAN bekleniyor</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Ödeme kapanışı penceresi */}
      {settle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 inline-flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600" /> Ödeme Yapıldı — {settle.rows.length} talep kapatılacak
              </h3>
              {!settle.running && (
                <button onClick={() => { setSettle(null) }} className="text-gray-400 hover:text-gray-700"><XCircle size={18} /></button>
              )}
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3">
              {!settle.done && (
                <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Toplam <b>{fmtMoney(settle.rows.reduce((s, r) => s + r.amount, 0), settle.rows[0]?.currency)}</b> tutarındaki
                  havalenin <b>bankadan yapılmış olduğunu</b> onaylıyorsunuz. Her talep kapanır (iade tamamlandı),
                  Ticimax sipariş statüsü güncellenir ve müşteriye bilgilendirme SMS'i gider.
                  {settle.rows.some((r) => r.payment_stage === 'awaiting_approval') && (
                    <div className="mt-1">
                      Para onayı verilmemiş {settle.rows.filter((r) => r.payment_stage === 'awaiting_approval').length} talepte
                      onay bu işlemle birlikte otomatik verilir.
                    </div>
                  )}
                </div>
              )}

              {!settle.done && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-gray-600">Dekont / referans no <span className="text-gray-400">(opsiyonel)</span></span>
                    <input
                      value={settle.txn}
                      onChange={(e) => setSettle((b) => (b ? { ...b, txn: e.target.value } : b))}
                      disabled={settle.running}
                      className="mt-1 w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-gray-600">Açıklama <span className="text-gray-400">(opsiyonel)</span></span>
                    <input
                      value={settle.note}
                      onChange={(e) => setSettle((b) => (b ? { ...b, note: e.target.value } : b))}
                      placeholder="Muhasebe havale listesinden ödendi."
                      disabled={settle.running}
                      className="mt-1 w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                  </label>
                </div>
              )}

              <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                {settle.rows.map((r) => {
                  const st = settle.results[r.id]
                  return (
                    <div key={r.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span className="font-mono text-gray-700">{r.public_code}</span>
                        <span className="text-gray-400"> · {r.customer_name}</span>
                        {st?.message && <div className="text-xs text-rose-600 mt-0.5">{st.message}</div>}
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="tabular-nums text-gray-700">{fmtMoney(r.amount, r.currency)}</span>
                        {st?.state === 'running' && <Loader2 size={14} className="animate-spin text-gray-500" />}
                        {st?.state === 'ok' && <CheckCircle2 size={14} className="text-emerald-600" />}
                        {st?.state === 'error' && <XCircle size={14} className="text-rose-600" />}
                      </div>
                    </div>
                  )
                })}
              </div>

              {settle.done && (
                <div className={clsx('text-sm rounded-md px-3 py-2 border',
                  settleErr > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800')}>
                  {settleOk} talep kapatıldı{settleErr > 0 ? `, ${settleErr} talep işlenemedi (yukarıdaki hata mesajlarına bakın).` : '.'}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              {settle.done ? (
                <button onClick={() => setSettle(null)} className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-black">Kapat</button>
              ) : (
                <>
                  <button
                    onClick={() => setSettle(null)}
                    disabled={settle.running}
                    className="px-4 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={runSettle}
                    disabled={settle.running}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {settle.running ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    {settle.running ? 'İşleniyor…' : 'Onayla ve Kapat'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warn' }) {
  return (
    <div
      className={clsx(
        'px-4 py-3 rounded-lg border bg-white',
        tone === 'danger' ? 'border-rose-200 bg-rose-50' : tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-gray-200'
      )}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={clsx('text-lg font-semibold mt-0.5', tone === 'danger' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900')}>
        {value}
      </div>
    </div>
  )
}
