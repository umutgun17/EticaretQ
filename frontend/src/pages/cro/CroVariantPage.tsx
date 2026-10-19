import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Ruler, Loader2, Check, Copy, ExternalLink, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import api from '@/lib/api'

/* Beden Seçimi (CRO) — ürün detayda varsayılan beden seçimini kaldırır, adresteki parametreyle (?beden=38) bedeni
   seçili açar, diğer renkleri Trendyol tarzı şeritle gösterir (popüler önde) ve az kalan numaraya rozet koyar.
   Panel: aç/kapat, davranış, kurulum kodu, deneme linki, renk şeridi + önizleme, az kalan rozeti, feed bağlantısı. */

interface ColorsUi {
  enabled: boolean; selector: string; sort: 'ranking' | 'popular' | 'theme'; active_first: boolean; popular_badge: boolean
  popular_count: number; popular_min_sales: number; popular_days: number; badge_text: string; show_label: boolean
  label_text: string; show_names: boolean; out_of_stock: 'dim' | 'end' | 'hide'; thumb_width: number; aspect: 'portrait' | 'square' | 'original'; radius: number
  accent: string; max_visible: number; popular_first: boolean; arrows: boolean; count_text: string
}
interface SheetUi {
  enabled: boolean; page_row: boolean; breakpoint: number; title_text: string; keep_size_on_color: boolean
  notify: boolean; similar: boolean; similar_count: number; fit_advice: boolean; fit_min: number
}
interface AbUi { enabled: boolean; share: number }
interface PageUi { hide_badges: boolean; trust_margin: number; hide_extra: string; light_alert: boolean; lightbox_wheel: boolean }
interface AnRow { bucket: string; device: string | null; [k: string]: string | number | null }
interface LowUi { enabled: boolean; threshold: number; text: string; color: string }
interface Ui { colors: ColorsUi; low_stock: LowUi; sheet: SheetUi; ab: AbUi; page: PageUi }
interface Preview {
  model: string
  items: { id: string; image: string | null; name: string }[]
  data: { order: string[]; popular: string[]; oos: string[]; color: Record<string, string>; low: Record<string, number> }
}

interface Settings {
  ui: Ui
  ui_defaults: Ui
  enabled: boolean
  deselect: boolean
  param: string
  feed_links: boolean
  slug: string
  base_url: string
  shop_url: string
  has_variant_feed: boolean
  feed_rows: number | null
}

