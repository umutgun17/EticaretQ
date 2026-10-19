import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Flame, ExternalLink, Loader2, Check, Copy, Plus, Trash2, Save, BarChart3, Sparkles, Search, CalendarDays, ChevronUp, ChevronDown, X, Smartphone, Monitor, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { heroApi, type HeroSettings, type HeroSet, type HeroProduct, type HeroAnalytics, fmtTl } from '@/lib/croApi'

/* "Bugüne Özel" Hero Ürün kulakçığı (CRO) — ekran kenarında kulakçık, tıklanınca/otomatik açılan çekmecede
   panelden seçilen 2-4 hero ürün + gerçek sayaç + beden çipli sepete ekleme. Günlük set planı, tema, davranış, analitik. */

const PRESETS: Record<string, { label: string; desc: string; accent: string; accent2: string; bg: string; ink: string }> = {
  red: { label: 'Kırmızı', desc: 'Klasik fırsat kırmızısı, beyaz çekmece. En yüksek dikkat.', accent: '#dc2626', accent2: '#7f1d1d', bg: '#ffffff', ink: '#111827' },
  sunset: { label: 'Gün Batımı', desc: 'Turuncudan bordoya sıcak geçiş.', accent: '#f97316', accent2: '#be123c', bg: '#ffffff', ink: '#111827' },
  gradient: { label: 'Neon', desc: 'Pembeden mora gradyan; genç markalar.', accent: '#e11d48', accent2: '#7c3aed', bg: '#ffffff', ink: '#111827' },
  black: { label: 'Siyah & Altın', desc: 'Koyu çekmece, altın vurgu. Premium his.', accent: '#c9a227', accent2: '#111111', bg: '#0f0f10', ink: '#f5f5f5' },
  royal: { label: 'Lacivert', desc: 'Güven veren mavi tonları.', accent: '#1d4ed8', accent2: '#1e1b4b', bg: '#ffffff', ink: '#111827' },
  emerald: { label: 'Zümrüt', desc: 'Yeşil; doğal/sağlık markaları.', accent: '#059669', accent2: '#064e3b', bg: '#ffffff', ink: '#111827' },
}
const SOURCE_LABELS: Record<string, string> = { tab: 'Kulakçık tıklaması', auto: 'Otomatik (süre)', exit: 'Çıkış niyeti', scroll: 'Kaydırma derinliği', api: 'Diğer' }
const uid = () => 's' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
const money = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,00$/, '') + ' TL'

