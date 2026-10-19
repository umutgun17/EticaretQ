import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Send, CheckCircle2, Eye, MousePointerClick, ShoppingBag, Ticket,
  TrendingUp, Play, Pause, X, AlertTriangle, Search, UserX,
} from 'lucide-react'
import clsx from 'clsx'
import { campaignsApi, type Campaign, type RecipientRow } from '@/lib/campaignsApi'
import { STATUS_TR } from './CampaignsPage'

const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)
const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
const fmtDT = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

const SKIP_TR: Record<string, string> = {
  suppressed: 'şikayet listesinde',
  recent_contact: 'yakında mesaj almış',
  invalid_phone: 'geçersiz numara',
  campaign_cancelled: 'kampanya iptal edildi',
  channel_disabled: 'kanal kapalı',
  quiet_hours: 'sessiz saat',
}

const FILTERS = [
  ['', 'Tümü'], ['pending', 'Bekliyor'], ['sent', 'Gönderildi'], ['clicked', 'Tıkladı'],
  ['converted', 'Satın aldı'], ['skipped', 'Atlandı'], ['failed', 'Hata'],
] as const

function Funnel({ icon: Icon, label, value, sub, color }: { icon: typeof Send; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><Icon size={13} className={color} /> {label}</div>
      <div className="text-lg font-semibold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

export default function CampaignDetailPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [rows, setRows] = useState<RecipientRow[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const d = await campaignsApi.show(campaignId, { status: filter || undefined, q: q || undefined, page })
    setCampaign(d.campaign)
    setRows(d.recipients.data)
    setLastPage(d.recipients.last_page)
    setTotal(d.recipients.total)
  }, [campaignId, filter, q, page])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (campaign?.status !== 'sending') return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [campaign?.status, load])

  async function action(act: 'start' | 'pause' | 'resume' | 'cancel') {
    if (act === 'cancel' && !confirm('Kampanya iptal edilsin mi?')) return
    setBusy(true); setErr(null)
    try { await campaignsApi.update(campaignId, { action: act }); await load() } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'İşlem başarısız.')
    } finally { setBusy(false) }
  }

  if (!campaign) return <div className="p-8 text-center text-gray-400">Yükleniyor…</div>
  const st = STATUS_TR[campaign.status] ?? STATUS_TR.draft
  const s = campaign.stats
  const pctOf = (v: number, base: number) => (base > 0 ? ` (%${Math.round((v / base) * 100)})` : '')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/marketing/campaigns" className="p-1.5 text-gray-400 hover:text-gray-700"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              {campaign.name}
              <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
            </h1>
            <div className="text-xs text-gray-500 mt-0.5">
              {campaign.list_name} · şablon <span className="font-mono">{campaign.template_name}</span>
              {campaign.coupon_code && <> · kupon <span className="font-mono text-indigo-600">{campaign.coupon_code}</span></>}
              {campaign.started_at && <> · başladı {fmtDT(campaign.started_at)}</>}
              {campaign.completed_at && <> · bitti {fmtDT(campaign.completed_at)}</>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {(campaign.status === 'draft' || campaign.status === 'paused') && (
            <button onClick={() => action(campaign.status === 'draft' ? 'start' : 'resume')} disabled={busy}
              className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-50">
              <Play size={15} /> {campaign.status === 'draft' ? 'Başlat' : 'Devam Et'}
            </button>
          )}
          {campaign.status === 'sending' && (
            <button onClick={() => action('pause')} disabled={busy}
              className="px-3 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-1.5 disabled:opacity-50">
              <Pause size={15} /> Duraklat
            </button>
          )}
          {['draft', 'sending', 'paused'].includes(campaign.status) && (
            <button onClick={() => action('cancel')} disabled={busy}
              className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50">
              <X size={15} /> İptal Et
            </button>
          )}
        </div>
      </div>

      {campaign.paused_reason && campaign.status === 'paused' && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle size={15} /> {campaign.paused_reason}
        </div>
      )}
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}

      {s.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${campaign.progress_pct}%` }} />
            </div>
            <span className="text-sm font-medium text-gray-700 shrink-0">%{campaign.progress_pct}</span>
          </div>
          <div className="mt-1.5 text-xs text-gray-500">
            {fmtNum(s.total)} kişilik liste · {fmtNum(s.sent + s.skipped + s.failed)} işlendi · <b>{fmtNum(s.pending)} sırada</b>
            {campaign.eta_at && campaign.status === 'sending' && <> · tahmini bitiş: <b className="text-gray-700">{fmtDT(campaign.eta_at)}</b></>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Funnel icon={Send} label="Gönderildi" value={`${fmtNum(s.sent)}/${fmtNum(s.total)}`} color="text-blue-600" />
        <Funnel icon={CheckCircle2} label="Ulaştı" value={fmtNum(s.delivered)} sub={pctOf(s.delivered, s.sent).trim()} color="text-emerald-600" />
        <Funnel icon={Eye} label="Okundu" value={fmtNum(s.read)} sub={pctOf(s.read, s.sent).trim()} color="text-indigo-600" />
        <Funnel icon={MousePointerClick} label="Tıkladı" value={fmtNum(s.clicked)} sub={pctOf(s.clicked, s.sent).trim()} color="text-violet-600" />
        <Funnel icon={ShoppingBag} label="Satın aldı" value={fmtNum(s.converted)} sub={pctOf(s.converted, s.sent).trim()} color="text-emerald-700" />
        <Funnel icon={Ticket} label="Kuponla aldı" value={fmtNum(s.coupon_used)} color="text-pink-600" />
        <Funnel icon={TrendingUp} label="Ciro" value={fmtMoney(s.revenue)} color="text-emerald-700" />
        <Funnel icon={Ticket} label="Kuponlu sipariş (toplam)" value={fmtNum(s.coupon_orders_total)} sub="alıcı olmayanlar dâhil" color="text-gray-500" />
        <Funnel icon={UserX} label="Karalisteye girdi" value={fmtNum(s.blacklisted)} sub={s.sent > 0 ? `gönderilenin %${((s.blacklisted / s.sent) * 100).toFixed(1)}'i` : undefined} color="text-red-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => { setFilter(k); setPage(1) }}
                className={clsx('px-2.5 py-1 text-xs rounded-full', filter === k ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="pl-7 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-52" placeholder="İsim veya numara ara…"
              value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Alıcı</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Gönderim</th>
                <th className="px-3 py-2 font-medium">Ulaştı</th>
                <th className="px-3 py-2 font-medium">Okundu</th>
                <th className="px-3 py-2 font-medium">Tıklandı</th>
                <th className="px-3 py-2 font-medium">Satın alma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="text-gray-800">{r.name ?? '—'}</div>
                    <div className="font-mono text-gray-400">{r.phone ?? r.email ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    {r.status === 'sent' && <span className="text-emerald-600">gönderildi</span>}
                    {r.status === 'pending' && <span className="text-gray-400">bekliyor</span>}
                    {r.status === 'skipped' && <span className="text-amber-600">{SKIP_TR[r.skip_reason ?? ''] ?? r.skip_reason ?? 'atlandı'}</span>}
                    {r.status === 'failed' && <span className="text-red-500" title={r.error ?? undefined}>hata</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{fmtDT(r.sent_at)}</td>
                  <td className="px-3 py-2">{r.message?.delivered_at ? <CheckCircle2 size={14} className="text-emerald-500" /> : '—'}</td>
                  <td className="px-3 py-2">{r.message?.opened_at ? <Eye size={14} className="text-indigo-500" /> : '—'}</td>
                  <td className="px-3 py-2">{r.message?.clicked_at ? <MousePointerClick size={14} className="text-violet-500" /> : '—'}</td>
                  <td className="px-3 py-2">
                    {r.converted_at ? (
                      <span className="text-emerald-700 font-medium">
                        {fmtMoney(Number(r.revenue))}{r.coupon_used && <span className="ml-1 text-pink-600" title="Kampanya kuponuyla">🎟️</span>}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {lastPage > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>{fmtNum(total)} kayıt · sayfa {page}/{lastPage}</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">Önceki</button>
              <button disabled={page >= lastPage} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">Sonraki</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
