import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, SlidersHorizontal, Download, Wallet, ExternalLink, Search } from 'lucide-react'
import { wheelApi, type WheelStats, type WheelLeadRow, type WheelCampaign } from '@/lib/wheelApi'

/**
 * Çark İstatistikleri sayfası — performans metrikleri (ciro, çevirme, kupon, kullanım) +
 * altında katılımcı listesi. İleride genişletilecek (kanal kırılımı, zaman serisi vb.).
 */
export default function WheelCampaignStatsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState<WheelCampaign | null>(null)
  // Tarih filtresi üstte tutulur → hem metrikler/grafik (StatsView) hem katılımcılar (tablo) aynı aralığı kullanır.
  // Varsayılan = BUGÜN (müşteri isterse filtreden başka aralık seçebilir).
  const [dateKey, setDateKey] = useState('today')
  const [from, setFrom] = useState(() => rangeForKey('today').from)
  const [to, setTo] = useState(() => rangeForKey('today').to)

  const setDatePreset = (key: string) => {
    setDateKey(key)
    if (key !== 'custom') {
      const r = rangeForKey(key)
      setFrom(r.from)
      setTo(r.to)
    }
  }

  useEffect(() => {
    if (id) wheelApi.get(Number(id)).then(setCampaign).catch(() => navigate('/wheel'))
  }, [id, navigate])

  if (!campaign) return <div className="p-6 text-gray-400 text-sm">Yükleniyor…</div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/wheel" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-lg font-extrabold text-gray-900">{campaign.name}</h1>
            <div className="text-xs text-gray-400">{campaign.game_type === 'ab' ? '⚖️ A/B Testi' : campaign.game_type === 'scratch' ? '🎫 Kazı Kazan' : '🎡 Çark'} · İstatistikler · /{campaign.slug}</div>
          </div>
        </div>
        <Link
          to={`/wheel/${campaign.id}`}
          className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
        >
          <SlidersHorizontal size={15} /> Kampanya Ayarları
        </Link>
      </div>

      <StatsView campaignId={campaign.id} from={from} to={to} />
      <div className="mt-6">
        <div className="text-sm font-semibold text-gray-700 mb-2">Katılımcılar</div>
        <ParticipantsTable campaign={campaign} dateKey={dateKey} from={from} to={to} setDatePreset={setDatePreset} setFrom={setFrom} setTo={setTo} />
      </div>
    </div>
  )
}

