import { useCallback, useEffect, useState } from 'react'
import { PanelBottom, ExternalLink, Loader2, Check, Copy, ChevronUp, ChevronDown, Plus, Trash2, RotateCcw, Save, BarChart3, Smartphone } from 'lucide-react'
import clsx from 'clsx'
import { barApi, type BarSettings, type BarItem, type BarAnalytics } from '@/lib/croApi'

/* Mobil Alt Bar (CRO) — yalnız mobilde görünen alt navigasyon: tema galerisi (canlı telefon
   önizlemeleri), sekme editörü, dinamik alan kuralları, tıklama analitiği. */

const PRESET_META: Record<string, [string, string]> = {
  classic: ['Klasik', 'Beyaz zemin, üst köşeler yuvarlak, aktif sekmede üst çizgi. En güvenli seçim.'],
  soft: ['Yumuşak', 'Aktif ikonun arkasında pastel daire. Sıcak, yumuşak markalar.'],
  expand: ['Genişleyen', 'Pasif sekmeler yalnız ikon; aktif sekme vurgu renkli hap olarak açılıp etiketini gösterir.'],
  pill: ['Kapsül', 'Kenarlardan boşluklu yüzen kapsül; aktif ikon dolu yuvarlak karede.'],
  float: ['Orta Buton', 'Seçtiğin sekme ortada yükseltilmiş daire buton olur (kategori, arama veya sepet).'],
  gradient: ['Gradyan', 'Vurgu renginden koyuya geçen zemin, beyaz ikonlar. Cesur markalar.'],
  dark: ['Koyu', 'Siyah zemin, ışıltılı aktif sekme. Koyu temalı markalar.'],
  minimal: ['İnce Çizgi', 'En sade: ince bar, küçük ikonlar, alt çizgi göstergesi.'],
}
const TYPE_LABELS: Record<string, string> = { home: 'Anasayfa', categories: 'Kategoriler (alt sayfa)', search: 'Arama', cart: 'Sepet', account: 'Hesap', favorites: 'Favoriler', campaign: 'Kampanya (link)', whatsapp: 'WhatsApp', custom: 'Özel link' }
const ITEM_LABELS: Record<string, string> = { home: 'Anasayfa', categories: 'Kategoriler', search: 'Ara', cart: 'Sepetim', account: 'Hesabım', favorites: 'Favoriler', campaign: 'Kampanya', whatsapp: 'WhatsApp' }

