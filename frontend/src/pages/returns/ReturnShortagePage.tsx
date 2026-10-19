import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  PackageX, Search, Loader2, AlertTriangle, CheckCircle2, ExternalLink, Banknote, CreditCard, Info as InfoIcon,
  ShieldCheck, Gift, MessageSquareText, ArrowLeft, XCircle, Undo2, BellOff,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/contexts/AuthContext'
import {
  returnsAdminApi,
  fmtMoney,
  type ShortageLookupResponse,
  type ShortagePreviewResponse,
  type ShortageCreateResponse,
  type ShortageMode,
} from '@/lib/returnsAdminApi'

/**
 * EKSİK / HATALI ÜRÜN İADESİ — PERSONEL EKRANI (kullanıcı talebi 2026-09-23).
 *
 * Depo siparişi çıkaramıyor (eksik ürün / hatalı ürün / stok hatası), müşteri aranır; yeni ürün
 * istemezse personel burada siparişi bulur (sipariş no VEYA Ticimax sipariş ID), gönderilemeyen
 * ürünü seçer, neden girer → iade tutarı sunucuda hesaplanır → talep yönetici PARA onayı
 * kuyruğuna düşer. Kalan ürünler normal kargolanır; Ticimax sipariş statüsü değişmez (yalnız
 * seçim siparişin tamamıysa iptal). Onayda karta iade + müşteriye özür SMS'i + özel kupon.
 *
 * 2026-09-25 — İKİNCİ SENARYO (aynı ekran, sipariş durumundan otomatik): sipariş KARGODA / TESLİM EDİLMİŞ ve
 * müşteri paketin eksik/hatalı geldiğini bildirdi (personel inceledi). Aynı para akışı + aynı kupon; AMA
 * Ticimax'a hiçbir yazma yok, SMS daha genel bir özür metni; kargo ücreti tam kapsamda iade edilir.
 *
 * Müşteriye açık DEĞİLDİR; sayfa izni `returns_shortage` (Personel Yönetimi → İade) gerekir, firma admini otomatik.
 *
 * 2026-10-05 — AYNI EKRAN, `mode="returned"` → GERİ DÖNEN SİPARİŞ İADESİ (/returns/returned, izin `returns_returned`):
 * firmadan çıkan paket teslim edilemeyip depoya geri döndü. Aynı para akışı (yönetici para onayı) AMA müşteriye
 * hiçbir bildirim gitmez (SMS/kupon yok) ve onay sonrası (tam kapsamda) Ticimax sipariş statüsü İptal yapılır.
 */
type Sel = { qty: number; reason_code: string; reason_note: string }

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-rose-400'

