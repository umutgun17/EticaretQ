import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, Loader2, Check, Copy, BarChart3, ShoppingBag, Eye, MousePointerClick, DoorOpen, Receipt } from 'lucide-react'
import clsx from 'clsx'
import { forYouApi, type ForYouSettings, type ForYouAnalytics, type ForYouRules } from '@/lib/croApi'

/* Sana Özel öneri kulakçığı (CRO) — ziyaretçi dolaştıkça kişiselleşen 3-4 ürünlük yan panel.
   Kademeli kaynak: çok satanlar → bulunulan kategori → gezilen ürünler → sepet → üyenin önceki siparişleri.
   Kullanıcıyı rahatsız etmez: kulakçık kapalı başlar, kendiliğinden açılmaz; N ürün gezince bir kez küçük balon. */

const MODE_LABEL: Record<string, { name: string; desc: string }> = {
  bestseller: { name: 'Çok satanlar', desc: 'Hiç sinyal yok (ilk giriş)' },
  category: { name: 'Kategori', desc: 'Doğrudan ürün/kategori sayfasına geldi' },
  viewed: { name: 'Gezdikleri', desc: 'Birkaç ürün baktı' },
  cart: { name: 'Sepeti', desc: 'Sepetinde ürün var' },
  history: { name: 'Önceki siparişleri', desc: 'Üye tanındı' },
}
const SOURCE_LABEL: Record<string, string> = { tab: 'Kulakçığa tıkladı', nudge: 'Balondan', auto_views: 'Otomatik · gezdikten sonra', auto_idle: 'Otomatik · sayfada durunca', auto_exit: 'Otomatik · çıkarken' }
const PAGE_LABEL: Record<string, string> = { product: 'Ürün sayfası', category: 'Kategori', index: 'Ana sayfa', '': 'Diğer' }

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
const money = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' TL'
const pct = (a: number, b: number) => (b > 0 ? `%${Math.round((a / b) * 1000) / 10}` : '—')

