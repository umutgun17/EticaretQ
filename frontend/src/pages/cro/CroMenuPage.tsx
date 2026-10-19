import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, ExternalLink, Loader2, Check, Copy, ChevronUp, ChevronDown, Plus, Trash2, RotateCcw, Save, BarChart3, Smartphone, RefreshCw, Pin, EyeOff, Eye, Image as ImageIcon } from 'lucide-react'
import clsx from 'clsx'
import { menuApi, type MenuSettings, type MenuVirtual, type MenuAnalytics, type MenuTile } from '@/lib/croApi'
import { Sparkles, Wand2 } from 'lucide-react'

/* Akıllı Menü (CRO) — görselli, dinamik (satış × sezon × kişi) mobil menü: tema galerisi, davranış kuralları,
   segment/kategori düzenleme (sabitle, gizle, etiket, görsel), sanal kategoriler, ürün satırı, analitik. */

const PRESET_META: Record<string, [string, string]> = {
  cards: ['Kartlar', 'Ürün görselli kare kartlar, 2 sütun. Slazenger deseni; en güvenli seçim.'],
  list: ['Görselli Liste', 'Küçük görselli satırlar, ürün sayısı sağda. Çok kategorili mağazalar.'],
  bento: ['Bento', 'Karışık boyutlu kartlar; en çok satan geniş, diğerleri küçük.'],
  story: ['Hikâye', 'Yuvarlak görseller 4 sütun (Trendyol deseni). Hızlı tarama.'],
  mono: ['Mono', 'Siyah-beyaz, keskin köşe, büyük harf. Minimal moda markaları.'],
  dark: ['Koyu', 'Koyu zemin, açık kartlar. Koyu temalı siteler.'],
}
const ICON_OPTS = ['fire', 'sparkles', 'percent', 'tag', 'truck', 'gift', 'star', 'clock', 'snow', 'sun', 'heart', 'bag']
const VIRT_PRESETS: [string, MenuVirtual][] = [
  ['Çok Satanlar', { key: 'bestsellers', label: 'Çok Satanlar', url: '{seg}?sira=satis-adedi|azalan', style: 'chip', icon: 'fire', emoji: '🔥', look: 'solid', color: '#e11d48', enabled: true }],
  ['Yeni Gelenler', { key: 'new', label: 'Yeni Gelenler', url: '{seg}?sira=eklenme-tarihi|azalan', style: 'chip', icon: 'sparkles', enabled: true }],
  ['İndirimliler', { key: 'discount', label: 'İndirimliler', url: '{seg}?indirimli=1', style: 'chip', icon: 'percent', enabled: true }],
  ['En Beğenilenler', { key: 'rated', label: 'En Beğenilenler', url: '{seg}?sira=urun-puani|azalan', style: 'chip', icon: 'star', enabled: true }],
  ['Otomatik fiyat bandı', { key: 'price', label: '{min}–{max} TL', url: '{seg}?min={min}&max={max}', style: 'chip', icon: 'tag', emoji: '🏷️', look: 'gradient', color: '#d97706', auto_price: true, enabled: true }],
  ['Sabit fiyat aralığı', { key: 'price_fixed', label: '299–399 TL', url: '{seg}?min=299&max=399', style: 'chip', icon: 'tag', emoji: '🏷️', look: 'solid', enabled: true }],
  ['Kampanya kartı', { key: 'campaign', label: 'Kampanya', url: '/firsat-urunleri', style: 'card', icon: 'gift', note: 'Seçili ürünlerde', enabled: true }],
]

