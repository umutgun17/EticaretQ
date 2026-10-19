import { useCallback, useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal, ExternalLink, Loader2, Check, Copy, ChevronUp, ChevronDown, ChevronRight, RefreshCw, ScanLine, Save, RotateCcw, BarChart3, Eye, Star, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { filterApi, type FilterSettings, type FilterFacetCfg, type FilterAnalytics, type FilterDetect, type FilterFacetPreview, type FilterTheme, type FilterSizeRange } from '@/lib/croApi'

/* Akıllı Filtre (CRO) — kategori sayfası filtresini Yunbi verisiyle değiştiren widget'ın paneli:
   kurulum, şablon, tema, filtre başlıkları (sıra/etiket/aç-kapa), gösterim kuralları, analitik. */

const TYPE_LABELS: Record<string, string> = { category: 'Alt kategori', price: 'Fiyat aralığı', color: 'Renk swatch', size: 'Beden ızgarası', brand: 'Liste', flag: 'Tek seçenek', rating: 'Yıldız', spec: 'Özellik listesi' }

function TplMock({ kind }: { kind: 'sidebar' | 'topbar' | 'drawer' }) {
  const box = 'rounded-md bg-gray-200/80'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 h-24 flex gap-1.5">
      {kind === 'sidebar' && <div className="w-7 flex flex-col gap-1"><div className={clsx(box, 'h-2')} /><div className={clsx(box, 'h-2 w-5')} /><div className={clsx(box, 'h-2')} /><div className={clsx(box, 'h-2 w-4')} /></div>}
      <div className="flex-1 flex flex-col gap-1.5">
        {kind === 'topbar' && <div className="flex gap-1"><div className={clsx(box, 'h-3 w-8 rounded-full')} /><div className={clsx(box, 'h-3 w-8 rounded-full')} /><div className={clsx(box, 'h-3 w-8 rounded-full')} /></div>}
        {kind === 'drawer' && <div className="flex gap-1"><div className="h-3 w-10 rounded-full bg-indigo-500" /><div className={clsx(box, 'h-3 w-12 rounded-full ml-auto')} /></div>}
        <div className="grid grid-cols-4 gap-1 flex-1">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className={clsx(box, 'rounded-sm')} />)}</div>
      </div>
    </div>
  )
}


const inputCls = 'rounded-xl bg-[var(--app-bg)] border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-strong)]/30 focus:bg-white'

