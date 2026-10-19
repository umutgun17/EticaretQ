import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import {
  BellRing, Save, CheckCircle, Copy, Check, Plus, Trash2, ExternalLink,
  Megaphone, ShieldCheck, Truck, Zap, RotateCcw, Lock, Phone, Star, Package, CreditCard,
} from 'lucide-react'

/* Kampanya Duyuruları widget'ı — 3'ü 1 arada (bildirim çanı + sticky üst bar + güven rozetleri).
   Ayarlar tenants.settings düz anahtarlarında tutulur (kargo sayacı ile aynı model);
   listeler (çan duyuruları, güven rozetleri) JSON string olarak saklanır. */

type BellItem = { id: string; title: string; text: string; url: string; starts_at: string; ends_at: string }
type TrustItem = { icon: string; title: string; subtitle: string }
type TickerItem = { icon: string; text: string; url: string }
type Highlight = { text: string; url: string; color: string }

const TRUST_ICONS = [
  { key: 'truck', label: 'Kargo', Icon: Truck },
  { key: 'zap', label: 'Hızlı', Icon: Zap },
  { key: 'refresh', label: 'İade', Icon: RotateCcw },
  { key: 'shield', label: 'Güven', Icon: ShieldCheck },
  { key: 'lock', label: 'Kilit', Icon: Lock },
  { key: 'phone', label: 'Destek', Icon: Phone },
  { key: 'star', label: 'Yıldız', Icon: Star },
  { key: 'box', label: 'Paket', Icon: Package },
  { key: 'check', label: 'Onay', Icon: CheckCircle },
  { key: 'card', label: 'Kart', Icon: CreditCard },
]

const TICKER_PRESETS: TickerItem[] = [
  { icon: 'zap', text: '24 saatte kargo', url: '' },
  { icon: 'truck', text: '1500 TL üzeri ücretsiz kargo', url: '' },
  { icon: 'card', text: 'Vade farksız 3 taksit imkanı', url: '' },
]

