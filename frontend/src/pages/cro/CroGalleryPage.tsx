import { useCallback, useEffect, useState } from 'react'
import { Images, ExternalLink, Loader2, Check, Copy, BarChart3, Smartphone, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { galleryApi, type GallerySettings, type GalleryAnalytics } from '@/lib/croApi'

/* Ürün Galerisi (CRO) — ürün detayda temanın görsel slider'ı yerine Yunbi galerisi: üstte büyük kaydırmalı
   görsel, altında küçük görseller, dokununca tam ekran yakınlaştırmalı inceleme. Panel: kurulum, görünüm,
   davranış, gelişmiş seçiciler, canlı önizleme, etkileşim analitiği. */

function PhoneFrame({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(0.5)
  const ref = useCallback((el: HTMLDivElement | null) => { if (!el) return; const ro = new ResizeObserver(() => setScale(el.clientWidth / 390)); ro.observe(el); setScale(el.clientWidth / 390) }, [])
  return (
    <div ref={ref} className="w-full h-full overflow-hidden">
      <iframe title={title} src={src} loading="lazy" className="border-0" style={{ width: 390, height: 640 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

export default function CroGalleryPage() {
  const [st, setSt] = useState<GallerySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [domains, setDomains] = useState('')
  const [sel, setSel] = useState({ source_selector: '', hide_selector: '', mount_selector: '', hide_paths: '' })
  const [an, setAn] = useState<GalleryAnalytics | null>(null)
  const [range, setRange] = useState(30)
  const [previewKey, setPreviewKey] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    galleryApi.settings().then((d) => { setSt(d); setDomains(d.domains); setSel({ source_selector: d.rules.source_selector, hide_selector: d.rules.hide_selector, mount_selector: d.rules.mount_selector, hide_paths: d.rules.hide_paths }) })
      .catch(() => setError('Ayarlar yüklenemedi')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { galleryApi.analytics(range).then(setAn).catch(() => null) }, [range])

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setError('')
    try { const d = await galleryApi.update(body); setSt(d); setPreviewKey((k) => k + 1) }
    catch (e: unknown) { const err = e as { response?: { data?: { message?: string } } }; setError(err?.response?.data?.message || 'Kaydedilemedi') }
    finally { setSaving(null) }
  }
  const embed = st ? `<script src="${st.base_url}/widget/gallery.js?v=10" data-tenant="${st.slug}" async></script>` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ } }
  const previewUrl = st ? `/widget/gallery-demo.html?tenant=${st.slug}&theme=${encodeURIComponent(JSON.stringify(st.theme))}&rules=${encodeURIComponent(JSON.stringify({ ...st.rules, devices: 'all' }))}&k=${previewKey}` : ''
  const demoUrl = st ? `/widget/gallery-demo.html?tenant=${st.slug}` : '#'

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

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
  if (!st) return <div className="bg-rose-50 text-rose-700 rounded-xl p-4 text-sm">{error || 'Ayarlar yüklenemedi'}</div>
  const t = st.theme, r = st.rules

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Images size={24} /> Ürün Galerisi
            <span className={clsx('text-[11px] font-semibold rounded-full px-2 py-0.5', st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>{st.enabled ? 'AKTİF' : 'KAPALI'}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Ürün detayda temanın görsel slider'ı yerine: üstte büyük kaydırmalı görsel, altında küçük görseller, dokununca tam ekran yakınlaştırmalı inceleme (dikiş ve doku görünür). Görseller mağazanın kendi CDN'inden yüksek çözünürlükte çekilir.</p>
        </div>
        <a href={demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-full"><Smartphone size={15} /> Canlı demoyu aç</a>
      </div>
      {error && <div className="bg-rose-50 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="space-y-5">
          {/* 1 Kurulum */}
          <Section step="1" title="Kurulum" desc="Tek satır embed; yalnız ürün detay sayfalarında çalışır. Tema slider'ı DOM'da kalır ve gizlenir; renk/varyant değişince galeri kendini yeniler.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Toggle on={st.enabled} onChange={(v) => patch('enabled', { enabled: v })} label="Galeri açık" hint="Kapalıyken mağazadaki script hiçbir şey yapmaz, temanın slider'ı görünür." />
                <div><label className="text-xs font-semibold text-gray-600">İzinli domainler (virgülle)</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="tonnyblack.com.tr" /><button onClick={() => patch('domains', { domains })} disabled={saving === 'domains'} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60">Kaydet</button></div></div>
                <div><label className="text-xs font-semibold text-gray-600 block mb-1">Hangi cihazlarda</label><Seg value={r.devices} options={[['mobile', 'Yalnız mobil'], ['all', 'Mobil + masaüstü'], ['desktop', 'Yalnız masaüstü']]} onChange={(v) => patch('rules', { rules: { devices: v } })} /></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600">Tema embed kodu (ürün detay şablonu veya tüm sayfalar, {'</body>'} öncesi)</label>
                <div className="mt-1 flex items-start gap-2"><code className="flex-1 block text-[11.5px] bg-gray-900 text-emerald-200 rounded-xl p-3 break-all">{embed}</code><button onClick={copy} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">{copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button></div>
                <p className="text-[11px] text-gray-400 mt-1.5">Her widget güncellemesinde <code>?v</code> numarası artırılır (CDN önbelleği).</p></div>
            </div>
          </Section>

          {/* 2 Görünüm */}
          <Section step="2" title="Görünüm" desc="Değişiklikler anında kaydedilir; sağdaki telefon canlı önizlemedir (görünüm + davranış ayarları birebir uygulanır).">
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Ana görsel oranı</label><Seg value={t.aspect} options={[['photo', 'Fotoğraf oranı (kırpmaz)'], ['1:1', 'Kare'], ['2:3', '2:3'], ['3:4', '3:4'], ['4:5', '4:5'], ['auto', 'Serbest']]} onChange={(v) => patch('theme', { theme: { aspect: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Sığdırma</label><Seg value={t.fit} options={[['cover', 'Doldur (kırp)'], ['contain', 'Tamamı görünsün']]} onChange={(v) => patch('theme', { theme: { fit: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Gösterge</label><Seg value={t.indicator} options={[['both', 'Nokta + sayaç'], ['dots', 'Nokta'], ['counter', 'Sayaç'], ['none', 'Yok']]} onChange={(v) => patch('theme', { theme: { indicator: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Küçük görsel biçimi</label><Seg value={t.thumb_style} options={[['photo', 'Fotoğraf oranı'], ['square', 'Kare'], ['tall', 'Dikey 3:4'], ['round', 'Yuvarlak']]} onChange={(v) => patch('theme', { theme: { thumb_style: v } })} /></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Küçük görsel boyu</label><select className={inputCls} value={t.thumb_size} onChange={(e) => patch('theme', { theme: { thumb_size: Number(e.target.value) } })}>{[48, 56, 64, 72, 80, 96].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Köşe yuvarlaklığı</label><select className={inputCls} value={t.radius} onChange={(e) => patch('theme', { theme: { radius: Number(e.target.value) } })}>{[0, 6, 10, 14, 20].map((n) => <option key={n} value={n}>{n}px</option>)}</select></div>
              <Color label="Vurgu (aktif küçük görsel, nokta)" value={t.accent} onChange={(v) => patch('theme', { theme: { accent: v } })} />
              <Color label="Tam ekran zemini" value={t.viewer_bg} onChange={(v) => patch('theme', { theme: { viewer_bg: v } })} />
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Büyüt ikonu</label><Seg value={t.zoom_hint ? 'on' : 'off'} options={[['on', 'Göster'], ['off', 'Gizle']]} onChange={(v) => patch('theme', { theme: { zoom_hint: v === 'on' } })} /></div>
            </div>
          </Section>

          {/* 3 Davranış */}
          <Section step="3" title="Davranış" desc="Kaydırma, küçük görseller ve yakınlaştırma. Ana görsel ve tam ekran her zaman mağazaya yüklenen orijinal dosyayı birebir gösterir (CDN yeniden sıkıştırmaz); çözünürlük yüklenen fotoğrafın boyutu kadardır.">
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              <Toggle on={r.viewer_enabled} onChange={(v) => patch('rules', { rules: { viewer_enabled: v } })} label="Tam ekran inceleme" hint="Ana görsele dokununca büyük görüntüleyici açılır. Kapalıysa yalnız sayfa içi galeri çalışır." />
              <Toggle on={r.zoom_enabled} onChange={(v) => patch('rules', { rules: { zoom_enabled: v } })} label="Yakınlaştırma" hint="Tam ekranda iki parmak / çift dokunuş / tekerlek ile büyütme." />
              <Toggle on={r.thumbs_on_page} onChange={(v) => patch('rules', { rules: { thumbs_on_page: v } })} label="Sayfada küçük görseller" hint="Ana görselin altında yatay şerit; dokununca o kareye gider." />
              <Toggle on={r.thumbs_in_viewer} onChange={(v) => patch('rules', { rules: { thumbs_in_viewer: v } })} label="Tam ekranda küçük görsel şeridi" hint="Alt kenarda; görseller arasında hızlı geçiş." />
              <Toggle on={r.swipe_main} onChange={(v) => patch('rules', { rules: { swipe_main: v } })} label="Ana görselde yana kaydırma" hint="Kapalıysa yalnız küçük görsellerle geçilir." />
              <Toggle on={r.indicator_arrows} onChange={(v) => patch('rules', { rules: { indicator_arrows: v } })} label="Masaüstünde ok butonları" hint="Fareyle üzerine gelince sağ/sol oklar (mobilde görünmez)." />
              <Toggle on={r.show_title} onChange={(v) => patch('rules', { rules: { show_title: v } })} label="Tam ekranda ürün adı" hint="Üst çubukta ürün adı ve görsel sayacı." />
              <Toggle on={r.share_button} onChange={(v) => patch('rules', { rules: { share_button: v } })} label="Paylaş butonu" hint="Telefonda paylaşım menüsü (WhatsApp, Instagram…); masaüstünde ürün bağlantısını kopyalar." />
              <Toggle on={r.download_button} onChange={(v) => patch('rules', { rules: { download_button: v } })} label="İndir butonu" hint="Açık görseli yüksek çözünürlükte cihaza indirir." />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Maksimum yakınlaştırma</label><select className={inputCls} value={r.max_zoom} onChange={(e) => patch('rules', { rules: { max_zoom: Number(e.target.value) } })}>{[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}×</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Çift dokunuş yakınlaştırma</label><select className={inputCls} value={r.double_tap_zoom} onChange={(e) => patch('rules', { rules: { double_tap_zoom: Number(e.target.value) } })}>{[1.5, 2, 2.5, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Mobil eşiği</label><select className={inputCls} value={r.max_width} onChange={(e) => patch('rules', { rules: { max_width: Number(e.target.value) } })}>{[640, 768, 899, 991, 1024].map((n) => <option key={n} value={n}>≤ {n}px</option>)}</select></div>
              <div><label className="text-xs font-semibold text-gray-600 block mb-1">Önden yüklenen görsel</label><select className={inputCls} value={r.preload} onChange={(e) => patch('rules', { rules: { preload: Number(e.target.value) } })}>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            </div>
          </Section>

          {/* 4 Gelişmiş */}
          <Section step="4" title="Gelişmiş: tema seçicileri" desc="Varsayılanlar Ticimax içindir. Başka altyapıda görseller nereden okunacak, tema slider'ı hangi seçiciyle gizlenecek ve galeri nereye yerleşecek burada değişir."
            right={<button onClick={() => { const d = st.defaults.rules; setSel({ source_selector: d.source_selector, hide_selector: d.hide_selector, mount_selector: d.mount_selector, hide_paths: '' }); patch('rules', { rules: { source_selector: d.source_selector, hide_selector: d.hide_selector, mount_selector: d.mount_selector, hide_paths: '' } }) }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"><RotateCcw size={13} /> Varsayılan</button>}>
            <div className="grid md:grid-cols-2 gap-3">
              {([['source_selector', 'Görsel kaynağı (a/img seçicileri, virgülle)'], ['hide_selector', 'Gizlenecek tema öğeleri'], ['mount_selector', 'Yerleşim (before:SEL / after:SEL / replace:SEL / append:SEL)'], ['hide_paths', 'Galerinin kapalı kalacağı yollar (önek, virgülle)']] as const).map(([k, l]) => (
                <div key={k}><label className="text-xs font-semibold text-gray-600">{l}</label>
                  <div className="flex gap-2 mt-1"><input className={clsx(inputCls, 'flex-1 font-mono text-xs')} value={sel[k]} onChange={(e) => setSel({ ...sel, [k]: e.target.value })} /><button onClick={() => patch(k, { rules: { [k]: sel[k] } })} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Kaydet</button></div></div>
              ))}
            </div>
          </Section>

          {/* 5 Analitik */}
          <Section step="5" title="Etkileşim analitiği" desc="Galeriyi gören oturumların kaçı görselleri kaydırdı, tam ekran açtı, yakınlaştırdı. Ürün fotoğrafına yakından bakan ziyaretçi satın alma niyeti taşır."
            right={<div className="flex bg-[var(--app-bg)] rounded-full p-0.5">{[7, 30, 90].map((n) => <button key={n} onClick={() => setRange(n)} className={clsx('px-3 py-1 text-xs font-semibold rounded-full', range === n ? 'bg-white shadow-sm text-[var(--primary-strong)]' : 'text-gray-500')}>{n} gün</button>)}</div>}>
            {!an || an.sessions === 0 ? (
              <div className="text-sm text-gray-500 flex items-center gap-2"><BarChart3 size={16} className="text-gray-300" /> Henüz mağaza verisi yok. Widget ürün sayfalarında ziyaretçiye ulaşınca burada birikir.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[['Galeriyi gören oturum', an.sessions.toLocaleString('tr-TR')], ['Etkileşen oturum', `%${an.interact_rate}`], ['Tam ekran açan', `%${an.open_rate}`], ['Yakınlaştıran', `%${an.zoom_rate}`]].map(([l, v]) => (
                    <div key={l} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className="text-xl font-extrabold text-gray-900">{v}</p></div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Kaçıncı görsele kadar bakıldı (kaydırma + küçük görsel)</p>
                    {an.depth.map((d) => { const max = Math.max(...an.depth.map((x) => x.c), 1); return (
                      <div key={d.image_index} className="mb-1.5"><div className="flex justify-between text-xs mb-0.5"><span className="font-semibold text-gray-700">{d.image_index + 1}. görsel</span><span className="text-gray-500">{d.c}</span></div><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: Math.round(d.c / max * 100) + '%' }} /></div></div>) })}
                    <p className="text-xs text-gray-500 mt-3">Ürün başına ortalama {an.avg_image_count} görsel · {an.swipes.toLocaleString('tr-TR')} kaydırma · {an.thumbs.toLocaleString('tr-TR')} küçük görsel dokunuşu · {an.opens.toLocaleString('tr-TR')} tam ekran · {an.zooms.toLocaleString('tr-TR')} yakınlaştırma</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">En çok yakından incelenen ürünler</p>
                    <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1">Ürün sayfası</th><th className="py-1 text-right">Açma+zoom</th><th className="py-1 text-right">Oturum</th></tr></thead>
                      <tbody>{an.by_product.map((p) => <tr key={p.product_id + p.page_path} className="border-b border-gray-50"><td className="py-1 max-w-[260px] truncate text-gray-700">{st.shop_url ? <a href={st.shop_url + p.page_path} target="_blank" rel="noreferrer" className="hover:underline">{p.page_path}</a> : p.page_path}</td><td className="py-1 text-right">{p.c}</td><td className="py-1 text-right text-gray-500">{p.s}</td></tr>)}</tbody></table>
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
          <div className="rounded-2xl overflow-hidden bg-gray-900 p-1.5"><div className="rounded-xl overflow-hidden bg-white" style={{ height: 560 }}><PhoneFrame src={previewUrl} title="Galeri önizleme" /></div></div>
          <p className="text-[10.5px] text-gray-400 mt-2 leading-snug">Nötr örnek görsellerle çizilir; mağazadaki gerçek ürün fotoğrafları kullanılır. Ana görsele dokunarak tam ekranı deneyebilirsin.</p>
        </div>
      </div>
    </div>
  )
}