function Section({ step, title, desc, children, right }: { step: string; title: string; desc?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
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
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-start gap-3 text-left rounded-xl border border-gray-100 p-3 hover:bg-[var(--app-bg)] w-full">
      <span className={clsx('mt-0.5 w-9 h-5 rounded-full relative transition-colors shrink-0', on ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-[18px]' : 'left-0.5')} /></span>
      <span><span className="text-sm font-semibold text-gray-800 block">{label}</span>{hint && <span className="text-[11px] text-gray-500">{hint}</span>}</span>
    </button>
  )
}

const fmt = (n: number) => n.toLocaleString('tr-TR')

/* Başlığa tıklanınca açılan küçük örnek: sitede o başlığın altında gelecek seçenekler (tüm katalog, filtre yok).
   Tema ayarlarına (swatch/çip biçimi, vurgu rengi) uyar ki mağazadaki görünüme yakın olsun. */
function FacetPreview({ p, theme, showCounts, onAdd }: { p: FilterFacetPreview | 'loading' | 'error'; theme: FilterTheme; showCounts: boolean; onAdd?: () => void }) {
  if (p === 'loading') return <div className="text-xs text-gray-400 flex items-center gap-2 py-1"><Loader2 size={12} className="animate-spin" /> Örnek hazırlanıyor…</div>
  if (p === 'error') return <div className="text-xs text-rose-600 py-1">Örnek yüklenemedi.</div>
  const cnt = (n: number) => (showCounts ? <span className="text-gray-400 ml-1">({fmt(n)})</span> : null)
  const chip = theme.chip === 'square' ? 'rounded-md' : 'rounded-full'
  const rest = p.total_values - p.values.length
  let body: React.ReactNode
  if (p.type === 'color') {
    body = <div className="flex flex-wrap gap-x-3 gap-y-1.5">{p.values.map((v) => (
      <span key={v.value} className="inline-flex items-center gap-1.5 text-[11.5px] text-gray-700">
        <span className={clsx('w-4 h-4 border border-black/10 shrink-0', theme.swatch === 'square' ? 'rounded' : 'rounded-full')} style={{ background: v.hex ?? 'linear-gradient(135deg,#eee,#bbb)' }} />{v.label}{cnt(v.count)}
      </span>))}</div>
  } else if (p.type === 'size') {
    body = <div className="flex flex-wrap gap-1.5">{p.values.map((v, i) => (
      <span key={v.value} className={clsx('text-[11px] px-2 py-0.5 border', chip, i === 1 ? 'text-white' : 'border-gray-300 text-gray-700 bg-white')} style={i === 1 ? { background: theme.accent, borderColor: theme.accent } : undefined}>{v.label}</span>))}</div>
  } else if (p.type === 'price') {
    const mn = p.min ?? 0; const mx = p.max ?? 0
    body = <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11.5px] text-gray-700"><span>{fmt(mn)} {p.currency}</span>
        <span className="relative flex-1 h-1 rounded-full bg-gray-200 max-w-[220px]"><span className="absolute left-[20%] right-[35%] h-full rounded-full" style={{ background: theme.accent }} /><span className="absolute left-[20%] -top-1 w-3 h-3 rounded-full bg-white border-2 -ml-1.5" style={{ borderColor: theme.accent }} /><span className="absolute right-[35%] -top-1 w-3 h-3 rounded-full bg-white border-2 -mr-1.5" style={{ borderColor: theme.accent }} /></span>
        <span>{fmt(mx)} {p.currency}</span></div>
      {(p.buckets ?? []).length > 0 && <div className="flex flex-wrap gap-1.5">{(p.buckets ?? []).map((b) => <span key={b.min} className={clsx('text-[11px] px-2 py-0.5 border border-gray-300 bg-white text-gray-700', chip)}>{fmt(b.min)} – {fmt(b.max)} {p.currency}{cnt(b.count)}</span>)}</div>}
    </div>
  } else if (p.type === 'rating') {
    body = <div className="space-y-1">{p.values.map((v) => (
      <div key={v.value} className="flex items-center gap-1.5 text-[11.5px] text-gray-700"><span className="w-3 h-3 rounded border border-gray-300 bg-white" />
        <span className="flex text-amber-400">{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={11} fill={i <= Math.floor(Number(v.value)) ? 'currentColor' : 'none'} className={i <= Math.ceil(Number(v.value)) ? '' : 'text-gray-300'} />)}</span>{v.label}{cnt(v.count)}</div>))}</div>
  } else if (p.type === 'flag') {
    body = <div className="space-y-1">{p.values.map((v) => <div key={v.value} className="flex items-center gap-1.5 text-[11.5px] text-gray-700"><span className="w-3 h-3 rounded flex items-center justify-center" style={{ background: theme.accent }}><Check size={9} className="text-white" strokeWidth={4} /></span>{v.label}{cnt(v.count)}</div>)}</div>
  } else {
    body = <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">{p.values.map((v) => (
      <div key={v.value} className="flex items-center gap-1.5 text-[11.5px] text-gray-700 min-w-0"><span className="w-3 h-3 rounded border border-gray-300 bg-white shrink-0" /><span className="truncate">{v.label}</span>{cnt(v.count)}</div>))}</div>
  }
  return (
    <div className="rounded-lg border border-gray-100 bg-[var(--app-bg)]/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">{p.label}</span>
        <span className="text-[10px] text-gray-400">sitede böyle görünür · tüm katalog, kategoride daralır</span>
      </div>
      {p.values.length === 0 && p.type !== 'price' ? <div className="text-xs text-gray-400">Bu başlık için stoklu üründe değer bulunamadı.</div> : body}
      <div className="flex items-center justify-between mt-2">
        {rest > 0 ? <span className="text-[10.5px] text-gray-400">+{fmt(rest)} değer daha</span> : <span />}
        {onAdd && <button onClick={onAdd} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"><Plus size={11} /> Listeye ekle</button>}
      </div>
    </div>
  )
}

