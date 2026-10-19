import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gift, Loader2, Check, Copy, BarChart3, Eye, Ticket, ClipboardCheck, Receipt, ExternalLink, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { welcomeApi, type WelcomeSettings, type WelcomeAnalytics, type WelcomeRules } from '@/lib/croApi'

/* Hoş geldin hediyesi (CRO) — ilk kez gelen ziyaretçiye köşeden süzülen zarif bir kupon kartı (pop-up/karartma yok).
   Kod tek tıkla açılır ve panoya kopyalanır; sonrasında küçük bir hatırlatıcı pil eşlik eder. Kuponun kendisi mağazada tanımlıdır. */

const TRIGGER_LABEL: Record<string, string> = { delay: 'Sayfada durunca', pages: 'N. sayfada', exit: 'Çıkarken (masaüstü)', force: 'Test (?yunbi_welcome=1)' }

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

export default function CroWelcomePage() {
  const [st, setSt] = useState<WelcomeSettings | null>(null)
  const [rules, setRules] = useState<WelcomeRules | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [an, setAn] = useState<WelcomeAnalytics | null>(null)
  const [range, setRange] = useState(30)

  const apply = (d: WelcomeSettings) => { setSt(d); setRules(d.rules); setDomains(d.domains); setDirty(false) }
  const load = useCallback(() => { setLoading(true); welcomeApi.settings().then(apply).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { welcomeApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { apply(await welcomeApi.update(body)) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const edit = (p: Partial<WelcomeRules>) => { setRules((r) => (r ? { ...r, ...p } : r)); setDirty(true) }
  const embed = useMemo(() => (st ? `<script src="${st.base_url}/widget/welcome.js?v=1" data-tenant="${st.slug}" async></script>` : ''), [st])
  const copy = () => { navigator.clipboard?.writeText(embed).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  const saveBtn = dirty && <button type="button" disabled={saving === 'rules'} onClick={() => patch('rules', { rules })} className="px-4 py-2 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold">{saving === 'rules' ? '…' : 'Kaydet'}</button>

  if (loading || !st || !rules) return <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Yükleniyor…</div>

  const funnel = an ? [
    { icon: Eye, label: 'Kartı gören', v: an.sessions, s: 'oturum' },
    { icon: Ticket, label: 'Kodu açan', v: an.reveals, s: pct(an.reveals, an.sessions) },
    { icon: ClipboardCheck, label: 'Kopyalayan', v: an.copies, s: `${an.dismisses} kapattı` },
    { icon: Receipt, label: 'Kuponla sipariş', v: an.coupon_conversions, s: `${money(an.revenue)} ciro · ${money(an.discount)} indirim` },
  ] : []

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] text-[var(--primary-strong)] flex items-center justify-center"><Gift size={20} /></span>
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Hoş Geldin Hediyesi</h1>
          <p className="text-sm text-gray-500 max-w-3xl">İlk kez gelen ziyaretçiye köşeden süzülen zarif bir kart: "{rules.title}". Tek tıkla kod açılır ve panoya kopyalanır; sonrasında küçük bir hatırlatıcı pil eşlik eder. Pop-up ve karartma yok; ürün ve ödeme sayfasında açılmaz; sipariş geçmişi olan üyeye gösterilmez.</p>
        </div>
      </div>
      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-2">{error}</div>}
      {st.enabled && st.code_orders_90d === 0 && (
        <div className="rounded-xl bg-amber-50 text-amber-800 text-sm px-4 py-3 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>{rules.code}</b> kodu son 90 günde hiç siparişte görünmedi. Kuponun mağaza panelinde tanımlı olduğundan emin olun (%{rules.percent}, müşteri başına 1, yalnız ilk sipariş). Kod tanımlı değilse müşteri ödeme adımında hata alır.</span></div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="space-y-4">
          <Section step="1" title="Kurulum" desc="Önce kuponu mağazada tanımlayın, sonra alan adlarını kaydedip embed kodunu temanın tüm sayfalarına ekleyin.">
            <div className="space-y-3">
              <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label={st.enabled ? 'Hoş geldin kartı açık' : 'Hoş geldin kartı kapalı'} hint={rules.started_at ? `Ölçüm başlangıcı: ${new Date(rules.started_at).toLocaleString('tr-TR')}` : 'Açınca ölçüm başlangıcı otomatik yazılır.'} />
              <div className="grid md:grid-cols-[1fr_120px] gap-3">
                <Field label="Kupon kodu (mağazada tanımlı)"><input className={clsx(inputCls, 'font-mono tracking-widest uppercase')} value={rules.code} maxLength={40} onChange={(e) => edit({ code: e.target.value.toUpperCase() })} /></Field>
                <Field label="İndirim %"><input type="number" min={1} max={90} className={inputCls} value={rules.percent} onChange={(e) => edit({ percent: Number(e.target.value) })} /></Field>
              </div>
              <div className="flex gap-2 items-end">
                <Field label="İzinli alan adları (virgülle)"><input className={inputCls} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="magaza.com, www.magaza.com" /></Field>
                <button type="button" disabled={saving === 'domains'} onClick={() => patch('domains', { domains })} className="h-[38px] px-4 rounded-xl bg-[var(--primary-strong)] text-white text-sm font-semibold shrink-0">{saving === 'domains' ? '…' : 'Kaydet'}</button>
              </div>
              <div className="rounded-xl bg-gray-900 text-gray-100 text-xs font-mono p-3 flex items-start gap-3">
                <code className="flex-1 break-all">{embed}</code>
                <button type="button" onClick={copy} className="shrink-0 text-gray-300 hover:text-white">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
              </div>
              {saveBtn}
            </div>
          </Section>

          <Section step="2" title="Kart metinleri ve görünüm" desc="{code} ve {percent} metinlerde kodla/oranla değişir. Görsel boşsa kartın üstünde markanın renginde büyük bir %10 alanı çizilir." right={saveBtn}>
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Üst etiket"><input className={inputCls} value={rules.eyebrow} maxLength={40} onChange={(e) => edit({ eyebrow: e.target.value })} /></Field>
                <Field label="Başlık"><input className={inputCls} value={rules.title} maxLength={80} onChange={(e) => edit({ title: e.target.value })} /></Field>
              </div>
              <Field label="Açıklama"><input className={inputCls} value={rules.text} maxLength={200} onChange={(e) => edit({ text: e.target.value })} /></Field>
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Düğme"><input className={inputCls} value={rules.cta} maxLength={40} onChange={(e) => edit({ cta: e.target.value })} /></Field>
                <Field label="Kod açılınca başlık"><input className={inputCls} value={rules.revealed_title} maxLength={60} onChange={(e) => edit({ revealed_title: e.target.value })} /></Field>
                <Field label="Alışveriş düğmesi"><input className={inputCls} value={rules.shop_cta} maxLength={40} onChange={(e) => edit({ shop_cta: e.target.value })} /></Field>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Kod açılınca açıklama"><input className={inputCls} value={rules.revealed_text} maxLength={200} onChange={(e) => edit({ revealed_text: e.target.value })} /></Field>
                <Field label="Alışveriş düğmesi adresi"><input className={inputCls} value={rules.shop_url} onChange={(e) => edit({ shop_url: e.target.value })} placeholder="/" /></Field>
              </div>
              <div className="grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
                <Field label="Görsel adresi (isteğe bağlı)" hint="Kartın üst alanı; 3:1 civarı yatay bir ürün/lifestyle karesi iyi durur."><input className={inputCls} value={rules.image_url} onChange={(e) => edit({ image_url: e.target.value })} placeholder="https://…/gorsel.jpg" /></Field>
                <Field label="Renk"><div className="flex items-center gap-2"><input type="color" value={rules.accent} onChange={(e) => edit({ accent: e.target.value })} className="w-9 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><span className="text-xs font-mono text-gray-500">{rules.accent}</span></div></Field>
                <Field label="Köşe"><Seg value={rules.position} options={[['right', 'Sağ'], ['left', 'Sol']]} onChange={(v) => edit({ position: v })} /></Field>
              </div>
            </div>
          </Section>

          <Section step="3" title="Ne zaman görünsün" desc="Ziyaretçiyi kaçırmamak için: ilk sayfada hemen değil; ürün sayfasında ve ödemede hiç; kapatan belirlenen gün boyunca görmez; kodu alan bir daha görmez, hatırlatıcı pil görür." right={saveBtn}>
            <div className="space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Sayfada durunca (sn)" hint="İlk sayfada bu kadar saniye sonra (0 = kapalı)"><input type="number" min={0} max={300} className={inputCls} value={rules.delay} onChange={(e) => edit({ delay: Number(e.target.value) })} /></Field>
                <Field label="N. sayfada" hint="Bu kadarıncı sayfaya geçince hemen (0 = kapalı)"><input type="number" min={0} max={20} className={inputCls} value={rules.min_pages} onChange={(e) => edit({ min_pages: Number(e.target.value) })} /></Field>
                <Field label="Kapatan kaç gün görmesin"><input type="number" min={1} max={90} className={inputCls} value={rules.dismiss_days} onChange={(e) => edit({ dismiss_days: Number(e.target.value) })} /></Field>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <Toggle on={rules.exit_intent} onChange={(v) => edit({ exit_intent: v })} label="Masaüstünde çıkarken" hint="İmleç sekmeyi terk ederken (mobilde yok)." />
                <Toggle on={rules.product_page} onChange={(v) => edit({ product_page: v })} label="Ürün sayfasında da açılsın" hint="Varsayılan kapalı: satın alma kararını bölmez." />
                <Toggle on={rules.hide_customers} onChange={(v) => edit({ hide_customers: v })} label="Sipariş geçmişi olan üyeye gösterme" hint="Giriş yapmış ve daha önce alışveriş yapmış müşteri kartı görmez." />
                <Toggle on={rules.remind} onChange={(v) => edit({ remind: v })} label="Hatırlatıcı pil" hint="Kod alındıktan sonra köşede küçük bir pil; dokununca kodu yeniden kopyalar." />
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Pil metni"><input className={inputCls} value={rules.remind_text} maxLength={60} onChange={(e) => edit({ remind_text: e.target.value })} /></Field>
                <Field label="Pil kaç gün kalsın"><input type="number" min={1} max={90} className={inputCls} value={rules.remind_days} onChange={(e) => edit({ remind_days: Number(e.target.value) })} /></Field>
                <Field label="Gösterilmeyecek adresler (virgülle)"><input className={inputCls} value={rules.hide_paths} onChange={(e) => edit({ hide_paths: e.target.value })} /></Field>
              </div>
              {saveBtn}
            </div>
          </Section>

          <Section step="4" title="Analitik" desc="Kuponla sipariş = mağaza siparişinde bu kod kullanıldı (kesin). Kartı görüp kodsuz alanlar da sepet kimliğiyle ayrıca eşlenir."
            right={<Seg value={String(range) as '7' | '30' | '90'} options={[['7', '7g'], ['30', '30g'], ['90', '90g']]} onChange={(v) => setRange(Number(v))} />}>
            {!an ? <p className="text-sm text-gray-400">Yükleniyor…</p> : an.sessions === 0 && an.code_orders === 0 ? (
              <div className="rounded-xl bg-[var(--app-bg)] p-4 text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} /> Henüz veri yok — embed eklendikten sonra dolar.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {funnel.map((f) => (
                    <div key={f.label} className="rounded-xl bg-[var(--app-bg)] p-3"><div className="text-[11px] font-semibold text-gray-500 flex items-center gap-1"><f.icon size={12} /> {f.label}</div><div className="text-xl font-extrabold text-gray-900 mt-0.5">{f.v.toLocaleString('tr-TR')}</div><div className="text-[11px] text-gray-500">{f.s}</div></div>
                  ))}
                </div>
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Mağazada {an.code} ile sipariş ({an.range_days} gün)</div><div className="font-bold text-gray-900">{an.code_orders} sipariş · {money(an.code_revenue)}</div><div className="text-[11px] text-gray-500">widget'tan bağımsız sayım</div></div>
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Kartı gören sepetin kodsuz siparişi</div><div className="font-bold text-gray-900">{an.conversions - an.coupon_conversions}</div><div className="text-[11px] text-gray-500">7 gün içinde</div></div>
                  <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] font-semibold text-gray-500">Cihaz</div>{an.by_device.map((d) => <div key={d.device || 'x'} className="flex justify-between"><span className="text-gray-600">{d.device === 'm' ? 'Mobil' : d.device === 'd' ? 'Masaüstü' : '—'}</span><b>{d.views} gören · {d.reveals} açan</b></div>)}</div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Tetiğe göre</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Nasıl açıldı</th><th className="py-1 pr-3">Gören</th><th className="py-1">Kodu açan</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.trigger_engagement.map((t) => <tr key={t.s}><td className="py-1.5 pr-3 font-semibold">{TRIGGER_LABEL[t.s] ?? t.s}</td><td className="py-1.5 pr-3">{t.shown}</td><td className="py-1.5">{t.revealed} ({pct(t.revealed, t.shown)})</td></tr>)}{!an.trigger_engagement.length && <tr><td className="py-2 text-xs text-gray-400" colSpan={3}>—</td></tr>}</tbody></table></div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Günlük</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Gün</th><th className="py-1 pr-3">Gören</th><th className="py-1 pr-3">Kodu açan</th><th className="py-1 pr-3">Sipariş</th><th className="py-1">Ciro</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{an.daily.slice(-14).map((d) => <tr key={d.d}><td className="py-1 pr-3 text-gray-600">{new Date(d.d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</td><td className="py-1 pr-3">{d.views}</td><td className="py-1 pr-3">{d.reveals}</td><td className="py-1 pr-3">{d.conv}</td><td className="py-1 font-semibold">{money(Number(d.rev))}</td></tr>)}</tbody></table></div>
                </div>
                {an.errors.length > 0 && <p className="text-[11px] text-amber-700">Hatalar: {an.errors.map((e) => `${e.value} ×${e.c}`).join(', ')}</p>}
              </div>
            )}
          </Section>
        </div>

        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Mağazada kuponu tanımlayın</h3>
            <ol className="space-y-1.5 text-xs text-gray-600 list-decimal pl-4">
              <li>Kod: <b className="font-mono">{rules.code}</b>, indirim %{rules.percent}</li>
              <li>Müşteri başına 1 kullanım</li>
              <li>Yalnız ilk sipariş (mağaza destekliyorsa)</li>
              <li>İsterseniz alt limit (örn. 500 TL) ve kampanyalarla birleşmesin</li>
            </ol>
            <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">Kod burada yalnız gösterilir; indirimi mağaza uygular. Kod tanımlı değilse ziyaretçi ödeme adımında hata alır.</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Mağazada test</h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">Herhangi bir sayfaya <code className="font-mono">?yunbi_welcome=1</code> ekleyin: kart hemen açılır (kurallara bakmaz).{st.shop_url && <> <a className="inline-flex items-center gap-1 text-indigo-600 font-semibold" href={`${st.shop_url}/?yunbi_welcome=1`} target="_blank" rel="noreferrer">Aç <ExternalLink size={11} /></a></>} Hub'dan yapılan denemeler analitiğe karışmaz.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
