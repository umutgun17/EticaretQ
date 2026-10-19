import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Zap, ExternalLink, Loader2, Check, Copy, Plus, Trash2, Save, BarChart3, Sparkles, Search, ChevronUp, ChevronDown, X, Smartphone, Monitor, RefreshCw, CloudRain } from 'lucide-react'
import clsx from 'clsx'
import { flashApi, type FlashSettings, type FlashSet, type FlashProduct, type FlashAnalytics } from '@/lib/croApi'

/* "Flaş İndirim" ana sayfa vitrini (CRO) — slider yerine süreli flaş ürünler: 6 yerleşim × 6 renk, gerçek sayaç,
   gerçek satış/stok, kart içinden sepete ekleme, sepette ekstra kupon. Set planı, tema, davranış, analitik. */

const LAYOUTS: Record<string, { label: string; desc: string; best: string }> = {
  spotlight: { label: 'Spotlight', desc: 'Başlık + sayaç solda, 1 büyük kahraman ürün ortada, 3 küçük kart sağda.', best: 'Tek yıldız ürün + 3 destek. En yüksek odak.' },
  grid: { label: 'Izgara', desc: 'Üstte başlık/sayaç bandı, altında 4’lü (mobilde 2’li) ürün ızgarası.', best: 'Eşit ağırlıklı 4–8 ürün. En tanıdık düzen.' },
  rail: { label: 'Ray', desc: 'Kaydırmalı yatay ürün rayı; mobilde kartlar “bir sonraki görünsün” diye taşar.', best: '8–12 ürün. Kaydırma = keşif, slider hissi (otomatik dönmez).' },
  split: { label: 'Poster', desc: 'Sol yarı büyük kampanya posteri + büyük sayaç; sağda 4 kompakt ürün.', best: 'Kampanya mesajı ürünlerden önemliyse.' },
  tabs: { label: 'Sekmeli', desc: 'Kadın / Erkek / Çocuk sekmeleri; ziyaretçi kendi segmentini seçer.', best: 'Karışık kitle. Alaka = tıklama.' },
  stories: { label: 'Hikâye', desc: 'Tam görselli dikey kartlar, fiyat görselin üstünde. Instagram hikâye hissi.', best: 'Görseli güçlü ürünler, genç kitle, mobil.' },
}
const PRESETS: Record<string, { label: string; desc: string; accent: string; accent2: string; bg: string; ink: string; card_bg: string; dark_cards: boolean; rain: boolean }> = {
  tonny: { label: 'Tonny Siyah', desc: 'Marka siyahı + kampanya kırmızısı, beyaz kartlar. Tonny Black için varsayılan.', accent: '#e3001b', accent2: '#000000', bg: '#1a1a1a', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: true },
  tonnywhite: { label: 'Tonny Beyaz', desc: 'Site zeminiyle aynı beyaz, siyah yazı, kırmızı vurgu. Sayfayla bütünleşir.', accent: '#e3001b', accent2: '#ebebeb', bg: '#ffffff', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: false },
  rain: { label: 'Yağmur', desc: 'Lacivert-mavi, yağmur çizgileri. Havaya özel kampanya.', accent: '#2563eb', accent2: '#0b1a3f', bg: '#102454', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: true },
  night: { label: 'Gece', desc: 'Siyah-mor, koyu kartlar. "Bu geceye özel" hissi.', accent: '#a855f7', accent2: '#07060d', bg: '#1a1230', ink: '#f5f5f7', card_bg: '#1d1830', dark_cards: true, rain: true },
  red: { label: 'Kırmızı', desc: 'Kampanya kırmızısı + siyah. 10/10 kreatifleriyle uyumlu.', accent: '#e3001b', accent2: '#0f0f0f', bg: '#2a0a0e', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: false },
  ember: { label: 'Kor', desc: 'Turuncu-bordo, sıcak. Soğuk havada "ısıtan" kontrast.', accent: '#f97316', accent2: '#5b0b0b', bg: '#7f1d1d', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: false },
  forest: { label: 'Orman', desc: 'Koyu yeşil-haki. Bot / trekking / outdoor.', accent: '#22c55e', accent2: '#03140c', bg: '#0f3d2e', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: true },
  mono: { label: 'Mono', desc: 'Açık zemin, siyah vurgu. Minimal, premium.', accent: '#111111', accent2: '#e7e5e4', bg: '#f5f5f4', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: false },
}
const uid = () => 'f' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
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
function Thumb({ p, small }: { p: FlashProduct; small?: boolean }) {
  return (
    <div className={clsx('relative shrink-0 rounded-lg overflow-hidden bg-gray-100', small ? 'w-10 h-[52px]' : 'w-14 h-[74px]')}>
      {p.img && <img src={p.img} alt="" className="w-full h-full object-cover" loading="lazy" />}
      {p.discount_pct > 0 && <span className="absolute top-0.5 left-0.5 bg-rose-600 text-white text-[9px] font-bold rounded px-1">-%{p.discount_pct}</span>}
    </div>
  )
}

