import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ghost, Loader2, Check, Copy, BarChart3, Smartphone, ExternalLink, Search, Trash2, Plus, ArrowUp, ArrowDown, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { notFoundApi, type NotFoundSettings, type NotFoundAnalytics, type NotFoundTemplate, type NotFoundContent, type NotFoundRules, type NotFoundProduct } from '@/lib/croApi'

/* 404 Sayfası (CRO) — mağazanın "sayfa bulunamadı" ekranını eğlenceli bir şablon + gerçek ürün önerisiyle değiştirir.
   Firma galeriden bir şablon SEÇER, seçilen şablon hemen canlıdır (tek aktif şablon). Kırık adresteki kelimeler/ürün kodu
   Akıllı Arama'da aranır → "Bunu mu arıyordunuz?"; altında çok satan / yeni / elle seçilen ürünler. */

const TPL: Record<NotFoundTemplate, { name: string; desc: string; title: string; sub: string; accent: string; bg: string }> = {
  lost_pair: { name: 'Teki Kayıp', desc: 'Etrafına bakınan sevimli ayakkabı, çiftini arıyor. Ayakkabı/çorap mağazaları için birebir.', title: 'Bu sayfanın teki kayıp!', sub: 'Aradığın sayfa çiftini bulamadı. Ama üzülme, aşağıdakilerin hepsi çift çift duruyor 👟', accent: '#ea580c', bg: '#fff7ed' },
  space: { name: 'Uzayda Kaybolduk', desc: 'Süzülen astronot, 404 gezegeni, yıldızlı koyu tema.', title: 'Houston, bir sorunumuz var!', sub: 'Bu sayfa uzay boşluğuna sürüklendi. Seni dünyaya en sevilen ürünlerle geri getirelim 🚀', accent: '#a78bfa', bg: '#0b1026' },
  balloons: { name: 'Balon Patlat', desc: 'Mini oyun: 4-0-4 balonlarını patlat, her birinden gerçek bir ürün çıkar. Kupon varsa sonunda açılır.', title: 'Sayfa uçtu, balonlar kaldı!', sub: 'Balonları patlat, içinden ne çıkacak gör 🎈', accent: '#ec4899', bg: '#eff6ff' },
  detective: { name: 'Dedektif', desc: 'Vaka dosyası + iz süren büyüteç, daktilo metni. "Bunu mu arıyordunuz?" ile en iyi uyum.', title: 'Vaka #404: Kayıp Sayfa', sub: 'Dedektiflerimiz iz sürdü. Sayfa ortada yok ama ipuçları bizi şuraya götürdü…', accent: '#b45309', bg: '#fbf5e6' },
  arcade: { name: 'Retro Arcade', desc: 'Piksel yazı, CRT çizgileri ve oynanabilir mini oyun: ayakkabı 404 bloklarının üstünden zıplar.', title: 'GAME OVER', sub: 'Bu seviye bulunamadı. Bir tur oyna ya da yeni bir göreve başla ▶', accent: '#22d3ee', bg: '#0a0a12' },
  minimal: { name: 'Sade & Şık', desc: 'Markalı, sakin, animasyonu zarif. Premium/marka odaklı mağazalar için.', title: 'Aradığınız sayfa bulunamadı', sub: 'Bağlantı değişmiş ya da kaldırılmış olabilir. Sizin için seçtiklerimize göz atın.', accent: '#111827', bg: '#ffffff' },
}
const ORDER: NotFoundTemplate[] = ['lost_pair', 'space', 'balloons', 'detective', 'arcade', 'minimal']
const TARGET_LABEL: Record<string, string> = { matched: '"Bunu mu arıyordunuz?" ürünü', product: 'Öneri ürünü', category: 'Kategori kısayolu', home: 'Ana sayfa', logo: 'Logo' }