function fmtTL(v: number): string {
  return Number(v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
}

function StatsView({ campaignId, from, to }: { campaignId: number; from: string; to: string }) {
  const [s, setS] = useState<WheelStats | null>(null)

  useEffect(() => {
    setS(null)
    wheelApi.stats(campaignId, { from: from || undefined, to: to || undefined }).then(setS)
  }, [campaignId, from, to])

  if (!s) return <div className="text-gray-400 text-sm">Yükleniyor…</div>

  const cards = [
    { label: 'Toplam Çevirme', value: String(s.spins) },
    { label: 'Kazanan', value: `${s.wins} (%${s.win_rate})` },
    { label: 'Kupon Oluştu', value: String(s.coupons_issued) },
    { label: 'Kod Kullanıldı', value: `${s.coupons_redeemed} (%${s.redeem_rate})` },
    { label: 'Toplanan Katılımcı', value: String(s.leads) },
    ...(s.coupons_pending || s.coupons_failed
      ? [{ label: 'Bekleyen / Başarısız', value: `${s.coupons_pending} / ${s.coupons_failed}` }]
      : []),
  ]

  return (
    <div className="space-y-4">
      {/* Ciro vurgu kartı */}
      <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-xl p-5 flex items-center gap-4">
        <div className="bg-white/20 rounded-lg p-3"><Wallet size={26} /></div>
        <div>
          <div className="text-sm opacity-90">Kullanılan kuponlu siparişlerin cirosu (A/B kampanyasında A + B toplamı)</div>
          <div className="text-3xl font-extrabold leading-tight">{fmtTL(s.revenue)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="text-2xl font-semibold text-gray-900">{c.value}</div>
          </div>
        ))}
      </div>

      {/* A/B: Çark vs Kazı Kazan (yalnız iki varyant da veri üretmişse ya da kazı kazan varsa) */}
      {s.by_variant && s.by_variant.length > 1 && (
        <div className="bg-white rounded-lg border border-amber-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700">A/B Testi — Çark vs Kazı Kazan</div>
            <div className="text-xs text-gray-400">kupon kullanım oranı ve ciro karşılaştırması</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left py-1.5 font-medium">Oyun</th>
                  <th className="text-right py-1.5 font-medium">Oynandı</th>
                  <th className="text-right py-1.5 font-medium">Kupon</th>
                  <th className="text-right py-1.5 font-medium">Kullanıldı</th>
                  <th className="text-right py-1.5 font-medium">Kullanım %</th>
                  <th className="text-right py-1.5 font-medium">Ciro</th>
                  <th className="text-right py-1.5 font-medium">Kupon başı ciro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.by_variant.map((v) => {
                  const best = Math.max(...s.by_variant.map((x) => x.redeem_rate))
                  const isBest = v.redeem_rate === best && best > 0
                  return (
                    <tr key={v.campaign_id} className={isBest ? 'bg-emerald-50/60' : ''}>
                      <td className="py-2 font-medium text-gray-800">
                        {v.variant === 'scratch' ? '🎫 ' : '🎡 '}
                        <Link to={`/wheel/${v.campaign_id}/istatistik`} className="hover:underline">{v.name}</Link>
                        {v.variant === 'scratch' && v.valid_minutes ? <span className="text-gray-400 font-normal"> · {v.valid_minutes} dk</span> : null}
                        {isBest && <span className="ml-2 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">ÖNDE</span>}
                      </td>
                      <td className="py-2 text-right text-gray-700">{v.spins}</td>
                      <td className="py-2 text-right text-gray-700">{v.coupons_issued}</td>
                      <td className="py-2 text-right text-gray-700">{v.coupons_redeemed}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">%{v.redeem_rate}</td>
                      <td className="py-2 text-right text-gray-700">{fmtTL(v.revenue)}</td>
                      <td className="py-2 text-right text-gray-500">{fmtTL(v.coupons_issued > 0 ? v.revenue / v.coupons_issued : 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-gray-400">Kullanım = kupon koduyla verilen ödenmiş sipariş. Karar için her iki oyunda da en az birkaç yüz kupon birikmesini bekleyin.</div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-gray-700">Dilim Dağılımı</div>
          <div className="text-xs text-gray-400">verilen · kullanılan (oran)</div>
        </div>
        <div className="space-y-2">
          {[...s.by_slice]
            .sort((a, b) => {
              // Ödül tutarına göre küçükten büyüğe (50→500). Etiketteki İLK sayı = ödül TL'si
              // ("300 TL (min 1.500₺)" → 300). Sayısı olmayan (kaybeden dilim) sona.
              const na = parseInt((a.prize_label.match(/\d+/) || ['999999'])[0], 10)
              const nb = parseInt((b.prize_label.match(/\d+/) || ['999999'])[0], 10)
              return na - nb
            })
            .map((b) => {
            const pct = s.spins > 0 ? (b.total / s.spins) * 100 : 0
            const used = b.redeemed ?? 0
            const usedPct = b.total > 0 ? (used / b.total) * 100 : 0
            return (
              <div key={b.prize_label} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate text-gray-600">{b.prize_label}</span>
                <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden relative">
                  <div className="bg-rose-200 h-full absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
                  <div className="bg-rose-500 h-full absolute inset-y-0 left-0" style={{ width: `${pct * (usedPct / 100)}%` }} />
                </div>
                <span className="w-24 text-right text-gray-500 text-xs">{b.total} · {used} (%{usedPct.toFixed(0)})</span>
              </div>
            )
          })}
          {s.by_slice.length === 0 && <div className="text-gray-400 text-sm">Henüz veri yok.</div>}
        </div>
      </div>
    </div>
  )
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rangeForKey(key: string): { from: string; to: string } {
  const now = new Date()
  const today = fmtDate(now)
  const minus = (n: number) => fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n))
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: minus(1), to: minus(1) }
    case 'last7': return { from: minus(6), to: today }
    case 'last30': return { from: minus(29), to: today }
    case 'thisMonth': return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
    case 'lastMonth': return {
      from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
    default: return { from: '', to: '' } // all
  }
}

const DATE_PRESETS = [
  { key: 'all', label: 'Tüm Zamanlar' },
  { key: 'today', label: 'Bugün' },
  { key: 'yesterday', label: 'Dün' },
  { key: 'last7', label: 'Son 7 Gün' },
  { key: 'last30', label: 'Son 30 Gün' },
  { key: 'thisMonth', label: 'Bu Ay' },
  { key: 'lastMonth', label: 'Geçen Ay' },
  { key: 'custom', label: 'Özel Tarih' },
]

function ParticipantsTable({ campaign, dateKey, from, to, setDatePreset, setFrom, setTo }: {
  campaign: WheelCampaign
  dateKey: string
  from: string
  to: string
  setDatePreset: (key: string) => void
  setFrom: (v: string) => void
  setTo: (v: string) => void
}) {
  const campaignId = campaign.id
  const [rows, setRows] = useState<WheelLeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [prize, setPrize] = useState('')
  const [used, setUsed] = useState<'' | '0' | '1'>('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [exporting, setExporting] = useState(false)

  const prizeOptions = Array.from(new Set(campaign.slices.map((s) => s.label).filter(Boolean)))

  // Tarih (üstten yönetiliyor) değişince sayfayı başa al
  useEffect(() => { setPage(1) }, [from, to])

  const filters = { from: from || undefined, to: to || undefined, prize: prize || undefined, used: used || undefined, q: q || undefined }

  // Arama kutusu debounce (her tuşta istek atma)
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQ(qInput.trim()) }, 350)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    setLoading(true)
    wheelApi.leads(campaignId, { page, ...filters }).then((r) => {
      setRows(r.data)
      setLastPage(r.last_page)
      setTotal(r.total)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, page, from, to, prize, used, q])

  const doExport = async () => {
    setExporting(true)
    try {
      await wheelApi.leadsExport(campaignId, filters)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Ara (ad, telefon, e-posta)</span>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="İsim, telefon veya e-posta…"
              className="pl-7 pr-2 py-1.5 border border-gray-300 rounded w-56"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Tarih aralığı</span>
          <select value={dateKey} onChange={(e) => setDatePreset(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded bg-white">
            {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {dateKey === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">Başlangıç</span>
              <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value) }} className="px-2 py-1.5 border border-gray-300 rounded" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">Bitiş</span>
              <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value) }} className="px-2 py-1.5 border border-gray-300 rounded" />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Ödül</span>
          <select value={prize} onChange={(e) => { setPage(1); setPrize(e.target.value) }} className="px-2 py-1.5 border border-gray-300 rounded bg-white max-w-[160px]">
            <option value="">Tüm Ödüller</option>
            {prizeOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Kullanım</span>
          <select value={used} onChange={(e) => { setPage(1); setUsed(e.target.value as '' | '0' | '1') }} className="px-2 py-1.5 border border-gray-300 rounded bg-white">
            <option value="">Tümü</option>
            <option value="1">Kullanıldı</option>
            <option value="0">Kullanılmadı</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-600">Toplam: <span className="font-semibold text-gray-900">{total}</span> kayıt</span>
          <button
            onClick={doExport}
            disabled={exporting || total === 0}
            className="inline-flex items-center gap-1.5 text-sm bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700 disabled:opacity-40"
          >
            <Download size={15} /> {exporting ? 'Hazırlanıyor…' : 'CSV indir'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Ad Soyad</th>
              <th className="text-left px-3 py-2 font-medium">İletişim</th>
              <th className="text-left px-3 py-2 font-medium">Çevirme Tarihi</th>
              <th className="text-left px-3 py-2 font-medium">Oyun</th>
              <th className="text-left px-3 py-2 font-medium">Ödül</th>
              <th className="text-left px-3 py-2 font-medium">Kupon</th>
              <th className="text-left px-3 py-2 font-medium">Durum</th>
              <th className="text-left px-3 py-2 font-medium">Sipariş / Kullanım</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Yükleniyor…</td></tr>
            )}
            {!loading && rows.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-900">
                  {l.full_name ?? '—'}
                  {l.is_test && <span className="ml-1.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">TEST</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  <div>{l.email ?? ''}</div>
                  <div className="text-xs text-gray-400">{l.phone ?? ''}</div>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{l.spun_at ?? l.created_at}</td>
                <td className="px-3 py-2 text-xs">
                  {l.variant === 'scratch'
                    ? <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">Kazı Kazan</span>
                    : <span className="text-gray-500">Çark</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{l.prize_label ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-700">{l.coupon_code ?? '—'}</td>
                <td className="px-3 py-2"><CouponStatusBadge status={l.coupon_status} redeemedAt={l.used_at ?? l.redeemed_at} hasPaidOrder={!!(l.order_id || l.used_at)} /></td>
                <td className="px-3 py-2 text-xs">
                  {l.order_no || l.used_at ? (
                    <div className="text-emerald-700">
                      <div className="font-medium">{l.used_at ?? '—'}</div>
                      <div className="text-gray-400">
                        {l.order_no && l.order_id ? (
                          <Link to={`/crm/orders/${l.order_id}`} className="text-emerald-700 hover:underline inline-flex items-center gap-1" title="Siparişe git">
                            No: {l.order_no} <ExternalLink size={11} />
                          </Link>
                        ) : l.order_no ? `No: ${l.order_no}` : ''}
                        {l.order_total != null ? ` · ${Number(l.order_total).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : ''}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-300">Sipariş yok</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Bu aralıkta kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40">Önceki</button>
          <span className="text-gray-500">Sayfa {page} / {lastPage}</span>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage} className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40">Sonraki</button>
        </div>
      )}
    </div>
  )
}

function CouponStatusBadge({ status, redeemedAt, hasPaidOrder }: { status?: WheelLeadRow['coupon_status']; redeemedAt?: string | null; hasPaidOrder?: boolean }) {
  // Ödenmiş sipariş varsa coupon_status senkronu gecikmiş olsa bile "Kullanıldı" göster
  // (filtre + sipariş kolonuyla tutarlı olsun).
  const effective = hasPaidOrder ? 'redeemed' : status
  if (!effective || effective === 'none') return <span className="text-gray-300 text-xs">—</span>
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Bekliyor', cls: 'bg-amber-50 text-amber-700' },
    issued: { label: 'Verildi', cls: 'bg-sky-50 text-sky-700' },
    redeemed: { label: 'Kullanıldı', cls: 'bg-emerald-50 text-emerald-700' },
    failed: { label: 'Başarısız', cls: 'bg-rose-50 text-rose-700' },
    expired: { label: 'Süresi doldu', cls: 'bg-gray-100 text-gray-500' },
  }
  const m = map[effective] ?? { label: effective, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${m.cls}`} title={redeemedAt ? `Kullanım: ${redeemedAt}` : ''}>
      {m.label}
    </span>
  )
}