export default function CroFilterPage() {
  const [st, setSt] = useState<FilterSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [facets, setFacets] = useState<FilterFacetCfg[]>([])
  const [facetsDirty, setFacetsDirty] = useState(false)
  const [detect, setDetect] = useState<FilterDetect | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [an, setAn] = useState<FilterAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [selectors, setSelectors] = useState<{ hide: string; mount: string; hide_native?: string; mount_native?: string; css_native?: string }>({ hide: '', mount: '' })
  const [advOpen, setAdvOpen] = useState(false)
  const [sizeRanges, setSizeRanges] = useState<FilterSizeRange[]>([])
  const [sizeDirty, setSizeDirty] = useState(false)
  const [drawerW, setDrawerW] = useState(560)
  const [cats, setCats] = useState<{ platform_category_id: number; name: string; path: string; url: string; depth: number; product_count: number }[] | null>(null)
  const [catQ, setCatQ] = useState('')
  const [hiddenCats, setHiddenCats] = useState<number[]>([])
  const [hiddenDirty, setHiddenDirty] = useState(false)
  const loadCats = () => { if (cats) return; filterApi.categories().then(setCats).catch(() => setCats([])) }
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, FilterFacetPreview | 'loading' | 'error'>>({})
  const togglePreview = (key: string) => {
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    if (previews[key] && previews[key] !== 'error') return
    setPreviews((p) => ({ ...p, [key]: 'loading' }))
    filterApi.facetValues(key).then((d) => setPreviews((p) => ({ ...p, [key]: d }))).catch(() => setPreviews((p) => ({ ...p, [key]: 'error' })))
  }

  const load = useCallback(() => {
    setLoading(true)
    filterApi.settings().then((d) => { setSt(d); setDomains(d.domains); setFacets(d.facets); setSelectors(d.selectors); setFacetsDirty(false); setSizeRanges(d.rules.size_ranges ?? []); setSizeDirty(false); setHiddenCats(d.rules.hidden_categories ?? []); setHiddenDirty(false); setDrawerW(d.theme.drawer_width ?? 560) })
      .catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { filterApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key)
    setError('')
    try { const d = await filterApi.update(body); setSt(d); if (key !== 'facets') { setFacets(d.facets) } }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }

  const embed = st ? `<script src="${st.base_url}/widget/filter.js?v=3" data-tenant="${st.slug}"></script>` : ''
  const demoUrl = (over: Record<string, string> = {}) => {
    if (!st) return '#'
    const p = new URLSearchParams({ tenant: st.slug, template: over.template ?? st.template, ...(over.preset ? { preset: over.preset } : {}) })
    return `/widget/filter-demo.html?${p.toString()}`
  }

  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }

  const runDetect = async () => { setDetecting(true); try { setDetect(await filterApi.detect()) } catch { setError('Site taranamadı') } finally { setDetecting(false) } }

  const moveFacet = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= facets.length) return
    const next = [...facets]; const t = next[i]; next[i] = next[j]; next[j] = t
    setFacets(next); setFacetsDirty(true)
  }
  const setFacet = (i: number, p: Partial<FilterFacetCfg>) => { setFacets(facets.map((f, k) => (k === i ? { ...f, ...p } : f))); setFacetsDirty(true) }
  const addable = useMemo(() => (st?.catalog.facets ?? []).filter((c) => !facets.some((f) => f.key === c.key)), [st, facets])
  const addFacet = (key: string) => { const c = st?.catalog.facets.find((x) => x.key === key); if (!c) return; setFacets([...facets, { key: c.key, label: c.label, type: c.type, enabled: true, collapsed: true }]); setFacetsDirty(true) }
  const removeFacet = (i: number) => { setFacets(facets.filter((_, k) => k !== i)); setFacetsDirty(true) }
  const coverageOf = (key: string) => st?.catalog.facets.find((c) => c.key === key)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><SlidersHorizontal size={24} /> Akıllı Filtre
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Kategori sayfasındaki filtre ve ürün listesi Yunbi'nin canlı katalog verisiyle çalışır: renk swatch'ı, stoktaki bedenler, fiyat dilimleri, ürün özellikleri, puan.</p>
        </div>
        <a href={demoUrl()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><ExternalLink size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      {/* 1 Kurulum */}
      <Section step="1" title="Kurulum" desc="Widget yalnız kategori sayfalarında devreye girer; mağazanın kendi filtre bloğunu ve ürün listesini gizleyip aynı yere yerleşir. Domain listesi dışından gelen istekler reddedilir.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Widget açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz (tema bozulmaz)." />
            <div>
              <label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
              <div className="flex gap-2 mt-1">
                <input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" />
                <button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">{saving === 'domains' ? '…' : 'Kaydet'}</button>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">Tema embed kodu (tüm sayfalara, {'</body>'} öncesi)</label>
              <div className="mt-1 flex items-start gap-2">
                <code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code>
                <button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50" title="Kopyala">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={runDetect} disabled={detecting} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60">{detecting ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Siteyi tara</button>
              {detect && (
                <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                  <span>HTTP {detect.http}</span>
                  <span className={detect.ticimax ? 'text-emerald-600' : 'text-amber-600'}>{detect.ticimax ? 'Ticimax algılandı' : 'Ticimax imzası yok'}</span>
                  {detect.mode === 'native' && <span className={detect.ticimax_globals ? 'text-emerald-600' : 'text-rose-600'}>{detect.ticimax_globals ? 'Ticimax liste motoru bulundu' : 'Ticimax liste motoru bulunamadı (takeover\'a düşer)'}</span>}
                  <span className={detect.widget_embedded ? 'text-emerald-600' : 'text-rose-600'}>{detect.widget_embedded ? 'Script temada gömülü' : 'Script temada YOK'}</span>
                  <span className={detect.mount.found ? 'text-emerald-600' : 'text-rose-600'}>Yerleşim noktası {detect.mount.found ? 'bulundu' : 'bulunamadı'}</span>
                  <span>{detect.hide.filter((h) => h.found).length}/{detect.hide.length} gizlenecek blok bulundu</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* 2 Liste kaynağı (mod) */}
      <Section step="2" title="Ürün listesi kimde kalsın?" desc="Filtre paneli her iki modda da Yunbi'nindir. Fark, ürün ızgarasını kimin çizdiği.">
        <div className="grid md:grid-cols-2 gap-3">
          {([
            ['native', 'Mağazanın listesi kalsın (önerilen)', 'Ticimax\'ın kendi ürün listesi, lazy load, sonsuz kaydırma ve sepete ekle olduğu gibi çalışır. Üst araç çubuğu (ürün sayısı, seçili filtre çipleri, Filtrele butonu, sıralama, ızgara görünümü) demodaki gibi Yunbi\'den gelir; temanın kendi sıralama kutusu, sayacı ve alt kategori nav\'ı gizlenir. Sıralama seçimi Ticimax\'ın motoruna iletilir, sayaç Ticimax\'ın listelediği adedi gösterir. Yunbi paneli seçilen filtrelere uyan ürün kimliklerini Ticimax\'a verir (?ukids=…). Demo sayfasında Ticimax olmadığı için liste Yunbi tarafından çizilir.'],
            ['takeover', 'Listeyi de Yunbi çizsin', 'Filtre + ürün ızgarası tamamen Yunbi widget\'ından gelir: Yunbi sıralaması (önerilen / çok satan / puan), renk swatch\'lı kartlar, "daha fazla" yükleme. Ticimax dışı platformlarda ve tema listesinin değiştirilmesi istenen durumlarda.'],
          ] as const).map(([key, label, hint]) => (
            <div key={key} onClick={() => patch('mode', { mode: key })} role="button" tabIndex={0} className={clsx('cursor-pointer border-2 rounded-xl p-4 transition', st.mode === key ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200 hover:border-indigo-300')}>
              <div className="flex items-center gap-2">
                <span className={clsx('w-4 h-4 rounded-full border-2 flex items-center justify-center', st.mode === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')}>{st.mode === key && <Check size={10} className="text-white" strokeWidth={4} />}</span>
                <span className="text-sm font-semibold text-gray-800">{label}</span>
              </div>
              <p className="text-[12px] text-gray-500 mt-2 leading-relaxed">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 3 Şablon */}
      <Section step="3" title="Yerleşim şablonu" desc="Tıkladığın anda kaydedilir. Masaüstünde farklı, mobilde hepsi altta açılan panel + yapışkan 'ürünleri göster' butonu kullanır.">
        <div className="grid sm:grid-cols-3 gap-3">
          {([['sidebar', 'Sol panel', 'Klasik: filtreler solda her zaman görünür. Çok filtreli kataloglarda en yüksek kullanım (Baymard).'], ['topbar', 'Üst çubuk', 'Filtre başlıkları ürünlerin üstünde açılır kutu olarak; ürün ızgarası tam genişlik.'], ['drawer', 'Butonla açılan', 'Tek "Filtrele" butonu; panel yandan kayar. Sade sayfalar, az filtre için.']] as const).map(([key, label, hint]) => (
            <div key={key} onClick={() => patch('template', { template: key })} role="button" tabIndex={0} className={clsx('cursor-pointer border-2 rounded-xl p-3 transition', st.template === key ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200 hover:border-indigo-300')}>
              <TplMock kind={key} />
              <div className="flex items-center gap-2 mt-2.5">
                <span className={clsx('w-4 h-4 rounded-full border-2 flex items-center justify-center', st.template === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')}>{st.template === key && <Check size={10} className="text-white" strokeWidth={4} />}</span>
                <span className="text-sm font-semibold text-gray-800">{label}</span>
                <a href={demoUrl({ template: key })} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-[11px] font-medium text-indigo-600 flex items-center gap-1"><ExternalLink size={11} /> Önizle</a>
              </div>
              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 3 Tema */}
      <Section step="4" title="Tema" desc="Yazı tipi mağazadan miras alınır; renk, köşe ve çip biçimi buradan. Değişiklikler anında kaydedilir.">
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {([['minimal', 'Minimal', 'İnce çizgiler, beyaz zemin, siyah vurgu. Tonny Black gibi monokrom markalar.'], ['soft', 'Soft', 'Açık gri dolgular, yumuşak köşeler, sakin görünüm.'], ['bold', 'Bold', 'Büyük harf başlıklar, koyu çerçeve, vurgu rengi baskın.']] as const).map(([key, label, hint]) => (
            <div key={key} onClick={() => patch('theme', { theme: { preset: key } })} role="button" tabIndex={0} className={clsx('cursor-pointer border-2 rounded-xl p-3', st.theme.preset === key ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200 hover:border-indigo-300')}>
              <div className={clsx('rounded-lg p-2 h-16 flex flex-col gap-1.5', key === 'minimal' && 'bg-white border border-gray-200', key === 'soft' && 'bg-gray-50 border border-gray-100', key === 'bold' && 'bg-white border-2 border-gray-900')}>
                <div className={clsx('h-2 w-14 rounded', key === 'bold' ? 'bg-gray-900' : 'bg-gray-300')} />
                <div className="flex gap-1">{['#111827', '#d9c4a3', '#ffffff', '#6b4a2b'].map((c) => <span key={c} className={clsx('w-4 h-4 border border-black/10', st.theme.swatch === 'square' ? 'rounded' : 'rounded-full')} style={{ background: c }} />)}</div>
                <div className="flex gap-1">{['36', '37', '38'].map((s) => <span key={s} className={clsx('text-[9px] px-1.5 border', st.theme.chip === 'square' ? 'rounded' : 'rounded-full', key === 'soft' ? 'bg-gray-100 border-gray-100' : 'border-gray-300', s === '37' && 'bg-gray-900 text-white border-gray-900')}>{s}</span>)}</div>
              </div>
              <div className="flex items-center gap-2 mt-2"><span className={clsx('w-4 h-4 rounded-full border-2 flex items-center justify-center', st.theme.preset === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')}>{st.theme.preset === key && <Check size={10} className="text-white" strokeWidth={4} />}</span><span className="text-sm font-semibold text-gray-800">{label}</span>
                <a href={demoUrl({ preset: key })} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-[11px] font-medium text-indigo-600 flex items-center gap-1"><ExternalLink size={11} /> Önizle</a></div>
              <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Vurgu rengi</label><div className="flex items-center gap-2"><input type="color" value={st.theme.accent} onChange={(e) => patch('theme', { theme: { accent: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{st.theme.accent}</code></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe yuvarlaklığı</label><input type="range" min={0} max={24} value={st.theme.radius} onChange={(e) => setSt({ ...st, theme: { ...st.theme, radius: Number(e.target.value) } })} onMouseUp={(e) => patch('theme', { theme: { radius: Number((e.target as HTMLInputElement).value) } })} onTouchEnd={(e) => patch('theme', { theme: { radius: Number((e.target as HTMLInputElement).value) } })} /><span className="text-xs text-gray-500 ml-2">{st.theme.radius}px</span></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Çip biçimi</label><div className="flex rounded-full bg-[var(--app-bg)] p-0.5">{(['pill', 'square'] as const).map((v) => <button key={v} onClick={() => patch('theme', { theme: { chip: v } })} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', st.theme.chip === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{v === 'pill' ? 'Yuvarlak' : 'Köşeli'}</button>)}</div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Renk swatch'ı</label><div className="flex rounded-full bg-[var(--app-bg)] p-0.5">{(['circle', 'square'] as const).map((v) => <button key={v} onClick={() => patch('theme', { theme: { swatch: v } })} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', st.theme.swatch === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{v === 'circle' ? 'Daire' : 'Kare'}</button>)}</div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Filtre çekmecesi genişliği (web)</label><div className="flex items-center gap-2"><input type="number" min={320} max={720} step={10} value={drawerW} onChange={(e) => setDrawerW(Number(e.target.value))} onBlur={() => { const v = Math.max(320, Math.min(720, drawerW || 560)); setDrawerW(v); if (v !== (st.theme.drawer_width ?? 560)) patch('theme', { theme: { drawer_width: v } }) }} className={clsx(inputCls, 'w-24')} /><span className="text-xs text-gray-400">px · mobilde çekmece tam ekran açılır</span></div></div>
        </div>
      </Section>

      {/* 4 Filtre başlıkları */}
      <Section step="5" title="Filtre başlıkları" desc={`Kataloğunuzdan çıkarılan başlıklar (${st.catalog.active_products.toLocaleString('tr-TR')} stoklu ürün tarandı). Sıra sitedeki sırayı belirler; kapsama oranı, başlığın kaç üründe dolu olduğunu gösterir. Baymard'ın 5 temel filtresi (fiyat, puan, renk, beden, marka) varsayılan olarak üsttedir.`}
        right={<div className="flex items-center gap-2">
          <button onClick={() => patch('facets', { facets: null }).then(load)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılana dön</button>
          <button onClick={() => filterApi.refreshCatalog().then(load)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800" title="Katalog değiştiyse başlıkları yeniden tara"><RefreshCw size={13} /> Yeniden tara</button>
          <button onClick={() => patch('facets', { facets }).then(() => setFacetsDirty(false))} disabled={!facetsDirty || saving === 'facets'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'facets' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Sırayı kaydet</button>
        </div>}>
        <div className="divide-y divide-gray-50">
          {facets.map((f, i) => { const cov = coverageOf(f.key); return (
            <div key={f.key} className={clsx('py-2', !f.enabled && 'opacity-50')}>
            <div className="flex items-center gap-3">
              <div className="flex flex-col"><button onClick={() => moveFacet(i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp size={14} /></button><button onClick={() => moveFacet(i, 1)} disabled={i === facets.length - 1} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown size={14} /></button></div>
              <button onClick={() => setFacet(i, { enabled: !f.enabled })} className={clsx('w-9 h-5 rounded-full relative shrink-0', f.enabled ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', f.enabled ? 'left-[18px]' : 'left-0.5')} /></button>
              <input value={f.label} onChange={(e) => setFacet(i, { label: e.target.value })} className={clsx(inputCls, 'w-44 py-1.5')} />
              <button onClick={() => togglePreview(f.key)} title="Sitede gelecek alt seçenekleri göster" className={clsx('inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap border transition', openKey === f.key ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-[var(--app-bg)] border-transparent text-gray-600 hover:border-indigo-200 hover:text-indigo-700')}>
                {TYPE_LABELS[f.type] ?? f.type}<ChevronRight size={12} className={clsx('transition-transform', openKey === f.key && 'rotate-90')} /></button>
              {f.key.startsWith('spec:') && <span className="text-[11px] text-gray-400 truncate">özellik: {f.key.slice(5)}</span>}
              <div className="ml-auto flex items-center gap-3 shrink-0">
                {cov && <div className="w-32"><div className="flex justify-between text-[10px] text-gray-400"><span>kapsama</span><span>%{cov.coverage_pct}{cov.distinct ? ` · ${cov.distinct} değer` : ''}</span></div><div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={clsx('h-full rounded-full', cov.coverage_pct >= 60 ? 'bg-emerald-500' : cov.coverage_pct >= 30 ? 'bg-amber-500' : 'bg-rose-400')} style={{ width: cov.coverage_pct + '%' }} /></div></div>}
                <label className="text-[11px] text-gray-500 flex items-center gap-1"><input type="checkbox" checked={f.collapsed} onChange={(e) => setFacet(i, { collapsed: e.target.checked })} /> kapalı başla</label>
                <button onClick={() => removeFacet(i)} className="text-[11px] text-gray-400 hover:text-rose-600">kaldır</button>
              </div>
            </div>
            {openKey === f.key && <div className="mt-2 ml-[4.25rem] mr-1"><FacetPreview p={previews[f.key] ?? 'loading'} theme={st.theme} showCounts={st.rules.show_counts} /></div>}
            </div>) })}
        </div>
        {addable.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Eklenebilir başlıklar</p>
            <div className="flex flex-wrap gap-1.5">{addable.map((c) => (
              <span key={c.key} className={clsx('inline-flex items-stretch rounded-full border text-xs overflow-hidden', openKey === c.key ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200')}>
                <button onClick={() => addFacet(c.key)} className="px-2.5 py-1 hover:bg-indigo-50 hover:text-indigo-700">+ {c.label} <span className="text-gray-400">%{c.coverage_pct}</span></button>
                <button onClick={() => togglePreview(c.key)} title="Alt seçenekleri gör" className={clsx('px-1.5 border-l flex items-center', openKey === c.key ? 'border-indigo-200 text-indigo-700' : 'border-gray-200 text-gray-400 hover:text-indigo-700 hover:bg-indigo-50')}><Eye size={12} /></button>
              </span>))}</div>
            {openKey && addable.some((c) => c.key === openKey) && <div className="mt-2"><FacetPreview p={previews[openKey] ?? 'loading'} theme={st.theme} showCounts={st.rules.show_counts} onAdd={() => { addFacet(openKey); setOpenKey(null) }} /></div>}
          </div>
        )}
      </Section>

      {/* 5 Gösterim kuralları */}
      <Section step="6" title="Gösterim kuralları" desc="Anahtarlar tıklandığı anda kaydedilir; sayfa boyutu ve sıralama 1 dk içinde ziyaretçiye yansır.">
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          <Toggle on={st.rules.hide_out_of_stock} onChange={(v) => patch('rules', { rules: { hide_out_of_stock: v } })} label="Tükenen ürünleri gizle" hint="Toplam stoğu 0 olan ürün listelenmez." />
          <Toggle on={st.rules.require_image ?? true} onChange={(v) => patch('rules', { rules: { require_image: v } })} label="Görselsiz ürünleri sayma" hint="Mağaza listesi görseli olmayan ürünü göstermez; kapatılırsa Yunbi sayıları mağazadan fazla çıkar." />
          <Toggle on={st.rules.size_in_stock_only} onChange={(v) => patch('rules', { rules: { size_in_stock_only: v } })} label="Yalnız stoktaki bedenler" hint="Beden ızgarasında tükenmiş bedenler görünmez; renk+beden aynı varyantta eşleşir." />
          <Toggle on={st.rules.show_counts} onChange={(v) => patch('rules', { rules: { show_counts: v } })} label="Ürün sayılarını göster" hint="Her seçeneğin yanında kaç ürün olduğu yazar." />
          <Toggle on={st.rules.price_buckets} onChange={(v) => patch('rules', { rules: { price_buckets: v } })} label="Hızlı fiyat dilimleri" hint="Kaydırıcının altında kataloğa göre hesaplanan 4 dilim butonu." />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sayfa başına ürün</label><select className={inputCls} value={st.rules.per_page} onChange={(e) => patch('rules', { rules: { per_page: Number(e.target.value) } })}>{[12, 16, 24, 32, 48, 60].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Varsayılan sıralama</label><select className={inputCls} value={st.rules.sort_default} onChange={(e) => patch('rules', { rules: { sort_default: e.target.value } })}>{Object.entries(st.sorts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">"Daha fazla" eşiği</label><select className={inputCls} value={st.rules.show_more_limit} onChange={(e) => patch('rules', { rules: { show_more_limit: Number(e.target.value) } })}>{[5, 6, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n} seçenek</option>)}</select></div>
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-gray-800">Alt Kategori başlığında gizlenecek kategoriler</div>
              <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">Henüz dağıtımı yapılmamış veya teknik kategoriler (ör. Kadın altındaki "Ayakkabı") filtre başlığında görünmez. Ürünler listeden düşmez, yalnız seçenek gizlenir.</p>
            </div>
            <button onClick={() => patch('rules', { rules: { hidden_categories: hiddenCats } }).then(() => setHiddenDirty(false))} disabled={!hiddenDirty || saving === 'rules'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'rules' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Gizlenenleri kaydet</button>
          </div>
          {hiddenCats.length > 0 && cats && <div className="flex flex-wrap gap-1.5 mt-2">{hiddenCats.map((id) => { const c = cats.find((x) => x.platform_category_id === id); return <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{c ? c.path : `#${id}`}<button onClick={() => { setHiddenCats(hiddenCats.filter((x) => x !== id)); setHiddenDirty(true) }} className="text-gray-400 hover:text-red-600">×</button></span> })}</div>}
          {hiddenCats.length > 0 && !cats && <p className="text-xs text-gray-500 mt-2">{hiddenCats.length} kategori gizli.</p>}
          {!cats ? <button onClick={loadCats} className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800">Kategori listesini aç</button> : (
            <div className="mt-2">
              <input className={clsx(inputCls, 'w-full max-w-md')} placeholder="Kategori ara…" value={catQ} onChange={(e) => setCatQ(e.target.value)} />
              <div className="mt-2 max-h-64 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                {cats.filter((c) => !catQ || c.path.toLowerCase().includes(catQ.toLowerCase())).map((c) => { const on = hiddenCats.includes(c.platform_category_id); return (
                  <label key={c.platform_category_id} className={clsx('flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-gray-50', on && 'bg-amber-50')}>
                    <input type="checkbox" checked={on} onChange={() => { setHiddenCats(on ? hiddenCats.filter((x) => x !== c.platform_category_id) : [...hiddenCats, c.platform_category_id]); setHiddenDirty(true) }} />
                    <span style={{ paddingLeft: Math.max(0, c.depth - 1) * 12 }} className="text-gray-800">{c.name}</span>
                    <span className="text-gray-400 truncate">{c.path}</span>
                    <span className="ml-auto text-gray-400 tabular-nums">{c.product_count}</span>
                  </label>) })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-gray-800">Segmente göre beden aralığı</div>
              <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">Kategori adresindeki kelimeye göre beden başlığında yalnız bu aralıktaki <b>sayısal</b> bedenler listelenir. Böylece 27–43 arası tek üründe satılan bir model erkek sayfasında 27 numarayı göstermez. Sıra önemlidir: ilk eşleşen satır kazanır (çocuk satırı üstte kalmalı ki "erkek-cocuk" adresi erkek sayılmasın). Harf bedenler (S/M/L) ve yaş grupları etkilenmez; eşleşmeyen kategoriler (unisex, aksesuar) sınırlanmaz.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setSizeRanges([...sizeRanges, { label: '', tokens: '', min: 0, max: 0 }]); setSizeDirty(true) }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><Plus size={13} /> Satır ekle</button>
              <button onClick={() => patch('rules', { rules: { size_ranges: sizeRanges.filter((r) => r.label.trim() && r.tokens.trim() && r.max > 0).map((r) => ({ ...r, key: r.key || r.label.toLowerCase().replace(/[^a-z0-9]+/g, '') })) } }).then(() => setSizeDirty(false))} disabled={!sizeDirty || saving === 'rules'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'rules' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Aralıkları kaydet</button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {sizeRanges.length === 0 && <p className="text-xs text-gray-400">Aralık yok — tüm bedenler listelenir.</p>}
            {sizeRanges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col"><button onClick={() => { if (i === 0) return; const n = [...sizeRanges]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setSizeRanges(n); setSizeDirty(true) }} disabled={i === 0} className="text-gray-300 hover:text-gray-700 disabled:opacity-30"><ChevronUp size={13} /></button><button onClick={() => { if (i === sizeRanges.length - 1) return; const n = [...sizeRanges]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setSizeRanges(n); setSizeDirty(true) }} disabled={i === sizeRanges.length - 1} className="text-gray-300 hover:text-gray-700 disabled:opacity-30"><ChevronDown size={13} /></button></div>
                <input className={clsx(inputCls, 'w-28')} placeholder="Etiket (Erkek)" value={r.label} onChange={(e) => { const n = [...sizeRanges]; n[i] = { ...r, label: e.target.value }; setSizeRanges(n); setSizeDirty(true) }} />
                <input className={clsx(inputCls, 'flex-1 min-w-[180px]')} placeholder="Adres kelimeleri, virgülle (erkek, men)" value={r.tokens} onChange={(e) => { const n = [...sizeRanges]; n[i] = { ...r, tokens: e.target.value }; setSizeRanges(n); setSizeDirty(true) }} />
                <input type="number" min={0} max={99} className={clsx(inputCls, 'w-20')} placeholder="min" value={r.min} onChange={(e) => { const n = [...sizeRanges]; n[i] = { ...r, min: Number(e.target.value) }; setSizeRanges(n); setSizeDirty(true) }} />
                <span className="text-xs text-gray-400">–</span>
                <input type="number" min={0} max={99} className={clsx(inputCls, 'w-20')} placeholder="max" value={r.max} onChange={(e) => { const n = [...sizeRanges]; n[i] = { ...r, max: Number(e.target.value) }; setSizeRanges(n); setSizeDirty(true) }} />
                <button onClick={() => { setSizeRanges(sizeRanges.filter((_, j) => j !== i)); setSizeDirty(true) }} className="text-gray-300 hover:text-red-600" title="Satırı sil"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
        <button onClick={() => setAdvOpen(!advOpen)} className="mt-4 text-xs font-semibold text-gray-500 hover:text-gray-800">{advOpen ? 'Gelişmiş ayarları gizle' : 'Gelişmiş: tema seçicileri'}</button>
        {advOpen && (
          <div className="mt-2 grid md:grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-gray-600">Gizlenecek tema blokları (CSS seçici, virgülle)</label><textarea rows={2} className={clsx(inputCls, 'w-full mt-1')} value={selectors.hide} onChange={(e) => setSelectors({ ...selectors, hide: e.target.value })} /></div>
            <div><label className="text-xs font-semibold text-gray-600">Yerleşim noktası (before:/after:/into: + seçici)</label><input className={clsx(inputCls, 'w-full mt-1')} value={selectors.mount} onChange={(e) => setSelectors({ ...selectors, mount: e.target.value })} />
              <label className="text-xs font-semibold text-gray-600 block mt-2">Mağaza listesi modunda gizlenecek / panel yeri</label>
              <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={selectors.hide_native ?? ''} onChange={(e) => setSelectors({ ...selectors, hide_native: e.target.value })} placeholder=".filterBlock, .mobilFilterOpenBtn, .brandlistselection, .Uadet, .katlink" /><input className={clsx(inputCls, 'flex-1')} value={selectors.mount_native ?? ''} onChange={(e) => setSelectors({ ...selectors, mount_native: e.target.value })} placeholder="after:.filterBlock" /></div>
              <label className="text-xs font-semibold text-gray-600 block mt-2">Mağaza listesi modunda tema düzeltme CSS'i</label>
              <textarea rows={2} className={clsx(inputCls, 'w-full mt-1 font-mono text-[11px]')} value={selectors.css_native ?? ''} onChange={(e) => setSelectors({ ...selectors, css_native: e.target.value })} placeholder=".katcontent{margin-bottom:24px!important}" />
              <p className="text-[11px] text-gray-400 mt-1">Gizlenen tema sıralama/sayaç çubuğunun bıraktığı boşluk gibi küçük düzeltmeler; yalnız kategori sayfasında, widget kurulduğunda uygulanır.</p>
              <button onClick={() => patch('selectors', { selectors })} className="mt-2 px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs font-semibold">Seçicileri kaydet</button></div>
          </div>
        )}
      </Section>

      {/* 6 Analitik */}
      <Section step="7" title="Kullanım analitiği" desc="Filtre kullanan ziyaretçi ürün tıklıyor mu, hangi başlıklar işe yarıyor. Veri widget mağazaya kurulunca birikir."
        right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((r) => <button key={r} onClick={() => setRange(r)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === r ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{r} gün</button>)}</div>}>
        {!an || an.sessions === 0 ? (
          <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Demo sayfasındaki kullanım test olarak işaretlenir ve burada sayılmaz.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['Kategori oturumu', an.sessions.toLocaleString('tr-TR')], ['Filtre kullanımı', `%${an.filter_usage_rate}`], ['Tıklama (filtreli)', `%${an.click_rate_with_filter}`], ['Tıklama (filtresiz)', `%${an.click_rate_without_filter}`]].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p></div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs font-semibold text-gray-500 mb-1">En çok kullanılan başlıklar</p><ul className="divide-y divide-gray-50">{an.top_facets.map((f) => <li key={f.facet} className="py-1.5 flex justify-between"><span>{facets.find((x) => x.key === f.facet)?.label ?? f.facet}</span><span className="text-gray-500">{f.c} seçim · {f.s} oturum</span></li>)}</ul></div>
              <div><p className="text-xs font-semibold text-gray-500 mb-1">En çok seçilen değerler</p><ul className="divide-y divide-gray-50">{an.top_values.slice(0, 12).map((v, i) => <li key={i} className="py-1.5 flex justify-between"><span>{facets.find((x) => x.key === v.facet)?.label ?? v.facet}: <b>{v.value}</b></span><span className="text-gray-500">{v.c}</span></li>)}</ul></div>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
