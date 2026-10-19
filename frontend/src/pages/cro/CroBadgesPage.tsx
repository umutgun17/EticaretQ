import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, ExternalLink, Loader2, Check, Copy, BarChart3, Smartphone, RotateCcw, RefreshCw, ArrowUp, ArrowDown, Trash2, Plus, Search, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { badgeApi, type BadgeSettings, type BadgeAnalytics, type BadgeType, type BadgeKind } from '@/lib/croApi'

/* Ürün Rozetleri (CRO) — liste kartlarında ve ürün detayda gerçek veriye dayalı rozetler (kampanya kategorisi,
   çok satan, son N adet, yeni, popüler, yüksek puan) + ürün detayda sosyal kanıt satırları.
   Rozet sırası = öncelik; kart başına en fazla N rozet. Harita 15 dk'da bir satış/GA4/stok verisinden üretilir. */

const KIND_INFO: Record<BadgeKind, { name: string; desc: string }> = {
  tag: { name: 'Kampanya (etiket)', desc: 'Seçilen Ticimax etiketindeki tüm kartlar — örn. Flaş Ürünler etiketi → "Sepette %5 İndirim". Etiket ID Ticimax panelinden; canlı okunur.' },
  category: { name: 'Kampanya (kategori)', desc: 'Seçilen kategorideki tüm kartlar — örn. 1 Alana 1 Bedava. Yeni açılan kartlar Ticimax’tan canlı okunur.' },
  bestseller: { name: 'Çok Satan', desc: 'Son N günde en çok satan kartlar (ödenmiş, iptal olmayan siparişler; tüm kanallar).' },
  low_stock: { name: 'Son N Adet', desc: 'Kartın toplam stoğu eşiğin altına inince. {n} = gerçek kalan adet.' },
  new: { name: 'Yeni', desc: 'Mağazada son N günde açılmış, stoklu kartlar.' },
  popular: { name: 'Popüler', desc: 'GA4’e göre son N günde en çok incelenen kartlar (ürün görüntülenme).' },
  top_rated: { name: 'Yüksek Puan', desc: 'Trendyol yorum puanı eşiğin üstünde. {rate} = puan, {count} = değerlendirme sayısı.' },
}
const PARAM_INFO: Record<string, { label: string; suffix?: string; step?: number }> = {
  days: { label: 'Dönem', suffix: 'gün' }, top: { label: 'En fazla', suffix: 'ürün' }, min_qty: { label: 'En az satış', suffix: 'adet' },
  tag_id: { label: 'Ticimax etiket ID' }, cart_pct: { label: 'Sepette ek indirim', suffix: '% ({price})' }, category_id: { label: 'Kategori ID' }, min_views: { label: 'En az görüntülenme' }, threshold: { label: 'Stok eşiği', suffix: 'adet ve altı' }, min_rate: { label: 'En az puan', step: 0.1 }, min_count: { label: 'En az değerlendirme' },
}
const ICON_EMOJI: Record<string, string> = { none: '—', gift: '🎁', flame: '🔥', eye: '👁', sparkle: '✨', hourglass: '⏳', star: '★', tag: '🏷', bolt: '⚡', trophy: '🏆', heart: '♥', truck: '🚚' }