function ScaledFrame({ src, width, height, title }: { src: string; width: number; height: number; title: string }) {
  const [scale, setScale] = useState(0.5)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / width)); ro.observe(el); setScale(el.clientWidth / width) }, [width])
  return (
    <div ref={ref} className="w-full overflow-hidden rounded-xl bg-white" style={{ height: height * scale }}>
      <iframe title={title} src={src} loading="lazy" className="border-0" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

function ProductThumb({ p, small }: { p: HeroProduct; small?: boolean }) {
  return (
    <div className={clsx('relative shrink-0 rounded-lg overflow-hidden bg-gray-100', small ? 'w-10 h-[52px]' : 'w-14 h-[74px]')}>
      {p.img && <img src={p.img} alt="" className="w-full h-full object-cover" loading="lazy" />}
      {p.discount_pct > 0 && <span className="absolute top-0.5 left-0.5 bg-rose-600 text-white text-[9px] font-bold rounded px-1">-%{p.discount_pct}</span>}
    </div>
  )
}

export default function CroHeroPage() {
  const [st, setSt] = useState<HeroSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [sets, setSets] = useState<HeroSet[]>([])
  const [cache, setCache] = useState<Record<number, HeroProduct>>({})
  const [dirty, setDirty] = useState(false)
  const [picker, setPicker] = useState<string | null>(null) // set id
  const [q, setQ] = useState('')
  const [onlyDisc, setOnlyDisc] = useState(true)
  const [results, setResults] = useState<HeroProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [suggesting, setSuggesting] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [themeTexts, setThemeTexts] = useState<Record<string, string>>({})
  const [an, setAn] = useState<HeroAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const searchTm = useRef<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    heroApi.settings().then((d) => {
      setSt(d); setDomains(d.domains); setSets(d.sets); setCache(d.products); setDirty(false)
      setTexts({ eyebrow: d.rules.eyebrow, title: d.rules.title, subtitle: d.rules.subtitle, timer_label: d.rules.timer_label, cta_text: d.rules.cta_text, view_text: d.rules.view_text, footer_text: d.rules.footer_text, footer_url: d.rules.footer_url, hide_paths: d.rules.hide_paths })
      setThemeTexts({ tab_text: d.theme.tab_text, tab_emoji: d.theme.tab_emoji, font: d.theme.font })
    }).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { heroApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await heroApi.update(body); setSt(d); if (key === 'sets') { setSets(d.sets); setCache((c) => ({ ...c, ...d.products })); setDirty(false) } setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const embed = st ? `<script src="${st.base_url}/widget/hero.js?v=4" data-tenant="${st.slug}"></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const demoUrl = (open = true) => st ? `/widget/hero-demo.html?tenant=${st.slug}${open ? '&open=1' : ''}&k=${previewKey}` : '#'

  /* ── setler ── */
  const activeId = useMemo(() => {
    if (!st) return null
    const day = st.today
    let best: HeroSet | null = null, span = Infinity, fb: HeroSet | null = null
    for (const s of sets) {
      if (!s.enabled || !s.products.length) continue
      if (!s.start_date && !s.end_date) { fb = fb ?? s; continue }
      if ((s.start_date && day < s.start_date) || (s.end_date && day > s.end_date)) continue
      const sp = s.start_date && s.end_date ? Date.parse(s.end_date) - Date.parse(s.start_date) : Infinity - 1
      if (sp < span) { best = s; span = sp }
    }
    return (best ?? fb)?.id ?? null
  }, [sets, st])
  const setSet = (id: string, p: Partial<HeroSet>) => { setSets(sets.map((s) => (s.id === id ? { ...s, ...p } : s))); setDirty(true) }
  const addSet = (tomorrow = false) => {
    const d = new Date(); if (tomorrow) d.setDate(d.getDate() + 1)
    const iso = d.toISOString().slice(0, 10)
    setSets([...sets, { id: uid(), title: '', subtitle: '', eyebrow: '', badge: '', start_date: tomorrow ? iso : null, end_date: tomorrow ? iso : null, products: [], coupon: '', coupon_text: '', enabled: true }]); setDirty(true)
  }
  const removeSet = (id: string) => { setSets(sets.filter((s) => s.id !== id)); setDirty(true) }
  const moveProduct = (id: string, i: number, d: -1 | 1) => { const s = sets.find((x) => x.id === id); if (!s) return; const j = i + d; if (j < 0 || j >= s.products.length) return; const n = [...s.products]; const t = n[i]; n[i] = n[j]; n[j] = t; setSet(id, { products: n }) }
  const addProduct = (id: string, p: HeroProduct) => {
    const s = sets.find((x) => x.id === id); if (!s || !st) return
    if (s.products.includes(p.id) || s.products.length >= st.max_products) return
    setCache((c) => ({ ...c, [p.id]: p })); setSet(id, { products: [...s.products, p.id] })
  }
  const suggest = async (id: string) => {
    setSuggesting(id)
    try { const r = await heroApi.suggest(3); if (!r.data.length) { setError('Öneri için indirimli+stoklu ürün bulunamadı'); return } setCache((c) => { const n = { ...c }; r.data.forEach((p) => { n[p.id] = p }); return n }); setSet(id, { products: r.data.map((p) => p.id) }) }
    catch { setError('Öneri alınamadı') } finally { setSuggesting(null) }
  }
  useEffect(() => {
    if (picker === null) return
    if (searchTm.current) window.clearTimeout(searchTm.current)
    searchTm.current = window.setTimeout(() => {
      setSearching(true)
      heroApi.products({ q: q || undefined, limit: 24, discounted: onlyDisc ? 1 : 0 }).then(setResults).catch(() => setResults([])).finally(() => setSearching(false))
    }, 300)
  }, [q, onlyDisc, picker])

  const Section = ({ step, title, desc, children, right }: { step: string; title: string; desc?: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <span className="w-7 h-7 rounded-full bg-[var(--primary-soft)] text-[var(--primary-strong)] text-xs font-bold flex items-center justify-center shrink-0">{step}</span>
          <div><h2 className="font-bold text-gray-900">{title}</h2>{desc && <p className="text-xs text-gray-500 mt-0.5 max-w-2xl leading-relaxed">{desc}</p>}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
  const Toggle = ({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
    <button type="button" onClick={() => onChange(!on)} className="flex items-start gap-3 text-left rounded-xl border border-gray-100 p-3 hover:bg-[var(--app-bg)] w-full">
      <span className={clsx('mt-0.5 w-9 h-5 rounded-full relative transition-colors shrink-0', on ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-[18px]' : 'left-0.5')} /></span>
      <span><span className="text-sm font-semibold text-gray-800 block">{label}</span>{hint && <span className="text-[11px] text-gray-500">{hint}</span>}</span>
    </button>
  )
  const inputCls = 'rounded-xl bg-[var(--app-bg)] border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-strong)]/30 focus:bg-white'
  const Seg = <T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
    <div className="flex flex-wrap rounded-full bg-[var(--app-bg)] p-0.5">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', value === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{l}</button>)}</div>
  )
  const Field = ({ label, k, store, setStore, placeholder, w }: { label: string; k: string; store: Record<string, string>; setStore: (f: (s: Record<string, string>) => Record<string, string>) => void; placeholder?: string; w?: string }) => (
    <div className={w}><label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label><input className={clsx(inputCls, 'w-full')} value={store[k] ?? ''} onChange={(e) => setStore((s) => ({ ...s, [k]: e.target.value }))} placeholder={placeholder} /></div>
  )

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>

  const previewSrc = `/widget/hero-demo.html?tenant=${st.slug}&open=1&note=0&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify({ ...st.rules, auto_open: false }))}&k=${previewKey}`

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Flame size={24} className="text-rose-600" /> Bugüne Özel — Hero Ürün Kulakçığı
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Ekran kenarında dikkat çeken bir kulakçık; tıklanınca ya da belirlediğin süre sonra kendiliğinden açılan çekmecede günün 2-4 hero ürünü, gerçek sayaç, beden seçimiyle tek dokunuşta sepete ekleme.</p>
        </div>
        <a href={demoUrl()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-full"><ExternalLink size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm flex justify-between"><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div>}

      {/* 1 Kurulum */}
      <Section step="1" title="Kurulum" desc="Sepet ve ödeme akışında hiç görünmez. Widget açık olsa da tema koduna eklenmeden mağazada bir şey değişmez.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Kulakçık açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz." />
            <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
              <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
          </div>
          <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu (tüm sayfalara, {'</body>'} öncesi)</label>
            <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div></div>
        </div>
      </Section>

      {/* 2 Setler */}
      <Section step="2" title="Günün ürünleri (setler)" desc={`Bugün ${st.today}. Tarihli set o günlerde yayındadır; tarihsiz set diğer günlerin yedeğidir. En fazla ${st.max_products} ürün; stoksuz veya görselsiz ürün çekmecede otomatik gizlenir. Sıra çekmecedeki sırayı belirler.`}
        right={<div className="flex items-center gap-2">
          <button onClick={() => addSet(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 border border-gray-200 rounded-full px-3 py-1.5"><CalendarDays size={13} /> Yarını planla</button>
          <button onClick={() => addSet(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 border border-gray-200 rounded-full px-3 py-1.5"><Plus size={13} /> Yeni set</button>
          <button onClick={() => patch('sets', { sets })} disabled={!dirty || saving === 'sets'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'sets' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Setleri kaydet</button>
        </div>}>
        {sets.length === 0 && <div className="text-sm text-gray-500 rounded-xl border border-dashed border-gray-200 p-6 text-center">Henüz set yok. <button onClick={() => addSet(false)} className="text-rose-600 font-semibold">Yeni set</button> oluşturup ürün seç ya da <span className="font-semibold">Yunbi önersin</span> ile başla.</div>}
        <div className="space-y-4">
          {sets.map((s) => {
            const isActive = s.id === activeId
            const prods = s.products.map((id) => cache[id]).filter(Boolean) as HeroProduct[]
            return (
              <div key={s.id} className={clsx('rounded-2xl border p-4', isActive ? 'border-rose-300 bg-rose-50/30' : 'border-gray-200', !s.enabled && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button onClick={() => setSet(s.id, { enabled: !s.enabled })} className={clsx('w-9 h-5 rounded-full relative shrink-0', s.enabled ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', s.enabled ? 'left-[18px]' : 'left-0.5')} /></button>
                  {isActive && <span className="text-[10.5px] font-bold rounded-full bg-rose-600 text-white px-2 py-0.5 tracking-wide">BUGÜN YAYINDA</span>}
                  {!s.start_date && !s.end_date && <span className="text-[10.5px] font-semibold rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">Her zaman (yedek)</span>}
                  <input value={s.title} onChange={(e) => setSet(s.id, { title: e.target.value })} className={clsx(inputCls, 'w-56 py-1.5 font-semibold')} placeholder={st.rules.title || 'Günün Fırsatları'} maxLength={60} />
                  <input value={s.subtitle} onChange={(e) => setSet(s.id, { subtitle: e.target.value })} className={clsx(inputCls, 'flex-1 min-w-[200px] py-1.5')} placeholder={st.rules.subtitle || 'Alt başlık'} maxLength={140} />
                  <input value={s.eyebrow || ''} onChange={(e) => setSet(s.id, { eyebrow: e.target.value })} className={clsx(inputCls, 'w-40 py-1.5 uppercase tracking-wide')} placeholder={st.rules.eyebrow || 'BUGÜNE ÖZEL'} maxLength={24} title="Kulakçık / şerit metni — boşsa genel metin (Metinler bölümü)" />
                  <input value={s.badge || ''} onChange={(e) => setSet(s.id, { badge: e.target.value })} className={clsx(inputCls, 'w-36 py-1.5')} placeholder="Rozet: otomatik" maxLength={20} title="Foto üstündeki rozet — boşsa Kadın/Erkek/Çocuk otomatik" />
                  <div className="flex items-center gap-1 text-xs text-gray-500"><CalendarDays size={13} /><input type="date" value={s.start_date ?? ''} onChange={(e) => setSet(s.id, { start_date: e.target.value || null })} className={clsx(inputCls, 'py-1.5')} /><span>–</span><input type="date" value={s.end_date ?? ''} onChange={(e) => setSet(s.id, { end_date: e.target.value || null })} className={clsx(inputCls, 'py-1.5')} /></div>
                  <button onClick={() => removeSet(s.id)} className="ml-auto p-1.5 text-gray-400 hover:text-rose-600" title="Seti sil"><Trash2 size={15} /></button>
                </div>
                <div className="grid lg:grid-cols-[1fr_260px] gap-4">
                  <div>
                    {prods.length === 0 && <div className="text-xs text-gray-500 rounded-xl border border-dashed border-gray-200 p-4 text-center">Ürün seçilmedi.</div>}
                    <div className="space-y-2">
                      {prods.map((p, i) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 p-2">
                          <div className="flex flex-col"><button onClick={() => moveProduct(s.id, i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp size={13} /></button><button onClick={() => moveProduct(s.id, i, 1)} disabled={i === prods.length - 1} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown size={13} /></button></div>
                          <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                          <ProductThumb p={p} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                            <p className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                              <span>{p.dprice ? <><b className="text-rose-600">{money(p.dprice)}</b> <s>{money(p.price)}</s></> : <b>{money(p.price)}</b>}</span>
                              <span className={clsx(p.stock <= 0 && 'text-rose-600 font-semibold')}>Stok {p.stock}</span>
                              {p.variants.length > 0 && <span>{p.variants.length} beden stokta</span>}
                              {(p.colors?.length ?? 0) > 1 && <span>{p.colors!.length} renk seçeneği</span>}
                              {st.shown_colors?.[p.id] && <span className={clsx(st.shown_colors[p.id].changed ? 'text-indigo-600 font-semibold' : 'text-gray-500')}>Gösterilen renk: {st.shown_colors[p.id].color} ({st.shown_colors[p.id].sales} satış / {st.shown_colors[p.id].clicks} tık){st.shown_colors[p.id].changed ? ' — otomatik seçildi' : ''}</span>}
                              {!p.in_stock && <span className="text-rose-600 font-semibold">Çekmecede gizlenir</span>}
                            </p>
                          </div>
                          <a href={p.url} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-gray-800"><ExternalLink size={14} /></a>
                          <button onClick={() => setSet(s.id, { products: s.products.filter((x) => x !== p.id) })} className="p-1.5 text-gray-400 hover:text-rose-600"><X size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button onClick={() => { setPicker(picker === s.id ? null : s.id); setQ('') }} disabled={s.products.length >= st.max_products} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border border-gray-200 px-3 py-1.5 hover:border-gray-400 disabled:opacity-40"><Search size={13} /> Ürün ara & ekle</button>
                      <button onClick={() => suggest(s.id)} disabled={suggesting === s.id} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 px-3 py-1.5 hover:bg-indigo-100">{suggesting === s.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Yunbi önersin (3 ürün)</button>
                      <span className="text-[11px] text-gray-400 self-center">Öneri: stoklu + görselli + ≥%15 indirimli ürünlerde 14 gün satış ivmesi × indirim × puan; son 7 günde kullanılanlar dışlanır.</span>
                    </div>
                    {picker === s.id && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-2.5 text-gray-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={clsx(inputCls, 'w-full pl-8')} placeholder="Ürün adı, SKU, marka veya Ticimax ürün id" /></div>
                          <button onClick={() => setOnlyDisc(!onlyDisc)} className={clsx('text-xs font-semibold rounded-full px-3 py-1.5 border', onlyDisc ? 'bg-rose-50 border-rose-200 text-rose-700' : 'border-gray-200 text-gray-600')}>{onlyDisc ? '✓ ' : ''}Yalnız indirimli</button>
                          <button onClick={() => setPicker(null)} className="p-1.5 text-gray-400 hover:text-gray-800"><X size={15} /></button>
                        </div>
                        {searching ? <div className="text-xs text-gray-400 py-6 text-center"><Loader2 size={16} className="animate-spin inline" /></div> : results.length === 0 ? <div className="text-xs text-gray-400 py-6 text-center">Sonuç yok.</div> : (
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-80 overflow-auto pr-1">
                            {results.map((p) => { const inSet = s.products.includes(p.id); return (
                              <button key={p.id} onClick={() => addProduct(s.id, p)} disabled={inSet || s.products.length >= st.max_products} className={clsx('text-left rounded-xl border p-1.5 hover:border-rose-300 disabled:opacity-40', inSet ? 'border-rose-400 bg-rose-50' : 'border-gray-100')}>
                                <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-100">{p.img && <img src={p.img} alt="" className="w-full h-full object-cover" loading="lazy" />}{p.discount_pct > 0 && <span className="absolute top-1 left-1 bg-rose-600 text-white text-[10px] font-bold rounded px-1">-%{p.discount_pct}</span>}{inSet && <span className="absolute inset-0 flex items-center justify-center bg-rose-600/30"><Check className="text-white" size={22} /></span>}</div>
                                <p className="text-[11px] leading-tight text-gray-800 mt-1 line-clamp-2">{p.name}</p>
                                <p className="text-[11px] mt-0.5">{p.dprice ? <><b className="text-rose-600">{money(p.dprice)}</b> <s className="text-gray-400">{money(p.price)}</s></> : <b>{money(p.price)}</b>}<span className="text-gray-400"> · stok {p.stock}</span></p>
                              </button>) })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl bg-white border border-gray-100 p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Kupon (isteğe bağlı)</p>
                    <input value={s.coupon} onChange={(e) => setSet(s.id, { coupon: e.target.value.toUpperCase() })} className={clsx(inputCls, 'w-full font-mono tracking-wider')} placeholder="BUGUN50" maxLength={32} />
                    <input value={s.coupon_text} onChange={(e) => setSet(s.id, { coupon_text: e.target.value })} className={clsx(inputCls, 'w-full')} placeholder="Sepette bu kodu kullan" maxLength={100} />
                    <p className="text-[11px] text-gray-400 leading-snug">Kupon Ticimax'ta senin tarafından tanımlanmalı; çekmecede tek dokunuşla kopyalanır ve kopyalama sayılır.</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* 3 Tasarım */}
      <Section step="3" title="Tasarım" desc="Yan panel: çark kulakçığı gibi kenardan yana büyür, seçili ürünlerin hepsi yan yana (foto, eski/yeni fiyat, renk noktaları). Minimal: ufak kart, tek ürün fotoğrafı, altında renk seçenekleri (aynı modelin diğer renkleri) + eski/yeni fiyat, oklarla diğer ürünler; beden ve sepete ekleme yok. Kapsamlı düzen: tam çekmece, beden çipleri, sepete ekle. Palet seçimi renkleri birlikte boyar; değişiklikler anında kaydedilir.">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {st.presets.map((key) => { const p = PRESETS[key]; if (!p) return null; const on = st.theme.preset === key; return (
            <button key={key} onClick={() => patch('theme', { theme: { preset: key, accent: p.accent, accent2: p.accent2, bg: p.bg, ink: p.ink } })} className={clsx('text-left rounded-2xl border-2 p-2 transition', on ? 'border-rose-500 bg-rose-50/40' : 'border-gray-200 hover:border-rose-300')}>
              <div className="rounded-xl overflow-hidden h-20 relative" style={{ background: p.bg }}>
                <div className="absolute inset-x-0 top-0 h-11" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent2})` }} />
                <div className="absolute left-2 top-14 w-14 h-2 rounded" style={{ background: p.ink, opacity: .25 }} />
                <div className="absolute right-2 top-13 w-10 h-4 rounded-md" style={{ background: p.accent, top: 52 }} />
                <div className="absolute right-0 top-3 w-3 h-8 rounded-l" style={{ background: `linear-gradient(160deg, ${p.accent}, ${p.accent2})` }} />
              </div>
              <div className="flex items-center gap-1.5 mt-2"><span className={clsx('w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center', on ? 'border-rose-500 bg-rose-500' : 'border-gray-300 bg-white')}>{on && <Check size={9} className="text-white" strokeWidth={4} />}</span><span className="text-xs font-semibold text-gray-800">{p.label}</span></div>
              <p className="text-[10.5px] text-gray-400 mt-0.5 leading-snug">{p.desc}</p>
            </button>) })}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {([['accent', 'Vurgu (kulakçık, buton)'], ['accent2', 'Gradyan koyu ucu'], ['bg', 'Çekmece zemini'], ['ink', 'Yazı rengi']] as const).map(([k, l]) => (
            <div key={k}><label className="text-xs font-semibold text-gray-600 block mb-1">{l}</label><div className="flex items-center gap-2"><input type="color" value={st.theme[k]} onChange={(e) => patch('theme', { theme: { [k]: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{st.theme[k]}</code></div></div>
          ))}
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kulakçık biçimi</label><Seg value={st.theme.tab_style} options={[['ribbon', 'Dikey şerit'], ['pill', 'Yüzen hap'], ['badge', 'Yuvarlak rozet']]} onChange={(v) => patch('theme', { theme: { tab_style: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Konum</label><Seg value={st.theme.tab_position} options={[['right-middle', 'Sağ orta'], ['right-bottom', 'Sağ alt'], ['left-middle', 'Sol orta'], ['left-bottom', 'Sol alt']]} onChange={(v) => patch('theme', { theme: { tab_position: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Çekmece düzeni</label><Seg value={st.theme.layout ?? 'full'} options={[['panel', 'Yan panel (ürünler yan yana)'], ['minimal', 'Minimal (tek ürün)'], ['full', 'Kapsamlı (beden + sepet)']]} onChange={(v) => patch('theme', { theme: { layout: v } })} /></div>
          {(st.theme.layout ?? 'full') === 'full' && <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kart düzeni</label><Seg value={st.theme.card_layout} options={[['row', 'Yatay kart'], ['grid', '2 sütun']]} onChange={(v) => patch('theme', { theme: { card_layout: v } })} /></div>}
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Parıltı halkası</label><Seg value={st.theme.tab_pulse ? 'on' : 'off'} options={[['on', 'Var'], ['off', 'Yok']]} onChange={(v) => patch('theme', { theme: { tab_pulse: v === 'on' } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kulakçıkta sayaç</label><Seg value={st.theme.tab_timer ? 'on' : 'off'} options={[['on', 'Göster'], ['off', 'Gizle']]} onChange={(v) => patch('theme', { theme: { tab_timer: v === 'on' } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Çekmece genişliği (web)</label><select className={inputCls} value={st.theme.drawer_width} onChange={(e) => patch('theme', { theme: { drawer_width: Number(e.target.value) } })}>{[380, 420, 440, 480, 520, 560].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe</label><select className={inputCls} value={st.theme.radius} onChange={(e) => patch('theme', { theme: { radius: Number(e.target.value) } })}>{[8, 12, 16, 20, 24, 28].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <Field label="Kulakçık yazısı" k="tab_text" store={themeTexts} setStore={setThemeTexts} placeholder="BUGÜNE ÖZEL" w="w-48" />
          <Field label="Emoji" k="tab_emoji" store={themeTexts} setStore={setThemeTexts} placeholder="⚡" w="w-20" />
          <Field label="Yazı tipi (boş = mağazanın)" k="font" store={themeTexts} setStore={setThemeTexts} placeholder="Inter" w="w-48" />
          <button onClick={() => patch('theme', { theme: themeTexts })} disabled={saving === 'theme'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button>
        </div>
      </Section>

      {/* 4 Metinler & sayaç */}
      <Section step="4" title="Metinler ve sayaç" desc="Setin kendi başlığı yoksa buradaki genel başlık kullanılır. Sayaç gerçek zamana bağlıdır: gece 23:59'a ya da setin bitiş gününe; sahte 'sıfırlanan' sayaç yoktur.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Üst etiket (eyebrow)" k="eyebrow" store={texts} setStore={setTexts} placeholder="BUGÜNE ÖZEL" />
          <Field label="Genel başlık" k="title" store={texts} setStore={setTexts} placeholder="Günün Fırsatları" />
          <Field label="Genel alt başlık" k="subtitle" store={texts} setStore={setTexts} placeholder="Yalnızca bugün geçerli…" />
          <Field label="Sayaç etiketi" k="timer_label" store={texts} setStore={setTexts} placeholder="Kampanya bitimine" />
          <Field label="Sepet butonu" k="cta_text" store={texts} setStore={setTexts} placeholder="Sepete Ekle" />
          <Field label="İncele linki" k="view_text" store={texts} setStore={setTexts} placeholder="Ürünü İncele" />
          <Field label="Alt link yazısı (isteğe bağlı)" k="footer_text" store={texts} setStore={setTexts} placeholder="Tüm kampanyaları gör" />
          <Field label="Alt link adresi" k="footer_url" store={texts} setStore={setTexts} placeholder="/firsat-urunleri" />
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sayaç</label><Seg value={st.rules.timer_mode} options={[['midnight', 'Gece 23:59\'a'], ['set_end', 'Set bitişine'], ['off', 'Kapalı']]} onChange={(v) => patch('rules', { rules: { timer_mode: v } })} /></div>
        </div>
        <div className="mt-3"><button onClick={() => patch('rules', { rules: { eyebrow: texts.eyebrow, title: texts.title, subtitle: texts.subtitle, timer_label: texts.timer_label, cta_text: texts.cta_text, view_text: texts.view_text, footer_text: texts.footer_text, footer_url: texts.footer_url } })} disabled={saving === 'rules'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Metinleri kaydet</button></div>
      </Section>

      {/* 5 Davranış */}
      <Section step="5" title="Davranış" desc="Ziyaretçi kulakçığı açmazsa çekmece kendiliğinden açılır; kapatan ziyaretçiye aynı gün yeniden açılmaz (kulakçık kalır). Anahtarlar anında kaydedilir.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          <Toggle on={st.rules.auto_open} onChange={(v) => patch('rules', { rules: { auto_open: v } })} label="Otomatik açılma" hint="Sekme görünürken geçen süre sayılır; arka plandaki sekmede işlemez." />
          <Toggle on={st.rules.exit_intent} onChange={(v) => patch('rules', { rules: { exit_intent: v } })} label="Çıkış niyeti (masaüstü)" hint="Fare sayfanın üstünden çıkarken açılır (sekme kapatma / adres çubuğu)." />
          <Toggle on={st.rules.quick_add} onChange={(v) => patch('rules', { rules: { quick_add: v } })} label="Çekmeceden sepete ekle" hint="Ticimax: beden çipleri + tek dokunuş. Kapalıysa buton ürün sayfasına götürür." />
          <Toggle on={st.rules.show_stock} onChange={(v) => patch('rules', { rules: { show_stock: v } })} label="Gerçek stok notu" hint={`Toplam stok ≤ ${st.rules.stock_threshold} ise "Son N adet". Gerçek veri; sahte azlık yok.`} />
          <Toggle on={st.rules.show_discount_badge} onChange={(v) => patch('rules', { rules: { show_discount_badge: v } })} label="İndirim yüzdesi rozeti" hint="Görselin köşesinde -%N." />
          <Toggle on={st.rules.best_color !== false} onChange={(v) => patch('rules', { rules: { best_color: v } })} label="En çok satan rengi göster" hint="Seçtiğin ürünün modelinde son 90 günde en çok satan + en çok tıklanan renk kartı ve fotoğrafı otomatik gösterilir." />
          <Toggle on={st.rules.mobile_sheet} onChange={(v) => patch('rules', { rules: { mobile_sheet: v } })} label="Mobilde alt sayfa" hint="Kapalıysa mobilde de yandan tam ekran çekmece." />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Otomatik açılma gecikmesi</label><select className={inputCls} value={st.rules.auto_open_delay} onChange={(e) => patch('rules', { rules: { auto_open_delay: Number(e.target.value) } })}>{[5, 8, 10, 12, 15, 20, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} sn</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kaydırma tetiği</label><select className={inputCls} value={st.rules.auto_open_scroll} onChange={(e) => patch('rules', { rules: { auto_open_scroll: Number(e.target.value) } })}><option value={0}>Kapalı</option>{[25, 40, 50, 60, 75].map((n) => <option key={n} value={n}>%{n} kaydırınca</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Otomatik açılma sıklığı</label><Seg value={st.rules.frequency} options={[['day', 'Günde 1'], ['session', 'Oturumda 1'], ['always', 'Her sayfada']]} onChange={(v) => patch('rules', { rules: { frequency: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Stok eşiği</label><select className={inputCls} value={st.rules.stock_threshold} onChange={(e) => patch('rules', { rules: { stock_threshold: Number(e.target.value) } })}>{[3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>≤ {n} adet</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Cihaz</label><Seg value={st.rules.max_width > 0 ? 'mobile' : st.rules.min_width > 0 ? 'desktop' : 'all'} options={[['all', 'Hepsi'], ['mobile', 'Yalnız mobil'], ['desktop', 'Yalnız masaüstü']]} onChange={(v) => patch('rules', { rules: { max_width: v === 'mobile' ? 899 : 0, min_width: v === 'desktop' ? 900 : 0 } })} /></div>
        </div>
        <div className="mt-4">
          <label className="text-xs font-semibold text-gray-600 block mb-2">Gizleneceği sayfa tipleri (sepet/ödeme her zaman gizli)</label>
          <div className="flex flex-wrap gap-2">
            {([['product', 'Ürün detayı'], ['category', 'Kategori listesi'], ['home', 'Ana sayfa'], ['account', 'Hesap ve üyelik'], ['other', 'Diğer sayfalar']] as const).map(([k, l]) => { const on = (st.rules.hide_page_types ?? []).includes(k); return (
              <button key={k} onClick={() => { const cur = st.rules.hide_page_types ?? []; patch('rules', { rules: { hide_page_types: on ? cur.filter((x) => x !== k) : [...cur, k] } }) }} className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition', on ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400')}>{on ? '🚫' : '✓'} {l}</button>) })}
          </div>
        </div>
        <div className="mt-4">
          <label className="text-xs font-semibold text-gray-600 block mb-2">Kulakçık dursun ama kendiliğinden AÇILMASIN (önerilen: ürün detayı — satın alma niyetini bozmaz)</label>
          <div className="flex flex-wrap gap-2">
            {([['product', 'Ürün detayı'], ['category', 'Kategori listesi'], ['home', 'Ana sayfa'], ['account', 'Hesap ve üyelik'], ['other', 'Diğer sayfalar']] as const).map(([k, l]) => { const on = (st.rules.no_auto_page_types ?? []).includes(k); return (
              <button key={k} onClick={() => { const cur = st.rules.no_auto_page_types ?? []; patch('rules', { rules: { no_auto_page_types: on ? cur.filter((x) => x !== k) : [...cur, k] } }) }} className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition', on ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400')}>{on ? '⏸' : '▶'} {l}</button>) })}
          </div>
        </div>
        <div className="mt-3"><label className="text-xs font-semibold text-gray-600">Ek gizlenecek yollar (öneklerle, virgülle)</label>
          <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={texts.hide_paths ?? ''} onChange={(e) => setTexts((s) => ({ ...s, hide_paths: e.target.value }))} /><button onClick={() => patch('rules', { rules: { hide_paths: texts.hide_paths } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div></div>
      </Section>

      {/* 6 Önizleme */}
      <Section step="6" title="Canlı önizleme" desc="Kayıtlı tema ve bugünün seti ile çizilir; çekmece açık gelir. Beden çipleri ve sayaç canlıdır; sepete ekleme yalnız mağazada çalışır."
        right={<div className="flex items-center gap-2"><Seg value={previewMode} options={[['desktop', 'Masaüstü'], ['mobile', 'Mobil']]} onChange={setPreviewMode} /><button onClick={() => setPreviewKey((k) => k + 1)} className="p-1.5 rounded-full border border-gray-200 hover:bg-gray-50" title="Yenile"><RefreshCw size={14} /></button></div>}>
        {activeId ? (
          previewMode === 'desktop'
            ? <div className="rounded-2xl bg-gray-900 p-2"><div className="flex items-center gap-1.5 px-2 pb-2 text-gray-500"><Monitor size={13} /><span className="text-[11px]">1280 × 800</span></div><ScaledFrame key={previewKey + 'd'} src={previewSrc} width={1280} height={800} title="Masaüstü önizleme" /></div>
            : <div className="max-w-[360px] mx-auto rounded-[38px] bg-gray-900 p-2.5"><div className="flex items-center gap-1.5 px-3 pb-2 text-gray-500"><Smartphone size={13} /><span className="text-[11px]">390 × 760</span></div><div className="rounded-[30px] overflow-hidden"><ScaledFrame key={previewKey + 'm'} src={previewSrc} width={390} height={760} title="Mobil önizleme" /></div></div>
        ) : <div className="text-sm text-gray-500 rounded-xl border border-dashed border-gray-200 p-6 text-center">Bugün için yayında set yok. 2. adımda ürün seçip kaydet.</div>}
      </Section>

      {/* 7 Analitik */}
      <Section step="7" title="Analitik" desc="Kulakçığı gören oturum, açılma kaynağı, ürün tıklaması ve sepete ekleme; satış atıfı saat başı (tıklama/sepet ↔ aynı IP'den 24 saat içinde o ürünü içeren ödenmiş sipariş). Demo sayfası test olarak işaretlenir."
        right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((r) => <button key={r} onClick={() => setRange(r)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === r ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{r} gün</button>)}</div>}>
        {!an || an.sessions === 0 ? (
          <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Script temaya eklenip ziyaretçilere ulaşınca burada birikir.</div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                ['Kulakçığı gören', an.sessions, null, 'kişi (oturum)'],
                ['Açan', an.open_sessions, an.sessions ? Math.round(an.open_sessions / an.sessions * 100) : 0, 'görenlerin'],
                ['Ürüne giden', an.click_sessions, an.open_sessions ? Math.round(an.click_sessions / an.open_sessions * 100) : 0, 'açanların'],
                ['Satın alan', an.conversions, an.click_sessions ? Math.round(an.conversions / an.click_sessions * 100) : 0, 'ürüne gidenlerin'],
              ] as [string, number, number | null, string][]).map(([l, v, pct, hint], i) => (
                <div key={l} className={clsx('rounded-xl p-3 relative', i === 3 ? 'bg-emerald-50' : 'bg-[var(--app-bg)]')}>
                  <p className="text-[11px] text-gray-400 uppercase font-semibold">{i + 1}. {l}</p>
                  <p className="text-2xl font-extrabold text-gray-900">{v.toLocaleString('tr-TR')}</p>
                  <p className="text-[11px] text-gray-500">{pct === null ? hint : `%${pct} · ${hint}`}</p>
                  {i === 3 && <p className="text-xs font-bold text-emerald-700 mt-1">{fmtTl(an.revenue)} ciro</p>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">Satın alma: kulakçıktan ürüne giden ziyaretçinin 24 saat içinde aynı IP'den o ürünü içeren ödenmiş siparişi (saat başı eşlenir). Sepete ekleme: {an.atc} · kupon kopyalama: {an.coupons}.</p>
            <div className="grid md:grid-cols-2 gap-5 text-sm">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Açılma kaynağı → etkileşim</p>
                {an.source_engagement.map((r) => { const max = an.source_engagement[0]?.opened || 1; return (
                  <div key={r.source} className="mb-2"><div className="flex justify-between text-xs mb-0.5"><span className="font-semibold text-gray-700">{SOURCE_LABELS[r.source] ?? r.source}</span><span className="text-gray-500">{r.opened} açılma · {r.engaged} tıklayan ({r.opened ? Math.round(r.engaged / r.opened * 100) : 0}%)</span></div><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-rose-500 rounded-full" style={{ width: Math.round(r.opened / max * 100) + '%' }} /></div></div>) })}
                {an.by_device.length > 0 && <p className="text-xs text-gray-500 mt-3">Cihaz: {an.by_device.map((d) => `${d.device === 'm' ? 'Mobil' : d.device === 'd' ? 'Masaüstü' : '?'} ${d.views} gören / ${d.opens} açan / ${d.acts} aksiyon`).join(' · ')}</p>}
                {an.coupons > 0 && <p className="text-xs text-gray-500 mt-1">Kupon {an.coupons} kez kopyalandı.</p>}
                {an.hourly.length > 0 && <p className="text-xs text-gray-500 mt-1">En çok açılan saatler: {[...an.hourly].sort((a, b) => b.c - a.c).slice(0, 3).map((h) => `${String(h.h).padStart(2, '0')}:00 (${h.c})`).join(', ')}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Ürün bazında</p>
                <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Ürün</th><th className="py-1 text-right">Tık</th><th className="py-1 text-right">Sepet</th><th className="py-1 text-right">Sipariş</th><th className="py-1 text-right">Ciro</th></tr></thead>
                  <tbody>{an.by_product.map((r) => <tr key={r.product_id} className="border-b border-gray-50"><td className="py-1 max-w-[220px] truncate text-gray-700">{r.name ?? `#${r.product_id}`}</td><td className="py-1 text-right">{r.clicks}</td><td className="py-1 text-right">{r.atc}</td><td className="py-1 text-right">{r.conv}</td><td className="py-1 text-right text-gray-500">{fmtTl(Number(r.rev))}</td></tr>)}</tbody></table>
                {an.by_set.length > 1 && <p className="text-xs text-gray-500 mt-3">Set bazında: {an.by_set.map((s) => `${s.set_id ?? '?'}: ${s.views} gören / ${s.opens} açılma / ${s.atc} sepet / ${s.conv} sipariş`).join(' · ')}</p>}
                {an.errors.length > 0 && <p className="text-xs text-rose-600 mt-2">Hatalar: {an.errors.map((e) => `${e.value} (${e.c})`).join(' · ')}</p>}
              </div>
            </div>
            {an.daily.length > 1 && (
              <div><p className="text-xs font-semibold text-gray-500 mb-2">Günlük</p>
                <div className="flex items-end gap-1 h-24">{an.daily.map((d) => { const max = Math.max(...an.daily.map((x) => x.views), 1); return <div key={d.d} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.d}: ${d.views} gören, ${d.opens} açan, ${d.acts} aksiyon, ${d.conv} sipariş`}><div className="w-full rounded-t bg-rose-200 relative" style={{ height: Math.max(2, Math.round(d.views / max * 80)) }}><div className="absolute bottom-0 left-0 right-0 bg-rose-500 rounded-t" style={{ height: d.views ? Math.round(d.opens / d.views * 100) + '%' : 0 }} /></div></div> })}</div>
                <p className="text-[10px] text-gray-400 mt-1">Açık: gören · koyu: açan</p>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}