const TRUST_PRESETS: TrustItem[] = [
  { icon: 'truck', title: 'Kargo Bedava', subtitle: 'Tüm siparişlerde' },
  { icon: 'zap', title: 'Hızlı Kargo', subtitle: '16:00’a kadar aynı gün' },
  { icon: 'refresh', title: 'Kolay İade', subtitle: '14 gün iade garantisi' },
]

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export default function AnnounceWidgetPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [tenantSettings, setTenantSettings] = useState<Record<string, string>>({})
  const [tenantSlug, setTenantSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get('/settings')
      .then((res) => {
        setTenantSettings(res.data.settings || {})
        // Süper-admin tenant değiştirince de doğru slug gelsin diye API yanıtı esas alınır
        if (res.data.tenant?.slug) setTenantSlug(res.data.tenant.slug)
      })
      .catch(() => {
        if (user?.tenant?.settings) setTenantSettings(user.tenant.settings as Record<string, string>)
      })
  }, [user])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { settings: tenantSettings })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, value: string) => setTenantSettings((prev) => ({ ...prev, [key]: value }))

  const enabled = tenantSettings.announce_widget_enabled === 'true'
  const bellEnabled = tenantSettings.announce_bell_enabled === 'true'
  const topbarEnabled = tenantSettings.announce_topbar_enabled === 'true'
  const trustEnabled = tenantSettings.announce_trust_enabled === 'true'

  const bellItems = parseJson<BellItem[]>(tenantSettings.announce_bell_items, [])
  const trustItems = parseJson<TrustItem[]>(tenantSettings.announce_trust_items, [])
  const setBellItems = (items: BellItem[]) => set('announce_bell_items', JSON.stringify(items))
  const setTrustItems = (items: TrustItem[]) => set('announce_trust_items', JSON.stringify(items))
  const tickerItems = parseJson<TickerItem[]>(tenantSettings.announce_ticker_items, [])
  const setTickerItems = (items: TickerItem[]) => set('announce_ticker_items', JSON.stringify(items))
  const tickerEnabled = tenantSettings.announce_ticker_enabled === 'true'
  const tickerBg = tenantSettings.announce_ticker_bg || '#111827'
  const tickerFg = tenantSettings.announce_ticker_fg || '#ffffff'
  const tickerInterval = Math.max(2, Math.min(15, parseInt(tenantSettings.announce_ticker_interval || '4', 10) || 4))
  // Panel önizlemesi: maddeler gerçek widget gibi sırayla döner
  const [tickerPreviewIdx, setTickerPreviewIdx] = useState(0)
  useEffect(() => {
    if (tickerItems.length < 2) return
    const id = setInterval(() => setTickerPreviewIdx((i) => (i + 1) % tickerItems.length), tickerInterval * 1000)
    return () => clearInterval(id)
  }, [tickerItems.length, tickerInterval])

  const highlights = parseJson<Highlight[]>(tenantSettings.announce_topbar_highlights, [])
  const setHighlights = (items: Highlight[]) => set('announce_topbar_highlights', JSON.stringify(items))
  // Önizleme: metindeki vurgu ifadelerini renkli hap olarak böler (widget'taki richText ile aynı mantık)
  const renderHighlighted = (text: string) => {
    const parts: ReactNode[] = []
    let rest = text
    for (let guard = 0; guard < 20 && rest; guard++) {
      let best = -1
      let bh: Highlight | null = null
      for (const h of highlights) {
        if (!h.text) continue
        const at = rest.toLocaleLowerCase('tr').indexOf(h.text.toLocaleLowerCase('tr'))
        if (at >= 0 && (best < 0 || at < best)) { best = at; bh = h }
      }
      if (best < 0 || !bh) break
      parts.push(rest.slice(0, best))
      parts.push(
        <span key={guard} className="inline-block rounded-md px-2 font-extrabold text-white whitespace-nowrap" style={{ background: bh.color || '#f97316' }}>
          {rest.substr(best, bh.text.length)}
        </span>,
      )
      rest = rest.slice(best + bh.text.length)
    }
    parts.push(rest)
    return parts
  }
  const topbarBg = tenantSettings.announce_topbar_bg || '#111827'
  const topbarFg = tenantSettings.announce_topbar_fg || '#ffffff'

  // DİKKAT: announce.js her değiştiğinde v artmalı — Cloudflare edge TTL origin max-age'i
  // ezdiğinden eski sürüm saatlerce serve edilebiliyor (çark v=7 / kargo v=2 dersi).
  const embedCode = `<script src="https://hub.yunbi.ai/widget/announce.js?v=12"\n        data-tenant="${tenantSlug || user?.tenant?.slug || 'TENANT_SLUG'}"\n        async crossorigin="anonymous"></script>`

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )

  const inputCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold text-gray-900">Widgetlar</h1>
        <a
          href={`https://hub.yunbi.ai/widget/announce-demo.html?tenant=${tenantSlug || user?.tenant?.slug || ''}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <ExternalLink size={15} /> Canlı demo
        </a>
      </div>

      {/* ---- Genel ---- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <BellRing size={18} /> Genel
          </h2>
          <p className="text-xs text-gray-500">
            Dört özellik tek script'le gelir: sayaçlı üst bar, kayan madde barı, bildirim çanı ve ürün detay güven rozetleri.
            Her birini aşağıdan ayrı ayrı açıp kapatabilirsiniz.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700">Widget Aktif</label>
            <p className="text-xs text-gray-500">Kapalıyken hiçbir özellik hiçbir sayfada görünmez.</p>
          </div>
          <Toggle on={enabled} onClick={() => set('announce_widget_enabled', enabled ? 'false' : 'true')} />
        </div>

        {enabled && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İzinli Domainler</label>
              <input
                type="text"
                value={tenantSettings.announce_widget_domains || ''}
                onChange={(e) => set('announce_widget_domains', e.target.value)}
                placeholder="www.magazaniz.com"
                className={`w-full max-w-md ${inputCls}`}
              />
              <p className="mt-1 text-xs text-gray-500">Virgülle ayırın. Boş bırakılırsa widget hiçbir sitede çalışmaz (güvenlik).</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gömme Kodu</label>
              <div className="relative">
                <textarea readOnly rows={3} value={embedCode}
                  className="w-full max-w-lg px-3 py-2 pr-10 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none" />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(embedCode)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 rounded"
                  title={t('feedCommon.copy')}
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Bu kodu sitenizin {'<head>'} veya {'<body>'} etiketine ekleyin.</p>
            </div>
          </>
        )}
      </div>

      {enabled && (
        <>
          {/* ---- Üst Bar ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <Megaphone size={18} /> Sayaçlı Üst Bar
                </h2>
                <p className="text-xs text-gray-500">
                  Sayfanın en üstünde sabit duran kampanya barı. Bitiş tarihi girerseniz canlı geri sayaç gösterir;
                  süre dolunca bar kendiliğinden kaybolur. <b>Sayaç yalnızca gerçek bitiş tarihiyle çalışır</b> — sahte aciliyet güven kaybettirir.
                  Kayan madde barı da açıksa, bu bar geçerli olduğu sürece öncelik ondadır.
                </p>
              </div>
              <Toggle on={topbarEnabled} onClick={() => set('announce_topbar_enabled', topbarEnabled ? 'false' : 'true')} />
            </div>

            {topbarEnabled && (
              <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Duyuru Metni</label>
                    <input type="text" maxLength={200}
                      value={tenantSettings.announce_topbar_text || ''}
                      onChange={(e) => set('announce_topbar_text', e.target.value)}
                      placeholder="Sezon indirimi: Seçili ürünlerde %40'a varan indirim!"
                      className={`w-full max-w-xl ${inputCls}`} />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Renkli / Linkli İfadeler (opsiyonel)</label>
                    <p className="text-xs text-gray-500 mb-2">Metinde geçen bir ifadeyi (ör. "%50 İndirim") renkli hap yapar; link verirseniz tıklayınca o sayfaya gider. En fazla 4.</p>
                    <div className="space-y-2">
                      {highlights.map((h, i) => {
                        const missing = h.text !== '' && !(tenantSettings.announce_topbar_text || '').toLocaleLowerCase('tr').includes(h.text.toLocaleLowerCase('tr'))
                        return (
                          <div key={i} className="flex flex-wrap gap-2 items-center border border-gray-200 rounded-lg p-2.5">
                            <input type="color" value={h.color || '#f97316'}
                              onChange={(e) => setHighlights(highlights.map((b, j) => (j === i ? { ...b, color: e.target.value } : b)))}
                              className="h-9 w-12 border border-gray-200 rounded cursor-pointer" />
                            <input type="text" maxLength={60} value={h.text}
                              onChange={(e) => setHighlights(highlights.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
                              placeholder="Metindeki ifade (ör. %50 İndirim)"
                              className={`w-60 ${inputCls} ${missing ? 'border-amber-400' : ''}`} />
                            <input type="url" value={h.url}
                              onChange={(e) => setHighlights(highlights.map((b, j) => (j === i ? { ...b, url: e.target.value } : b)))}
                              placeholder="https://… (opsiyonel link)"
                              className={`flex-1 min-w-64 ${inputCls}`} />
                            <button type="button"
                              onClick={() => setHighlights(highlights.filter((_, j) => j !== i))}
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="Sil">
                              <Trash2 size={16} />
                            </button>
                            {missing && <p className="basis-full text-xs text-amber-600">Bu ifade duyuru metninde geçmiyor — sitede gösterilmez.</p>}
                          </div>
                        )
                      })}
                      {highlights.length < 4 && (
                        <button type="button"
                          onClick={() => setHighlights([...highlights, { text: '', url: '', color: '#f97316' }])}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                          <Plus size={15} /> Renkli İfade Ekle
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bitiş Tarihi (sayaç, opsiyonel)</label>
                      <input type="datetime-local"
                        value={tenantSettings.announce_topbar_ends_at || ''}
                        onChange={(e) => set('announce_topbar_ends_at', e.target.value)}
                        className={`bg-white ${inputCls}`} />
                      <p className="mt-1 text-xs text-gray-500">Türkiye saati. Boşsa bar sayaçsız, süresiz görünür.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Buton Linki (opsiyonel)</label>
                      <input type="url"
                        value={tenantSettings.announce_topbar_url || ''}
                        onChange={(e) => set('announce_topbar_url', e.target.value)}
                        placeholder="https://www.siteniz.com/indirim"
                        className={`w-80 ${inputCls}`} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Buton Metni</label>
                      <input type="text" maxLength={40}
                        value={tenantSettings.announce_topbar_link_text || ''}
                        onChange={(e) => set('announce_topbar_link_text', e.target.value)}
                        placeholder="İncele"
                        className={`w-32 ${inputCls}`} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Önizleme</label>
                    <div className="rounded-lg overflow-hidden border border-gray-200">
                      <div className="flex items-center justify-center gap-3 flex-wrap px-10 py-2.5 text-[13.5px] relative"
                        style={{ background: topbarBg, color: topbarFg }}>
                        <span className="font-semibold">{tenantSettings.announce_topbar_text ? renderHighlighted(tenantSettings.announce_topbar_text) : 'Duyuru metniniz burada görünür'}</span>
                        {tenantSettings.announce_topbar_ends_at && (
                          <span className="font-bold rounded px-2 py-0.5" style={{ background: 'rgba(255,255,255,.16)' }}>2 gün 04:12:33</span>
                        )}
                        {tenantSettings.announce_topbar_url && (
                          <span className="font-bold underline">{tenantSettings.announce_topbar_link_text || 'İncele'}</span>
                        )}
                        <span className="absolute right-2 opacity-75">✕</span>
                      </div>
                    </div>
                  </div>

                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Arka Plan</label>
                    <input type="color" value={topbarBg}
                      onChange={(e) => set('announce_topbar_bg', e.target.value)}
                      className="h-9 w-14 border border-gray-200 rounded cursor-pointer" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Yazı Rengi</label>
                    <input type="color" value={topbarFg}
                      onChange={(e) => set('announce_topbar_fg', e.target.value)}
                      className="h-9 w-14 border border-gray-200 rounded cursor-pointer" />
                  </div>
                </div>

                <div className="flex items-center justify-between max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Kapatılabilir</label>
                    <p className="text-xs text-gray-500">Ziyaretçi barı kapatırsa aynı duyuru ona tekrar gösterilmez.</p>
                  </div>
                  <Toggle
                    on={(tenantSettings.announce_topbar_dismissible ?? 'true') !== 'false'}
                    onClick={() => set('announce_topbar_dismissible', (tenantSettings.announce_topbar_dismissible ?? 'true') !== 'false' ? 'false' : 'true')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ---- Kayan Madde Barı ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <Megaphone size={18} /> Kayan Madde Barı
                </h2>
                <p className="text-xs text-gray-500">
                  Sayfanın en üstünde "24 saatte kargo · 1500 TL üzeri ücretsiz kargo · 3 taksit" gibi maddelerin
                  sırayla kayarak geçtiği bar. Sayaçlı üst bar ile aynı yuvayı kullanır: ikisi de açıksa geçerli sayaçlı
                  kampanya gösterilir, süresi dolunca bu bar devreye girer.
                </p>
              </div>
              <Toggle on={tickerEnabled} onClick={() => set('announce_ticker_enabled', tickerEnabled ? 'false' : 'true')} />
            </div>

            {tickerEnabled && (
              <div className="space-y-4">
                <label className="block text-sm font-medium text-gray-700">Maddeler ({tickerItems.length}/6)</label>

                  {tickerItems.length === 0 && (
                    <button type="button"
                      onClick={() => setTickerItems(TICKER_PRESETS)}
                      className="px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                      Hazır şablonla başla (24 saatte kargo + 1500 TL üzeri ücretsiz kargo + 3 taksit)
                    </button>
                  )}

                  <div className="space-y-2">
                    {tickerItems.map((it, i) => (
                      <div key={i} className="flex flex-wrap gap-2 items-center border border-gray-200 rounded-lg p-2.5">
                        <select value={it.icon}
                          onChange={(e) => setTickerItems(tickerItems.map((b, j) => (j === i ? { ...b, icon: e.target.value } : b)))}
                          className={inputCls}>
                          {TRUST_ICONS.map((ic) => <option key={ic.key} value={ic.key}>{ic.label}</option>)}
                        </select>
                        <input type="text" maxLength={120} value={it.text}
                          onChange={(e) => setTickerItems(tickerItems.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
                          placeholder="Madde (ör. 24 saatte kargo)"
                          className={`flex-1 min-w-52 ${inputCls}`} />
                        <input type="url" value={it.url}
                          onChange={(e) => setTickerItems(tickerItems.map((b, j) => (j === i ? { ...b, url: e.target.value } : b)))}
                          placeholder="https://… (opsiyonel link)"
                          className={`w-64 ${inputCls}`} />
                        <div className="flex gap-0.5">
                          <button type="button" disabled={i === 0}
                            onClick={() => { const a = [...tickerItems]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setTickerItems(a) }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded" title="Yukarı">↑</button>
                          <button type="button" disabled={i === tickerItems.length - 1}
                            onClick={() => { const a = [...tickerItems]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setTickerItems(a) }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded" title="Aşağı">↓</button>
                          <button type="button"
                            onClick={() => setTickerItems(tickerItems.filter((_, j) => j !== i))}
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="Sil">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {tickerItems.length > 0 && tickerItems.length < 6 && (
                      <button type="button"
                        onClick={() => setTickerItems([...tickerItems, { icon: 'check', text: '', url: '' }])}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                        <Plus size={15} /> Madde Ekle
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Geçiş Süresi</label>
                    <div className="flex items-center gap-2">
                      <input type="number" min={2} max={15} value={tickerInterval}
                        onChange={(e) => set('announce_ticker_interval', e.target.value)}
                        className={`w-20 ${inputCls}`} />
                      <span className="text-sm text-gray-500">saniye (her madde bu kadar kalır, sonra yukarı kayar)</span>
                    </div>
                  </div>

                  {tickerItems.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Önizleme</label>
                      <div className="rounded-lg overflow-hidden border border-gray-200">
                        <div className="relative overflow-hidden h-[38px] text-[13.5px]" style={{ background: tickerBg, color: tickerFg }}>
                          <div className="transition-transform duration-500 ease-in-out" style={{ transform: `translateY(-${(tickerPreviewIdx % tickerItems.length) * 38}px)` }}>
                            {tickerItems.map((it, i) => {
                              const Icon = TRUST_ICONS.find((ic) => ic.key === it.icon)?.Icon || CheckCircle
                              return (
                                <div key={i} className="h-[38px] flex items-center justify-center gap-2 font-semibold px-10">
                                  <Icon size={21} strokeWidth={2.4} style={{ color: '#fbbf24' }} className="flex-none" />
                                  <span className="truncate">{it.text || 'Madde metni'}</span>
                                </div>
                              )
                            })}
                          </div>
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-75">✕</span>
                        </div>
                      </div>
                    </div>
                  )}

                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Arka Plan</label>
                    <input type="color" value={tickerBg}
                      onChange={(e) => set('announce_ticker_bg', e.target.value)}
                      className="h-9 w-14 border border-gray-200 rounded cursor-pointer" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Yazı Rengi</label>
                    <input type="color" value={tickerFg}
                      onChange={(e) => set('announce_ticker_fg', e.target.value)}
                      className="h-9 w-14 border border-gray-200 rounded cursor-pointer" />
                  </div>
                </div>

                <div className="flex items-center justify-between max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Kapatılabilir</label>
                    <p className="text-xs text-gray-500">Ziyaretçi barı kapatırsa aynı maddeler ona tekrar gösterilmez.</p>
                  </div>
                  <Toggle
                    on={(tenantSettings.announce_ticker_dismissible ?? 'true') !== 'false'}
                    onClick={() => set('announce_ticker_dismissible', (tenantSettings.announce_ticker_dismissible ?? 'true') !== 'false' ? 'false' : 'true')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ---- Bildirim Çanı ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <BellRing size={18} /> Bildirim Çanı
                </h2>
                <p className="text-xs text-gray-500">
                  Köşede yüzen çan; tıklanınca güncel kampanya listesi açılır. Görülmemiş duyurular kırmızı rozetle sayılır.
                  Tarih penceresi dolan duyuru listeden otomatik düşer.
                </p>
              </div>
              <Toggle on={bellEnabled} onClick={() => set('announce_bell_enabled', bellEnabled ? 'false' : 'true')} />
            </div>

            {bellEnabled && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Konum</label>
                  <div className="flex gap-2">
                    {[{ v: 'right', l: 'Sağ alt' }, { v: 'left', l: 'Sol alt' }].map((o) => (
                      <button key={o.v} type="button"
                        onClick={() => set('announce_bell_position', o.v)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          (tenantSettings.announce_bell_position || 'right') === o.v
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">Duyurular ({bellItems.length}/20)</label>
                  {bellItems.map((it, i) => (
                    <div key={it.id || i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2">
                        <input type="text" maxLength={120} value={it.title}
                          onChange={(e) => setBellItems(bellItems.map((b, j) => (j === i ? { ...b, title: e.target.value } : b)))}
                          placeholder="Başlık (ör. Sezon İndirimi Başladı!)"
                          className={`flex-1 ${inputCls}`} />
                        <button type="button"
                          onClick={() => setBellItems(bellItems.filter((_, j) => j !== i))}
                          className="p-2 text-gray-400 hover:text-red-500 rounded" title="Sil">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <textarea rows={2} maxLength={500} value={it.text}
                        onChange={(e) => setBellItems(bellItems.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
                        placeholder="Açıklama (opsiyonel)"
                        className={`w-full ${inputCls}`} />
                      <div className="flex flex-wrap gap-2 items-center">
                        <input type="url" value={it.url}
                          onChange={(e) => setBellItems(bellItems.map((b, j) => (j === i ? { ...b, url: e.target.value } : b)))}
                          placeholder="https://… (opsiyonel link)"
                          className={`flex-1 min-w-48 ${inputCls}`} />
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <input type="datetime-local" value={it.starts_at}
                            onChange={(e) => setBellItems(bellItems.map((b, j) => (j === i ? { ...b, starts_at: e.target.value } : b)))}
                            className={inputCls} title="Başlangıç (opsiyonel)" />
                          <span>→</span>
                          <input type="datetime-local" value={it.ends_at}
                            onChange={(e) => setBellItems(bellItems.map((b, j) => (j === i ? { ...b, ends_at: e.target.value } : b)))}
                            className={inputCls} title="Bitiş (opsiyonel)" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {bellItems.length < 20 && (
                    <button type="button"
                      onClick={() => setBellItems([...bellItems, { id: String(Date.now()), title: '', text: '', url: '', starts_at: '', ends_at: '' }])}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                      <Plus size={15} /> Duyuru Ekle
                    </button>
                  )}
                  <p className="text-xs text-gray-500">Tarihler Türkiye saati. Başlangıç/bitiş boşsa duyuru hep listede kalır; bitişi geçen duyuru ziyaretçiye hiç gösterilmez.</p>
                </div>
              </div>
            )}
          </div>

          {/* ---- Güven Rozetleri ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <ShieldCheck size={18} /> Güven Rozetleri
                </h2>
                <p className="text-xs text-gray-500">
                  Ürün detay sayfasında sepet butonunun altında "Kargo Bedava · Hızlı Kargo · Kolay İade" tarzı
                  güven şeridi gösterir. En fazla 6 rozet.
                </p>
              </div>
              <Toggle on={trustEnabled} onClick={() => set('announce_trust_enabled', trustEnabled ? 'false' : 'true')} />
            </div>

            {trustEnabled && (
              <div className="space-y-4">
                {trustItems.length === 0 && (
                  <button type="button"
                    onClick={() => setTrustItems(TRUST_PRESETS)}
                    className="px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                    Hazır şablonla başla (Kargo Bedava + Hızlı Kargo + Kolay İade)
                  </button>
                )}

                <div className="space-y-2">
                  {trustItems.map((it, i) => (
                    <div key={i} className="flex flex-wrap gap-2 items-center border border-gray-200 rounded-lg p-2.5">
                      <select value={it.icon}
                        onChange={(e) => setTrustItems(trustItems.map((b, j) => (j === i ? { ...b, icon: e.target.value } : b)))}
                        className={inputCls}>
                        {TRUST_ICONS.map((ic) => <option key={ic.key} value={ic.key}>{ic.label}</option>)}
                      </select>
                      <input type="text" maxLength={60} value={it.title}
                        onChange={(e) => setTrustItems(trustItems.map((b, j) => (j === i ? { ...b, title: e.target.value } : b)))}
                        placeholder="Başlık (ör. Kargo Bedava)"
                        className={`w-44 ${inputCls}`} />
                      <input type="text" maxLength={80} value={it.subtitle}
                        onChange={(e) => setTrustItems(trustItems.map((b, j) => (j === i ? { ...b, subtitle: e.target.value } : b)))}
                        placeholder="Alt metin (ör. 500₺ üzeri)"
                        className={`flex-1 min-w-40 ${inputCls}`} />
                      <button type="button"
                        onClick={() => setTrustItems(trustItems.filter((_, j) => j !== i))}
                        className="p-2 text-gray-400 hover:text-red-500 rounded" title="Sil">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {trustItems.length > 0 && trustItems.length < 6 && (
                    <button type="button"
                      onClick={() => setTrustItems([...trustItems, { icon: 'check', title: '', subtitle: '' }])}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-dashed border-indigo-300">
                      <Plus size={15} /> Rozet Ekle
                    </button>
                  )}
                </div>

                {/* Önizleme */}
                {trustItems.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Önizleme</label>
                    <div className="grid gap-2 max-w-lg" style={{ gridTemplateColumns: `repeat(${Math.min(trustItems.length, 3)}, 1fr)` }}>
                      {trustItems.map((it, i) => {
                        const Icon = TRUST_ICONS.find((ic) => ic.key === it.icon)?.Icon || CheckCircle
                        return (
                          <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-[10px]"
                            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <Icon size={19} className="flex-none" style={{ color: '#0f766e' }} />
                            <span className="min-w-0">
                              <span className="block text-[12px] font-bold text-slate-900 leading-tight">{it.title || 'Başlık'}</span>
                              {it.subtitle && <span className="block text-[11px] text-slate-500 leading-tight">{it.subtitle}</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Yerleşim Selector'ü (opsiyonel)</label>
                  <input type="text"
                    value={tenantSettings.announce_trust_selector || ''}
                    onChange={(e) => set('announce_trust_selector', e.target.value)}
                    placeholder="after:#divSatinAl (boşsa Ticimax varsayılanları denenir)"
                    className={`w-full max-w-md font-mono ${inputCls}`} />
                  <p className="mt-1 text-xs text-gray-500">"before:SEL" elementin önüne, "after:SEL" arkasına ekler. Boş bırakın: sepet butonu bloğunun altı otomatik bulunur.</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Save size={16} />
          {saving ? t('common.saving') : t('common.save')}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle size={16} /> {t('common.saved')}
          </span>
        )}
      </div>
    </div>
  )
}
