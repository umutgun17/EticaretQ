import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { RETURNS_LIST_KEY, RETURNS_SCROLL_KEY } from './returnsListState'
import {
  RotateCcw, Search, AlertTriangle, Clock, PackageCheck, RefreshCw, FileBarChart, Users, ShieldCheck,
  CheckCircle2, XCircle, Truck, Upload, Copy, Wallet, ExternalLink, Wrench, StickyNote, ListChecks, Loader2,
  Landmark, Banknote, CreditCard, PackageX, UserCog, Undo2,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/contexts/AuthContext'
import {
  returnsAdminApi,
  statusBadgeClass,
  fmtMoney,
  fmtHoursLeft,
  cargoProviderLabel,
  reasonLabel,
  typeBadge,
  type ReturnListRow,
  type ReturnStats,
} from '@/lib/returnsAdminApi'

/**
 * İki çalışma ekranı (kullanıcı kararı 2026-07-07):
 *  - PERSONEL: iade adımları (Talep Alındı → Yolda → Depoda). Depoda sekmesi onay/red çalışma
 *    kuyruğudur: onaya EN AZ süresi kalan EN ÜSTTE (timer), işlem görenler Onaylı/Red sekmelerinde.
 *  - YÖNETİCİ: personelin onayladıkları (+ iptallerin para onayı) burada onaylanır.
 *
 * Trendyol tarzı liste (2026-07-21): satırlar ürün/kargo/sebep bilgisi taşır ve onay/red/kargo
 * adımları detaya girmeden satır üzerinden yapılır. Sunucu her aksiyonu ayrıca doğrular.
 */
type TabDef = { key: string; label: string; sort?: 'sla' | 'workqueue'; count?: (s: ReturnStats) => number }

// Sıra kullanıcı kararı (27.07): Depoda → Yolda → Talep Alındı → Talep İptal → Onaylı → Red.
// "Talep İptal" = cancelled_by_customer (7 günde kullanılmayıp otomatik pasifleşen kodlar dahil).
const STAFF_TABS: TabDef[] = [
  { key: 'received', label: 'Depoda — Onay Bekleyen', sort: 'sla', count: (s) => s.received },
  { key: 'in_transit', label: 'Yolda', count: (s) => s.in_transit },
  { key: 'requested', label: 'Talep Alındı', count: (s) => s.requested },
  { key: 'cancelled_by_customer', label: 'Talep İptal', count: (s) => s.cancelled },
  { key: 'approved', label: 'Onaylı', count: (s) => s.approved_group },
  { key: 'rejected', label: 'Red', count: (s) => s.rejected },
  // 'all' sentineli: boş key URL'den status'u siler ve sayfa varsayılan sekmeye döner (27.07 bug'ı).
  { key: 'all', label: 'Tümü', sort: 'workqueue', count: (s) => s.total },
]

// Yönetici sekmeleri (kullanıcı isteği 05.08): "Yönetici Onaylı" (manager_approved) sekmesi
// KALDIRILDI — o statü geçicidir: para onayı anında iade koşar ve talep ya Refunded olur ya geri
// sarılır, sekme hep boş görünüyordu. Onaylanan talepler artık "Onaylı — İade Edildi"de;
// "Kapanmış" yerine Red ve Talep İptal ayrı sekmeler.
const MANAGER_TABS: TabDef[] = [
  { key: 'awaiting_manager', label: 'Para Onayı Bekleyen', sort: 'sla', count: (s) => s.awaiting_manager },
  { key: 'defect_review', label: 'Kusur Onayı Bekleyen', count: (s) => s.defect_review },
  // PERSONEL kaynaklı eksik/hatalı ürün iadeleri (kullanıcı isteği 23.09): para onayı bekleyenler
  // "Para Onayı Bekleyen" içinde de görünür; burada ayrıca kendi sekmesinde toplanır.
  { key: 'shortage_awaiting', label: 'Eksik/Hatalı Ürün (Personel)', sort: 'sla', count: (s) => s.shortage_awaiting },
  // Firmadan çıkıp depoya GERİ DÖNEN siparişler (kullanıcı isteği 05.10): personel kaydeder, müşteriye bildirim
  // gitmez, onay sonrası Ticimax İptal — yönetici Eksik/Hatalı'dan ayırt edebilsin diye ayrı sekme.
  { key: 'returned_awaiting', label: 'Geri Dönen Sipariş (Personel)', sort: 'sla', count: (s) => s.returned_awaiting ?? 0 },
  { key: 'refunded_done', label: 'Onaylı — İade Edildi', count: (s) => s.refunded_done },
  { key: 'rejected', label: 'Red', count: (s) => s.rejected },
  { key: 'cancelled_by_customer', label: 'Talep İptal', count: (s) => s.cancelled },
  // 'all' sentineli: boş key URL'den status'u siler ve sayfa varsayılan sekmeye döner (27.07 bug'ı).
  { key: 'all', label: 'Tümü', sort: 'workqueue', count: (s) => s.total },
]

/** Reddedilebilir durumlar (ReturnDetailPage ile aynı; sunucu ayrıca doğrular). */
const REJECTABLE = ['pending', 'awaiting_shipment', 'in_transit', 'received', 'staff_approved', 'processing']

/** Personelin listeden ilerletebileceği kargo/işlem adımları (yalnız İADE; iptal otomatik yürür). */
const NEXT_TRANSITIONS: Record<string, { to: string; label: string }[]> = {
  pending: [{ to: 'awaiting_shipment', label: 'Kargo Kodu Oluştur' }],
  awaiting_shipment: [{ to: 'in_transit', label: 'Yolda İşaretle' }, { to: 'received', label: 'Depoya Ulaştı' }],
  in_transit: [{ to: 'received', label: 'Depoya Ulaştı' }],
  // Kapanmış talep: ürün iade kodu dışında (firmanın cari numarasıyla) geldiyse elle yeniden açılır.
  cancelled_by_customer: [{ to: 'received', label: 'Depoya Ulaştı' }],
}

/**
 * Depoya teslim bilgisi (kullanıcı isteği 2026-08-03): kargo firmasının bildirdiği teslim
 * tarihi/saati + teslim alan kişi/firma. Kargo firması tarih vermediyse sistemin depoya-ulaştı
 * anına (received_at) düşülür; hiçbiri yoksa satırda gösterilmez.
 */
function deliveryView(r: ReturnListRow): { at: string | null; by: string | null } | null {
  const raw = r.delivery?.delivered_at ?? r.received_at
  const by = r.delivery?.received_by ?? null
  if (!raw && !by) return null
  // Kargo firması yalnız TARİH verdiyse saat 00:00 olarak saklanır → uydurma saat gösterme.
  const at = raw ? (raw.slice(11, 16) === '00:00' ? raw.slice(0, 10) : raw.slice(0, 16).replace('T', ' ')) : null
  return { at, by }
}

/** SLA penceresi etiketi: 24 saat ve katlarında gün, aksi halde saat. */
function fmtWindow(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24} gün` : `${hours} sa`
}

function TimerCell({ row }: { row: ReturnListRow }) {
  const t = row.timer
  if (t.hours_left === null) return null
  if (t.sla_breached) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-600 font-medium text-xs">
        <AlertTriangle size={13} /> {fmtHoursLeft(t.hours_left)} gecikme
      </span>
    )
  }
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs', t.hours_left < 24 ? 'text-amber-600' : 'text-gray-500')}>
      <Clock size={13} /> Onaya kalan: {fmtHoursLeft(t.hours_left)}
    </span>
  )
}

/**
 * EKSİK / HATALI ÜRÜN (personel başlattı) kutusu — para onayı penceresinde: kim açtı, kapsam,
 * Ticimax'ta ne yapıldı (kısmi → statü değişmedi) ve onay sonrası ne olacak (özür SMS + kupon).
 */
function ShortageBox({ row }: { row: ReturnListRow }) {
  if (row.type !== 'shortage') return null
  const s = row.shortage
  if (s?.stage === 'returned') {
    return (
      <div className="mb-3 rounded-md border-2 border-teal-400 bg-teal-50 overflow-hidden">
        <div className="bg-teal-600 px-3 py-1.5 flex items-center gap-1.5">
          <Undo2 size={14} className="text-white" />
          <span className="text-xs font-bold text-white uppercase tracking-wide">Geri Dönen Sipariş — Personel Kaydetti</span>
        </div>
        <div className="px-3 py-2 space-y-1.5 text-xs text-teal-900">
          <div>
            <b>{s?.created_by_name ?? row.created_by_name ?? 'Personel'}</b> firmadan çıkıp müşteriye teslim edilemeyen ve <b>depoya geri dönen</b> sipariş için para iadesi başlattı.
            {' '}<b>Müşteriye hiçbir bildirim gitmez</b> (SMS / kupon yok).
            {' '}{s?.is_full
              ? <>Onay sonrası sipariş <b>Ticimax'ta İptal</b> yapılır.</>
              : <>Seçim kısmi — Ticimax sipariş statüsü değiştirilmez.</>}
          </div>
          {s?.summary && <div className="text-gray-600">{s.summary}</div>}
          {s?.staff_note && <div className="rounded bg-white border border-teal-200 px-2 py-1.5 whitespace-pre-wrap text-gray-800">{s.staff_note}</div>}
          {s?.ticimax?.lines?.length ? (
            <ul className="space-y-0.5">
              {s.ticimax.lines.map((l, i) => (
                <li key={i} className={clsx('flex items-start gap-1', l.ok === false ? 'text-rose-700' : l.ok === null ? 'text-gray-500' : 'text-emerald-700')}>
                  <span>{l.ok === false ? '✕' : l.ok === null ? '•' : '✓'}</span><span>{l.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="mb-3 rounded-md border-2 border-rose-300 bg-rose-50 overflow-hidden">
      <div className="bg-rose-500 px-3 py-1.5 flex items-center gap-1.5">
        <PackageX size={14} className="text-white" />
        <span className="text-xs font-bold text-white uppercase tracking-wide">
          {s?.stage === 'delivered' ? 'Teslimat Sonrası Eksik / Hatalı Ürün — Personel Başlattı' : 'Eksik / Hatalı Ürün — Personel Başlattı'}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-xs text-rose-900">
        <div>
          {s?.stage === 'delivered' ? (
            <>
              <b>{s?.created_by_name ?? row.created_by_name ?? 'Personel'}</b> müşterinin bildirdiği eksik/hatalı gelen ürün(ler) için para iadesi başlattı (sipariş teslim edilmiş).
              {' '}<b>Ticimax'ta hiçbir güncelleme yapılmaz</b>; onayda genel özür SMS'i + telafi kuponu gider.
            </>
          ) : (
            <>
              <b>{s?.created_by_name ?? row.created_by_name ?? 'Personel'}</b> siparişin gönderilemeyen ürün(ler)i için para iadesi başlattı.
              {' '}{s?.is_full
                ? <>Seçim <b>siparişin tamamını</b> kapsıyor — sipariş Ticimax'ta iptal edildi.</>
                : <>Kalan ürünler kargolanacak; <b>Ticimax sipariş statüsü değiştirilmez</b>.</>}
            </>
          )}
        </div>
        {s?.summary && <div className="text-gray-600">{s.summary}</div>}
        {s?.staff_note && <div className="rounded bg-white border border-rose-200 px-2 py-1.5 whitespace-pre-wrap text-gray-800">{s.staff_note}</div>}
        {s?.ticimax?.lines?.length ? (
          <ul className="space-y-0.5">
            {s.ticimax.lines.map((l, i) => (
              <li key={i} className={clsx('flex items-start gap-1', l.ok === false ? 'text-rose-700' : l.ok === null ? 'text-gray-500' : 'text-emerald-700')}>
                <span>{l.ok === false ? '✕' : l.ok === null ? '•' : '✓'}</span><span>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

/** Personel notları kutusu — onay pencerelerinde ZORUNLU görünür (telefonla çözülen kapsam değişiklikleri). */
/**
 * KAPIDA ÖDEME uyarısı + havale bilgileri — personel/yönetici onay pencerelerinde gösterilir.
 * Onayı veren kişi, siparişin kapıda ödendiğini ve paranın hangi hesaba gideceğini ONAY ANINDA
 * görmeli (kullanıcı isteği 2026-09-01); bilgi yoksa eksik olduğu net biçimde uyarılır.
 */
function CodBox({ row }: { row: ReturnListRow }) {
  if (!row.is_cod) return null
  const isCancel = row.type === 'cancel'
  const b = row.bank_account

  return (
    <div className="mb-3 rounded-md border-2 border-amber-400 bg-amber-50 overflow-hidden">
      <div className="bg-amber-400 px-3 py-1.5 flex items-center gap-1.5">
        <Banknote size={14} className="text-amber-900" />
        <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">Kapıda Ödemeli Sipariş</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {isCancel ? (
          <p className="text-xs text-amber-900">
            Müşteri kapıda ödeyecekti ve sipariş iptal edildi — <b>tahsilat yapılmadı</b>.
            İade edilecek tutar yoktur.
          </p>
        ) : (
          <>
            <p className="text-xs text-amber-900">
              Para <b>kapıda nakit/kart ile</b> tahsil edildi — karta iade yapılamaz,
              ödeme <b>havale</b> ile yapılacak.
            </p>
            {b ? (
              <div className="rounded bg-white border border-amber-200 px-2.5 py-2 space-y-0.5">
                <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <Landmark size={11} /> Havale Bilgileri
                </div>
                <div className="text-xs text-gray-800"><span className="text-gray-400">Ad soyad:</span> <b>{b.account_holder}</b></div>
                <div className="text-xs text-gray-800 break-all"><span className="text-gray-400">IBAN:</span> <b className="font-mono">{b.iban}</b></div>
                {b.bank_name && <div className="text-xs text-gray-800"><span className="text-gray-400">Banka:</span> {b.bank_name}</div>}
              </div>
            ) : (
              <div className="rounded bg-white border border-rose-300 px-2.5 py-2 text-xs text-rose-700">
                <b>Havale bilgisi yok.</b> Müşteriyle iletişime geçip talep detayındaki
                "Havale Bilgileri" bölümünden ad soyad + IBAN girilmeden para onayı tamamlanamaz.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StaffNotesBox({ row }: { row: ReturnListRow }) {
  const notes = row.staff_notes ?? []
  if (notes.length === 0) return null
  return (
    <div className="mb-3 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
      <div className="text-xs font-semibold text-amber-800 flex items-center gap-1 mb-1">
        <StickyNote size={13} /> Onaydan önce personel notlarını okuyun!
      </div>
      <ul className="space-y-1 max-h-32 overflow-y-auto">
        {notes.map((n) => (
          <li key={n.id} className="text-xs text-gray-700 whitespace-pre-wrap">
            • {n.note}
            <span className="text-[10px] text-gray-400"> ({[n.actor_name, n.created_at?.slice(0, 16)].filter(Boolean).join(' · ')})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warn' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={clsx(
          'text-2xl font-semibold',
          tone === 'danger' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900'
        )}
      >
        {value}
      </div>
    </div>
  )
}

/** Satır aksiyonu onay penceresi: staff onayı / yönetici para onayı / red (gerekçeli). */
type ModalState =
  | { kind: 'approve-staff'; row: ReturnListRow }
  | { kind: 'approve-manager'; row: ReturnListRow }
  | { kind: 'reject'; row: ReturnListRow }
  | { kind: 'defect-approve'; row: ReturnListRow }
  | { kind: 'defect-reject'; row: ReturnListRow }
  | null

/**
 * Toplu onay (kullanıcı isteği 2026-08-11): seçilen talepler MEVCUT TEKİL uçlardan (approve-staff /
 * approve-manager) SIRAYLA, talep başına ayrı istekle geçirilir — backend'de ayrı "toplu" yol YOK.
 * Böylece tek onaydaki HER adım (guard'lar, Ticimax statü yazımı, SMS, para iadesi, vade farkı,
 * başarısızlıkta geri sarma, audit) her talep için birebir aynen çalışır. Bir talep hata verirse
 * atlanır ve kalanlarla devam edilir; sonuç talep başına listede gösterilir.
 */
type BulkItemState = { state: 'waiting' | 'running' | 'ok' | 'error'; message?: string }
type BulkState = {
  kind: 'approve-staff' | 'approve-manager'
  rows: ReturnListRow[]
  results: Record<number, BulkItemState>
  running: boolean
  done: boolean
} | null

export default function ReturnsPage() {
  const { user, hasPermission } = useAuth()
  const canManager = !!user?.can_manager_approve_returns
  const canStaff = !!user?.can_staff_approve_returns
  // Kusur bildirimi kararı yalnızca firma yöneticisi (admin) / süper admin
  const isAdmin = !!user?.is_admin
  const [searchParams, setSearchParams] = useSearchParams()

  const view = canManager && searchParams.get('view') === 'manager' ? 'manager' : 'staff'
  const tabs = view === 'manager' ? MANAGER_TABS : STAFF_TABS
  const defaultTab = view === 'manager' ? 'awaiting_manager' : 'received'
  const status = searchParams.get('status') ?? defaultTab
  const activeTab = tabs.find((t) => t.key === status)

  const [rows, setRows] = useState<ReturnListRow[]>([])
  const [stats, setStats] = useState<ReturnStats | null>(null)
  // Sayfa da URL'de: detaya girip geri gelince (tarayıcı geri / "Listeye dön") aynı sayfa açılır.
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const setPage = (fn: (p: number) => number) => {
    const next = new URLSearchParams(searchParams)
    const p = fn(page)
    if (p > 1) next.set('page', String(p))
    else next.delete('page')
    setSearchParams(next)
  }
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  // Arama da URL'den okunur → tarayıcı geri/ileri ile tutarlı kalır.
  const search = searchParams.get('q') ?? ''
  useEffect(() => { setQ(search) }, [search])
  // Hızlı filtreler (kullanıcı isteği 05.08): tür (iade/iptal/kusur) + iade yöntemi (karta/kupon).
  const typeF = searchParams.get('type') ?? ''
  const methodF = searchParams.get('method') ?? ''
  // Ödeme türü (kullanıcı isteği 04.09): siparişin ödeme şekli — iade yönteminden ayrıdır.
  const payF = searchParams.get('payment') ?? ''

  // Satır içi aksiyon durumu
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [rejectReason, setRejectReason] = useState('')
  // Kusur karar penceresi: şikâyet + tanımlı red nedenleri detay ucundan yüklenir
  const [defectInfo, setDefectInfo] = useState<{ complaint: string | null; reasons: string[] } | null>(null)
  const [defectReason, setDefectReason] = useState('')
  const [rejectFile, setRejectFile] = useState<File | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // Toplu onay seçimi + ilerleme penceresi (yalnız görünür sayfadaki uygun satırlar seçilebilir)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulk, setBulk] = useState<BulkState>(null)

  // Detaydan dönüşte kaldığı yer: liste adresi (ekran/sekme/filtre/arama/sayfa) + kaydırma konumu
  // oturum içinde saklanır; detaydaki "Listeye dön" bu adrese gider, liste yüklenince kaydırma geri gelir.
  const location = useLocation()
  const listKey = location.search
  const restoredRef = useRef<string | null>(null)
  useEffect(() => {
    try { sessionStorage.setItem(RETURNS_LIST_KEY, location.search) } catch { /* yoksay */ }
  }, [location.search])
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const save = () => {
      try { sessionStorage.setItem(RETURNS_SCROLL_KEY, JSON.stringify({ key: listKey, top: main.scrollTop })) } catch { /* yoksay */ }
    }
    main.addEventListener('scroll', save, { passive: true })
    return () => main.removeEventListener('scroll', save)
  }, [listKey])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await returnsAdminApi.list({
        status: status === 'all' ? undefined : status || undefined,
        type: typeF || undefined,
        refund_method: methodF || undefined,
        payment_type: payF || undefined,
        q: search || undefined,
        sort: activeTab?.sort,
        page,
        per_page: 100,
      })
      setRows(res.data)
      setLastPage(res.last_page)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [status, typeF, methodF, payF, search, page, activeTab?.sort])

  const loadStats = useCallback(async () => {
    try {
      setStats(await returnsAdminApi.stats())
    } catch {
      /* yetki yoksa sessiz geç */
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])
  // Liste ilk kez dolunca, aynı adres için saklanan kaydırma konumuna dön (yalnız bir kez).
  useLayoutEffect(() => {
    if (loading || restoredRef.current === listKey) return
    restoredRef.current = listKey
    try {
      const saved = JSON.parse(sessionStorage.getItem(RETURNS_SCROLL_KEY) ?? 'null') as { key: string; top: number } | null
      const main = document.querySelector('main')
      if (saved && main && saved.key === listKey && saved.top > 0) main.scrollTop = saved.top
    } catch { /* yoksay */ }
  }, [loading, listKey])
  useEffect(() => {
    loadStats()
    // Sekme rozetleri personelin gözü önünde güncel kalsın: 60 sn'de bir sessiz tazeleme
    // (yalnız sayaçlar; liste, kullanıcı satırla çalışırken altından değişmesin diye manuel).
    const id = setInterval(loadStats, 60_000)
    return () => clearInterval(id)
  }, [loadStats])

  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (key) next.set('status', key)
    else next.delete('status')
    setSearchParams(next)
  }

  const setView = (v: 'staff' | 'manager') => {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (v === 'manager') next.set('view', 'manager')
    else next.delete('view')
    next.delete('status') // her ekran kendi varsayılan sekmesiyle açılır
    setSearchParams(next)
  }

  const setFilter = (key: 'type' | 'method' | 'payment', value: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (q) next.set('q', q)
    else next.delete('q')
    setSearchParams(next)
  }

  // Kusur karar penceresi açılınca şikâyet metni + tanımlı red nedenlerini detaydan getir.
  useEffect(() => {
    if (modal?.kind === 'defect-approve' || modal?.kind === 'defect-reject') {
      setDefectInfo(null)
      setDefectReason('')
      returnsAdminApi.detail(modal.row.id)
        .then((d) => setDefectInfo({ complaint: d.request.complaint ?? null, reasons: d.request.defect_reject_reasons ?? [] }))
        .catch(() => setDefectInfo({ complaint: null, reasons: [] }))
    }
  }, [modal])

  /** Satır aksiyonu çalıştır: başarıda liste + sayaçlar tazelenir, hata üstte gösterilir. */
  const act = async (rowId: number, fn: () => Promise<unknown>) => {
    setBusyId(rowId)
    setActionError(null)
    try {
      await fn()
      setModal(null)
      setRejectReason('')
      setRejectFile(null)
      await Promise.all([load(), loadStats()])
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } }
      setActionError(err.response?.data?.message ?? 'İşlem başarısız oldu.')
    } finally {
      setBusyId(null)
    }
  }

  const copyTracking = (row: ReturnListRow) => {
    if (!row.cargo_tracking_code) return
    navigator.clipboard?.writeText(row.cargo_tracking_code)
    setCopiedId(row.id)
    setTimeout(() => setCopiedId((cur) => (cur === row.id ? null : cur)), 1500)
  }

  // ── Satır bazlı aksiyon görünürlüğü (ReturnDetailPage ile aynı kurallar; sunucu ayrıca doğrular) ──
  const showStaffApprove = (r: ReturnListRow) => canStaff && (r.type === 'return' || r.type === 'defect') && r.status === 'received'
  // shortage (personel başlattı, eksik/hatalı ürün): kargo/depo adımı yok, doğrudan staff_approved → para onayı.
  const showManagerApprove = (r: ReturnListRow) =>
    canManager && (((r.type === 'return' || r.type === 'defect' || r.type === 'shortage') && r.status === 'staff_approved') || (r.type === 'cancel' && r.status === 'processing'))
  // ── Toplu onay ──
  // Seçilebilirlik = ilgili ekranın TEKİL onay butonunun görünürlük kuralıyla birebir aynı
  // (personel ekranı → personel onayı, yönetici ekranı → para onayı). Sunucu her isteği ayrıca doğrular.
  const bulkEligible = useCallback((r: ReturnListRow) =>
    view === 'manager' ? showManagerApprove(r) : showStaffApprove(r),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [view, canStaff, canManager])
  const eligibleRows = rows.filter(bulkEligible)
  const selectedRows = eligibleRows.filter((r) => selected.has(r.id))

  // Bağlam değişince (ekran/sekme/filtre/sayfa/arama) bayat seçim kalmasın
  useEffect(() => { setSelected(new Set()) }, [view, status, typeF, methodF, payF, page, search])

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleSelectAll = () =>
    setSelected((prev) =>
      eligibleRows.every((r) => prev.has(r.id)) ? new Set() : new Set(eligibleRows.map((r) => r.id)))

  const openBulk = () => {
    if (selectedRows.length === 0) return
    setBulk({
      kind: view === 'manager' ? 'approve-manager' : 'approve-staff',
      rows: selectedRows,
      results: Object.fromEntries(selectedRows.map((r) => [r.id, { state: 'waiting' } as BulkItemState])),
      running: false,
      done: false,
    })
  }

  /**
   * Toplu koşum: her talep için TEKİL onay ucu SIRAYLA çağrılır (paralel DEĞİL — Ticimax/ödeme
   * sağlayıcısına tekil akıştaki tempoyla gidilir). Hata alan talep atlanır, kalanlar devam eder;
   * mesaj satırında gösterilir. Bitince liste + sayaçlar tazelenir.
   */
  const runBulk = async () => {
    if (!bulk || bulk.running || bulk.done) return
    setBulk((b) => (b ? { ...b, running: true } : b))
    for (const row of bulk.rows) {
      setBulk((b) => (b ? { ...b, results: { ...b.results, [row.id]: { state: 'running' } } } : b))
      try {
        if (bulk.kind === 'approve-staff') await returnsAdminApi.approveStaff(row.id, {})
        else await returnsAdminApi.approveManager(row.id, {})
        setBulk((b) => (b ? { ...b, results: { ...b.results, [row.id]: { state: 'ok' } } } : b))
      } catch (e) {
        const err = e as { response?: { data?: { message?: string } } }
        setBulk((b) => (b ? {
          ...b,
          results: { ...b.results, [row.id]: { state: 'error', message: err.response?.data?.message ?? 'İşlem başarısız oldu.' } },
        } : b))
      }
    }
    setBulk((b) => (b ? { ...b, running: false, done: true } : b))
    setSelected(new Set())
    await Promise.all([load(), loadStats()])
  }

  // Kısmi iade retry: çok-kalemli iyzico iadesinde bir kalem banka reddine takılırsa talep
  // Refunding'de bekler — mevcut POST /refund ucu kalan kalemleri tamamlar (başarılı kalemler
  // atlanır, çift iade imkânsız). Buton detay sayfasında zaten vardı; listeye de eklendi.
  const showRefundRetry = (r: ReturnListRow) => canManager && (r.status === 'refunding' || r.status === 'manager_approved')
  // Kusur kararı (defect_review) satırdan verilmez → detay sayfasındaki yönetici bloğuna gidilir.
  const showReject = (r: ReturnListRow) => canStaff && REJECTABLE.includes(r.status) && r.status !== 'defect_review'
  const rowTransitions = (r: ReturnListRow) => {
    const list = canStaff && (r.type === 'return' || r.type === 'defect') && r.status !== 'defect_review'
      ? NEXT_TRANSITIONS[r.status] ?? []
      : []
    // Kod üretimi daha önce düştüyse aynı geçiş bir YENİDEN DENEME'dir — etiket bunu söylesin.
    return r.cargo_error
      ? list.map((tr) => (tr.to === 'awaiting_shipment' ? { ...tr, label: 'Kargo Kodunu Tekrar Dene' } : tr))
      : list
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
          <RotateCcw size={22} /> İade / İptal Yönetimi
        </h1>
        <div className="flex items-center gap-4">
          {hasPermission('returns_shortage') && (
            <Link to="/returns/shortage" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md" title="Depo siparişi çıkaramıyor (eksik/hatalı/stok hatası) → gönderilemeyen ürün için para iadesi başlat">
              <PackageX size={15} /> Eksik/Hatalı Ürün İadesi
            </Link>
          )}
          {hasPermission('returns_returned') && (
            <Link to="/returns/returned" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md" title="Firmadan çıkan paket teslim edilemedi, depoya geri döndü → müşteriye bildirim gitmeden para iadesi başlat">
              <Undo2 size={15} /> Geri Dönen Sipariş İadesi
            </Link>
          )}
          <Link to="/returns/report" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800">
            <FileBarChart size={15} /> Finans Özeti
          </Link>
          <button
            onClick={() => {
              load()
              loadStats()
            }}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            <RefreshCw size={15} /> Yenile
          </button>
        </div>
      </div>

      {/* Ekran seçimi: Personel / Yönetici (yönetici yetkisi olana görünür) */}
      {canManager && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 mb-4">
          <button
            onClick={() => setView('staff')}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-md transition',
              view === 'staff' ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-800'
            )}
          >
            <Users size={15} /> Personel Ekranı
          </button>
          <button
            onClick={() => setView('manager')}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-md transition',
              view === 'manager' ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-800'
            )}
          >
            <ShieldCheck size={15} /> Yönetici Ekranı
          </button>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <StatCard label="İşlem bekleyen" value={stats.actionable} />
          <StatCard
            label={`SLA aşımı (depo ${fmtWindow(stats.staff_review_hours ?? 48)} / para ${fmtWindow(stats.manager_review_hours)})`}
            value={stats.sla_breached}
            tone="danger"
          />
          <StatCard label="İptal: ödeme bekliyor" value={stats.processing} tone="warn" />
          {/* manager_approved geçici statüdür (onay anında iade koşar) → kart fiilen hep 0'dı; iade edilenler gösterilir. */}
          <StatCard label="Onaylı — iade edildi" value={stats.refunded_done ?? 0} />
          <StatCard label="Toplam" value={stats.total} />
        </div>
      )}

      {/* Sekmeler + isim/kod arama */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const count = stats && tab.count ? tab.count(stats) : null
            return (
              <button
                key={tab.key || 'all'}
                onClick={() => setTab(tab.key)}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition',
                  status === tab.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                {tab.label}
                {count !== null && (
                  <span
                    className={clsx(
                      'min-w-[1.25rem] px-1 py-px rounded-full text-[11px] font-semibold text-center tabular-nums',
                      status === tab.key
                        ? 'bg-white/20 text-white'
                        : count > 0
                          ? 'bg-gray-200 text-gray-700'
                          : 'bg-gray-100 text-gray-400'
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {/* Havale bölümü YALNIZCA yönetici ekranında (kullanıcı kararı 04.09) — kapıda ödeme
              iadelerinin muhasebe kuyruğu; IBAN taşıdığı için ayrı ekranda ve yetki denetimli. */}
          {view === 'manager' && (
            <Link
              to="/returns/payouts"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200"
            >
              <Banknote size={15} /> Havale (Kapıda Ödeme)
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeF}
            onChange={(e) => setFilter('type', e.target.value)}
            className="py-1.5 pl-2 pr-7 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 text-gray-700"
            title="Talep türüne göre filtrele"
          >
            <option value="">Tür: Tümü</option>
            <option value="return">İade</option>
            <option value="cancel">İptal</option>
            <option value="defect">Kusur</option>
            <option value="shortage">Eksik/Hatalı Ürün (Personel)</option>
            <option value="returned">Geri Dönen Sipariş (Personel)</option>
          </select>
          <select
            value={payF}
            onChange={(e) => setFilter('payment', e.target.value)}
            className="py-1.5 pl-2 pr-7 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 text-gray-700"
            title="Siparişin ödeme şekline göre filtrele (iade yönteminden ayrıdır)"
          >
            <option value="">Ödeme: Tümü</option>
            <option value="cod">Kapıda Ödeme</option>
            <option value="online">Kartlı / Online</option>
          </select>
          <select
            value={methodF}
            onChange={(e) => setFilter('method', e.target.value)}
            className="py-1.5 pl-2 pr-7 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 text-gray-700"
            title="İade yöntemine göre filtrele"
          >
            <option value="">Yöntem: Tümü</option>
            <option value="original">Karta İade</option>
            <option value="bank_transfer">Havale (Kapıda Ödeme)</option>
            <option value="store_credit">İndirim Kodu</option>
            <option value="none">İade Yok (Kapıda Ödeme İptali)</option>
          </select>
          <form onSubmit={submitSearch} className="relative">
            <Search size={16} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Müşteri adı, kod, sipariş no, barkod, kupon kodu..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md w-64 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </form>
        </div>
      </div>

      {/* Sıralama bilgisi: onay kuyruğunda en az süresi kalan üstte */}
      {activeTab?.sort === 'sla' && (
        <p className="text-xs text-gray-400 mb-2 inline-flex items-center gap-1">
          <Clock size={12} /> Onay süresine en az zaman kalan talepler üstte listelenir.
        </p>
      )}
      {activeTab?.sort === 'workqueue' && (
        <p className="text-xs text-gray-400 mb-2 inline-flex items-center gap-1">
          <Clock size={12} /> İşlem bekleyenler üstte, işlem görmüş talepler listenin sonundadır.
        </p>
      )}

      {actionError && (
        <div className="mb-3 px-4 py-2 bg-rose-50 text-rose-700 text-sm rounded-md border border-rose-200 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-600">
            <XCircle size={15} />
          </button>
        </div>
      )}

      {/* Toplu onay çubuğu: seçim varken görünür (kullanıcı isteği 11.08) */}
      {selectedRows.length > 0 && (
        <div className="mb-3 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-md flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-indigo-900 inline-flex items-center gap-1.5">
            <ListChecks size={16} /> {selectedRows.length} talep seçili
            <span className="text-indigo-600 font-normal">
              — toplam {fmtMoney(selectedRows.reduce((s, r) => s + (r.approved_amount ?? r.requested_amount ?? 0), 0), selectedRows[0]?.currency)}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={openBulk}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white rounded-md',
                view === 'manager' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-600 hover:bg-emerald-700'
              )}
            >
              {view === 'manager' ? <ShieldCheck size={14} /> : <CheckCircle2 size={14} />}
              {view === 'manager' ? 'Seçilenlerin Para İadesini Onayla' : 'Seçilen İadeleri Onayla'} ({selectedRows.length})
            </button>
            <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-white">
              Seçimi temizle
            </button>
          </div>
        </div>
      )}

      {/* Tablo — Trendyol tarzı: satırda ürün/kargo/sebep + satır içi aksiyonlar */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              {/* Toplu seçim: yalnız bu ekranda onaylanabilir satırlar işaretlenebilir */}
              <th className="pl-4 pr-1 py-2.5 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-indigo-600"
                  disabled={eligibleRows.length === 0}
                  checked={eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.id))}
                  onChange={toggleSelectAll}
                  title={eligibleRows.length === 0 ? 'Bu sekmede onaylanabilir talep yok' : 'Sayfadaki onaylanabilir taleplerin tümünü seç'}
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Talep</th>
              <th className="px-4 py-2.5 font-medium">Müşteri</th>
              <th className="px-4 py-2.5 font-medium">Ürün Bilgileri</th>
              <th className="px-4 py-2.5 font-medium text-right">Tutar & Ödeme</th>
              <th className="px-4 py-2.5 font-medium">Kargo</th>
              <th className="px-4 py-2.5 font-medium">İade Sebebi</th>
              <th className="px-4 py-2.5 font-medium w-52">Durum & İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  Yükleniyor...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  <PackageCheck className="mx-auto mb-2 text-gray-300" size={28} />
                  Kayıt bulunamadı.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const items = r.items ?? []
                const attachments = r.attachments ?? []
                const busy = busyId === r.id
                // Kalemlerdeki benzersiz sebepler (kod + not)
                const reasons = items
                  .filter((it) => it.reason_code || it.reason_note)
                  .map((it) => ({ code: it.reason_code, note: it.reason_note }))
                  .filter((v, i, arr) => arr.findIndex((x) => x.code === v.code && x.note === v.note) === i)

                return (
                  <tr key={r.id} className={clsx('hover:bg-gray-50 align-top', busy && 'opacity-60 pointer-events-none', selected.has(r.id) && 'bg-indigo-50/60')}>
                    {/* Toplu seçim */}
                    <td className="pl-4 pr-1 py-3">
                      {bulkEligible(r) && (
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-indigo-600 mt-0.5"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      )}
                    </td>
                    {/* Talep */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link to={`/returns/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                        {r.public_code}
                      </Link>
                      <div className="mt-1">
                        <span className={clsx('text-[11px] px-1.5 py-0.5 rounded', typeBadge(r.type, false, r.shortage?.stage).cls)}>
                          {typeBadge(r.type, false, r.shortage?.stage).label}
                        </span>
                      </div>
                      {r.type === 'shortage' && (
                        <div className={clsx('mt-1 text-[11px] inline-flex items-center gap-1', r.shortage?.stage === 'returned' ? 'text-teal-700' : 'text-rose-700')} title={r.shortage?.stage === 'returned' ? 'Personelin kaydettiği geri dönen sipariş iadesi (müşteriye bildirim yok)' : 'Personel tarafından başlatılan gönderilemeyen ürün iadesi'}>
                          <UserCog size={11} /> {r.shortage?.created_by_name ?? r.created_by_name ?? 'Personel'}
                          {r.shortage?.is_full && <span className={clsx('ml-1 px-1 rounded text-white text-[10px]', r.shortage?.stage === 'returned' ? 'bg-teal-600' : 'bg-rose-600')}>TAM</span>}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {r.admin_order_url ? (
                          <a href={r.admin_order_url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 hover:underline" title="Ticimax panelde aç">
                            Sipariş: {r.order_no ?? '—'}
                          </a>
                        ) : (
                          <>Sipariş: {r.order_no ?? '—'}</>
                        )}
                      </div>
                      {r.platform_order_id && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {r.admin_order_url ? (
                            <a href={r.admin_order_url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 hover:underline" title="Ticimax panelde aç">
                              ID: {r.platform_order_id}
                            </a>
                          ) : (
                            <>ID: {r.platform_order_id}</>
                          )}
                        </div>
                      )}
                      <div className="text-[11px] text-gray-400 mt-0.5">{r.created_at?.slice(0, 16) ?? '—'}</div>
                      {(r.staff_notes ?? []).length > 0 && (
                        <div
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                          title={(r.staff_notes ?? []).map((n) => `• ${n.note}`).join('\n')}
                        >
                          <StickyNote size={11} /> {(r.staff_notes ?? []).length} not
                        </div>
                      )}
                    </td>

                    {/* Müşteri */}
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{r.customer_name ?? '—'}</div>
                      <div className="text-xs text-gray-500 break-all">{r.customer_email ?? ''}</div>
                    </td>

                    {/* Ürün Bilgileri */}
                    <td className="px-4 py-3">
                      {items.length === 0 ? (
                        <span className="text-gray-400 text-xs">{r.items_count} kalem</span>
                      ) : (
                        <div className="space-y-2">
                          {items.slice(0, 2).map((it) => (
                            <div key={it.id} className="flex items-start gap-2">
                              {it.image_url ? (
                                <img src={it.image_url} alt="" className="w-10 h-10 rounded object-cover border shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-gray-100 border shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="text-gray-900 line-clamp-1" title={it.product_name ?? undefined}>
                                  {it.product_name ?? it.sku ?? '—'}
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {[it.variant_info, it.sku && `Stok: ${it.sku}`, it.barcode && `Barkod: ${it.barcode}`]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  <span className="font-medium text-gray-700">{it.qty_requested} adet iade</span> × {fmtMoney(it.unit_price, r.currency)}
                                  {it.qty_ordered > it.qty_requested && (
                                    <span className="text-gray-400"> (siparişte {it.qty_ordered} adet)</span>
                                  )}
                                  {it.qty_approved !== null && it.qty_approved !== it.qty_requested && (
                                    <span className="text-violet-600"> → {it.qty_approved} onaylı</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                          {items.length > 2 && (
                            <Link to={`/returns/${r.id}`} className="text-[11px] text-indigo-600 hover:underline">
                              +{items.length - 2} ürün daha
                            </Link>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Tutar */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="tabular-nums font-medium text-gray-900">
                        {fmtMoney(r.approved_amount ?? r.requested_amount, r.currency)}
                      </div>
                      {r.refund_method && (
                        <div className="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                          <Wallet size={11} /> {r.refund_method_label ?? (r.refund_method === 'store_credit' ? 'İndirim kodu' : 'Karta iade')}
                        </div>
                      )}
                      {/* Ödeme türü: müşteri siparişi nasıl ödedi (kapıda / kartlı) — tespit yoksa gösterilmez. */}
                      {r.payment_type && (
                        <div className="mt-1">
                          <span
                            className={clsx(
                              'inline-flex items-center gap-1 px-1.5 py-px rounded text-[11px] font-medium',
                              r.payment_type === 'cod' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
                            )}
                            title="Siparişin ödeme şekli"
                          >
                            {r.payment_type === 'cod' ? <Banknote size={11} /> : <CreditCard size={11} />}
                            {r.payment_type === 'cod' ? 'Kapıda Ödeme' : 'Kartlı / Online'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Kargo */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.cargo_tracking_code ? (
                        <>
                          <div className="text-xs text-gray-700">{cargoProviderLabel(r.cargo_provider)}</div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {/* Takip kodu → kargo firmasının takip sayfası (personel statüyü oradan görür) */}
                            {r.cargo_tracking_url ? (
                              <a
                                href={r.cargo_tracking_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${cargoProviderLabel(r.cargo_provider)} takip sayfasında aç`}
                                className="inline-flex items-center gap-1 font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                {r.cargo_tracking_code} <ExternalLink size={11} />
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-gray-600">{r.cargo_tracking_code}</span>
                            )}
                            <button onClick={() => copyTracking(r)} title="Takip kodunu kopyala" className="text-gray-400 hover:text-gray-700">
                              <Copy size={11} />
                            </button>
                          </div>
                          {copiedId === r.id && <div className="text-[11px] text-emerald-600">Kopyalandı</div>}
                          {/* Paket üzerindeki barkod (Sürat) — depo gelen paketi bu numarayla eşleştirir */}
                          {r.cargo_barcode && (
                            <div className="text-[11px] text-gray-500">
                              Barkod: <span className="font-mono text-gray-700">{r.cargo_barcode}</span>
                            </div>
                          )}
                          {/* Depoya teslim: kargo firmasının verdiği tarih/saat + teslim alan */}
                          {(() => {
                            const d = deliveryView(r)
                            return d ? (
                              <div className="mt-1 text-[11px] leading-tight">
                                <div className="inline-flex items-center gap-1 text-emerald-700">
                                  <PackageCheck size={11} /> {d.at ?? 'Teslim edildi'}
                                </div>
                                {d.by && <div className="text-gray-500 max-w-40 truncate" title={d.by}>Alan: {d.by}</div>}
                              </div>
                            ) : null
                          })()}
                        </>
                      ) : r.cargo_error ? (
                        /* Kargo kodu üretilemedi → talep kodsuz takılı. Müşteri talep numarasını
                           kargo kodu sanıp şubeye gidebilir (6-7 Eylül olayı) → burada görünür olmalı. */
                        <div className="max-w-52">
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-red-100 text-red-700 border border-red-200">
                            <AlertTriangle size={11} /> Kargo kodu YOK
                          </span>
                          <div className="mt-1 text-[11px] leading-tight text-red-600 line-clamp-2" title={r.cargo_error.error ?? ''}>
                            {r.cargo_error.error ?? 'Sağlayıcı hatası'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-500">
                            {r.cargo_error.giving_up
                              ? 'Otomatik deneme bırakıldı — elle deneyin'
                              : `Otomatik yeniden deneniyor${r.cargo_error.retry_count ? ` (${r.cargo_error.retry_count}. deneme)` : ''}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>

                    {/* İade Sebebi */}
                    <td className="px-4 py-3 max-w-56">
                      {reasons.length === 0 ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (
                        <div className="space-y-1.5">
                          {reasons.slice(0, 2).map((re, i) => (
                            <div key={i}>
                              {re.code && <div className="text-xs font-medium text-gray-800">{reasonLabel(re.code)}</div>}
                              {re.note && (
                                <div className="text-[11px] text-gray-500 line-clamp-3" title={re.note}>
                                  {re.note}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {attachments.map((a, i) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => returnsAdminApi.fetchAttachmentBlob(a.url).then((u) => window.open(u, '_blank')).catch(() => {})}
                              className="text-[11px] text-orange-600 hover:underline inline-flex items-center gap-0.5"
                            >
                              Görsel {i + 1} <ExternalLink size={10} />
                            </button>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Durum & İşlem */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5 items-stretch">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full self-start', statusBadgeClass(r.status))}>
                          {r.status_label}
                        </span>
                        <TimerCell row={r} />

                        {showStaffApprove(r) && (
                          <button
                            disabled={busy}
                            onClick={() => setModal({ kind: 'approve-staff', row: r })}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 size={13} /> İadeyi Onayla
                          </button>
                        )}

                        {showManagerApprove(r) && view === 'manager' && (
                          <button
                            disabled={busy}
                            onClick={() => setModal({ kind: 'approve-manager', row: r })}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                          >
                            <ShieldCheck size={13} /> Para İadesini Onayla
                          </button>
                        )}

                        {showRefundRetry(r) && view === 'manager' && (
                          <button
                            disabled={busy}
                            onClick={() => act(r.id, () => returnsAdminApi.refund(r.id))}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                            title="İade yarım kaldı — kalan kalemler tekrar denenir (iade edilenler atlanır, çift iade olmaz)"
                          >
                            <ShieldCheck size={13} /> Kalan İadeyi Tekrar Dene
                          </button>
                        )}

                        {/* KUSUR KARARI — yalnızca yönetici ekranında ve admin yetkisiyle */}
                        {view === 'manager' && isAdmin && r.type === 'defect' && r.status === 'defect_review' && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => setModal({ kind: 'defect-approve', row: r })}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 text-white rounded-md hover:bg-fuchsia-700 disabled:opacity-50"
                            >
                              <Wrench size={13} /> Kusuru Onayla
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setModal({ kind: 'defect-reject', row: r })}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs border border-rose-300 text-rose-600 rounded-md hover:bg-rose-50 disabled:opacity-50"
                            >
                              <XCircle size={13} /> Reddet
                            </button>
                          </>
                        )}
                        {view === 'manager' && !isAdmin && r.type === 'defect' && r.status === 'defect_review' && (
                          <span className="text-[11px] text-fuchsia-700 text-center">Firma yöneticisi kararı bekleniyor</span>
                        )}

                        {(view === 'staff' || r.status === 'cancelled_by_customer') &&
                          rowTransitions(r).map((tr) => (
                            <button
                              key={tr.to}
                              disabled={busy}
                              onClick={() => {
                                // Kapanmış talebi yeniden açmak istisnai bir işlemdir → yanlış tıklamaya karşı onay.
                                if (r.status === 'cancelled_by_customer'
                                  && !window.confirm('Bu talep kapanmış (müşteri vazgeçti / kod süresi doldu). Ürün depoya ulaştıysa talep yeniden açılıp "Depoya ulaştı" durumuna alınacak ve müşteriye bilgilendirme SMS\'i gidecek. Devam edilsin mi?')) return
                                act(r.id, () => returnsAdminApi.transition(r.id, tr.to))
                              }}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Truck size={13} /> {tr.label}
                            </button>
                          ))}

                        {showReject(r) && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              setRejectReason('')
                              setRejectFile(null)
                              setModal({ kind: 'reject', row: r })
                            }}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs border border-rose-300 text-rose-600 rounded-md hover:bg-rose-50 disabled:opacity-50"
                          >
                            <XCircle size={13} /> Reddet
                          </button>
                        )}

                        <Link to={`/returns/${r.id}`} className="text-[11px] text-gray-400 hover:text-gray-700 self-center">
                          Diğer işlemler / Detay →
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sayfalama */}
      <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
        <div>{total} kayıt</div>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Önceki
          </button>
          <span>
            {page} / {lastPage}
          </span>
          <button
            disabled={page >= lastPage}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      </div>

      {/* Onay / Red penceresi */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busyId && setModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            {modal.kind === 'approve-staff' && (
              <>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <CheckCircle2 size={18} className="text-emerald-600" /> İadeyi Onayla — {modal.row.public_code}
                </h3>
                <CodBox row={modal.row} />
                <StaffNotesBox row={modal.row} />
                <p className="text-sm text-gray-600 mb-1">
                  Depo incelemesi onayı verilecek; Ticimax'ta sipariş 'İade' statüsüne otomatik çekilir.
                </p>
                <p className="text-sm text-gray-800 font-medium mb-4">
                  Tutar: {fmtMoney(modal.row.approved_amount ?? modal.row.requested_amount, modal.row.currency)}
                </p>
                <p className="text-[11px] text-gray-400 mb-4">
                  Kısmi onay (adet/tutar değişikliği) için detay sayfasını kullanın.
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={busyId !== null}
                    onClick={() => act(modal.row.id, () => returnsAdminApi.approveStaff(modal.row.id, {}))}
                    className="flex-1 px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Onayla
                  </button>
                  <button onClick={() => setModal(null)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </>
            )}

            {modal.kind === 'approve-manager' && (
              <>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <ShieldCheck size={18} className="text-violet-600" /> Para İadesini Onayla — {modal.row.public_code}
                </h3>
                <CodBox row={modal.row} />
                <ShortageBox row={modal.row} />
                <StaffNotesBox row={modal.row} />
                <p className="text-sm text-gray-800 font-medium mb-2">
                  Tutar: {fmtMoney(modal.row.approved_amount ?? modal.row.requested_amount, modal.row.currency)}
                </p>
                <p className="text-sm text-gray-600 mb-1">
                  {modal.row.type === 'cancel'
                    ? 'İptal işlemi otomatik tamamlandı. Bu onay yalnızca müşteriye para iadesini başlatır.'
                    : modal.row.type === 'shortage' && modal.row.shortage?.stage === 'returned'
                      ? 'GERİ DÖNEN SİPARİŞ: onayladığınızda tutar karta iade edilir ve (tam kapsamda) sipariş Ticimax\'ta İptal yapılır. Müşteriye SMS / kupon GİTMEZ.'
                    : modal.row.type === 'shortage'
                      ? 'Onayladığınızda gönderilemeyen ürünün bedeli karta iade edilir; müşteriye özür SMS\'i ve özel indirim kuponu gider.'
                      : 'Yalnızca para iadesi onayı. Personel onayını veren yönetici gerekirse para onayını da verebilir.'}
                </p>
                {modal.row.refund_method === 'store_credit' && (
                  <p className="text-[11px] text-violet-600 mb-4 flex items-start gap-1">
                    <Wallet size={13} className="mt-0.5 shrink-0" />
                    <span>Onayladığınızda indirim kodu Ticimax üzerinde oluşturulup müşteriye SMS ile gönderilecektir.</span>
                  </p>
                )}
                {modal.row.refund_method === 'bank_transfer' && (
                  <p className="text-[11px] text-sky-700 mb-4 flex items-start gap-1">
                    <Landmark size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Onay sonrası talep "havale bekliyor"a geçer; parayı yukarıdaki hesaba
                      gönderdikten sonra talep detayından <b>Havale Yapıldı</b> ile kapatın.
                    </span>
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    disabled={busyId !== null}
                    onClick={() => act(modal.row.id, () => returnsAdminApi.approveManager(modal.row.id, {}))}
                    className="flex-1 px-3 py-2 text-sm bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                  >
                    Onayla ve İadeyi Başlat
                  </button>
                  <button onClick={() => setModal(null)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </>
            )}

            {modal.kind === 'defect-approve' && (
              <>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <Wrench size={18} className="text-fuchsia-600" /> Kusuru Onayla — {modal.row.public_code}
                </h3>
                {defectInfo?.complaint && (
                  <div className="mb-3 rounded-md bg-fuchsia-50 border border-fuchsia-200 p-2.5 text-xs text-gray-700 max-h-28 overflow-y-auto whitespace-pre-wrap">
                    <span className="font-medium text-fuchsia-800">Müşteri şikâyeti: </span>{defectInfo.complaint}
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-1">
                  Kargo firmasında <b>{modal.row.public_code}ony</b> koduyla ücretsiz iade gönderisi oluşturulacak
                  ve kod müşteriye onay SMS'i ile iletilecek.
                </p>
                <p className="text-[11px] text-gray-400 mb-4">
                  Sonrası normal iade akışıyla devam eder (kargo takibi → depo → personel + para onayı).
                  Fotoğrafları incelemek için detay sayfasını kullanın.
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={busyId !== null}
                    onClick={() => act(modal.row.id, () => returnsAdminApi.approveDefect(modal.row.id))}
                    className="flex-1 px-3 py-2 text-sm bg-fuchsia-600 text-white rounded-md hover:bg-fuchsia-700 disabled:opacity-50"
                  >
                    Onayla ve Kargo Kodu Gönder
                  </button>
                  <button onClick={() => setModal(null)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </>
            )}

            {modal.kind === 'defect-reject' && (
              <>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <XCircle size={18} className="text-rose-600" /> Kusuru Reddet — {modal.row.public_code}
                </h3>
                {defectInfo?.complaint && (
                  <div className="mb-3 rounded-md bg-gray-50 border border-gray-200 p-2.5 text-xs text-gray-700 max-h-28 overflow-y-auto whitespace-pre-wrap">
                    <span className="font-medium text-gray-800">Müşteri şikâyeti: </span>{defectInfo.complaint}
                  </div>
                )}
                <p className="text-xs text-gray-500 mb-2">
                  Kargo kodu üretilmez; seçtiğiniz neden müşteriye SMS ile iletilir.
                </p>
                <select
                  value={defectReason}
                  onChange={(e) => setDefectReason(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                >
                  <option value="">{defectInfo ? 'Red nedeni seçiniz...' : 'Nedenler yükleniyor...'}</option>
                  {(defectInfo?.reasons ?? []).map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
                <div className="flex gap-2 mt-4">
                  <button
                    disabled={busyId !== null || !defectReason}
                    onClick={() => act(modal.row.id, () => returnsAdminApi.rejectDefect(modal.row.id, defectReason))}
                    className="flex-1 px-3 py-2 text-sm bg-rose-600 text-white rounded-md hover:bg-rose-700 disabled:opacity-50"
                  >
                    Reddet ve SMS Gönder
                  </button>
                  <button onClick={() => setModal(null)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </>
            )}

            {modal.kind === 'reject' && (
              <>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
                  <XCircle size={18} className="text-rose-600" /> Reddet — {modal.row.public_code}
                </h3>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Red gerekçesi (zorunlu)..."
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                />
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer mt-2">
                  <Upload size={14} />
                  <span>{rejectFile ? rejectFile.name : 'Kanıt görseli ekle (opsiyonel)'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setRejectFile(e.target.files?.[0] ?? null)} />
                </label>
                <div className="flex gap-2 mt-4">
                  <button
                    disabled={busyId !== null || rejectReason.trim().length < 3}
                    onClick={() => act(modal.row.id, () => returnsAdminApi.reject(modal.row.id, rejectReason, rejectFile ?? undefined))}
                    className="flex-1 px-3 py-2 text-sm bg-rose-600 text-white rounded-md hover:bg-rose-700 disabled:opacity-50"
                  >
                    Reddet
                  </button>
                  <button onClick={() => setModal(null)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toplu onay penceresi: onay öncesi seçim listesi, koşum sırasında talep başına canlı ilerleme.
          Koşum sırasında kapatılamaz (yarıda kalan işlem sanılmasın; arkada istekler tekil akıştır). */}
      {bulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !bulk.running && setBulk(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-2">
              {bulk.kind === 'approve-manager'
                ? <ShieldCheck size={18} className="text-violet-600" />
                : <CheckCircle2 size={18} className="text-emerald-600" />}
              {bulk.kind === 'approve-manager' ? 'Toplu Para İadesi Onayı' : 'Toplu İade Onayı'} — {bulk.rows.length} talep
            </h3>

            {!bulk.done && bulk.rows.some((r) => (r.staff_notes ?? []).length > 0) && (
              <div className="mb-2 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex items-start gap-1.5">
                <StickyNote size={13} className="mt-0.5 shrink-0" />
                <span>Seçilen taleplerin bazılarında <b>personel notu</b> var — onaydan önce satırlardaki notları okuyun!</span>
              </div>
            )}

            {!bulk.running && !bulk.done && (
              <p className="text-xs text-gray-500 mb-2">
                {bulk.kind === 'approve-manager'
                  ? 'Her talep tek tek, sırayla onaylanır: para iadesi (karta iade / indirim kodu), SMS ve Ticimax statü yazımı tekil onaydaki akışın birebir aynısıdır. Hata alan talep atlanır, kalanlar devam eder.'
                  : 'Her talep tek tek, sırayla onaylanır: Ticimax statü yazımı dahil tekil onaydaki akışın birebir aynısıdır. Hata alan talep atlanır, kalanlar devam eder. Kısmi onay (adet/tutar değişikliği) için detay sayfasını kullanın.'}
              </p>
            )}

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 mb-3">
              {bulk.rows.map((r) => {
                const st = bulk.results[r.id]
                return (
                  <div key={r.id} className="px-3 py-2 flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">{r.public_code}</span>
                      <span className="text-gray-500"> · {r.customer_name ?? '—'}</span>
                      {(r.staff_notes ?? []).length > 0 && (
                        <span className="ml-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px" title={(r.staff_notes ?? []).map((n) => `• ${n.note}`).join('\n')}>
                          {(r.staff_notes ?? []).length} not
                        </span>
                      )}
                      {st?.state === 'error' && <div className="text-xs text-rose-600 mt-0.5">{st.message}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-gray-700 tabular-nums">{fmtMoney(r.approved_amount ?? r.requested_amount, r.currency)}</span>
                      {st?.state === 'running' && <Loader2 size={15} className="animate-spin text-indigo-500" />}
                      {st?.state === 'ok' && <CheckCircle2 size={15} className="text-emerald-600" />}
                      {st?.state === 'error' && <XCircle size={15} className="text-rose-600" />}
                      {(!st || st.state === 'waiting') && <span className="w-[15px]" />}
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const vals = Object.values(bulk.results)
              const ok = vals.filter((v) => v.state === 'ok').length
              const fail = vals.filter((v) => v.state === 'error').length
              const doneCount = ok + fail
              return (
                <>
                  {bulk.running && (
                    <p className="text-sm text-gray-600 mb-2 inline-flex items-center gap-1.5">
                      <Loader2 size={14} className="animate-spin" /> İşleniyor: {doneCount}/{bulk.rows.length} — pencereyi kapatmayın.
                    </p>
                  )}
                  {bulk.done && (
                    <p className={clsx('text-sm mb-2 font-medium', fail > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                      Tamamlandı: {ok} başarılı{fail > 0 ? `, ${fail} hata — hatalı talepler değişmedi, sorun giderilip tek tek veya yeniden toplu onaylanabilir.` : '.'}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {!bulk.done && (
                      <button
                        disabled={bulk.running}
                        onClick={runBulk}
                        className={clsx(
                          'flex-1 px-3 py-2 text-sm text-white rounded-md disabled:opacity-50',
                          bulk.kind === 'approve-manager' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-600 hover:bg-emerald-700'
                        )}
                      >
                        {bulk.kind === 'approve-manager' ? `Onayla ve İadeleri Başlat (${bulk.rows.length})` : `Onayla (${bulk.rows.length})`}
                      </button>
                    )}
                    <button
                      disabled={bulk.running}
                      onClick={() => setBulk(null)}
                      className={clsx('px-3 py-2 text-sm border rounded-md disabled:opacity-50', bulk.done && 'flex-1')}
                    >
                      {bulk.done ? 'Kapat' : 'Vazgeç'}
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
