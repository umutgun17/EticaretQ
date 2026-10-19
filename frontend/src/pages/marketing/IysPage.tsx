import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Play, Pause, Save, RefreshCw, Database, AlertTriangle,
  CheckCircle2, XCircle, Clock, Send, FlaskConical, Phone, Mail,
} from 'lucide-react'
import clsx from 'clsx'
import { iysApi, type IysOverview, type IysRecentRow } from '@/lib/iysApi'

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

const STATUS_BADGE: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = {
  sent: 'Gönderildi',
  partial: 'Kısmi',
  failed: 'Hatalı',
  pending: 'Bekliyor',
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={clsx('text-2xl font-semibold mt-1', tone ?? 'text-gray-900')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function TypeChips({ row }: { row: IysRecentRow }) {
  const tr = row.types_result ?? {}
  const types = ['ARAMA', 'MESAJ', 'EPOSTA'].filter(t =>
    t === 'EPOSTA' ? !!row.email : !!row.phone)
  return (
    <div className="flex gap-1 flex-wrap">
      {types.map(t => {
        const r = tr[t]
        const ok = r?.ok === true
        const tried = r !== undefined
        return (
          <span key={t} className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
            ok ? 'bg-emerald-100 text-emerald-700' : tried ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500')}>
            {t}{tried ? (ok ? ' ✓' : ' ✗') : ''}
          </span>
        )
      })}
    </div>
  )
}

export default function IysPage() {
  const [data, setData] = useState<IysOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // form state
  const [dailyTarget, setDailyTarget] = useState(100)
  const [windowStart, setWindowStart] = useState('09:30')
  const [windowEnd, setWindowEnd] = useState('21:30')
  const [brandCode, setBrandCode] = useState('')

  // test
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await iysApi.overview()
      setData(d)
      setDailyTarget(d.settings.daily_target)
      setWindowStart(d.settings.window_start)
      setWindowEnd(d.settings.window_end)
      setBrandCode(d.settings.brand_code ?? '')
    } catch {
      setMsg({ ok: false, text: 'Veriler yüklenemedi.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 5000)
  }

  const saveSettings = async (extra?: { enabled?: boolean }) => {
    setSaving(true)
    try {
      await iysApi.updateSettings({
        daily_target: dailyTarget,
        window_start: windowStart,
        window_end: windowEnd,
        brand_code: brandCode,
        ...extra,
      })
      flash(true, extra?.enabled === true ? 'Aktarım BAŞLATILDI.' : extra?.enabled === false ? 'Aktarım duraklatıldı.' : 'Ayarlar kaydedildi.')
      await load()
    } catch {
      flash(false, 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const runSeed = async () => {
    setSeeding(true)
    try {
      const r = await iysApi.seed()
      flash(true, `Kuyruk güncellendi: ${r.added} yeni kişi (toplam ${r.total.toLocaleString('tr-TR')}).`)
      await load()
    } catch {
      flash(false, 'Kuyruk doldurulamadı.')
    } finally {
      setSeeding(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await iysApi.test({ phone: testPhone || undefined, email: testEmail || undefined })
      const parts = Object.entries(r.results).map(([t, x]) => `${t}: ${x.ok ? '✓' : '✗ ' + (x.error ?? x.code ?? '')}`)
      setTestResult(parts.join('  |  '))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setTestResult('Hata: ' + (err.response?.data?.message ?? 'istek başarısız'))
    } finally {
      setTesting(false)
    }
  }

  const maxSeries = useMemo(
    () => Math.max(1, ...(data?.series ?? []).map(s => Number(s.attempted))),
    [data],
  )

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Yükleniyor…</div>
  }
  if (!data) {
    return <div className="p-6 text-sm text-red-600">Veriler yüklenemedi.</div>
  }

  const enabled = data.settings.enabled
  const cfgReady = data.config.ready

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Başlık + ana kontrol */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <ShieldCheck size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">İYS Aktarımı</h1>
            <p className="text-xs text-gray-500">Sipariş izinlerinin Netgsm İYS'ye kademeli aktarımı — site + mobil uygulama siparişleri</p>
          </div>
          <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
            {enabled ? 'ÇALIŞIYOR' : 'DURDURULDU'}
          </span>
        </div>
        <button
          onClick={() => saveSettings({ enabled: !enabled })}
          disabled={saving || (!enabled && !cfgReady)}
          className={clsx('inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50',
            enabled ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700')}
        >
          {enabled ? <Pause size={16} /> : <Play size={16} />}
          {enabled ? 'Duraklat' : 'Başlat'}
        </button>
      </div>

      {msg && (
        <div className={clsx('mb-4 px-4 py-2.5 rounded-lg text-sm', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
          {msg.text}
        </div>
      )}

      {!cfgReady && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            Yapılandırma eksik: {data.config.missing.includes('netgsm_credentials') && 'SMS kanalında Netgsm kullanıcı bilgisi yok. '}
            {data.config.missing.includes('brand_code') && 'İYS Marka Kodu girilmedi (aşağıdaki ayarlardan kaydedin).'}
            {' '}Aktarım başlatılamaz.
          </div>
        </div>
      )}

      {/* Durum kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
        <StatCard label="Kuyruktaki kişi" value={data.stock.total.toLocaleString('tr-TR')} sub="tekil kişi (tel + e-posta)" />
        <StatCard label="Gönderilen" value={data.stock.sent.toLocaleString('tr-TR')} tone="text-emerald-600" />
        <StatCard label="Kalan" value={data.stock.remaining.toLocaleString('tr-TR')} sub={data.eta_days ? `~${data.eta_days} gün kaldı` : undefined} />
        <StatCard label="Kısmi / Hatalı" value={`${data.stock.partial} / ${data.stock.failed}`} tone={data.stock.failed > 0 ? 'text-red-600' : undefined} />
        <StatCard label="Bugünün kotası" value={data.today.quota.toLocaleString('tr-TR')} sub={`hedef ${data.settings.daily_target} ±%25`} />
        <StatCard label="Bugün işlenen" value={data.today.attempted.toLocaleString('tr-TR')} sub={`${data.today.sent} tamamı başarılı`} tone="text-indigo-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        {/* Ayarlar */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Clock size={15} /> Tempo &amp; Ayarlar</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Günlük hedef (kişi)</label>
              <input type="number" min={1} max={20000} value={dailyTarget}
                onChange={e => setDailyTarget(Number(e.target.value))} className={clsx(inputCls, 'w-full')} />
              <p className="text-[11px] text-gray-400 mt-1">
                Gerçek günlük kota her gün hedefin %75–%125'i arasında kendiliğinden değişir.
                Kayıtlar pencere içine yayılır, aralar rastgeledir.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Pencere başı</label>
                <input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)} className={clsx(inputCls, 'w-full')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Pencere sonu</label>
                <input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)} className={clsx(inputCls, 'w-full')} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">İYS Marka Kodu (Netgsm)</label>
              <input type="text" value={brandCode} onChange={e => setBrandCode(e.target.value)}
                placeholder="Netgsm panelindeki İYS marka kodu" className={clsx(inputCls, 'w-full')} />
            </div>
            <button onClick={() => saveSettings()} disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              <Save size={15} /> Kaydet
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Database size={13} /> Kuyruk</h3>
            <p className="text-[11px] text-gray-400 mb-2">
              Siparişlerden tekil kişileri kuyruğa alır (yalnız site + app; pazaryeri hariç).
              Tekrar çalıştırmak güvenlidir — yalnız yeni kişiler eklenir.
            </p>
            <button onClick={runSeed} disabled={seeding}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw size={14} className={seeding ? 'animate-spin' : ''} /> {seeding ? 'Dolduruluyor…' : 'Kuyruğu Güncelle'}
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FlaskConical size={13} /> Canlı Test</h3>
            <div className="space-y-2">
              <div className="relative">
                <Phone size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input type="text" value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="05XX XXX XX XX" className={clsx(inputCls, 'w-full pl-8')} />
              </div>
              <div className="relative">
                <Mail size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
                  placeholder="ornek@eposta.com" className={clsx(inputCls, 'w-full pl-8')} />
              </div>
              <button onClick={runTest} disabled={testing || (!testPhone && !testEmail)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                <Send size={14} /> {testing ? 'Gönderiliyor…' : 'Test İzni Gönder'}
              </button>
              {testResult && <div className="text-[11px] text-gray-600 bg-gray-50 rounded p-2 break-all">{testResult}</div>}
              <p className="text-[10px] text-gray-400">Bu buton İYS'ye GERÇEK izin kaydı yazar — kendi numaranızla test edin.</p>
            </div>
          </div>
        </div>

        {/* Günlük seri + son gönderimler */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Son 30 Gün</h2>
            {data.series.length === 0 ? (
              <p className="text-xs text-gray-400">Henüz gönderim yok.</p>
            ) : (
              <div className="flex items-end gap-1 h-28">
                {data.series.map(s => (
                  <div key={s.d} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="w-full bg-indigo-100 rounded-t relative" style={{ height: `${(Number(s.attempted) / maxSeries) * 100}%`, minHeight: 3 }}>
                      <div className="absolute bottom-0 left-0 right-0 bg-indigo-500 rounded-t" style={{ height: `${Number(s.attempted) > 0 ? (Number(s.sent) / Number(s.attempted)) * 100 : 0}%` }} />
                    </div>
                    <div className="hidden group-hover:block absolute -top-9 bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap z-10">
                      {s.d}: {s.attempted} işlem / {s.sent} başarılı
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Son Gönderimler</h2>
              <button onClick={load} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"><RefreshCw size={12} /> Yenile</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Kişi</th>
                    <th className="text-left px-3 py-2 font-medium">İletişim</th>
                    <th className="text-left px-3 py-2 font-medium">İlk Sipariş</th>
                    <th className="text-left px-3 py-2 font-medium">Tipler</th>
                    <th className="text-left px-3 py-2 font-medium">Durum</th>
                    <th className="text-left px-3 py-2 font-medium">İşlem Zamanı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.recent.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Henüz gönderim yapılmadı.</td></tr>
                  )}
                  {data.recent.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 text-gray-900">{r.name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">
                        <div>{r.phone ?? ''}</div>
                        <div className="text-gray-400">{r.email ?? ''}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        <div>{r.first_order_at ? new Date(r.first_order_at).toLocaleDateString('tr-TR') : '—'}</div>
                        <div className="text-gray-400">{r.first_order_no} · {r.order_source}</div>
                      </td>
                      <td className="px-3 py-2"><TypeChips row={r} /></td>
                      <td className="px-3 py-2">
                        <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_BADGE[r.status])}>
                          {r.status === 'sent' ? <CheckCircle2 size={10} /> : r.status === 'failed' ? <XCircle size={10} /> : null}
                          {STATUS_LABEL[r.status]}
                        </span>
                        {r.last_error && <div className="text-[10px] text-red-500 mt-0.5 max-w-[180px] truncate" title={r.last_error}>{r.last_error}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {r.last_attempt_at ? new Date(r.last_attempt_at).toLocaleString('tr-TR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