function PhoneFrame({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(0.4)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} loading="lazy" className="border-0 pointer-events-none" style={{ width: 390, height: 360 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

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
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap rounded-full bg-[var(--app-bg)] p-0.5">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', value === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{l}</button>)}</div>
}

export default function CroMenuPage() {
  const [st, setSt] = useState<MenuSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [hidePaths, setHidePaths] = useState('')
  const [virtual, setVirtual] = useState<MenuVirtual[]>([])
  const [vDirty, setVDirty] = useState(false)
  const [ov, setOv] = useState<MenuSettings['overrides'] | null>(null)
  const [oDirty, setODirty] = useState(false)
  const [openSeg, setOpenSeg] = useState<string>('')
  const [an, setAn] = useState<MenuAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickOne, setPickOne] = useState<string | null>(null)
  const [openPick, setOpenPick] = useState<string>('')

  const apply = (d: MenuSettings) => { setSt(d); setDomains(d.domains); setHidePaths(d.rules.hide_paths || ''); setVirtual(d.virtual); setOv(d.overrides); setVDirty(false); setODirty(false); if (!openSeg && d.data.segments[0]) setOpenSeg(d.data.segments[0].url) }
  const load = useCallback(() => { setLoading(true); menuApi.settings().then(apply).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(() => { menuApi.analytics(range).then(setAn).catch(() => null) }, [range])
  useEffect(() => { if (!st?.picking && !picking) return; const t = setInterval(() => { menuApi.settings().then((d) => { if (!d.picking) { setPicking(false); apply(d); setPreviewKey((k) => k + 1) } }).catch(() => null) }, 4000); return () => clearInterval(t) }, [st?.picking, picking]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await menuApi.update(body); apply(d); setPreviewKey((k) => k + 1); return d }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi'); return null }
    finally { setSaving(null) }
  }
  const refresh = async () => { setRefreshing(true); try { await menuApi.refresh(); const d = await menuApi.settings(); apply(d); setPreviewKey((k) => k + 1) } catch { setError('Yenilenemedi') } finally { setRefreshing(false) } }
  const embed = st ? `<script src="${st.base_url}/widget/menu.js?v=11" data-tenant="${st.slug}"></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const demoUrl = (preset?: string, gallery = false) => st ? `/widget/menu-demo.html?tenant=${st.slug}${gallery ? '&gallery=1' : ''}${preset ? `&preset=${preset}` : ''}` : '#'
  const previewUrl = (preset: string) => st ? `/widget/menu-demo.html?tenant=${st.slug}&preset=${preset}&theme=${encodeURIComponent(JSON.stringify({ ...st.theme, preset }))}&k=${previewKey}` : ''

  /* sanal kategoriler */
  const vMove = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= virtual.length) return; const n = [...virtual]; const t = n[i]; n[i] = n[j]; n[j] = t; setVirtual(n); setVDirty(true) }
  const vSet = (i: number, p: Partial<MenuVirtual>) => { setVirtual(virtual.map((v, k) => (k === i ? { ...v, ...p } : v))); setVDirty(true) }
  const vAdd = (v: MenuVirtual) => { if (virtual.length >= 12) return; setVirtual([...virtual, { ...v, key: v.key + (virtual.some((x) => x.key === v.key) ? virtual.length : '') }]); setVDirty(true) }
  const vRemove = (i: number) => { setVirtual(virtual.filter((_, k) => k !== i)); setVDirty(true) }

  /* kategori/segment düzenleme (overrides) */
  const segVisible = useMemo(() => st?.data.segments.find((s) => s.url === openSeg) ?? st?.data.segments[0], [st, openSeg])
  const toggleList = (key: 'pinned' | 'hidden' | 'segments_hidden', url: string) => { if (!ov) return; const l = ov[key] ?? []; const n = l.includes(url) ? l.filter((u) => u !== url) : [...l, url]; setOv({ ...ov, [key]: n }); setODirty(true) }
  const setLabel = (url: string, v: string) => { if (!ov) return; setOv({ ...ov, labels: { ...ov.labels, [url]: v } }); setODirty(true) }
  const setImage = (url: string, v: string) => { if (!ov) return; setOv({ ...ov, images: { ...ov.images, [url]: v } }); setODirty(true) }
  const segMove = (i: number, d: -1 | 1) => { if (!ov || !st) return; const order = (ov.segments_order?.length ? ov.segments_order : st.data.all_roots.map((r) => r.url)); const j = i + d; if (j < 0 || j >= order.length) return; const n = [...order]; const t = n[i]; n[i] = n[j]; n[j] = t; setOv({ ...ov, segments_order: n }); setODirty(true) }
  const rootsOrdered = useMemo(() => { if (!st || !ov) return []; const order = ov.segments_order?.length ? ov.segments_order : []; return [...st.data.all_roots].sort((a, b) => (order.indexOf(a.url) < 0 ? 999 : order.indexOf(a.url)) - (order.indexOf(b.url) < 0 ? 999 : order.indexOf(b.url))) }, [st, ov])
  const tileOrderForSeg = (segUrl: string, tiles: MenuTile[]) => { const o = ov?.order?.[segUrl]; if (!o?.length) return tiles; return [...tiles].sort((a, b) => (o.indexOf(a.url) < 0 ? 999 : o.indexOf(a.url)) - (o.indexOf(b.url) < 0 ? 999 : o.indexOf(b.url))) }
  const tileMove = (segUrl: string, tiles: MenuTile[], i: number, d: -1 | 1) => { if (!ov) return; const cur = tileOrderForSeg(segUrl, tiles).map((t) => t.url); const j = i + d; if (j < 0 || j >= cur.length) return; const t = cur[i]; cur[i] = cur[j]; cur[j] = t; setOv({ ...ov, order: { ...ov.order, [segUrl]: cur } }); setODirty(true) }
  const saveOverrides = () => { if (!ov) return; patch('overrides', { overrides: ov }) }
  const pickAll = async () => { setPicking(true); try { await menuApi.pickImages() } catch { setPicking(false); setError('Kapak seçici başlatılamadı') } }
  const pickCategory = async (path: string) => { setPickOne(path); try { await menuApi.pickImages(path); const d = await menuApi.settings(); apply(d); setOpenPick(path); setPreviewKey((k) => k + 1) } catch { setError('Kapak seçilemedi') } finally { setPickOne(null) } }
  const chooseCover = (url: string, image: string | null) => { if (!ov) return; const n = { ...ov, images: { ...ov.images } }; if (image) n.images[url] = image; else delete n.images[url]; setOv(n); patch('overrides', { overrides: n }) }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st || !ov) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const r = st.rules, th = st.theme

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><LayoutGrid size={24} /> Akıllı Menü
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Mobil menüyü ürün görselli kartlara çevirir; sıra satış hızı, sezon eğrisi ve ziyaretçinin gezdiği kategorilere göre değişir. Sanal kategoriler ve popüler/kişisel ürün satırı menünün içinde.</p>
        </div>
        <div className="flex gap-2">
          <a href={demoUrl(undefined)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 hover:bg-gray-50 text-sm font-semibold rounded-full"><ExternalLink size={15} /> Canlı önizleme</a>
          <a href={demoUrl(undefined, true)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Smartphone size={15} /> Tema galerisi</a>
        </div>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      {/* 1 Kurulum */}
      <Section step="1" title="Kurulum" desc={st.bottombar_enabled ? 'Aşağıdaki tek satırı temanın tüm sayfalarına ekle (Mobil Alt Bar scriptinden ayrı yüklenir). Alt bar gömülü olduğu için Kategoriler sekmesi de bu menüyü açar.' : 'Aşağıdaki tek satırı temanın tüm sayfalarına ekle; menü panelden açıldığında devreye girer.'}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Menü açık" hint={st.enabled ? 'Mağazada hamburger ve alt bar Kategoriler bu menüyü açıyor.' : 'Kapalıyken mağazadaki script hiçbir şey yapmaz; tema menüsü çalışır.'} />
            <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
              <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="magaza.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
          </div>
          <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu ({'</body>'} öncesi; Alt Bar gömülüyse gerekmez)</label>
            <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div>
            <p className="text-[11px] text-gray-400 mt-2">Veri: {st.data.segments.length} segment · {st.data.segments.reduce((a, s) => a + s.tiles.filter((t) => !t.small).length, 0)} kategori kartı · görseller stoklu en çok satan üründen · {new Date(st.data.generated_at).toLocaleString('tr-TR')}</p>
          </div>
        </div>
      </Section>

      {/* 2 Tema */}
      <Section step="2" title="Tema" desc="Her telefon canlı widget'tır: sekmelere ve kartlara dokunabilirsin. Tıkladığın tema anında kaydedilir. Görseller ve sayılar mağazanın gerçek verisi.">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {st.presets.map((key) => (
            <div key={key} onClick={() => patch('theme', { theme: { preset: key } })} role="button" tabIndex={0} className={clsx('cursor-pointer rounded-2xl border-2 p-2 transition', th.preset === key ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200 hover:border-indigo-300')}>
              <div className="rounded-xl overflow-hidden bg-gray-900 p-1"><div className="rounded-lg overflow-hidden bg-white relative" style={{ height: 360 }}><PhoneFrame src={previewUrl(key)} title={key} /></div></div>
              <div className="flex items-center gap-1.5 mt-2"><span className={clsx('w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center', th.preset === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')}>{th.preset === key && <Check size={9} className="text-white" strokeWidth={4} />}</span><span className="text-xs font-semibold text-gray-800">{PRESET_META[key]?.[0] ?? key}</span>
                <a href={demoUrl(key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-gray-400 hover:text-indigo-600"><ExternalLink size={12} /></a></div>
              <p className="text-[10.5px] text-gray-400 mt-0.5 leading-snug">{PRESET_META[key]?.[1]}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          {([['accent', 'Vurgu (aktif sekme, rozet)'], ['bg', 'Panel zemini'], ['ink', 'Metin'], ['tile_bg', 'Kart zemini']] as const).map(([k, l]) => (
            <div key={k}><label className="text-xs font-semibold text-gray-600 block mb-1">{l}</label><div className="flex items-center gap-2"><input type="color" value={th[k]} onChange={(e) => patch('theme', { theme: { [k]: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{th[k]}</code></div></div>
          ))}
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe</label><select className={inputCls} value={th.radius} onChange={(e) => patch('theme', { theme: { radius: Number(e.target.value) } })}>{[0, 6, 10, 14, 18, 24].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Etiket</label><Seg value={th.label_case} options={[['normal', 'Normal'], ['upper', 'BÜYÜK HARF']]} onChange={(v) => patch('theme', { theme: { label_case: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sütun</label><Seg value={String(th.columns)} options={[['2', '2'], ['3', '3']]} onChange={(v) => patch('theme', { theme: { columns: Number(v) } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Görsel</label><Seg value={th.image_fit} options={[['cover', 'Doldur'], ['contain', 'Sığdır']]} onChange={(v) => patch('theme', { theme: { image_fit: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Genişlik</label><Seg value={th.full_width ? 'full' : 'panel'} options={[['panel', 'Panel (430px)'], ['full', 'Tam ekran']]} onChange={(v) => patch('theme', { theme: { full_width: v === 'full' } })} /></div>
          <div className="min-w-[260px] flex-1"><label className="text-xs font-semibold text-gray-600 block mb-1">Logo URL <span className="font-normal text-gray-400">(boş = temanın header logosu otomatik alınır)</span></label><input className={inputCls + ' w-full'} placeholder="https://…/logo.png" value={th.logo_url || ''} onChange={(e) => patch('theme', { theme: { logo_url: e.target.value } })} /></div>
        </div>
      </Section>

      {/* 3 Bağlantı ve akıllı sıra */}
      <Section step="3" title="Bağlantı ve akıllı sıra" desc="Menü nereden açılır, kartlar neye göre dizilir. Anahtarlar tıklandığı anda kaydedilir.">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Menüyü açan</label><Seg value={r.mount} options={[['both', 'Hamburger + Alt bar'], ['hamburger', 'Yalnız hamburger'], ['bottombar', 'Yalnız alt bar']]} onChange={(v) => patch('rules', { rules: { mount: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">İlk sekme</label><Seg value={r.default_tab} options={[['remember', 'Son gezdiği segment'], ['sales', 'En çok satan'], ['catalog', 'Katalog sırası']]} onChange={(v) => patch('rules', { rules: { default_tab: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kart sırası</label><Seg value={r.sort} options={[['sales_30d', 'Satış (30 gün)'], ['sales_7d', 'Satış (7 gün)'], ['catalog', 'Katalog / elle']]} onChange={(v) => patch('rules', { rules: { sort: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Mobil eşiği</label><select className={inputCls} value={r.max_width} onChange={(e) => patch('rules', { rules: { max_width: Number(e.target.value) } })}>{[640, 768, 899, 1024, 1400].map((n) => <option key={n} value={n}>≤ {n}px</option>)}</select></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Toggle on={r.season_boost} onChange={(v) => patch('rules', { rules: { season_boost: v } })} label="Sezon motoru" hint="Geçen yılın satış eğrisine göre yükselen kategori öne çıkar, 'Sezon ↑' rozeti alır (Eylül'de bot, Mayıs'ta sandalet)." />
          <Toggle on={r.personalize} onChange={(v) => patch('rules', { rules: { personalize: v } })} label="Kişiye göre sıra" hint="Cihazda gezilen kategoriler öne alınır; ilk sekme son gezilen segment; 'Son baktığın' rozeti. Veri cihazda kalır." />
          <Toggle on={r.show_recent} onChange={(v) => patch('rules', { rules: { show_recent: v } })} label="'Kaldığın yer' satırı" hint="Menünün üstünde son gezilen kategoriler (dönen ziyaretçi için tek dokunuş)." />
          <Toggle on={r.badges} onChange={(v) => patch('rules', { rules: { badges: v } })} label="Rozetler" hint="Çok satan / Sezon ↑ / Son baktığın. Sahte aciliyet yok; hepsi gerçek veriden." />
          <Toggle on={r.show_counts} onChange={(v) => patch('rules', { rules: { show_counts: v } })} label="Ürün sayısı" hint="Kartta '540 ürün'." />
          <Toggle on={r.group_headers} onChange={(v) => patch('rules', { rules: { group_headers: v } })} label="Ara başlıklar" hint="Ayakkabı / Sandalet & Terlik gibi üst kategori başlıkları (satış sırası yerine katalog gruplaması)." />
          <Toggle on={r.show_search} onChange={(v) => patch('rules', { rules: { show_search: v } })} label="Arama kutusu" hint="Menünün üstünde; Akıllı Arama'yı açar." />
          <Toggle on={r.show_all_link} onChange={(v) => patch('rules', { rules: { show_all_link: v } })} label="'Tüm Kadın ürünleri →' bağlantısı" />
          <Toggle on={r.footer_links} onChange={(v) => patch('rules', { rules: { footer_links: v } })} label="Alt bağlantılar" hint="Hesabım / Favorilerim / Sepetim." />
          <Toggle on={!!r.nav_promo} onChange={(v) => patch('rules', { rules: { nav_promo: v } })} label="Masaüstü menüde kampanyaları vurgula" hint="'Üst bant' kampanyaları sitenin kendi üst menüsünde de aynı renk ve rozetle parlar (Ticimax)." />
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Segment sayısı</label><select className={inputCls} value={r.segments_max} onChange={(e) => patch('rules', { rules: { segments_max: Number(e.target.value) } })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Segment başına kart</label><select className={inputCls} value={r.max_tiles} onChange={(e) => patch('rules', { rules: { max_tiles: Number(e.target.value) } })}>{[0, 8, 12, 16, 24, 40].map((n) => <option key={n} value={n}>{n === 0 ? 'Hepsi (kaydırarak)' : `${n} (gerisi "daha fazla")`}</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Az ürünlü kategoriyi gizle</label><select className={inputCls} value={r.hide_min_products} onChange={(e) => patch('rules', { rules: { hide_min_products: Number(e.target.value) } })}>{[0, 1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n === 0 ? 'Gizleme' : `< ${n} ürün`}</option>)}</select></div>
          <div className="flex-1 min-w-[260px]"><label className="text-xs font-semibold text-gray-600 block mb-1">Menünün devreye girmeyeceği yollar (virgülle)</label>
            <div className="flex gap-2"><input className={clsx(inputCls, 'flex-1')} value={hidePaths} onChange={(e) => setHidePaths(e.target.value)} placeholder="/checkout, /Hesabim" /><button onClick={() => patch('rules', { rules: { hide_paths: hidePaths } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div></div>
        </div>
      </Section>

      {/* 4 Segmentler ve kategoriler */}
      <Section step="4" title="Segmentler ve kategori kartları" desc="Kapak görselleri Akıllı Sıralama'nın üst ürünleri arasından görsel puanıyla seçilir (temiz zemin, ürün kadraja oturmuş, ortalanmış); her gece 05:10'da yenilenir. Kapağa tıklayıp adaylardan elle seçebilir, kartı sabitleyebilir, gizleyebilir, etiketini değiştirebilirsin."
        right={<div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Veriyi tazele</button>
          <button onClick={pickAll} disabled={picking || st.picking} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-indigo-200 text-indigo-700 text-xs font-semibold disabled:opacity-50">{picking || st.picking ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {picking || st.picking ? 'Kapaklar seçiliyor…' : 'Kapakları yeniden seç'}</button>
          <button onClick={saveOverrides} disabled={!oDirty || saving === 'overrides'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'overrides' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Düzenlemeleri kaydet</button>
        </div>}>
        <div className="flex flex-wrap gap-2 mb-4">
          {rootsOrdered.map((root, i) => { const hidden = ov.segments_hidden.includes(root.url); const shown = st.data.segments.some((s) => s.url === root.url); return (
            <div key={root.url} className={clsx('flex items-center gap-1 rounded-full border px-2 py-1', shown && !hidden ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 opacity-70')}>
              <button onClick={() => segMove(i, -1)} className="text-gray-400 hover:text-gray-800"><ChevronUp size={13} /></button><button onClick={() => segMove(i, 1)} className="text-gray-400 hover:text-gray-800"><ChevronDown size={13} /></button>
              <button onClick={() => setOpenSeg(root.url)} className={clsx('text-xs font-semibold px-1', openSeg === root.url ? 'text-indigo-700' : 'text-gray-700')}>{root.name} <span className="text-gray-400 font-normal">({root.count})</span></button>
              <button onClick={() => toggleList('segments_hidden', root.url)} title={hidden ? 'Göster' : 'Gizle'} className="text-gray-400 hover:text-rose-600">{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </div>) })}
          <span className="text-[11px] text-gray-400 self-center">İlk {r.segments_max} görünür segment menüde sekme olur.</span>
        </div>
        {segVisible && (
          <div className="divide-y divide-gray-50">
            {tileOrderForSeg(segVisible.url, segVisible.tiles).map((t, i, arr) => { const pinned = ov.pinned.includes(t.url); const hidden = ov.hidden.includes(t.url); const img = ov.images[t.url] || t.img; return (
              <div key={t.url} className={clsx('py-2 flex flex-wrap items-center gap-2', (hidden || t.small) && 'opacity-50')}>
                {r.sort === 'catalog' && <div className="flex flex-col"><button onClick={() => tileMove(segVisible.url, segVisible.tiles, i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp size={14} /></button><button onClick={() => tileMove(segVisible.url, segVisible.tiles, i, 1)} disabled={i === arr.length - 1} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown size={14} /></button></div>}
                <button onClick={() => setOpenPick(openPick === t.url ? '' : t.url)} title="Kapak adaylarını göster" className={clsx('w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center text-gray-300 border-2', openPick === t.url ? 'border-indigo-500' : 'border-transparent hover:border-indigo-300')}>{img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={16} />}</button>
                <input value={ov.labels[t.url] ?? t.label} onChange={(e) => setLabel(t.url, e.target.value)} className={clsx(inputCls, 'w-40 py-1.5')} maxLength={40} title={t.name} />
                <span className="text-[11px] text-gray-400 w-24 truncate" title={t.group ?? ''}>{t.group ?? ''}</span>
                <span className="text-[11px] font-semibold text-gray-600 w-16 text-right">{t.count} ürün</span>
                <span className="text-[11px] text-gray-500 w-20 text-right">{t.q30.toLocaleString('tr-TR')} / 30g</span>
                <span className={clsx('text-[10px] font-semibold rounded-full px-2 py-0.5 w-20 text-center', t.season >= 1.4 ? 'bg-orange-50 text-orange-700' : t.season <= 0.6 ? 'bg-gray-100 text-gray-400' : 'bg-gray-50 text-gray-500')}>{t.season >= 1.4 ? 'Sezon ↑' : t.season <= 0.6 ? 'sezon dışı' : `×${t.season}`}</span>
                <span className="flex-1 text-[10px] text-gray-400 truncate">{ov.images[t.url] ? 'elle seçildi' : st.picks[t.path]?.image ? `otomatik · görsel puanı %${Math.round((st.picks[t.path].candidates[0]?.image_score ?? 0) * 100)}` : t.img_auto ? 'otomatik (en çok satan)' : 'görsel bulunamadı'}</span>
                <button onClick={() => toggleList('pinned', t.url)} title="Sabitle" className={clsx('p-1.5 rounded-lg', pinned ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-indigo-600')}><Pin size={14} /></button>
                <button onClick={() => toggleList('hidden', t.url)} title={hidden ? 'Göster' : 'Gizle'} className={clsx('p-1.5 rounded-lg', hidden ? 'bg-rose-600 text-white' : 'text-gray-400 hover:text-rose-600')}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                {t.small && <span className="text-[10px] text-gray-400">{t.db_count === 0 ? "Yunbi'de ürün yok, gizli" : 'az ürün, gizli'}</span>}
                {openPick === t.url && (
                  <div className="w-full mt-1 rounded-xl bg-[var(--app-bg)] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-700">Kapak adayları <span className="font-normal text-gray-400">· Akıllı Sıralama üst {st.picks[t.path]?.candidates.length ?? 0} ürün, görsel puanıyla</span></p>
                      <div className="flex items-center gap-2">
                        {ov.images[t.url] && <button onClick={() => chooseCover(t.url, null)} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Otomatiğe dön</button>}
                        <button onClick={() => pickCategory(t.path)} disabled={pickOne === t.path} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 disabled:opacity-50">{pickOne === t.path ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Yeniden puanla</button>
                      </div>
                    </div>
                    {st.picks[t.path]?.candidates.length ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {st.picks[t.path].candidates.map((c) => { const chosen = (ov.images[t.url] || st.picks[t.path]?.image) === c.image; return (
                          <button key={c.product_id + (c.image ?? '')} onClick={() => c.image && chooseCover(t.url, c.image)} title={c.name} className={clsx('shrink-0 w-24 rounded-lg overflow-hidden border-2 bg-white text-left', chosen ? 'border-indigo-500' : 'border-transparent hover:border-indigo-300')}>
                            <div className="w-24 h-24 bg-gray-100">{c.thumb && <img src={c.thumb} alt="" className="w-full h-full object-cover" />}</div>
                            <div className="px-1.5 py-1"><p className="text-[10px] font-semibold text-gray-700">%{Math.round(c.image_score * 100)} görsel · #{c.rank}</p><p className="text-[9.5px] text-gray-400 truncate">{c.name}</p></div>
                          </button>) })}
                      </div>
                    ) : <p className="text-xs text-gray-400">Bu kategori için henüz aday yok; "Yeniden puanla" ile seç.</p>}
                    <div className="mt-2 flex items-center gap-2"><input value={ov.images[t.url] ?? ''} onChange={(e) => setImage(t.url, e.target.value)} className={clsx(inputCls, 'flex-1 py-1.5 text-xs')} placeholder="Ya da kendi görsel URL'in" /><span className="text-[10px] text-gray-400">Kaydet için üstteki "Düzenlemeleri kaydet"</span></div>
                  </div>
                )}
              </div>) })}
            {segVisible.tiles.length === 0 && <p className="text-sm text-gray-400 py-3">Bu segmentte ürünlü alt kategori yok.</p>}
          </div>
        )}
        {r.sort !== 'catalog' && <p className="text-[11px] text-gray-400 mt-3">Elle sıralamak için "Kart sırası"nı Katalog / elle yap; sabitlenen kartlar her modda başta kalır.</p>}
      </Section>

      {/* 5 Sanal kategoriler */}
      <Section step="5" title="Sanal kategoriler" desc="Ticimax'ta kategori açmadan menüye yeni giriş: fiyat aralığı, indirimliler, çok satanlar, yeni gelenler ya da bir kampanya sayfası. {seg} yazan yere aktif segmentin yolu gelir (Kadın sekmesinde /kadin?min=299&max=399); min/max içeren girişlerde gerçek stoklu ürün sayısı çipte görünür. Emoji ve görünüm (dolu / hareketli parıltı / nefes alan halka) çipi menüden ayrıştırır; hareket yavaş ve tek renklidir, kurumsal görünüm bozulmaz. Çip = üstte yatay satır, Kart = kategorilerin altında tam genişlik."
        right={<div className="flex items-center gap-2">
          <button onClick={() => patch('virtual', { virtual: null })} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılan</button>
          <button onClick={() => patch('virtual', { virtual })} disabled={!vDirty || saving === 'virtual'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'virtual' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Kaydet</button>
        </div>}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Çip satırının yeri</label><Seg value={r.virtual_position} options={[['top', 'Üstte'], ['bottom', 'Altta'], ['both', 'İkisi']]} onChange={(v) => patch('rules', { rules: { virtual_position: v } })} /></div>
        </div>
        <div className="divide-y divide-gray-50">
          {virtual.map((v, i) => (
            <div key={v.key + i} className={clsx('py-2 flex flex-wrap items-center gap-2', !v.enabled && 'opacity-50')}>
              <div className="flex flex-col"><button onClick={() => vMove(i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp size={14} /></button><button onClick={() => vMove(i, 1)} disabled={i === virtual.length - 1} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown size={14} /></button></div>
              <button onClick={() => vSet(i, { enabled: !v.enabled })} className={clsx('w-9 h-5 rounded-full relative shrink-0', v.enabled ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', v.enabled ? 'left-[18px]' : 'left-0.5')} /></button>
              <input value={v.label} onChange={(e) => vSet(i, { label: e.target.value })} className={clsx(inputCls, 'w-36 py-1.5')} placeholder="Etiket" maxLength={40} />
              <input value={v.url} onChange={(e) => vSet(i, { url: e.target.value })} className={clsx(inputCls, 'flex-1 min-w-[200px] py-1.5 text-xs')} placeholder="{seg}?min=299&max=399 veya /kampanya" />
              <select value={v.style} onChange={(e) => vSet(i, { style: e.target.value as MenuVirtual['style'] })} className={clsx(inputCls, 'py-1.5')}><option value="chip">Çip</option><option value="card">Kart</option><option value="hero">Üst bant</option></select>
              <input value={v.emoji ?? ''} onChange={(e) => vSet(i, { emoji: e.target.value })} className={clsx(inputCls, 'w-14 py-1.5 text-center')} placeholder="🔥" maxLength={4} title="Emoji (boşsa ikon)" />
              <select value={v.icon} onChange={(e) => vSet(i, { icon: e.target.value })} className={clsx(inputCls, 'py-1.5')} title="İkon (emoji yoksa)">{ICON_OPTS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</select>
              <select value={v.look ?? 'plain'} onChange={(e) => vSet(i, { look: e.target.value as MenuVirtual['look'] })} className={clsx(inputCls, 'py-1.5')} title="Görünüm"><option value="plain">Sade</option><option value="solid">Dolu</option><option value="gradient">Parıltı (hareketli)</option><option value="glow">Nefes (halka)</option></select>
              {v.look && v.look !== 'plain' && <span className="inline-flex items-center gap-1" title="Renk (boş = otomatik palet)"><input type="color" value={v.color || '#d97706'} onChange={(e) => vSet(i, { color: e.target.value })} className="w-8 h-8 rounded-lg border border-gray-200 p-0.5 bg-white" />{v.color && <button onClick={() => vSet(i, { color: '' })} className="text-[10px] text-gray-400 hover:text-gray-700">oto</button>}</span>}
              <label className="inline-flex items-center gap-1 text-[11px] text-gray-600" title="Segment başına en çok ürünü kapsayan x99 uçlu fiyat bandı hesaplanır; {min}/{max} etiket ve URL'de yerine konur"><input type="checkbox" checked={!!v.auto_price} onChange={(e) => vSet(i, { auto_price: e.target.checked, ...(e.target.checked ? { label: v.label.includes('{min}') ? v.label : '{min}–{max} TL', url: '{seg}?min={min}&max={max}' } : {}) })} /> otomatik fiyat</label>
              {v.style !== 'chip' && <input value={v.note ?? ''} onChange={(e) => vSet(i, { note: e.target.value })} className={clsx(inputCls, 'w-40 py-1.5 text-xs')} placeholder="Alt yazı" maxLength={60} />}
              {v.style !== 'chip' && <input value={v.image ?? ''} onChange={(e) => vSet(i, { image: e.target.value })} className={clsx(inputCls, 'w-44 py-1.5 text-xs')} placeholder="Arka plan görseli URL" />}
              <button onClick={() => vRemove(i)} className="ml-auto p-1.5 text-gray-400 hover:text-rose-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {virtual.some((v) => v.auto_price) && st.virtual.find((v) => v.auto_price)?.bands && (
          <p className="text-[11px] text-gray-500 mt-2">Otomatik bant (şu an): {Object.entries(st.virtual.find((v) => v.auto_price)!.bands!).map(([u, b]) => `${st.data.segments.find((s) => s.url === u)?.name ?? u}: ${b.min}–${b.max} TL (${b.count} ürün, %${b.share})`).join(' · ')}</p>
        )}
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-semibold text-gray-500 mr-1">Ekle:</span>
          {VIRT_PRESETS.map(([l, v]) => <button key={l} onClick={() => vAdd(v)} disabled={virtual.length >= 12} className="inline-flex items-center gap-1 text-xs rounded-full border border-gray-200 px-2.5 py-1 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40"><Plus size={11} /> {l}</button>)}
        </div>
      </Section>

      {/* 6 Ürün satırı */}
      <Section step="6" title="Menüde ürün satırı" desc="Kategorilerin altında yatay ürün satırı: segmentin son 14 günde en çok satan stoklu ürünleri; giriş yapmış üyede öneri motorunun kişisel seçkisi ('Sana özel', bedeni stokta olanlar).">
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          <Toggle on={r.show_products} onChange={(v) => patch('rules', { rules: { show_products: v } })} label="Ürün satırı açık" />
          <div className="flex flex-wrap items-end gap-4">
            <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kaynak</label><Seg value={r.products_source} options={[['auto', 'Üye ise kişisel, değilse popüler'], ['popular', 'Hep popüler'], ['personal', 'Yalnız kişisel']]} onChange={(v) => patch('rules', { rules: { products_source: v } })} /></div>
            <div><label className="text-xs font-semibold text-gray-600 block mb-1">Adet</label><select className={inputCls} value={r.products_count} onChange={(e) => patch('rules', { rules: { products_count: Number(e.target.value) } })}>{[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            <div><label className="text-xs font-semibold text-gray-600 block mb-1">Ad uzunluğu</label><select className={inputCls} value={r.product_name_max} onChange={(e) => patch('rules', { rules: { product_name_max: Number(e.target.value) } })}>{[24, 30, 34, 40, 50, 80].map((n) => <option key={n} value={n}>{n} karakter</option>)}</select><p className="text-[10px] text-gray-400 mt-1">Stok kodu atılır, sondan kelime sınırında kısaltılır: "Kadın Bej Kahve Sneaker".</p></div>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {st.data.segments.map((s) => (
            <div key={s.url} className="rounded-xl bg-[var(--app-bg)] p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">{s.name} · şu an popüler</p>
              <div className="flex gap-2 overflow-x-auto">{(st.data.products[s.name] ?? []).map((p) => <a key={p.pid} href={st.shop_url + p.url} target="_blank" rel="noreferrer" title={p.name} className="shrink-0 w-16"><img src={p.img} alt="" className="w-16 h-16 rounded-lg object-cover bg-white" /><span className="block text-[10px] text-gray-500 truncate mt-1">{p.q} adet</span></a>)}
                {!(st.data.products[s.name]?.length) && <span className="text-[11px] text-gray-400">Son 14 günde satış yok</span>}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 7 Analitik — menüdeki her öğenin tıklanma haritası */}
      <Section step="7" title="Tıklama haritası" desc="Menüdeki her öğe: kategori kartları, sanal kategoriler, ürün satırı, 'tümü' linki, 'daha fazla', alt linkler, arama, sekmeler. Tıklama ve oturum sayıları, kartın ortalama sırası, konum eğrisi ve saat dağılımı. Demo/önizleme tıklamaları sayılmaz."
        right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((n) => <button key={n} onClick={() => setRange(n)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === n ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{n} gün</button>)}</div>}>
        {!an || an.opens === 0 ? (
          <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Menü ziyaretçilere ulaşınca burada birikir.</div>
        ) : <ClickMap an={an} st={st} />}
      </Section>
    </div>
  )
}


/* ── Tıklama haritası ── */
const TYPE_LABEL: Record<string, string> = { tile: 'Kategori kartı', virtual: 'Sanal kategori', product: 'Ürün satırı', recent: 'Kaldığın yer', all: '"Tüm … ürünleri" linki', footer: 'Alt linkler (Hesabım / Favoriler / Sepet)', more: '"… kategori daha" düğmesi', search: 'Arama', tab: 'Sekme değiştirme', open: 'Menü açılışı', close: 'Tıklamadan kapatma' }
const FOOTER_LABEL: Record<string, string> = { account: 'Hesabım / Giriş', favorites: 'Favorilerim', cart: 'Sepetim' }
const Bar = ({ v, max, color = 'bg-[var(--primary-strong)]' }: { v: number; max: number; color?: string }) => (
  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={clsx('h-full rounded-full', color)} style={{ width: `${max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0}%` }} /></div>
)
const Row = ({ label, sub, c, max, right }: { label: string; sub?: string; c: number; max: number; right?: string }) => (
  <div className="mb-2">
    <div className="flex justify-between items-baseline text-xs mb-0.5 gap-2">
      <span className={clsx('truncate', c > 0 ? 'font-semibold text-gray-700' : 'text-gray-400')}>{label}{sub && <span className="font-normal text-gray-400 ml-1">{sub}</span>}</span>
      <span className="text-gray-500 shrink-0 tabular-nums">{c.toLocaleString('tr-TR')} tık{right ? ` · ${right}` : ''}</span>
    </div>
    <Bar v={c} max={max} color={c > 0 ? 'bg-[var(--primary-strong)]' : 'bg-gray-200'} />
  </div>
)
function ClickMap({ an, st }: { an: MenuAnalytics; st: MenuSettings | null }) {
  const segNames = useMemo(() => (st?.data.segments ?? []).map((s) => s.name), [st])
  const [seg, setSeg] = useState<string>('Tümü')
  const clicksTotal = an.by_type.filter((t) => !['open', 'close', 'tab'].includes(t.type)).reduce((a, t) => a + t.c, 0)
  const typeRows = an.by_type.filter((t) => t.type !== 'open').sort((a, b) => b.c - a.c)
  const views = (name: string) => an.segment_views.find((v) => v.segment === name)?.c ?? 0
  const segViews = seg === 'Tümü' ? an.segment_views.reduce((a, v) => a + v.c, 0) : views(seg)
  // kartlar: menüde var olan her kart (0 tık olanlar dahil) + kayıtlarda kalan eski kartlar
  const tiles = useMemo(() => {
    const ev = an.by_tile_all.filter((t) => seg === 'Tümü' || t.segment === seg)
    const agg = new Map<string, { label: string; segment: string; c: number; s: number; pos: number | null }>()
    for (const t of ev) { const k = `${t.segment}|${t.value}`; const cur = agg.get(k); if (cur) { cur.c += t.c; cur.s += t.s } else agg.set(k, { label: t.value, segment: t.segment ?? '', c: t.c, s: t.s, pos: t.avg_pos }) }
    for (const sg of st?.data.segments ?? []) { if (seg !== 'Tümü' && sg.name !== seg) continue; for (const t of sg.tiles) { const k = `${sg.name}|${t.url}`; if (!agg.has(k)) agg.set(k, { label: t.url, segment: sg.name, c: 0, s: 0, pos: null }); agg.get(k)!.label = (st?.overrides.labels[t.url] || t.label) } }
    // url→etiket çözümü (eski kayıtlar)
    const urlLabel = new Map<string, string>(); for (const sg of st?.data.segments ?? []) for (const t of sg.tiles) urlLabel.set(t.url, st?.overrides.labels[t.url] || t.label)
    return [...agg.values()].map((r) => ({ ...r, label: urlLabel.get(r.label) || r.label })).sort((a, b) => b.c - a.c)
  }, [an, st, seg])
  const virt = useMemo(() => {
    const ev = an.by_virtual_seg.filter((v) => seg === 'Tümü' || v.segment === seg)
    const agg = new Map<string, number>(); for (const v of ev) agg.set(v.value, (agg.get(v.value) ?? 0) + v.c)
    for (const v of st?.virtual ?? []) if (v.enabled && !agg.has(v.key)) agg.set(v.key, 0)
    const label = (k: string) => st?.virtual.find((v) => v.key === k)?.label.replace('{min}–{max} TL', 'Fiyat bandı') ?? k
    return [...agg.entries()].map(([k, c]) => ({ key: k, label: label(k), c })).sort((a, b) => b.c - a.c)
  }, [an, st, seg])
  const prods = useMemo(() => {
    const ev = an.by_product.filter((p) => seg === 'Tümü' || p.segment === seg)
    const agg = new Map<string, { name: string; c: number; pos: number | null }>(); for (const p of ev) { const cur = agg.get(p.value); if (cur) cur.c += p.c; else agg.set(p.value, { name: p.name, c: p.c, pos: p.avg_pos }) }
    return [...agg.values()].sort((a, b) => b.c - a.c).slice(0, 15)
  }, [an, seg])
  const urlLabel = useMemo(() => { const m = new Map<string, string>(); for (const sg of st?.data.segments ?? []) for (const t of sg.tiles) m.set(t.url, `${st?.overrides.labels[t.url] || t.label} (${sg.name})`); return m }, [st])
  const allLink = seg === 'Tümü' ? an.by_all.reduce((a, v) => a + v.c, 0) : (an.by_all.find((v) => v.value === seg)?.c ?? 0)
  const segUrl = st?.data.segments.find((s) => s.name === seg)?.url
  const more = seg === 'Tümü' ? an.by_more.reduce((a, v) => a + v.c, 0) : (an.by_more.find((v) => v.value === segUrl)?.c ?? 0)
  const tileMax = tiles[0]?.c || 1, virtMax = virt[0]?.c || 1, prodMax = prods[0]?.c || 1, posMax = Math.max(1, ...an.by_position.map((p) => p.c)), hourMax = Math.max(1, ...an.hourly.map((h) => h.c)), dayMax = Math.max(1, ...an.daily.map((d) => d.opens))
  const ctr = (c: number) => segViews > 0 ? `%${(c / segViews * 100).toFixed(1)}` : ''
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[['Menü açılışı', an.opens.toLocaleString('tr-TR')], ['Açan oturum', an.open_sessions.toLocaleString('tr-TR')], ['Tıklayan oturum', `%${an.click_rate}`], ['Toplam tıklama', clicksTotal.toLocaleString('tr-TR')], ['Tıklamadan kapatma', an.close_noclick.toLocaleString('tr-TR')]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p></div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6 text-sm">
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Menüde nereye tıklanıyor <span className="font-normal text-gray-400">(tür bazında, oturum = farklı ziyaretçi)</span></p>
          {typeRows.map((t) => <Row key={t.type} label={TYPE_LABEL[t.type] ?? t.type} c={t.c} max={typeRows[0]?.c || 1} right={`${t.s} oturum${clicksTotal > 0 && !['close', 'tab'].includes(t.type) ? ` · %${(t.c / clicksTotal * 100).toFixed(0)}` : ''}`} />)}
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Kartın kaçıncı sırada tıklandığı <span className="font-normal text-gray-400">(konum eğrisi; ilk 3 sıra baskınsa alt kartlar görülmüyor)</span></p>
          <div className="flex items-end gap-1 h-24">
            {an.by_position.slice(0, 24).map((p) => <div key={p.position} className="flex-1 flex flex-col items-center gap-0.5" title={`${p.position}. sıra: ${p.c} tık`}><div className="w-full rounded-t bg-[var(--primary-strong)]/80" style={{ height: `${Math.max(3, Math.round(p.c / posMax * 80))}px` }} /><span className="text-[9px] text-gray-400">{p.position}</span></div>)}
          </div>
          <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Saate göre açılış</p>
          <div className="flex items-end gap-0.5 h-16">
            {Array.from({ length: 24 }, (_, h) => { const c = an.hourly.find((x) => x.h === h)?.c ?? 0; return <div key={h} className="flex-1 flex flex-col items-center" title={`${h}:00 — ${c} açılış`}><div className="w-full rounded-t bg-gray-400/70" style={{ height: `${Math.max(2, Math.round(c / hourMax * 52))}px` }} />{h % 6 === 0 && <span className="text-[9px] text-gray-400">{h}</span>}</div> })}
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <p className="text-xs font-semibold text-gray-500">Segment:</p>
          {['Tümü', ...segNames].map((n) => <button key={n} onClick={() => setSeg(n)} className={clsx('px-3 py-1 rounded-full text-xs font-semibold', seg === n ? 'bg-[var(--primary-strong)] text-white' : 'bg-[var(--app-bg)] text-gray-600')}>{n}{n !== 'Tümü' && <span className="opacity-70 font-normal ml-1">{views(n)} görüntüleme</span>}</button>)}
          <span className="text-[11px] text-gray-400 ml-auto">görüntüleme = menü bu sekmeyle açıldı veya sekmeye geçildi · CTR = tık / görüntüleme</span>
        </div>
        <div className="grid md:grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">Kategori kartları <span className="font-normal text-gray-400">({tiles.length} kart, 0 tık olanlar dahil)</span></p>
            <div className="max-h-[420px] overflow-auto pr-1">
              {tiles.map((t) => <Row key={t.segment + t.label} label={t.label} sub={seg === 'Tümü' ? `· ${t.segment}` : undefined} c={t.c} max={tileMax} right={`${t.s} oturum${t.pos ? ` · ort. ${t.pos}. sıra` : ''}${ctr(t.c) ? ` · CTR ${ctr(t.c)}` : ''}`} />)}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <Row label={seg === 'Tümü' ? '"Tüm … ürünleri" linki' : `"Tüm ${seg} ürünleri" linki`} c={allLink} max={tileMax} right={ctr(allLink) ? `CTR ${ctr(allLink)}` : undefined} />
              <Row label='"… kategori daha" düğmesi' c={more} max={tileMax} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">Sanal kategoriler <span className="font-normal text-gray-400">(çip ve kartlar)</span></p>
            {virt.map((v) => <Row key={v.key} label={v.label} c={v.c} max={virtMax} right={ctr(v.c) ? `CTR ${ctr(v.c)}` : undefined} />)}
            <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Alt linkler</p>
            {['account', 'favorites', 'cart'].map((k) => { const c = an.by_footer.find((f) => f.value === k)?.c ?? 0; return <Row key={k} label={FOOTER_LABEL[k]} c={c} max={Math.max(1, ...an.by_footer.map((f) => f.c))} /> })}
            <Row label="Arama kutusu" c={an.search_clicks} max={Math.max(1, an.search_clicks)} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">Ürün satırı <span className="font-normal text-gray-400">(en çok tıklanan 15 ürün)</span></p>
            {prods.length === 0 ? <p className="text-xs text-gray-400">Henüz ürün tıklaması yok.</p> : prods.map((p) => <Row key={p.name} label={p.name} c={p.c} max={prodMax} right={p.pos ? `ort. ${p.pos}. sıra` : undefined} />)}
            <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Kaldığın yer <span className="font-normal text-gray-400">(son gezilen kategori / ürün çipleri)</span></p>
            {an.by_recent.length === 0 ? <p className="text-xs text-gray-400">Henüz tıklama yok.</p> : an.by_recent.slice(0, 8).map((r) => <Row key={r.value} label={r.name || urlLabel.get(r.value) || r.value} c={r.c} max={an.by_recent[0].c} />)}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">Günlük açılış ve tıklama</p>
        <div className="flex items-end gap-1 h-20 overflow-x-auto">
          {an.daily.map((d) => <div key={d.d} className="flex flex-col items-center gap-0.5 min-w-[22px]" title={`${d.d}: ${d.opens} açılış, ${d.clicks} tık`}><div className="w-full flex items-end gap-px h-14"><div className="flex-1 rounded-t bg-[var(--primary-strong)]/80" style={{ height: `${Math.max(2, Math.round(d.opens / dayMax * 56))}px` }} /><div className="flex-1 rounded-t bg-emerald-500/70" style={{ height: `${Math.max(2, Math.round(d.clicks / dayMax * 56))}px` }} /></div><span className="text-[9px] text-gray-400">{d.d.slice(8)}</span></div>)}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">mavi: açılış · yeşil: tıklama</p>
      </div>
    </div>
  )
}