function PhoneFrame({ src, title, height = 640 }: { src: string; title: string; height?: number }) {
  const [scale, setScale] = useState(0.5)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} loading="lazy" className="border-0 pointer-events-auto" style={{ width: 390, height: height / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}
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
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="inline-flex flex-wrap rounded-full bg-[var(--app-bg)] p-0.5">{options.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', value === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{l}</button>)}</div>
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="text-xs font-semibold text-gray-600">{label}</span><div className="mt-1">{children}</div>{hint && <span className="text-[11px] text-gray-400 mt-1 block">{hint}</span>}</label>
}
const inputCls = 'w-full rounded-xl bg-[var(--app-bg)] border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-strong)]/30 focus:bg-white'
const money = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL'

function ProductPicker({ onPick, exclude }: { onPick: (p: NotFoundProduct) => void; exclude: number[] }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<NotFoundProduct[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { const h = setTimeout(() => { setBusy(true); notFoundApi.products(q).then(setItems).catch(() => setItems([])).finally(() => setBusy(false)) }, 250); return () => clearTimeout(h) }, [q])
  return (
    <div className="rounded-xl border border-gray-100 p-3 bg-[var(--app-bg)]">
      <div className="flex items-center gap-2"><Search size={14} className="text-gray-400" /><input autoFocus className={clsx(inputCls, 'flex-1 bg-white')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün adı veya stok kodu" />{busy && <Loader2 size={14} className="animate-spin text-gray-400" />}</div>
      <div className="mt-2 max-h-64 overflow-auto divide-y divide-gray-100 bg-white rounded-lg">
        {items.filter((p) => !exclude.includes(p.id)).map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p)} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-3">
            {p.img ? <img src={p.img} alt="" className="w-9 h-12 object-cover rounded" /> : <span className="w-9 h-12 rounded bg-gray-100" />}
            <span className="min-w-0 flex-1"><span className="text-sm font-medium text-gray-800 line-clamp-1">{p.name}</span><span className="text-[11px] text-gray-500">{money(p.dprice ?? p.price)}</span></span>
            <Plus size={14} className="text-indigo-600 shrink-0" />
          </button>
        ))}
        {!busy && items.length === 0 && <p className="text-xs text-gray-400 p-3">Sonuç yok</p>}
      </div>
    </div>
  )
}

