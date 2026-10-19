import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  PackageOpen, Search, ShieldCheck, Truck, Loader2, AlertCircle,
  CheckCircle2, Minus, Plus, Ticket, CreditCard, ArrowLeft, Copy,
  Camera, X, Wrench, Landmark,
} from 'lucide-react'
import returnsApi, {
  type BankAccountInput, type LookupResponse, type RefundCalculation,
  type RefundMethodOption, type RefundMethodValue,
} from '@/lib/returnsApi'
import axios from 'axios'

type Step = 'lookup' | 'select' | 'defect' | 'method' | 'done'
type FlowType = 'return' | 'cancel' | 'defect'

interface Selection {
  qty: number
  reason_code: string
  reason_note: string
  condition: string
}

const REASONS = [
  { code: 'size', label: 'Beden / ölçü uymadı' },
  { code: 'not_satisfied', label: 'Üründen memnun kalmadım' },
  { code: 'defective', label: 'Hasarlı / kusurlu ürün' },
  { code: 'wrong_item', label: 'Yanlış ürün geldi' },
  { code: 'changed_mind', label: 'Vazgeçtim / fikrim değişti' },
  { code: 'other', label: 'Diğer' },
]

/** İptal akışı: ürün henüz teslim edilmediği için nedenler iadeden farklı. */
const CANCEL_REASONS = [
  { code: 'changed_mind', label: 'Vazgeçtim / fikrim değişti' },
  { code: 'wrong_selection', label: 'Yanlış ürün / beden / adet seçtim' },
  { code: 'found_cheaper', label: 'Daha uygun fiyat buldum' },
  { code: 'late_delivery', label: 'Teslimat süresi çok uzun' },
  { code: 'address_error', label: 'Adres / alıcı bilgisi hatalı' },
  { code: 'duplicate_order', label: 'Yanlışlıkla mükerrer sipariş verdim' },
  { code: 'other', label: 'Diğer' },
]

/** Seçili her kalemde neden var mı? "Diğer" seçildiyse kısa açıklama da zorunlu. */
const reasonComplete = (s: Selection) =>
  !!s.reason_code && (s.reason_code !== 'other' || s.reason_note.trim().length >= 3)

function money(n: number, cur = 'TRY') {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur || 'TRY' }).format(n)
}

function errMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data?.error as string) || (e.response?.data?.message as string) || fallback
  }
  return fallback
}

// Sayfa, tenant mağazasının (ör. magazaniz.com/iade) içine iframe ile gömülebilir.
// `?embed=1` → kendi başlık/arka planını gizler ve yüksekliğini parent'a bildirir.
const EMBED = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('embed') === '1'

