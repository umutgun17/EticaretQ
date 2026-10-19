import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Mail, MessageSquare, Bell, Send, MailOpen, MousePointerClick, ShoppingCart, XCircle, MinusCircle, Search, X, User, FileText, Ticket, Truck, Clock } from 'lucide-react'
import clsx from 'clsx'
import { marketingAnalyticsApi, type MarketingFunnel, type MarketingMessageRow, type MarketingMessageDetail, type AnalyticsFilters } from '@/lib/cartRecoveryApi'

const CHANNEL_ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageSquare, push: Bell }
const CHANNEL_LABELS: Record<string, string> = { email: 'E-posta', sms: 'SMS', whatsapp: 'WhatsApp', push: 'Push' }
const SOURCE_LABELS: Record<string, string> = {
  cart_recovery: 'Sepet Kurtarma', wheel_coupon: 'Çark Kuponu', order_status: 'Sipariş Bildirimi',
}
const STAGE_LABELS: Record<string, string> = { placed: 'Sipariş alındı', shipped: 'Kargoda', delivered: 'Teslim edildi' }
const STATUS_BADGE: Record<string, string> = {
  sent: 'bg-blue-100 text-blue-700', delivered: 'bg-sky-100 text-sky-700',
  failed: 'bg-rose-100 text-rose-700', skipped: 'bg-gray-100 text-gray-500', queued: 'bg-amber-100 text-amber-700',
}
const STATUS_TR: Record<string, string> = { sent: 'Gönderildi', failed: 'Başarısız', skipped: 'Atlandı', queued: 'Sırada', delivered: 'İletildi' }
// Atlanma sebepleri — kapı adları Türkçe açıklamaya çevrilir
const SKIP_TR: Record<string, string> = {
  consent: 'izin yok (müşteri onayı kapalı)',
  quiet_hours: 'gönderim saati dışı',
  frequency_cap: 'frekans limiti (aynı kişiye çok mesaj)',
  suppressed: 'bastırma listesinde (şikayet/opt-out)',
  unsubscribed: 'abonelikten çıkmış',
  channel_disabled: 'kanal kapalı',
  channel_unsupported: 'kanal desteklenmiyor',
  no_recipient: 'alıcı bilgisi yok',
  coupon_expired: 'kupon süresi dolmuş',
}
const reasonLabel = (r: string | null) => (r ? SKIP_TR[r] ?? r : null)
const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)
// Kampanya kaynakları (campaign:N) API'den gelen adlarla etiketlenir
const DYNAMIC_SOURCE_LABELS: Record<string, string> = {}
const sourceLabel = (s: string | null) => (s ? DYNAMIC_SOURCE_LABELS[s] ?? SOURCE_LABELS[s] ?? s : '—')

// Uzun alıcıları (özellikle push FCM endpoint'leri) kısa ve okunur göster
function shortContact(channel: string, contact: string): string {
  if (channel === 'push' || contact.length > 42) {
    const tail = contact.replace(/\/$/, '').slice(-10)
    return `${channel === 'push' ? 'Push' : '…'} ···${tail}`
  }
  return contact
}

const CHANNELS: { key: NonNullable<AnalyticsFilters['channel']>; label: string }[] = [
  { key: 'all', label: 'Tüm kanallar' }, { key: 'email', label: 'E-posta' }, { key: 'sms', label: 'SMS' }, { key: 'whatsapp', label: 'WhatsApp' },
]
const STATUSES: { key: NonNullable<AnalyticsFilters['status']>; label: string }[] = [
  { key: 'all', label: 'Tüm durumlar' }, { key: 'sent', label: 'Gönderildi' }, { key: 'converted', label: 'Dönüştü' }, { key: 'failed', label: 'Başarısız' }, { key: 'skipped', label: 'Atlandı' },
]
// d=-1 → "Dün" (backend'e date_from/date_to olarak TR günü gönderilir)
const PERIODS = [{ d: 1, label: 'Bugün' }, { d: -1, label: 'Dün' }, { d: 7, label: '7 gün' }, { d: 30, label: '30 gün' }, { d: 90, label: '90 gün' }, { d: 0, label: 'Tümü' }]

