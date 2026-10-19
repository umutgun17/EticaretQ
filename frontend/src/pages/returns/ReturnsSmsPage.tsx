import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  MessageSquareText, RefreshCw, Search, CheckCircle2, XCircle, Clock, Save, RotateCcw, AlertTriangle, Power,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/contexts/AuthContext'
import {
  returnsAdminApi,
  type ReturnSmsLogRow,
  type ReturnSmsSettings,
  type ReturnSmsEventSetting,
} from '@/lib/returnsAdminApi'

/**
 * İade Yönetimi → SMS Yönetimi: iade akışında müşteriye giden TÜM SMS'ler buradan yönetilir —
 * olay bazlı aç/kapa + şablon düzenleme ({değişken}'li) + gönderim geçmişi (dry-run/hata dahil).
 * Şablonlar akış bölümlerine göre gruplanır; her şablonda karakter sayacı vardır (Türkçe
 * karakterli gönderimde tek SMS = 155 karakter; aşımı 2 SMS olarak ücretlendirilir).
 */

/**
 * Tek SMS karakter sınırı — Türkçe karakterli (encoding=TR) gönderimde GSM standardı gereği
 * ş, Ş, ğ, Ğ, ı, İ harfleri 2 karakter yer kaplar; güvenli tek-SMS sınırı ~150'dir
 * (24 Tem 2026 canlı fatura testiyle doğrulandı).
 */
const SMS_CHAR_LIMIT = 150

/** GSM ağırlıklı uzunluk: ş/Ş/ğ/Ğ/ı/İ = 2, diğerleri 1 karakter. */
const smsLength = (text: string): number =>
  [...text].reduce((n, c) => n + ('şŞğĞıİ'.includes(c) ? 2 : 1), 0)