export default function CroNotFoundPage() {
  const [st, setSt] = useState<NotFoundSettings | null>(null)
  const [content, setContent] = useState<NotFoundContent | null>(null)
  const [rules, setRules] = useState<NotFoundRules | null>(null)
  const [manual, setManual] = useState<NotFoundProduct[]>([])
  const [dirty, setDirty] = useState<'' | 'content' | 'rules'>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [an, setAn] = useState<NotFoundAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [picker, setPicker] = useState(false)
  const [adv, setAdv] = useState(false)
  const [pvContent, setPvContent] = useState<NotFoundContent | null>(null)
  const [pvPath, setPvPath] = useState('/kadin-siyah-bot-tbgzgn506-9999')
  useEffect(() => { const h = setTimeout(() => setPvContent(content), 700); return () => clearTimeout(h) }, [content])

  const apply = (d: NotFoundSettings) => { setSt(d); setContent(d.content); setRules(d.rules); setManual(d.manual_products); setDomains(d.domains); setDirty('') }
  const load = useCallback(() => {
    setLoading(true)
    notFoundApi.settings().then(apply).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { notFoundApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { apply(await notFoundApi.update(body)) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const editC = (p: Partial<NotFoundContent>) => { setContent((c) => (c ? { ...c, ...p } : c)); setDirty((d) => d || 'content') }
  const editR = (p: Partial<NotFoundRules>) => { setRules((r) => (r ? { ...r, ...p } : r)); setDirty((d) => d || 'rules') }
  const save = () => patch('save', { content, rules })

  const embed = useMemo(() => {
    if (!st || !rules) return ''
    const extra = (rules.detect_paths ? ` data-paths="${rules.detect_paths}"` : '') + (rules.detect_selectors ? ` data-selectors="${rules.detect_selectors}"` : '')
    return `<script src="${st.base_url}/widget/notfound.js?v=1" data-tenant="${st.slug}"${extra} async></script>`
  }, [st, rules])
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const demo = (tpl: string, c?: NotFoundContent | null) => st ? `/widget/notfound-demo.html?tenant=${st.slug}&tpl=${tpl}&path=${encodeURIComponent(pvPath)}${c ? '&content=' + encodeURIComponent(JSON.stringify(c)) : ''}` : '#'
  const galleryUrls = useMemo(() => Object.fromEntries(ORDER.map((t) => [t, st ? `/widget/notfound-demo.html?tenant=${st.slug}&tpl=${t}` : ''])), [st])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st || !content || !rules) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const active = TPL[st.template]
  const testUrl = (st.shop_url || 'https://magaza.com') + '/#yunbi404'
  const clicks = an?.clicks || {}
  const productClicks = (clicks.matched || 0) + (clicks.product || 0)

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Ghost size={24} /> 404 Sayfası
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">BETA</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">Silinen ürün, eski kampanya ya da hatalı link — ziyaretçi "sayfa bulunamadı" ekranında kaybolmasın. Eğlenceli bir şablon seçin; kırık adresteki kelimeler ve ürün kodu Akıllı Arama'da aranıp <b>"Bunu mu arıyordunuz?"</b> ürünleri, altında çok satanlar gösterilir. Hepsi mağazanın gerçek stoklu ürünleri.</p>
        </div>
        <a href={demo(st.template)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Smartphone size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      {/* 1 Şablon galerisi — seçilen şablon hemen aktif */}
      <Section step="1" title="Şablonu seçin" desc="Seçtiğiniz şablon anında canlıya çıkar (kaydet gerekmez). Önizlemeler mağazanızın gerçek ürünleriyle çizilir; balon ve arcade şablonlarında önizlemenin içinde oynayabilirsiniz.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ORDER.map((t) => {
            const on = st.template === t
            return (
              <div key={t} className={clsx('rounded-2xl border-2 overflow-hidden transition-all', on ? 'border-emerald-500 shadow-md' : 'border-gray-100 hover:border-gray-200')}>
                <div className="relative h-72 overflow-hidden" style={{ background: TPL[t].bg }}>
                  <PhoneFrame src={galleryUrls[t]} title={TPL[t].name} height={600} />
                  {on && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-[11px] font-bold rounded-full bg-emerald-500 text-white px-2 py-1 shadow"><Check size={12} /> Aktif</span>}
                </div>
                <div className="p-3 border-t border-gray-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-gray-900 flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: TPL[t].accent }} />{TPL[t].name}</span>
                    <a href={demo(t)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-700" title="Tam ekran aç"><ExternalLink size={14} /></a>
                  </div>
                  <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed min-h-[34px]">{TPL[t].desc}</p>
                  <button type="button" disabled={on || saving === 'tpl'} onClick={() => patch('tpl', { template: t })}
                    className={clsx('mt-2 w-full rounded-xl py-2 text-sm font-semibold', on ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60')}>
                    {on ? 'Kullanılıyor' : saving === 'tpl' ? 'Seçiliyor…' : 'Bu şablonu kullan'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          {/* 2 Kurulum */}
          <Section step="2" title="Kurulum" desc="Tek satır embed, tüm sayfalara. Script yalnız 404 ekranında çalışır (adres /PageNotFound.aspx, /404, başlık 'sayfa bulunamadı' ya da tarayıcının 404 kodu); diğer sayfalarda hiçbir istek atmaz.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="404 şablonu açık" hint="Kapalıyken mağazanın kendi 404 sayfası görünür." />
                <Field label="İzinli domainler (virgülle)">
                  <div className="flex gap-2"><input className={inputCls} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button type="button" onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div>
                </Field>
              </div>
              <div className="space-y-3">
                <Field label={'Tema embed kodu (tüm sayfalar, </body> öncesi)'}>
                  <div className="flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button type="button" onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div>
                </Field>
                <div className="rounded-xl bg-[var(--app-bg)] p-3 text-xs text-gray-600 leading-relaxed">
                  <b className="text-gray-800">Mağazada test:</b> herhangi bir adresin sonuna <code className="bg-white px-1 rounded">#yunbi404</code> ekleyin — örn. <a href={testUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">{testUrl}</a>. Domain izinli ve şablon açık olmalı.
                </div>
              </div>
            </div>
          </Section>

          {/* 3 İçerik */}
          <Section step="3" title="Metinler ve ürünler" desc="Boş bırakılan başlık/alt metin şablonun kendi esprili metnini kullanır. Önizleme sağda anında güncellenir; canlıya almak için Kaydet."
            right={dirty ? <div className="flex gap-2"><button type="button" onClick={() => apply(st)} className="px-3 py-1.5 rounded-full text-xs font-semibold text-gray-500 hover:bg-gray-100">Vazgeç</button><button type="button" onClick={save} disabled={saving === 'save'} className="px-4 py-1.5 rounded-full bg-gray-900 text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1">{saving === 'save' && <Loader2 size={12} className="animate-spin" />} Kaydet</button></div> : undefined}>
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Başlık"><input className={inputCls} value={content.title} maxLength={80} onChange={(e) => editC({ title: e.target.value })} placeholder={active.title} /></Field>
                <Field label="Vurgu rengi">
                  <div className="flex items-center gap-2">
                    <input type="color" value={content.accent || active.accent} onChange={(e) => editC({ accent: e.target.value })} className="w-10 h-9 rounded-lg border border-gray-200 bg-white" />
                    <span className="text-xs text-gray-500">{content.accent || `${active.accent} (şablon)`}</span>
                    {content.accent && <button type="button" onClick={() => editC({ accent: '' })} className="text-xs text-indigo-600 inline-flex items-center gap-1"><RotateCcw size={12} /> Şablon rengi</button>}
                  </div>
                </Field>
              </div>
              <Field label="Alt metin"><textarea className={clsx(inputCls, 'min-h-[60px]')} value={content.subtitle} maxLength={200} onChange={(e) => editC({ subtitle: e.target.value })} placeholder={active.sub} /></Field>

              <div className="grid md:grid-cols-2 gap-3">
                <Toggle on={content.show_search} onChange={(v) => editC({ show_search: v })} label="Arama kutusu" hint="Ziyaretçi aradığını yazsın (mağaza araması)." />
                <Toggle on={content.show_categories} onChange={(v) => editC({ show_categories: v })} label="Kategori kısayolları" hint={content.categories.length ? `${content.categories.length} elle seçilmiş kategori` : 'Otomatik: en çok ürünlü kategoriler'} />
              </div>

              <div className="rounded-xl border border-gray-100 p-3 space-y-3">
                <Toggle on={content.show_matched} onChange={(v) => editC({ show_matched: v })} label='"Bunu mu arıyordunuz?"' hint="Kırık adresteki kelimeler + ürün kodu Akıllı Arama'da aranır; silinen ürünün renk kardeşleri ve benzerleri gelir." />
                {content.show_matched && (
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="Bölüm başlığı"><input className={inputCls} value={content.matched_title} maxLength={60} onChange={(e) => editC({ matched_title: e.target.value })} /></Field>
                    <Field label="Önizleme için kırık adres" hint="Yalnız önizlemeyi etkiler"><input className={inputCls} value={pvPath} onChange={(e) => setPvPath(e.target.value)} /></Field>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-100 p-3 space-y-3">
                <Toggle on={content.show_products} onChange={(v) => editC({ show_products: v })} label="Öneri rafı" hint="Stoksuz ve görselsiz ürünler hiç gösterilmez." />
                {content.show_products && (<>
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="Raf başlığı"><input className={inputCls} value={content.products_title} maxLength={60} onChange={(e) => editC({ products_title: e.target.value })} /></Field>
                    <Field label="Ürün sayısı"><input type="number" min={2} max={16} className={inputCls} value={content.product_count} onChange={(e) => editC({ product_count: Number(e.target.value) })} /></Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Seg value={content.products_source} options={[['bestseller', 'Çok satanlar'], ['new', 'Yeni gelenler'], ['manual', 'Elle seçilen']]} onChange={(v) => editC({ products_source: v })} />
                    {content.products_source === 'bestseller' && <span className="text-xs text-gray-500 inline-flex items-center gap-2">Son <input type="number" min={1} max={90} className="w-16 rounded-lg bg-[var(--app-bg)] px-2 py-1 text-sm" value={content.products_days} onChange={(e) => editC({ products_days: Number(e.target.value) })} /> gün (ödenmiş siparişler)</span>}
                  </div>
                  {content.products_source === 'manual' && (
                    <div className="space-y-2">
                      {manual.map((p, i) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 p-2">
                          {p.img ? <img src={p.img} alt="" className="w-8 h-11 object-cover rounded" /> : <span className="w-8 h-11 rounded bg-gray-100" />}
                          <span className="flex-1 min-w-0 text-sm text-gray-800 line-clamp-1">{p.name}</span>
                          <button type="button" onClick={() => { const a = [...manual]; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; setManual(a); editC({ product_ids: a.map((x) => x.id) }) } }} className="p-1 text-gray-400 hover:text-gray-700"><ArrowUp size={14} /></button>
                          <button type="button" onClick={() => { const a = [...manual]; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; setManual(a); editC({ product_ids: a.map((x) => x.id) }) } }} className="p-1 text-gray-400 hover:text-gray-700"><ArrowDown size={14} /></button>
                          <button type="button" onClick={() => { const a = manual.filter((x) => x.id !== p.id); setManual(a); editC({ product_ids: a.map((x) => x.id) }) }} className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={14} /></button>
                        </div>
                      ))}
                      {picker ? <ProductPicker exclude={manual.map((m) => m.id)} onPick={(p) => { const a = [...manual, p]; setManual(a); editC({ product_ids: a.map((x) => x.id) }) }} />
                        : <button type="button" onClick={() => setPicker(true)} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600"><Plus size={14} /> Ürün ekle</button>}
                    </div>
                  )}
                </>)}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Kupon kodu (isteğe bağlı)" hint="Yalnız mağazada tanımlı GERÇEK bir kod yazın; boşsa kupon alanı çizilmez. Balon şablonunda oyun bitince açılır.">
                  <input className={inputCls} value={content.coupon_code} maxLength={40} onChange={(e) => editC({ coupon_code: e.target.value.toUpperCase() })} placeholder="ÖRN. KAYIP10" />
                </Field>
                <Field label="Kupon metni"><input className={inputCls} value={content.coupon_text} maxLength={120} onChange={(e) => editC({ coupon_text: e.target.value })} placeholder="Kaybolduğun için küçük bir hediye:" /></Field>
              </div>
              <Field label="Ana sayfa bağlantı metni"><input className={inputCls} value={content.home_text} maxLength={40} onChange={(e) => editC({ home_text: e.target.value })} /></Field>

              <button type="button" onClick={() => setAdv(!adv)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800">{adv ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Gelişmiş: yerleşim ve tespit</button>
              {adv && (
                <div className="space-y-3 rounded-xl bg-[var(--app-bg)] p-3">
                  <Field label="Yerleşim"><Seg value={rules.display} options={[['overlay', 'Tam ekran (önerilen)'], ['inline', 'Tema içerik alanına'], ['auto', 'Otomatik']]} onChange={(v) => editR({ display: v })} /></Field>
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="İçerik alanı seçicisi (inline)"><input className={clsx(inputCls, 'bg-white')} value={rules.mount_selector} onChange={(e) => editR({ mount_selector: e.target.value })} /></Field>
                    <Field label="Gizlenecek tema öğeleri"><input className={clsx(inputCls, 'bg-white')} value={rules.hide_selectors} onChange={(e) => editR({ hide_selectors: e.target.value })} placeholder=".notFoundBanner" /></Field>
                    <Field label="Arama adresi" hint="{q} aranan metinle değişir"><input className={clsx(inputCls, 'bg-white')} value={rules.search_url} onChange={(e) => editR({ search_url: e.target.value })} /></Field>
                    <Field label="Ek 404 adresleri (virgülle)" hint="Embed koduna data-paths olarak eklenir"><input className={clsx(inputCls, 'bg-white')} value={rules.detect_paths} onChange={(e) => editR({ detect_paths: e.target.value })} placeholder="/hata, /sayfa-yok" /></Field>
                    <Field label="Ek 404 seçicileri (virgülle)" hint="Embed koduna data-selectors olarak eklenir"><input className={clsx(inputCls, 'bg-white')} value={rules.detect_selectors} onChange={(e) => editR({ detect_selectors: e.target.value })} placeholder=".errorPage" /></Field>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* 4 Analitik */}
          <Section step="4" title="Analitik" desc="Kurtarılan oturum = 404'ü gördükten sonra bir ürüne/kategoriye tıklayan ya da arama yapan oturum. En çok kırılan adresleri mağaza panelinden doğru sayfaya yönlendirin (301)."
            right={<Seg value={String(range) as '7' | '30' | '90'} options={[['7', '7g'], ['30', '30g'], ['90', '90g']]} onChange={(v) => setRange(Number(v))} />}>
            {!an ? <p className="text-sm text-gray-400">Yükleniyor…</p> : an.views === 0 ? (
              <div className="rounded-xl bg-[var(--app-bg)] p-4 text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} /> Henüz 404 görüntülenmesi yok — embed eklendikten ve şablon açıldıktan sonra dolar.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[['404 görüntülenme', an.views.toLocaleString('tr-TR'), `${an.sessions.toLocaleString('tr-TR')} oturum`], ['Kurtarılan oturum', an.saved_sessions.toLocaleString('tr-TR'), an.saved_rate != null ? `%${an.saved_rate}` : '—'], ['Ürün tıklaması', productClicks.toLocaleString('tr-TR'), `${(clicks.matched || 0).toLocaleString('tr-TR')} "bunu mu arıyordunuz"`], ['Arama / oyun', `${an.searches} / ${an.games}`, an.coupons ? `${an.coupons} kupon kopyalandı` : 'kupon yok']].map(([l, v, s]) => (
                    <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><div className="text-[11px] font-semibold text-gray-500">{l}</div><div className="text-xl font-extrabold text-gray-900 mt-0.5">{v}</div><div className="text-[11px] text-gray-500">{s}</div></div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div><h3 className="text-xs font-bold text-gray-700 mb-2">Tıklama kırılımı</h3>
                    <div className="space-y-1">{Object.entries(clicks).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{TARGET_LABEL[k] || k}</span><b>{v}</b></div>)}</div></div>
                  <div><h3 className="text-xs font-bold text-gray-700 mb-2">En çok tıklanan ürünler</h3>
                    <div className="space-y-1">{an.top_products.map((p) => <div key={p.id} className="flex justify-between gap-3 text-sm"><span className="text-gray-600 truncate">{p.name}</span><b className="shrink-0">{p.clicks}</b></div>)}{!an.top_products.length && <p className="text-xs text-gray-400">—</p>}</div></div>
                </div>
                <div><h3 className="text-xs font-bold text-gray-700 mb-2">En çok kırılan adresler</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Adres</th><th className="py-1 pr-3">Görüntülenme</th><th className="py-1 pr-3">Son</th><th className="py-1">Geldiği yer</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.broken.map((b) => (
                      <tr key={b.p}><td className="py-1.5 pr-3 max-w-[280px] truncate font-mono text-[12px]"><a href={(st.shop_url || '') + b.p} target="_blank" rel="noreferrer" className="hover:underline">{b.p}</a></td><td className="py-1.5 pr-3 font-semibold">{b.c}</td><td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{new Date(b.last).toLocaleDateString('tr-TR')}</td><td className="py-1.5 text-gray-500 max-w-[200px] truncate">{b.ref || '—'}</td></tr>
                    ))}</tbody></table></div></div>
              </div>
            )}
          </Section>
        </div>

        {/* Sağ: canlı önizleme (kaydedilmemiş taslakla) */}
        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-gray-700">Önizleme · {active.name}</span><a href={demo(st.template, content)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-700"><ExternalLink size={14} /></a></div>
            <div className="rounded-[28px] border-[6px] border-gray-900 overflow-hidden h-[600px] bg-white">
              {pvContent && <PhoneFrame key={st.template + pvPath} src={demo(st.template, pvContent)} title="404 önizleme" height={600} />}
            </div>
            {dirty && <p className="text-[11px] text-amber-700 mt-2">Kaydedilmemiş değişiklikler önizlemede — canlıya almak için Kaydet.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