function PhoneFrame({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(0.5)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} className="border-0" style={{ width: 390, height: 640 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
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
function Mini({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!on)} className={clsx('w-8 h-[18px] rounded-full relative transition-colors shrink-0', on ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all', on ? 'left-[16px]' : 'left-[2px]')} /></button>
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap rounded-full bg-[var(--app-bg)] p-0.5">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', value === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{l}</button>)}</div>
}
const inputCls = 'rounded-xl bg-[var(--app-bg)] border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-strong)]/30 focus:bg-white'

/** Rozetin panelde (liste stiliyle) küçük önizlemesi */
function Chip({ t, style }: { t: Pick<BadgeType, 'label' | 'color' | 'icon' | 'design'>; style: string }) {
  const c = t.color
  if (t.design === 'spotlight') {
    const k = t.label.includes('|') ? t.label.indexOf('|') : t.label.indexOf(' ')
    const top = k < 0 ? t.label : t.label.slice(0, k), sub = k < 0 ? '' : t.label.slice(k + 1)
    return <span className="inline-flex flex-col text-center rounded-lg overflow-hidden bg-[#0b0b0c] text-white -rotate-[5deg] shadow" style={{ boxShadow: `0 0 0 2px ${c}` }}><span className="text-[15px] font-black leading-none px-2 pt-1 pb-0.5">{top}</span>{sub && <span className="text-[8px] font-extrabold tracking-[.14em] uppercase px-1.5 py-0.5" style={{ background: c }}>{sub}</span>}</span>
  }
  const css: React.CSSProperties = style === 'soft' ? { background: c + '1f', color: c } : style === 'outline' ? { border: `1.5px solid ${c}`, color: c, background: '#fff' } : style === 'glass' ? { background: '#f3f4f6', color: c } : { background: c, color: '#fff' }
  return <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide rounded-md px-2 py-1 whitespace-nowrap" style={css}>{t.icon !== 'none' && <span>{ICON_EMOJI[t.icon]}</span>}{t.label.replace('{n}', '3').replace('{rate}', '4,8').replace('{count}', '120')}</span>
}

function CategoryPicker({ onPick }: { onPick: (c: { id: string; name: string; path: string }) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<{ id: string; name: string; path: string; product_count: number; is_active: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { const h = setTimeout(() => { setBusy(true); badgeApi.categories(q).then(setItems).catch(() => setItems([])).finally(() => setBusy(false)) }, 250); return () => clearTimeout(h) }, [q])
  return (
    <div className="rounded-xl border border-gray-100 p-3 bg-[var(--app-bg)]">
      <div className="flex items-center gap-2"><Search size={14} className="text-gray-400" /><input autoFocus className={clsx(inputCls, 'flex-1 bg-white')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kategori adı veya ID — örn. 1 alana, 2623" />{busy && <Loader2 size={14} className="animate-spin text-gray-400" />}</div>
      <div className="mt-2 max-h-56 overflow-auto divide-y divide-gray-100 bg-white rounded-lg">
        {items.map((c) => (
          <button key={c.id} onClick={() => onPick(c)} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2">
            <span className="min-w-0"><span className="text-sm font-semibold text-gray-800 block truncate">{c.name}</span><span className="text-[11px] text-gray-400 truncate block">{c.path} · #{c.id}</span></span>
            <span className="text-[11px] text-gray-500 shrink-0">{c.product_count} ürün</span>
          </button>
        ))}
        {!busy && items.length === 0 && <p className="text-xs text-gray-400 p-3">Sonuç yok</p>}
      </div>
    </div>
  )
}

export default function CroBadgesPage() {
  const [st, setSt] = useState<BadgeSettings | null>(null)
  const [types, setTypes] = useState<BadgeType[]>([])
  const [typesDirty, setTypesDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [an, setAn] = useState<BadgeAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [view, setView] = useState<'list' | 'pdp'>('list')
  const [picker, setPicker] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [pvTypes, setPvTypes] = useState<BadgeType[]>([])
  useEffect(() => { const h = setTimeout(() => setPvTypes(types), 600); return () => clearTimeout(h) }, [types])

  const apply = (d: BadgeSettings) => {
    setSt(d); setTypes(d.types); setTypesDirty(false); setDomains(d.domains)
    const r = d.rules
    setTexts({ proof_sold_24h_text: r.proof_sold_24h_text, proof_sold_7d_text: r.proof_sold_7d_text, proof_sold_30d_text: r.proof_sold_30d_text, proof_rank_text: r.proof_rank_text, proof_fav_text: r.proof_fav_text, proof_cart_text: r.proof_cart_text, proof_atc_text: r.proof_atc_text, proof_views_text: r.proof_views_text, proof_sizes_text: r.proof_sizes_text, list_card_selector: r.list_card_selector, list_id_selector: r.list_id_selector, list_image_selector: r.list_image_selector, pdp_image_mount: r.pdp_image_mount, pdp_price_mount: r.pdp_price_mount, pdp_badge_mount: r.pdp_badge_mount, pdp_proof_mount: r.pdp_proof_mount, hide_paths: r.hide_paths })
  }
  const load = useCallback(() => {
    setLoading(true)
    badgeApi.settings().then(apply).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { badgeApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await badgeApi.update(body); apply(d); if (d.build_error) setError('Rozet haritası üretilemedi: ' + d.build_error); setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const editType = (i: number, p: Partial<BadgeType>) => { setTypes((ts) => ts.map((t, j) => (j === i ? { ...t, ...p } : t))); setTypesDirty(true) }
  const editParam = (i: number, k: string, v: number) => { setTypes((ts) => ts.map((t, j) => (j === i ? { ...t, params: { ...t.params, [k]: v } } : t))); setTypesDirty(true) }
  const move = (i: number, d: -1 | 1) => { setTypes((ts) => { const a = [...ts]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }); setTypesDirty(true) }
  const remove = (i: number) => { setTypes((ts) => ts.filter((_, j) => j !== i)); setTypesDirty(true) }
  const addCategory = (c: { id: string; name: string }) => {
    setTypes((ts) => [{ id: 'cat_' + c.id, kind: 'category', label: c.name.slice(0, 40), color: '#dc2626', icon: 'gift', enabled: true, list: true, pdp: true, params: { category_id: Number(c.id) } }, ...ts])
    setTypesDirty(true); setPicker(false)
  }
  const addKind = (k: BadgeKind) => {
    const d = st?.defaults.types.find((t) => t.kind === k); if (!d) return
    setTypes((ts) => [...ts, { ...d, id: d.id + (ts.some((t) => t.id === d.id) ? '_2' : '') }]); setTypesDirty(true)
  }

  const embed = st ? `<script src="${st.base_url}/widget/badge.js?v=2" data-tenant="${st.slug}" async></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const previewUrl = useMemo(() => st ? `/widget/badge-demo.html?tenant=${st.slug}&view=${view}&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify(st.rules))}&types=${encodeURIComponent(JSON.stringify(pvTypes))}&k=${previewKey}` : '', [st, view, pvTypes, previewKey])
  const demoUrl = st ? `/widget/badge-demo.html?tenant=${st.slug}&view=${view}` : '#'

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const t = st.theme, r = st.rules, b = st.build
  const missingKinds = (['bestseller', 'low_stock', 'new', 'popular', 'top_rated'] as BadgeKind[]).filter((k) => !types.some((x) => x.kind === k))
  const exclusive = r.exclusive.includes('bestseller') && r.exclusive.includes('popular')

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><BadgePercent size={24} /> Ürün Rozetleri
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">Ürün kartlarında ve ürün detayda tek tasarım dilinde rozetler: kampanya (1 Alana 1 Bedava vb.), çok satan, son adet, yeni, popüler. Ürün detayda "son 24 saatte X adet satıldı" gibi sosyal kanıt satırları. Hepsi mağazanın gerçek satış, stok ve GA4 verisinden; eşik altı hiçbir şey gösterilmez.</p>
        </div>
        <a href={demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Smartphone size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          {/* 1 Kurulum */}
          <Section step="1" title="Kurulum" desc="Tek satır embed, tüm sayfalara (liste kartları ana sayfa, kategori, arama ve benzer ürün bloklarında da çalışır). Rozet haritası 15 dakikada bir yenilenir.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Rozetler açık" hint="Kapalıyken mağazadaki script hiçbir şey çizmez." />
                <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
                <div className="grid grid-cols-2 gap-2">
                  <Toggle on={r.list_enabled} onChange={(v) => patch('rules', { rules: { list_enabled: v } })} label="Liste kartları" />
                  <Toggle on={r.pdp_enabled} onChange={(v) => patch('rules', { rules: { pdp_enabled: v } })} label="Ürün detay" />
                </div>
              </div>
              <div className="space-y-3">
                <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu (tüm sayfalar, {'</body>'} öncesi)</label>
                  <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div></div>
                <div className="rounded-xl bg-[var(--app-bg)] p-3 text-xs text-gray-600">
                  <div className="flex items-center justify-between"><span className="font-semibold text-gray-800">Rozet haritası</span>
                    <button onClick={() => patch('rebuild', { rebuild: true })} disabled={saving === 'rebuild'} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"><RefreshCw size={12} className={saving === 'rebuild' ? 'animate-spin' : ''} /> Şimdi yenile</button></div>
                  {b ? <p className="mt-1">{new Date(b.built_at).toLocaleString('tr-TR')} · <b>{b.badged.toLocaleString('tr-TR')}</b> rozetli kart · <b>{b.proof.toLocaleString('tr-TR')}</b> üründe sosyal kanıt{b.duration_ms ? ` · ${(b.duration_ms / 1000).toFixed(1)} sn` : ''}</p> : <p className="mt-1">Henüz üretilmedi.</p>}
                  {b?.notes?.length ? <p className="mt-1 text-amber-700">{b.notes.join(' · ')}</p> : null}
                </div>
              </div>
            </div>
          </Section>

          {/* 2 Rozetler */}
          <Section step="2" title="Rozetler ve öncelik" desc="Yukarıdaki rozet önce gelir; kartta en fazla 'kart başına rozet' kadarı görünür. Metinde {n} gerçek sayıyla değişir. Sayı, şu an kaç kartın bu rozeti aldığını gösterir."
            right={typesDirty ? <div className="flex gap-2"><button onClick={() => { setTypes(st.types); setTypesDirty(false) }} className="px-3 py-1.5 rounded-full text-xs font-semibold text-gray-500 hover:bg-gray-100">Vazgeç</button><button onClick={() => patch('types', { types })} disabled={saving === 'types'} className="px-4 py-1.5 rounded-full bg-gray-900 text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1">{saving === 'types' && <Loader2 size={12} className="animate-spin" />} Kaydet ve uygula</button></div> : undefined}>
            <div className="space-y-2">
              {types.map((ty, i) => {
                const n = b?.counts?.[ty.id]
                const samples = b?.samples?.[ty.id] || []
                const isOpen = open === ty.id
                return (
                  <div key={ty.id + i} className={clsx('rounded-xl border p-3', ty.enabled ? 'border-gray-100' : 'border-dashed border-gray-200 opacity-70')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex flex-col"><button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowUp size={13} /></button><button onClick={() => move(i, 1)} disabled={i === types.length - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowDown size={13} /></button></div>
                      <Mini on={ty.enabled} onChange={(v) => editType(i, { enabled: v })} />
                      <div className="w-36"><Chip t={ty} style={t.style} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800">{KIND_INFO[ty.kind].name}{ty.kind === 'category' && <span className="text-gray-400 font-normal"> · {st.category_names[String(ty.params.category_id)] || '#' + ty.params.category_id}</span>}{ty.kind === 'tag' && <span className="text-gray-400 font-normal"> · etiket #{ty.params.tag_id}</span>}</p>
                        <p className="text-[11px] text-gray-500 leading-snug">{KIND_INFO[ty.kind].desc}</p>
                      </div>
                      <button onClick={() => setOpen(isOpen ? null : ty.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 rounded-full bg-[var(--app-bg)] px-2.5 py-1">{n != null ? `${n.toLocaleString('tr-TR')} kart` : '—'} {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
                      {(ty.kind === 'category' || ty.kind === 'tag') && <button onClick={() => remove(i)} className="text-gray-300 hover:text-rose-600"><Trash2 size={14} /></button>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-3 pl-[52px]">
                      <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">Metin</label><input className={clsx(inputCls, 'w-44')} value={ty.label} maxLength={40} onChange={(e) => editType(i, { label: e.target.value })} /></div>
                      <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">Renk</label><input type="color" value={ty.color} onChange={(e) => editType(i, { color: e.target.value })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /></div>
                      <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">İkon</label><select className={inputCls} value={ty.icon} onChange={(e) => editType(i, { icon: e.target.value })}>{st.icons.map((ic) => <option key={ic} value={ic}>{ICON_EMOJI[ic]} {ic}</option>)}</select></div>
                      {Object.entries(ty.params).filter(([k]) => k !== 'category_id').map(([k, v]) => (
                        <div key={k}><label className="text-[11px] font-semibold text-gray-500 block mb-1">{PARAM_INFO[k]?.label || k}</label>
                          <div className="flex items-center gap-1"><input type="number" step={PARAM_INFO[k]?.step || 1} className={clsx(inputCls, 'w-20')} value={v} onChange={(e) => editParam(i, k, Number(e.target.value))} />{PARAM_INFO[k]?.suffix && <span className="text-[11px] text-gray-400">{PARAM_INFO[k].suffix}</span>}</div></div>
                      ))}
                      <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">Görünüm</label><select className={inputCls} value={ty.design || 'standard'} onChange={(e) => editType(i, { design: e.target.value as BadgeType['design'] })}><option value="standard">Standart</option><option value="spotlight">Gösterişli (kampanya)</option><option value="bar">Bar (fiyat altı şerit)</option></select></div>
                      <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">Köşe</label><select className={inputCls} value={ty.corner || ''} onChange={(e) => editType(i, { corner: e.target.value as BadgeType['corner'] })}><option value="">Genel ayar</option><option value="top-left">Sol üst</option><option value="top-right">Sağ üst</option><option value="bottom-left">Sol alt</option><option value="bottom-right">Sağ alt</option></select></div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={ty.list} onChange={(e) => editType(i, { list: e.target.checked })} /> Liste</label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={ty.pdp} onChange={(e) => editType(i, { pdp: e.target.checked })} /> Ürün detay</label>
                    </div>
                    {isOpen && (
                      <div className="mt-3 pl-[52px]">
                        {samples.length === 0 ? <p className="text-xs text-gray-400">Örnek yok (kaydedip haritayı yenileyin).</p> : (
                          <div className="flex gap-2 overflow-x-auto pb-1">{samples.map((s) => (
                            <a key={s.pid} href={st.shop_url && s.url ? st.shop_url + s.url : undefined} target="_blank" rel="noreferrer" className="w-24 shrink-0">
                              <div className="aspect-[3/4] rounded-lg bg-gray-100 overflow-hidden">{s.image && <img src={s.image} alt="" className="w-full h-full object-cover" loading="lazy" />}</div>
                              <p className="text-[10px] text-gray-600 mt-1 line-clamp-2 leading-tight">{s.name}</p>
                              {s.value && <p className="text-[10px] font-semibold text-gray-800">{s.value.split('|')[0]}{ty.kind === 'bestseller' ? ' satış' : ty.kind === 'popular' ? ' görüntülenme' : ty.kind === 'low_stock' ? ' adet' : ''}</p>}
                            </a>))}</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => setPicker(!picker)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Plus size={13} /> Kampanya rozeti (kategori)</button>
              <button onClick={() => { const v = window.prompt('Ticimax etiket ID (Ürünler → Etiketler)'); const id = parseInt(v || '', 10); if (!id) return; setTypes((ts) => [{ id: 'tag_' + id, kind: 'tag', label: 'Sepette %5 İndirim', color: '#e3001b', icon: 'bolt', enabled: true, list: true, pdp: true, params: { tag_id: id, cart_pct: 5 } }, ...ts]); setTypesDirty(true) }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Plus size={13} /> Kampanya rozeti (etiket)</button>
              {missingKinds.map((k) => <button key={k} onClick={() => addKind(k)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Plus size={13} /> {KIND_INFO[k].name}</button>)}
            </div>
            {picker && <div className="mt-3"><CategoryPicker onPick={addCategory} /></div>}
          </Section>

          {/* 3 Görünüm */}
          <Section step="3" title="Görünüm" desc="Tüm rozetler tek tasarım dilini paylaşır; renk rozet bazında. Değişiklik anında kaydedilir, sağdaki önizleme günceller.">
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Stil</label><Seg value={t.style} options={[['solid', 'Dolu'], ['soft', 'Açık zemin'], ['outline', 'Çerçeve'], ['glass', 'Buzlu']]} onChange={(v) => patch('theme', { theme: { style: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Biçim</label><Seg value={t.shape} options={[['rounded', 'Yuvarlatılmış'], ['pill', 'Hap'], ['square', 'Köşeli'], ['ribbon', 'Bayrak']]} onChange={(v) => patch('theme', { theme: { shape: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Boyut</label><Seg value={t.size} options={[['s', 'Küçük'], ['m', 'Orta'], ['l', 'Büyük']]} onChange={(v) => patch('theme', { theme: { size: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Harf</label><Seg value={t.uppercase ? 'up' : 'no'} options={[['up', 'BÜYÜK'], ['no', 'Normal']]} onChange={(v) => patch('theme', { theme: { uppercase: v === 'up' } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Görseldeki konum</label><Seg value={t.list_position} options={[['top-left', 'Sol üst'], ['top-right', 'Sağ üst'], ['bottom-left', 'Sol alt'], ['bottom-right', 'Sağ alt']]} onChange={(v) => patch('theme', { theme: { list_position: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Dizilim</label><Seg value={t.list_direction} options={[['column', 'Alt alta'], ['row', 'Yan yana']]} onChange={(v) => patch('theme', { theme: { list_direction: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kenar boşluğu</label><select className={inputCls} value={t.list_offset} onChange={(e) => patch('theme', { theme: { list_offset: Number(e.target.value) } })}>{[0, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Mobilde konum</label><Seg value={t.mobile_bottom ? 'bottom' : 'same'} options={[['same', 'Aynı'], ['bottom', 'Alt köşeler']]} onChange={(v) => patch('theme', { theme: { mobile_bottom: v === 'bottom' } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Mobilde boyut (liste)</label><Seg value={t.mobile_compact ? 'compact' : 'normal'} options={[['normal', 'Normal'], ['compact', 'Kompakt']]} onChange={(v) => patch('theme', { theme: { mobile_compact: v === 'compact' } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Gölge</label><Seg value={t.shadow ? 'on' : 'off'} options={[['on', 'Var'], ['off', 'Yok']]} onChange={(v) => patch('theme', { theme: { shadow: v === 'on' } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sosyal kanıt kutusu</label><Seg value={t.proof_style} options={[['card', 'Çerçeveli'], ['plain', 'Yalın']]} onChange={(v) => patch('theme', { theme: { proof_style: v } })} /></div>
            </div>
          </Section>

          {/* 4 Gösterim kuralları */}
          <Section step="4" title="Gösterim kuralları" desc="Az ama anlamlı: kart başına 1–2 rozet tıklamayı artırır; daha fazlası gürültü olur ve görseli kapatır.">
            <div className="flex flex-wrap items-end gap-4 mb-3">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kart başına rozet</label><Seg value={String(r.list_max)} options={[['1', '1'], ['2', '2'], ['3', '3']]} onChange={(v) => patch('rules', { rules: { list_max: Number(v) } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Ürün detayda rozet yeri</label><Seg value={r.pdp_badge_position} options={[['image', 'Görselin köşesi'], ['price', 'Fiyatın altı'], ['title', 'Başlığın altı']]} onChange={(v) => { setView('pdp'); patch('rules', { rules: { pdp_badge_position: v } }) }} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Ürün detayda rozet</label><Seg value={String(r.pdp_max)} options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} onChange={(v) => patch('rules', { rules: { pdp_max: Number(v) } })} /></div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <Toggle on={exclusive} onChange={(v) => patch('rules', { rules: { exclusive: v ? ['bestseller', 'popular'] : [] } })} label="Çok Satan ↔ Popüler tekil" hint="Aynı kartta ikisinden yalnız sırada önce gelen." />
              <Toggle on={r.new_skip_category} onChange={(v) => patch('rules', { rules: { new_skip_category: v } })} label="Kampanyalı kartta 'Yeni' yok" hint="1+1 kopya kartları yeni açılır ama ürün eskidir." />
              <Toggle on={r.hide_out_of_stock} onChange={(v) => patch('rules', { rules: { hide_out_of_stock: v } })} label="Tükenen kartta rozet yok" hint="Ticimax zaten 'Tükendi' gösterir." />
            </div>
          </Section>

          {/* 5 Sosyal kanıt */}
          <Section step="5" title="Ürün detay: sosyal kanıt" desc="Fiyatın altında küçük bir kutu. Gerçek sipariş ve GA4 sayıları; eşiğin altındaki ürünlerde satır hiç çıkmaz. {n} sayıyla, {sizes} beden listesiyle değişir."
            right={<Mini on={r.proof_enabled} onChange={(v) => patch('rules', { rules: { proof_enabled: v } })} />}>
            <div className={clsx('space-y-2', !r.proof_enabled && 'opacity-50 pointer-events-none')}>
              <div className="flex flex-wrap items-center gap-4 mb-1">
                <label className="flex items-center gap-2 text-sm text-gray-700"><Mini on={r.proof_round} onChange={(v) => patch('rules', { rules: { proof_round: v } })} /> Aşağı yuvarla <span className="text-[11px] text-gray-400">(237 → 200+, gösterilen sayı gerçeği hiç aşmaz)</span></label>
                <div className="flex items-center gap-2 text-sm text-gray-700">Kutuda en fazla <Seg value={String(r.proof_max_lines)} options={[['2', '2'], ['3', '3'], ['4', '4']]} onChange={(v) => patch('rules', { rules: { proof_max_lines: Number(v) } })} /> satır</div>
              </div>
              <p className="text-[11px] text-gray-500 mb-1">Satırlar bu sırayla dolar; satış satırı ürün başına en güçlü pencereyi seçer (24 saat → 7 gün → 30 gün).</p>
              {([['proof_rank', 'proof_rank_min_qty', 'proof_rank_text', 'Kategori sırası (7 gün, ilk 3)', 'en az adet'], ['proof_sold_24h', 'proof_sold_24h_min', 'proof_sold_24h_text', 'Satış: son 24 saat', 'en az adet'], ['proof_sold_7d', 'proof_sold_7d_min', 'proof_sold_7d_text', 'Satış: son 7 gün (24 saat tutmazsa)', 'en az adet'], ['proof_sold_30d', 'proof_sold_30d_min', 'proof_sold_30d_text', 'Satış: son 30 gün (7 gün tutmazsa)', 'en az adet'], ['proof_cart', 'proof_cart_min', 'proof_cart_text', 'Sepetinde (son 24 saat, ödemesi tamamlanmamış)', 'en az kişi'], ['proof_fav', 'proof_fav_min', 'proof_fav_text', 'Favorilere ekleyen kişi', 'en az'], ['proof_sizes', 'proof_sizes_max_stock', 'proof_sizes_text', 'Azalan bedenler', 'beden stoğu ≤'], ['proof_atc', 'proof_atc_min', 'proof_atc_text', 'Sepete ekleme: son 7 gün (GA4)', 'en az'], ['proof_views', 'proof_views_min', 'proof_views_text', 'İnceleme: son 7 gün (GA4)', 'en az']] as const).map(([on, min, txt, l, ml]) => (
                <div key={on} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 p-3">
                  <Mini on={r[on]} onChange={(v) => patch('rules', { rules: { [on]: v } })} />
                  <span className="text-sm font-semibold text-gray-800 w-56">{l}</span>
                  <span className="text-[11px] text-gray-500">{ml}</span><input type="number" className={clsx(inputCls, 'w-20')} defaultValue={r[min]} onBlur={(e) => Number(e.target.value) !== r[min] && patch(min, { rules: { [min]: Number(e.target.value) } })} />
                  <input className={clsx(inputCls, 'flex-1 min-w-[200px]')} value={texts[txt] ?? ''} onChange={(e) => setTexts({ ...texts, [txt]: e.target.value })} onBlur={() => texts[txt] !== r[txt] && patch(txt, { rules: { [txt]: texts[txt] } })} />
                </div>
              ))}
            </div>
          </Section>

          {/* 6 Gelişmiş */}
          <Section step="6" title="Gelişmiş: tema seçicileri" desc="Varsayılanlar Ticimax içindir. Yerleşim: before:SEL / after:SEL / append:SEL / prepend:SEL, virgülle aday listesi (ilk görünen kullanılır)."
            right={<button onClick={() => { const d = st.defaults.rules; patch('sel', { rules: { list_card_selector: d.list_card_selector, list_id_selector: d.list_id_selector, list_image_selector: d.list_image_selector, pdp_image_mount: d.pdp_image_mount, pdp_price_mount: d.pdp_price_mount, pdp_badge_mount: d.pdp_badge_mount, pdp_proof_mount: d.pdp_proof_mount, hide_paths: d.hide_paths } }) }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılan</button>}>
            <div className="grid md:grid-cols-2 gap-3">
              {([['list_card_selector', 'Liste kartı'], ['list_id_selector', 'Kart ürün ID öğesi (data-id)'], ['list_image_selector', 'Kart görsel alanı (rozetin konduğu yer)'], ['pdp_image_mount', 'Ürün detay: görsel köşesi yerleşimi'], ['pdp_price_mount', 'Ürün detay: fiyat altı yerleşimi'], ['pdp_badge_mount', 'Ürün detay: başlık altı yerleşimi'], ['pdp_proof_mount', 'Sosyal kanıt yerleşimi'], ['hide_paths', 'Kapalı kalacağı yollar (önek, virgülle)']] as const).map(([k, l]) => (
                <div key={k}><label className="text-xs font-semibold text-gray-600">{l}</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1 font-mono text-xs')} value={texts[k] ?? ''} onChange={(e) => setTexts({ ...texts, [k]: e.target.value })} /><button onClick={() => patch(k, { rules: { [k]: texts[k] } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div></div>
              ))}
            </div>
          </Section>

          {/* 7 Analitik */}
          <Section step="7" title="Etki: rozetli kartlar daha çok tıklanıyor mu?" desc="Kart ekranda göründüğünde gösterim sayılır; karttaki bağlantıya dokunulunca tıklama. Rozetsiz kartların tıklama oranı karşılaştırma tabanıdır."
            right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((n) => <button key={n} onClick={() => setRange(n)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === n ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{n} gün</button>)}</div>}>
            {!an || an.cards === 0 ? (
              <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Script temaya eklenince burada birikir.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[['Oturum', an.sessions.toLocaleString('tr-TR')], ['Kart gösterimi', an.cards.toLocaleString('tr-TR')], ['Rozetli gösterim', an.cards ? `%${(an.badged_cards / an.cards * 100).toFixed(1)}` : '—'], ['Rozetsiz tıklama oranı', an.baseline.ctr != null ? `%${an.baseline.ctr}` : '—']].map(([l, v]) => (
                    <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p></div>
                  ))}
                </div>
                <table className="w-full text-sm"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1.5">Rozet</th><th className="py-1.5 text-right">Gösterim</th><th className="py-1.5 text-right">Tıklama</th><th className="py-1.5 text-right">Tıklama oranı</th><th className="py-1.5 text-right">Fark (rozetsize göre)</th><th className="py-1.5 text-right">Ürün detay</th></tr></thead>
                  <tbody>{an.types.map((x) => { const lift = x.ctr != null && an.baseline.ctr ? (x.ctr / an.baseline.ctr - 1) * 100 : null; return (
                    <tr key={x.id} className="border-b border-gray-50"><td className="py-1.5"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: x.color }} />{x.label}</td><td className="py-1.5 text-right">{x.impressions.toLocaleString('tr-TR')}</td><td className="py-1.5 text-right">{x.clicks.toLocaleString('tr-TR')}</td><td className="py-1.5 text-right">{x.ctr != null ? `%${x.ctr}` : '—'}</td>
                      <td className={clsx('py-1.5 text-right font-semibold', lift == null ? 'text-gray-400' : lift >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{lift == null ? '—' : `${lift >= 0 ? '+' : ''}${lift.toFixed(0)}%`}</td><td className="py-1.5 text-right text-gray-500">{x.pdp_views.toLocaleString('tr-TR')}</td></tr>) })}</tbody></table>
                <p className="text-[11px] text-gray-400">Not: çok satan/popüler ürünler rozetsiz de daha çok tıklanır; fark, rozetin tek başına etkisi değil, rozet + ürünün kendi çekiciliğidir. Rozetin net etkisi için aynı ürünlerde açık/kapalı dönem kıyası yapılmalı.</p>
              </div>
            )}
          </Section>
        </div>

        {/* Canlı önizleme */}
        <div className="lg:sticky lg:top-4 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><Smartphone size={13} /> Canlı önizleme</span><a href={demoUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-indigo-600"><ExternalLink size={13} /></a></div>
          <div className="mb-2"><Seg value={view} options={[['list', 'Liste'], ['pdp', 'Ürün detay']]} onChange={setView} /></div>
          <div className="rounded-2xl overflow-hidden bg-gray-900 p-1.5"><div className="rounded-xl overflow-hidden bg-white" style={{ height: 600 }}><PhoneFrame key={previewUrl} src={previewUrl} title="Rozet önizleme" /></div></div>
          <p className="text-[10.5px] text-gray-400 mt-2 leading-snug">Mağazanın gerçek ürünleri ve gerçek rozet haritasıyla çizilir. Rozet listesindeki kaydedilmemiş metin/renk değişiklikleri de burada görünür.</p>
        </div>
      </div>
    </div>
  )
}