export default function CroForYouPage() {
  const [st, setSt] = useState<ForYouSettings | null>(null)
  const [rules, setRules] = useState<ForYouRules | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [an, setAn] = useState<ForYouAnalytics | null>(null)
  const [range, setRange] = useState(30)

  const apply = (d: ForYouSettings) => { setSt(d); setRules(d.rules); setDomains(d.domains); setDirty(false) }
  const load = useCallback(() => { setLoading(true); forYouApi.settings().then(apply).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { forYouApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { apply(await forYouApi.update(body)) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const edit = (p: Partial<ForYouRules>) => { setRules((r) => (r ? { ...r, ...p } : r)); setDirty(true) }
  const embed = useMemo(() => (st ? `<script src="${st.base_url}/widget/foryou.js?v=1" data-tenant="${st.slug}" async></script>` : ''), [st])
  const copy = () => { navigator.clipboard?.writeText(embed).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }

  if (loading || !st || !rules) return <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Yükleniyor…</div>

  const funnel = an ? [
    { icon: Eye, label: 'Kulakçığı gören', v: an.sessions, s: 'oturum' },
    { icon: DoorOpen, label: 'Paneli açan', v: an.open_sessions, s: `${pct(an.open_sessions, an.sessions)} · ${an.opens} açılış` },
    { icon: MousePointerClick, label: 'Ürüne giden', v: an.click_sessions, s: `${pct(an.click_sessions, an.open_sessions)} · ${an.clicks} tık` },
    { icon: ShoppingBag, label: 'Sepete ekleyen', v: an.atc, s: 'panelden' },
    { icon: Receipt, label: 'Satın alan', v: an.orders, s: `${money(an.revenue)} · ${an.conversions} ürün` },
  ] : []

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] text-[var(--primary-strong)] flex items-center justify-center"><Sparkles size={20} /></span>
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Sana Özel Öneriler</h1>
          <p className="text-sm text-gray-500 max-w-3xl">Sayfanın kenarında duran küçük bir kulakçık; açılınca ziyaretçiye {rules.count} ürün önerir. Ziyaretçi dolaştıkça öneri kişiselleşir: ilk girişte çok satanlar, ürün gezdikçe gezdiklerine benzer ve birlikte alınanlar, sepetine ve (üyeyse) önceki siparişlerine göre. Ürün ve ödeme sayfasında kendiliğinden açılmaz; ana sayfa/kategoride belirlediğiniz durumlarda günde en fazla bir kez açılır.</p>
        </div>
      </div>
      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-2">{error}</div>}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="space-y-4">
          {/* 1 Kurulum */}
          <Section step="1" title="Kurulum" desc="Mağaza alan adlarını yazıp kaydedin, sonra embed kodunu temanın tüm sayfalarına ekleyin.">
            <div className="space-y-3">
              <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label={st.enabled ? 'Kulakçık açık' : 'Kulakçık kapalı'} hint="Kapatınca mağazadaki script sessizce hiçbir şey göstermez." />
              <div className="flex gap-2 items-end">
                <Field label="İzinli alan adları (virgülle)"><input className={inputCls} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="magaza.com, www.magaza.com" /></Field>
                <button type="button" disabled={saving === 'domains'} onClick={() => patch('domains', { domains })} className="h-[38px] px-4 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold shrink-0">{saving === 'domains' ? '…' : 'Kaydet'}</button>
              </div>
              <div className="rounded-xl bg-gray-900 text-gray-100 text-xs font-mono p-3 flex items-start gap-3">
                <code className="flex-1 break-all">{embed}</code>
                <button type="button" onClick={copy} className="shrink-0 text-gray-300 hover:text-white">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
              </div>
            </div>
          </Section>

          {/* 2 Görünüm */}
          <Section step="2" title="Görünüm ve metinler" desc="Alt başlık, önerinin kaynağına göre değişir; {category} bulunulan kategori adıyla, {count} ürün sayısıyla değişir."
            right={dirty && <button type="button" disabled={saving === 'rules'} onClick={() => patch('rules', { rules })} className="px-4 py-2 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'rules' ? '…' : 'Kaydet'}</button>}>
            <div className="space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Panel başlığı"><input className={inputCls} value={rules.title} maxLength={40} onChange={(e) => edit({ title: e.target.value })} /></Field>
                <Field label="Kulakçık yazısı"><input className={inputCls} value={rules.tab_text} maxLength={24} onChange={(e) => edit({ tab_text: e.target.value })} /></Field>
                <Field label="Ürün sayısı"><input type="number" min={2} max={8} className={inputCls} value={rules.count} onChange={(e) => edit({ count: Number(e.target.value) })} /></Field>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {(['bestseller', 'category', 'viewed', 'cart', 'history'] as const).map((m) => (
                  <Field key={m} label={`Alt başlık · ${MODE_LABEL[m].name}`} hint={MODE_LABEL[m].desc}>
                    <input className={inputCls} value={rules[`subtitle_${m}`]} maxLength={80} onChange={(e) => edit({ [`subtitle_${m}`]: e.target.value } as Partial<ForYouRules>)} />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Field label="Vurgu rengi"><div className="flex items-center gap-2"><input type="color" value={rules.accent} onChange={(e) => edit({ accent: e.target.value })} className="w-9 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><span className="text-xs font-mono text-gray-500">{rules.accent}</span></div></Field>
                <Field label="Kenar"><Seg value={rules.side} options={[['right', 'Sağ'], ['left', 'Sol']]} onChange={(v) => edit({ side: v })} /></Field>
                <Toggle on={rules.show_add} onChange={(v) => edit({ show_add: v })} label='"Sepete ekle" düğmesi' hint="Panelden tek tıkla sepete ekleme (mağaza desteklemiyorsa gizlenir)." />
              </div>
            </div>
          </Section>

          {/* 3 Davranış */}
          <Section step="3" title="Davranış" desc="Ziyaretçiyi kaçırmamak için varsayılanlar temkinli: ürün sayfasında kulakçık silikleşir ve panel asla kendiliğinden açılmaz; ödeme adımında yok.">
            <div className="space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Balon için gezilen ürün sayısı" hint="Oturumda bu kadar ürün gezince kulakçık bir kez küçük bir balon gösterir (0 = hiç)."><input type="number" min={0} max={20} className={inputCls} value={rules.nudge_after} onChange={(e) => edit({ nudge_after: Number(e.target.value) })} /></Field>
                <Field label="Balon metni"><input className={inputCls} value={rules.nudge_text} maxLength={60} onChange={(e) => edit({ nudge_text: e.target.value })} /></Field>
                <Field label="Çok satan penceresi (gün)" hint="Sinyalsiz ziyaretçiye gösterilen çok satanlar bu kadar günün ödenmiş satışından."><input type="number" min={7} max={180} className={inputCls} value={rules.bestseller_days} onChange={(e) => edit({ bestseller_days: Number(e.target.value) })} /></Field>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Field label="Ürün sayfasında kulakçık"><Seg value={rules.product_page} options={[['subtle', 'Silik'], ['normal', 'Normal'], ['hidden', 'Gizli']]} onChange={(v) => edit({ product_page: v })} /></Field>
                <Field label="Gösterilmeyecek adresler (virgülle)" hint="Bu adreslerle başlayan sayfalarda kulakçık yok."><input className={clsx(inputCls, 'min-w-[260px]')} value={rules.hide_paths} onChange={(e) => edit({ hide_paths: e.target.value })} /></Field>
              </div>
              <Toggle on={rules.use_history} onChange={(v) => edit({ use_history: v })} label="Üyenin önceki siparişlerini kullan" hint="Giriş yapmış müşteride aldıkları tekrar önerilmez, aldıklarının yanına gidenler öne çıkar." />
              <div className="rounded-xl border border-gray-100 p-3 space-y-3">
                <Toggle on={rules.auto_open} onChange={(v) => edit({ auto_open: v })} label="Panel bazı durumlarda kendiliğinden açılsın" hint="Ürün ve ödeme sayfasında asla açılmaz; günde en fazla belirlenen sayıda; paneli açan/kapatan ziyaretçi aynı oturumda bir daha görmez." />
                {rules.auto_open && (
                  <div className="grid md:grid-cols-3 gap-3">
                    <Field label="Gezdikten sonra" hint="Oturumda bu kadar ürün gezip ana sayfa/kategoriye dönünce (0 = kapalı)"><input type="number" min={0} max={20} className={inputCls} value={rules.auto_views} onChange={(e) => edit({ auto_views: Number(e.target.value) })} /></Field>
                    <Field label="Gezdikten sonra kaç sn bekleyip açılsın" hint="Sayfaya gelir gelmez değil; ziyaretçi sayfayı önce görsün"><input type="number" min={0} max={120} className={inputCls} value={rules.auto_delay} onChange={(e) => edit({ auto_delay: Number(e.target.value) })} /></Field>
                    <Field label="Sayfada durunca (sn)" hint="Ana sayfa/kategoride bu kadar saniye kalınca (0 = kapalı)"><input type="number" min={0} max={300} className={inputCls} value={rules.auto_idle} onChange={(e) => edit({ auto_idle: Number(e.target.value) })} /></Field>
                    <Field label="Günde en fazla"><input type="number" min={1} max={5} className={inputCls} value={rules.auto_daily} onChange={(e) => edit({ auto_daily: Number(e.target.value) })} /></Field>
                    <Toggle on={rules.auto_exit} onChange={(v) => edit({ auto_exit: v })} label="Masaüstünde çıkarken" hint="İmleç sekmeyi terk ederken (mobilde yok)." />
                    <Toggle on={rules.pulse} onChange={(v) => edit({ pulse: v })} label="Kulakçık nefes alsın" hint="6 saniyede bir yumuşak büyüme (hareket azaltma tercihine saygı duyar)." />
                  </div>
                )}
              </div>
              {dirty && <button type="button" disabled={saving === 'rules'} onClick={() => patch('rules', { rules })} className="px-4 py-2 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'rules' ? '…' : 'Değişiklikleri kaydet'}</button>}
            </div>
          </Section>

          {/* 4 Analitik */}
          <Section step="4" title="Analitik" desc="Huni: kulakçığı gören → paneli açan → ürüne giden → sepete ekleyen → satın alan. Satış atfı sunucuda: öneriden tıklanan/eklenen ürün, aynı sepetin siparişinde varsa (ikas'ta sepet = sipariş kimliği) ya da aynı üyenin 24 saat içindeki siparişindeyse sayılır; tutar o ürünün kalem tutarıdır."
            right={<Seg value={String(range) as '7' | '30' | '90'} options={[['7', '7g'], ['30', '30g'], ['90', '90g']]} onChange={(v) => setRange(Number(v))} />}>
            {!an ? <p className="text-sm text-gray-400">Yükleniyor…</p> : an.sessions === 0 ? (
              <div className="rounded-xl bg-[var(--app-bg)] p-4 text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} /> Henüz veri yok — embed eklendikten sonra dolar.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {funnel.map((f) => (
                    <div key={f.label} className="rounded-xl bg-[var(--app-bg)] p-3"><div className="text-[11px] font-semibold text-gray-500 flex items-center gap-1"><f.icon size={12} /> {f.label}</div><div className="text-xl font-extrabold text-gray-900 mt-0.5">{f.v.toLocaleString('tr-TR')}</div><div className="text-[11px] text-gray-500">{f.s}</div></div>
                  ))}
                </div>
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Balon</div><div className="font-bold text-gray-900">{an.nudges} gösterildi · {an.nudge_opens} açtırdı</div><div className="text-[11px] text-gray-500">{an.nudge_rate != null ? `%${an.nudge_rate} balon→açılış` : 'henüz yok'}</div></div>
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Cihaz</div>{an.by_device.map((d) => <div key={d.device || 'x'} className="flex justify-between"><span className="text-gray-600">{d.device === 'm' ? 'Mobil' : d.device === 'd' ? 'Masaüstü' : '—'}</span><b>{d.views} gören · {d.opens} açan</b></div>)}</div>
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Açıldığı sayfa</div>{an.by_page.map((p) => <div key={p.t} className="flex justify-between"><span className="text-gray-600">{PAGE_LABEL[p.t] ?? p.t}</span><b>{p.c}</b></div>)}{!an.by_page.length && <span className="text-xs text-gray-400">—</span>}</div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Açılma şekline göre</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Nasıl açıldı</th><th className="py-1 pr-3">Açılış</th><th className="py-1 pr-3">Oturum</th><th className="py-1">Sonra ürüne giden / sepete ekleyen</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.by_source.map((sr) => { const eng = an.source_engagement.find((x) => x.s === sr.s); return (
                      <tr key={sr.s}><td className="py-1.5 pr-3 font-semibold">{SOURCE_LABEL[sr.s] ?? sr.s}</td><td className="py-1.5 pr-3">{sr.c}</td><td className="py-1.5 pr-3">{sr.n}</td><td className="py-1.5">{eng ? `${eng.engaged} oturum (${pct(eng.engaged, eng.opened)})` : '—'}</td></tr>
                    ) })}{!an.by_source.length && <tr><td className="py-2 text-xs text-gray-400" colSpan={4}>Henüz açılış yok</td></tr>}</tbody></table></div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Öneri kaynağına göre</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Kaynak</th><th className="py-1 pr-3">Gören</th><th className="py-1 pr-3">Açılış</th><th className="py-1 pr-3">Tık</th><th className="py-1 pr-3">Sepet</th><th className="py-1 pr-3">Satış</th><th className="py-1">Ciro</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.by_mode.map((m) => (
                      <tr key={m.mode}><td className="py-1.5 pr-3 font-semibold">{MODE_LABEL[m.mode]?.name ?? m.mode}<span className="block text-[11px] font-normal text-gray-400">{MODE_LABEL[m.mode]?.desc}</span></td><td className="py-1.5 pr-3">{m.views}</td><td className="py-1.5 pr-3">{m.opens}</td><td className="py-1.5 pr-3">{m.clicks}</td><td className="py-1.5 pr-3">{m.atc}</td><td className="py-1.5 pr-3">{m.conv}</td><td className="py-1.5 font-semibold">{money(Number(m.rev))}</td></tr>
                    ))}</tbody></table></div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Ürünler</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Ürün</th><th className="py-1 pr-3">Tık</th><th className="py-1 pr-3">Sepet</th><th className="py-1 pr-3">Satış</th><th className="py-1">Ciro</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.by_product.map((p) => (
                      <tr key={p.product_id}><td className="py-1.5 pr-3 max-w-[320px] truncate">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.name || `#${p.product_id}`}</a> : (p.name || `#${p.product_id}`)}</td><td className="py-1.5 pr-3">{p.clicks}</td><td className="py-1.5 pr-3">{p.atc}</td><td className="py-1.5 pr-3">{p.conv}</td><td className="py-1.5 font-semibold">{money(Number(p.rev))}</td></tr>
                    ))}{!an.by_product.length && <tr><td className="py-2 text-xs text-gray-400" colSpan={5}>Henüz ürün etkileşimi yok</td></tr>}</tbody></table></div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Günlük</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Gün</th><th className="py-1 pr-3">Gören</th><th className="py-1 pr-3">Açan</th><th className="py-1 pr-3">Tık+Sepet</th><th className="py-1 pr-3">Satış</th><th className="py-1">Ciro</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.daily.slice(-14).map((d) => (
                      <tr key={d.d}><td className="py-1 pr-3 text-gray-600">{new Date(d.d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</td><td className="py-1 pr-3">{d.views}</td><td className="py-1 pr-3">{d.opens}</td><td className="py-1 pr-3">{d.acts}</td><td className="py-1 pr-3">{d.conv}</td><td className="py-1 font-semibold">{money(Number(d.rev))}</td></tr>
                    ))}</tbody></table></div>
                </div>
                {an.errors.length > 0 && <p className="text-[11px] text-amber-700">Hatalar: {an.errors.map((e) => `${e.value} ×${e.c}`).join(', ')}</p>}
              </div>
            )}
          </Section>
        </div>

        {/* Sağ: nasıl çalışır */}
        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Nasıl karar verir?</h3>
            <ol className="space-y-2 text-xs text-gray-600">
              {(['bestseller', 'category', 'viewed', 'cart', 'history'] as const).map((m, i) => (
                <li key={m} className="flex gap-2"><span className="w-5 h-5 rounded-full bg-[var(--app-bg)] text-[10px] font-bold flex items-center justify-center shrink-0 text-gray-700">{i + 1}</span><span><b className="text-gray-800">{MODE_LABEL[m].name}</b> — {MODE_LABEL[m].desc}</span></li>
              ))}
            </ol>
            <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">Sinyal arttıkça üst basamağa geçer. Baktığı, sepetindeki ve daha önce aldığı ürünler önerilmez; aynı serinin tek ürünü gösterilir; sepetindeki her kategoriden en az bir öneri gelir. Gezinti ürün kimliği olarak ziyaretçinin tarayıcısında tutulur (30 gün).</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Mağazada test</h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">Embed ekledikten sonra mağazada birkaç ürün gezin; {rules.nudge_after > 0 ? `${rules.nudge_after}. üründen sonra balon bir kez görünür` : 'balon kapalı'}. Panelin alt başlığı hangi kaynağın kullanıldığını söyler. Hub'dan yapılan denemeler analitiğe karışmaz.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
