import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Disc3, Plus, Search, RefreshCw, Users, RotateCw, Globe, Save, CheckCircle, ChevronDown, BarChart3 } from 'lucide-react'
import clsx from 'clsx'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  wheelApi,
  statusBadgeClass,
  STATUS_LABELS,
  type WheelCampaignRow,
} from '@/lib/wheelApi'
import { getTemplate } from '@/lib/wheelTemplates'

function WidgetSettings() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [domains, setDomains] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get('/settings').then((res) => {
      const s = res.data.settings || {}
      setEnabled(s.wheel_widget_enabled === 'true' || s.wheel_widget_enabled === true)
      setDomains(s.wheel_widget_domains || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', {
        settings: { wheel_widget_enabled: enabled ? 'true' : 'false', wheel_widget_domains: domains },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
        <span className="flex items-center gap-2">
          <Globe size={16} className="text-rose-600" /> Widget Ayarları (siteye gömme izinleri)
          {loaded && !enabled && <span className="text-xs text-amber-600 font-normal">— widget kapalı</span>}
        </span>
        <ChevronDown size={16} className={clsx('transition-transform text-gray-400', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700">Çark widget'ı aktif</div>
              <div className="text-xs text-gray-500">Kapalıyken çark hiçbir sitede gösterilmez.</div>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', enabled ? 'bg-rose-600' : 'bg-gray-200')}
            >
              <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', enabled ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">İzinli site alan adları</label>
            <input
              type="text"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="www.magazaniz.com, magazaniz.com"
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Virgülle ayırın. Çark yalnızca bu alan adlarından çağrılabilir (güvenlik). Alt alan adı için <code>*.magazaniz.com</code> yazılabilir.
              {user?.tenant?.slug && <> Gömme kodundaki <code>data-tenant</code> = <code>{user.tenant.slug}</code>.</>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
              <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle size={15} /> Kaydedildi</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WheelCampaignsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<WheelCampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [pickGame, setPickGame] = useState(false)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await wheelApi.list({ q: search || undefined })
      setRows(res.data)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    load()
  }, [load])

  // game: 'wheel' (1. Çark) | 'scratch' (2. Kazı Kazan) — Oyun Kampanyaları altında ayrı kampanyalar.
  const createCampaign = async (game: 'wheel' | 'scratch' | 'ab' = 'wheel') => {
    setCreating(true)
    setError(null)
    // Süper admin tenant seçmeden tenant'a özel kayıt oluşturamaz (X-Tenant-Id gerekli)
    const isSuperAdmin = !!JSON.parse(localStorage.getItem('auth_user') ?? '{}')?.is_super_admin
    if (isSuperAdmin && !localStorage.getItem('selected_tenant_id')) {
      setError('Kampanya oluşturmak için önce üst menüden bir firma (tenant) seçin.')
      setCreating(false)
      return
    }
    try {
      // Varsayılan = Mono (siyah-beyaz) şablon; dilim renkleri mono paletten dönüşümlü.
      const mono = getTemplate('mono')
      const baseSlices = [
        { label: '50 TL', prize_type: 'discount_amount', prize_value: 50, weight: 25, coupon_code_template: 'TL50', stock_limit: null },
        { label: '150 TL', prize_type: 'discount_amount', prize_value: 150, weight: 15, coupon_code_template: 'TL150', stock_limit: null },
        { label: '100 TL', prize_type: 'discount_amount', prize_value: 100, weight: 15, coupon_code_template: 'TL100', stock_limit: null },
        { label: '300 TL (min 1500₺)', prize_type: 'discount_amount', prize_value: 300, weight: 2, coupon_code_template: 'TL300', stock_limit: null, min_basket: 1500 },
        { label: '100 TL', prize_type: 'discount_amount', prize_value: 100, weight: 15, coupon_code_template: 'TL100', stock_limit: null },
        { label: '200 TL', prize_type: 'discount_amount', prize_value: 200, weight: 10, coupon_code_template: 'TL200', stock_limit: null },
        { label: '150 TL', prize_type: 'discount_amount', prize_value: 150, weight: 15, coupon_code_template: 'TL150', stock_limit: null },
        { label: '500 TL (min 2000₺)', prize_type: 'discount_amount', prize_value: 500, weight: 1, coupon_code_template: 'TL500', stock_limit: null, min_basket: 2000 },
        { label: 'Bir Dahaki Sefere', prize_type: 'none', prize_value: 0, weight: 2, coupon_code_template: '', stock_limit: null },
      ] as const
      const c = await wheelApi.create({
        name: game === 'scratch' ? 'Yeni Kazı Kazan Kampanyası' : game === 'ab' ? 'Yeni A/B Testi' : 'Yeni Çark Kampanyası',
        status: 'draft',
        game_type: game,
        coupon_provider: 'ticimax', // her çevirmede Ticimax'ta gerçek kupon
        // Kazı kazan: 30 dk kupon + formsuz (herkes direkt kazır) varsayılanı
        ...(game === 'scratch' ? { settings: { ab_percent: 0, ab_campaign_a_id: null, ab_campaign_b_id: null, scratch_valid_minutes: 30, scratch_skip_form: true } } : {}),
        ...(game === 'ab' ? { settings: { ab_percent: 50, ab_campaign_a_id: null, ab_campaign_b_id: null, scratch_valid_minutes: 30, scratch_skip_form: false } } : {}),
        design: { template: mono.id, ...mono.design },
        // TL bazlı, kargo bedava YOK. Küçük tutarlar minimumsuz; sadece 300/500 TL'de min. sepet
        // (etikette gösterilir, gerçek kısıt Ticimax kuponunda tanımlanır). Ağırlıklar toplamı 100
        // → ağırlık = gerçek olasılık. "Bir Dahaki Sefere" = kaybeden dilim. 150/100 TL bilerek 2'şer.
        ...(game === 'ab' ? {} : { slices: baseSlices.map((s, i) => ({ ...s, color: mono.palette[i % mono.palette.length] })) }),
      })
      navigate(`/wheel/${c.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { message?: string } } }
      if (err.response?.status === 403) {
        setError('Bu işlem için “Pazarlama” yetkiniz yok. Yöneticinizden firma/kullanıcı yetkilerine Pazarlama’yı eklemesini isteyin.')
      } else {
        setError(err.response?.data?.message ?? 'Kampanya oluşturulamadı. Lütfen tekrar deneyin.')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Disc3 className="text-rose-600" size={26} />
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Oyun Kampanyaları</h1>
            <div className="text-xs text-gray-400">Türler: 🎡 Çark · 🎫 Kazı Kazan · ⚖️ A/B Testi (iki oyunu karşılaştırır). Tek gömme kodu yeter.</div>
          </div>
        </div>
        <button
          onClick={() => setPickGame(true)}
          disabled={creating}
          className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        >
          <Plus size={16} /> Yeni Kampanya
        </button>
        {pickGame && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPickGame(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="text-lg font-extrabold text-gray-900 mb-1">Ne kuracaksınız?</div>
              <div className="text-xs text-gray-400 mb-5">Her oyun ayrı bir kampanyadır; kendi tasarımı, ödülleri ve istatistiği olur. A/B Testi iki oyunu karşılaştırır.</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => { setPickGame(false); createCampaign('wheel') }}
                  className="text-left border-2 border-gray-200 hover:border-rose-500 rounded-xl p-4 transition"
                >
                  <div className="text-3xl mb-2">🎡</div>
                  <div className="font-bold text-gray-900">1. Çark</div>
                  <div className="text-xs text-gray-500 mt-1">Ziyaretçi bilgilerini girer, çarkı çevirir, kupon kazanır. Lead toplar. Kupon 24 saat geçerli.</div>
                </button>
                <button
                  onClick={() => { setPickGame(false); createCampaign('scratch') }}
                  className="text-left border-2 border-gray-200 hover:border-amber-500 rounded-xl p-4 transition"
                >
                  <div className="text-3xl mb-2">🎫</div>
                  <div className="font-bold text-gray-900">2. Kazı Kazan</div>
                  <div className="text-xs text-gray-500 mt-1">"Sana özel" kart belirir, herkes direkt kazır. Form yok. Kupon 30 dakika geçerli, sayaçla hemen kullanıma iter.</div>
                </button>
                <button
                  onClick={() => { setPickGame(false); createCampaign('ab') }}
                  className="text-left border-2 border-gray-200 hover:border-violet-500 rounded-xl p-4 transition"
                >
                  <div className="text-3xl mb-2">⚖️</div>
                  <div className="font-bold text-gray-900">A/B Testi</div>
                  <div className="text-xs text-gray-500 mt-1">İki oyun kampanyasını seçin, yüzde verin. Ziyaretçiler ikisine bölünür; kullanım ve ciro karşılaştırması bu kampanyada görünür.</div>
                </button>
              </div>
              <div className="mt-4 text-right">
                <button onClick={() => setPickGame(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Vazgeç</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <WidgetSettings />

      {error && (
        <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSearch(q)}
            placeholder="Kampanya ara…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
          />
        </div>
        <button onClick={() => setSearch(q)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          Ara
        </button>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50" title="Yenile">
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Kampanya</th>
              <th className="text-left px-4 py-3 font-medium">Durum</th>
              <th className="text-left px-4 py-3 font-medium">Oyun</th>
              <th className="text-center px-4 py-3 font-medium">Dilim</th>
              <th className="text-center px-4 py-3 font-medium">Lead</th>
              <th className="text-center px-4 py-3 font-medium">Oynanma</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/wheel/${r.id}`)}>
                <td className="px-4 py-3">
                  <Link to={`/wheel/${r.id}`} className="font-medium text-gray-900 hover:text-rose-600" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  <div className="text-xs text-gray-400 font-mono">{r.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium', statusBadgeClass(r.status))}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 items-center">
                    {r.game_type === 'ab' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800" title="A/B Testi">
                        ⚖️ A/B · {r.ab_a_name ?? '?'} %{100 - (r.ab_percent ?? 0)} / {r.ab_b_name ?? '?'} %{r.ab_percent ?? 0}
                      </span>
                    ) : r.game_type === 'scratch' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800" title={r.scratch_skip_form ? 'Formsuz: herkes direkt kazır' : 'Formlu'}>
                        🎫 2. Kazı Kazan · {r.scratch_valid_minutes ?? 30} dk{r.scratch_skip_form ? ' · formsuz' : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">🎡 1. Çark</span>
                    )}
                    {r.game_type !== 'ab' && r.ab_owner_name && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-violet-800 border border-violet-300" title="Bu kampanya yayındaki bir A/B testinin A tarafı">
                        ⚖️ {r.ab_owner_name}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-gray-600">{r.slices_count}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <Users size={14} /> {r.leads_count}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <RotateCw size={14} /> {r.spins_count}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/wheel/${r.id}/istatistik`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-rose-600"
                    title="İstatistikler & katılımcılar"
                  >
                    <BarChart3 size={14} /> İstatistik
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  Henüz kampanya yok. “Yeni Kampanya” ile başlayın.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