/* 390px genişlikte render edilen demo iframe'i konteyner genişliğine ölçekler (gerçek telefon oranı). */
function PhoneFrame({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(0.4)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} loading="lazy" className="border-0 pointer-events-none" style={{ width: 390, height: 300 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

export default function CroBottomBarPage() {
  const [st, setSt] = useState<BarSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [items, setItems] = useState<BarItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [hidePaths, setHidePaths] = useState('')
  const [an, setAn] = useState<BarAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    barApi.settings().then((d) => { setSt(d); setDomains(d.domains); setItems(d.items); setHidePaths(d.rules.hide_paths); setDirty(false) })
      .catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { barApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await barApi.update(body); setSt(d); if (key !== 'items') setItems(d.items); setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const embed = st ? `<script src="${st.base_url}/widget/bottombar.js?v=1" data-tenant="${st.slug}"></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const demoUrl = (preset?: string, gallery = false) => st ? `/widget/bottombar-demo.html?tenant=${st.slug}${gallery ? '&gallery=1' : ''}${preset ? `&preset=${preset}` : ''}&cart=3&name=Ayşe` : '#'
  const previewUrl = (preset: string) => st ? `/widget/bottombar-demo.html?tenant=${st.slug}&preset=${preset}&cart=3&name=Ayşe&theme=${encodeURIComponent(JSON.stringify({ ...st.theme, preset }))}&k=${previewKey}` : ''

  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; const t = n[i]; n[i] = n[j]; n[j] = t; setItems(n); setDirty(true) }
  const setItem = (i: number, p: Partial<BarItem>) => { setItems(items.map((it, k) => (k === i ? { ...it, ...p } : it))); setDirty(true) }
  const addItem = (type: string) => {
    if (items.length >= 8) return
    const base = st?.default_items.find((d) => d.type === type)
    setItems([...items, base ? { ...base, enabled: true } : { key: `custom${items.length}`, type: 'custom', label: 'Yeni', icon: 'star', url: '/', enabled: true }]); setDirty(true)
  }
  const removeItem = (i: number) => { setItems(items.filter((_, k) => k !== i)); setDirty(true) }
  const enabledCount = items.filter((i) => i.enabled).length

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
    <div className="flex rounded-full bg-[var(--app-bg)] p-0.5">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={clsx('px-3 py-1.5 text-xs font-semibold rounded-full', value === v ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{l}</button>)}</div>
  )

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><PanelBottom size={24} /> Mobil Alt Bar
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Yalnız mobilde, ekranın altında sabit navigasyon. Sepet adedi, üye adı, kategori alt sayfası ve arama canlı; bulunulan sayfanın sekmesi aktif görünür.</p>
        </div>
        <a href={demoUrl(undefined, true)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Smartphone size={15} /> Tema galerisini aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      {/* 1 Kurulum */}
      <Section step="1" title="Kurulum" desc={`Masaüstünde hiç görünmez (eşik ${st.rules.max_width}px). Sepet ve ödeme akışında her zaman gizlidir (müşteri ödeme adımından geri dönmesin); üyelik sayfaları varsayılan listede.`}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Bar açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz." />
            <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
              <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
          </div>
          <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu (tüm sayfalara, {'</body>'} öncesi)</label>
            <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div></div>
        </div>
      </Section>

      {/* 2 Tema galerisi */}
      <Section step="2" title="Tema" desc="Her telefon canlı widget'tır; sekmelere dokunabilirsin. Tıkladığın tema anında kaydedilir. Sepet rozeti ve üye adı örnek veridir.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {st.presets.map((key) => (
            <div key={key} onClick={() => patch('theme', { theme: { preset: key } })} role="button" tabIndex={0} className={clsx('cursor-pointer rounded-2xl border-2 p-2 transition', st.theme.preset === key ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200 hover:border-indigo-300')}>
              {/* Gerçek telefon genişliğinde (390px) render edilip küçültülür; böylece bar orantılı görünür */}
              <div className="rounded-xl overflow-hidden bg-gray-900 p-1"><div className="rounded-lg overflow-hidden bg-white relative" style={{ height: 300 }}>
                <PhoneFrame src={previewUrl(key)} title={key} />
              </div></div>
              <div className="flex items-center gap-1.5 mt-2"><span className={clsx('w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center', st.theme.preset === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')}>{st.theme.preset === key && <Check size={9} className="text-white" strokeWidth={4} />}</span><span className="text-xs font-semibold text-gray-800">{PRESET_META[key]?.[0] ?? key}</span>
                <a href={demoUrl(key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-gray-400 hover:text-indigo-600"><ExternalLink size={12} /></a></div>
              <p className="text-[10.5px] text-gray-400 mt-0.5 leading-snug">{PRESET_META[key]?.[1]}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Vurgu rengi</label><div className="flex items-center gap-2"><input type="color" value={st.theme.accent} onChange={(e) => patch('theme', { theme: { accent: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{st.theme.accent}</code></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Zemin</label><div className="flex items-center gap-2"><input type="color" value={st.theme.bg} onChange={(e) => patch('theme', { theme: { bg: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{st.theme.bg}</code></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Pasif ikon rengi</label><div className="flex items-center gap-2"><input type="color" value={st.theme.ink} onChange={(e) => patch('theme', { theme: { ink: e.target.value } })} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{st.theme.ink}</code></div></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">İkon stili</label><Seg value={st.theme.icon_style} options={[['line', 'Çizgi'], ['solid', 'Dolu']]} onChange={(v) => patch('theme', { theme: { icon_style: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Etiketler</label><Seg value={st.theme.labels ? 'on' : 'off'} options={[['on', 'Göster'], ['off', 'Yalnız ikon']]} onChange={(v) => patch('theme', { theme: { labels: v === 'on' } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kaydırınca gizle</label><Seg value={st.theme.hide_on_scroll ? 'on' : 'off'} options={[['off', 'Hep görünür'], ['on', 'Aşağı kaydırınca gizle']]} onChange={(v) => patch('theme', { theme: { hide_on_scroll: v === 'on' } })} /></div>
          {st.theme.preset === 'float' && (
            <div><label className="text-xs font-semibold text-gray-600 block mb-1">Orta buton</label>
              <select className={inputCls} value={st.theme.center_item ?? ''} onChange={(e) => patch('theme', { theme: { center_item: e.target.value } })}>
                <option value="">Ortadaki sekme</option>
                {items.filter((i) => i.enabled).map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              </select></div>
          )}
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Gölge</label><Seg value={st.theme.show_shadow ? 'on' : 'off'} options={[['on', 'Var'], ['off', 'Yok']]} onChange={(v) => patch('theme', { theme: { show_shadow: v === 'on' } })} /></div>
        </div>
      </Section>

      {/* 3 Sekmeler */}
      <Section step="3" title="Sekmeler" desc="Sıra sitedeki sırayı belirler; 4-6 sekme önerilir. 'Yüzen + Orta Buton' temasında ortadaki sekme yükseltilir. Hesap sekmesi giriş yapmış üyede adı gösterir, sepet sekmesi adedi."
        right={<div className="flex items-center gap-2">
          <button onClick={() => patch('items', { items: null }).then(load)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılan</button>
          <button onClick={() => patch('items', { items }).then(() => setDirty(false))} disabled={!dirty || saving === 'items' || enabledCount < 2} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40">{saving === 'items' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Sekmeleri kaydet</button>
        </div>}>
        <div className="divide-y divide-gray-50">
          {items.map((it, i) => (
            <div key={it.key + i} className={clsx('py-2 flex flex-wrap items-center gap-2', !it.enabled && 'opacity-50')}>
              <div className="flex flex-col"><button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp size={14} /></button><button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown size={14} /></button></div>
              <button onClick={() => setItem(i, { enabled: !it.enabled })} className={clsx('w-9 h-5 rounded-full relative shrink-0', it.enabled ? 'bg-emerald-500' : 'bg-gray-300')}><span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', it.enabled ? 'left-[18px]' : 'left-0.5')} /></button>
              <span className="text-[11px] font-semibold rounded-full bg-[var(--app-bg)] text-gray-600 px-2 py-0.5 w-40 truncate">{TYPE_LABELS[it.type] ?? it.type}</span>
              <input value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} className={clsx(inputCls, 'w-32 py-1.5')} placeholder="Etiket" maxLength={20} />
              <select value={it.icon} onChange={(e) => setItem(i, { icon: e.target.value })} className={clsx(inputCls, 'py-1.5')}>{st.icons.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</select>
              {['custom', 'campaign', 'favorites', 'account', 'home'].includes(it.type) && <input value={it.url} onChange={(e) => setItem(i, { url: e.target.value })} className={clsx(inputCls, 'flex-1 min-w-[160px] py-1.5')} placeholder="/kampanya" />}
              <button onClick={() => removeItem(i)} className="ml-auto p-1.5 text-gray-400 hover:text-rose-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-semibold text-gray-500 mr-1">Ekle:</span>
          {st.item_types.filter((t) => t === 'custom' || !items.some((i) => i.type === t)).map((t) => <button key={t} onClick={() => addItem(t)} disabled={items.length >= 8} className="inline-flex items-center gap-1 text-xs rounded-full border border-gray-200 px-2.5 py-1 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40"><Plus size={11} /> {ITEM_LABELS[t] ?? TYPE_LABELS[t] ?? t}</button>)}
        </div>
      </Section>

      {/* 4 Dinamik alanlar */}
      <Section step="4" title="Dinamik alanlar ve davranış" desc="Anahtarlar tıklandığı anda kaydedilir.">
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          <Toggle on={st.rules.cart_badge} onChange={(v) => patch('rules', { rules: { cart_badge: v } })} label="Sepet adedi rozeti" hint="Ticimax sepet modelinden okunur; sepete ekleyince 1-2 sn içinde güncellenir." />
          <Toggle on={st.rules.account_name} onChange={(v) => patch('rules', { rules: { account_name: v } })} label="Üye adı" hint="Giriş yapmış ziyaretçide 'Hesabım' yerine adı görünür." />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kategoriler sekmesi</label><Seg value={st.rules.categories_source} options={[['yunbi', 'Yunbi alt sayfası'], ['theme', 'Temanın menüsü']]} onChange={(v) => patch('rules', { rules: { categories_source: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Arama sekmesi</label><Seg value={st.rules.search_action} options={[['yunbi', 'Akıllı Arama'], ['theme', 'Tema araması']]} onChange={(v) => patch('rules', { rules: { search_action: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sepet sekmesi</label><Seg value={st.rules.cart_action} options={[['page', 'Sepet sayfası'], ['side', 'Yan sepet paneli']]} onChange={(v) => patch('rules', { rules: { cart_action: v } })} /></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Alt sayfa derinliği</label><select className={inputCls} value={st.rules.sheet_levels} onChange={(e) => patch('rules', { rules: { sheet_levels: Number(e.target.value) } })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} seviye</option>)}</select></div>
          <div><label className="text-xs font-semibold text-gray-600 block mb-1">Mobil eşiği</label><select className={inputCls} value={st.rules.max_width} onChange={(e) => patch('rules', { rules: { max_width: Number(e.target.value) } })}>{[640, 768, 899, 1024].map((n) => <option key={n} value={n}>≤ {n}px</option>)}</select></div>
        </div>
        <div className="mt-4">
          <label className="text-xs font-semibold text-gray-600 block mb-2">Barın gizleneceği sayfalar (tıkladığın anda kaydedilir)</label>
          <div className="flex flex-wrap gap-2">
            {([['cart', 'Sepet ve ödeme'], ['product', 'Ürün detayı'], ['account', 'Hesap ve üyelik'], ['category', 'Kategori listesi'], ['home', 'Ana sayfa'], ['other', 'Diğer sayfalar']] as const).map(([k, l]) => {
              const always = k === 'cart'; const on = always || (st.rules.hide_page_types ?? []).includes(k)
              return <button key={k} disabled={always} onClick={() => { const cur = st.rules.hide_page_types ?? []; patch('rules', { rules: { hide_page_types: on ? cur.filter((x) => x !== k) : [...cur, k] } }) }}
                className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition', on ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400', always && 'opacity-80 cursor-not-allowed')}>
                {on ? '🚫' : '✓'} {l}{always && ' (her zaman)'}</button>
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Ürün detayında temanın alttaki "sepete ekle" barıyla çakışmaması için gizli tutulması önerilir. Sepet ve ödeme akışı hiçbir ayara bakmadan gizlidir.</p>
        </div>
        <div className="mt-3"><label className="text-xs font-semibold text-gray-600">Ek gizlenecek yollar (öneklerle, virgülle; isteğe bağlı)</label>
          <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={hidePaths} onChange={(e) => setHidePaths(e.target.value)} /><button onClick={() => patch('rules', { rules: { hide_paths: hidePaths } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div></div>
        {st.categories_preview.length > 0 && (
          <div className="mt-4 text-xs text-gray-500"><span className="font-semibold text-gray-600">Alt sayfada görünecek kategoriler: </span>{st.categories_preview.map((c) => `${c.name} (${c.count}${c.children?.length ? `, ${c.children.length} alt` : ''})`).join(' · ')}</div>
        )}
      </Section>

      {/* 5 Analitik */}
      <Section step="5" title="Tıklama analitiği" desc="Kaç ziyaretçi barı gördü, hangi sekmeye ne kadar tıkladı, hangi sayfada. Demo sayfası test olarak işaretlenir."
        right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((r) => <button key={r} onClick={() => setRange(r)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === r ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{r} gün</button>)}</div>}>
        {!an || an.sessions === 0 ? (
          <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Widget mobil ziyaretçilere ulaşınca burada birikir.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['Barı gören oturum', an.sessions.toLocaleString('tr-TR')], ['Tıklayan oturum', `%${an.engagement_rate}`], ['Toplam tıklama', an.clicks.toLocaleString('tr-TR')], ['Oturum başına tıklama', an.clicks_per_session]].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p></div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-5 text-sm">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Sekme bazında tıklama</p>
                {an.by_item.map((r) => { const max = an.by_item[0]?.c || 1; const it = items.find((x) => x.key === r.item); return (
                  <div key={r.item} className="mb-2"><div className="flex justify-between text-xs mb-0.5"><span className="font-semibold text-gray-700">{it?.label ?? r.item}</span><span className="text-gray-500">{r.c} tık · {r.s} oturum</span></div><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: Math.round(r.c / max * 100) + '%' }} /></div></div>) })}
                {an.sheet_opens > 0 && <p className="text-xs text-gray-500 mt-3">Kategori alt sayfası {an.sheet_opens} kez açıldı. En çok seçilen: {an.sheet_clicks.slice(0, 5).map((s) => `${s.value} (${s.c})`).join(', ')}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Hangi sayfada tıklandı</p>
                <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Sayfa</th><th className="py-1 text-right">Tık</th><th className="py-1 text-right">Oturum</th></tr></thead>
                  <tbody>{an.by_path.map((r) => <tr key={r.page_path} className="border-b border-gray-50"><td className="py-1 max-w-[260px] truncate text-gray-700">{r.page_path}</td><td className="py-1 text-right">{r.c}</td><td className="py-1 text-right text-gray-500">{r.s}</td></tr>)}</tbody></table>
                {an.by_page_type.length > 0 && <p className="text-xs text-gray-500 mt-3">Sayfa tipine göre: {Object.entries(an.by_page_type.reduce<Record<string, number>>((a, r) => { a[r.page_type] = (a[r.page_type] ?? 0) + r.c; return a }, {})).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
