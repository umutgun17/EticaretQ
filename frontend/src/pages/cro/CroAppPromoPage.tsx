import { useCallback, useEffect, useState } from 'react'
import { Smartphone, ExternalLink, Loader2, Check, Copy, BarChart3, QrCode, Printer, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { appPromoApi, type AppPromoSettings, type AppPromoAnalytics } from '@/lib/croApi'

/* "Uygulamaya Özel" kulakçığı (CRO) — mobil uygulamayı indirene özel indirim kodu. Web'de kod + QR + mağaza butonları,
   mobil web'de cihaza göre tek "İndir" butonu, uygulama içinde yalnız kod. Bütün çıkışlar Yunbi /go yönlendirmesinden
   geçer (tıklama + QR okutma ölçülür); kod kullanımı ve uygulama siparişleri sipariş kaynağından (NativeIOS/NativeAndroid) okunur. */

function PhoneFrame({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(0.5)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} loading="lazy" className="border-0" style={{ width: 390, height: 640 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}
const n = (v: number) => (v || 0).toLocaleString('tr-TR')
const money = (v: number) => (v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' TL'
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)
const SRC_LABEL: Record<string, string> = { qr: 'QR okutma (masaüstü)', print: 'Basılı QR', tab_ios: 'Mobil web · iPhone butonu', tab_android: 'Mobil web · Android butonu', desk_ios: 'Masaüstü · App Store butonu', desk_android: 'Masaüstü · Google Play butonu', link: 'Doğrudan bağlantı', tab: 'Kulakçık tıklaması', auto: 'Kendiliğinden (süre)', scroll: 'Kaydırma', exit: 'Çıkış niyeti', api: 'API' }
const PLAT_LABEL: Record<string, string> = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Masaüstü', other: 'Diğer', inapp_ios: 'Uygulama içi (iOS)', inapp_android: 'Uygulama içi (Android)', '?': 'Bilinmiyor' }

export default function CroAppPromoPage() {
  const [st, setSt] = useState<AppPromoSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [txt, setTxt] = useState<Record<string, string>>({})
  const [an, setAn] = useState<AppPromoAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)
  const [previewPlatform, setPreviewPlatform] = useState<'ios' | 'android' | 'inapp_ios'>('ios')

  const syncTxt = (d: AppPromoSettings) => {
    const r = d.rules, t = d.theme
    setTxt({ code: r.code, discount_label: r.discount_label, eyebrow: r.eyebrow, title: r.title, subtitle: r.subtitle, terms: r.terms, valid_until: r.valid_until || '', ios_url: r.ios_url, android_url: r.android_url, landing_url: r.landing_url, cta_ios: r.cta_ios, cta_android: r.cta_android, copy_text: r.copy_text, hide_paths: r.hide_paths, tab_text: t.tab_text, tab_badge: t.tab_badge, tab_emoji: t.tab_emoji })
  }
  const load = useCallback(() => {
    setLoading(true)
    appPromoApi.settings().then((d) => { setSt(d); setDomains(d.domains); syncTxt(d) }).catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { appPromoApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await appPromoApi.update(body); setSt(d); syncTxt(d); setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const saveRule = (k: string) => patch(k, { rules: { [k]: k === 'valid_until' ? (txt[k] || null) : txt[k] } })
  const saveTheme = (k: string) => patch(k, { theme: { [k]: txt[k] } })
  const embed = st ? `<script src="${st.base_url}/widget/app.js?v=5" data-tenant="${st.slug}" async></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const previewUrl = st ? `/widget/app-demo.html?tenant=${st.slug}&platform=${previewPlatform}&open=1&note=0&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify(st.rules))}&k=${previewKey}` : ''
  const demoUrl = st ? `/widget/app-demo.html?tenant=${st.slug}` : '#'
  const qrUrl = st ? `/widget/app-qr.html?tenant=${st.slug}&src=print` : '#'

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
  const TextField = ({ k, label, kind = 'rule', placeholder, mono, type = 'text', hint }: { k: string; label: string; kind?: 'rule' | 'theme'; placeholder?: string; mono?: boolean; type?: string; hint?: string }) => (
    <div><label className="text-xs font-semibold text-gray-600">{label}</label>
      <div className="flex gap-2 mt-1"><input type={type} className={clsx(inputCls, 'flex-1 min-w-0', mono && 'font-mono text-xs')} value={txt[k] ?? ''} placeholder={placeholder} onChange={(e) => setTxt({ ...txt, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') (kind === 'rule' ? saveRule : saveTheme)(k) }} />
        <button onClick={() => (kind === 'rule' ? saveRule : saveTheme)(k)} disabled={saving === k} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}</div>
  )
  const Tile = ({ l, v, sub, warn }: { l: string; v: string; sub?: string; warn?: boolean }) => (
    <div className={clsx('rounded-xl p-3', warn ? 'bg-amber-50' : 'bg-[var(--app-bg)]')}><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p>{sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}</div>
  )

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const t = st.theme, r = st.rules
  const oc = an?.orders.current, op = an?.orders.previous
  const appDelta = oc && op ? delta(oc.app, op.app) : null

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Smartphone size={24} /> Uygulamaya Özel
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Mobil uygulamayı indirene özel indirim kodu kulakçığı. Masaüstünde kod + QR (telefonla okutunca cihaza göre App Store / Google Play açılır), mobil web'de cihaza göre tek "İndir" butonu, uygulama içinde yalnız kod. Tıklama, QR okutma, kod kopyalama ve kod kullanan siparişler ölçülür.</p>
        </div>
        <div className="flex gap-2">
          <a href={qrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 text-sm font-semibold rounded-full"><Printer size={15} /> Basılı QR</a>
          <a href={demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><QrCode size={15} /> Canlı demoyu aç</a>
        </div>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" /><span><b>Kod yalnız uygulamada geçsin</b> diye kuponu mağaza panelinde (Ticimax → Hediye Çeki / Kupon) <b>"yalnız mobil uygulama"</b> kısıtıyla oluştur; Yunbi kodu yalnızca yayınlar ve kullanımını siparişlerden ölçer. Web'den kullanılan kupon görülürse aşağıdaki analitikte kırmızı uyarı çıkar.</span></div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="space-y-5">
          {/* 1 Kurulum */}
          <Section step="1" title="Kurulum" desc="Tek satır embed, tüm sayfalarda çalışır (sepet/ödeme sayfalarında kendini gizler). Mağaza bağlantıları QR ve butonların gideceği yerlerdir; Yunbi /go yönlendirmesi cihazı tanıyıp doğru mağazaya atar ve her geçişi sayar.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Kulakçık açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz; /go bağlantıları mağazanın uygulama sayfasına düşer." />
                <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
                <TextField k="ios_url" label="App Store bağlantısı" placeholder="https://apps.apple.com/tr/app/…" mono />
                <TextField k="android_url" label="Google Play bağlantısı" placeholder="https://play.google.com/store/apps/details?id=…" mono />
                <TextField k="landing_url" label="Masaüstü / bilinmeyen cihaz sayfası" placeholder="/app-indir" mono hint="QR'ı masaüstünden açan ya da cihazı tanınamayan ziyaretçi buraya düşer (mağazanın uygulama sayfası)." />
              </div>
              <div className="space-y-3">
                <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu (tüm sayfalar, {'</body>'} öncesi)</label>
                  <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div>
                  <p className="text-[11px] text-gray-400 mt-1.5">Her widget güncellemesinde <code>?v</code> numarası artırılır (CDN önbelleği).</p></div>
                <div className="rounded-xl bg-[var(--app-bg)] p-3 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-gray-800">Yönlendirme bağlantısı (kampanyalarda da kullanılabilir)</p>
                  <code className="block break-all text-[11px] text-gray-700">{st.go_url}?src=<i>kaynak</i></code>
                  <p>WhatsApp / e-posta / SMS / basılı QR'da <code>src=wa</code>, <code>src=email</code>, <code>src=print</code> gibi bir kaynak verirsen analitikte ayrı görünür. Cihaz tanıma sunucuda yapılır.</p>
                </div>
              </div>
            </div>
          </Section>

          {/* 2 Kampanya */}
          <Section step="2" title="Kampanya: kod ve metinler" desc="Kod büyük harfe çevrilir. Metinler kulakçık paneline birebir yansır; sağdaki telefon canlı önizlemedir.">
            <div className="grid md:grid-cols-2 gap-3">
              <TextField k="code" label="İndirim kodu (Ticimax'ta uygulamaya özel kupon)" placeholder="APP10" mono />
              <TextField k="discount_label" label="Büyük vurgu" placeholder="%10 İndirim" />
              <TextField k="title" label="Başlık" placeholder="Uygulamayı indir, %10 kazan" />
              <TextField k="subtitle" label="Alt başlık" placeholder="Kod yalnızca mobil uygulamada geçerlidir." />
              <TextField k="terms" label="Koşullar (küçük yazı)" placeholder="Tek kullanımlık · 500 TL ve üzeri" />
              <TextField k="valid_until" label="Son geçerlilik günü (boş = süresiz)" type="date" hint="Dolunca kulakçık kendiliğinden kaybolur; panelde 'Son gün' yazar." />
              <TextField k="cta_ios" label="iPhone buton metni" />
              <TextField k="cta_android" label="Android buton metni" />
            </div>
            <div className="grid sm:grid-cols-3 gap-2 mt-4">
              <Toggle on={r.show_code_web} onChange={(v) => patch('rules', { rules: { show_code_web: v } })} label="Kodu web'de göster" hint="Kapalıysa web'de kod bulanık görünür, 'kod uygulamada görünür' yazar (indirmeyi zorlar)." />
              <Toggle on={r.show_qr} onChange={(v) => patch('rules', { rules: { show_qr: v } })} label="Masaüstünde QR" hint="Telefon kamerasıyla okutulur; okutma sayılır (kaynak: qr)." />
              <Toggle on={r.in_app_mode === 'code'} onChange={(v) => patch('rules', { rules: { in_app_mode: v ? 'code' : 'hide' } })} label="Uygulama içinde kodu göster" hint="Uygulama içindeki tarayıcı (Ticimax UA) tanınır: yalnız kod + kopyala. Kapalıysa uygulama içinde hiç görünmez." />
            </div>
          </Section>

          {/* 3 Görünüm */}
          <Section step="3" title="Görünüm" desc="Kulakçık ekran kenarında dikey şerit; 'Bugüne Özel' kulakçığıyla aynı kenardaysa onun hemen altına yerleşir.">
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Konum</label><Seg value={t.tab_position} options={[['right-middle', 'Sağ orta'], ['left-middle', 'Sol orta'], ['right-bottom', 'Sağ alt'], ['left-bottom', 'Sol alt']]} onChange={(v) => patch('theme', { theme: { tab_position: v } })} /></div>
              <Color label="Ana renk" value={t.accent} onChange={(v) => patch('theme', { theme: { accent: v } })} />
              <Color label="Gradyan ucu" value={t.accent2} onChange={(v) => patch('theme', { theme: { accent2: v } })} />
              <Color label="Panel zemini" value={t.bg} onChange={(v) => patch('theme', { theme: { bg: v } })} />
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe</label><select className={inputCls} value={t.radius} onChange={(e) => patch('theme', { theme: { radius: Number(e.target.value) } })}>{[0, 8, 14, 20, 28].map((x) => <option key={x} value={x}>{x}px</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Nabız efekti</label><Seg value={t.tab_pulse ? 'on' : 'off'} options={[['on', 'Açık'], ['off', 'Kapalı']]} onChange={(v) => patch('theme', { theme: { tab_pulse: v === 'on' } })} /></div>
            </div>
            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <TextField k="tab_text" kind="theme" label="Kulakçık metni" placeholder="UYGULAMAYA ÖZEL" />
              <TextField k="tab_badge" kind="theme" label="Kulakçık rozeti (beyaz hap)" placeholder="%10" />
              <TextField k="tab_emoji" kind="theme" label="Emoji" placeholder="📱" />
            </div>
          </Section>

          {/* 4 Davranış */}
          <Section step="4" title="Davranış" desc="Kulakçık her zaman durur; panel kendiliğinden açılma kurallarına göre günde/oturumda bir kez açılır. Ürün sayfasında satın alma niyetini bozmamak için kendiliğinden açılmaz.">
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              <Toggle on={r.auto_open} onChange={(v) => patch('rules', { rules: { auto_open: v } })} label="Kendiliğinden açılsın" hint="Süre / kaydırma / çıkış niyeti — ilk gelen tetikler." />
              <Toggle on={r.exit_intent} onChange={(v) => patch('rules', { rules: { exit_intent: v } })} label="Çıkış niyetinde aç (masaüstü)" hint="Fare pencerenin üstünden çıkınca." />
              <Toggle on={r.tab_close !== false} onChange={(v) => patch('rules', { rules: { tab_close: v } })} label="Kulakçıkta kapatma (×)" hint="Ziyaretçi × ile kapatırsa seçilen gün boyunca kulakçık gösterilmez." />
              {r.tab_close !== false && (
                <label className="block text-xs text-gray-600">Kapatınca kaç gün gizlensin
                  <select value={String(r.tab_close_days ?? 3)} onChange={(e) => patch('rules', { rules: { tab_close_days: +e.target.value } })} className="ml-2 px-2 py-1 border border-gray-200 rounded-lg text-sm">
                    {[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} gün</option>)}
                  </select>
                </label>
              )}
              <Toggle on={!!r.auto_open_mobile} onChange={(v) => patch('rules', { rules: { auto_open_mobile: v } })} label="Mobilde de kendiliğinden açılsın" hint="Kapalıyken mobilde yalnız küçük çip görünür, alt sayfa sadece dokununca açılır (hiçbir şeyin üstüne çıkmaz)." />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Süre (sn, sekme görünürken)</label><select className={inputCls} value={r.auto_open_delay} onChange={(e) => patch('rules', { rules: { auto_open_delay: Number(e.target.value) } })}>{[0, 8, 12, 15, 20, 30, 45, 60, 90].map((x) => <option key={x} value={x}>{x === 0 ? 'Kapalı' : x + ' sn'}</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kaydırma derinliği</label><select className={inputCls} value={r.auto_open_scroll} onChange={(e) => patch('rules', { rules: { auto_open_scroll: Number(e.target.value) } })}>{[0, 25, 40, 50, 60, 75].map((x) => <option key={x} value={x}>{x === 0 ? 'Kapalı' : '%' + x}</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sıklık</label><Seg value={r.frequency} options={[['day', 'Günde 1'], ['session', 'Oturumda 1'], ['always', 'Her sayfada']]} onChange={(v) => patch('rules', { rules: { frequency: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Kendiliğinden açılmasın</label><div className="flex flex-wrap gap-1.5">{(['home', 'category', 'product', 'account', 'other'] as const).map((pt) => { const on = (r.no_auto_page_types || []).includes(pt); return <button key={pt} onClick={() => patch('rules', { rules: { no_auto_page_types: on ? (r.no_auto_page_types || []).filter((x) => x !== pt) : [...(r.no_auto_page_types || []), pt] } })} className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold border', on ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-gray-200 text-gray-500')}>{on ? '⏸ ' : ''}{{ home: 'Ana sayfa', category: 'Kategori', product: 'Ürün', account: 'Hesap', other: 'Diğer' }[pt]}</button> })}</div></div>
            </div>
            <div className="mt-4"><TextField k="hide_paths" label="Kulakçığın hiç görünmeyeceği yollar (önek, virgülle)" mono /></div>
          </Section>

          {/* 5 Analitik */}
          <Section step="5" title="Huni ve sonuç" desc="Kulakçığı gören → paneli açan → mağazaya giden (buton / QR okutma) → uygulamadan kod kullanan sipariş. Uygulama siparişleri ve kod kullanımı sipariş kaynağından (NativeIOS / NativeAndroid) ve kupon kodundan okunur; önceki eş dönemle kıyaslanır."
            right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 14, 30, 90].map((x) => <button key={x} onClick={() => setRange(x)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === x ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{x} gün</button>)}</div>}>
            {!an ? <div className="text-sm text-gray-400">Yükleniyor…</div> : (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Kulakçık hunisi {an.sessions === 0 && <span className="font-normal text-gray-400">— henüz mağaza verisi yok; script temaya eklenince burada birikir.</span>}</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Tile l="1 · Gören oturum" v={n(an.sessions)} sub={an.inapp_sessions ? `${n(an.inapp_sessions)} uygulama içi` : undefined} />
                    <Tile l="2 · Paneli açan" v={`%${an.open_rate}`} sub={`${n(an.open_sessions)} oturum`} />
                    <Tile l="3 · Mağazaya giden" v={n(an.store_visits)} sub={`${n(an.qr_scans)} QR okutma · ${n(an.click_sessions)} buton oturumu`} />
                    <Tile l="Kod kopyalayan" v={n(an.copy_sessions)} sub={`${n(an.copies)} kopyalama`} />
                    <Tile l="4 · Kodla sipariş" v={n(oc?.code_orders || 0)} sub={money(oc?.code_rev || 0)} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Uygulama siparişleri (son {an.range_days} gün, önceki {an.range_days} güne göre)</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Tile l="Uygulama siparişi" v={n(oc?.app || 0)} sub={appDelta === null ? `önceki dönem: ${n(op?.app || 0)}` : `${appDelta >= 0 ? '+' : ''}${appDelta}% (önceki ${n(op?.app || 0)})`} />
                    <Tile l="Uygulama payı" v={`%${oc?.app_share ?? 0}`} sub={`önceki %${op?.app_share ?? 0} · toplam ${n(oc?.total || 0)} sipariş`} />
                    <Tile l="Uygulama cirosu" v={money(oc?.app_rev || 0)} sub={`önceki ${money(op?.app_rev || 0)}`} />
                    <Tile l="Uygulamaya yeni müşteri" v={n(an.new_app_customers.n)} sub={`${n(an.new_app_customers.from_web)} web'den geçti · ${n(an.new_app_customers.with_code)} kod kullandı`} />
                  </div>
                </div>
                {(oc?.code_web || 0) > 0 && <div className="rounded-xl bg-rose-50 text-rose-700 p-3 text-xs flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span><b>{n(oc?.code_web || 0)} sipariş</b> kodu <b>web'den</b> kullandı — Ticimax'taki kupon "yalnız mobil uygulama" kısıtıyla açılmamış olabilir.</span></div>}
                <div className="grid md:grid-cols-2 gap-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Mağazaya geçişler — kaynak × cihaz (Yunbi /go)</p>
                    {an.by_redirect.length === 0 ? <p className="text-xs text-gray-400">Henüz geçiş yok.</p> : (
                      <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Kaynak</th><th className="py-1">Cihaz</th><th className="py-1 text-right">Geçiş</th></tr></thead>
                        <tbody>{an.by_redirect.map((x, i) => <tr key={i} className="border-b border-gray-50"><td className="py-1 text-gray-700">{SRC_LABEL[x.source] || x.source}</td><td className="py-1 text-gray-500">{PLAT_LABEL[x.platform] || x.platform}</td><td className="py-1 text-right font-semibold">{n(x.c)}</td></tr>)}</tbody></table>)}
                    <p className="text-xs font-semibold text-gray-500 mb-2 mt-4">Panel nasıl açıldı</p>
                    {an.by_source.length === 0 ? <p className="text-xs text-gray-400">—</p> : <div className="flex flex-wrap gap-1.5">{an.by_source.map((x) => <span key={x.source} className="text-[11px] rounded-full bg-[var(--app-bg)] px-2.5 py-1 text-gray-700"><b>{SRC_LABEL[x.source] || x.source}</b> {n(x.s)} oturum</span>)}</div>}
                    <p className="text-xs font-semibold text-gray-500 mb-2 mt-4">Cihaza göre</p>
                    <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Cihaz</th><th className="py-1 text-right">Gören</th><th className="py-1 text-right">Açan</th><th className="py-1 text-right">Buton</th><th className="py-1 text-right">Kopyala</th></tr></thead>
                      <tbody>{an.by_platform.map((x) => <tr key={x.platform} className="border-b border-gray-50"><td className="py-1 text-gray-700">{PLAT_LABEL[x.platform] || x.platform}</td><td className="py-1 text-right">{n(x.views)}</td><td className="py-1 text-right">{n(x.opens)} <span className="text-gray-400">(%{pct(x.opens, x.views)})</span></td><td className="py-1 text-right">{n(x.clicks)}</td><td className="py-1 text-right">{n(x.copies)}</td></tr>)}</tbody></table>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Kod kullanımı — sipariş kaynağına göre ({an.code})</p>
                    {an.code_by_source.length === 0 ? <p className="text-xs text-gray-400">Bu dönemde kodla sipariş yok.</p> : (
                      <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Kaynak</th><th className="py-1 text-right">Sipariş</th><th className="py-1 text-right">Ciro</th></tr></thead>
                        <tbody>{an.code_by_source.map((x) => <tr key={x.order_source} className={clsx('border-b border-gray-50', !/^Native/.test(x.order_source) && 'text-rose-600')}><td className="py-1">{x.order_source}</td><td className="py-1 text-right font-semibold">{n(x.c)}</td><td className="py-1 text-right">{money(x.rev)}</td></tr>)}</tbody></table>)}
                    <p className="text-[11px] text-gray-500 mt-2">Kodu kullanan müşteri: <b>{n(an.code_users.n)}</b> · bunların <b>{n(an.code_users.first_orders)}</b>'i ilk siparişini bu kodla verdi (tüm zamanlar).</p>
                    <p className="text-xs font-semibold text-gray-500 mb-2 mt-4">Günlük seyir</p>
                    <div className="max-h-64 overflow-auto rounded-xl border border-gray-100">
                      <table className="w-full text-xs"><thead className="sticky top-0 bg-white"><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1 pl-2">Gün</th><th className="py-1 text-right">Gören</th><th className="py-1 text-right">Açan</th><th className="py-1 text-right">Geçiş</th><th className="py-1 text-right">Uyg. sip.</th><th className="py-1 text-right pr-2">Kodlu</th></tr></thead>
                        <tbody>{[...an.daily].reverse().map((d) => <tr key={d.d} className="border-b border-gray-50"><td className="py-1 pl-2 text-gray-700">{d.d.slice(5)}</td><td className="py-1 text-right">{n(d.views)}</td><td className="py-1 text-right">{n(d.opens)}</td><td className="py-1 text-right">{n(d.redirects)}</td><td className="py-1 text-right">{n(d.app_orders)} <span className="text-gray-400">/ {n(d.orders)}</span></td><td className="py-1 text-right pr-2 font-semibold">{n(d.code_orders)}</td></tr>)}</tbody></table>
                    </div>
                    {an.errors.length > 0 && <p className="text-xs text-rose-600 mt-3">Hatalar: {an.errors.map((e) => `${e.value} (${e.c})`).join(', ')}</p>}
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Canlı önizleme */}
        <div className="lg:sticky lg:top-4 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><Smartphone size={13} /> Canlı önizleme</span><a href={demoUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-indigo-600"><ExternalLink size={13} /></a></div>
          <div className="mb-2"><Seg value={previewPlatform} options={[['ios', 'iPhone'], ['android', 'Android'], ['inapp_ios', 'Uygulama içi']]} onChange={(v) => { setPreviewPlatform(v); setPreviewKey((k) => k + 1) }} /></div>
          <div className="rounded-2xl overflow-hidden bg-gray-900 p-1.5"><div className="rounded-xl overflow-hidden bg-white" style={{ height: 560 }}><PhoneFrame src={previewUrl} title="Uygulamaya Özel önizleme" /></div></div>
          <p className="text-[10.5px] text-gray-400 mt-2 leading-snug">Masaüstü görünümü (QR + iki mağaza butonu) için "Canlı demoyu aç". Önizlemedeki tıklamalar test sayılır, analitiğe girmez.</p>
          {an && an.sessions === 0 && <p className="text-[10.5px] text-gray-400 mt-1 flex items-center gap-1"><BarChart3 size={11} /> Veri, script temaya eklenince akar.</p>}
        </div>
      </div>
    </div>
  )
}