export default function CroFlashPage() {
  const [st, setSt] = useState<FlashSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [sets, setSets] = useState<FlashSet[]>([])
  const [cache, setCache] = useState<Record<number, FlashProduct>>({})
  const [dirty, setDirty] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [onlyDisc, setOnlyDisc] = useState(true)
  const [results, setResults] = useState<FlashProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [suggesting, setSuggesting] = useState<string | null>(null)
  const [sugQ, setSugQ] = useState('bot')
  const [sugSeg, setSugSeg] = useState<string[]>(['kadin', 'erkek', 'cocuk'])
  const [sugCount, setSugCount] = useState(8)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [nums, setNums] = useState<Record<string, string>>({})
  const [themeTexts, setThemeTexts] = useState<Record<string, string>>({})
  const [an, setAn] = useState<FlashAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('mobile')
  const searchTm = useRef<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    flashApi.settings().then((d) => {
      setSt(d); setDomains(d.domains); setSets(d.sets); setCache(d.products); setDirty(false)
      const r = d.rules
      setTexts({ eyebrow: r.eyebrow, title: r.title, subtitle: r.subtitle, timer_label: r.timer_label, cta_text: r.cta_text, view_text: r.view_text, footer_text: r.footer_text, footer_url: r.footer_url, coupon_label: r.coupon_label, hide_paths: r.hide_paths, mount: r.mount, mount_fallback: r.mount_fallback })
      setNums({ max_products: String(r.max_products), rows: String(r.rows), rotate_hours: String(r.rotate_hours ?? 0), rotate_step: String(r.rotate_step ?? 4), sold_threshold: String(r.sold_threshold), stock_threshold: String(r.stock_threshold), min_width: String(r.min_width), max_width: String(r.max_width), container_width: String(d.theme.container_width), radius: String(d.theme.radius) })
      setThemeTexts({ font: d.theme.font, accent: d.theme.accent, bg: d.theme.bg, accent2: d.theme.accent2 })
    }).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { flashApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await flashApi.update(body); setSt(d); if (key === 'sets') { setSets(d.sets); setCache((c) => ({ ...c, ...d.products })); setDirty(false) } setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const embed = st ? `<script src="${st.base_url}/widget/flash.js?v=1" data-tenant="${st.slug}"></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }

  const activeId = useMemo(() => {
    if (!st) return null
    const day = st.today
    let best: FlashSet | null = null, span = Infinity, fb: FlashSet | null = null
    for (const s of sets) {
      if (!s.enabled || !s.products.length) continue
      if (!s.start_date && !s.end_date) { fb = fb ?? s; continue }
      if ((s.start_date && day < s.start_date) || (s.end_date && day > s.end_date)) continue
      const sp = s.start_date && s.end_date ? Date.parse(s.end_date) - Date.parse(s.start_date) : Infinity - 1
      if (sp < span) { best = s; span = sp }
    }
    return (best ?? fb)?.id ?? null
  }, [sets, st])
  const setSet = (id: string, p: Partial<FlashSet>) => { setSets(sets.map((s) => (s.id === id ? { ...s, ...p } : s))); setDirty(true) }
  const addSet = (tomorrow = false) => {
    const d = new Date(); if (tomorrow) d.setDate(d.getDate() + 1)
    const iso = d.toISOString().slice(0, 10)
    setSets([...sets, { id: uid(), title: '', subtitle: '', eyebrow: '', start_date: tomorrow ? iso : null, end_date: tomorrow ? iso : null, products: [], coupon: '', coupon_mode: 'auto', coupon_pct: 5, coupon_text: 'Sepette ekstra %5 indirim', enabled: true }]); setDirty(true)
  }
  const removeSet = (id: string) => { setSets(sets.filter((s) => s.id !== id)); setDirty(true) }
  const moveProduct = (id: string, i: number, d: -1 | 1) => { const s = sets.find((x) => x.id === id); if (!s) return; const j = i + d; if (j < 0 || j >= s.products.length) return; const n = [...s.products]; const t = n[i]; n[i] = n[j]; n[j] = t; setSet(id, { products: n }) }
  const addProduct = (id: string, p: FlashProduct) => {
    const s = sets.find((x) => x.id === id); if (!s || !st) return
    if (s.products.includes(p.id) || s.products.length >= st.max_products) return
    setCache((c) => ({ ...c, [p.id]: p })); setSet(id, { products: [...s.products, p.id] })
  }
  const suggest = async (id: string, replace: boolean) => {
    setSuggesting(id); setError('')
    try {
      const r = await flashApi.suggest({ count: sugCount, q: sugQ || undefined, segments: sugSeg.join(',') || undefined })
      if (!r.data.length) { setError('Öneri için indirimli (≥%15) + stoklu ürün bulunamadı'); return }
      setCache((c) => { const n = { ...c }; r.data.forEach((p) => { n[p.id] = p }); return n })
      const s = sets.find((x) => x.id === id)
      const cur = replace ? [] : (s?.products ?? [])
      setSet(id, { products: [...cur, ...r.data.map((p) => p.id).filter((x) => !cur.includes(x))].slice(0, st?.max_products ?? 12) })
    } catch { setError('Öneri alınamadı') } finally { setSuggesting(null) }
  }
  useEffect(() => {
    if (picker === null) return
    if (searchTm.current) window.clearTimeout(searchTm.current)
    searchTm.current = window.setTimeout(() => {
      setSearching(true)
      flashApi.products({ q: q || undefined, limit: 24, discounted: onlyDisc ? 1 : 0 }).then(setResults).catch(() => setResults([])).finally(() => setSearching(false))
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
  const num = (k: string, d: number) => { const v = parseInt(nums[k] ?? '', 10); return Number.isFinite(v) ? v : d }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>

  const demoBase = `/widget/flash-demo.html?tenant=${st.slug}`
  const previewSrc = `${demoBase}&ctl=0&note=0&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify(st.rules))}&k=${previewKey}`
  const active = sets.find((s) => s.id === activeId)

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Zap className="text-amber-500" size={22} /> Flaş İndirim Vitrini</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">Ana sayfa slider’ının yerine geçen süreli flaş indirim bölümü: seçtiğiniz gerçek ürünler, gerçek sayaç (bu gece 23:59), gerçek satış/stok verisi, kart içinden sepete ekleme ve sepette ekstra kupon. Otomatik dönen slayt yok; her ziyaretçi aynı anda tüm teklifi görür.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={demoBase} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary-strong)] bg-[var(--primary-soft)] rounded-full px-3 py-1.5"><ExternalLink size={14} /> Canlı demoyu aç</a>
          <span className={clsx('text-xs font-bold rounded-full px-3 py-1.5', st.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AÇIK' : 'KAPALI'}</span>
        </div>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm flex items-center justify-between">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}

      {/* 1 Kurulum */}
      <Section step="1" title="Kurulum" desc="Widget’ı açın, mağaza alan adını yazın, tek satırı temanın <body> sonuna ekleyin. Ana sayfada çapa seçiciyle (örn. #sliderblok_0) bulunan slider gizlenir, vitrin onun yerine gelir.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Vitrin açık" hint="Kapalıyken mağazadan gelen istekler reddedilir; panel önizlemesi yine çalışır." />
            <div><label className="text-xs font-semibold text-gray-600 block mb-1">İzinli alan adları (virgülle)</label>
              <div className="flex gap-2"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="magaza.com, www.magaza.com" />
                <button onClick={() => patch('domains', { domains })} className="px-3 py-2 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'domains' ? <Loader2 size={14} className="animate-spin" /> : 'Kaydet'}</button></div></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Çapa seçici (slider)" k="mount" store={texts} setStore={setTexts} placeholder='#sliderblok_0, [id^="sliderblok_"]' />
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Yerleştirme</label>
                <Seg value={st.rules.mount_mode} options={[['replace', 'Yerine'], ['before', 'Önüne'], ['after', 'Sonrasına'], ['prepend', 'İçine (üst)']]} onChange={(v) => patch('rules', { rules: { mount_mode: v } })} /></div>
              <Field label="Çapa yoksa (yedek seçici)" k="mount_fallback" store={texts} setStore={setTexts} placeholder="#mainHolder_divDesign, main" w="col-span-2" />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-semibold text-gray-600">Sayfalar:</span>
              {(['home', 'category', 'product', 'other'] as const).map((p) => <button key={p} onClick={() => { const cur = st.rules.pages || []; patch('rules', { rules: { pages: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] } }) }} className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold', (st.rules.pages || []).includes(p) ? 'bg-[var(--primary-strong)] text-white' : 'bg-[var(--app-bg)] text-gray-600')}>{{ home: 'Ana sayfa', category: 'Kategori', product: 'Ürün', other: 'Diğer' }[p]}</button>)}
              <button onClick={() => patch('rules', { rules: { mount: texts.mount, mount_fallback: texts.mount_fallback } })} className="ml-auto text-xs font-semibold text-[var(--primary-strong)]">Seçicileri kaydet</button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Tema kodu</label>
            <div className="relative"><pre className="bg-gray-900 text-emerald-300 text-xs rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">{embed}</pre>
              <button onClick={copy} className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white rounded-lg p-1.5">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
            <p className="text-[11px] text-gray-500 mt-2">Tonny Black’te masaüstü slider <code>#sliderblok_0</code> (mobilde zaten gizli) → vitrin mobilde sayfanın ilk bloğu olur. Her kod değişikliğinde <code>?v</code> artırılır (Cloudflare önbelleği).</p>
          </div>
        </div>
      </Section>

      {/* 2 Yerleşim */}
      <Section step="2" title="Yerleşim" desc="Altı tasarımdan birini seçin; anında kaydedilir. Hepsi mobil-önce, otomatik dönmez, tek birincil eylem (Hemen Al).">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {st.layouts.map((l) => <button key={l} onClick={() => patch('theme', { theme: { layout: l } })} className={clsx('text-left rounded-xl border p-3 transition', st.theme.layout === l ? 'border-[var(--primary-strong)] bg-[var(--primary-soft)]/40 ring-1 ring-[var(--primary-strong)]' : 'border-gray-100 hover:bg-[var(--app-bg)]')}>
            <div className="flex items-center justify-between"><span className="font-bold text-sm text-gray-900">{LAYOUTS[l]?.label ?? l}</span>{st.theme.layout === l && <Check size={14} className="text-[var(--primary-strong)]" />}</div>
            <p className="text-[11px] text-gray-600 mt-1">{LAYOUTS[l]?.desc}</p>
            <p className="text-[11px] text-[var(--primary-strong)] font-semibold mt-1">{LAYOUTS[l]?.best}</p>
          </button>)}
        </div>
      </Section>

      {/* 3 Renk */}
      <Section step="3" title="Renk ve his" desc="Ön ayar seçin, sonra isterseniz vurgu/zemin renklerini elle değiştirin.">
        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
          {st.presets.map((p) => { const P = PRESETS[p]; if (!P) return null; return <button key={p} onClick={() => patch('theme', { theme: { preset: p, accent: P.accent, accent2: P.accent2, bg: P.bg, ink: P.ink, card_bg: P.card_bg, dark_cards: P.dark_cards, rain: P.rain } })} className={clsx('text-left rounded-xl border p-2.5', st.theme.preset === p ? 'border-[var(--primary-strong)] ring-1 ring-[var(--primary-strong)]' : 'border-gray-100 hover:bg-[var(--app-bg)]')}>
            <div className="h-9 rounded-lg mb-2 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${P.bg}, ${P.accent2})` }}><span className="absolute right-1.5 bottom-1.5 w-5 h-5 rounded-full" style={{ background: P.accent }} />{P.rain && <CloudRain size={12} className="absolute left-1.5 top-1.5 text-white/70" />}</div>
            <div className="text-xs font-bold text-gray-900">{P.label}</div><div className="text-[10.5px] text-gray-500 leading-snug">{P.desc}</div></button> })}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          {(['accent', 'bg', 'accent2'] as const).map((k) => <div key={k}><label className="text-xs font-semibold text-gray-600 block mb-1">{{ accent: 'Vurgu (sayaç, buton)', bg: 'Zemin', accent2: 'Zemin koyu uç' }[k]}</label>
            <div className="flex gap-2"><input type="color" value={themeTexts[k] || '#000000'} onChange={(e) => setThemeTexts((s) => ({ ...s, [k]: e.target.value }))} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5" /><input className={clsx(inputCls, 'flex-1 font-mono')} value={themeTexts[k] ?? ''} onChange={(e) => setThemeTexts((s) => ({ ...s, [k]: e.target.value }))} /></div></div>)}
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe yuvarlaklığı / Genişlik (px)</label><div className="flex gap-2"><input className={clsx(inputCls, 'w-20')} value={nums.radius ?? ''} onChange={(e) => setNums((s) => ({ ...s, radius: e.target.value }))} /><input className={clsx(inputCls, 'flex-1')} value={nums.container_width ?? ''} onChange={(e) => setNums((s) => ({ ...s, container_width: e.target.value }))} placeholder="0 = tam" /></div></div>
          <Field label="Yazı tipi (boş = mağaza)" k="font" store={themeTexts} setStore={setThemeTexts} placeholder="Inter, sans-serif" w="lg:col-span-2" />
          <Toggle on={st.theme.rain} onChange={(v) => patch('theme', { theme: { rain: v } })} label="Yağmur animasyonu" hint="Saf CSS; hareket azaltma tercihinde kapanır." />
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Genişlik</label><Seg value={st.theme.width || 'container'} options={[['full', 'Tam genişlik (Tonny)'], ['container', 'Kutu']]} onChange={(v) => patch('theme', { theme: { width: v } })} /><p className="text-[11px] text-gray-500 mt-1">Tam genişlik: kenardan kenara, köşe yok; içerik yine "Genişlik (px)" değerinde ortalanır.</p></div>
          <button onClick={() => patch('theme', { theme: { accent: themeTexts.accent, bg: themeTexts.bg, accent2: themeTexts.accent2, font: themeTexts.font, radius: num('radius', 18), container_width: num('container_width', 1200) } })} className="h-10 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'theme' ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Renkleri kaydet'}</button>
        </div>
      </Section>

      {/* 4 Setler */}
      <Section step="4" title="Vitrin planı (setler)" desc={`Bugün geçerli ilk etkin set gösterilir; tarihli setler tarihsiz "her zaman" setini ezer. Set başına en çok ${st.max_products} ürün; stoksuz/görselsiz ürün vitrine girmez. Sepet indirimi: "Otomatik" = kod yok, vitrin "sepette otomatik uygulanır" der; indirimin kendisi mağazada (Ticimax sepet kampanyası) tanımlanır. "Kuponlu" = kod gösterilir ve kopyalanır. % alanı doluysa kartlarda "Sepette X TL" vurgusu hesaplanıp gösterilir.`}
        right={<div className="flex gap-2"><button onClick={() => addSet(false)} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-[var(--app-bg)] text-gray-700"><Plus size={13} /> Sürekli set</button><button onClick={() => addSet(true)} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-[var(--primary-soft)] text-[var(--primary-strong)]"><Plus size={13} /> Yarına set</button></div>}>
        <div className="rounded-xl border border-dashed border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2 text-xs">
          <Sparkles size={14} className="text-amber-500" /><span className="font-semibold text-gray-700">Yunbi önersin:</span>
          <input className={clsx(inputCls, 'w-32 py-1.5')} value={sugQ} onChange={(e) => setSugQ(e.target.value)} placeholder="anahtar (bot)" />
          {(['kadin', 'erkek', 'cocuk'] as const).map((s) => <button key={s} onClick={() => setSugSeg(sugSeg.includes(s) ? sugSeg.filter((x) => x !== s) : [...sugSeg, s])} className={clsx('px-2.5 py-1 rounded-full font-semibold', sugSeg.includes(s) ? 'bg-[var(--primary-strong)] text-white' : 'bg-[var(--app-bg)] text-gray-600')}>{{ kadin: 'Kadın', erkek: 'Erkek', cocuk: 'Çocuk' }[s]}</button>)}
          <input type="number" min={2} max={st.max_products} className={clsx(inputCls, 'w-16 py-1.5')} value={sugCount} onChange={(e) => setSugCount(parseInt(e.target.value, 10) || 8)} />
          <span className="text-gray-500">Puan = 14 gün ödenmiş satış ×0,45 + 30 gün tıklama ×0,20 + indirim derinliği ×0,20 + puan ×0,15; segmentlere eşit dağıtım, model ailesinden tek ürün.</span>
        </div>
        {sets.length === 0 && <p className="text-sm text-gray-500">Henüz set yok. “Sürekli set” ile başlayın, ürünleri Yunbi önerisinden doldurun.</p>}
        <div className="space-y-4">
          {sets.map((s) => (
            <div key={s.id} className={clsx('rounded-xl border p-4', s.id === activeId ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-100')}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {s.id === activeId && <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-500 text-white rounded-full px-2 py-0.5">Bugün yayında</span>}
                <input className={clsx(inputCls, 'flex-1 min-w-[200px] font-semibold')} value={s.title} onChange={(e) => setSet(s.id, { title: e.target.value })} placeholder={st.rules.title + '  (satır kırmak için | )'} />
                <input type="date" className={inputCls} value={s.start_date ?? ''} onChange={(e) => setSet(s.id, { start_date: e.target.value || null })} />
                <span className="text-gray-400 text-xs">→</span>
                <input type="date" className={inputCls} value={s.end_date ?? ''} onChange={(e) => setSet(s.id, { end_date: e.target.value || null })} />
                <button onClick={() => setSet(s.id, { enabled: !s.enabled })} className={clsx('text-xs font-bold rounded-full px-2.5 py-1', s.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>{s.enabled ? 'Etkin' : 'Pasif'}</button>
                <button onClick={() => removeSet(s.id)} className="text-gray-400 hover:text-rose-600"><Trash2 size={16} /></button>
              </div>
              <div className="grid md:grid-cols-4 gap-2 mb-3">
                <input className={clsx(inputCls, 'md:col-span-2')} value={s.subtitle} onChange={(e) => setSet(s.id, { subtitle: e.target.value })} placeholder={`Alt başlık (boş: "${st.rules.subtitle}")`} />
                <input className={inputCls} value={s.eyebrow} onChange={(e) => setSet(s.id, { eyebrow: e.target.value })} placeholder={`Üst etiket (boş: ${st.rules.eyebrow})`} maxLength={30} />
                <div className="flex gap-2 items-center"><select className={clsx(inputCls, 'w-32')} value={s.coupon_mode || (s.coupon ? 'code' : 'none')} onChange={(e) => setSet(s.id, { coupon_mode: e.target.value as FlashSet['coupon_mode'] })}><option value="auto">Otomatik</option><option value="code">Kuponlu</option><option value="none">Yok</option></select>{(s.coupon_mode || (s.coupon ? 'code' : 'none')) === 'code' && <input className={clsx(inputCls, 'w-24 font-mono uppercase')} value={s.coupon} onChange={(e) => setSet(s.id, { coupon: e.target.value.toUpperCase() })} placeholder="KOD" />}{(s.coupon_mode || 'none') !== 'none' && <label className="flex items-center gap-1 text-xs text-gray-600"><input type="number" min={0} max={90} className={clsx(inputCls, 'w-16')} value={s.coupon_pct ?? 0} onChange={(e) => setSet(s.id, { coupon_pct: parseInt(e.target.value, 10) || 0 })} />%</label>}{(s.coupon_mode || 'none') !== 'none' && <input className={clsx(inputCls, 'flex-1 min-w-[120px]')} value={s.coupon_text} onChange={(e) => setSet(s.id, { coupon_text: e.target.value })} placeholder="Sepette ekstra %5 indirim" />}</div>
              </div>
              <div className="space-y-1.5">
                {s.products.map((pid, i) => { const p = cache[pid]; return (
                  <div key={pid} className="flex items-center gap-3 rounded-lg bg-[var(--app-bg)] px-2 py-1.5">
                    <span className="text-[11px] font-bold text-gray-400 w-4">{i + 1}</span>
                    {p ? <Thumb p={p} small /> : <div className="w-10 h-[52px] rounded-lg bg-gray-200" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800 truncate">{p?.name ?? `#${pid}`}{p?.segment && <span className="ml-1 text-[10px] font-bold text-gray-500">· {p.segment}</span>}</div>
                      {p && <div className="text-[11px] text-gray-500">{p.dprice ? <><b className="text-gray-800">{money(p.dprice)}</b> <s>{money(p.price)}</s></> : money(p.price)} · stok {p.stock} · 14g {p.sold14} satış{!p.in_stock && <span className="text-rose-600 font-semibold"> · stoksuz/görselsiz (gösterilmez)</span>}</div>}
                    </div>
                    <button onClick={() => moveProduct(s.id, i, -1)} className="text-gray-400 hover:text-gray-700"><ChevronUp size={14} /></button>
                    <button onClick={() => moveProduct(s.id, i, 1)} className="text-gray-400 hover:text-gray-700"><ChevronDown size={14} /></button>
                    <button onClick={() => setSet(s.id, { products: s.products.filter((x) => x !== pid) })} className="text-gray-400 hover:text-rose-600"><X size={14} /></button>
                  </div>) })}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => setPicker(picker === s.id ? null : s.id)} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-[var(--app-bg)] text-gray-700"><Search size={13} /> Ürün ara / ekle</button>
                <button onClick={() => suggest(s.id, false)} disabled={suggesting === s.id} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-amber-50 text-amber-700">{suggesting === s.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Öneriyle doldur</button>
                <button onClick={() => suggest(s.id, true)} disabled={suggesting === s.id} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-amber-50 text-amber-700"><RefreshCw size={13} /> Öneriyle değiştir</button>
                <span className="text-[11px] text-gray-500 self-center">{s.products.length}/{st.max_products}</span>
              </div>
              {picker === s.id && (
                <div className="mt-3 rounded-xl border border-gray-100 p-3">
                  <div className="flex flex-wrap gap-2 items-center mb-2">
                    <input className={clsx(inputCls, 'flex-1 min-w-[200px]')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün adı, SKU, kategori…" autoFocus />
                    <label className="text-xs text-gray-600 flex items-center gap-1"><input type="checkbox" checked={onlyDisc} onChange={(e) => setOnlyDisc(e.target.checked)} /> Yalnız indirimli</label>
                    {searching && <Loader2 size={14} className="animate-spin text-gray-400" />}
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-auto">
                    {results.map((p) => <button key={p.id} onClick={() => addProduct(s.id, p)} disabled={s.products.includes(p.id) || !p.in_stock} className={clsx('flex items-center gap-2 rounded-lg p-1.5 text-left border', s.products.includes(p.id) ? 'opacity-40 border-gray-100' : !p.in_stock ? 'opacity-50 border-gray-100' : 'border-gray-100 hover:bg-[var(--app-bg)]')}>
                      <Thumb p={p} small /><div className="min-w-0"><div className="text-[11.5px] font-semibold text-gray-800 line-clamp-2">{p.name}</div><div className="text-[10.5px] text-gray-500">{p.dprice ? <><b>{money(p.dprice)}</b> <s>{money(p.price)}</s></> : money(p.price)} · stok {p.stock} · 14g {p.sold14}</div></div></button>)}
                    {!searching && results.length === 0 && <p className="text-xs text-gray-500">Sonuç yok.</p>}
                  </div>
                </div>)}
            </div>))}
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">{active ? <>Bugün yayında: <b>{active.title || st.rules.title}</b> · {active.products.length} ürün{st.ends_at && <> · bitiş {new Date(st.ends_at).toLocaleString('tr-TR')}</>}</> : 'Bugün için geçerli set yok — vitrin görünmez.'}</p>
          <button onClick={() => patch('sets', { sets })} disabled={!dirty} className={clsx('inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold', dirty ? 'bg-[var(--primary-strong)] text-white' : 'bg-gray-100 text-gray-400')}>{saving === 'sets' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Setleri kaydet</button>
        </div>
      </Section>

      {/* 5 Davranış */}
      <Section step="5" title="Metinler ve davranış" desc="Sayaç, adetler, buton metinleri. Tüm adetler gerçek veridir: satış = son 14 gün ödenmiş sipariş, stok = anlık varyant toplamı.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Field label="Üst etiket (varsayılan)" k="eyebrow" store={texts} setStore={setTexts} />
          <Field label="Başlık (varsayılan)" k="title" store={texts} setStore={setTexts} />
          <Field label="Alt başlık (varsayılan)" k="subtitle" store={texts} setStore={setTexts} w="lg:col-span-2" />
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sayaç</label><Seg value={st.rules.timer_mode} options={[['midnight', 'Bu gece 23:59'], ['set_end', 'Set bitişi'], ['off', 'Kapalı']]} onChange={(v) => patch('rules', { rules: { timer_mode: v } })} /></div>
          <Field label="Sayaç etiketi" k="timer_label" store={texts} setStore={setTexts} />
          <Field label="Buton" k="cta_text" store={texts} setStore={setTexts} />
          <Field label="İncele metni" k="view_text" store={texts} setStore={setTexts} />
          <Field label="Alt bağlantı metni" k="footer_text" store={texts} setStore={setTexts} />
          <Field label="Alt bağlantı URL" k="footer_url" store={texts} setStore={setTexts} placeholder="/firsat-urunleri" />
          <Field label="Kupon etiketi" k="coupon_label" store={texts} setStore={setTexts} />
          <Field label="Gizli yollar" k="hide_paths" store={texts} setStore={setTexts} />
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">En çok ürün / ızgara satırı</label><div className="flex gap-2"><input className={clsx(inputCls, 'w-full')} value={nums.max_products ?? ''} onChange={(e) => setNums((s) => ({ ...s, max_products: e.target.value }))} /><input className={clsx(inputCls, 'w-full')} value={nums.rows ?? ''} onChange={(e) => setNums((s) => ({ ...s, rows: e.target.value }))} /></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Rotasyon türü</label><Seg value={st.rules.rotate_mode || 'time'} options={[['visitor', 'Ziyaretçiye göre'], ['time', 'Zamana göre']]} onChange={(v) => patch('rules', { rules: { rotate_mode: v } })} /><p className="text-[11px] text-gray-500 mt-1">Ziyaretçiye göre: her oturum rastgele bir 4'lü görür, tüm liste dönüşümlü sergilenir.</p></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Rotasyon: kaç saatte bir / kaç ürün kaysın</label><div className="flex gap-2"><input className={clsx(inputCls, 'w-full')} value={nums.rotate_hours ?? ''} onChange={(e) => setNums((s) => ({ ...s, rotate_hours: e.target.value }))} placeholder="0 = kapalı" /><input className={clsx(inputCls, 'w-full')} value={nums.rotate_step ?? ''} onChange={(e) => setNums((s) => ({ ...s, rotate_step: e.target.value }))} /></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Satış eşiği / Stok eşiği</label><div className="flex gap-2"><input className={clsx(inputCls, 'w-full')} value={nums.sold_threshold ?? ''} onChange={(e) => setNums((s) => ({ ...s, sold_threshold: e.target.value }))} /><input className={clsx(inputCls, 'w-full')} value={nums.stock_threshold ?? ''} onChange={(e) => setNums((s) => ({ ...s, stock_threshold: e.target.value }))} /></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Min / Maks ekran genişliği (0 = hepsi)</label><div className="flex gap-2"><input className={clsx(inputCls, 'w-full')} value={nums.min_width ?? ''} onChange={(e) => setNums((s) => ({ ...s, min_width: e.target.value }))} /><input className={clsx(inputCls, 'w-full')} value={nums.max_width ?? ''} onChange={(e) => setNums((s) => ({ ...s, max_width: e.target.value }))} /></div></div>
          <button onClick={() => patch('rules', { rules: { eyebrow: texts.eyebrow, title: texts.title, subtitle: texts.subtitle, timer_label: texts.timer_label, cta_text: texts.cta_text, view_text: texts.view_text, footer_text: texts.footer_text, footer_url: texts.footer_url, coupon_label: texts.coupon_label, hide_paths: texts.hide_paths, max_products: num('max_products', 8), rows: num('rows', 1), rotate_hours: num('rotate_hours', 0), rotate_step: num('rotate_step', 4), sold_threshold: num('sold_threshold', 10), stock_threshold: num('stock_threshold', 5), min_width: num('min_width', 0), max_width: num('max_width', 0) } })} className="h-10 self-end rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'rules' ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Metinleri kaydet'}</button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Toggle on={st.rules.quick_add} onChange={(v) => patch('rules', { rules: { quick_add: v } })} label="Kart içinden sepete ekle" hint="Bedene dokun → sepete eklenir (Ticimax AddToCartV3). Kapalıysa buton ürüne götürür." />
          <Toggle on={st.rules.show_sold} onChange={(v) => patch('rules', { rules: { show_sold: v } })} label="Satış adedi göster" hint='"Bu hafta 276 adet satıldı" — eşiğin altında gizlenir.' />
          <Toggle on={st.rules.show_stock} onChange={(v) => patch('rules', { rules: { show_stock: v } })} label='"Son N adet" uyarısı' hint="Yalnız gerçek stok eşiğin altındaysa." />
          <Toggle on={st.rules.show_bar} onChange={(v) => patch('rules', { rules: { show_bar: v } })} label="Satış hızı çubuğu" hint="satıldı / (satıldı + kalan) oranı." />
          <Toggle on={st.rules.show_segment} onChange={(v) => patch('rules', { rules: { show_segment: v } })} label="Kadın/Erkek/Çocuk çipi" />
          <Toggle on={st.rules.hover_swap} onChange={(v) => patch('rules', { rules: { hover_swap: v } })} label="Masaüstünde ikinci fotoğraf" hint="Fare üstüne gelince 2. görsel." />
        </div>
      </Section>

      {/* 6 Önizleme */}
      <Section step="6" title="Önizleme" desc="Bugünkü set + seçili yerleşim ve renk ile canlı önizleme (demo mağaza sayfası)." right={<Seg value={previewMode} options={[['mobile', 'Mobil'], ['desktop', 'Masaüstü']]} onChange={setPreviewMode} />}>
        <div className="flex items-center gap-2 mb-3">{previewMode === 'mobile' ? <Smartphone size={14} className="text-gray-400" /> : <Monitor size={14} className="text-gray-400" />}<span className="text-xs text-gray-500">{previewMode === 'mobile' ? '390 px' : '1280 px'}</span><button onClick={() => setPreviewKey((k) => k + 1)} className="ml-auto text-xs font-semibold text-[var(--primary-strong)] inline-flex items-center gap-1"><RefreshCw size={12} /> Yenile</button></div>
        {previewMode === 'mobile' ? <div className="max-w-[390px] mx-auto rounded-[28px] border-8 border-gray-900 overflow-hidden"><iframe key={previewKey} title="mobil" src={previewSrc} className="border-0 w-[390px] h-[760px] block" /></div> : <ScaledFrame key={previewKey} src={previewSrc} width={1280} height={820} title="masaüstü" />}
      </Section>

      {/* 7 Analitik */}
      <Section step="7" title="Analitik" desc="view = vitrin ekranda ≥%40 görünür oldu (oturum başına); tıklama/sepet; satış atıfı = IP + ürün + 24 saat içinde ödenmiş sipariş (saat başı)." right={<Seg value={String(range)} options={[['7', '7 gün'], ['30', '30 gün'], ['90', '90 gün']]} onChange={(v) => setRange(parseInt(v, 10))} />}>
        {!an ? <div className="text-sm text-gray-400 flex items-center gap-2"><BarChart3 size={16} /> Yükleniyor…</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[['Görüntüleme (oturum)', an.sessions], ['Ürün tıklama', an.clicks], ['Sepete ekleme', an.atc], ['Etkileşim oranı', an.engagement_rate + '%'], ['Satış (atıf)', an.conversions], ['Ciro (atıf)', money(an.revenue)]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-[var(--app-bg)] p-3"><div className="text-[11px] text-gray-500">{l}</div><div className="text-lg font-bold text-gray-900">{v}</div></div>)}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div><h3 className="text-xs font-bold text-gray-700 mb-2">Ürüne göre</h3><div className="space-y-1">{an.by_product.slice(0, 10).map((p) => <div key={p.product_id} className="flex items-center gap-2 text-xs"><span className="flex-1 truncate text-gray-700">{p.name ?? '#' + p.product_id}</span><span className="text-gray-500">{p.clicks} tık · {p.atc} sepet · {p.conv} satış · {money(p.rev)}</span></div>)}{an.by_product.length === 0 && <p className="text-xs text-gray-400">Henüz veri yok.</p>}</div></div>
              <div><h3 className="text-xs font-bold text-gray-700 mb-2">Yerleşime / cihaza göre</h3><div className="space-y-1">{an.by_layout.map((l) => <div key={l.layout ?? '-'} className="flex items-center gap-2 text-xs"><span className="flex-1 text-gray-700">{LAYOUTS[l.layout ?? '']?.label ?? l.layout ?? '—'}</span><span className="text-gray-500">{l.views} görüntüleme · {l.acts} etkileşim · {l.conv} satış</span></div>)}{an.by_device.map((d) => <div key={d.device ?? '-'} className="flex items-center gap-2 text-xs"><span className="flex-1 text-gray-700">{d.device === 'm' ? 'Mobil' : d.device === 'd' ? 'Masaüstü' : '—'}</span><span className="text-gray-500">{d.views} görüntüleme · {d.acts} etkileşim</span></div>)}</div>
                {an.errors.length > 0 && <div className="mt-3 text-[11px] text-rose-600">Hatalar: {an.errors.map((e) => `${e.value} (${e.c})`).join(', ')}</div>}</div>
            </div>
          </div>)}
      </Section>
    </div>
  )
}