// TR günü olarak dünün YYYY-MM-DD karşılığı
function yesterdayTR(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  now.setDate(now.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function Funnel({ label, value, pct, icon: Icon, color, active, onClick }: { label: string; value: number; pct: number; icon: typeof Send; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      title={onClick ? (active ? 'Filtreyi kaldır' : `Sadece "${label}" kayıtlarını göster`) : undefined}
      className={clsx(
        'bg-white rounded-lg border p-4 transition',
        active ? 'border-amber-400 ring-2 ring-amber-200' : 'border-gray-200',
        onClick && 'cursor-pointer hover:border-amber-300 hover:shadow-sm',
      )}>
      <div className="flex items-center gap-2 text-gray-500 text-xs mb-2"><Icon size={14} className={color} /> {label}</div>
      <div className="text-xl font-semibold text-gray-900">{fmtNum(value)}</div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
        <div className={clsx('h-full rounded-full', color.replace('text-', 'bg-'))} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[11px] text-gray-400 mt-1">%{pct}</div>
    </div>
  )
}

/** Bir mesajın konu/içerik özeti — sipariş no & kupon kodu rozetli */
function SubjectCell({ m }: { m: MarketingMessageRow }) {
  return (
    <div className="max-w-[280px]">
      {m.stage && <span className="text-xs text-gray-700 font-medium">{STAGE_LABELS[m.stage] ?? m.stage}</span>}
      {!m.stage && m.subject && <span className="block truncate text-xs text-gray-600" title={m.subject}>{m.subject}</span>}
      <span className="flex flex-wrap gap-1 mt-0.5">
        {m.order_no && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded font-mono text-gray-500" title="Sipariş no">{m.order_no}</span>}
        {m.coupon_code && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 rounded font-mono text-emerald-600" title="Kupon kodu">{m.coupon_code}</span>}
        {m.converted && m.coupon_used === true && (
          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-600 text-white rounded font-medium" title="Müşteri gönderilen kupon kodunu kullanarak satın aldı">✓ Kuponla satın aldı</span>
        )}
        {m.converted && m.coupon_used === false && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded font-medium" title="Müşteri satın aldı ama kupon kodunu kullanmadı">Kuponsuz satın aldı</span>
        )}
      </span>
    </div>
  )
}

/** Mesaja tıklanınca: gönderilen içeriğin TAM detayı — metin, kupon, zaman çizelgesi, teknik */
function MessageDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<MarketingMessageDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    marketingAnalyticsApi.detail(id).then(setD).finally(() => setLoading(false))
  }, [id])

  const Icon = d ? (CHANNEL_ICON[d.channel] ?? Mail) : Mail
  const timeline: { label: string; at: string | null }[] = d ? [
    { label: 'Oluşturuldu', at: d.created_at },
    { label: 'Gönderildi', at: d.sent_at },
    { label: 'Açıldı', at: d.opened_at },
    { label: 'Tıklandı', at: d.clicked_at },
    { label: 'Satışa dönüştü', at: d.converted_at },
  ] : []

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-amber-600" />
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Mesaj detayı — {d ? (CHANNEL_LABELS[d.channel] ?? d.channel) : '…'}
                {d?.is_test && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded align-middle">test</span>}
              </div>
              {d && <div className="text-xs text-gray-500">{d.name ? `${d.name} · ` : ''}<span className="font-mono">{d.contact}</span> · {sourceLabel(d.source)}</div>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="overflow-auto flex-1 p-5 space-y-4">
          {loading && <div className="text-center text-gray-400 py-8">Yükleniyor…</div>}
          {d && (
            <>
              {/* Durum */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', STATUS_BADGE[d.status] ?? 'bg-gray-100 text-gray-500')}>{STATUS_TR[d.status] ?? d.status}</span>
                {d.skip_reason && <span className="text-xs text-gray-500">Sebep: {reasonLabel(d.skip_reason)}</span>}
                {d.revenue > 0 && <span className="text-xs font-medium text-emerald-600">Getirdiği ciro: {fmtMoney(d.revenue)}</span>}
                {d.converted_at && d.coupon_used === true && <span className="text-[11px] px-2 py-0.5 bg-emerald-600 text-white rounded-full font-medium" title="Müşteri gönderilen kupon kodunu kullanarak satın aldı">✓ Kuponla satın aldı</span>}
                {d.converted_at && d.coupon_used === false && <span className="text-[11px] px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full font-medium" title="Müşteri satın aldı ama kupon kodunu kullanmadı">Kuponsuz satın aldı</span>}
              </div>

              {/* Gönderilen içerik */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2"><Icon size={13} /> Gönderilen mesaj</div>
                {d.subject && <div className="text-sm font-medium text-gray-800 mb-1.5">{d.subject}</div>}
                {d.body
                  ? <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{d.body}</pre>
                  : <div className="text-sm text-gray-400 italic">İçerik metni kaydedilmemiş{d.channel === 'email' ? ' (HTML şablon gönderildi)' : ''}.</div>}
              </div>

              {/* Bağlam rozetleri */}
              {(d.order_no || d.coupon_code || d.cart_total || d.cargo_company || d.stage) && (
                <div className="grid grid-cols-2 gap-2">
                  {d.stage && <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs"><span className="text-gray-400 block">Aşama</span><span className="text-gray-800 font-medium">{STAGE_LABELS[d.stage] ?? d.stage}</span></div>}
                  {d.order_no && <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs"><span className="text-gray-400 block">Sipariş no</span><span className="text-gray-800 font-mono">{d.order_no}</span></div>}
                  {d.coupon_code && <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs"><span className="text-emerald-500 flex items-center gap-1"><Ticket size={11} /> Giden kupon</span><span className="text-emerald-700 font-mono font-medium">{d.coupon_code}</span></div>}
                  {d.cart_total != null && d.cart_total > 0 && <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs"><span className="text-gray-400 block">Sepet tutarı</span><span className="text-gray-800 font-medium">{fmtMoney(d.cart_total)}</span></div>}
                  {d.cargo_company && <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs"><span className="text-gray-400 flex items-center gap-1"><Truck size={11} /> Kargo</span><span className="text-gray-800">{d.cargo_company}{d.cargo_tracking_no ? ` · ${d.cargo_tracking_no}` : ''}</span></div>}
                  {d.step != null && <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs"><span className="text-gray-400 block">Akış adımı</span><span className="text-gray-800">{d.step}. adım</span></div>}
                </div>
              )}

              {/* Zaman çizelgesi */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2"><Clock size={13} /> Zaman çizelgesi</div>
                <div className="space-y-1">
                  {timeline.map((t) => (
                    <div key={t.label} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-gray-50">
                      <span className={t.at ? 'text-gray-700' : 'text-gray-300'}>{t.label}</span>
                      <span className={clsx('font-mono', t.at ? 'text-gray-600' : 'text-gray-300')}>{t.at ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Teknik / hata */}
              {(d.error || d.provider || d.provider_message_id) && (
                <div className="text-[11px] text-gray-400 space-y-1 border-t border-gray-100 pt-3">
                  {d.error && <div className="text-rose-500 break-all">Hata: {d.error}</div>}
                  {d.provider && <div>Sağlayıcı: {d.provider}{d.provider_message_id ? ` · mesaj id: ${d.provider_message_id}` : ''}</div>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Alıcıya tıklanınca: o kişiye giden TÜM mesajlar (kanal fark etmez, tüm zamanlar) */
function RecipientHistoryModal({ recipient, name, onClose, onSelect }: { recipient: string; name: string | null; onClose: () => void; onSelect: (id: number) => void }) {
  const [rows, setRows] = useState<MarketingMessageRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    marketingAnalyticsApi.get({ recipient, days: 0, channel: 'all', status: 'all' })
      .then((d) => setRows(d.messages))
      .finally(() => setLoading(false))
  }, [recipient])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <User size={18} className="text-amber-600" />
            <div>
              <div className="text-sm font-semibold text-gray-900">{name || 'Alıcı geçmişi'}</div>
              <div className="text-xs text-gray-500 font-mono">{recipient}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Zaman</th>
                <th className="text-left px-4 py-2.5 font-medium">Kanal</th>
                <th className="text-left px-4 py-2.5 font-medium">Kaynak</th>
                <th className="text-left px-4 py-2.5 font-medium">Konu / İçerik</th>
                <th className="text-left px-4 py-2.5 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m) => {
                const Icon = CHANNEL_ICON[m.channel] ?? Mail
                return (
                  <tr key={m.id} onClick={() => onSelect(m.id)} className="cursor-pointer hover:bg-amber-50/40" title="Mesaj detayını gör">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{m.at ?? '—'}</td>
                    <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-gray-600 text-xs"><Icon size={13} /> {CHANNEL_LABELS[m.channel] ?? m.channel}</span></td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {sourceLabel(m.source)}
                      {m.is_test && <span className="ml-1 text-[10px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded">test</span>}
                    </td>
                    <td className="px-4 py-2"><SubjectCell m={m} /></td>
                    <td className="px-4 py-2">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[m.status] ?? 'bg-gray-100 text-gray-500')}>{STATUS_TR[m.status] ?? m.status}</span>
                      {m.reason && <span className="ml-1 text-[10px] text-gray-400" title={reasonLabel(m.reason) ?? undefined}>· {reasonLabel(m.reason)}</span>}
                    </td>
                  </tr>
                )
              })}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Bu alıcıya gönderim yok.</td></tr>}
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Yükleniyor…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Tüm kanallardaki gönderimler — telefonlar son 10 haneyle eşleştirilir (+90 / 0 / 905… farkları birleşir).
        </div>
      </div>
    </div>
  )
}

export default function MarketingAnalyticsPage() {
  const [channel, setChannel] = useState<NonNullable<AnalyticsFilters['channel']>>('all')
  const [status, setStatus] = useState<NonNullable<AnalyticsFilters['status']>>('all')
  const [days, setDays] = useState(30)
  const [source, setSource] = useState('all')
  const [search, setSearch] = useState('')
  const [funnel, setFunnel] = useState<MarketingFunnel | null>(null)
  const [rows, setRows] = useState<MarketingMessageRow[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<{ recipient: string; name: string | null } | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Arama yazarken 400ms bekle; diğer filtreler anında
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(debounce.current)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const f: AnalyticsFilters = { channel, status, days: days === -1 ? 0 : days }
    if (days === -1) { const y = yesterdayTR(); f.date_from = y; f.date_to = y }
    if (source !== 'all') f.source = source
    if (debouncedSearch) f.q = debouncedSearch
    marketingAnalyticsApi.get(f)
      .then((d) => {
        Object.assign(DYNAMIC_SOURCE_LABELS, d.source_labels ?? {})
        setFunnel(d.funnel); setRows(d.messages); setTotal(d.total); setSources(d.sources ?? [])
      })
      .finally(() => setLoading(false))
  }, [channel, status, days, source, debouncedSearch])

  const f = funnel ?? { sent: 0, opened: 0, clicked: 0, converted: 0, failed: 0, skipped: 0, revenue: 0 }
  const pct = (v: number) => (f.sent > 0 ? Math.round((v / f.sent) * 100) : 0)
  const isEmailView = channel === 'email' || channel === 'all'
  const sourceOptions = useMemo(() => ['all', ...sources], [sources])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="text-amber-600" size={26} />
        <h1 className="text-xl font-extrabold text-gray-900">Gönderim & Analitik</h1>
      </div>
      <p className="text-sm text-gray-500 mb-4">Tüm kanalların gönderim hunisi ve canlı gönderim akışı — alıcıya tıklayınca o kişiye giden tüm mesajlar açılır.</p>

      {/* Filtreler — satır 1: kanal / durum / kaynak / dönem */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {CHANNELS.map((c) => (
            <button key={c.key} onClick={() => setChannel(c.key)}
              className={clsx('px-3 py-1.5 rounded-md text-sm transition', channel === c.key ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700')}>
              {c.label}
            </button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as NonNullable<AnalyticsFilters['status']>)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          {sourceOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'Tüm kaynaklar' : sourceLabel(s)}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 ml-auto">
          {PERIODS.map((p) => (
            <button key={p.d} onClick={() => setDays(p.d)}
              className={clsx('px-3 py-1.5 rounded-md text-sm transition', days === p.d ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700')}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtreler — satır 2: arama */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="İsim, numara, e-posta, sipariş no veya kupon kodu ara…"
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X size={14} /></button>}
        </div>
      </div>

      {/* Huni — kanala göre dinamik; kartlara tıklayınca liste o duruma filtrelenir */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <Funnel label="Gönderildi" value={f.sent} pct={100} icon={Send} color="text-blue-600"
          active={status === 'sent'} onClick={() => setStatus(status === 'sent' ? 'all' : 'sent')} />
        {isEmailView && <Funnel label="Açıldı" value={f.opened} pct={pct(f.opened)} icon={MailOpen} color="text-indigo-600" />}
        {isEmailView && <Funnel label="Tıklandı" value={f.clicked} pct={pct(f.clicked)} icon={MousePointerClick} color="text-violet-600" />}
        <Funnel label="Dönüştü" value={f.converted} pct={pct(f.converted)} icon={ShoppingCart} color="text-emerald-600"
          active={status === 'converted'} onClick={() => setStatus(status === 'converted' ? 'all' : 'converted')} />
        <Funnel label="Başarısız" value={f.failed} pct={pct(f.failed)} icon={XCircle} color="text-rose-600"
          active={status === 'failed'} onClick={() => setStatus(status === 'failed' ? 'all' : 'failed')} />
        {!isEmailView && <Funnel label="Atlandı" value={f.skipped} pct={pct(f.skipped)} icon={MinusCircle} color="text-gray-500"
          active={status === 'skipped'} onClick={() => setStatus(status === 'skipped' ? 'all' : 'skipped')} />}
      </div>

      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <span className="text-sm text-emerald-800 font-medium">Otomasyonun getirisi</span>
          <span className="block text-xs text-emerald-600/70 mt-0.5">Seçili filtredeki gönderimlere atfedilen satış cirosu — dönüşüm, son gönderilen mesajın kanalına yazılır.</span>
        </div>
        <span className="text-2xl font-semibold text-emerald-700">{fmtMoney(f.revenue)}</span>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Gönderimler</h2>
        <span className="text-xs text-gray-400">{fmtNum(rows.length)} / {fmtNum(total)} kayıt</span>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Kişi</th>
                <th className="text-left px-4 py-3 font-medium">Kanal</th>
                <th className="text-left px-4 py-3 font-medium">Kaynak</th>
                <th className="text-left px-4 py-3 font-medium">Konu / İçerik</th>
                <th className="text-left px-4 py-3 font-medium">Durum</th>
                {isEmailView && <th className="text-center px-4 py-3 font-medium">Açıldı/Tıklandı</th>}
                <th className="text-left px-4 py-3 font-medium">Zaman</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m) => {
                const Icon = CHANNEL_ICON[m.channel] ?? Mail
                const clickable = m.channel !== 'push'
                return (
                  <tr key={m.id} onClick={() => setDetailId(m.id)} className="hover:bg-gray-50 cursor-pointer" title="Mesaj detayını gör">
                    <td className="px-4 py-2.5 max-w-[240px]">
                      <button
                        disabled={!clickable}
                        onClick={(e) => { e.stopPropagation(); if (clickable) setHistory({ recipient: m.contact, name: m.name }) }}
                        className={clsx('text-left w-full', clickable && 'group')}
                        title={clickable ? 'Bu alıcıya giden tüm mesajları gör' : m.contact}>
                        {m.name && <span className={clsx('block text-xs font-medium text-gray-800 truncate', clickable && 'group-hover:text-amber-600')}>{m.name}</span>}
                        <span className={clsx('block truncate font-mono text-xs', m.name ? 'text-gray-400' : 'text-gray-700', clickable && 'group-hover:text-amber-600 group-hover:underline')}>
                          {shortContact(m.channel, m.contact)}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1 text-gray-600 text-xs"><Icon size={13} /> {CHANNEL_LABELS[m.channel] ?? m.channel}</span></td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {sourceLabel(m.source)}
                      {m.is_test && <span className="ml-1 text-[10px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded">test</span>}
                    </td>
                    <td className="px-4 py-2.5"><SubjectCell m={m} /></td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[m.status] ?? 'bg-gray-100 text-gray-500')}>{STATUS_TR[m.status] ?? m.status}</span>
                      {m.reason && <span className="ml-1 text-[10px] text-gray-400" title={reasonLabel(m.reason) ?? undefined}>· {reasonLabel(m.reason)}</span>}
                    </td>
                    {isEmailView && (
                      <td className="px-4 py-2.5 text-center text-xs">
                        <span className={m.opened ? 'text-indigo-600' : 'text-gray-300'} title="Açıldı"><MailOpen size={13} className="inline" /></span>
                        <span className={clsx('ml-2', m.clicked ? 'text-violet-600' : 'text-gray-300')} title="Tıklandı"><MousePointerClick size={13} className="inline" /></span>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{m.at ?? '—'}</td>
                  </tr>
                )
              })}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Bu filtreye uyan gönderim yok.</td></tr>}
              {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Yükleniyor…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {history && <RecipientHistoryModal recipient={history.recipient} name={history.name} onClose={() => setHistory(null)} onSelect={setDetailId} />}
      {detailId !== null && <MessageDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
