import { useCallback, useEffect, useState } from 'react'
import { ShoppingBasket, ExternalLink, Loader2, Check, Copy, BarChart3, Plus, Trash2, RotateCcw, Truck, Percent, BadgeTurkishLira, Gift, Monitor, Smartphone, Sparkles, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { cartApi, type CartSettings, type CartAnalytics, type CartTier, type CartImpact, type CartImpactBlock } from '@/lib/croApi'

/* Sepet Kampanyası (CRO) — yan sepet (çekmece) ve sepet/checkout sayfasında kademeli kampanya çubuğu
   ("Ücretsiz kargo için 300 TL daha ekle" → "Sepette ek %5 için …"), satır fiyat/indirim vurgusu ve sepet özeti.
   Kampanyanın kendisi mağaza panelinde tanımlanır; Yunbi gösterir ve ölçer. */

const TIER_ICON = { shipping: Truck, percent: Percent, amount: BadgeTurkishLira, gift: Gift } as const
const TIER_NAME = { shipping: 'Ücretsiz kargo', percent: 'Yüzde indirim', amount: 'Tutar indirimi', gift: 'Hediye' } as const

function fmt(n: number) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' TL' }

export default function CroCartPage() {
  const [st, setSt] = useState<CartSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [tiers, setTiers] = useState<CartTier[]>([])
  const [tiersDirty, setTiersDirty] = useState(false)
  const [txt, setTxt] = useState<Record<string, string>>({})
  const [an, setAn] = useState<CartAnalytics | null>(null)
  const [imp, setImp] = useState<CartImpact | null>(null)
  const [impKey, setImpKey] = useState(0)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'side' | 'checkout'>('side')
  const [previewDevice, setPreviewDevice] = useState<'m' | 'd'>('d')

  const TEXT_KEYS = ['title', 'msg_next', 'msg_reached', 'msg_all', 'msg_empty', 'cta_text', 'cta_url', 'suggest_title', 'suggest_unlock', 'started_at', 'impact_sources', 'side_mount', 'checkout_mount', 'checkout_summary_mount', 'checkout_hide_selector', 'checkout_paths', 'hide_paths', 'currency'] as const

  const load = useCallback(() => {
    setLoading(true)
    cartApi.settings().then((d) => { setSt(d); setDomains(d.domains); setTiers(d.rules.tiers); const t: Record<string, string> = {}; TEXT_KEYS.forEach((k) => { t[k] = String(d.rules[k] ?? '') }); setTxt(t) })
      .catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { cartApi.analytics(range).then(setAn).catch(() => null) }, [range])
  useEffect(() => { cartApi.impact().then(setImp).catch(() => null) }, [impKey])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await cartApi.update(body); setSt(d); if (body.rules && (body.rules as { tiers?: unknown }).tiers) { setTiers(d.rules.tiers); setTiersDirty(false) } setPreviewKey((k) => k + 1); if (key === 'started_at' || key === 'impact_sources') setImpKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const embed = st ? `<script src="${st.base_url}/widget/cart.js?v=2" data-tenant="${st.slug}" async></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const previewUrl = st ? `/widget/cart-demo.html?tenant=${st.slug}&mode=${previewMode}&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify(st.rules))}&k=${previewKey}` : ''
  const demoUrl = st ? `/widget/cart-demo.html?tenant=${st.slug}` : '#'

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
  const Color = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div><label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label><div className="flex items-center gap-2"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><code className="text-xs text-gray-500">{value}</code></div></div>
  )
  const TextField = ({ k, label, hint, mono }: { k: typeof TEXT_KEYS[number]; label: string; hint?: string; mono?: boolean }) => (
    <div><label className="text-xs font-semibold text-gray-600">{label}</label>
      <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1', mono && 'font-mono text-xs')} value={txt[k] ?? ''} onChange={(e) => setTxt({ ...txt, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') patch(k, { rules: { [k]: txt[k] } }) }} />
        <button onClick={() => patch(k, { rules: { [k]: txt[k] } })} disabled={saving === k} className={clsx('px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-60', st && String(st.rules[k] ?? '') !== (txt[k] ?? '') ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500')}>Kaydet</button></div>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}</div>
  )

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const t = st.theme, r = st.rules

  const setTier = (i: number, p: Partial<CartTier>) => { setTiers(tiers.map((x, j) => (j === i ? { ...x, ...p } : x))); setTiersDirty(true) }
  const addTier = () => { const last = tiers[tiers.length - 1]; setTiers([...tiers, { threshold: last ? Math.round(last.threshold * 2) : 1500, type: 'percent', value: last && last.type === 'percent' ? last.value + 5 : 5, label: '', short: '' }]); setTiersDirty(true) }
  const delTier = (i: number) => { setTiers(tiers.filter((_, j) => j !== i)); setTiersDirty(true) }
  const saveTiers = () => patch('tiers', { rules: { tiers: tiers.map((x) => ({ ...x, threshold: Number(x.threshold) || 0, value: Number(x.value) || 0 })) } })

  const tierLabel = (x: CartTier) => x.label || (x.type === 'shipping' ? 'Ücretsiz Kargo' : x.type === 'percent' ? `Sepette Ek %${x.value} İndirim` : x.type === 'amount' ? `${x.value} TL İndirim` : 'Hediye')

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><ShoppingBasket size={24} /> Sepet Kampanyası
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Yan sepette ve sepet sayfasında kademeli kampanya çubuğu: "Ücretsiz kargo için 300 TL daha ekle" → "Sepette ek %5 için…". Kalan tutar büyük, sıradaki kademenin parasal değeri altında ("en az 125 TL ek indirim"); kazanılan kademeler yeşil, sıradaki nabız atar. Altında "Sepetini tamamla" ürün önerileri (+ Ekle). Satır fiyatları indirim rozetiyle, sepet özeti liste fiyatı / indirim / kargo / kazanç satırlarıyla gösterilir. Kampanyanın kendisi mağaza panelinde tanımlanır.</p>
        </div>
        <a href={demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><ExternalLink size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="grid xl:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="space-y-5">
          {/* 1 Kurulum */}
          <Section step="1" title="Kurulum" desc="Tek satır embed tüm tema sayfalarına (yan sepet için). Ticimax'ın yeni sepet/checkout sayfası (checkout-ui) tema scriptlerini YÜKLEMEZ: oraya script yalnız Google Tag Manager ile girer → Ticimax panelinde GTM kimliği tanımlı olmalı (Ayarlar › Dijital Pazarlama › Google Tag Manager) ve GTM'de 'Custom HTML' etiketi (tetikleyici: All Pages) olarak aynı embed satırı eklenmelidir.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Sepet kampanyası açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz." />
                <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
                <div className="grid grid-cols-2 gap-2">
                  <Toggle on={r.side_enabled} onChange={(v) => patch('side', { rules: { side_enabled: v } })} label="Yan sepet" hint="Sağdan açılan sepet çekmecesi" />
                  <Toggle on={r.checkout_enabled} onChange={(v) => patch('co', { rules: { checkout_enabled: v } })} label="Sepet sayfası" hint="/checkout sepet adımı" />
                </div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600">Embed kodu (tema {'</body>'} öncesi + GTM Custom HTML)</label>
                <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div>
                <p className="text-[11px] text-gray-400 mt-1.5">Çift yüklemeye karşı korumalıdır; hangi yüzeyde olduğunu sayfa yolundan anlar. Her widget güncellemesinde <code>?v</code> artırılır (CDN önbelleği).</p></div>
            </div>
          </Section>

          {/* 2 Kademeler */}
          <Section step="2" title="Kampanya kademeleri" desc="Eşikler artan sırada; her kademe için tür (ücretsiz kargo / yüzde / tutar / hediye), değer ve müşteriye görünen metin. Kısa ad çubuğun altındaki nokta etiketidir (örn. 'Kargo', '%5')."
            right={<div className="flex gap-2">{tiersDirty && <button onClick={() => { setTiers(r.tiers); setTiersDirty(false) }} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Vazgeç</button>}<button onClick={saveTiers} disabled={!tiersDirty || saving === 'tiers'} className={clsx('px-3 py-1.5 rounded-xl text-sm font-semibold disabled:opacity-50', tiersDirty ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500')}>{saving === 'tiers' ? 'Kaydediliyor…' : 'Kademeleri kaydet'}</button></div>}>
            <div className="space-y-2">
              {tiers.map((x, i) => { const Ic = TIER_ICON[x.type]; return (
                <div key={i} className="grid grid-cols-[36px_105px_135px_80px_minmax(120px,1fr)_90px_36px] gap-2 items-center rounded-xl border border-gray-100 p-2">
                  <span className="w-9 h-9 rounded-full bg-[var(--app-bg)] flex items-center justify-center text-gray-700"><Ic size={16} /></span>
                  <div><label className="text-[10px] text-gray-400 font-semibold uppercase">Eşik (TL)</label><input type="number" min={1} className={clsx(inputCls, 'w-full')} value={x.threshold} onChange={(e) => setTier(i, { threshold: Number(e.target.value) })} /></div>
                  <div><label className="text-[10px] text-gray-400 font-semibold uppercase">Tür</label><select className={clsx(inputCls, 'w-full')} value={x.type} onChange={(e) => setTier(i, { type: e.target.value as CartTier['type'], label: '', short: '' })}>{(Object.keys(TIER_NAME) as CartTier['type'][]).map((k) => <option key={k} value={k}>{TIER_NAME[k]}</option>)}</select></div>
                  <div><label className="text-[10px] text-gray-400 font-semibold uppercase">{x.type === 'percent' ? 'Yüzde' : x.type === 'amount' ? 'Tutar' : 'Değer'}</label><input type="number" min={0} disabled={x.type === 'shipping' || x.type === 'gift'} className={clsx(inputCls, 'w-full disabled:opacity-40')} value={x.value} onChange={(e) => setTier(i, { value: Number(e.target.value) })} /></div>
                  <div><label className="text-[10px] text-gray-400 font-semibold uppercase">Müşteriye görünen ad</label><input className={clsx(inputCls, 'w-full')} placeholder={tierLabel(x)} value={x.label} onChange={(e) => setTier(i, { label: e.target.value })} /></div>
                  <div><label className="text-[10px] text-gray-400 font-semibold uppercase">Kısa ad</label><input className={clsx(inputCls, 'w-full')} maxLength={14} placeholder={x.type === 'shipping' ? 'Kargo' : x.type === 'percent' ? `%${x.value}` : x.type === 'amount' ? `${x.value} TL` : 'Hediye'} value={x.short} onChange={(e) => setTier(i, { short: e.target.value })} /></div>
                  <button onClick={() => delTier(i)} className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
                </div>) })}
              {tiers.length < 6 && <button onClick={addTier} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1"><Plus size={15} /> Kademe ekle</button>}
            </div>
            <div className="flex flex-wrap items-end gap-4 mt-4 pt-4 border-t border-gray-50">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Eşik hangi tutara göre</label><Seg value={r.basis} options={[['before_discount', 'Kampanya öncesi sepet tutarı'], ['after_discount', 'Kampanya sonrası (ödenecek)']]} onChange={(v) => patch('basis', { rules: { basis: v } })} /><p className="text-[11px] text-gray-400 mt-1">Ürün indirimleri her iki seçimde de düşülmüştür; fark yalnız sepet kampanyası indirimidir. Mağaza panelindeki kampanya kuralıyla aynı olmalı.</p></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Para birimi yazımı</label><Seg value={r.currency === '₺' ? '₺' : 'TL'} options={[['TL', '1.500 TL'], ['₺', '₺1.500']]} onChange={(v) => patch('currency', { rules: { currency: v } })} /></div>
            </div>
          </Section>

          {/* 3 Metinler */}
          <Section step="3" title="Metinler" desc="Yer tutucular: {label} kademe adı · {short} kısa ad · {remaining} kalan tutar · {threshold} eşik. Enter ile de kaydedilir.">
            <div className="grid md:grid-cols-2 gap-3">
              <TextField k="title" label="Başlık" />
              <TextField k="msg_empty" label="Sepet boşken" />
              <TextField k="msg_next" label="Sıradaki kademe" hint="Örn. {label} için {remaining} daha ekle" />
              <TextField k="msg_reached" label="Kademe kazanılınca" hint="Örn. {label} kazandın!" />
              <TextField k="msg_all" label="Tüm kademeler kazanılınca" />
            </div>
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              <Toggle on={r.show_savings} onChange={(v) => patch('show_savings', { rules: { show_savings: v } })} label="'Kazancın X TL' rozeti" hint="Ürün indirimi + kampanya indirimi toplamı; çubuk başlığında ve özette." />
              <Toggle on={r.show_value} onChange={(v) => patch('show_value', { rules: { show_value: v } })} label="Sıradaki kademenin parasal değeri" hint="'En az 125 TL ek indirim' / 'Kargo ücreti ödemezsin' — kalan tutarın hemen altında." />
            </div>
            <div className="flex flex-wrap items-end gap-4 mt-3">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Standart kargo ücreti (TL)</label><div className="flex gap-2"><input type="number" min={0} className={clsx(inputCls, 'w-28')} value={txt.shipping_fee ?? String(r.shipping_fee ?? 0)} onChange={(e) => setTxt({ ...txt, shipping_fee: e.target.value })} /><button onClick={() => patch('shipping_fee', { rules: { shipping_fee: Number(txt.shipping_fee ?? r.shipping_fee) || 0 } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div><p className="text-[11px] text-gray-400 mt-1">0 ise "Kargo ücreti ödemezsin", doluysa "89 TL kargo ücreti bedava" yazar.</p></div>
            </div>
            <details className="mt-3 rounded-xl border border-gray-100 p-3">
              <summary className="text-xs font-semibold text-gray-600 cursor-pointer">Ek bağlantı butonu (isteğe bağlı; varsayılan kapalı — öneri şeridi bunun yerini alır)</summary>
              <div className="grid grid-cols-2 gap-3 mt-3"><TextField k="cta_text" label="Buton metni" /><TextField k="cta_url" label="Buton bağlantısı" hint="Örn. indirimli ürünler / kampanya sayfası" /></div>
              <div className="mt-2"><Toggle on={r.show_cta} onChange={(v) => patch('show_cta', { rules: { show_cta: v } })} label="Bağlantı butonunu göster" hint="Tüm kademeler kazanılınca gizlenir." /></div>
            </details>
          </Section>

          {/* 3b Sepetini tamamla */}
          <Section step="3b" title="Sepetini tamamla: ürün önerileri" desc="Çubuğun altında, sıradaki avantajı tek başına açan ürünler önde (en ucuzu ilk sırada), sepetteki numaraya uygun, fotoğraflı; '+ Ekle' ile sayfa yenilenmeden sepete girer. Ürünler Ürün Öneri motorundan gelir (birlikte alım → kategori → en çok satanlar); orada sabitlenen ürünler burada da öne çıkar."
            right={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600"><Sparkles size={13} /> satışa dönük</span>}>
            <div className="grid sm:grid-cols-2 gap-2">
              <Toggle on={r.suggest_enabled} onChange={(v) => patch('suggest_enabled', { rules: { suggest_enabled: v } })} label="Ürün önerileri açık" />
              <Toggle on={r.suggest_hide_all} onChange={(v) => patch('suggest_hide_all', { rules: { suggest_hide_all: v } })} label="Tüm kademeler kazanılınca gizle" hint="Kapalıysa en üst kademede de öneri gösterilir." />
              <Toggle on={r.suggest_side} onChange={(v) => patch('suggest_side', { rules: { suggest_side: v } })} label="Yan sepette" />
              <Toggle on={r.suggest_checkout} onChange={(v) => patch('suggest_checkout', { rules: { suggest_checkout: v } })} label="Sepet sayfasında" />
            </div>
            <div className="grid md:grid-cols-[1fr_1fr_120px] gap-3 mt-3">
              <TextField k="suggest_title" label="Şerit başlığı" />
              <TextField k="suggest_unlock" label="Eşiği açan ürün etiketi" hint="{label} sıradaki kademe adı" />
              <div><label className="text-xs font-semibold text-gray-600 block">Kart sayısı</label><select className={clsx(inputCls, 'mt-1 w-full')} value={r.suggest_max} onChange={(e) => patch('suggest_max', { rules: { suggest_max: Number(e.target.value) } })}>{[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            </div>
          </Section>

          {/* 4 Görünüm */}
          <Section step="4" title="Görünüm" desc="Değişiklikler anında kaydedilir; sağdaki önizleme birebir uygulanır.">
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kutu stili</label><Seg value={t.style} options={[['card', 'Kart (çerçeveli)'], ['flat', 'Düz']]} onChange={(v) => patch('theme', { theme: { style: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe</label><select className={inputCls} value={t.radius} onChange={(e) => patch('theme', { theme: { radius: Number(e.target.value) } })}>{[0, 6, 10, 12, 16, 20].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
              <Color label="Çubuk / başlık" value={t.accent} onChange={(v) => patch('theme', { theme: { accent: v } })} />
              <Color label="Sıradaki kademe / kalan tutar" value={t.accent2} onChange={(v) => patch('theme', { theme: { accent2: v } })} />
              <Color label="Kazanılan / indirimli fiyat" value={t.ok} onChange={(v) => patch('theme', { theme: { ok: v } })} />
              <Color label="İndirim rozeti (%50)" value={t.badge_color} onChange={(v) => patch('theme', { theme: { badge_color: v } })} />
              <Color label="Metin" value={t.ink} onChange={(v) => patch('theme', { theme: { ink: v } })} />
              <Color label="Soluk metin" value={t.muted} onChange={(v) => patch('theme', { theme: { muted: v } })} />
              <Color label="Zemin" value={t.bg} onChange={(v) => patch('theme', { theme: { bg: v } })} />
              <Color label="Boş çubuk" value={t.track} onChange={(v) => patch('theme', { theme: { track: v } })} />
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kutlama</label><Seg value={t.celebrate ? 'on' : 'off'} options={[['on', 'Konfeti'], ['off', 'Yok']]} onChange={(v) => patch('theme', { theme: { celebrate: v === 'on' } })} /></div>
            </div>
          </Section>

          {/* 5 Yüzeyler */}
          <Section step="5" title="Fiyat gösterimi ve özet" desc="Satırlarda liste fiyatı üstü çizili, indirimli fiyat vurgulu ve '%50 indirim' rozeti; altta liste fiyatı / ürün indirimi / kampanya indirimi / kargo / toplam / kazanç satırları (temanın kendi satırlarının yerine).">
            <div className="grid sm:grid-cols-2 gap-2">
              <Toggle on={r.side_price} onChange={(v) => patch('side_price', { rules: { side_price: v } })} label="Yan sepet: fiyat/indirim vurgusu" />
              <Toggle on={r.side_summary} onChange={(v) => patch('side_summary', { rules: { side_summary: v } })} label="Yan sepet: özet satırları" hint="Temanın genel toplam/indirim satırları yerine." />
              <Toggle on={r.checkout_price} onChange={(v) => patch('checkout_price', { rules: { checkout_price: v } })} label="Sepet sayfası: fiyat/indirim vurgusu" />
              <Toggle on={r.checkout_summary} onChange={(v) => patch('checkout_summary', { rules: { checkout_summary: v } })} label="Sepet sayfası: özet satırları" hint="Sipariş özeti kartının başına eklenir; temanın satırları kalır." />
            </div>
          </Section>

          {/* 6 Gelişmiş */}
          <Section step="6" title="Gelişmiş: tema seçicileri" desc="Varsayılanlar Ticimax içindir. Yerleşim sözdizimi: before:SEL / after:SEL / prepend:SEL / append:SEL — virgülle birden çok aday, ilk görünen kazanır."
            right={<button onClick={() => { const d = st.defaults.rules; const keys = ['side_mount', 'checkout_mount', 'checkout_summary_mount', 'checkout_hide_selector', 'checkout_paths', 'hide_paths'] as const; const p: Record<string, string> = {}; keys.forEach((k) => { p[k] = d[k] }); setTxt({ ...txt, ...p }); patch('rules', { rules: p }) }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılan</button>}>
            <div className="grid md:grid-cols-2 gap-3">
              <TextField k="side_mount" label="Yan sepette çubuğun yeri" mono />
              <TextField k="checkout_mount" label="Sepet sayfasında çubuğun yeri" mono />
              <TextField k="checkout_summary_mount" label="Sepet sayfasında özetin yeri" mono />
              <TextField k="checkout_hide_selector" label="Gizlenecek tema öğeleri (sepet sayfası)" hint="Temanın kendi 'ücretsiz kargoya X kaldı' bandı" mono />
              <TextField k="checkout_paths" label="Sepet sayfası yolları" hint="Bu öneklerde checkout modu çalışır" mono />
              <TextField k="hide_paths" label="Widget'ın kapalı kalacağı yollar" mono />
            </div>
          </Section>

          {/* 7 Analitik */}
          <Section step="7" title="Etkileşim analitiği" desc="Çubuğu gören oturumlar, kademe dağılımı (oturumun son sepet tutarına göre), eşiğe yakın kalan oturumlar ve kazanılan kademeler."
            right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((n) => <button key={n} onClick={() => setRange(n)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === n ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{n} gün</button>)}</div>}>
            {!an || an.sessions === 0 ? (
              <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Widget ziyaretçiye ulaşınca burada birikir.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[['Çubuğu gören oturum', an.sessions.toLocaleString('tr-TR')], ['Ortalama sepet', fmt(an.avg_basis)], ['Kademe kazanan', an.unlocks.reduce((a, u) => a + u.s, 0).toLocaleString('tr-TR')], ['Öneriden sepete ekleme', `${(an.adds ?? 0).toLocaleString('tr-TR')} · %${an.add_rate ?? 0}`, `öneri gören ${(an.suggest_sessions ?? 0).toLocaleString('tr-TR')} oturumun ${(an.add_sessions ?? 0).toLocaleString('tr-TR')}'i ekledi`]].map(([l, v, sub]) => (
                    <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p>{sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}</div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Oturumların son durumu: kaç kademe kazanılmıştı</p>
                    {an.tier_dist.map((d) => { const max = Math.max(...an.tier_dist.map((x) => x.c), 1); return (
                      <div key={d.tier} className="mb-1.5"><div className="flex justify-between text-xs mb-0.5"><span className="font-semibold text-gray-700">{d.tier === 0 ? 'Hiç kademe yok' : `${d.tier}. kademe: ${tierLabel(r.tiers[d.tier - 1] || r.tiers[r.tiers.length - 1])}`}</span><span className="text-gray-500">{d.c} · ort. {fmt(Number(d.avg_basis))}</span></div><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: Math.round(d.c / max * 100) + '%' }} /></div></div>) })}
                    <p className="text-xs text-gray-500 mt-3">Yüzeyler: {an.by_surface.map((s) => `${s.surface === 'side' ? 'yan sepet' : 'sepet sayfası'} ${s.s} oturum`).join(' · ')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Eşiğe yakın kalanlar (son durumda kalan ≤ %15)</p>
                    {an.near_miss.length === 0 ? <p className="text-xs text-gray-400">Yok</p> : (
                      <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Sıradaki kademe</th><th className="py-1 text-right">Oturum</th><th className="py-1 text-right">Ort. kalan</th></tr></thead>
                        <tbody>{an.near_miss.map((m) => <tr key={m.tier} className="border-b border-gray-50"><td className="py-1 text-gray-700">{tierLabel(r.tiers[m.tier] || r.tiers[r.tiers.length - 1])}</td><td className="py-1 text-right">{m.c}</td><td className="py-1 text-right text-gray-500">{fmt(Number(m.avg_remaining))}</td></tr>)}</tbody></table>
                    )}
                    <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Kazanılan kademeler</p>
                    {an.unlocks.length === 0 ? <p className="text-xs text-gray-400">Henüz yok</p> : an.unlocks.map((u) => <p key={u.tier} className="text-xs text-gray-700">{u.tier}. kademe ({tierLabel(r.tiers[u.tier - 1] || r.tiers[r.tiers.length - 1])}): <b>{u.s}</b> oturum</p>)}
                    {(an.top_added ?? []).length > 0 && <><p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Öneriden en çok eklenen ürünler</p>{an.top_added.map((p) => <p key={p.id} className="text-xs text-gray-700 truncate">{p.name}: <b>{p.c}</b></p>)}</>}
                    {(an.add_fails ?? 0) > 0 && <p className="text-xs text-amber-600 mt-2">Ekleme başarısız (ürün sayfasına yönlendirildi): {an.add_fails}</p>}
                    {an.errors.length > 0 && <p className="text-xs text-rose-600 mt-3">Hatalar: {an.errors.map((e) => `${e.value} (${e.c})`).join(', ')}</p>}
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* 8 Kampanya etkisi */}
          <Section step="8" title="Kampanya etkisi: ciro kıyası" desc="Kampanyanın mağazada canlıya alındığı andan itibaren gelen siparişler (adet, ciro, ortalama sepet, eşik bantları, sepet indirimi uygulanan) önceki dönemlerle kıyaslanır: son 28 günün AYNI SAAT penceresi günlük ortalaması, aynı haftanın günü (4 hafta) ve önceki 3 tam ay. Sipariş tarihi mağaza saatidir; yalnız seçili kaynaklar sayılır."
            right={<button onClick={() => setImpKey((k) => k + 1)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Yenile</button>}>
            <div className="grid md:grid-cols-2 gap-3 mb-4">
              <TextField k="started_at" label="Kampanya başlangıcı (mağaza saati, YYYY-AA-GG SS:DD)" hint="Kıyas bu andan itibaren yapılır." mono />
              <TextField k="impact_sources" label="Sayılan sipariş kaynakları" hint="Virgülle; boş = tüm kanallar. Örn. TicimaxWeb,NativeAndroid,NativeIOS" mono />
            </div>
            {!imp || !imp.campaign ? (
              <div className="text-sm text-gray-500 flex items-center gap-2"><TrendingUp size={16} className="text-gray-300" /> {imp?.message || 'Başlangıç anı girildiğinde kıyas burada görünür.'}</div>
            ) : (() => {
              const c = imp.campaign as CartImpactBlock, b28 = imp.baseline_28d as CartImpactBlock, bd = imp.baseline_dow as CartImpactBlock, b3 = imp.baseline_3m as CartImpactBlock
              const same = !!imp.same_day_window
              const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b - 1) * 100) : null)
              const nf = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 })
              const Delta = ({ a, b, unit }: { a: number; b: number; unit: string }) => { const d = pct(a, b); if (d === null) return <span className="text-gray-400">—</span>; const diff = a - b; return <span className={clsx('text-[11px] font-bold whitespace-nowrap', diff >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{d > 0 ? '+' : ''}{d}% <span className="font-semibold opacity-80">({diff >= 0 ? '+' : '−'}{nf(Math.abs(unit === ' TL' ? Math.round(diff) : diff))}{unit})</span></span> }
              const share0 = (x: CartImpactBlock, i: number) => x.bands[i]?.share ?? 0
              // pay satırlarında adet: sipariş satırıyla aynı birim (aynı gün → kampanya pencere toplamı, diğerleri günlük ort.)
              const Cnt = ({ x, cmp, n }: { x: CartImpactBlock; cmp: boolean; n: number }) => <span className="font-normal text-gray-400" title={`Dönem toplamı: ${n.toLocaleString('tr-TR')} sipariş`}> · {nf(cmp && same ? n : x.days > 0 ? n / x.days : 0)}{cmp && same ? ' sip.' : '/gün'}</span>
              const rows: [string, (x: CartImpactBlock, campaign: boolean) => string, (x: CartImpactBlock, campaign: boolean) => number, string, ((x: CartImpactBlock) => number)?][] = [
                [same ? 'Sipariş (pencere / günlük ort.)' : 'Sipariş / gün', (x, cmp) => (cmp && same ? x.orders : (x.orders_per_day ?? 0)).toLocaleString('tr-TR'), (x, cmp) => (cmp && same ? x.orders : (x.orders_per_day ?? 0)), ''],
                [same ? 'Ciro (pencere / günlük ort.)' : 'Ciro / gün', (x, cmp) => fmt(cmp && same ? x.revenue : (x.revenue_per_day ?? 0)), (x, cmp) => (cmp && same ? x.revenue : (x.revenue_per_day ?? 0)), ' TL'],
                ['Ortalama sepet', (x) => fmt(x.aov), (x) => x.aov, ' TL'],
                ...(imp.tiers || []).map((th, i): [string, (x: CartImpactBlock) => string, (x: CartImpactBlock) => number, string, (x: CartImpactBlock) => number] => [`≥ ${th.toLocaleString('tr-TR')} TL sipariş payı`, (x) => `%${share0(x, i)}`, (x) => share0(x, i), ' puan', (x) => x.bands[i]?.orders ?? 0]),
                ['Sepet indirimi uygulanan payı', (x) => `%${x.disc_share}`, (x) => x.disc_share, ' puan', (x) => x.disc],
              ]
              return (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">Başlangıç <b>{imp.started_at}</b> → şimdi <b>{imp.now}</b>{same ? ' (aynı gün: geçmiş dönemlerde de yalnız bu saat aralığı sayılır)' : ` (${c.days} gün)`} · kampanya penceresinde <b>{c.orders}</b> sipariş, <b>{fmt(c.revenue)}</b> ciro.</p>
                  <div className="overflow-x-auto"><table className="w-full text-xs">
                    <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1.5">Metrik</th><th className="py-1.5 text-right">Kampanya</th><th className="py-1.5 text-right">Son 28 gün{same ? ' (aynı saat)' : ''}</th><th className="py-1.5 text-right">Aynı gün (4 hf)</th><th className="py-1.5 text-right">Önceki 3 ay</th></tr></thead>
                    <tbody>{rows.map(([l, f, v, unit, n]) => (
                      <tr key={l} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 font-semibold">{l}</td><td className="py-1.5 text-right font-extrabold text-gray-900 whitespace-nowrap">{f(c, true)}{n && <Cnt x={c} cmp n={n(c)} />}</td>
                        {[b28, bd, b3].map((x, j) => <td key={j} className="py-1.5 pl-3 text-right text-gray-600"><span className="whitespace-nowrap">{f(x, false)}{n && <Cnt x={x} cmp={false} n={n(x)} />}</span> <Delta a={v(c, true)} b={v(x, false)} unit={unit} /></td>)}</tr>))}</tbody>
                  </table></div>
                  <p className="text-[11px] text-gray-400">Yüzde farklar kampanya penceresinin ilgili dönemin ortalamasına göre değişimidir; parantez içi aynı farkın adet / TL / puan karşılığıdır. Pay satırlarında yüzdenin yanındaki sayı o gruptaki sipariş adedidir (üzerine gelince dönem toplamı). "Sepet indirimi uygulanan" = sipariş kaydında indirim tutarı &gt; 0 (kupon dahil). İlk saatlerde örneklem küçüktür; birkaç gün sonra anlamlıdır.</p>
                  {(imp.daily || []).length > 0 && (
                    <div><p className="text-xs font-semibold text-gray-500 mb-2">Günlük seri (başlangıçtan 14 gün önce → bugün)</p>
                      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Gün</th><th className="py-1 text-right">Sipariş</th><th className="py-1 text-right">Ciro</th><th className="py-1 text-right">Ort. sepet</th><th className="py-1 text-right">≥ {(imp.tiers || [])[0]?.toLocaleString('tr-TR')} TL payı</th><th className="py-1 text-right">İndirimli</th></tr></thead>
                        <tbody>{imp.daily!.map((r) => { const on = r.d >= (imp.started_at || '').slice(0, 10); return <tr key={r.d} className={clsx('border-b border-gray-50', on && 'bg-emerald-50/60')}><td className="py-1 text-gray-700">{r.d}{on && <span className="ml-1 text-[9px] font-bold text-emerald-600">KAMPANYA</span>}</td><td className="py-1 text-right">{r.c}</td><td className="py-1 text-right">{fmt(Number(r.rev))}</td><td className="py-1 text-right">{fmt(Number(r.aov))}</td><td className="py-1 text-right">{Number(r.ge0).toLocaleString('tr-TR')} <span className="text-gray-400">· %{r.c ? Math.round(r.ge0 / r.c * 100) : 0}</span></td><td className="py-1 text-right">{Number(r.disc).toLocaleString('tr-TR')} <span className="text-gray-400">· %{r.c ? Math.round(r.disc / r.c * 100) : 0}</span></td></tr> })}</tbody></table></div></div>
                  )}
                </div>
              )
            })()}
          </Section>
        </div>

        {/* Canlı önizleme */}
        <div className="xl:sticky xl:top-4 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-xs font-bold text-gray-700">Canlı önizleme</span>
            <div className="flex items-center gap-1">
              <Seg value={previewMode} options={[['side', 'Yan sepet'], ['checkout', 'Sepet sayfası']]} onChange={setPreviewMode} />
              <button onClick={() => setPreviewDevice(previewDevice === 'd' ? 'm' : 'd')} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Cihaz">{previewDevice === 'd' ? <Monitor size={14} /> : <Smartphone size={14} />}</button>
              <a href={demoUrl} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-indigo-600"><ExternalLink size={13} /></a>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden bg-gray-900 p-1.5"><div className="rounded-xl overflow-hidden bg-white mx-auto" style={{ height: 640, width: previewDevice === 'm' ? 360 : '100%' }}><iframe key={previewKey + previewMode + previewDevice} title="Sepet önizleme" src={previewUrl + '&device=' + previewDevice} className="border-0 w-full h-full" /></div></div>
          <p className="text-[10.5px] text-gray-400 mt-2 leading-snug">Örnek sepet; alttaki kaydırıcıyla sepet tutarını değiştirip kademelerin nasıl aktığını görebilirsin. Mağazadaki gerçek görünüm temanın yazı tipi/renkleriyle birleşir.</p>
        </div>
      </div>
    </div>
  )
}