export default function CroVariantPage() {
  const [st, setSt] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [param, setParam] = useState('beden')
  const [testUrl, setTestUrl] = useState('')
  const [testSize, setTestSize] = useState('38')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [draft, setDraft] = useState<Ui | null>(null)
  const [an, setAn] = useState<{ days: number; rows: AnRow[] } | null>(null)
  const [anDays, setAnDays] = useState(7)

  const load = useCallback(() => {
    setLoading(true)
    api.get<Settings>('/cro/variant/settings').then((r) => { setSt(r.data); setParam(r.data.param); setDraft(r.data.ui) })
      .catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  const loadPreview = useCallback(() => { api.get<Preview>('/cro/variant/preview').then((r) => setPreview(r.data)).catch(() => null) }, [])
  useEffect(() => { loadPreview() }, [loadPreview])
  useEffect(() => { api.get('/cro/variant/analytics', { params: { days: anDays } }).then((r) => setAn(r.data)).catch(() => null) }, [anDays])

  const saveUi = async (key: string, ui: Partial<{ colors: Partial<ColorsUi>; low_stock: Partial<LowUi>; sheet: Partial<SheetUi>; ab: Partial<AbUi>; page: Partial<PageUi> }>) => {
    setSaving(key); setError('')
    try { const r = await api.put<Settings>('/cro/variant/settings', { ui }); setSt(r.data); setDraft(r.data.ui); loadPreview() }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const setC = (k: keyof ColorsUi, v: unknown) => setDraft((d) => (d ? { ...d, colors: { ...d.colors, [k]: v } } : d))
  const setL = (k: keyof LowUi, v: unknown) => setDraft((d) => (d ? { ...d, low_stock: { ...d.low_stock, [k]: v } } : d))
  const dirtyC = !!(st && draft && JSON.stringify(st.ui.colors) !== JSON.stringify(draft.colors))
  const dirtyL = !!(st && draft && JSON.stringify(st.ui.low_stock) !== JSON.stringify(draft.low_stock))
  const setS = (k: keyof SheetUi, v: unknown) => setDraft((d) => (d ? { ...d, sheet: { ...d.sheet, [k]: v } } : d))
  const dirtyS = !!(st && draft && JSON.stringify(st.ui.sheet) !== JSON.stringify(draft.sheet))

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const r = await api.put<Settings>('/cro/variant/settings', body); setSt(r.data); setParam(r.data.param) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }

  const embed = st ? `<script src="${st.base_url}/widget/variant.js?v=4" data-tenant="${st.slug}"></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const built = (() => {
    const u = testUrl.trim()
    if (!u || !st) return ''
    return u + (u.includes('?') ? '&' : '?') + st.param + '=' + encodeURIComponent(testSize.trim()) + '&yunbi_debug=1'
  })()

  if (loading && !st) return <div className="flex items-center justify-center py-24 text-sm text-gray-500 gap-2"><Loader2 size={18} className="animate-spin" /> Yükleniyor…</div>
  if (!st || !draft) return <div className="p-6 text-sm text-red-600">{error || 'Ayarlar yüklenemedi'}</div>
  const c = draft.colors
  const l = draft.low_stock
  const sh = draft.sheet

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] text-[var(--primary-strong)] flex items-center justify-center shrink-0"><Ruler size={20} /></span>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Beden ve Renk Seçimi</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">Ürün sayfası açıldığında beden kendiliğinden seçili gelmez; müşteri kendi numarasını seçer. Reklam ve ürün feed’i linklerinde <code>?{st.param}=38</code> yazıyorsa sayfa o beden seçili açılır.</p>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}

      <Section step="1" title="Kurulum" desc="Kodu ürün detay sayfasına ekleyin. Tema scriptlerinden önce (mümkünse <head> içinde) durursa beden hiç yanıp sönmeden seçimsiz gelir; sonda durursa da çalışır.">
        <Toggle on={st.enabled} busy={saving === 'enabled'} onChange={(v) => patch('enabled', { enabled: v })} label="Beden Seçimi açık" hint="Kapalıyken mağazadaki kod hiçbir şey yapmaz; tema eski davranışına döner." />
        <div className="mt-4">
          <label className="text-xs font-semibold text-gray-600">Ürün detay sayfası kodu</label>
          <div className="mt-1 flex items-start gap-2">
            <code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code>
            <button onClick={copy} className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-600 inline-flex items-center gap-1.5 shrink-0">{copied ? <><Check size={13} /> Kopyalandı</> : <><Copy size={13} /> Kopyala</>}</button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Bu kod kalıcıdır: Yunbi güncellemeleri kendiliğinden gelir, temadaki <code>?v=</code> numarasını değiştirmeniz gerekmez. Ayar değişikliği mağazada birkaç dakika içinde geçerli olur.</p>
        </div>
      </Section>

      <Section step="2" title="Davranış">
        <div className="space-y-4">
          <Toggle on={st.deselect} busy={saving === 'deselect'} onChange={(v) => patch('deselect', { deselect: v })} label="Varsayılan beden seçimini kaldır" hint="Tema, sayfa açılınca stoktaki en küçük bedeni kendiliğinden seçer. Açıkken hiçbir beden seçili gelmez; seçim yapmadan sepete eklenirse tema ‘seçim yapın’ uyarısı verir. Renk seçimi etkilenmez." />
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Adres parametresi</label>
            <div className="flex items-center gap-2">
              <input value={param} onChange={(e) => setParam(e.target.value.toLowerCase())} className="w-40 px-3 py-2 border border-gray-200 rounded-lg text-sm" maxLength={20} />
              <button disabled={param === st.param || saving === 'param'} onClick={() => patch('param', { param })} className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white disabled:opacity-40">Kaydet</button>
              <span className="text-xs text-gray-500">örnek: <code>…/urun-adi-123?{param || 'beden'}=38</code></span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Adresteki beden stokta yoksa ya da üründe bulunmuyorsa hiçbir şey seçilmez. Müşteri bir bedene dokunduktan sonra kod bir daha karışmaz.</p>
          </div>
        </div>
      </Section>

      <Section step="3" title="Deneme" desc="Bir ürün sayfası adresi ve beden yazın; açılan sayfada o beden seçili gelmeli. Linkteki yunbi_debug=1 tarayıcı konsoluna ne yapıldığını yazar.">
        <div className="flex flex-wrap items-center gap-2">
          <input value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder={(st.shop_url || 'https://magaza.com') + '/urun-adi-123'} className="flex-1 min-w-[260px] px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <input value={testSize} onChange={(e) => setTestSize(e.target.value)} className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <a href={built || undefined} target="_blank" rel="noreferrer" className={clsx('px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5', built ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 pointer-events-none')}><ExternalLink size={13} /> Aç</a>
        </div>
        {built && <p className="text-[11px] text-gray-400 mt-1.5 break-all">{built}</p>}
      </Section>

      <Section step="4" title="Renk seçenekleri" desc="Ürünün diğer renklerini Trendyol tarzı küçük görsellerle gösterir: aktif renk çerçeveli, en çok satan renkler önde ve ‘Popüler’ etiketli, stoksuz renk soluk. Temanın ‘Renk Seçenekleri’ bloğu gizlenir, yerine bu şerit gelir.">
        <Toggle on={c.enabled} busy={saving === 'colors.enabled'} onChange={(v) => saveUi('colors.enabled', { colors: { enabled: v } })} label="Renk seçenekleri şeridi açık" hint="Kapalıyken temanın kendi renk bloğu görünür." />
        <div className="mt-4 grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Row label="Sıralama">
              <Select value={c.sort} onChange={(v) => setC('sort', v)} options={[['ranking', 'Akıllı sıralama (kategori sıralamasıyla aynı: numara + stok + satış)'], ['popular', 'Yalnız satış adedi'], ['theme', 'Temanın sırası']]} />
            </Row>
            <Check2 on={c.popular_first} onChange={(v) => setC('popular_first', v)} label="Popüler renkler en başta" />
            <Check2 on={c.active_first} onChange={(v) => setC('active_first', v)} label="Açık olan renk her zaman ilk sırada" />
            <Check2 on={c.arrows} onChange={(v) => setC('arrows', v)} label="Kaydırma okları (sağda / solda)" />
            <Row label="Renk sayısı yazısı ({n} = adet; boş = gösterme)"><input value={c.count_text ?? ''} maxLength={40} onChange={(e) => setC('count_text', e.target.value)} className={inp} /></Row>
            <Check2 on={c.popular_badge} onChange={(v) => setC('popular_badge', v)} label="‘Popüler’ etiketi göster" />
            {c.popular_badge && (
              <div className="pl-6 grid grid-cols-3 gap-2">
                <Row label="Etiket yazısı"><input value={c.badge_text} maxLength={20} onChange={(e) => setC('badge_text', e.target.value)} className={inp} /></Row>
                <Row label="En fazla"><Select value={String(c.popular_count)} onChange={(v) => setC('popular_count', +v)} options={[1, 2, 3, 4, 5].map((n) => [String(n), n + ' renk'])} /></Row>
                <Row label="En az satış"><input type="number" min={1} max={500} value={c.popular_min_sales} onChange={(e) => setC('popular_min_sales', +e.target.value)} className={inp} /></Row>
                <Row label="Satış dönemi"><Select value={String(c.popular_days)} onChange={(v) => setC('popular_days', +v)} options={[7, 14, 30, 60, 90].map((n) => [String(n), 'Son ' + n + ' gün'])} /></Row>
              </div>
            )}
            <Row label="Stoksuz renk">
              <Select value={c.out_of_stock} onChange={(v) => setC('out_of_stock', v)} options={[['dim', 'Soluk göster'], ['end', 'Soluk, sona taşı'], ['hide', 'Gizle']]} />
            </Row>
            <Check2 on={c.show_label} onChange={(v) => setC('show_label', v)} label="Üstte ‘Renk: Lacivert’ başlığı" />
            {c.show_label && <div className="pl-6"><Row label="Başlık"><input value={c.label_text} maxLength={20} onChange={(e) => setC('label_text', e.target.value)} className={inp} /></Row></div>}
            <Check2 on={c.show_names} onChange={(v) => setC('show_names', v)} label="Görsellerin altında renk adı" />
            <div className="grid grid-cols-3 gap-2">
              <Row label="Görsel genişliği"><input type="number" min={44} max={110} value={c.thumb_width} onChange={(e) => setC('thumb_width', +e.target.value)} className={inp} /></Row>
              <Row label="Köşe"><input type="number" min={0} max={24} value={c.radius} onChange={(e) => setC('radius', +e.target.value)} className={inp} /></Row>
              <Row label="Vurgu rengi"><input type="color" value={c.accent} onChange={(e) => setC('accent', e.target.value)} className="h-9 w-full border border-gray-200 rounded-lg" /></Row>
            </div>
            <Row label="Görsel oranı">
              <Select value={c.aspect} onChange={(v) => setC('aspect', v)} options={[['original', 'Fotoğrafın kendi oranı (kırpılmaz)'], ['portrait', 'Dikey kutu 3:4 (Trendyol)'], ['square', 'Kare']]} />
            </Row>
            <Row label="Görünen renk sayısı (0 = hepsi; fazlası ‘+3’ olur)"><input type="number" min={0} max={30} value={c.max_visible} onChange={(e) => setC('max_visible', +e.target.value)} className={inp} /></Row>
            <details className="text-xs text-gray-500"><summary className="cursor-pointer">Gelişmiş</summary>
              <Row label="Temadaki renk bloğu seçicisi"><input value={c.selector} onChange={(e) => setC('selector', e.target.value)} className={inp} /></Row>
            </details>
            <div className="flex gap-2">
              <button disabled={!dirtyC || saving === 'colors'} onClick={() => saveUi('colors', { colors: { ...c, enabled: st.ui.colors.enabled } })} className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white disabled:opacity-40">Kaydet</button>
              {dirtyC && <button onClick={() => setDraft({ ...draft, colors: st.ui.colors })} className="px-3 py-2 rounded-lg text-xs text-gray-600 border border-gray-200">Vazgeç</button>}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">Önizleme {preview?.model && <span className="font-normal text-gray-400">— gerçek ürün: {preview.model}</span>}</div>
            <div className="border border-gray-100 rounded-xl p-4 bg-white">
              {preview ? <ColorPreview c={c} l={l} p={preview} /> : <div className="text-xs text-gray-400">Örnek ürün yükleniyor…</div>}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Akıllı sıralama, kategori sıralamasındaki puanı kullanır (önce numarası tam olan renk, sonra stok, satış, ilgi); ‘Popüler’ etiketi sıranın en üstündeki, en az satış şartını geçen renklere gider. Puanlar 30 dakikada, veri 10 dakikada bir tazelenir. Önizleme kaydedilmemiş değişiklikleri de gösterir.</p>
          </div>
        </div>
      </Section>

      <Section step="5" title="Az kalan numara uyarısı" desc="Stoğu eşiğin altına düşen numaraların altına küçük ‘Son 2’ rozeti koyar. Stok mağaza verisinden (5 dakikada bir eşitlenir) gelir; sayı yalnız eşiğin altındaysa gösterilir.">
        <Toggle on={l.enabled} busy={saving === 'low.enabled'} onChange={(v) => saveUi('low.enabled', { low_stock: { enabled: v } })} label="Az kalan numara rozeti açık" />
        <div className="mt-4 grid grid-cols-3 gap-2 max-w-lg">
          <Row label="Eşik (adet ve altı)"><input type="number" min={1} max={20} value={l.threshold} onChange={(e) => setL('threshold', +e.target.value)} className={inp} /></Row>
          <Row label="Yazı ({n} = adet)"><input value={l.text} maxLength={20} onChange={(e) => setL('text', e.target.value)} className={inp} /></Row>
          <Row label="Renk"><input type="color" value={l.color} onChange={(e) => setL('color', e.target.value)} className="h-9 w-full border border-gray-200 rounded-lg" /></Row>
        </div>
        <div className="flex gap-2 mt-3">
          <button disabled={!dirtyL || saving === 'low'} onClick={() => saveUi('low', { low_stock: { ...l, enabled: st.ui.low_stock.enabled } })} className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white disabled:opacity-40">Kaydet</button>
          {dirtyL && <button onClick={() => setDraft({ ...draft, low_stock: st.ui.low_stock })} className="px-3 py-2 rounded-lg text-xs text-gray-600 border border-gray-200">Vazgeç</button>}
        </div>
      </Section>

      <Section step="6" title="Mobil seçim paneli" desc="Trendyol uygulamasındaki gibi: mobilde beden ızgarası yerine ‘Beden: Seçiniz’ satırı; satıra ya da numara seçmeden ‘Sepete Ekle’ye basınca alttan panel açılır. Panelde ürün görseli, fiyat, kargo bilgisi, renkler, numara ızgarası, kalıp tavsiyesi, stoksuz numarada ‘Gelince Haber Ver’ ve o numarası stokta benzer ürünler bulunur.">
        <Toggle on={sh.enabled} busy={saving === 'sheet.enabled'} onChange={(v) => saveUi('sheet.enabled', { sheet: { enabled: v } })} label="Mobil seçim paneli açık" hint="Yalnız mobilde (ekran genişliği eşiğin altında) çalışır; masaüstü değişmez." />
        <div className="mt-4 grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Check2 on={sh.page_row} onChange={(v) => setS('page_row', v)} label="Sayfada beden ızgarası yerine ‘Beden: Seçiniz’ satırı" />
            <Check2 on={sh.keep_size_on_color} onChange={(v) => setS('keep_size_on_color', v)} label="Panelde renk değişince seçili numara korunsun" />
            <Check2 on={sh.notify} onChange={(v) => setS('notify', v)} label="Stoksuz numarada ‘Gelince Haber Ver’" />
            <Check2 on={sh.similar} onChange={(v) => setS('similar', v)} label="Stoksuz numarada ‘Bu numarada benzer ürünler’" />
            {sh.similar && <div className="pl-6"><Row label="Benzer ürün sayısı"><input type="number" min={3} max={20} value={sh.similar_count} onChange={(e) => setS('similar_count', +e.target.value)} className={inp} /></Row></div>}
            <Check2 on={sh.fit_advice} onChange={(v) => setS('fit_advice', v)} label="Kalıp tavsiyesi (yorumlardan: ‘1 numara büyük alın’ vb.)" />
            {sh.fit_advice && <div className="pl-6"><Row label="En az yorum sayısı (kalıp ifadesi geçen)"><input type="number" min={3} max={100} value={sh.fit_min} onChange={(e) => setS('fit_min', +e.target.value)} className={inp} /></Row></div>}
            <div className="grid grid-cols-2 gap-2">
              <Row label="Başlık"><input value={sh.title_text} maxLength={20} onChange={(e) => setS('title_text', e.target.value)} className={inp} /></Row>
              <Row label="Mobil eşiği (px)"><input type="number" min={480} max={1200} value={sh.breakpoint} onChange={(e) => setS('breakpoint', +e.target.value)} className={inp} /></Row>
            </div>
            <div className="flex gap-2">
              <button disabled={!dirtyS || saving === 'sheet'} onClick={() => saveUi('sheet', { sheet: { ...sh, enabled: st.ui.sheet.enabled } })} className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white disabled:opacity-40">Kaydet</button>
              {dirtyS && <button onClick={() => setDraft({ ...draft, sheet: st.ui.sheet })} className="px-3 py-2 rounded-lg text-xs text-gray-600 border border-gray-200">Vazgeç</button>}
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-600">A/B testi</div>
            <Toggle on={draft.ab.enabled} busy={saving === 'ab.enabled'} onChange={(v) => saveUi('ab.enabled', { ab: { enabled: v } })} label="Paneli ziyaretçilerin bir kısmına göster" hint="Açıkken ziyaretçilerin seçilen yüzdesi paneli görür (A), kalanı görmez (B); her ziyaretçi hep aynı grupta kalır. Aşağıdaki tabloda iki grubun sepete ekleme oranı karşılaştırılır." />
            {draft.ab.enabled && (
              <Row label="Paneli gören yüzde">
                <Select value={String(draft.ab.share)} onChange={(v) => saveUi('ab.share', { ab: { share: +v } })} options={[10, 25, 50, 75, 90].map((n) => [String(n), '%' + n])} />
              </Row>
            )}
          </div>
        </div>
        <VariantAnalytics an={an} days={anDays} setDays={setAnDays} />
      </Section>

      <Section step="7" title="Ürün sayfası düzeni" desc="Temaya dokunmadan ürün sayfasında küçük düzenlemeler. Değişiklik mağazada birkaç dakika içinde geçerli olur.">
        <div className="space-y-3 max-w-xl">
          <Check2 on={draft.page?.light_alert !== false} onChange={(v) => saveUi('page', { page: { light_alert: v } })} label="Numara seçilmeden sepete eklenince hafif uyarı (temanın sayfayı karartan uyarısı yerine)" />
          <Check2 on={draft.page?.lightbox_wheel !== false} onChange={(v) => saveUi('page', { page: { lightbox_wheel: v } })} label="Büyük fotoğraf görüntüleyicisi açıkken kaydırma sayfayı kaydırmasın, fotoğraf değiştirsin (masaüstü)" />
          <Check2 on={!!draft.page?.hide_badges} onChange={(v) => saveUi('page', { page: { hide_badges: v } })} label="Tema rozetlerini gizle (Kritik Stok · İndirimli Ürün · Kargo Bedava)" />
          <Row label="Güven bandına üst boşluk (Kargo Bedava · Hızlı Kargo · Kolay İade), px">
            <input type="number" min={0} max={60} defaultValue={draft.page?.trust_margin ?? 0} onBlur={(e) => saveUi('page', { page: { trust_margin: +e.target.value } })} className={inp} />
          </Row>
          <Row label="Ek gizlenecek öğeler (CSS seçici, virgülle; gelişmiş)">
            <input defaultValue={draft.page?.hide_extra ?? ''} onBlur={(e) => saveUi('page', { page: { hide_extra: e.target.value } })} placeholder="#divOrnek, .ornek-sinif" className={inp} />
          </Row>
        </div>
      </Section>

      <Section step="8" title="Ürün feed’i linkleri" desc="Google Merchant Center beden düzeyinde feed kullanıyorsa her beden satırının linki o bedeni seçili açabilir. Önce kodu mağazaya ekleyip deneyin, sonra açın.">
        {st.has_variant_feed ? (
          <Toggle on={st.feed_links} busy={saving === 'feed_links'} onChange={(v) => patch('feed_links', { feed_links: v })} label={`Feed linklerine ?${st.param}= ekle`} hint={`Beden düzeyindeki Google feed’inde${st.feed_rows ? ` (${st.feed_rows.toLocaleString('tr-TR')} satır)` : ''} her satırın linkine beden eklenir. Değişiklik bir sonraki feed üretiminde (en geç 30 dakika) dosyaya, Google’ın bir sonraki çekiminde Merchant Center’a yansır. Beden Seçimi kapalıyken linklere eklenmez.`} />
        ) : (
          <p className="text-sm text-gray-500">Bu firmada beden düzeyinde üretilen bir Google feed’i yok; bu ayar yalnız o feed için geçerlidir.</p>
        )}
      </Section>
    </div>
  )
}

function Section({ step, title, desc, children }: { step: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-7 h-7 rounded-full bg-[var(--primary-soft)] text-[var(--primary-strong)] text-xs font-bold flex items-center justify-center shrink-0">{step}</span>
        <div><h2 className="font-bold text-gray-900">{title}</h2>{desc && <p className="text-xs text-gray-500 mt-0.5 max-w-2xl leading-relaxed">{desc}</p>}</div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange, label, hint, busy }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; busy?: boolean }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => onChange(!on)}
        className={clsx('mt-0.5 w-10 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-60', on ? 'bg-indigo-600' : 'bg-gray-300')}>
        <span className={clsx('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span><span className="text-sm font-medium text-gray-800 block">{label}</span>{hint && <span className="text-xs text-gray-500 block mt-0.5 max-w-2xl leading-relaxed">{hint}</span>}</span>
    </label>
  )
}

const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">{label}</span>{children}</label>
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: (string[] | [string, string])[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  )
}

function Check2({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="rounded" />{label}</label>
}

/** Mağazadaki şeridin panel içi kopyası (variant.js ile aynı ölçü ve kurallar). */
function ColorPreview({ c, l, p }: { c: ColorsUi; l: LowUi; p: Preview }) {
  const cid = p.items[0]?.id
  const byId = Object.fromEntries(p.items.map((i) => [i.id, i]))
  let order = (c.sort === 'theme' ? p.items.map((i) => i.id) : p.data.order).filter((id) => byId[id])
  const oos = new Set(p.data.oos)
  const pop = new Set(c.popular_badge ? p.data.popular.slice(0, c.popular_count) : [])
  if (c.out_of_stock === 'hide') order = order.filter((id) => !oos.has(id) || id === cid)
  if (c.out_of_stock === 'end') order = [...order.filter((id) => !oos.has(id)), ...order.filter((id) => oos.has(id))]
  if (c.active_first) order = [...order.filter((id) => id === cid), ...order.filter((id) => id !== cid)]
  const w = Math.max(44, Math.min(110, c.thumb_width || 64)), orig = c.aspect === 'original', h = c.aspect === 'square' ? w : Math.round(w * 1.34)
  const visible = c.max_visible > 0 ? order.filter((id, k) => k < c.max_visible || id === cid) : order
  const more = order.length - visible.length
  return (
    <div style={{ color: '#333' }}>
      {c.show_label && <div style={{ fontSize: 15, marginBottom: 8 }}><b>{c.label_text}:</b> {p.data.color[cid] || ''}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 9, alignItems: 'flex-start', fontFamily: 'inherit' }}>
        {visible.map((id) => {
          const it = byId[id], act = id === cid, out = oos.has(id)
          return (
            <div key={id} style={{ position: 'relative', width: w }} title={p.data.color[id]}>
              {pop.has(id) && <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', zIndex: 2, fontSize: 11, fontWeight: 700, lineHeight: '16px', padding: '0 6px', borderRadius: 6, whiteSpace: 'nowrap', color: c.accent, background: '#fff', border: `1px solid ${c.accent}40` }}>{c.badge_text}</span>}
              <div style={{ width: w, height: orig ? undefined : h, border: act ? `2px solid ${c.accent}` : '1px solid #e3e3e3', borderRadius: c.radius, overflow: 'hidden', background: '#f6f6f6', opacity: out ? 0.45 : 1 }}>
                {it.image && <img src={it.image} alt="" style={orig ? { width: '100%', height: 'auto', display: 'block' } : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </div>
              {c.show_names && <div style={{ fontSize: 11, color: act ? '#222' : '#666', fontWeight: act ? 600 : 400, marginTop: 4, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.data.color[id]}</div>}
            </div>
          )
        })}
        {more > 0 && <div style={{ width: w, height: orig ? w : h, border: '1px dashed #cfcfcf', borderRadius: c.radius, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#555' }}>+{more}</div>}
      </div>
      {l.enabled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {['37', '38', '39', '40'].map((z, k) => (
            <div key={z} style={{ position: 'relative', width: 46, height: 38, border: '1px solid #ddd', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
              {z}
              {k === 1 && <span style={{ position: 'absolute', left: '50%', bottom: -8, transform: 'translateX(-50%)', fontSize: 9.5, fontWeight: 700, lineHeight: '13px', padding: '0 4px', borderRadius: 6, whiteSpace: 'nowrap', color: l.color, background: '#fff', border: `1px solid ${l.color}55` }}>{l.text.replace('{n}', '2')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Ölçüm tablosu: A/B kovası × cihaz — görüntüleme, panel açılışı, numara seçimi, sepete ekleme. */
function VariantAnalytics({ an, days, setDays }: { an: { days: number; rows: AnRow[] } | null; days: number; setDays: (n: number) => void }) {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const rows = (an?.rows ?? []).filter((r) => r.device === 'm').sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-600">Mobil ölçüm (test ziyaretleri hariç)</div>
        <Select value={String(days)} onChange={(v) => setDays(+v)} options={[1, 7, 14, 30].map((n) => [String(n), 'Son ' + n + ' gün'])} />
      </div>
      {rows.length === 0 ? <p className="text-xs text-gray-400">Henüz veri yok.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="py-2 font-medium">Grup</th><th className="py-2 font-medium text-right">Ürün görüntüleyen</th><th className="py-2 font-medium text-right">Panel açılışı</th>
            <th className="py-2 font-medium text-right">Numara seçimi</th><th className="py-2 font-medium text-right">Stoksuz numara</th><th className="py-2 font-medium text-right">Sepete ekleyen</th><th className="py-2 font-medium text-right">Sepete ekleme oranı</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const v = num(r.view_sessions), a = num(r.add_cart_sessions)
              return (
                <tr key={String(r.bucket)} className="border-b border-gray-50 last:border-0">
                  <td className="py-2">{r.bucket === 'A' ? 'A · panel açık' : 'B · panel kapalı'}</td>
                  <td className="py-2 text-right tabular-nums">{v.toLocaleString('tr-TR')}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.sheet_open).toLocaleString('tr-TR')}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.size_select).toLocaleString('tr-TR')}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.oos_select).toLocaleString('tr-TR')}</td>
                  <td className="py-2 text-right tabular-nums">{a.toLocaleString('tr-TR')}</td>
                  <td className="py-2 text-right tabular-nums font-semibold">{v > 0 ? '%' + (a / v * 100).toFixed(1) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-gray-400 mt-1.5">Oranlar ziyaretçi (oturum) bazındadır. Grup farkını yorumlamak için her grupta en az birkaç bin görüntüleme bekleyin.</p>
    </div>
  )
}
