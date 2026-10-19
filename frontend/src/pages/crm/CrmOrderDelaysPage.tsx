import { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  AlarmClock, Search, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Package, Settings,
  Save, CheckSquare, Square, User as UserIcon, CalendarClock, History, X, ChevronUp, FileSpreadsheet, Loader2, Truck, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import { ImageLightbox, ProductThumb, type LightboxItem } from '@/components/crm/ProductImage'
import { PAYMENT_FILTER_OPTIONS, PAYMENT_METHOD_LABELS, PaymentMethodBadge, sourceLabel, type PaymentMethodKey } from '@/components/crm/PaymentMethod'

const PER_PAGE = 50
// Detayda kalem sayısı bunu aşarsa ilk COLLAPSED_SHOW kalem gösterilir, kalanı "+N ürün" ile açılır
const COLLAPSE_OVER = 10
const COLLAPSED_SHOW = 3

/*
 * CRM › Gecikmeler — YALNIZ sipariş statüsüne göre: ödenmiş ama söz verilen
 * kargo gününü geçip hâlâ kargoya verilmemiş statüdeki siparişler.
 * "Kargoya Verildi" ve sonrası gecikme sayılmaz (mağazadan çıkmış).
 * Hesap backend'de (OrderDelayService, "Bugün Kargoda" rozetiyle aynı takvim).
 */

type ReviewState = 'new' | 'reviewing' | 'customer_informed' | 'waiting_supply' | 'resolved'

interface Review {
  state: ReviewState
  note: string | null
  assigned_user_id: number | null
  assigned_name: string | null
  follow_up_at: string | null
  updated_at: string | null
}

interface DelayItem {
  product_id: number | null
  product_name: string
  variant_info: string | null
  sku: string | null
  quantity: number
  image_url: string | null
  status_label: string | null
  total_price: number
}

interface DelayRow {
  id: number
  order_no: string
  platform_order_id: string
  order_date: string
  status: number
  status_label: string
  status_updated_at: string | null
  order_source: string | null
  payment_method: string | null
  total_amount: number
  paid_amount: number
  customer_id: number | null
  customer_name: string | null
  customer_email: string | null
  phone: string | null
  city: string | null
  cargo_company: string | null
  cargo_tracking_no: string | null
  cargo_tracking_url: string | null
  items_count: number
  stage: 'prep'
  due_date: string
  delay_days: number
  age_days: number
  admin_url: string | null
  review: Review | null
  items: DelayItem[]
  shipment_check: ShipmentCheck | null
}

type ShipmentVerdict = 'shipped' | 'wrong_account' | 'possible_manual' | 'invoiced' | 'not_shipped' | 'unverified' | 'error' | 'disabled'

interface ShipmentHit {
  account_key: string
  tracking_no: string
  web_order_code: string | null
  recipient_name: string | null
  city: string | null
  district: string | null
  address: string | null
  shipped_at: string | null
  status: string | null
  delivery_status: string | null
  matched_by?: 'order_no' | 'platform_id' | 'nebim_order' | 'nebim_invoice' | null
  wrong_account?: boolean
  type?: 'no_code' | 'unknown_code' | 'combined'
  related_order_no?: string | null
  related_status?: string | null
  district_match?: boolean
}

interface ShipmentCheck {
  verdict: ShipmentVerdict
  verdict_label: string
  summary: string
  nebim_status: 'found' | 'not_found' | 'error' | null
  nebim_order_number: string | null
  nebim_invoice_number: string | null
  expected_account: 'normal' | 'cod' | null
  accounts_checked: string[]
  missing_accounts: string[]
  ticimax_transferred: boolean | null
  matches: ShipmentHit[]
  candidates: ShipmentHit[]
  checked_at: string | null
}

interface Stats {
  total: number
  open: number
  prep: number
  unreviewed: number
  open_amount: number
  max_delay: number
  avg_delay: number
  follow_up_due: number
  buckets: Record<string, number>
  by_state: Record<ReviewState, number>
  by_source: Record<string, number>
  by_payment: Record<string, number>
  by_cargo: Record<string, number>
  cargo_check_enabled: boolean
  by_shipment: Record<string, number>
  shipment_accounts: string[]
  by_status: { status: number; label: string; count: number }[]
  top_products: { model: string; product_name: string; image_url: string | null; order_count: number; quantity: number }[]
  users: { id: number; name: string }[]
  config: { lookback_days: number; has_schedule: boolean }
}

interface DelayEvent {
  id: number
  type: string
  from_state: string | null
  to_state: string | null
  note: string | null
  created_at: string
  user: { id: number; name: string } | null
}

const STATES: { key: ReviewState; label: string; cls: string }[] = [
  { key: 'new', label: 'Yeni', cls: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'reviewing', label: 'İnceleniyor', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'customer_informed', label: 'Müşteri bilgilendirildi', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'waiting_supply', label: 'Tedarik bekleniyor', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'resolved', label: 'Çözüldü', cls: 'bg-green-50 text-green-700 border-green-200' },
]
const stateMeta = (s: ReviewState | undefined) => STATES.find((x) => x.key === (s || 'new')) || STATES[0]

const BUCKETS = [
  { key: '1', label: '1 gün' },
  { key: '2-3', label: '2–3 gün' },
  { key: '4-7', label: '4–7 gün' },
  { key: '8+', label: '8+ gün' },
]
const SITE_SOURCES = ['TicimaxWeb', 'NativeAndroid', 'NativeIOS']

// Kargo kontrolü (backend DelayShipmentChecker::VERDICTS ile aynı sıra)
const SHIPMENT_VERDICTS: { key: ShipmentVerdict; label: string; cls: string }[] = [
  { key: 'wrong_account', label: 'Yanlış cariden çıkış', cls: 'bg-red-700 text-white border-red-700' },
  { key: 'shipped', label: "Sürat'ta çıkış var", cls: 'bg-red-500 text-white border-red-500' },
  { key: 'possible_manual', label: 'Olası manuel çıkış', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  { key: 'invoiced', label: 'Nebim faturalı, kargo yok', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'not_shipped', label: 'Çıkış yok', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  { key: 'unverified', label: 'Kontrol eksik (cari bağlı değil)', cls: 'bg-white text-amber-700 border-amber-300 border-dashed' },
  { key: 'error', label: 'Kontrol edilemedi', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
]
const verdictMeta = (v: string | undefined) => SHIPMENT_VERDICTS.find((x) => x.key === v)
const ACCOUNT_LABELS: Record<string, string> = { normal: 'Normal cari', cod: 'Kapıda ödeme carisi' }
const MATCHED_BY: Record<string, string> = { order_no: 'TB no', platform_id: 'Ticimax ID', nebim_order: 'Nebim sipariş no', nebim_invoice: 'Nebim fatura no' }
const CANDIDATE_TYPE: Record<string, string> = {
  no_code: 'Sipariş no girilmeden çıkış',
  unknown_code: 'Tanımsız kodla çıkış',
  combined: 'Aynı müşterinin başka siparişiyle',
}
// Sürat'ta çıkmış / yanlış cariden çıkmış siparişin satırı kırmızı yanar
const ROW_TONE: Partial<Record<ShipmentVerdict, { row: string; bar: string }>> = {
  wrong_account: { row: 'bg-red-100 hover:bg-red-100/80', bar: 'shadow-[inset_5px_0_0_#b91c1c]' },
  shipped: { row: 'bg-red-50 hover:bg-red-100/60', bar: 'shadow-[inset_5px_0_0_#ef4444]' },
}
const suratUrl = (code: string) => `https://suratkargo.com.tr/KargoTakip/?kargotakipno=${encodeURIComponent(code)}`
// Backend CrmOrderDelayController::SETTABLE_STATUSES ile aynı (iptal/iade yok)
const SETTABLE_STATUSES = [
  { value: 2, label: 'Onaylandı' },
  { value: 4, label: 'Paketleniyor' },
  { value: 5, label: 'Tedarik Ediliyor' },
  { value: 6, label: 'Kargoya Verildi' },
]

const money = (n: number) => n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 })
const fmtDateTime = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s.replace(' ', 'T'))
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const fmtDay = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', weekday: 'short' })
}
const delayCls = (d: number) =>
  d >= 8 ? 'bg-red-600 text-white' : d >= 4 ? 'bg-orange-500 text-white' : d >= 2 ? 'bg-amber-100 text-amber-800' : 'bg-yellow-50 text-yellow-800'