export default function PublicReturnPage() {
  const { slug = '' } = useParams()

  useEffect(() => { document.title = 'İptal / İade Talebi' }, [])

  // ── Gömülü mod: yüksekliği parent pencereye bildir (iframe otomatik resize) ──
  useEffect(() => {
    if (!EMBED || typeof window === 'undefined') return
    // Iframe'in site arka planıyla kaynaşması için şeffaf gövde
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'

    let last = 0
    const post = () => {
      const h = Math.ceil(document.documentElement.scrollHeight)
      if (h && h !== last) {
        last = h
        window.parent.postMessage({ type: 'yunbi-iade:height', height: h }, '*')
      }
    }
    post()
    const ro = new ResizeObserver(post)
    ro.observe(document.documentElement)
    window.addEventListener('load', post)
    window.addEventListener('resize', post)
    return () => {
      ro.disconnect()
      window.removeEventListener('load', post)
      window.removeEventListener('resize', post)
    }
  }, [])

  const [step, setStep] = useState<Step>('lookup')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lookup form
  const [orderNo, setOrderNo] = useState('')
  const [contactType, setContactType] = useState<'email' | 'phone'>('email')
  const [contact, setContact] = useState('')

  // Lookup result
  const [data, setData] = useState<LookupResponse | null>(null)
  const [token, setToken] = useState<string>('')
  const [type, setType] = useState<FlowType>('return')

  // Kusur bildirimi: intro "Sorun Bildir" butonuyla başlar; foto + şikâyet ayrı adımda alınır.
  const [defectStarted, setDefectStarted] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [complaint, setComplaint] = useState('')

  // Selections
  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const [calc, setCalc] = useState<RefundCalculation | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)

  // Method
  const [refundMethod, setRefundMethod] = useState<RefundMethodValue | ''>('')
  const [conditionAccepted, setConditionAccepted] = useState(false)
  // Havale ile iade (kapıda ödeme siparişleri): müşterinin banka hesabı.
  const [bankAccount, setBankAccount] = useState<BankAccountInput>({ bank_name: '', account_holder: '', iban: '' })

  // Done — tutar/para birimi submit YANITINDAN alınır (sunucu yeniden hesaplar).
  // calc state'i 'select' adımından çıkınca null'landığı için ona güvenilmez.
  const [publicCode, setPublicCode] = useState('')
  const [cargoCode, setCargoCode] = useState<string | null>(null)
  // Tenant'ın kargo firması (lookup yanıtı) — Sürat varsayılan (eski davranış korunur).
  const [cargo, setCargo] = useState<{ provider: string; name: string; expire_days?: number }>({ provider: 'surat-kargo', name: 'Sürat Kargo' })
  const [doneAmount, setDoneAmount] = useState(0)
  const [doneCurrency, setDoneCurrency] = useState('TRY')

  const base = `/r/${encodeURIComponent(slug)}/returns`

  const selectedItems = useMemo(
    () => Object.entries(selections).filter(([, s]) => s.qty > 0),
    [selections],
  )

  // ── KAPIDA ÖDEME İPTALİ: ödeme adımı YOK ──
  // Sipariş kapıda ödemeli ve müşteri İPTAL ediyorsa ortada tahsil edilmiş para yoktur → iade
  // şekli sormak anlamsız (ve "karta iade" seçeneği yanıltıcı olurdu). Adım tamamen atlanır,
  // "Devam Et" doğrudan talebi gönderir. Sunucu da aynı kararı bağımsız verir (istemciye güvenilmez).
  const isCod = !!data?.payment?.cod
  const codCancel = isCod && type === 'cancel'

  // ── Lookup ──
  const doLookup = useCallback(async () => {
    setError(null)
    if (!orderNo.trim()) { setError('Sipariş numarası giriniz.'); return }
    if (!contact.trim()) { setError('E-posta veya telefon giriniz.'); return }
    setLoading(true)
    try {
      const body: Record<string, string> = { order_no: orderNo.trim() }
      body[contactType] = contact.trim()
      const res = await returnsApi.post<LookupResponse>(`${base}/lookup`, body)
      setData(res.data)
      setToken(res.data.token)
      if (res.data.cargo?.name) setCargo(res.data.cargo)
      const el = res.data.eligibility
      const initialType: FlowType = el.can_return ? 'return' : (el.can_cancel ? 'cancel' : (el.can_defect ? 'defect' : 'return'))
      setType(initialType)
      setDefectStarted(false)
      setPhotos([])
      setComplaint('')
      // İlk haliyle seçimleri sıfırla — İPTAL daima TAM sipariş: tüm kalemler tam adetle seçili gelir.
      const init: Record<string, Selection> = {}
      res.data.order.items.forEach((it) => {
        init[it.line_id] = { qty: initialType === 'cancel' ? it.qty : 0, reason_code: '', reason_note: '', condition: '' }
      })
      setSelections(init)
      setStep('select')
    } catch (e) {
      setError(errMessage(e, 'Sipariş bulunamadı veya bilgiler eşleşmiyor.'))
    } finally {
      setLoading(false)
    }
  }, [orderNo, contact, contactType, base])

  // ── Preview (debounced, server-side recompute) ──
  useEffect(() => {
    // 'method'/'done' adımlarında calc'ı KORU (method step render için calc'a bağlı,
    // done ekranı da gösterir). Aksi halde 'select'ten çıkınca calc null'lanıp method
    // adımı boş kalıyordu ("iade şekli gelmiyor").
    if (step !== 'select') return
    if (!token || selectedItems.length === 0) {
      setCalc(null)
      return
    }
    const items = selectedItems.map(([line_id, s]) => ({ line_id, qty: s.qty }))
    const handle = setTimeout(async () => {
      setCalcLoading(true)
      try {
        // type ZORUNLU: iptalde kargo ücreti iadeye dahil, iadede değil → önizleme ile
        // submit'in aynı tutarı vermesi buna bağlı.
        const res = await returnsApi.post<{ calculation: RefundCalculation }>(`${base}/preview`, { token, items, type })
        setCalc(res.data.calculation)
      } catch {
        setCalc(null)
      } finally {
        setCalcLoading(false)
      }
    }, 450)
    return () => clearTimeout(handle)
  }, [selectedItems, token, step, base, type])

  // Tür değişimi: İPTAL seçilirse tüm kalemler tam adetle otomatik seçilir (kısmi iptal yok);
  // İADE'ye dönülürse seçim sıfırlanır (iptalin tam seçimi iadeye taşınmasın).
  const changeType = useCallback((v: FlowType) => {
    setType(v)
    if (!data) return
    const init: Record<string, Selection> = {}
    data.order.items.forEach((it) => {
      init[it.line_id] = { qty: v === 'cancel' ? it.qty : 0, reason_code: '', reason_note: '', condition: '' }
    })
    setSelections(init)
  }, [data])

  const setQty = (lineId: string, qty: number, max: number) => {
    setSelections((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], qty: Math.max(0, Math.min(max, qty)) },
    }))
  }
  const setField = (lineId: string, field: keyof Selection, value: string) => {
    setSelections((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [field]: value } }))
  }

  // ── Submit ──
  const doSubmit = useCallback(async () => {
    setError(null)
    // Kapıda ödeme iptalinde yöntem sorulmaz — sunucu da 'none' olarak sabitler.
    const method: RefundMethodValue | '' = codCancel ? 'none' : refundMethod
    if (!method) { setError('İade şeklini seçiniz.'); return }
    if (method === 'bank_transfer') {
      // Banka adı opsiyonel — havale IBAN + ad soyad ile yapılır.
      if (!bankAccount.account_holder.trim().includes(' ')) { setError('Hesap sahibinin adını ve soyadını giriniz.'); return }
      if (!/^TR\d{24}$/.test(bankAccount.iban.replace(/\s+/g, '').toUpperCase())) {
        setError('Geçerli bir TR IBAN giriniz (TR ile başlayan 26 karakter).'); return
      }
    }
    // Kusur akışında "kullanılmamış/etiketli" beyanı anlamsız → kutu gizli, kontrol de atlanır.
    // Kapıda ödeme iptalinde de sorulmaz (ürün hiç kargolanmadı, beyan edilecek durum yok).
    if (type !== 'defect' && !selectedItems.every(([, s]) => reasonComplete(s))) {
      setError(type === 'cancel' ? 'Lütfen iptal nedenini seçiniz.' : 'Lütfen her ürün için iade nedenini seçiniz.'); return
    }
    if (type !== 'defect' && !codCancel && data?.rules.require_condition_declaration && !conditionAccepted) {
      setError('Ürünlerin iade koşullarına uygun olduğunu onaylayınız.'); return
    }
    setLoading(true)
    try {
      const items = selectedItems.map(([line_id, s]) => ({
        line_id,
        qty: s.qty,
        reason_code: s.reason_code || undefined,
        reason_note: s.reason_note || undefined,
        condition: s.condition || undefined,
      }))
      let res
      if (type === 'defect') {
        // Kusur bildirimi: fotoğraflar + şikâyet metni → multipart (items JSON string olarak gider).
        const fd = new FormData()
        fd.append('token', token)
        fd.append('type', 'defect')
        fd.append('refund_method', method)
        if (method === 'bank_transfer') fd.append('bank_account', JSON.stringify(bankAccount))
        fd.append('complaint', complaint.trim())
        fd.append('items', JSON.stringify(items))
        photos.forEach((f) => fd.append('photos[]', f))
        res = await returnsApi.post<{
          public_code: string; cargo_tracking_code: string | null
          requested_amount: number; currency: string
        }>(`${base}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      } else {
        res = await returnsApi.post<{
          public_code: string; cargo_tracking_code: string | null
          requested_amount: number; currency: string
        }>(`${base}/submit`, {
          token, type, refund_method: method, items,
          ...(method === 'bank_transfer' ? { bank_account: bankAccount } : {}),
        })
      }
      setPublicCode(res.data.public_code)
      setCargoCode(res.data.cargo_tracking_code ?? null)
      setDoneAmount(res.data.requested_amount ?? 0)
      setDoneCurrency(res.data.currency || 'TRY')
      setStep('done')
    } catch (e) {
      setError(errMessage(e, 'Talep oluşturulamadı. Lütfen tekrar deneyin.'))
    } finally {
      setLoading(false)
    }
  }, [refundMethod, codCancel, bankAccount, conditionAccepted, data, selectedItems, token, type, base, complaint, photos])

  return (
    <div className={EMBED ? 'pt-10 pb-4 px-3' : 'min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-8 px-4'}>
      <div className="max-w-2xl mx-auto">
        {/* Header — gömülü modda site kendi başlığını gösterdiği için gizlenir */}
        {!EMBED && (
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <PackageOpen size={22} />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-gray-900">İptal / İade Talebi</h1>
              <p className="text-xs text-gray-500">Siparişinizi kolayca iade edin</p>
            </div>
          </div>
        )}

        <Stepper step={step} defect={type === 'defect'} skipMethod={codCancel} />

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-5 md:p-6">
          {step === 'lookup' && (
            <LookupStep
              orderNo={orderNo} setOrderNo={setOrderNo}
              contactType={contactType} setContactType={setContactType}
              contact={contact} setContact={setContact}
              loading={loading} onSubmit={doLookup}
            />
          )}

          {step === 'select' && data && (
            <SelectStep
              data={data} type={type} setType={changeType}
              defectStarted={defectStarted} onStartDefect={() => { setError(null); setDefectStarted(true) }}
              selections={selections} setQty={setQty} setField={setField}
              calc={calc} calcLoading={calcLoading}
              onBack={() => setStep('lookup')}
              // Kapıda ödeme iptali: ödeme adımı atlanır, "Devam Et" doğrudan talebi gönderir.
              onNext={() => {
                setError(null)
                if (codCancel) { void doSubmit(); return }
                setStep(type === 'defect' ? 'defect' : 'method')
              }}
              nextLabel={codCancel ? 'İptal Talebini Gönder' : 'Devam Et'}
              nextLoading={loading}
              codCancel={codCancel}
              canNext={
                (data.eligibility.can_return || data.eligibility.can_cancel || data.eligibility.can_defect) &&
                selectedItems.length > 0 && !!calc && calc.total_refundable > 0 &&
                (type === 'defect' || selectedItems.every(([, s]) => reasonComplete(s)))
              }
            />
          )}

          {step === 'defect' && (
            <DefectStep
              photos={photos} setPhotos={setPhotos}
              complaint={complaint} setComplaint={setComplaint}
              onBack={() => setStep('select')}
              onNext={() => { setError(null); setStep('method') }}
            />
          )}

          {step === 'method' && data && calc && (
            <MethodStep
              methods={data.refund_methods}
              requireCondition={data.rules.require_condition_declaration && type !== 'defect'}
              refundMethod={refundMethod} setRefundMethod={setRefundMethod}
              bankAccount={bankAccount} setBankAccount={setBankAccount}
              conditionAccepted={conditionAccepted} setConditionAccepted={setConditionAccepted}
              calc={calc} loading={loading}
              onBack={() => setStep(type === 'defect' ? 'defect' : 'select')}
              onSubmit={doSubmit}
            />
          )}

          {step === 'done' && (
            <DoneStep code={publicCode} type={type} cargoCode={cargoCode} method={refundMethod} amount={doneAmount} currency={doneCurrency} cargo={cargo} />
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1">
          <ShieldCheck size={12} /> Bilgileriniz güvenli şekilde işlenir.
        </p>
      </div>
    </div>
  )
}

// ───────────────────────── Adımlar ─────────────────────────

function Stepper({ step, defect, skipMethod = false }: { step: Step; defect: boolean; skipMethod?: boolean }) {
  const steps: { key: Step; label: string }[] = defect
    ? [
      { key: 'lookup', label: 'Sipariş' },
      { key: 'select', label: 'Ürünler' },
      { key: 'defect', label: 'Kusur' },
      { key: 'method', label: 'İade Şekli' },
      { key: 'done', label: 'Tamam' },
    ]
    // Kapıda ödeme iptalinde "İade Şekli" adımı hiç yoktur (iade edilecek para yok).
    : skipMethod
      ? [
        { key: 'lookup', label: 'Sipariş' },
        { key: 'select', label: 'Ürünler' },
        { key: 'done', label: 'Tamam' },
      ]
      : [
        { key: 'lookup', label: 'Sipariş' },
        { key: 'select', label: 'Ürünler' },
        { key: 'method', label: 'İade Şekli' },
        { key: 'done', label: 'Tamam' },
      ]
  const idx = steps.findIndex((s) => s.key === step)
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2 flex-1">
          <div className={`flex items-center gap-2 ${i <= idx ? 'text-indigo-600' : 'text-gray-400'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${
              i < idx ? 'bg-indigo-600 text-white border-indigo-600'
              : i === idx ? 'border-indigo-600 text-indigo-600' : 'border-gray-300'
            }`}>
              {i < idx ? <CheckCircle2 size={16} /> : i + 1}
            </div>
            <span className="text-xs font-medium hidden sm:block">{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-px flex-1 ${i < idx ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

function LookupStep(props: {
  orderNo: string; setOrderNo: (v: string) => void
  contactType: 'email' | 'phone'; setContactType: (v: 'email' | 'phone') => void
  contact: string; setContact: (v: string) => void
  loading: boolean; onSubmit: () => void
}) {
  const { orderNo, setOrderNo, contactType, setContactType, contact, setContact, loading, onSubmit } = props
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sipariş Numarası</label>
        <input
          value={orderNo} onChange={(e) => setOrderNo(e.target.value)}
          placeholder="Örn. 123456"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
      </div>

      <div>
        <div className="flex gap-2 mb-1">
          <button type="button" onClick={() => setContactType('email')}
            className={`text-xs px-2.5 py-1 rounded-md border ${contactType === 'email' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
            E-posta
          </button>
          <button type="button" onClick={() => setContactType('phone')}
            className={`text-xs px-2.5 py-1 rounded-md border ${contactType === 'phone' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
            Telefon
          </button>
        </div>
        <input
          value={contact} onChange={(e) => setContact(e.target.value)}
          type={contactType === 'email' ? 'email' : 'tel'}
          placeholder={contactType === 'email' ? 'siparişteki e-posta' : 'siparişteki telefon'}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">Güvenliğiniz için siparişte kayıtlı bilgilerinizle doğrulama yapıyoruz.</p>
      </div>

      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold disabled:opacity-60">
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        Siparişi Sorgula
      </button>
    </form>
  )
}

function SelectStep(props: {
  data: LookupResponse; type: FlowType; setType: (v: FlowType) => void
  defectStarted: boolean; onStartDefect: () => void
  selections: Record<string, Selection>
  setQty: (id: string, qty: number, max: number) => void
  setField: (id: string, field: keyof Selection, value: string) => void
  calc: RefundCalculation | null; calcLoading: boolean
  onBack: () => void; onNext: () => void; canNext: boolean
  nextLabel?: string; nextLoading?: boolean; codCancel?: boolean
}) {
  const { data, type, setType, defectStarted, onStartDefect, selections, setQty, setField, calc, calcLoading, onBack, onNext, canNext } = props
  const { nextLabel = 'Devam Et', nextLoading = false, codCancel = false } = props
  const { order, eligibility } = data
  const cur = order.currency
  const actionable = eligibility.can_return || eligibility.can_cancel || eligibility.can_defect
  // Kusur akışı "Sorun Bildir" butonuyla başlar (iade penceresi dolduğunda ana ekranda gösterilir).
  const defectIntro = type === 'defect' && !defectStarted

  return (
    <div className="space-y-4">
      {/* Sipariş özeti */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="font-semibold text-gray-900">Sipariş #{order.order_no}</div>
          <div className="text-gray-500 text-xs">{order.status_label} · {order.order_date?.slice(0, 10)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">Ödenen</div>
          <div className="font-semibold text-gray-900">{money(order.paid_amount, cur)}</div>
        </div>
      </div>

      {/* Uygunluk yoksa: sebep + yeni sorgu, akış burada durur */}
      {!actionable && (
        <>
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 px-3 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{eligibility.reasons[0] ?? 'Bu sipariş için iptal/iade işlemi uygun değil.'}</span>
          </div>
          <button type="button" onClick={onBack}
            className="w-full flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600">
            <ArrowLeft size={16} /> Yeni Sorgu
          </button>
        </>
      )}

      {/* Kusur bildirimi girişi: iade penceresi dolmuş → sorun bildirme butonu (ana ekran) */}
      {actionable && defectIntro && (
        <>
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 px-3 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{eligibility.reasons[0] ?? `İade süresi (${eligibility.return_window_days} gün) doldu.`}</span>
          </div>
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 space-y-2">
            <div className="flex items-center gap-2 text-indigo-800 font-semibold text-sm">
              <Wrench size={16} /> Kullanım sonrası bir sorun mu oluştu?
            </div>
            <p className="text-xs text-indigo-700">
              Ürününüzde kullanım sırasında ortaya çıkan bir kusur/sorun varsa bize bildirebilirsiniz.
              Ürünü seçip kusurun fotoğrafını yükleyeceksiniz; bildiriminiz firma yetkilisi tarafından
              değerlendirilecek ve sonuç size SMS ile iletilecektir.
            </p>
            <button type="button" onClick={onStartDefect}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold">
              <Wrench size={16} /> Sorun Bildir
            </button>
          </div>
          <button type="button" onClick={onBack}
            className="w-full flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600">
            <ArrowLeft size={16} /> Yeni Sorgu
          </button>
        </>
      )}

      {actionable && !defectIntro && (<>
      {/* İşlem tipi etiketi / seçimi */}
      {type === 'defect' ? (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-2 text-xs font-medium flex items-center gap-1.5">
          <Wrench size={14} /> Kullanım Sonrası Sorun Bildirimi — sorunlu ürünleri seçiniz.
        </div>
      ) : eligibility.can_return && eligibility.can_cancel ? (
        <div className="flex gap-2">
          <TypeChip active={type === 'return'} onClick={() => setType('return')} label="İade Et" />
          <TypeChip active={type === 'cancel'} onClick={() => setType('cancel')} label="Siparişi İptal Et" />
        </div>
      ) : (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-2 text-xs font-medium">
          {eligibility.can_cancel ? 'Bu sipariş henüz kargoya verilmediği için iptal edilebilir.' : 'Bu sipariş iade edilebilir.'}
        </div>
      )}
      {eligibility.in_transit && eligibility.can_return && (
        <p className="text-[11px] text-gray-500">Siparişiniz sistemde henüz kargoda görünüyor. Ürünü teslim aldıysanız iade talebinizi şimdi oluşturabilirsiniz.</p>
      )}
      {eligibility.deadline && eligibility.can_return && (
        <p className="text-[11px] text-gray-400">İade son tarihi: {eligibility.deadline} ({eligibility.return_window_days} gün)</p>
      )}

      {/* İPTAL DAİMA TAM SİPARİŞ — kısmi iptal kaldırıldı (2026-08-26): kalemler otomatik
          tam adetle seçilir, müşteri dikkat çekici bantla bilgilendirilir. */}
      {type === 'cancel' && (
        <div className="rounded-xl bg-amber-50 border-2 border-amber-300 p-4 flex items-start gap-3">
          <AlertCircle size={20} className="shrink-0 mt-0.5 text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-amber-800">Siparişiniz bütün olarak iptal edilir</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              İptal süreçlerinde aksama yaşanmaması adına siparişler yalnızca <b>tüm ürünleriyle
              birlikte</b> iptal edilebilmektedir. Devam ettiğinizde siparişinizdeki tüm ürünler iptal
              edilir ve ödemenizin <b>tamamı</b> iade edilir. Beğendiğiniz ürünleri dilerseniz hemen
              yeni bir siparişle tekrar satın alabilirsiniz.
            </p>
          </div>
        </div>
      )}

      {/* Ürünler */}
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
        {order.items.map((it) => {
          const sel = selections[it.line_id] ?? { qty: 0, reason_code: '', reason_note: '', condition: '' }
          return (
            <div key={it.line_id} className="p-3">
              <div className="flex gap-3">
                {it.image_url
                  ? <img src={it.image_url} alt="" className="w-14 h-14 rounded-lg object-cover border border-gray-100" />
                  : <div className="w-14 h-14 rounded-lg bg-gray-100" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 line-clamp-2">{it.name}</div>
                  {it.variant_info && <div className="text-xs text-gray-500">{it.variant_info}</div>}
                  <div className="text-xs text-gray-400">{money(it.unit_price, cur)} · {it.qty} adet</div>
                </div>
                {type === 'cancel' ? (
                  // İptalde adet seçimi yok: tüm kalemler tam adetle iptale dahildir.
                  <div className="self-start flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1">
                    <CheckCircle2 size={14} className="text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700">{it.qty} adet</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 self-start">
                    <button type="button" onClick={() => setQty(it.line_id, sel.qty - 1, it.qty)}
                      className="w-7 h-7 rounded-md border border-gray-200 flex items-center justify-center text-gray-600 disabled:opacity-40"
                      disabled={sel.qty <= 0}><Minus size={14} /></button>
                    <span className="w-6 text-center text-sm font-semibold">{sel.qty}</span>
                    <button type="button" onClick={() => setQty(it.line_id, sel.qty + 1, it.qty)}
                      className="w-7 h-7 rounded-md border border-gray-200 flex items-center justify-center text-gray-600 disabled:opacity-40"
                      disabled={sel.qty >= it.qty}><Plus size={14} /></button>
                  </div>
                )}
              </div>

              {sel.qty > 0 && type !== 'defect' && type !== 'cancel' && (
                <div className="mt-2 pl-[68px] space-y-2">
                  <select value={sel.reason_code} onChange={(e) => setField(it.line_id, 'reason_code', e.target.value)} required
                    className={`w-full rounded-md border px-2 py-1.5 text-xs text-gray-700 ${sel.reason_code ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`}>
                    <option value="">İade nedeni seçiniz (zorunlu)</option>
                    {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                  {sel.reason_code === 'other' && (
                    <input value={sel.reason_note} onChange={(e) => setField(it.line_id, 'reason_note', e.target.value)} required
                      placeholder="Kısaca açıklayınız (zorunlu)" maxLength={500}
                      className={`w-full rounded-md border px-2 py-1.5 text-xs ${sel.reason_note.trim().length >= 3 ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`} />
                  )}
                  {!reasonComplete(sel) && (
                    <p className="text-[11px] text-amber-700">
                      {sel.reason_code === 'other' ? 'Lütfen nedeninizi kısaca yazınız.' : 'Devam etmek için iade nedeni seçiniz.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* İptalde kalem başına değil, TEK iptal nedeni sorulur (tüm kalemlere yazılır, ZORUNLU; liste iadeden farklı) */}
      {type === 'cancel' && (() => {
        const first = order.items[0] ? selections[order.items[0].line_id] : undefined
        const setAll = (field: keyof Selection, value: string) =>
          order.items.forEach((it) => setField(it.line_id, field, value))
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">İptal nedeni <span className="text-rose-500">*</span></label>
            <select value={first?.reason_code ?? ''} onChange={(e) => setAll('reason_code', e.target.value)} required
              className={`w-full rounded-md border px-2 py-2 text-xs text-gray-700 ${first?.reason_code ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`}>
              <option value="">İptal nedeni seçiniz (zorunlu)</option>
              {CANCEL_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {first?.reason_code === 'other' && (
              <input value={first?.reason_note ?? ''} onChange={(e) => setAll('reason_note', e.target.value)} required
                placeholder="Kısaca açıklayınız (zorunlu)" maxLength={500}
                className={`w-full rounded-md border px-2 py-1.5 text-xs ${(first?.reason_note ?? '').trim().length >= 3 ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`} />
            )}
            {first && !reasonComplete(first) && (
              <p className="text-[11px] text-amber-700">
                {first.reason_code === 'other' ? 'Lütfen nedeninizi kısaca yazınız.' : 'Devam etmek için iptal nedeni seçiniz.'}
              </p>
            )}
          </div>
        )
      })()}

      {/* Tutar önizleme */}
      <RefundSummary calc={calc} loading={calcLoading} currency={cur} />

      {codCancel && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-800">
          <b>Ödeme adımı yok.</b> Siparişiniz kapıda ödemeli olduğu için henüz bir tahsilat
          yapılmadı — iptal sonrasında ödeyeceğiniz bir tutar veya beklemeniz gereken bir iade
          bulunmuyor.
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600">
          <ArrowLeft size={16} /> Geri
        </button>
        <button type="button" onClick={onNext} disabled={!canNext || nextLoading}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold disabled:opacity-50">
          {nextLoading && <Loader2 size={16} className="animate-spin" />}
          {nextLabel}
        </button>
      </div>
      </>)}
    </div>
  )
}

const MAX_DEFECT_PHOTOS = 5

function DefectStep(props: {
  photos: File[]; setPhotos: (f: File[]) => void
  complaint: string; setComplaint: (v: string) => void
  onBack: () => void; onNext: () => void
}) {
  const { photos, setPhotos, complaint, setComplaint, onBack, onNext } = props
  const [localError, setLocalError] = useState<string | null>(null)

  // Önizlemeler data-URL ile: blob (createObjectURL) URL'leri sandbox'lı/cross-origin iframe
  // gömmelerinde (Ticimax teması) engellenebiliyor → görseller kırık çıkıyordu (2026-07-24 saha).
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    Promise.all(photos.map((f) => new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(f)
    }))).then((urls) => { if (!cancelled) setPreviews(urls) })
    return () => { cancelled = true }
  }, [photos])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    setLocalError(null)
    const incoming = Array.from(list).filter((f) => f.type.startsWith('image/'))
    const oversize = incoming.find((f) => f.size > 8 * 1024 * 1024)
    if (oversize) { setLocalError('Fotoğraf boyutu en fazla 8 MB olabilir.'); return }
    const merged = [...photos, ...incoming].slice(0, MAX_DEFECT_PHOTOS)
    setPhotos(merged)
  }

  const next = () => {
    if (photos.length === 0) { setLocalError('En az 1 kusur fotoğrafı yükleyiniz.'); return }
    if (complaint.trim().length < 10) { setLocalError('Lütfen sorununuzu en az 10 karakterle açıklayınız.'); return }
    setLocalError(null)
    onNext()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-2 text-xs font-medium flex items-center gap-1.5">
        <Camera size={14} /> Kusurun net göründüğü en az 1, en fazla {MAX_DEFECT_PHOTOS} fotoğraf yükleyiniz.
      </div>

      {localError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{localError}</span>
        </div>
      )}

      {/* Fotoğraflar */}
      <div className="flex flex-wrap gap-2">
        {photos.map((f, i) => (
          <div key={`${f.name}-${i}`} className="relative w-20 h-20">
            {previews[i]
              ? <img src={previews[i]} alt="" className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
              : <div className="w-20 h-20 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-300"><Camera size={18} /></div>}
            <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow">
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < MAX_DEFECT_PHOTOS && (
          <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-indigo-400 hover:text-indigo-500">
            <Camera size={20} />
            <span className="text-[10px] mt-1">Ekle</span>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </label>
        )}
      </div>

      {/* Şikâyet metni */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sorununuzu anlatın</label>
        <textarea
          value={complaint} onChange={(e) => setComplaint(e.target.value)}
          rows={4} maxLength={2000}
          placeholder="Kusurun ne olduğunu, ne zaman ve nasıl fark ettiğinizi kısaca açıklayınız..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
        />
        <p className="mt-0.5 text-[11px] text-gray-400 text-right">{complaint.length}/2000</p>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600">
          <ArrowLeft size={16} /> Geri
        </button>
        <button type="button" onClick={next}
          className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold">
          Devam Et
        </button>
      </div>
    </div>
  )
}

function TypeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}>
      {label}
    </button>
  )
}

function RefundSummary({ calc, loading, currency }: { calc: RefundCalculation | null; loading: boolean; currency: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-gray-500">Tahmini iade tutarı</span>
        <span className="font-bold text-gray-900 flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {calc ? money(calc.total_refundable, currency) : money(0, currency)}
        </span>
      </div>
      {calc && calc.shipping_refundable > 0 && (
        <div className="mt-1 text-[11px] text-gray-400 flex justify-between">
          <span>Kargo iadesi dahil</span><span>{money(calc.shipping_refundable, currency)}</span>
        </div>
      )}
      {/* Sepet indirimi düzeltmesi: iade sonrası kalan ürünler sepet indirimi eşiğinin altına düşüyor */}
      {calc && calc.breakdown?.tier_recovery && (() => {
        const t = calc.breakdown.tier_recovery!
        const threshold = Math.round(t.threshold).toLocaleString('tr-TR')
        const pct = (v?: number) => `%${(v ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
        return (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-[12px]">
            <div className="flex justify-between text-gray-600">
              <span>İade ettiğiniz ürünlerin tutarı</span><span>{money(calc.total_refundable + t.amount, currency)}</span>
            </div>
            <div className="flex justify-between text-amber-700 font-medium mt-0.5">
              <span>Sepet indirimi düzeltmesi</span><span>−{money(t.amount, currency)}</span>
            </div>
            <p className="mt-1.5 text-amber-700 leading-snug">
              Siparişinizde <b>{threshold} TL üzeri sepet indirimi</b> vardı. Bu iadeden sonra elinizde kalan ürünlerin tutarı{' '}
              <b>{money(t.basket_after, currency)}</b> olacağı için{' '}
              {(t.new_rate ?? 0) > 0
                ? <>kalan ürünlerinizin sepet indirimi <b>{pct(t.old_rate)} yerine {pct(t.new_rate)}</b> oluyor.</>
                : <>bu indirimin şartı artık sağlanmıyor.</>}{' '}
              Aradaki <b>{money(t.amount, currency)}</b> iade tutarınızdan düşülür.
            </p>
          </div>
        )
      })()}
      {/* Sepet kampanyası telafisi (eski kampanya modeli): baz ürün iadesinde kalan ürünün kampanya indirimi geri alınır */}
      {calc && !calc.breakdown?.tier_recovery && (calc.breakdown?.campaign_recovery ?? 0) > 0 && (
        <div className="mt-1 text-[11px] text-amber-600">
          <div className="flex justify-between">
            <span>Kampanya indirimi düşüldü</span><span>−{money(calc.breakdown!.campaign_recovery!, currency)}</span>
          </div>
          <p className="mt-0.5 text-amber-500">Sepetteki çoklu ürün kampanyası, iade sonrası kalan ürün için geçerliliğini yitirdiğinden ilgili indirim tutarı iade tutarından düşülmüştür.</p>
        </div>
      )}
      <p className="mt-1 text-[11px] text-gray-400">Nihai tutar onay sürecinde teyit edilir.</p>
    </div>
  )
}

function MethodStep(props: {
  methods: RefundMethodOption[]
  requireCondition: boolean
  refundMethod: RefundMethodValue | ''
  setRefundMethod: (v: RefundMethodValue) => void
  bankAccount: BankAccountInput; setBankAccount: (v: BankAccountInput) => void
  conditionAccepted: boolean; setConditionAccepted: (v: boolean) => void
  calc: RefundCalculation; loading: boolean
  onBack: () => void; onSubmit: () => void
}) {
  const { methods, requireCondition, refundMethod, setRefundMethod, conditionAccepted, setConditionAccepted, calc, loading, onBack, onSubmit } = props
  const { bankAccount, setBankAccount } = props
  const sorted = [...methods].sort((a, b) => Number(b.promoted) - Number(a.promoted))
  // Havale seçiliyse hesap bilgisi ZORUNLU — eksikse "Talebi Onayla" pasif kalır.
  const needsBank = refundMethod === 'bank_transfer'
  const bankReady = !needsBank || (
    bankAccount.account_holder.trim().includes(' ')
    && /^TR\d{24}$/.test(bankAccount.iban.replace(/\s+/g, '').toUpperCase())
  )
  // Tek seçenek varsa (ör. kapıda ödeme iadesinde yalnız havale) otomatik seçili gelsin.
  useEffect(() => {
    if (!refundMethod && sorted.length === 1) setRefundMethod(sorted[0].value)
  }, [refundMethod, sorted, setRefundMethod])

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 flex items-center justify-between">
        <span className="text-sm text-indigo-700">İade edilecek tutar</span>
        <span className="font-bold text-indigo-900">{money(calc.total_refundable, calc.currency)}</span>
      </div>

      <div className="space-y-2">
        {sorted.map((m) => {
          const active = refundMethod === m.value
          const isCredit = m.value === 'store_credit'
          const isBank = m.value === 'bank_transfer'
          return (
            <button key={m.value} type="button" onClick={() => setRefundMethod(m.value)}
              className={`w-full text-left rounded-xl border p-3 transition ${active ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isCredit ? 'bg-emerald-100 text-emerald-600' : (isBank ? 'bg-sky-100 text-sky-600' : 'bg-gray-100 text-gray-600')}`}>
                  {isCredit ? <Ticket size={18} /> : (isBank ? <Landmark size={18} /> : <CreditCard size={18} />)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{m.label}</span>
                    {m.promoted && <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">ÖNERİLEN · ANINDA</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{m.note}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border mt-1 ${active ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'}`} />
              </div>
            </button>
          )
        })}
      </div>

      {needsBank && (
        // Bu bölüm müşterinin iadesini alabilmesi için ZORUNLU — soluk bir "bilgi kutusu" gibi
        // durmamalı; belirgin çerçeve + başlık + net etiketlerle form olduğu anlaşılmalı.
        <div className="rounded-xl border-2 border-sky-500 bg-white overflow-hidden shadow-sm">
          <div className="bg-sky-600 px-3.5 py-2.5 flex items-center gap-2">
            <Landmark size={18} className="text-white shrink-0" />
            <div>
              <div className="text-sm font-bold text-white">Havale Bilgileriniz</div>
              <div className="text-[11px] text-sky-100">İade bu hesaba gönderilecek — lütfen eksiksiz doldurun.</div>
            </div>
          </div>

          <div className="p-3.5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Hesap sahibi ad soyad <span className="text-rose-500">*</span>
              </label>
              <input
                value={bankAccount.account_holder}
                onChange={(e) => setBankAccount({ ...bankAccount, account_holder: e.target.value })}
                placeholder="Ad Soyad"
                className="w-full rounded-lg border-2 border-gray-200 focus:border-sky-500 focus:outline-none px-3 py-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                IBAN <span className="text-rose-500">*</span>
              </label>
              <input
                value={bankAccount.iban}
                onChange={(e) => setBankAccount({ ...bankAccount, iban: e.target.value.toUpperCase() })}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                inputMode="text"
                autoCapitalize="characters"
                className="w-full rounded-lg border-2 border-gray-200 focus:border-sky-500 focus:outline-none px-3 py-3 text-sm font-mono tracking-wide"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Banka adı <span className="font-normal text-gray-400">(isteğe bağlı)</span>
              </label>
              <input
                value={bankAccount.bank_name}
                onChange={(e) => setBankAccount({ ...bankAccount, bank_name: e.target.value })}
                placeholder="Örn. Ziraat Bankası"
                className="w-full rounded-lg border-2 border-gray-200 focus:border-sky-500 focus:outline-none px-3 py-3 text-sm"
              />
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed">
              Siparişinizi <b>kapıda ödediğiniz</b> için iade banka hesabınıza havale ile yapılır.
              Hesabın iadeyi talep eden kişiye ait olması gerekir; havale, talebiniz onaylandıktan
              sonra en kısa sürede gerçekleştirilir.
            </p>
          </div>
        </div>
      )}

      {needsBank && !bankReady && (
        <p className="text-[11px] text-amber-600 flex items-center gap-1">
          <AlertCircle size={12} /> Talebi gönderebilmek için ad soyad ve geçerli bir IBAN giriniz.
        </p>
      )}

      {requireCondition && (
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={conditionAccepted} onChange={(e) => setConditionAccepted(e.target.checked)} className="mt-0.5" />
          <span>İade edeceğim ürünlerin kullanılmamış, etiketli ve iade koşullarına uygun olduğunu onaylıyorum.</span>
        </label>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600">
          <ArrowLeft size={16} /> Geri
        </button>
        <button type="button" onClick={onSubmit} disabled={loading || !refundMethod || !bankReady}
          title={needsBank && !bankReady ? 'Devam etmek için ad soyad ve geçerli bir IBAN giriniz.' : undefined}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold disabled:opacity-50">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          Talebi Onayla
        </button>
      </div>
    </div>
  )
}

function DoneStep({ code, type, cargoCode, method, amount, currency, cargo }: { code: string; type: FlowType; cargoCode: string | null; method: string; amount: number; currency: string; cargo: { provider: string; name: string; expire_days?: number } }) {
  const [copied, setCopied] = useState(false)
  const [copiedCargo, setCopiedCargo] = useState(false)
  // Kopyalama: Clipboard API cross-origin IFRAME içinde (Ticimax gömme) izin ister ve sessizce
  // reddeder → izin gerektirmeyen execCommand fallback'i şart (2026-07-07 saha bulgusu).
  const copy = async (val: string, setter: (b: boolean) => void) => {
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(val)
        ok = true
      }
    } catch {
      /* izin yok (iframe) → fallback */
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = val
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setter(true)
      setTimeout(() => setter(false), 1500)
    }
  }
  const isReturn = type === 'return'
  const isDefect = type === 'defect'

  // Kusur bildirimi: kargo kodu YOK — talep yönetici onayında; sonuç SMS ile bildirilir.
  if (isDefect) {
    return (
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 size={30} />
        </div>
        <h2 className="mt-3 text-lg font-semibold text-gray-900">Kusur bildiriminiz alındı!</h2>
        <p className="text-sm text-gray-500 mt-1">Değerlendirmeye esas tutar <b>{money(amount, currency)}</b> olarak hesaplandı.</p>

        {code && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2">
            <span className="text-xs text-gray-400">Talep No</span>
            <span className="font-mono font-semibold text-gray-900">{code}</span>
            <button onClick={() => copy(code, setCopied)} className="text-gray-400 hover:text-indigo-600"><Copy size={14} /></button>
            {copied && <span className="text-[11px] text-emerald-600">kopyalandı</span>}
          </div>
        )}

        <div className="mt-5 text-left rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 space-y-1.5">
          <div className="flex items-center gap-2 font-medium"><Wrench size={16} /> Sonraki adımlar</div>
          <p className="text-xs text-blue-700">
            Bildiriminiz ve fotoğraflarınız firma yetkilisi tarafından incelenecektir.
            <b> Onaylanırsa</b> ücretsiz iade kargo kodunuz SMS ile iletilecek ve ürünü dilediğiniz
            {' '}{cargo.name} şubesine teslim edebileceksiniz. Onaylanmazsa red nedeni yine SMS ile bildirilecektir.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="text-center py-4">
      <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
        <CheckCircle2 size={30} />
      </div>
      <h2 className="mt-3 text-lg font-semibold text-gray-900">{isReturn ? 'İade talebiniz alındı!' : 'İptal talebiniz alındı!'}</h2>
      {/* Kapıda ödeme iptalinde tahsil edilmiş para yok → "iade tutarı" göstermek yanıltıcı olur. */}
      {method === 'none' ? (
        <p className="text-sm text-gray-500 mt-1">Siparişiniz kapıda ödemeli olduğu için tahsilat yapılmadı; iade edilecek bir tutar bulunmuyor.</p>
      ) : (
        <p className="text-sm text-gray-500 mt-1">{isReturn ? 'İade' : 'İptal'} tutarınız <b>{money(amount, currency)}</b> olarak hesaplandı.</p>
      )}

      {/* Takip kodu yalnızca İADE'de gösterilir. İptalde gerekmez: sipariş müşteriye hiç gitmedi,
          depodan çıkmadı; Nebim'de silinip ürünün sevki engelleniyor. */}
      {isReturn && code && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2">
          <span className="text-xs text-gray-400">İade Kodu</span>
          <span className="font-mono font-semibold text-gray-900">{code}</span>
          <button onClick={() => copy(code, setCopied)} className="text-gray-400 hover:text-indigo-600"><Copy size={14} /></button>
          {copied && <span className="text-[11px] text-emerald-600">kopyalandı</span>}
        </div>
      )}

      {/* İADE: kargo kodu ekranda + Sürat şubesi talimatı (kargo şirketi logosu kodun ÜSTÜNDE) */}
      {isReturn && cargoCode && (
        <div className="mt-5 text-left rounded-xl bg-indigo-50 border border-indigo-200 p-4 space-y-2.5">
          <div className="flex items-center gap-2 font-medium text-indigo-800"><Truck size={16} /> İade Kargo Kodunuz</div>
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs text-indigo-600">Kargo şirketi:</span>
            {/* /iade/assets vite build DIŞINDA (embed.js gibi) → app rebuild'i silmez */}
            {cargo.provider === 'surat-kargo'
              ? <img src="/iade/assets/surat-kargo-logo.png" alt="Sürat Kargo" className="h-5 w-auto" />
              : <span className="text-sm font-bold text-indigo-900">{cargo.name}</span>}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white/70 border border-indigo-200 px-3 py-2 w-fit">
            <span className="font-mono text-lg font-bold text-indigo-900 tracking-wide">{cargoCode}</span>
            <button onClick={() => copy(cargoCode, setCopiedCargo)} className="text-indigo-400 hover:text-indigo-700"><Copy size={16} /></button>
            {copiedCargo && <span className="text-[11px] text-emerald-600">kopyalandı</span>}
          </div>
          <p className="text-xs text-indigo-700">
            <b>{cargo.expire_days ?? 14} gün içinde</b> bu kod ile ürününüzü dilediğiniz <b>{cargo.name}</b> şubesine <b>ücretsiz</b> teslim
            edebilirsiniz; kargo ücreti tarafımıza aittir. Gönderiniz bize ulaştığında incelenip onaylanacaktır.
          </p>
          <p className="text-[11px] text-indigo-500">
            Kod {cargo.expire_days ?? 14} gün içinde kullanılmazsa geçerliliğini yitirir; dilerseniz daha sonra yeni bir iade talebi oluşturabilirsiniz.
          </p>
        </div>
      )}

      <div className="mt-5 text-left rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 space-y-1.5">
        <div className="flex items-center gap-2 font-medium"><Truck size={16} /> Sonraki adımlar</div>
        {isReturn ? (
          <p className="text-xs text-blue-700">
            {method === 'store_credit'
              ? 'İndirim kodunuz şu an oluşturulmaz. Ürününüz bize ulaşıp incelendikten ve onaylandıktan sonra indirim kodunuz oluşturulup tarafınıza iletilecektir. Bu kodla beklemeden yeni siparişinizi verebilirsiniz.'
              : method === 'bank_transfer'
                ? 'Ürününüz bize ulaşıp incelendikten ve onaylandıktan sonra, iade tutarı paylaştığınız IBAN\'a havale ile gönderilecektir.'
                : 'Ürününüz bize ulaşıp incelendikten ve onaylandıktan sonra, ödeme yönteminize göre iadeniz 14 iş gününe kadar hesabınıza yansıyacaktır.'}
          </p>
        ) : (
          <p className="text-xs text-blue-700">
            {method === 'none'
              ? 'Siparişinizin tamamı için iptal talebiniz alındı ve işleme alındı. Kapıda ödemeli olduğu için ödeme yapmanız veya bir iade beklemeniz gerekmiyor; kargo size ulaşmayacaktır. Beğendiğiniz ürünleri dilerseniz hemen yeni bir siparişle tekrar satın alabilirsiniz.'
              : method === 'store_credit'
                ? 'Siparişinizin tamamı için iptal talebiniz alındı. Onaylandığında indirim kodunuz oluşturulup tarafınıza iletilecektir; bu kodla beklemeden yeni siparişinizi verebilirsiniz.'
                : 'Siparişinizin tamamı için iptal talebiniz alındı. Onaylandıktan sonra ödemeniz, ödeme yönteminize göre 14 iş gününe kadar hesabınıza iade edilecektir. Beğendiğiniz ürünleri dilerseniz hemen yeni bir siparişle tekrar satın alabilirsiniz.'}
          </p>
        )}
        {isReturn && (
          <p className="text-xs text-blue-700">Talebinizin durumunu yukarıdaki iade kodunuzla istediğiniz zaman sorgulayabilirsiniz.</p>
        )}
      </div>
    </div>
  )
}
