import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Gauge, Loader2, Settings, ArrowUpRight, ArrowDownRight, MousePointerClick, Eye, ShoppingCart, CreditCard, ShoppingBag, Smartphone, Monitor, Tablet, ClipboardList, ScanSearch, ArrowRight, AlertTriangle, CheckCircle2, Circle } from 'lucide-react'
import clsx from 'clsx'
import { croApi, fmtNum, fmtTl, PAGE_TYPE_LABELS, STATUS_CLASSES, STATUS_LABELS, type CroOverview, type CroStatus } from '@/lib/croApi'

type Period = '7d' | '30d' | '90d'

/* CRO Özeti — GA4 hunisi + cihaz kırılımı + giriş sayfaları + Yunbi CRO araçları + aksiyon/denetim durumu.
   Tüm oranlar bir önceki eşit uzunluktaki dönemle kıyaslanır. */
export default function CroOverviewPage() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<CroOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    croApi.overview(period)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.message || 'Veriler yüklenemedi'))
      .finally(() => setLoading(false))
  }, [period])

  useEffect(() => { load() }, [load])

  const f = data?.funnel
  const r = data?.rates
  const rp = data?.rates_prev

  const delta = (cur?: number, prev?: number) => {
    if (cur === undefined || prev === undefined || prev === 0) return null
    return Math.round(((cur - prev) / prev) * 1000) / 10
  }

  const kpis = f && r ? [
    { label: 'Dönüşüm oranı', value: r.cr.toFixed(2) + '%', d: delta(r.cr, rp?.cr), hint: 'Satın alma / oturum' },
    { label: 'Oturum', value: fmtNum(f.sessions, locale), d: delta(f.sessions, data?.funnel_prev?.sessions) },
    { label: 'Sipariş (GA4)', value: fmtNum(f.purchases, locale), d: delta(f.purchases, data?.funnel_prev?.purchases) },
    { label: 'Ciro (GA4)', value: fmtTl(f.revenue, locale), d: delta(f.revenue, data?.funnel_prev?.revenue) },
    { label: 'Sepet ortalaması', value: fmtTl(r.aov, locale), d: delta(r.aov, rp?.aov) },
    { label: 'Oturum başına ciro', value: r.rps.toFixed(2) + ' TL', d: delta(r.rps, rp?.rps), hint: 'CRO\'nun ana göstergesi' },
  ] : []

  const steps = f ? [
    { key: 'sessions', label: 'Oturum', value: f.sessions, icon: MousePointerClick, color: 'bg-indigo-500' },
    { key: 'views', label: 'Ürün görüntüleme', value: f.views, icon: Eye, color: 'bg-blue-500' },
    { key: 'add_to_carts', label: 'Sepete ekleme', value: f.add_to_carts, icon: ShoppingCart, color: 'bg-amber-500' },
    { key: 'checkouts', label: 'Ödeme başlatma', value: f.checkouts, icon: CreditCard, color: 'bg-orange-500' },
    { key: 'purchases', label: 'Satın alma', value: f.purchases, icon: ShoppingBag, color: 'bg-emerald-500' },
  ] : []
  const maxStep = Math.max(1, ...steps.map((s) => s.value))
  // En büyük kayıp adımı: yalnız sepet→ödeme ve ödeme→satın alma kıyaslanır
  // (ürün görüntüleme oturum başına birden çok sayıldığından oran anlamsızdır)
  const drops = steps.slice(3).map((s, i) => ({ from: steps[i + 2], to: s, rate: steps[i + 2].value > 0 ? s.value / steps[i + 2].value : 0 }))
  const worst = drops.length ? drops.reduce((a, b) => (b.rate < a.rate ? b : a)) : null

  const devIcon = (d: string) => (d === 'mobile' ? Smartphone : d === 'desktop' ? Monitor : Tablet)
  const devLabel = (d: string) => ({ mobile: 'Mobil', desktop: 'Masaüstü', tablet: 'Tablet' } as Record<string, string>)[d] ?? d
  const totalDevSessions = data?.devices.reduce((a, d) => a + d.sessions, 0) ?? 0
  const mobile = data?.devices.find((d) => d.device === 'mobile')
  const desktop = data?.devices.find((d) => d.device === 'desktop')

  const landing = (data?.landing_pages ?? []).slice(0, 10)
  const opportunities = (data?.landing_pages ?? []).filter((l) => l.opportunity)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Gauge size={24} /> Dönüşüm Özeti</h1>
          <p className="text-sm text-gray-500 mt-1">Ziyaretçiden siparişe giden yolun neresinde kayıp var, hangi aracın etkisi ne — tek ekranda.</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-[var(--app-bg)] p-1">
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full transition-colors', period === p ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500 hover:text-gray-700')}>
              {p === '7d' ? 'Son 7 gün' : p === '30d' ? 'Son 30 gün' : 'Son 90 gün'}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>}
      {!loading && error && <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error}</div>}

      {!loading && data && !data.ga4_configured && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <Gauge size={40} className="mx-auto text-gray-300 mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Huni verisi için GA4 bağlantısı gerekli</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">Oturum, sepete ekleme ve satın alma adımları Google Analytics 4'ten okunur.</p>
          <button onClick={() => navigate('/ads/settings')} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"><Settings size={16} /> GA4 Bağlantısı</button>
        </div>
      )}

      {!loading && data && f && r && (
        <>
          {/* KPI'lar */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {kpis.map((k) => (
              <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{k.label}</p>
                <p className="text-xl font-extrabold text-gray-900 mt-1">{k.value}</p>
                <div className="flex items-center gap-1 mt-1 min-h-[16px]">
                  {k.d !== null && k.d !== undefined && (
                    <span className={clsx('inline-flex items-center gap-0.5 text-[11px] font-semibold', k.d >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {k.d >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(k.d)}%
                    </span>
                  )}
                  {k.hint && <span className="text-[11px] text-gray-400 truncate">{k.hint}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Huni */}
            <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-900">Satın alma hunisi</h2>
                <span className="text-xs text-gray-400">{data.period.start} → {data.period.end}</span>
              </div>
              <div className="space-y-3">
                {steps.map((s, i) => {
                  // Sepete ekleme oturuma, sonraki adımlar bir önceki adıma oranlanır
                  const base = s.key === 'add_to_carts' ? steps[0] : i > 0 ? steps[i - 1] : null
                  const conv = base && base.value > 0 ? (s.value / base.value) * 100 : null
                  const width = Math.max(4, Math.round((s.value / maxStep) * 100))
                  return (
                    <div key={s.key}>
                      {s.key === 'views' && f.sessions > 0 && (
                        <div className="text-[11px] text-gray-400 pl-1 mb-1">oturum başına {(f.views / f.sessions).toFixed(1)} ürün görüntüleme</div>
                      )}
                      {conv !== null && i > 1 && (
                        <div className="flex items-center gap-2 text-[11px] text-gray-400 pl-1 mb-1">
                          <ArrowDownRight size={12} /> {s.key === 'add_to_carts' ? 'oturumların' : 'önceki adımın'} <b className={clsx(worst && worst.to.key === s.key ? 'text-rose-600' : 'text-gray-600')}>%{conv.toFixed(1)}</b>'i geçti
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <div className="w-40 shrink-0 flex items-center gap-2 text-sm text-gray-700"><s.icon size={15} className="text-gray-400" /> {s.label}</div>
                        <div className="flex-1 h-8 rounded-lg bg-[var(--app-bg)] overflow-hidden">
                          <div className={clsx('h-full rounded-lg', s.color)} style={{ width: width + '%' }} />
                        </div>
                        <div className="w-24 text-right text-sm font-bold text-gray-900">{fmtNum(s.value, locale)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {worst && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 text-rose-800 p-3 text-sm">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>En büyük kayıp <b>{worst.from.label} → {worst.to.label}</b> adımında: her 100 kişiden yalnızca <b>{Math.round(worst.rate * 100)}</b>'i geçiyor. CRO aksiyonlarında bu adıma odaklanın.</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400">Sepete ekleme oranı</p><p className="font-extrabold text-gray-900">%{r.atc_rate}</p></div>
                <div className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400">Sepet → ödeme</p><p className="font-extrabold text-gray-900">%{r.atc_to_checkout}</p></div>
                <div className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400">Ödeme → satın alma</p><p className="font-extrabold text-gray-900">%{r.checkout_to_purchase}</p></div>
              </div>
            </div>

            {/* Cihazlar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-900 mb-4">Cihaza göre dönüşüm</h2>
              <div className="space-y-3">
                {data.devices.filter((d) => d.sessions > 100).map((d) => {
                  const Icon = devIcon(d.device)
                  const share = totalDevSessions > 0 ? Math.round((d.sessions / totalDevSessions) * 100) : 0
                  return (
                    <div key={d.device} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800"><Icon size={16} className="text-gray-400" /> {devLabel(d.device)}</div>
                        <span className="text-xs text-gray-400">trafiğin %{share}'i</span>
                      </div>
                      <div className="flex items-end justify-between mt-2">
                        <div><p className="text-[11px] text-gray-400">Dönüşüm</p><p className="text-lg font-extrabold text-gray-900">%{d.conversion_rate}</p></div>
                        <div className="text-right"><p className="text-[11px] text-gray-400">Ciro</p><p className="text-sm font-bold text-gray-700">{fmtTl(d.revenue, locale)}</p></div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {mobile && desktop && desktop.conversion_rate > mobile.conversion_rate * 1.3 && (
                <p className="mt-3 text-xs text-gray-500 leading-snug">
                  Mobil dönüşüm masaüstünün <b>{(mobile.conversion_rate / desktop.conversion_rate * 100).toFixed(0)}%</b>'i. Mobil trafiğin dönüşümü masaüstü seviyesine çekilse dönemde yaklaşık <b>{fmtNum(Math.round(mobile.sessions * (desktop.conversion_rate - mobile.conversion_rate) / 100), locale)}</b> ek sipariş gelirdi — mobil UX ilk öncelik.
                </p>
              )}
            </div>
          </div>

          {/* Giriş sayfaları */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900">Giriş sayfaları</h2>
              {opportunities.length > 0 && <span className="text-xs font-semibold text-rose-600 bg-rose-50 rounded-full px-2.5 py-1">{opportunities.length} fırsat sayfası</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Sayfa</th><th className="py-2 pr-3 text-right">Oturum</th><th className="py-2 pr-3 text-right">Sipariş</th><th className="py-2 pr-3 text-right">Dönüşüm</th><th className="py-2 pr-3 text-right">Hemen çıkma</th><th className="py-2 text-right">Potansiyel</th>
                </tr></thead>
                <tbody>
                  {landing.map((l) => (
                    <tr key={l.landing_page} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-3 font-medium text-gray-800 max-w-[280px] truncate">{l.landing_page}</td>
                      <td className="py-2 pr-3 text-right text-gray-600">{fmtNum(l.sessions, locale)}</td>
                      <td className="py-2 pr-3 text-right text-gray-600">{fmtNum(l.purchases, locale)}</td>
                      <td className={clsx('py-2 pr-3 text-right font-bold', l.opportunity ? 'text-rose-600' : 'text-gray-800')}>%{l.conversion_rate}</td>
                      <td className="py-2 pr-3 text-right text-gray-600">%{l.bounce_rate}</td>
                      <td className="py-2 text-right">{l.opportunity ? <span className="text-xs font-semibold text-rose-700 bg-rose-50 rounded-full px-2 py-0.5">+{l.potential_orders} sipariş</span> : <span className="text-xs text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Potansiyel: sayfa site ortalaması dönüşüme çekilse dönemde gelecek ek sipariş (≥500 oturum ve ortalamanın %70'i altındaki sayfalar).</p>
          </div>
        </>
      )}

      {!loading && data && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Yunbi araçları */}
          <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-3">Yunbi CRO araçları</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.tools.map((tool) => (
                <Link key={tool.key} to={tool.url} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 hover:bg-[var(--app-bg)] transition-colors">
                  {tool.enabled ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" /> : <Circle size={18} className="text-gray-300 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">{tool.label}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {!tool.enabled && 'Kapalı — açmak için tıkla'}
                      {tool.enabled && tool.metric && 'revenue' in tool.metric && `${fmtTl(tool.metric.revenue, locale)} atfedilen ciro · ${tool.metric.orders} sipariş${'zero_rate' in tool.metric ? ` · sıfır sonuç %${tool.metric.zero_rate}` : ''}`}
                      {tool.enabled && tool.metric && 'spins' in tool.metric && `${fmtNum(tool.metric.spins, locale)} çevirme · ${tool.metric.redeemed} kupon kullanıldı`}
                      {tool.enabled && tool.metric && 'sessions' in tool.metric && `${tool.metric.sessions} sohbet`}
                      {tool.enabled && !tool.metric && 'Açık'}
                    </p>
                  </div>
                  <ArrowRight size={14} className="text-gray-300" />
                </Link>
              ))}
            </div>
          </div>

          {/* Aksiyon + denetim */}
          <div className="space-y-5">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-900 flex items-center gap-2"><ClipboardList size={17} /> Aksiyon planı</h2>
                <Link to="/cro/actions" className="text-xs font-semibold text-[var(--primary-strong)]">Tümü</Link>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(Object.keys(STATUS_LABELS) as CroStatus[]).map((st) => (
                  <span key={st} className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', STATUS_CLASSES[st])}>{STATUS_LABELS[st]} {data.actions.counts[st] ?? 0}</span>
                ))}
              </div>
              {data.actions.top.length === 0 ? (
                <p className="text-sm text-gray-500">Henüz aksiyon yok. <Link to="/cro/actions" className="text-[var(--primary-strong)] font-semibold">Katalogdan ekle</Link>.</p>
              ) : (
                <ul className="space-y-2">
                  {data.actions.top.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-[10px] font-bold rounded-md bg-orange-100 text-orange-700 px-1.5 py-0.5 shrink-0">ICE {a.impact * a.confidence * a.ease}</span>
                        <div className="min-w-0"><p className="text-gray-800 leading-snug">{a.title}</p>{a.expected_uplift && <p className="text-[11px] text-gray-400">{a.expected_uplift}</p>}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-900 flex items-center gap-2"><ScanSearch size={17} /> Site denetimi</h2>
                <Link to="/cro/audit" className="text-xs font-semibold text-[var(--primary-strong)]">Detay</Link>
              </div>
              {data.audit ? (
                <div className="flex items-center gap-4">
                  <div className={clsx('w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-extrabold', data.audit.avg_score >= 80 ? 'bg-emerald-100 text-emerald-700' : data.audit.avg_score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>{data.audit.avg_score}</div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {data.audit.pages.map((p) => <p key={p.page_type}><b className="text-gray-700">{PAGE_TYPE_LABELS[p.page_type] ?? p.page_type}</b> {p.score}/100</p>)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Henüz denetim çalıştırılmadı. <Link to="/cro/audit" className="text-[var(--primary-strong)] font-semibold">Şimdi çalıştır</Link>.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