export default function CrmOrderDelaysPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || !!user?.is_super_admin

  const [stats, setStats] = useState<Stats | null>(null)
  const [rows, setRows] = useState<DelayRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Filtreler
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [bucket, setBucket] = useState('')
  const [status, setStatus] = useState('')
  const [sources, setSources] = useState<string[]>(SITE_SOURCES)
  const [payment, setPayment] = useState('')
  const [cargo, setCargo] = useState('')
  const [shipment, setShipment] = useState('')
  const [reviewState, setReviewState] = useState('open')
  const [assigned, setAssigned] = useState('')
  const [model, setModel] = useState('')
  const [sortBy, setSortBy] = useState('delay_days')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const [open, setOpen] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [bulkState, setBulkState] = useState('')
  const [bulkAssign, setBulkAssign] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showProducts, setShowProducts] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 3000)
  }

  const params = useCallback(() => ({
    search: debounced || undefined,
    bucket: bucket || undefined,
    status: status || undefined,
    sources: sources.length ? sources.join(',') : undefined,
    payment_methods: payment || undefined,
    cargo_company: cargo || undefined,
    shipment: shipment || undefined,
    review_state: reviewState,
    assigned: assigned || undefined,
    model: model || undefined,
    sort_by: sortBy,
    sort_dir: sortDir,
  }), [debounced, bucket, status, sources, payment, cargo, shipment, reviewState, assigned, model, sortBy, sortDir])

  const loadStats = useCallback(() => {
    api.get<Stats>('/crm/delays/stats', { params: { sources: sources.length ? sources.join(',') : undefined, payment_methods: payment || undefined, cargo_company: cargo || undefined } })
      .then((res) => setStats(res.data))
      .catch(() => undefined)
  }, [sources, payment, cargo])

  // Sonsuz kaydırma: ilk 50, aşağı indikçe sıradaki 50 (sayfalama yok)
  const loadRows = useCallback(() => {
    setLoading(true)
    api.get('/crm/delays', { params: { ...params(), page: 1, per_page: PER_PAGE } })
      .then((res) => {
        setRows(res.data.data)
        setTotal(res.data.total)
        setPage(res.data.current_page)
        setLastPage(res.data.last_page)
        setSelected([])
      })
      .finally(() => setLoading(false))
  }, [params])

  const fetchMore = useCallback(() => {
    if (loading || loadingMore || page >= lastPage) return
    setLoadingMore(true)
    api.get('/crm/delays', { params: { ...params(), page: page + 1, per_page: PER_PAGE } })
      .then((res) => {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...prev, ...res.data.data.filter((r: DelayRow) => !seen.has(r.id))]
        })
        setTotal(res.data.total)
        setPage(res.data.current_page)
        setLastPage(res.data.last_page)
      })
      .finally(() => setLoadingMore(false))
  }, [params, page, lastPage, loading, loadingMore])

  useEffect(() => {
    if (loading) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) fetchMore() }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading, fetchMore])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadRows() }, [loadRows])

  // Yenile: o ana kadar yüklenmiş satır sayısı kadar baştan çek (kaydırma konumu korunur)
  const reload = () => {
    loadStats()
    const want = Math.min(200, Math.max(PER_PAGE, Math.ceil(rows.length / PER_PAGE) * PER_PAGE))
    api.get('/crm/delays', { params: { ...params(), page: 1, per_page: want } })
      .then((res) => {
        setRows(res.data.data)
        setTotal(res.data.total)
        setPage(Math.ceil(res.data.data.length / PER_PAGE) || 1)
        setLastPage(Math.max(1, Math.ceil(res.data.total / PER_PAGE)))
      })
      .catch(() => undefined)
  }

  const openImage = useCallback((items: LightboxItem[], index: number) => setLightbox({ items, index }), [])

  const patchRow = (id: number, review: Review) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, review } : r)))

  const updateReview = async (id: number, body: Partial<Review>) => {
    const res = await api.put<Review>(`/crm/delays/${id}`, body)
    patchRow(id, res.data)
    loadStats()
    return res.data
  }

  const applyBulk = async () => {
    if (!selected.length || (!bulkState && !bulkAssign)) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { order_ids: selected }
      if (bulkState) body.state = bulkState
      if (bulkAssign) body.assigned_user_id = bulkAssign === 'none' ? null : Number(bulkAssign)
      const res = await api.post('/crm/delays/bulk', body)
      flash(`${res.data.updated} sipariş güncellendi`)
      setBulkState('')
      setBulkAssign('')
      reload()
    } finally {
      setBusy(false)
    }
  }

  const toggleSel = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id))

  const toggleSource = (s: string) => setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const sortOn = (key: string) => {
    if (sortBy === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortBy(key); setSortDir('desc') }
  }

  // Ekrandaki filtre + sıralamayla tüm satırlar (sayfalama yok) → Excel uyumlu CSV
  const exportExcel = async () => {
    setExporting(true)
    try {
      const res = await api.get('/crm/delays/export', { params: params(), responseType: 'blob' })
      const match = /filename="?([^";]+)"?/.exec(String(res.headers['content-disposition'] ?? ''))
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = match?.[1] ?? 'geciken-siparisler.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      flash('Excel dökümü alınamadı')
    } finally {
      setExporting(false)
    }
  }

  const resetFilters = () => {
    setSearch(''); setBucket(''); setStatus(''); setSources(SITE_SOURCES); setPayment(''); setCargo('')
    setReviewState('open'); setAssigned(''); setModel(''); setShipment('')
  }

  const allSources = Array.from(new Set([...SITE_SOURCES, ...Object.keys(stats?.by_source || {})]))

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
            <AlarmClock className="text-red-600" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Gecikmeler</h1>
            <p className="text-sm text-gray-500">
              Ödemesi alınmış, söz verilen kargo günü geçtiği hâlde hâlâ kargoya verilmemiş siparişler (statüye göre)
              {stats && <> · son {stats.config.lookback_days} gün</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600">
            <RefreshCw size={14} /> Yenile
          </button>
          <button onClick={exportExcel} disabled={exporting} title="Ekrandaki filtrelerle tüm geciken siparişler" className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
          </button>
          {isAdmin && (
            <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600">
              <Settings size={14} /> Ayarlar
            </button>
          )}
        </div>
      </div>

      {showSettings && stats && <SettingsCard config={stats.config} cargoEnabled={stats.cargo_check_enabled} onSaved={() => { setShowSettings(false); reload(); flash('Eşikler kaydedildi') }} />}

      {/* Adet kartları */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Card label="Geciken sipariş" hint="çözüldü olarak işaretlenmemiş" value={stats.open} tone="red" active={!status && reviewState === 'open'} onClick={() => { setStatus(''); setReviewState('open') }} />
          {stats.by_status.map((st) => (
            <Card
              key={st.status}
              label={st.label}
              hint="statüsünde bekliyor"
              value={st.count}
              tone="orange"
              icon={<Package size={14} />}
              active={status === String(st.status)}
              onClick={() => setStatus(status === String(st.status) ? '' : String(st.status))}
            />
          ))}
          <Card label="İncelenmemiş" hint="kimse dokunmadı" value={stats.unreviewed} tone="rose" active={reviewState === 'new'} onClick={() => setReviewState(reviewState === 'new' ? 'open' : 'new')} />
          <Card label="Takip günü gelen" value={stats.follow_up_due} tone="purple" icon={<CalendarClock size={14} />} active={reviewState === 'follow_up'} onClick={() => setReviewState(reviewState === 'follow_up' ? 'open' : 'follow_up')} />
          <Card label="Geciken tutar" value={money(stats.open_amount)} tone="gray" />
          <Card label="En uzun / ortalama" value={`${stats.max_delay} / ${stats.avg_delay} gün`} tone="gray" />
        </div>
      )}

      {/* Gün kovaları + inceleme durumu sekmeleri */}
      {stats && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24">Gecikme süresi</span>
            <Chip active={!bucket} onClick={() => setBucket('')}>Tümü</Chip>
            {BUCKETS.map((b) => (
              <Chip key={b.key} active={bucket === b.key} onClick={() => setBucket(bucket === b.key ? '' : b.key)}>
                {b.label} <span className="opacity-60">{stats.buckets[b.key] ?? 0}</span>
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24">İnceleme</span>
            <Chip active={reviewState === 'open'} onClick={() => setReviewState('open')}>Çözülmemiş</Chip>
            {STATES.map((s) => (
              <Chip key={s.key} active={reviewState === s.key} onClick={() => setReviewState(s.key)}>
                {s.label} <span className="opacity-60">{stats.by_state[s.key] ?? 0}</span>
              </Chip>
            ))}
            <Chip active={reviewState === ''} onClick={() => setReviewState('')}>Tümü <span className="opacity-60">{stats.total}</span></Chip>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24">Kanal</span>
            {allSources.map((s) => (
              <Chip key={s} active={sources.includes(s)} onClick={() => toggleSource(s)}>
                {sourceLabel(s)} {stats.by_source[s] != null && <span className="opacity-60">{stats.by_source[s]}</span>}
              </Chip>
            ))}
            <button onClick={() => setSources([])} className="text-xs text-indigo-600 hover:underline">tüm kanallar</button>
            <button onClick={() => setSources(SITE_SOURCES)} className="text-xs text-gray-500 hover:underline">yalnız site + uygulama</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24">Ödeme</span>
            <Chip active={payment === ''} onClick={() => setPayment('')}>Tümü</Chip>
            {PAYMENT_FILTER_OPTIONS.map((o) => {
              const n = o.value === 'cod'
                ? (stats.by_payment.cod_cash ?? 0) + (stats.by_payment.cod_card ?? 0)
                : stats.by_payment[o.value] ?? 0
              if (!n && payment !== o.value) return null
              return (
                <Chip key={o.value} active={payment === o.value} onClick={() => setPayment(payment === o.value ? '' : o.value)}>
                  {o.label} <span className="opacity-60">{n}</span>
                </Chip>
              )
            })}
            {(stats.by_payment.other ?? 0) > 0 && (
              <Chip active={payment === 'other'} onClick={() => setPayment(payment === 'other' ? '' : 'other')}>
                {PAYMENT_METHOD_LABELS.other} <span className="opacity-60">{stats.by_payment.other}</span>
              </Chip>
            )}
          </div>
          {stats.cargo_check_enabled && <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24">Kargo kontrolü</span>
            <Chip active={shipment === ''} onClick={() => setShipment('')}>Tümü</Chip>
            {(() => {
              const n = ['shipped', 'wrong_account', 'possible_manual', 'invoiced'].reduce((a, k) => a + (stats.by_shipment[k] ?? 0), 0)
              return (
                <Chip active={shipment === 'alert'} onClick={() => setShipment(shipment === 'alert' ? '' : 'alert')}>
                  Bakılması gerekenler <span className="opacity-60">{n}</span>
                </Chip>
              )
            })()}
            {SHIPMENT_VERDICTS.map((v) => {
              const n = stats.by_shipment[v.key] ?? 0
              if (!n && shipment !== v.key) return null
              return (
                <Chip key={v.key} active={shipment === v.key} onClick={() => setShipment(shipment === v.key ? '' : v.key)}>
                  {v.label} <span className="opacity-60">{n}</span>
                </Chip>
              )
            })}
            {(stats.by_shipment.pending ?? 0) > 0 && <span className="text-xs text-gray-400">{stats.by_shipment.pending} henüz kontrol edilmedi</span>}
            {!stats.shipment_accounts.includes('cod') && (
              <span className="text-xs text-amber-700 flex items-center gap-1">
                <AlertTriangle size={12} /> Kapıda ödeme carisi henüz bağlı değil — o cariden çıkışlar görünmez
                {isAdmin && <button onClick={() => setShowSettings(true)} className="ml-1 font-semibold underline">Bağla</button>}
              </span>
            )}
          </div>}
        </div>
      )}

      {/* En çok geciken ürünler */}
      {stats && stats.top_products.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <button onClick={() => setShowProducts(!showProducts)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800">
            <span className="flex items-center gap-2"><Package size={15} className="text-orange-500" /> Kargoya çıkamayan siparişlerde en sık geçen ürünler</span>
            <ChevronDown size={16} className={clsx('text-gray-400 transition-transform', showProducts && 'rotate-180')} />
          </button>
          {showProducts && (
            <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              {stats.top_products.map((p) => (
                <button
                  key={p.model}
                  onClick={() => { setModel(model === p.model ? '' : p.model) }}
                  className={clsx('flex items-center gap-3 p-2 rounded-lg border hover:bg-gray-50 text-left', model === p.model ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-100')}
                >
                  <ProductThumbStatic url={p.image_url} className="w-10 h-[60px]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800 truncate">{p.product_name}</div>
                    <div className="text-xs text-gray-500">{p.model}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">{p.order_count} sipariş</div>
                    <div className="text-xs text-gray-500">{p.quantity} adet</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Arama + ek filtreler */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sipariş no, müşteri, telefon, e-posta, takip no…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">Tüm sipariş durumları</option>
          {stats?.by_status.map((s) => <option key={s.status} value={s.status}>{s.label} ({s.count})</option>)}
        </select>
        <select value={assigned} onChange={(e) => setAssigned(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">Tüm sorumlular</option>
          <option value="me">Bana atananlar</option>
          <option value="none">Atanmamış</option>
          {stats?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={cargo} onChange={(e) => setCargo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">Tüm kargo firmaları</option>
          {cargo && !(stats?.by_cargo || {})[cargo] && <option value={cargo}>{cargo === '—' ? 'Kargo atanmamış' : cargo}</option>}
          {Object.entries(stats?.by_cargo || {}).map(([c, n]) => <option key={c} value={c}>{c === '—' ? 'Kargo atanmamış' : c} ({n})</option>)}
        </select>
        {model && (
          <span className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
            Ürün: {model}
            <button onClick={() => setModel('')}><X size={12} /></button>
          </span>
        )}
        <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><X size={14} /> Sıfırla</button>
      </div>

      {/* Toplu işlem */}
      {selected.length > 0 && (
        <div className="sticky top-2 z-10 bg-indigo-600 text-white rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-lg">
          <span className="text-sm font-semibold">{selected.length} sipariş seçili</span>
          <select value={bulkState} onChange={(e) => setBulkState(e.target.value)} className="text-sm text-gray-800 rounded-lg px-2 py-1.5">
            <option value="">Durum değiştir…</option>
            {STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={bulkAssign} onChange={(e) => setBulkAssign(e.target.value)} className="text-sm text-gray-800 rounded-lg px-2 py-1.5">
            <option value="">Sorumlu ata…</option>
            <option value="none">Sorumluyu kaldır</option>
            {stats?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button disabled={busy || (!bulkState && !bulkAssign)} onClick={applyBulk} className="text-sm font-semibold bg-white text-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">
            Uygula
          </button>
          <button onClick={() => setSelected([])} className="text-sm opacity-80 hover:opacity-100 ml-auto">Seçimi temizle</button>
        </div>
      )}

      {/* Liste */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm text-gray-600 flex items-center justify-between">
          <span><b className="text-gray-900">{total.toLocaleString('tr-TR')}</b> geciken sipariş{rows.length < total && <span className="text-gray-400"> · {rows.length} yüklendi</span>}</span>
          <span className="text-xs text-gray-400">Varsayılan sıralama: en çok geciken önce</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-3 py-2 w-8">
                <button onClick={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}>
                  {allSelected ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} />}
                </button>
              </th>
              <th className="px-3 py-2">Sipariş</th>
              <th className="px-3 py-2">Müşteri</th>
              <th className="px-3 py-2">Durum</th>
              <Th label="Söz verilen" />
              <Th label="Gecikme" sortKey="delay_days" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <Th label="Tutar" sortKey="total_amount" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <th className="px-3 py-2">Ürünler</th>
              <th className="px-3 py-2">İnceleme</th>
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Yükleniyor…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Bu filtrelerde geciken sipariş yok 🎉</td></tr>
            )}
            {!loading && rows.map((r) => {
              const meta = stateMeta(r.review?.state)
              const isOpen = open === r.id
              const tone = r.shipment_check ? ROW_TONE[r.shipment_check.verdict] : undefined
              return (
                <RowFragment key={r.id}>
                  <tr className={clsx('border-b align-top', tone ? clsx(tone.row, 'border-red-100') : clsx('border-gray-50 hover:bg-gray-50/60', isOpen && 'bg-indigo-50/40'))}>
                    <td className={clsx('px-3 py-3', tone?.bar)}>
                      <button onClick={() => toggleSel(r.id)}>
                        {selected.includes(r.id) ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-gray-400" />}
                      </button>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button onClick={() => setOpen(isOpen ? null : r.id)} className="font-semibold text-gray-900 hover:text-indigo-600">{r.order_no}</button>
                      <div className="text-xs text-gray-500">{fmtDateTime(r.order_date)} · {r.age_days} gün önce</div>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{sourceLabel(r.order_source)}</span>
                        <PaymentMethodBadge method={r.payment_method as PaymentMethodKey | null} />
                      </div>
                      {r.shipment_check?.nebim_order_number && (
                        <div className="text-[11px] text-gray-500 mt-1" title="Nebim sipariş no">Nebim: <span className="font-mono">{r.shipment_check.nebim_order_number}</span></div>
                      )}
                      {r.shipment_check && !r.shipment_check.nebim_order_number && (
                        <div
                          className={clsx('text-[11px] mt-1', r.shipment_check.ticimax_transferred === false ? 'text-amber-700 font-medium' : 'text-gray-400')}
                          title={r.shipment_check.ticimax_transferred === false
                            ? "Ticimax bu siparişi Nebim'e aktarmamış (EntegrasyonAktarildi = hayır). Nebim'de kaydı olmadığı için Nebim numarası yok; kargoya çıktıysa Nebim dışından çıkmış demektir."
                            : r.shipment_check.nebim_status === 'error' ? 'Nebim yanıt vermedi' : "Nebim'de bu siparişe ait kayıt bulunamadı"}
                        >
                          Nebim: {r.shipment_check.ticimax_transferred === false ? "aktarılmamış ⚠" : r.shipment_check.nebim_status === 'error' ? 'sorgulanamadı' : 'kayıt yok'}
                        </div>
                      )}
                      <SuratButtons orderNo={r.order_no} nebimNo={r.shipment_check?.nebim_order_number} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-gray-800 max-w-[180px] truncate">{r.customer_name || '—'}</div>
                      <div className="text-xs text-gray-500">{r.phone || r.customer_email || ''}</div>
                      {r.city && <div className="text-xs text-gray-400">{r.city}</div>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-gray-800">{r.status_label}</div>
                      {r.status_updated_at && <div className="text-xs text-gray-400">{fmtDateTime(r.status_updated_at)} itibarıyla</div>}
                      {r.shipment_check && r.shipment_check.verdict !== 'disabled' && <VerdictBadge row={r} check={r.shipment_check} />}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                      {fmtDay(r.due_date)}
                      <div className="text-xs text-gray-400">kargoya çıkış</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={clsx('inline-block font-bold text-xs px-2 py-1 rounded-md', delayCls(r.delay_days))}>+{r.delay_days} gün</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-900">{money(r.total_amount)}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {r.items.slice(0, 4).map((it, i) => (
                          <ProductThumb
                            key={i}
                            url={it.image_url}
                            title={`${it.product_name} ${it.variant_info || ''} ×${it.quantity}`}
                            onClick={() => openImage(r.items.filter((x) => x.image_url), Math.max(0, r.items.filter((x) => x.image_url).indexOf(it)))}
                            className="w-8 h-12"
                          />
                        ))}
                        {r.items.length > 4 && (
                          <button onClick={() => setOpen(r.id)} className="w-8 h-12 rounded-lg bg-gray-100 text-[10px] font-semibold flex items-center justify-center text-gray-600 hover:bg-gray-200" title="Tüm ürünler">
                            +{r.items.length - 4}
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{r.items.reduce((a, b) => a + b.quantity, 0)} adet</div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={r.review?.state || 'new'}
                        onChange={(e) => updateReview(r.id, { state: e.target.value as ReviewState })}
                        className={clsx('text-xs font-medium border rounded-md px-1.5 py-1', meta.cls)}
                      >
                        {STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      {r.review?.assigned_name && <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><UserIcon size={11} /> {r.review.assigned_name}</div>}
                      {r.review?.note && <div className="text-xs text-gray-400 mt-0.5 max-w-[160px] truncate" title={r.review.note}>“{r.review.note}”</div>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.admin_url && (
                        <a href={r.admin_url} target="_blank" rel="noreferrer" title="Ticimax'ta aç" className="inline-block mr-2 text-orange-500 hover:text-orange-700">
                          <ExternalLink size={15} />
                        </a>
                      )}
                      <button onClick={() => setOpen(isOpen ? null : r.id)} className="text-gray-400 hover:text-gray-700">
                        <ChevronRight size={16} className={clsx('transition-transform', isOpen && 'rotate-90')} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <td colSpan={10} className="px-4 py-4">
                        <DetailPanel
                          row={r}
                          cargoEnabled={!!stats?.cargo_check_enabled}
                          users={stats?.users || []}
                          onSave={(body) => updateReview(r.id, body).then(() => flash('Kaydedildi'))}
                          onRefreshed={(msg) => { flash(msg); reload() }}
                          onImage={openImage}
                        />
                      </td>
                    </tr>
                  )}
                </RowFragment>
              )
            })}
          </tbody>
        </table>
        {loadingMore && <div className="px-4 py-3 text-center text-sm text-gray-500 border-t border-gray-100">Yükleniyor…</div>}
        {!loading && rows.length > 0 && page >= lastPage && total > PER_PAGE && (
          <div className="px-4 py-3 text-center text-xs text-gray-400 border-t border-gray-100">Tüm geciken siparişler gösterildi ({total.toLocaleString('tr-TR')})</div>
        )}
        <div ref={sentinelRef} />
      </div>

      {lightbox && <ImageLightbox items={lightbox.items} index={lightbox.index} onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))} onClose={() => setLightbox(null)} />}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}
    </div>
  )
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Th({ label, sortKey, sortBy, sortDir, onSort }: { label: string; sortKey?: string; sortBy?: string; sortDir?: string; onSort?: (k: string) => void }) {
  if (!sortKey || !onSort) return <th className="px-3 py-2">{label}</th>
  return (
    <th className="px-3 py-2">
      <button onClick={() => onSort(sortKey)} className={clsx('flex items-center gap-1', sortBy === sortKey && 'text-gray-900 font-semibold')}>
        {label} {sortBy === sortKey && (sortDir === 'desc' ? '↓' : '↑')}
      </button>
    </th>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-xs px-2.5 py-1 rounded-full border transition-colors',
        active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      )}
    >
      {children}
    </button>
  )
}

const TONES: Record<string, string> = {
  red: 'text-red-600', orange: 'text-orange-600', blue: 'text-blue-600', rose: 'text-rose-600',
  purple: 'text-purple-600', gray: 'text-gray-900',
}

function Card({ label, hint, value, tone, icon, active, onClick }: {
  label: string; hint?: string; value: number | string; tone: string; icon?: React.ReactNode; active?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        'text-left bg-white rounded-xl border p-3 shadow-sm transition-colors',
        active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-100',
        onClick ? 'hover:border-indigo-200 cursor-pointer' : 'cursor-default'
      )}
    >
      <div className="text-xs text-gray-500 flex items-center gap-1">{icon}{label}</div>
      <div className={clsx('text-xl font-extrabold mt-1', TONES[tone])}>{typeof value === 'number' ? value.toLocaleString('tr-TR') : value}</div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </button>
  )
}

function DetailPanel({ row, cargoEnabled, users, onSave, onRefreshed, onImage }: {
  row: DelayRow
  cargoEnabled: boolean
  users: { id: number; name: string }[]
  onSave: (body: Partial<Review>) => Promise<void>
  onRefreshed: (msg: string) => void
  onImage: (items: LightboxItem[], index: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = row.items.length > COLLAPSE_OVER
  const visibleItems = collapsible && !expanded ? row.items.slice(0, COLLAPSED_SHOW) : row.items
  const withImage = row.items.filter((x) => x.image_url)
  const [state, setState] = useState<ReviewState>(row.review?.state || 'new')
  const [note, setNote] = useState(row.review?.note || '')
  const [assignee, setAssignee] = useState<string>(row.review?.assigned_user_id ? String(row.review.assigned_user_id) : '')
  const [followUp, setFollowUp] = useState(row.review?.follow_up_at || '')
  const [saving, setSaving] = useState(false)
  const [events, setEvents] = useState<DelayEvent[]>([])

  const loadEvents = useCallback(() => {
    api.get<DelayEvent[]>(`/crm/delays/${row.id}/events`).then((res) => setEvents(res.data)).catch(() => undefined)
  }, [row.id])
  useEffect(() => { loadEvents() }, [loadEvents])

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        state,
        note: note || null,
        assigned_user_id: assignee ? Number(assignee) : null,
        follow_up_at: followUp || null,
      })
      loadEvents()
    } finally {
      setSaving(false)
    }
  }

  // Sipariş statüsü — Ticimax'a CANLI yazar, ardından Ticimax'tan geri okuyup doğrular
  const [newStatus, setNewStatus] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [notify, setNotify] = useState(false)
  const [changing, setChanging] = useState(false)

  const changeStatus = async () => {
    const target = SETTABLE_STATUSES.find((x) => String(x.value) === newStatus)
    if (!target) return
    if (!window.confirm(`${row.order_no} siparişinin statüsü Ticimax'ta "${row.status_label}" → "${target.label}" olarak değiştirilecek.${notify ? ' Müşteriye e-posta gidecek.' : ''} Onaylıyor musunuz?`)) return
    setChanging(true)
    try {
      const res = await api.post(`/crm/delays/${row.id}/status`, {
        status: target.value,
        notify,
        tracking_no: target.value === 6 ? trackingNo || null : null,
      })
      const d = res.data
      onRefreshed(
        d.verified
          ? `Ticimax güncellendi: ${d.status_label}${d.still_delayed ? ' (hâlâ gecikmede)' : ' — gecikmeden çıktı'}`
          : `Ticimax isteği kabul etti ama statü doğrulanamadı (şu an: ${d.status_label})`
      )
      setNewStatus('')
      setTrackingNo('')
      loadEvents()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message
      onRefreshed(msg || 'Statü değiştirilemedi')
    } finally {
      setChanging(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Sipariş + ürünler */}
      <div className="lg:col-span-2 space-y-3">
        {row.admin_url && (
          <a href={row.admin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600">
            <ExternalLink size={14} /> Ticimax'ta aç
          </a>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Info label="Sipariş tarihi" value={fmtDateTime(row.order_date)} />
          <Info label="Söz verilen kargoya çıkış" value={fmtDay(row.due_date)} />
          <Info label="Son durum değişimi" value={fmtDateTime(row.status_updated_at)} />
          <Info label="Ödenen / tutar" value={`${money(row.paid_amount)} / ${money(row.total_amount)}`} />
          <Info label="Kargo" value={row.cargo_company || '—'} />
          <Info
            label="Takip no"
            value={row.cargo_tracking_no
              ? (row.cargo_tracking_url ? <a href={row.cargo_tracking_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{row.cargo_tracking_no}</a> : row.cargo_tracking_no)
              : 'yok'}
          />
          <Info label="Teslimat" value={row.city || '—'} />
          <Info label="E-posta" value={row.customer_email || '—'} />
        </div>

        <ShipmentCheckCard row={row} cargoEnabled={cargoEnabled} onChecked={onRefreshed} />

        <div className="bg-white rounded-lg border border-gray-100 divide-y divide-gray-50">
          {row.items.length === 0 && <div className="p-3 text-xs text-gray-400">Ürün bilgisi yok</div>}
          {visibleItems.map((it, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <ProductThumb url={it.image_url} onClick={() => onImage(withImage, Math.max(0, withImage.indexOf(it)))} className="w-16 h-24" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-800 truncate">{it.product_name}</div>
                <div className="text-xs text-gray-500">{[it.variant_info, it.sku].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold text-gray-900">×{it.quantity}</div>
                {it.status_label && <div className="text-gray-400">{it.status_label}</div>}
              </div>
            </div>
          ))}
          {collapsible && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-orange-700 bg-orange-50/50 hover:bg-orange-50"
            >
              {expanded
                ? <><ChevronUp size={14} /> Ürünleri gizle</>
                : <><ChevronDown size={14} /> +{row.items.length - visibleItems.length} ürün daha göster</>}
            </button>
          )}
        </div>
      </div>

      {/* Statü + müdahale + geçmiş */}
      <div className="space-y-3">
        <div className="bg-white rounded-lg border border-orange-200 p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-700">Sipariş statüsü <span className="font-normal text-gray-400">· Ticimax'a yazılır</span></div>
          <div className="text-sm">Şu an: <b>{row.status_label}</b></div>
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="">Yeni statü seçin…</option>
            {SETTABLE_STATUSES.filter((x) => x.value !== row.status).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          {newStatus === '6' && (
            <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="Kargo takip no (isteğe bağlı)" className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
          )}
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Müşteriye Ticimax e-postası gönder
          </label>
          <button onClick={changeStatus} disabled={!newStatus || changing} className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold bg-orange-500 text-white rounded-lg py-2 hover:bg-orange-600 disabled:opacity-50">
            <RefreshCw size={14} className={clsx(changing && 'animate-spin')} /> {changing ? 'Ticimax güncelleniyor…' : "Statüyü Ticimax'ta güncelle"}
          </button>
          <p className="text-[11px] text-gray-400">İptal ve iade işlemleri para iadesi gerektirdiği için İade modülünden yapılır.</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-100 p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-700">Müdahale</div>
          <select value={state} onChange={(e) => setState(e.target.value as ReviewState)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            {STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="">Sorumlu yok</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="block text-xs text-gray-500">
            Takip tarihi
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Not: ne yapıldı, müşteriye ne söylendi, depo ne dedi…"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
          />
          <button onClick={save} disabled={saving} className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg py-2 hover:bg-indigo-700 disabled:opacity-50">
            <Save size={14} /> Kaydet
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-2"><History size={13} /> Geçmiş</div>
          {events.length === 0 && <div className="text-xs text-gray-400">Henüz işlem yok</div>}
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {events.map((e) => (
              <li key={e.id} className="text-xs">
                <div className="text-gray-400">{fmtDateTime(e.created_at)} · {e.user?.name || 'Sistem'}</div>
                <div className="text-gray-700">
                  {e.type === 'state'
                    ? <>Durum: {stateMeta(e.from_state as ReviewState).label} → <b>{stateMeta(e.to_state as ReviewState).label}</b></>
                    : e.note}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-2.5 py-2">
      <div className="text-gray-400">{label}</div>
      <div className="text-gray-800 font-medium truncate">{value}</div>
    </div>
  )
}

function SettingsCard({ config, cargoEnabled, onSaved }: { config: Stats['config']; cargoEnabled: boolean; onSaved: () => void }) {
  const [lookback, setLookback] = useState(config.lookback_days)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/crm/delays/settings', { lookback_days: lookback })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="text-sm font-semibold text-gray-800">Gecikme eşikleri</div>
      <p className="text-xs text-gray-500">
        Hazırlık gecikmesi, ürün sayfasındaki "Bugün Kargoda" kesim takvimine göre hesaplanır
        {config.has_schedule ? '' : ' (takvim kapalı — sipariş gününden 1 iş günü sonrası esas alınır)'}.
        Yalnız kargoya verilmemiş statüler (Siparişiniz Alındı, Onay, Paketleniyor, Tedarik Ediliyor) gecikme sayılır; "Kargoya Verildi" ve sonrası sayılmaz.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="text-xs text-gray-600">
          Geriye bakış (gün)
          <input type="number" min={7} max={365} value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="mt-1 block w-32 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </label>
      </div>
      <button onClick={save} disabled={saving} className="text-sm font-semibold bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Kaydet</button>

      {cargoEnabled && <CargoAccountsSection />}
    </div>
  )
}

interface CargoAccount { key: string; label: string; username: string | null; connected: boolean }

/** Sürat carileri (kargo kontrolü). Şifre şifreli saklanır, panele asla geri gelmez. */
function CargoAccountsSection() {
  const [accounts, setAccounts] = useState<CargoAccount[]>([])
  const [edit, setEdit] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.get<CargoAccount[]>('/crm/delays/cargo-accounts').then((r) => setAccounts(r.data)).catch(() => undefined)
  }, [])

  const start = (a: CargoAccount) => { setEdit(a.key); setUsername(a.username || ''); setPassword(''); setMsg(null) }

  const save = async () => {
    if (!edit) return
    setSaving(true); setMsg(null)
    try {
      const res = await api.put<{ accounts: CargoAccount[]; today_count: number }>('/crm/delays/cargo-accounts', { key: edit, username: username.trim(), password })
      setAccounts(res.data.accounts)
      setEdit(null); setPassword('')
      setMsg({ ok: true, text: `Bağlandı — Sürat son 7 günde ${res.data.today_count.toLocaleString('tr-TR')} gönderi döndürdü. 50 günlük geçmiş arka planda çekiliyor; kargo kontrolü birkaç dakika içinde yenilenecek.` })
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setMsg({ ok: false, text: m || 'Kaydedilemedi' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Truck size={14} className="text-sky-600" /> Sürat Kargo carileri <span className="text-xs font-normal text-gray-400">· kargo kontrolü için (salt okuma)</span></div>
      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.key} className="flex items-center gap-3 flex-wrap text-sm">
            <span className="w-44 text-gray-700">{a.label}</span>
            {a.connected
              ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Bağlı · {a.username}</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Bağlı değil</span>}
            {edit !== a.key && (
              <button onClick={() => start(a)} className="text-xs text-indigo-600 hover:underline">{a.connected ? 'Değiştir' : 'Bağla'}</button>
            )}
            {edit === a.key && (
              <div className="flex items-center gap-2 flex-wrap">
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Cari kodu" className="w-36 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Web servis şifresi" className="w-44 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                <button onClick={save} disabled={saving || !username.trim() || !password} className="text-xs font-semibold bg-indigo-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50">
                  {saving ? 'Sürat\'ta deneniyor…' : 'Test et ve kaydet'}
                </button>
                <button onClick={() => setEdit(null)} className="text-xs text-gray-500">Vazgeç</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <div className={clsx('text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</div>}
      <p className="text-[11px] text-gray-400">Şifre kaydetmeden önce Sürat'ta denenir, şifreli saklanır ve panelde bir daha gösterilmez.</p>
    </div>
  )
}

/* Tıklanmayan küçük görsel (ürün listesi satırı zaten bir buton) — kırpmasız thumb */
function ProductThumbStatic({ url, className }: { url: string | null; className: string }) {
  const [src, setSrc] = useState(url ? url.replace(/\/UrunResimleri\/buyuk\//i, '/UrunResimleri/thumb/') : null)
  if (!src) return <div className={clsx(className, 'rounded bg-gray-100 shrink-0')} />
  return (
    <div className={clsx(className, 'rounded bg-white border border-gray-100 shrink-0 overflow-hidden flex items-center justify-center')}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setSrc(url && src !== url ? url : null)} className="max-w-full max-h-full object-contain" />
    </div>
  )
}

function SuratButtons({ orderNo, nebimNo }: { orderNo: string; nebimNo?: string | null }) {
  const cls = 'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border'
  return (
    <div className="mt-1 flex items-center gap-1">
      <a href={suratUrl(orderNo)} target="_blank" rel="noreferrer" title="Sürat Kargo'da TB numarasıyla sorgula" className={clsx(cls, 'border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100')}>
        <Truck size={10} /> Sürat · TB
      </a>
      {nebimNo ? (
        <a href={suratUrl(nebimNo)} target="_blank" rel="noreferrer" title="Sürat Kargo'da Nebim sipariş numarasıyla sorgula" className={clsx(cls, 'border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100')}>
          <Truck size={10} /> Sürat · Nebim
        </a>
      ) : (
        <span title="Nebim sipariş numarası henüz bulunamadı" className={clsx(cls, 'border-gray-200 text-gray-300 cursor-not-allowed')}>
          <Truck size={10} /> Sürat · Nebim
        </span>
      )}
    </div>
  )
}

function VerdictBadge({ row, check }: { row: DelayRow; check: ShipmentCheck }) {
  const meta = verdictMeta(check.verdict)
  const loud = check.verdict === 'wrong_account' || check.verdict === 'shipped'
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const w = 360
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: r.bottom + 6 })
  }

  return (
    <div className="mt-1.5">
      <span
        onMouseEnter={loud || check.summary ? show : undefined}
        onMouseLeave={() => setPos(null)}
        className={clsx(
          'inline-flex items-center gap-1 font-semibold rounded border cursor-help',
          loud ? 'text-xs px-2 py-1 shadow-sm' : 'text-[10px] px-1.5 py-0.5',
          meta?.cls,
        )}
      >
        {loud ? <AlertTriangle size={12} /> : <Truck size={10} />} {meta?.label || check.verdict_label}
      </span>
      {pos && (
        <div style={{ left: pos.x, top: pos.y, width: 360 }} className="fixed z-50 rounded-lg border border-gray-200 bg-white shadow-xl p-3 text-xs text-gray-700 whitespace-normal pointer-events-none">
          <VerdictDetail row={row} check={check} />
        </div>
      )}
    </div>
  )
}

/** Rozet üzerine gelince açılan açıklama (yanlış cari / Sürat'ta çıkış). */
function VerdictDetail({ row, check }: { row: DelayRow; check: ShipmentCheck }) {
  const meta = verdictMeta(check.verdict)
  const hit = check.matches.find((m) => m.wrong_account) || check.matches[0]
  const payLabel = PAYMENT_METHOD_LABELS[(row.payment_method || 'other') as PaymentMethodKey] || row.payment_method || '—'
  const expected = ACCOUNT_LABELS[check.expected_account || ''] || '—'

  if (check.verdict === 'wrong_account' && hit) {
    const actual = ACCOUNT_LABELS[hit.account_key] || hit.account_key
    return (
      <div className="space-y-2">
        <div className="font-bold text-red-700 flex items-center gap-1"><AlertTriangle size={13} /> Yanlış cariden çıkış</div>
        <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5">
          <span className="text-gray-400">Ödeme yöntemi</span><b>{payLabel}</b>
          <span className="text-gray-400">Çıkması gereken</span><b className="text-emerald-700">{expected}</b>
          <span className="text-gray-400">Çıktığı cari</span><b className="text-red-700">{actual}</b>
          <span className="text-gray-400">Takip no</span><span className="font-mono">{hit.tracking_no}</span>
          <span className="text-gray-400">Çıkış</span><span>{hit.shipped_at}</span>
          <span className="text-gray-400">Sürat durumu</span><span>{hit.status || hit.delivery_status || '—'}</span>
          <span className="text-gray-400">Alıcı</span><span>{hit.recipient_name} · {[hit.district, hit.city].filter(Boolean).join(' / ')}</span>
          <span className="text-gray-400">Eşleşme</span><span>{MATCHED_BY[hit.matched_by || ''] || 'kod'}: <span className="font-mono">{hit.web_order_code}</span></span>
        </div>
        <div className="rounded bg-red-50 border border-red-100 p-2 text-red-800">
          {check.expected_account === 'cod'
            ? <>Kapıda ödemeli sipariş peşin (normal) cariden gönderilmiş: Sürat kapıda <b>{money(row.total_amount)}</b> tahsil etmemiş olabilir; müşteri ürünü ödemeden teslim almış olabilir.</>
            : <>Peşin ödenmiş sipariş kapıda ödeme carisinden gönderilmiş: müşteriden kapıda ikinci kez tahsilat istenmiş olabilir.</>}
        </div>
        <div className="text-gray-500">Yapılacak: Sürat'ta bu gönderinin tahsilat bilgisini kontrol edin, gerekirse müşteriyle iletişime geçin; ardından Ticimax statüsünü "Kargoya Verildi" yapın.</div>
      </div>
    )
  }

  if (check.verdict === 'shipped' && hit) {
    return (
      <div className="space-y-2">
        <div className="font-bold text-red-600 flex items-center gap-1"><AlertTriangle size={13} /> Sipariş Sürat'ta çıkmış</div>
        <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5">
          <span className="text-gray-400">Ticimax statüsü</span><b>{row.status_label}</b>
          <span className="text-gray-400">Cari</span><span>{ACCOUNT_LABELS[hit.account_key] || hit.account_key} (doğru cari)</span>
          <span className="text-gray-400">Takip no</span><span className="font-mono">{hit.tracking_no}</span>
          <span className="text-gray-400">Çıkış</span><span>{hit.shipped_at}</span>
          <span className="text-gray-400">Sürat durumu</span><span>{hit.status || hit.delivery_status || '—'}</span>
        </div>
        <div className="text-gray-500">Sipariş fiilen çıkmış ama Ticimax'ta güncellenmemiş. Detaydan statüyü "Kargoya Verildi" yapıp takip no'yu girin; gecikme listesinden düşer.</div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="font-semibold">{meta?.label || check.verdict_label}</div>
      {check.summary && <div className="text-gray-600">{check.summary}</div>}
    </div>
  )
}

function ShipmentHitRow({ h, kind }: { h: ShipmentHit; kind: 'match' | 'candidate' }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="font-medium text-gray-800">
          {kind === 'match'
            ? <>Kod <span className="font-mono">{h.web_order_code}</span> <span className="text-gray-400">({MATCHED_BY[h.matched_by || ''] || 'eşleşti'})</span></>
            : <>{CANDIDATE_TYPE[h.type || ''] || 'Aday'}{h.web_order_code && <> · kod <span className="font-mono">{h.web_order_code}</span></>}
              {h.related_order_no && <span className="text-gray-400"> ({h.related_order_no}{h.related_status ? ` · ${h.related_status}` : ''})</span>}</>}
        </div>
        <div className="text-gray-600">
          {h.recipient_name} · {[h.district, h.city].filter(Boolean).join(' / ')}
          {kind === 'candidate' && <span className={clsx('ml-1', h.district_match ? 'text-emerald-600' : 'text-gray-400')}>{h.district_match ? '· ilçe tutuyor' : '· yalnız il tutuyor'}</span>}
        </div>
        {h.address && <div className="text-gray-400 truncate max-w-[520px]" title={h.address}>{h.address}</div>}
        <div className="text-gray-500">
          {ACCOUNT_LABELS[h.account_key] || h.account_key} · {h.shipped_at} · {h.status || h.delivery_status || ''}
          {h.wrong_account && <b className="text-red-600"> · YANLIŞ CARİ</b>}
        </div>
      </div>
      <a href={suratUrl(h.tracking_no)} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 text-sky-700 hover:underline font-mono">
        {h.tracking_no} <ExternalLink size={11} />
      </a>
    </div>
  )
}

function ShipmentCheckCard({ row, cargoEnabled, onChecked }: { row: DelayRow; cargoEnabled: boolean; onChecked: (msg: string) => void }) {
  const [check, setCheck] = useState<ShipmentCheck | null>(row.shipment_check)
  const [running, setRunning] = useState(false)
  useEffect(() => { setCheck(row.shipment_check) }, [row.shipment_check])

  const run = async () => {
    setRunning(true)
    try {
      const res = await api.post<ShipmentCheck>(`/crm/delays/${row.id}/shipment-check`)
      setCheck(res.data)
      onChecked(res.data.verdict === 'disabled' ? `Nebim: ${res.data.nebim_order_number || 'kayıt yok'}` : `Kargo kontrolü: ${res.data.verdict_label}`)
    } catch {
      onChecked(cargoEnabled ? 'Kargo kontrolü yapılamadı' : 'Nebim yenilenemedi')
    } finally {
      setRunning(false)
    }
  }

  const meta = verdictMeta(check?.verdict)

  // Sürat cari kontrolü kapalı: yalnız Nebim bilgisi + Sürat takip linkleri
  if (!cargoEnabled || check?.verdict === 'disabled') {
    return (
      <div className="rounded-lg border border-gray-100 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold text-gray-700">Nebim</div>
          <div className="flex items-center gap-2">
            <SuratButtons orderNo={row.order_no} nebimNo={check?.nebim_order_number} />
            <button onClick={run} disabled={running} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw size={12} className={clsx(running && 'animate-spin')} /> {running ? 'Yenileniyor…' : "Nebim'i yenile"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Info label="Nebim sipariş no" value={check?.nebim_order_number || (check?.ticimax_transferred === false ? "Ticimax Nebim'e aktarmamış" : check?.nebim_status === 'not_found' ? "Nebim'e düşmemiş" : check?.nebim_status === 'error' ? 'Nebim yanıt vermedi' : '—')} />
          <Info label="Nebim fatura no" value={check?.nebim_invoice_number || (check ? 'faturasız' : '—')} />
        </div>
        {check?.ticimax_transferred === false && (
          <div className="text-xs text-amber-700">Ticimax bu siparişi Nebim'e aktarmamış (Nebim numarası bu yüzden yok).</div>
        )}
      </div>
    )
  }

  return (
    <div className={clsx('rounded-lg border p-3 space-y-2', check?.verdict === 'wrong_account' ? 'border-red-300 bg-red-50/40' : 'border-sky-100 bg-white')}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"><Truck size={13} className="text-sky-600" /> Kargo kontrolü <span className="font-normal text-gray-400">· Nebim + Sürat (salt okuma)</span></div>
        <div className="flex items-center gap-2">
          <SuratButtons orderNo={row.order_no} nebimNo={check?.nebim_order_number} />
          <button onClick={run} disabled={running} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={12} className={clsx(running && 'animate-spin')} /> {running ? 'Kontrol ediliyor…' : 'Şimdi kontrol et'}
          </button>
        </div>
      </div>

      {!check && <div className="text-xs text-gray-400">Bu sipariş henüz kontrol edilmedi (otomatik kontrol 30 dakikada bir çalışır).</div>}

      {check && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className={clsx('inline-flex items-center font-semibold px-2 py-0.5 rounded border', meta?.cls)}>{meta?.label || check.verdict_label}</span>
            <span className="text-gray-500">
              Beklenen cari: <b>{ACCOUNT_LABELS[check.expected_account || ''] || '—'}</b>
            </span>
            {check.checked_at && <span className="text-gray-400">· {fmtDateTime(check.checked_at)} kontrol edildi</span>}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Nebim sipariş no" value={check.nebim_order_number || (check.ticimax_transferred === false ? "Ticimax Nebim'e aktarmamış" : check.nebim_status === 'not_found' ? "Nebim'e düşmemiş" : check.nebim_status === 'error' ? 'Nebim yanıt vermedi' : '—')} />
            <Info label="Nebim fatura no" value={check.nebim_invoice_number || 'faturasız'} />
          </div>

          {check.verdict === 'wrong_account' && (
            <div className="text-xs text-red-700 font-medium">
              Bu sipariş {ACCOUNT_LABELS[check.expected_account || '']} yerine başka cariden çıkmış.
              {check.expected_account === 'cod' && ' Kapıda tahsilat yapılmamış olabilir — kontrol edin.'}
            </div>
          )}
          {check.verdict === 'invoiced' && (
            <div className="text-xs text-blue-700">Nebim'de faturası kesilmiş ama bağlı Sürat carilerinde bu siparişe ait gönderi bulunamadı (TB no, Nebim no, ad/adres ile arandı).</div>
          )}
          {check.verdict === 'unverified' && (
            <div className="text-xs text-amber-700">Siparişin çıkması gereken cari ({ACCOUNT_LABELS[check.expected_account || '']}) henüz bağlı olmadığı için "çıkış yok" denemez. Sürat butonlarıyla elle kontrol edin.</div>
          )}
          {check.ticimax_transferred === false && (
            <div className="text-xs text-amber-700">Ticimax bu siparişi Nebim'e aktarmamış (Nebim numarası bu yüzden yok). Kargoya çıktıysa Nebim dışından, elle çıkmış demektir.</div>
          )}
          {check.verdict === 'wrong_account' && <div className="rounded-lg border border-red-200 bg-white p-2"><VerdictDetail row={row} check={check} /></div>}
          {check.verdict === 'not_shipped' && (
            <div className="text-xs text-gray-600">Bağlı Sürat carilerinde TB no, Ticimax ID, Nebim no veya alıcı adı + il ile eşleşen gönderi yok; Nebim'de fatura yok.</div>
          )}

          {check.matches.length > 0 && (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {check.matches.map((h) => <ShipmentHitRow key={h.account_key + h.tracking_no} h={h} kind="match" />)}
            </div>
          )}
          {check.candidates.length > 0 && (
            <div className="border-t border-gray-100">
              <div className="text-[11px] text-amber-700 pt-2">Sipariş koduyla eşleşmeyen ama alıcı adı + il tutan gönderiler — manuel çıkış olabilir, Sürat'ta açıp kontrol edin:</div>
              <div className="divide-y divide-gray-100">
                {check.candidates.map((h) => <ShipmentHitRow key={h.account_key + h.tracking_no} h={h} kind="candidate" />)}
              </div>
            </div>
          )}

          {check.missing_accounts.length > 0 && (
            <div className="text-[11px] text-amber-700 flex items-center gap-1">
              <AlertTriangle size={11} /> {check.missing_accounts.map((k) => ACCOUNT_LABELS[k] || k).join(', ')} bağlı değil — o cariden yapılan çıkışlar bu kontrolde görünmez.
            </div>
          )}
        </>
      )}
    </div>
  )
}