/** Şablon grupları: ilişkili olaylar bir arada görünür. Listede olmayan yeni olaylar "Diğer"e düşer. */
const EVENT_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Talep & İptal', keys: ['submitted', 'cancel_processing'] },
  { title: 'Kargo Süreci', keys: ['cargo_code', 'in_transit', 'received', 'expired'] },
  { title: 'Kusur Bildirimi', keys: ['defect_approved', 'defect_rejected'] },
  { title: 'Onay / Red & Ödeme', keys: ['approved', 'rejected', 'refunded'] },
]
export default function ReturnsSmsPage() {
  const { user } = useAuth()
  const canEdit = !!user?.can_manager_approve_returns
  const [searchParams] = useSearchParams()
  void searchParams

  // ── Ayarlar ──
  const [settings, setSettings] = useState<ReturnSmsSettings | null>(null)
  const [drafts, setDrafts] = useState<ReturnSmsEventSetting[]>([])
  const [globalEnabled, setGlobalEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // ── Geçmiş ──
  const [rows, setRows] = useState<ReturnSmsLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [event, setEvent] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')

  const loadSettings = useCallback(async () => {
    const s = await returnsAdminApi.smsSettings()
    setSettings(s)
    // Şablon alanı boş placeholder yerine VARSAYILAN metinle dolu gelir → tenant mevcut metin
    // üzerinden küçük değişiklik yapabilir. Varsayılanla birebir aynı kalan şablonu backend
    // zaten saklamaz (null'a düşer) — kayıt şişmez.
    setDrafts(s.events.map((e) => ({ ...e, template: e.template ?? e.default_template })))
    setGlobalEnabled(s.enabled)
  }, [])

  const loadLog = useCallback(async () => {
    setLoading(true)
    try {
      const res = await returnsAdminApi.smsLog({
        event: event || undefined,
        status: status || undefined,
        q: search || undefined,
        page,
      })
      setRows(res.data)
      setLastPage(res.last_page)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [event, status, search, page])

  useEffect(() => {
    loadSettings().catch(() => {})
  }, [loadSettings])
  useEffect(() => {
    loadLog()
  }, [loadLog])

  const setDraft = (key: string, patch: Partial<ReturnSmsEventSetting>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  const save = async () => {
    setSaving(true)
    setSaveMsg(null)
    setSaveErr(null)
    try {
      const s = await returnsAdminApi.saveSmsSettings({
        enabled: globalEnabled,
        events: drafts.map((d) => ({ key: d.key, enabled: d.enabled, template: d.template })),
      })
      setSettings(s)
      setDrafts(s.events.map((e) => ({ ...e })))
      setGlobalEnabled(s.enabled)
      setSaveMsg('Ayarlar kaydedildi.')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } }
      setSaveErr(err.response?.data?.message ?? 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(q)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
          <MessageSquareText size={22} /> SMS Yönetimi
        </h1>
        <button
          onClick={() => {
            loadSettings().catch(() => {})
            loadLog()
          }}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <RefreshCw size={15} /> Yenile
        </button>
      </div>

      {/* ── Genel durum + şablonlar ── */}
      {settings && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className={clsx('inline-flex items-center gap-2 text-sm', canEdit ? 'cursor-pointer' : 'opacity-60')}>
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  disabled={!canEdit}
                  onChange={(e) => setGlobalEnabled(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600"
                />
                <Power size={14} className={globalEnabled ? 'text-emerald-600' : 'text-rose-500'} />
                SMS gönderimi {globalEnabled ? 'açık' : 'KAPALI'}
              </label>
              {settings.dry_run && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                  <AlertTriangle size={12} /> dry-run modunda — SMS'ler gerçekte gönderilmiyor
                </span>
              )}
              <span className="text-xs text-gray-500">
                Başlık: <span className="font-mono">{settings.msgheader ?? '—'}</span>
              </span>
            </div>
            {canEdit && (
              <div className="flex items-center gap-3">
                {saveMsg && <span className="text-xs text-emerald-600">{saveMsg}</span>}
                {saveErr && <span className="text-xs text-rose-600">{saveErr}</span>}
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Save size={14} /> Kaydet
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 mb-2">
            Şablon değişkenleri: {settings.placeholders.map((p) => (
              <code key={p} className="mx-0.5 px-1 py-0.5 bg-gray-100 rounded text-[11px]">{p}</code>
            ))}
            — boş bırakılan şablon varsayılan metniyle gönderilir.
          </p>
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-4">
            SMS'ler Türkçe karakterli gönderilir; tek SMS <b>{SMS_CHAR_LIMIT} karakterdir</b> (ş, ğ, ı, İ harfleri
            2 karakter sayılır — sayaç buna göre hesaplar). Sınır aşılırsa mesaj yine gönderilir ancak
            <b> 2 SMS olarak ücretlendirilir</b>. Değişkenler ({'{ad}'}, {'{takip}'} vb.) doldurulduğunda metin
            uzayabileceği için sınıra pay bırakmanız önerilir.
          </p>

          {(() => {
            const grouped = new Set(EVENT_GROUPS.flatMap((g) => g.keys))
            const leftovers = drafts.filter((d) => !grouped.has(d.key))
            const sections = [
              ...EVENT_GROUPS
                .map((g) => ({ title: g.title, items: g.keys.map((k) => drafts.find((d) => d.key === k)).filter(Boolean) as typeof drafts }))
                .filter((s) => s.items.length > 0),
              ...(leftovers.length > 0 ? [{ title: 'Diğer', items: leftovers }] : []),
            ]
            return sections.map((section) => (
              <div key={section.title} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{section.title}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {section.items.map((d) => {
                    const effective = (d.template ?? '') !== '' ? (d.template as string) : d.default_template
                    const len = smsLength(effective)
                    const over = len > SMS_CHAR_LIMIT
                    return (
                      <div key={d.key} className={clsx('border rounded-lg p-3', d.enabled ? 'border-gray-200' : 'border-gray-200 bg-gray-50 opacity-75')}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-gray-800">{d.label}</div>
                          <label className={clsx('inline-flex items-center gap-1.5 text-xs', canEdit ? 'cursor-pointer' : 'opacity-60')}>
                            <input
                              type="checkbox"
                              checked={d.enabled}
                              disabled={!canEdit}
                              onChange={(e) => setDraft(d.key, { enabled: e.target.checked })}
                              className="w-3.5 h-3.5 accent-indigo-600"
                            />
                            {d.enabled ? 'Açık' : 'Kapalı'}
                          </label>
                        </div>
                        <textarea
                          value={d.template ?? ''}
                          placeholder={d.default_template}
                          disabled={!canEdit}
                          onChange={(e) => setDraft(d.key, { template: e.target.value || null })}
                          rows={3}
                          className="w-full text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50"
                        />
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {d.template !== null && d.template !== '' && d.template !== d.default_template && canEdit ? (
                            <button
                              onClick={() => setDraft(d.key, { template: d.default_template })}
                              className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
                            >
                              <RotateCcw size={11} /> Varsayılana dön
                            </button>
                          ) : <span />}
                          <span className="text-[11px] tabular-nums text-gray-400">
                            {len}/{SMS_CHAR_LIMIT}{over && ' — 2 SMS ücreti'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          })()}
        </div>
      )}

      {/* ── Gönderim geçmişi ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Gönderim Geçmişi</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={event}
            onChange={(e) => {
              setPage(1)
              setEvent(e.target.value)
            }}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5"
          >
            <option value="">Tüm olaylar</option>
            {(settings?.events ?? []).map((ev) => (
              <option key={ev.key} value={ev.key}>{ev.label}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5"
          >
            <option value="">Tüm durumlar</option>
            <option value="sent">Gönderildi</option>
            <option value="not_sent">Gönderilmedi (dry-run/kapalı)</option>
            <option value="error">Hatalı</option>
          </select>
          <form onSubmit={submitSearch} className="relative">
            <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kod, müşteri, telefon..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md w-56 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </form>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">Tarih</th>
              <th className="px-4 py-2.5 font-medium">Talep</th>
              <th className="px-4 py-2.5 font-medium">Olay</th>
              <th className="px-4 py-2.5 font-medium">Telefon</th>
              <th className="px-4 py-2.5 font-medium">Durum</th>
              <th className="px-4 py-2.5 font-medium">Mesaj</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">Yükleniyor...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  <MessageSquareText className="mx-auto mb-2 text-gray-300" size={28} />
                  SMS kaydı bulunamadı.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{r.created_at?.slice(0, 16) ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.request ? (
                      <>
                        <Link to={`/returns/${r.request.id}`} className="text-indigo-600 hover:underline font-medium">
                          {r.request.public_code}
                        </Link>
                        <div className="text-[11px] text-gray-500">{r.request.customer_name ?? ''}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">{r.event_label}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600 font-mono text-xs">
                    {r.request?.customer_phone ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.sent ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={13} /> Gönderildi
                      </span>
                    ) : r.error ? (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-600" title={r.error}>
                        <XCircle size={13} /> Hata
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <Clock size={13} /> {r.event_disabled ? 'Olay kapalı' : 'Gönderilmedi'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-md">
                    <div className="line-clamp-2 text-xs" title={r.message ?? undefined}>{r.message ?? '—'}</div>
                    {r.error && <div className="text-[11px] text-rose-600 mt-0.5">{r.error}</div>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
        <div>{total} kayıt</div>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1 border rounded disabled:opacity-40">
            Önceki
          </button>
          <span>
            {page} / {lastPage}
          </span>
          <button disabled={page >= lastPage} onClick={() => setPage((p) => Math.min(lastPage, p + 1))} className="px-3 py-1 border rounded disabled:opacity-40">
            Sonraki
          </button>
        </div>
      </div>
    </div>
  )
}