export default function ReturnShortagePage({ mode = 'shortage' }: { mode?: ShortageMode }) {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const returned = mode === 'returned'
  const canStaff = hasPermission(returned ? 'returns_returned' : 'returns_shortage')

  const [ref, setRef] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [data, setData] = useState<ShortageLookupResponse | null>(null)

  const [sel, setSel] = useState<Record<string, Sel>>({})
  const [staffNote, setStaffNote] = useState('')
  const [preview, setPreview] = useState<ShortagePreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<ShortageCreateResponse | null>(null)

  const selectedLines = useMemo(
    () => Object.entries(sel).filter(([, s]) => s.qty > 0).map(([line_id, s]) => ({ line_id, ...s })),
    [sel]
  )
  const allReasonsChosen = selectedLines.every((s) => !!s.reason_code)

  const doLookup = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = ref.trim()
    if (!q) return
    setLooking(true)
    setLookupError(null)
    setData(null)
    setSel({})
    setPreview(null)
    setResult(null)
    setStaffNote('')
    try {
      setData(await returnsAdminApi.shortageLookup(q, mode))
    } catch (err) {
      const e2 = err as { response?: { data?: { message?: string } } }
      setLookupError(e2.response?.data?.message ?? 'Sipariş sorgulanamadı.')
    } finally {
      setLooking(false)
    }
  }

  // Seçim değişince sunucu hesabını tazele (küçük gecikmeyle — her tıkta istek atma)
  useEffect(() => {
    if (!data || selectedLines.length === 0) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    const t = setTimeout(async () => {
      setPreviewing(true)
      setPreviewError(null)
      try {
        setPreview(await returnsAdminApi.shortagePreview(
          data.order.platform_order_id,
          selectedLines.map((s) => ({ line_id: s.line_id, qty: s.qty })),
          mode
        ))
      } catch (err) {
        const e2 = err as { response?: { data?: { message?: string } } }
        setPreviewError(e2.response?.data?.message ?? 'Tutar hesaplanamadı.')
        setPreview(null)
      } finally {
        setPreviewing(false)
      }
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.order.platform_order_id, JSON.stringify(selectedLines.map((s) => [s.line_id, s.qty]))])

  const toggleLine = (lineId: string, maxQty: number) =>
    setSel((p) => {
      const next = { ...p }
      if (next[lineId]?.qty > 0) delete next[lineId]
      else next[lineId] = { qty: maxQty >= 1 ? 1 : 0, reason_code: '', reason_note: '' }
      return next
    })
  const setLine = (lineId: string, patch: Partial<Sel>) =>
    setSel((p) => ({ ...p, [lineId]: { ...(p[lineId] ?? { qty: 1, reason_code: '', reason_note: '' }), ...patch } }))

  const submit = async () => {
    if (!data || selectedLines.length === 0 || !allReasonsChosen) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await returnsAdminApi.shortageCreate({
        platform_order_id: data.order.platform_order_id,
        items: selectedLines.map((s) => ({
          line_id: s.line_id,
          qty: s.qty,
          reason_code: s.reason_code,
          reason_note: s.reason_note.trim() || undefined,
        })),
        staff_note: staffNote.trim() || undefined,
      }, mode)
      setResult(res)
      setConfirm(false)
    } catch (err) {
      const e2 = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      const errs = e2.response?.data?.errors
      setSubmitError(e2.response?.data?.message ?? (errs ? Object.values(errs).flat().join(' ') : 'Talep oluşturulamadı.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canStaff) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          Bu ekran için yetkiniz yok. Firma yöneticiniz Personel Yönetimi → İade → "{returned ? 'Geri Dönen Sipariş İadesi' : 'Eksik / Hatalı Ürün İadesi'}" iznini verebilir.
        </div>
      </div>
    )
  }

  const order = data?.order
  const canCreate = !!data?.eligibility.can_create
  const isCod = !!data?.payment.cod
  const delivered = data?.stage === 'delivered'
  // Geri dönen siparişte paket bütün olarak döner → sipariş gelince tüm kalemler tam adetle seçili başlasın.
  const selectAll = () => {
    if (!data) return
    setSel((p) => {
      const next: Record<string, Sel> = {}
      for (const it of data.order.items) {
        if (it.qty_available >= 1) next[it.line_id] = { qty: it.qty_available, reason_code: p[it.line_id]?.reason_code ?? '', reason_note: p[it.line_id]?.reason_note ?? '' }
      }
      return next
    })
  }
  const setAllReasons = (code: string) => setSel((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, reason_code: code }])))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/returns" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> İade / İptal Talepleri
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
            {returned ? <Undo2 size={22} className="text-teal-600" /> : <PackageX size={22} className="text-rose-600" />} {returned ? 'Geri Dönen Sipariş İadesi' : 'Eksik / Hatalı Ürün İadesi'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {returned
              ? 'Bizden çıkan ama müşteriye teslim edilemeyip depoya geri dönen siparişler için.'
              : 'Bizim hatamızla eksik, hatalı ya da yanlış giden / gönderilemeyen ürünler için.'}
          </p>
        </div>
      </div>

      {/* Nasıl kullanılır — madde madde, kısa (kullanıcı isteği 2026-10-05) */}
      <div className={clsx('rounded-lg border p-4 mb-5', returned ? 'border-teal-200 bg-teal-50' : 'border-rose-200 bg-rose-50')}>
        <div className={clsx('text-sm font-bold mb-2 flex items-center gap-1.5', returned ? 'text-teal-900' : 'text-rose-900')}>
          <InfoIcon size={15} /> Nasıl kullanılır?
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-gray-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Ne zaman kullanılır</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {(returned ? [
                'Paket kargoya verildi ama müşteriye teslim edilemedi.',
                'Paket depoya geri döndü (teslim alınmadı, reddedildi, adres hatalı).',
                'Henüz kargoya verilmemiş sipariş için burası değil, "Eksik / Hatalı Ürün İadesi" kullanılır.',
              ] : [
                'Gönderim öncesi: depo ürünü çıkaramıyor (eksik, hatalı, stok hatası) ve müşteri başka ürün istemiyor.',
                'Teslimat sonrası: müşteri paketin eksik, hatalı ya da yanlış ürünle geldiğini bildirdi ve kontrol ettiniz.',
                'Paket teslim edilemeyip depoya döndüyse burası değil, "Geri Dönen Sipariş İadesi" kullanılır.',
              ]).map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Adımlar</div>
            <ol className="list-decimal pl-5 space-y-0.5">
              {(returned ? [
                'Sipariş numarasını yazın, "Siparişi Getir"e basın.',
                'Geri dönen ürünleri seçin (paketin tamamı döndüyse "Tümünü seç").',
                'Her ürün için nedeni seçin, isterseniz not yazın.',
                '"Geri Dönen Sipariş İadesini Başlat"a basın.',
              ] : [
                'Sipariş numarasını yazın, "Siparişi Getir"e basın.',
                'Sorunlu ürünü ve adedini seçin.',
                'Her ürün için nedeni seçin, isterseniz not yazın.',
                '"İadeyi Başlat"a basın.',
              ]).map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Sonra ne olur</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {(returned ? [
                'Kayıt yöneticinin "Geri Dönen Sipariş (Personel)" sekmesine düşer.',
                'Yönetici onaylayınca para müşterinin kartına iade edilir.',
                'Siparişin tamamı seçildiyse Ticimax\'ta sipariş İptal olur.',
                'Müşteriye SMS ya da kupon gitmez.',
                'Kapıda ödemeli siparişte para iadesi olmaz; kayıt hemen kapanır.',
              ] : [
                'Talep yöneticinin "Eksik/Hatalı Ürün (Personel)" sekmesine düşer.',
                'Yönetici onaylayınca para müşterinin kartına iade edilir.',
                'Müşteriye özür SMS\'i ve indirim kuponu gider.',
                'Siparişin tamamı iade ediliyorsa kargo ücreti de iade edilir.',
                'Gönderim öncesinde kalan ürünler normal kargolanır; tamamı seçilirse sipariş Ticimax\'ta iptal olur.',
                'Kapıda ödemeli siparişte karta iade olmaz; talep hemen kapanır, SMS ve kupon yine gider.',
              ]).map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        </div>
      </div>

      {/* Sipariş arama */}
      <form onSubmit={doLookup} className="bg-white rounded-lg border border-gray-200 p-4 mb-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">Sipariş No veya Ticimax Sipariş ID</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-3 text-gray-400" />
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Örn: TB3479766261 veya 676954"
              className={clsx(inputCls, 'pl-9')}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={looking || !ref.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-black disabled:opacity-50"
          >
            {looking ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Siparişi Getir
          </button>
        </div>
        {lookupError && (
          <div className="mt-3 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-sm text-rose-700">{lookupError}</div>
        )}
      </form>

      {/* SONUÇ EKRANI */}
      {result && (
        <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-5 mb-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={24} className="text-emerald-600 shrink-0" />
            <div className="flex-1">
              <div className="text-base font-semibold text-emerald-900">
                Talep oluşturuldu: <span className="font-mono">{result.public_code}</span>
              </div>
              <p className="text-sm text-emerald-800 mt-1">{result.message}</p>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-gray-500">İade tutarı</div><div className="font-semibold text-gray-900">{fmtMoney(result.requested_amount, result.currency)}</div></div>
                <div><div className="text-xs text-gray-500">Durum</div><div className="font-semibold text-gray-900">{result.status_label}</div></div>
                <div><div className="text-xs text-gray-500">Senaryo</div><div className="font-semibold text-gray-900">{result.stage === 'returned' ? 'Geri dönen sipariş' : result.stage === 'delivered' ? 'Teslimat sonrası' : 'Gönderim öncesi'}{result.is_full ? ' · tamamı' : ' · kısmi'}</div></div>
                <div><div className="text-xs text-gray-500">Sonraki adım</div><div className="font-semibold text-gray-900">{result.refund_method === 'none' ? 'Tamamlandı' : 'Yönetici para onayı'}</div></div>
              </div>
              <TicimaxSummary ticimax={result.ticimax} />
              {returned && (
                <div className="mt-3 text-xs text-emerald-900 flex items-center gap-1.5"><BellOff size={13} /> Müşteriye bildirim gönderilmedi (SMS / kupon yok).</div>
              )}
              {result.settled && !returned && (
                <div className="mt-3 text-xs text-emerald-900 space-y-1">
                  {result.settled.coupon && (
                    <div className="flex items-center gap-1.5"><Gift size={13} /> Özür kuponu: <b className="font-mono">{result.settled.coupon.code}</b> ({fmtMoney(result.settled.coupon.amount, result.currency)}){result.settled.coupon.dry_run ? ' — dry-run' : ''}</div>
                  )}
                  <div className="flex items-center gap-1.5"><MessageSquareText size={13} /> SMS: {result.settled.sms.sent ? 'gönderildi' : result.settled.sms.dry_run ? 'dry-run (gönderilmedi)' : 'gönderilemedi'}</div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => navigate(`/returns/${result.id}`)} className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700">
                  Talebi Aç
                </button>
                <button onClick={() => { setResult(null); setData(null); setRef(''); setSel({}) }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">
                  Yeni İşlem
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {order && !result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Sol: sipariş + kalemler */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <div className="text-sm text-gray-500">Sipariş</div>
                  <div className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    {order.order_no ?? '—'}
                    {order.admin_url && (
                      <a href={order.admin_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800" title="Ticimax panelde aç">
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">ID: {order.platform_order_id} · {order.order_date?.slice(0, 16).replace('T', ' ')}</div>
                </div>
                <div className="text-right">
                  <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{order.status_label ?? order.status}</span>
                  <div className="mt-1">
                    <span className={clsx('inline-flex items-center gap-1 px-1.5 py-px rounded text-[11px] font-medium', isCod ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600')}>
                      {isCod ? <Banknote size={11} /> : <CreditCard size={11} />}
                      {isCod ? 'Kapıda Ödeme' : 'Kartlı / Online'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-gray-400">Müşteri</div><div className="text-gray-900">{order.customer_name ?? '—'}</div></div>
                <div><div className="text-xs text-gray-400">Telefon</div><div className="text-gray-900">{order.customer_phone ?? '—'}</div></div>
                <div><div className="text-xs text-gray-400">Ödenen</div><div className="text-gray-900 tabular-nums">{fmtMoney(order.paid_amount, order.currency)}</div></div>
                <div><div className="text-xs text-gray-400">Kargo</div><div className="text-gray-900">{order.cargo_company ?? '—'}{order.cargo_tracking_no ? ` · ${order.cargo_tracking_no}` : ''}</div></div>
              </div>
              {!order.customer_phone && !returned && (
                <p className="mt-2 text-xs text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> Siparişte telefon yok — özür SMS'i gönderilemez.</p>
              )}
            </div>

            {/* Senaryo (aşama) rozeti */}
            {data!.stage === 'returned' && (
              <div className="rounded-lg border border-teal-300 bg-teal-50 text-teal-900 p-3 text-sm flex items-start gap-2">
                <Undo2 size={16} className="shrink-0 mt-0.5" />
                <div>
                  <b>Geri dönen sipariş — paket teslim edilemedi, depoya döndü</b>
                  <div className="text-xs mt-0.5 opacity-90">
                    Geri dönen ürünleri seçin (paketin tamamı döndüyse "Tümünü seç"). Müşteriye bildirim gitmez; yönetici onayından sonra
                    para karta iade edilir ve siparişin tamamı seçildiyse Ticimax'ta statü İptal yapılır.
                  </div>
                </div>
              </div>
            )}
            {data!.stage && data!.stage !== 'returned' && (
              <div className={clsx('rounded-lg border p-3 text-sm flex items-start gap-2', delivered ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-rose-200 bg-rose-50 text-rose-900')}>
                <InfoIcon size={16} className="shrink-0 mt-0.5" />
                <div>
                  <b>{delivered ? 'Teslimat sonrası eksik / hatalı ürün bildirimi' : 'Gönderim öncesi — depo siparişi çıkaramadı'}</b>
                  <div className="text-xs mt-0.5 opacity-90">
                    {delivered
                      ? 'Sipariş kargoda / teslim edilmiş. Müşterinin bildirdiği, incelemede doğrulanan ürünü seçin. Ticimax\'ta statü veya kalem güncellenmez. Siparişin tamamı iade edilirse kargo ücreti de iadeye eklenir.'
                      : 'Sipariş henüz gönderilmemiş. Gönderilemeyen ürünü seçin; kalan ürünler normal kargolanır, sipariş statüsü değişmez (tamamı seçilirse iptal).'}
                  </div>
                </div>
              </div>
            )}

            {/* Uygunluk / uyarılar */}
            {!canCreate && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <div className="font-semibold flex items-center gap-1.5 mb-1"><XCircle size={16} /> Bu sipariş için işlem yapılamıyor</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {data!.eligibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {data!.warnings.map((w, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {w}
              </div>
            ))}
            {data!.existing.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700 mb-1">Bu siparişteki önceki talepler</div>
                <ul className="space-y-0.5">
                  {data!.existing.map((x) => (
                    <li key={x.id}>
                      <Link to={`/returns/${x.id}`} className="text-indigo-600 hover:underline font-mono">{x.public_code}</Link>
                      {' '}— {x.type_label} · {x.status_label} · {fmtMoney(x.amount, order.currency)} · {x.created_at}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Kalemler */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">{returned ? 'Geri dönen ürünleri seçin' : delivered ? 'Eksik / hatalı gelen ürünü seçin' : 'Gönderilemeyen ürünü seçin'}</h2>
                <div className="flex items-center gap-2">
                  {returned && canCreate && (
                    <>
                      <button type="button" onClick={selectAll} className="text-xs px-2 py-1 rounded border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100">Tümünü seç</button>
                      {selectedLines.length > 1 && (
                        <select value="" onChange={(e) => e.target.value && setAllReasons(e.target.value)} className="text-xs px-1.5 py-1 border border-gray-300 rounded" title="Seçili tüm ürünlere aynı nedeni uygula">
                          <option value="">Hepsine neden…</option>
                          {Object.entries(data!.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      )}
                    </>
                  )}
                  <span className="text-xs text-gray-400">{selectedLines.length} kalem seçili</span>
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {order.items.map((it) => {
                  const s = sel[it.line_id]
                  const checked = !!s && s.qty > 0
                  const disabled = !canCreate || it.qty_available < 1
                  return (
                    <li key={it.line_id} className={clsx('px-4 py-3', checked && 'bg-rose-50/60', disabled && 'opacity-60')}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 rounded border-gray-300 text-rose-600"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleLine(it.line_id, it.qty_available)}
                        />
                        {it.image_url ? (
                          <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover border border-gray-200 shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded bg-gray-100 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{it.name ?? it.sku ?? it.line_id}</div>
                          <div className="text-xs text-gray-500">
                            {[it.variant_info, it.sku, it.barcode].filter(Boolean).join(' · ')}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {it.qty} adet × {fmtMoney(it.unit_price, order.currency)}
                            {it.qty_prior_shortage > 0 && <span className="ml-2 text-rose-600">({it.qty_prior_shortage} adet daha önce iade edildi / talepte)</span>}
                            {it.status_label && <span className="ml-2 text-gray-400">· {it.status_label}</span>}
                          </div>

                          {checked && (
                            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[11px] text-gray-500 mb-0.5">Adet</label>
                                <select
                                  value={s.qty}
                                  onChange={(e) => setLine(it.line_id, { qty: Number(e.target.value) })}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                                >
                                  {Array.from({ length: it.qty_available }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-gray-500 mb-0.5">Neden *</label>
                                <select
                                  value={s.reason_code}
                                  onChange={(e) => setLine(it.line_id, { reason_code: e.target.value })}
                                  className={clsx('w-full px-2 py-1.5 border rounded-md text-sm', s.reason_code ? 'border-gray-300' : 'border-rose-400')}
                                >
                                  <option value="">Seçin…</option>
                                  {Object.entries(data!.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-gray-500 mb-0.5">Kısa açıklama</label>
                                <input
                                  value={s.reason_note}
                                  onChange={(e) => setLine(it.line_id, { reason_note: e.target.value })}
                                  maxLength={300}
                                  placeholder="Opsiyonel"
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">
                          {fmtMoney(it.unit_price * it.qty, order.currency)}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Personel notu (yöneticiye görünür)</label>
              <textarea
                value={staffNote}
                onChange={(e) => setStaffNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={returned
                  ? 'Örn: Paket 3 gün şubede bekledi, müşteri almadı; 5 Ekim\'de depoya geri döndü, ürünler sağlam.'
                  : delivered
                  ? 'Örn: Müşteri aradı, pakette 2 üründen 1\'i yokmuş; depo kontrolünde eksik çıktığı doğrulandı.'
                  : 'Örn: Müşteri arandı, 42 numara yerine 43 istemedi; para iadesi kabul etti.'}
                className={inputCls}
                disabled={!canCreate}
              />
            </div>
          </div>

          {/* Sağ: özet + onay */}
          <div className="space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 sticky top-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">İade Özeti</h2>
              {selectedLines.length === 0 ? (
                <p className="text-sm text-gray-400">{returned ? 'Soldan geri dönen ürünleri seçin.' : delivered ? 'Soldan eksik / hatalı gelen ürünü seçin.' : 'Soldan gönderilemeyen ürünü seçin.'}</p>
              ) : previewing && !preview ? (
                <p className="text-sm text-gray-400 flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> Hesaplanıyor…</p>
              ) : previewError ? (
                <p className="text-sm text-rose-600">{previewError}</p>
              ) : preview ? (
                <div className="space-y-2 text-sm">
                  {preview.calculation.lines.map((l) => (
                    <div key={l.line_id} className="flex justify-between gap-2">
                      <span className="text-gray-600 truncate">{l.name ?? l.line_id} × {l.qty_returned}</span>
                      <span className="tabular-nums text-gray-900">{fmtMoney(l.refundable, preview.calculation.currency)}</span>
                    </div>
                  ))}
                  {preview.calculation.shipping_refundable > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600">Kargo ücreti</span>
                      <span className="tabular-nums text-gray-900">{fmtMoney(preview.calculation.shipping_refundable, preview.calculation.currency)}</span>
                    </div>
                  )}
                  <div className="border-t pt-2 flex justify-between font-semibold text-gray-900">
                    <span>İade tutarı</span>
                    <span className={clsx('tabular-nums', previewing && 'opacity-50')}>{fmtMoney(preview.calculation.total_refundable, preview.calculation.currency)}</span>
                  </div>
                  {preview.calculation.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-700">{w}</p>
                  ))}
                  <div className={clsx('rounded-md px-2.5 py-2 text-xs', preview.is_full && !delivered ? 'bg-orange-50 text-orange-800 border border-orange-200' : 'bg-gray-50 text-gray-600 border border-gray-200')}>
                    {returned
                      ? (preview.is_full
                        ? 'Seçim siparişin TAMAMINI kapsıyor: yönetici para onayından sonra sipariş Ticimax\'ta İPTAL yapılır.'
                        : 'Kısmi seçim: yalnız para iadesi yapılır, Ticimax sipariş statüsü değiştirilmez.')
                      : delivered
                      ? (preview.is_full
                        ? 'Seçim siparişin TAMAMINI kapsıyor. Teslimat sonrası bildirim: Ticimax\'ta yine hiçbir güncelleme yapılmaz.'
                        : 'Teslimat sonrası bildirim: Ticimax sipariş statüsü ve kalemleri değiştirilmez.')
                      : (preview.is_full
                        ? 'Seçim siparişin TAMAMINI kapsıyor: sipariş Ticimax\'ta İPTAL edilir (hiçbir ürün gönderilmeyecek).'
                        : 'Kısmi iade: sipariş statüsü değişmez, kalan ürünleri normal kargolayın.')}
                  </div>
                  {isCod && (
                    <div className="rounded-md px-2.5 py-2 text-xs bg-amber-50 text-amber-800 border border-amber-200">
                      {returned
                        ? 'Kapıda ödemeli: tahsilat yapılmadığı için para iadesi oluşturulmaz, kayıt hemen kapanır; müşteriye bildirim gitmez.'
                        : 'Kapıda ödemeli: para iadesi oluşturulmaz, talep hemen kapanır; özür SMS\'i ve kupon yine gider.'}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mt-4 rounded-md bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 space-y-1">
                <div className="flex items-start gap-1.5"><ShieldCheck size={12} className="mt-0.5 shrink-0" /> Talep yönetici para onayına düşer; onayda tutar karta iade edilir.</div>
                {returned
                  ? <div className="flex items-start gap-1.5"><BellOff size={12} className="mt-0.5 shrink-0" /> Müşteriye hiçbir bildirim gönderilmez (SMS / kupon yok).</div>
                  : <div className="flex items-start gap-1.5"><Gift size={12} className="mt-0.5 shrink-0" /> Onay sonrası müşteriye {delivered ? 'genel özür SMS\'i + telafi kuponu' : 'özür SMS\'i + özel indirim kuponu'} gönderilir.</div>}
                <div className="flex items-start gap-1.5"><InfoIcon size={12} className="mt-0.5 shrink-0" /> {returned ? 'Ticimax statüsü yönetici onayından sonra İptal yapılır (tam kapsamda).' : delivered ? 'Ticimax\'ta hiçbir güncelleme yapılmaz.' : 'Ticimax\'ta kalem işaretlenir (sipariş statüsü yalnız tam kapsamda değişir).'} Nebim'e işlem yapılmaz.</div>
              </div>

              {submitError && <div className="mt-3 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">{submitError}</div>}

              {!confirm ? (
                <button
                  disabled={!canCreate || selectedLines.length === 0 || !allReasonsChosen || !preview || previewing}
                  onClick={() => setConfirm(true)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50"
                >
                  {returned ? <Undo2 size={15} /> : <PackageX size={15} />} {returned ? 'Geri Dönen Sipariş İadesini Başlat' : 'İadeyi Başlat'}
                </button>
              ) : (
                <div className="mt-4 rounded-md border-2 border-rose-400 bg-rose-50 p-3">
                  <p className="text-sm text-rose-900 font-medium mb-2">
                    {fmtMoney(preview?.calculation.total_refundable ?? 0, order.currency)} tutarında iade talebi açılacak. Onaylıyor musunuz?
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={submitting}
                      onClick={submit}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Evet, Başlat
                    </button>
                    <button disabled={submitting} onClick={() => setConfirm(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white">
                      Vazgeç
                    </button>
                  </div>
                </div>
              )}
              {selectedLines.length > 0 && !allReasonsChosen && (
                <p className="mt-2 text-[11px] text-rose-600">Her seçili ürün için neden seçin.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Sonuç ekranında Ticimax adımlarının kısa özeti (metadata.ticimax_shortage ham yapısı). */
function TicimaxSummary({ ticimax }: { ticimax: Record<string, unknown> | null }) {
  if (!ticimax) return null
  const t = ticimax as {
    enabled?: boolean; dry_run?: boolean; skipped?: string
    order_status?: { success?: boolean; durum?: string; error?: string | null } | null
    items?: { skipped?: string; marked?: unknown[]; errors?: string[] } | null
    note?: { skipped?: string; success?: boolean; field?: number; error?: string | null } | null
  }
  const lines: { ok: boolean | null; text: string }[] = []
  if (t.skipped) lines.push({ ok: null, text: t.skipped })
  if (t.order_status) lines.push({ ok: !!t.order_status.success, text: `Sipariş statüsü → ${t.order_status.durum ?? '?'}${t.order_status.error ? `: ${t.order_status.error}` : ''}` })
  else if (t.enabled && !t.skipped) lines.push({ ok: true, text: 'Sipariş statüsü değiştirilmedi (kısmi).' })
  if (t.items) {
    if (t.items.skipped) lines.push({ ok: null, text: `Kalem işaretleme: ${t.items.skipped}` })
    else lines.push({ ok: !(t.items.errors?.length), text: `Kalem işaretlendi: ${t.items.marked?.length ?? 0}${t.items.errors?.length ? ` — ${t.items.errors.join(' | ')}` : ''}` })
  }
  if (t.note) {
    if (t.note.skipped) lines.push({ ok: null, text: `Not: ${t.note.skipped}` })
    else lines.push({ ok: !!t.note.success, text: `Ticimax özel alan ${t.note.field ?? '?'} notu${t.note.success ? ' yazıldı' : `: ${t.note.error ?? 'hata'}`}` })
  }
  if (lines.length === 0) return null
  return (
    <ul className="mt-3 space-y-0.5 text-xs">
      {t.dry_run && <li className="text-amber-700">Ticimax dry-run: aşağıdakiler gerçekte yazılmadı.</li>}
      {lines.map((l, i) => (
        <li key={i} className={clsx('flex items-start gap-1', l.ok === false ? 'text-rose-700' : l.ok === null ? 'text-gray-500' : 'text-emerald-700')}>
          <span>{l.ok === false ? '✕' : l.ok === null ? '•' : '✓'}</span><span>{l.text}</span>
        </li>
      ))}
    </ul>
  )
}
