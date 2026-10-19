import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  Search, SearchX, MousePointerClick, Wallet, Percent,
  Plus, Check, X, ExternalLink, Sparkles, Trash2, Lightbulb,
  Settings, Copy, Globe, Power, ChevronDown,
} from 'lucide-react'
import { searchApi, type SearchAnalytics, type Synonym, type SearchSettings, type SelectorCandidate } from '@/lib/searchApi'

const num = (n: number) => (n ?? 0).toLocaleString('tr-TR')
const money = (n: number) => (n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
// Sunucu TR saatiyle 'YYYY-MM-DD HH:mm:ss' döner; tarayıcı TZ'sine çevirmeden göster
const dt = (s: string | null) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + ' ' + s.slice(11, 16) : '')
const dur = (m: number | null) => {
  const n = Number(m)
  if (m == null || Number.isNaN(n)) return ''
  return n < 90 ? `${n} dk sonra` : n < 2880 ? `${Math.round(n / 60)} saat sonra` : `${Math.round(n / 1440)} gün sonra`
}

function StatCard({ icon, label, value, sub, tone = 'indigo' }: {
  icon: ReactNode; label: string; value: string; sub?: string; tone?: string
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600', emerald: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-600',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3">
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-none ${tones[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-gray-500 font-medium">{label}</div>
        <div className="text-xl font-extrabold text-gray-900 leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code) } catch {
      const ta = document.createElement('textarea')
      ta.value = code; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); ta.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
        <button onClick={copy}
          className={`text-xs font-medium flex items-center gap-1 rounded-md px-2 py-1 transition ${copied ? 'bg-emerald-50 text-emerald-600' : 'text-indigo-600 hover:bg-indigo-50'}`}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-[11.5px] leading-relaxed rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">{code}</pre>
    </div>
  )
}

/* Kurulum & Ayarlar bölüm kartı: numaralı adım + başlık + açıklama — merchant akışı
   yukarıdan aşağı okunur (yayına al → script → alan bağla → tasarım → kurallar) */
function SetupSection({ step, title, desc, children }: {
  step: string; title: string; desc?: string; children: ReactNode
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[12px] font-bold flex items-center justify-center flex-none mt-0.5">{step}</span>
        <div>
          <div className="text-sm font-semibold text-gray-800">{title}</div>
          {desc && <div className="text-[11.5px] text-gray-400 mt-0.5 leading-relaxed">{desc}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

/* Şablon kartlarındaki mini görsel önizleme (saf CSS mockup — görsel dosyası yok) */
function TplMock({ kind }: { kind: 'drawer' | 'fullscreen' }) {
  if (kind === 'drawer') {
    return (
      <div className="relative h-28 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden">
        {/* arkada soluk mağaza sayfası */}
        <div className="absolute left-2.5 top-2.5 h-1.5 w-12 rounded bg-gray-300" />
        <div className="absolute right-[42%] top-2.5 h-1.5 w-6 rounded bg-gray-300" />
        <div className="absolute left-2.5 top-7 grid grid-cols-3 gap-1.5 w-[52%]">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-7 rounded bg-gray-200" />)}
        </div>
        {/* sağdan açılan panel */}
        <div className="absolute right-0 top-0 bottom-0 w-[38%] bg-white border-l-2 border-indigo-200 shadow-[-6px_0_12px_rgba(0,0,0,.08)] p-2">
          <div className="h-3 rounded-md bg-indigo-50 border border-indigo-200 mb-1.5" />
          <div className="grid grid-cols-2 gap-1">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-6 rounded bg-gray-100 border border-gray-100" />)}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="relative h-28 rounded-lg bg-white border border-gray-200 overflow-hidden">
      {/* üst bar: logo + geniş arama + kapat */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
        <div className="h-2 w-9 rounded bg-gray-800 flex-none" />
        <div className="mx-auto h-3.5 w-[52%] rounded-full bg-indigo-50 border border-indigo-200" />
        <div className="h-3.5 w-3.5 rounded-full bg-gray-100 border border-gray-200 flex-none" />
      </div>
      {/* tam genişlik sonuç ızgarası */}
      <div className="grid grid-cols-6 gap-1.5 p-2.5">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-7 rounded bg-gray-100 border border-gray-100" />)}
      </div>
    </div>
  )
}

const RANGES = [
  ['today', 'Bugün'], ['yesterday', 'Dün'], ['7', '7g'], ['30', '30g'], ['90', '90g'],
] as const
const rangeLabel = (r: string) =>
  r === 'today' ? 'bugün' : r === 'yesterday' ? 'dün' : `son ${r} gün`

export default function SmartSearchPage() {
  const [range, setRange] = useState<string>('30')
  const [salesOpen, setSalesOpen] = useState(false)
  const [clickedOpen, setClickedOpen] = useState(false)
  const [a, setA] = useState<SearchAnalytics | null>(null)
  const [syns, setSyns] = useState<Synonym[]>([])
  const [loading, setLoading] = useState(true)
  const [term, setTerm] = useState('')
  const [alts, setAlts] = useState('')
  const [st, setSt] = useState<SearchSettings | null>(null)
  const [domains, setDomains] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selTrigger, setSelTrigger] = useState('')
  const [selInput, setSelInput] = useState('')
  const [savingSel, setSavingSel] = useState(false)
  const [savedSel, setSavedSel] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [candidates, setCandidates] = useState<SelectorCandidate[] | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [theme, setTheme] = useState<{ font: string; accent: string; ink: string; ratio: string }>({ font: '', accent: '', ink: '', ratio: '' })
  const [savingTheme, setSavingTheme] = useState(false)
  const [savedTheme, setSavedTheme] = useState(false)
  const [placeholders, setPlaceholders] = useState('')
  const [savingPh, setSavingPh] = useState(false)
  const [savedPh, setSavedPh] = useState(false)
  const [materials, setMaterials] = useState('')
  const [savingMat, setSavingMat] = useState(false)
  const [savedMat, setSavedMat] = useState(false)

  const loadAnalytics = useCallback(() => {
    setLoading(true)
    searchApi.analytics(range).then(setA).catch(() => setA(null)).finally(() => setLoading(false))
  }, [range])
  const loadSyns = useCallback(() => { searchApi.synonyms().then(setSyns).catch(() => {}) }, [])
  const loadSettings = useCallback(() => {
    searchApi.settings().then((s) => {
      setSt(s); setDomains(s.domains); setSelTrigger(s.trigger); setSelInput(s.input); setTheme(s.theme || { font: '', accent: '', ink: '', ratio: '' }); setPlaceholders(s.placeholders || ''); setMaterials(s.material_terms || '')
    }).catch(() => setSt(null))
  }, [])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])
  useEffect(() => { loadSyns() }, [loadSyns])
  useEffect(() => { loadSettings() }, [loadSettings])

  const toggleEnabled = async () => {
    if (!st) return
    const next = !st.enabled
    setSt({ ...st, enabled: next })
    try { await searchApi.updateSettings({ enabled: next }) } catch { setSt({ ...st, enabled: !next }) }
  }
  const saveDomains = async () => {
    if (!st) return
    setSaving(true)
    try {
      const r = await searchApi.updateSettings({ domains })
      setSt({ ...st, domains: r.domains }); setDomains(r.domains)
      setSaved(true); setTimeout(() => setSaved(false), 1600)
    } catch { /* sessiz */ }
    setSaving(false)
  }
  const saveSelectors = async () => {
    if (!st) return
    setSavingSel(true)
    try {
      const r = await searchApi.updateSettings({ trigger: selTrigger, input: selInput })
      setSt({ ...st, trigger: r.trigger, input: r.input })
      setSavedSel(true); setTimeout(() => setSavedSel(false), 1600)
    } catch { /* sessiz */ }
    setSavingSel(false)
  }
  const saveTheme = async () => {
    if (!st) return
    setSavingTheme(true)
    try { const r = await searchApi.updateSettings({ theme }); setSt({ ...st, theme: r.theme }); setTheme(r.theme); setSavedTheme(true); setTimeout(() => setSavedTheme(false), 1600) } catch { /* sessiz */ }
    setSavingTheme(false)
  }
  const savePlaceholders = async () => {
    if (!st) return
    setSavingPh(true)
    try { const r = await searchApi.updateSettings({ placeholders }); setSt({ ...st, placeholders: r.placeholders }); setPlaceholders(r.placeholders); setSavedPh(true); setTimeout(() => setSavedPh(false), 1600) } catch { /* sessiz */ }
    setSavingPh(false)
  }
  const saveMaterials = async () => {
    if (!st) return
    setSavingMat(true)
    try { const r = await searchApi.updateSettings({ material_terms: materials }); setSt({ ...st, material_terms: r.material_terms }); setMaterials(r.material_terms); setSavedMat(true); setTimeout(() => setSavedMat(false), 1600) } catch { /* sessiz */ }
    setSavingMat(false)
  }
  const toggleRule = async (key: 'require_stock' | 'require_variant_stock' | 'require_image' | 'badge_enabled') => {
    if (!st) return
    const next = !st[key]
    setSt({ ...st, [key]: next })
    try { await searchApi.updateSettings({ [key]: next }) } catch { setSt({ ...st, [key]: !next }) }
  }
  const setTemplate = async (tpl: 'drawer' | 'fullscreen') => {
    if (!st || st.template === tpl) return
    const prev = st.template
    setSt({ ...st, template: tpl })
    try { await searchApi.updateSettings({ template: tpl }) } catch { setSt({ ...st, template: prev }) }
  }
  const detect = async () => {
    setDetecting(true); setCandidates(null)
    try { const r = await searchApi.detectSelectors(); setCandidates(r.candidates ?? []) }
    catch { setCandidates([]) }
    setDetecting(false)
  }
  const pickCandidate = (c: SelectorCandidate) => {
    if (c.type === 'input') setSelInput((v) => (v ? v + ',' + c.selector : c.selector))
    else setSelTrigger((v) => (v ? v + ',' + c.selector : c.selector))
  }

  const addSynonym = async () => {
    const list = alts.split(',').map((s) => s.trim()).filter(Boolean)
    if (!term.trim() || !list.length) return
    await searchApi.createSynonym({ term: term.trim(), synonyms: list, type: 'synonym' })
    setTerm(''); setAlts(''); loadSyns()
  }
  const setStatus = async (id: number, status: 'active' | 'rejected') => { await searchApi.updateSynonym(id, { status }); loadSyns() }
  const del = async (id: number) => { await searchApi.deleteSynonym(id); loadSyns() }

  const suggested = syns.filter((s) => s.status === 'suggested')
  const active = syns.filter((s) => s.status === 'active')

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Başlık */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><Search size={22} className="text-indigo-600" /> Akıllı Arama</h1>
          <p className="text-sm text-gray-500 mt-0.5">Ne aranıyor, kaç tıklama, aramadan ciro ve kelime optimizasyonu.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/widget/search-demo.html" target="_blank" rel="noreferrer"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 mr-2">
            <ExternalLink size={15} /> Demo'yu aç
          </a>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {RANGES.map(([r, label]) => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${range === r ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Kurulum & Ayarlar — en üstte, açılır/kapanır (varsayılan KAPALI) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <button onClick={() => setSetupOpen((v) => !v)}
          className={`w-full px-4 py-3 font-semibold text-gray-800 text-sm flex items-center gap-2 hover:bg-gray-50 ${setupOpen ? 'border-b border-gray-100' : ''}`}>
          <Settings size={15} className="text-indigo-500" /> Kurulum &amp; Ayarlar
          {st && (
            <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
              {st.enabled ? 'AKTİF' : 'KAPALI'}
            </span>
          )}
          <ChevronDown size={16} className={`ml-auto text-gray-400 transition-transform ${setupOpen ? 'rotate-180' : ''}`} />
        </button>
        {setupOpen && (!st ? (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">Ayarlar yüklenemedi.</div>
        ) : (
          <div className="p-4 space-y-5">
            {/* 1 — Yayın durumu + izinli domainler */}
            <SetupSection step="1" title="Yayın durumu"
              desc="Widget'ı aç/kapat ve hangi sitelerde çalışacağını belirle.">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="flex items-center gap-2 text-sm text-gray-800">
                  <Power size={15} className={st.enabled ? 'text-emerald-500' : 'text-gray-300'} />
                  <span className="font-medium">Arama widget'ı</span>
                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                    {st.enabled ? 'AKTİF' : 'KAPALI'}
                  </span>
                </div>
                <button onClick={toggleEnabled}
                  className={`relative w-11 h-6 rounded-full transition flex-none ${st.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                  title={st.enabled ? 'Kapat' : 'Aç'}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${st.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
              <label className="text-[11px] text-gray-500 font-medium flex items-center gap-1 mb-1">
                <Globe size={12} /> İzinli alan adları (virgülle) — widget yalnız bu sitelerden çalışır
              </label>
              <div className="flex gap-2 flex-wrap">
                <input value={domains} onChange={(e) => setDomains(e.target.value)}
                  placeholder="magazaniz.com"
                  className="flex-1 min-w-[240px] border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 font-mono" />
                <button onClick={saveDomains} disabled={saving || domains === st.domains}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1">
                  {saved ? <Check size={15} /> : null} {saved ? 'Kaydedildi' : saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Sadece ana domain'i yaz — www ve tüm alt alan adları otomatik kapsanır. Domain'i kaldırmak = o siteden widget'ı anında kapatmak (rollback).</p>
            </SetupSection>

            {/* 2 — Tema scripti */}
            <SetupSection step="2" title="Kurulum scripti"
              desc="Bu satırı mağaza temanda </body> etiketinden hemen önceye bir kez ekle — sonrası (tasarım, seçici, kurallar) hep bu panelden yönetilir.">
              <CopyBlock label="Mağaza temasına eklenecek script (tek satır)" code={
                `<script src="${st.base_url}/widget/search.js" data-tenant="${st.slug}"></script>`
              } />
            </SetupSection>

            {/* 3 — Arama alanı bağlama — panelden, script'e dokunmadan */}
            <SetupSection step="3" title="Sitendeki arama alanını bağla"
              desc="Ziyaretçi sitendeki arama ikonuna/kutusuna tıklayınca Yunbi araması açılır. Hangi öğenin arama olduğunu buradan tanımlarsın — script'e dokunmadan.">
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Widget'ın açılması için sitenizdeki <b>arama ikonunun/kutusunun hangi HTML öğesi olduğunu</b> söylemeniz gerekir.
                Bunu bulmak için: sitenizde arama ikonuna <b>sağ tıklayın → "İncele"</b> → açılan kodda öğenin
                <code className="mx-1 bg-white border border-gray-200 rounded px-1">class</code> veya
                <code className="mx-1 bg-white border border-gray-200 rounded px-1">id</code> değerini alın ve başına
                class için <b>nokta</b> (<code className="bg-white border border-gray-200 rounded px-1">.header-search</code>),
                id için <b>#</b> (<code className="bg-white border border-gray-200 rounded px-1">#searchBtn</code>) koyup aşağıya yazın.
                Emin değilseniz <b>"Sitemden bul"</b> adayları otomatik listeler — tıklayın, alan dolsun. Kaydet'e basınca
                temadaki script'e dokunmadan <b>anında</b> uygulanır.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-500 font-medium">Arama ikonu / butonu seçici (tıklayınca panel açılır)</label>
                  <input value={selTrigger} onChange={(e) => setSelTrigger(e.target.value)} placeholder=".header-search-icon, #searchBtn"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 font-mono" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 font-medium">Arama kutusu (input) seçici (odaklanınca panel açılır)</label>
                  <input value={selInput} onChange={(e) => setSelInput(e.target.value)} placeholder='input[type=search], #txtAra'
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={saveSelectors} disabled={savingSel || (selTrigger === st.trigger && selInput === st.input)}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1">
                  {savedSel ? <Check size={15} /> : null} {savedSel ? 'Kaydedildi' : savingSel ? 'Kaydediliyor…' : 'Seçicileri kaydet'}
                </button>
                <button onClick={detect} disabled={detecting}
                  className="border border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-lg px-4 py-2 text-sm font-medium">
                  {detecting ? 'Site taranıyor…' : '🔍 Sitemden bul'}
                </button>
                <span className="text-[11px] text-gray-400">Boş bırakılırsa yaygın arama seçicileri otomatik denenir.</span>
              </div>
              {candidates !== null && (
                <div className="space-y-1.5">
                  {candidates.length === 0 && <div className="text-[12px] text-gray-400">Aday bulunamadı — seçiciyi yukarıdaki tarifle elle girin.</div>}
                  {candidates.map((c, i) => (
                    <button key={i} onClick={() => pickCandidate(c)}
                      className="w-full text-left bg-white border border-gray-200 hover:border-indigo-400 rounded-lg px-3 py-2 group">
                      <span className="text-xs font-mono font-semibold text-indigo-700">{c.selector}</span>
                      <span className="text-[10px] ml-2 rounded bg-gray-100 text-gray-500 px-1.5 py-0.5">{c.type === 'input' ? 'arama kutusu' : 'ikon/buton'}</span>
                      <span className="text-[10px] text-indigo-500 ml-2 opacity-0 group-hover:opacity-100">← eklemek için tıkla</span>
                      <div className="text-[10px] text-gray-400 font-mono truncate mt-0.5">{c.html}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            </SetupSection>

            {/* 4 — Tasarım şablonu: görsel mockup'lı kartlar; tıkla = anında kaydet */}
            <SetupSection step="4" title="Tasarım şablonu"
              desc="Arama deneyiminin görünümünü seç. Tıkladığın anda kaydedilir ve temaya dokunmadan sitene uygulanır (ziyaretçi tarafında en geç ~10 dk).">
              <div className="grid sm:grid-cols-2 gap-3">
                {([
                  ['drawer', 'Yandan Panel', 'Arama ikonuna tıklanınca sağdan dar bir panel kayar; ziyaretçi sayfadan kopmaz. Sade ve hızlı.'],
                  ['fullscreen', 'Tam Sayfa', 'Üstte logo + geniş arama + kapat; sonuçlar tüm ekranı kaplar. "Ayrı bir arama sayfası" hissi, geniş vitrin.'],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} onClick={() => setTemplate(key)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTemplate(key) }}
                    className={`cursor-pointer border-2 rounded-xl p-3 transition ${st.template === key
                      ? 'border-indigo-500 bg-indigo-50/40 shadow-sm'
                      : 'border-gray-200 hover:border-indigo-300 hover:shadow-sm'}`}>
                    <TplMock kind={key} />
                    <div className="flex items-center gap-2 mt-2.5">
                      <span className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${st.template === key ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white'}`}>
                        {st.template === key && <Check size={10} className="text-white" strokeWidth={4} />}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{label}</span>
                      {st.template === key && (
                        <span className="text-[10px] font-bold text-white bg-indigo-500 rounded-full px-2 py-0.5">KULLANILIYOR</span>
                      )}
                      <a href={`/widget/search-demo.html?template=${key}`} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto text-[11px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                        <ExternalLink size={11} /> Canlı önizle
                      </a>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1 leading-relaxed">{hint}</div>
                  </div>
                ))}
              </div>
            </SetupSection>

            {/* 5 — Gösterim kuralları */}
            <SetupSection step="5" title="Gösterim kuralları"
              desc="Arama sonuçlarında hangi ürünlerin görüneceğini belirle. Anahtarlar tıklandığı anda kaydedilir.">
              <div className="grid sm:grid-cols-2 gap-2">
                {([
                  ['require_stock', 'Tükenen ürünleri gizle', 'Toplam stoğu 0 olan ürün hiç listelenmez'],
                  ['require_variant_stock', 'Aranan beden/renk stokta değilse gizle', '"36" arayana 36\'sı tükenmiş ürün gösterilmez'],
                  ['require_image', 'Görselsiz ürünleri gizle', 'Fotoğrafı olmayan ürün listelenmez'],
                  ['badge_enabled', 'Kampanya rozetini göster', 'Ticimax özel alanındaki metin ("1 ALANA 1 BEDAVA" vb.)'],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-800">{label}</div>
                      <div className="text-[11px] text-gray-400 truncate">{hint}</div>
                    </div>
                    <button onClick={() => toggleRule(key)}
                      className={`relative w-10 h-6 rounded-full transition flex-none ${st[key] ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${st[key] ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">Değişiklikler anında uygulanır (5 dk'ya kadar önbellek gecikmesi olabilir).</p>
            </SetupSection>

            {/* 6 — Marka kimliği: yazı tipi + vurgu + metin rengi (boş = varsayılan görünüm) */}
            <SetupSection step="6" title="Marka kimliği"
              desc="Arama panelinin yazı tipi ve renkleri mağazanın kimliğine uysun. Boş bırakılan alan varsayılan görünümde kalır.">
              <div className="grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
                <label className="block"><span className="text-xs font-semibold text-gray-600">Yazı tipi</span>
                  <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" value={theme.font} placeholder="Poppins" onChange={(e) => setTheme({ ...theme, font: e.target.value })} />
                  <span className="text-[11px] text-gray-400 mt-1 block">Temada yüklü olmalı (ör. Poppins, Inter, Montserrat).</span></label>
                <label className="block"><span className="text-xs font-semibold text-gray-600">Vurgu</span>
                  <div className="mt-1 flex items-center gap-2"><input type="color" value={theme.accent || '#6366f1'} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} className="w-9 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><span className="text-xs font-mono text-gray-500">{theme.accent || 'varsayılan'}</span></div></label>
                <label className="block"><span className="text-xs font-semibold text-gray-600">Metin</span>
                  <div className="mt-1 flex items-center gap-2"><input type="color" value={theme.ink || '#0f172a'} onChange={(e) => setTheme({ ...theme, ink: e.target.value })} className="w-9 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" /><span className="text-xs font-mono text-gray-500">{theme.ink || 'varsayılan'}</span></div></label>
                <label className="block"><span className="text-xs font-semibold text-gray-600">Görsel oranı</span>
                  <select className="mt-1 h-[38px] rounded-lg border border-gray-200 px-2 text-sm bg-white" value={theme.ratio} onChange={(e) => setTheme({ ...theme, ratio: e.target.value })}>
                    <option value="">Dikey 2:3 (varsayılan)</option><option value="3/4">3:4</option><option value="1/1">Kare 1:1</option>
                  </select></label>
                <div className="flex gap-2">
                  <button onClick={() => setTheme({ font: '', accent: '', ink: '', ratio: '' })} className="h-[38px] px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Sıfırla</button>
                  <button onClick={saveTheme} disabled={savingTheme} className="h-[38px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{savingTheme ? '…' : savedTheme ? 'Kaydedildi ✓' : 'Kaydet'}</button>
                </div>
              </div>
              <div className="mt-3 flex gap-2 items-end">
                <label className="block flex-1"><span className="text-xs font-semibold text-gray-600">Örnek aramalar (virgülle)</span>
                  <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" value={placeholders} onChange={(e) => setPlaceholders(e.target.value)} placeholder="çelik yüzük, inci kolye, altın kaplama bileklik" />
                  <span className="text-[11px] text-gray-400 mt-1 block">Arama kutusunda daktilo gibi yazılıp silinir. Boş bırakılırsa mağazanın en dolu kategorilerinden otomatik türetilir.</span></label>
                <button onClick={savePlaceholders} disabled={savingPh} className="h-[38px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{savingPh ? '…' : savedPh ? 'Kaydedildi ✓' : 'Kaydet'}</button>
              </div>
              <div className="mt-3 flex gap-2 items-end">
                <label className="block flex-1"><span className="text-xs font-semibold text-gray-600">Malzeme / taş sözlüğü (virgülle)</span>
                  <textarea rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" value={materials} onChange={(e) => setMaterials(e.target.value)} placeholder="ametist, inci, labradorit, kuvars, opal…" />
                  <span className="text-[11px] text-gray-400 mt-1 block">Bu kelimeler ürün adında olmasa da açıklamada geçiyorsa arama bulur (ör. "ametist" → açıklamasında ametist yazan kolyeler). Boşsa yalnız ürün adı aranır.</span></label>
                <button onClick={saveMaterials} disabled={savingMat} className="h-[38px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{savingMat ? '…' : savedMat ? 'Kaydedildi ✓' : 'Kaydet'}</button>
              </div>
            </SetupSection>

          </div>
        ))}
      </div>

      {/* Özet kartlar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Search size={18} />} label="Toplam arama" value={loading ? '…' : num(a?.total_searches ?? 0)} sub={rangeLabel(range)} />
        <StatCard icon={<SearchX size={18} />} label="Sonuçsuz arama" tone="rose"
          value={loading ? '…' : num(a?.zero_result_searches ?? 0)} sub={`%${a?.zero_result_rate ?? 0} oranında`} />
        <StatCard icon={<MousePointerClick size={18} />} label="Tıklama" tone="sky"
          value={loading ? '…' : num(a?.total_clicks ?? 0)} />
        <StatCard icon={<Percent size={18} />} label="CTR" tone="amber" value={loading ? '…' : `%${a?.ctr ?? 0}`} sub="tıklama/arama" />
        <StatCard icon={<Wallet size={18} />} label="Aramadan ciro" tone="emerald"
          value={loading ? '…' : money(a?.attributed_revenue ?? 0)} sub={`${num(a?.conversions ?? 0)} sipariş`} />
      </div>

      {/* Sorgu tabloları */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800 text-sm">En çok aranan</div>
          <div className="divide-y divide-gray-50">
            {(a?.top_queries ?? []).length === 0 && <div className="px-4 py-6 text-sm text-gray-400 text-center">Henüz veri yok.</div>}
            {(a?.top_queries ?? []).map((q, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-800 truncate">{q.normalized_query}</span>
                <span className="flex items-center gap-3 flex-none text-gray-500">
                  <span className="text-[11px]">~{num(q.avg_results)} sonuç</span>
                  <span className="font-semibold text-gray-900 tabular-nums">{num(q.cnt)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center gap-2">
            <SearchX size={15} className="text-rose-500" /> Sonuçsuz aramalar
            <span className="text-[11px] font-normal text-gray-400">— optimizasyon fırsatı</span>
          </div>
          <div className="divide-y divide-gray-50">
            {(a?.top_zero_result_queries ?? []).length === 0 && <div className="px-4 py-6 text-sm text-gray-400 text-center">Sonuçsuz arama yok 🎉</div>}
            {(a?.top_zero_result_queries ?? []).map((q, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-800 truncate">{q.normalized_query}</span>
                <span className="flex items-center gap-2 flex-none">
                  <span className="font-semibold text-gray-900 tabular-nums">{num(q.cnt)}</span>
                  <button onClick={() => { setTerm(q.normalized_query); document.getElementById('syn-alts')?.focus() }}
                    title="Sinonim/yönlendirme ekle"
                    className="text-indigo-600 hover:bg-indigo-50 rounded p-1"><Lightbulb size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sinonim & yazım yönetimi */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center gap-2">
          <Sparkles size={15} className="text-indigo-500" /> Eşanlamlı & yazım kuralları
        </div>

        {/* Agentic önerileri */}
        {suggested.length > 0 && (
          <div className="bg-amber-50/60 border-b border-amber-100 px-4 py-3">
            <div className="text-xs font-semibold text-amber-700 mb-2">🤖 Otomatik öneriler (onayını bekliyor)</div>
            <div className="space-y-2">
              {suggested.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm">
                  <span className="text-gray-800"><b>{s.term}</b> → {s.synonyms.join(', ')} <span className="text-[11px] text-gray-400">({s.type})</span></span>
                  <span className="flex items-center gap-1 flex-none">
                    <button onClick={() => setStatus(s.id, 'active')} className="text-emerald-600 hover:bg-emerald-50 rounded p-1.5" title="Onayla"><Check size={15} /></button>
                    <button onClick={() => setStatus(s.id, 'rejected')} className="text-gray-400 hover:bg-gray-100 rounded p-1.5" title="Reddet"><X size={15} /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ekle formu */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[11px] text-gray-500 font-medium">Terim</label>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="snaker"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>
          <div className="flex-[2] min-w-[180px]">
            <label className="text-[11px] text-gray-500 font-medium">Eşanlamlılar (virgülle)</label>
            <input id="syn-alts" value={alts} onChange={(e) => setAlts(e.target.value)} placeholder="sneaker, spor ayakkabı"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>
          <button onClick={addSynonym} disabled={!term.trim() || !alts.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1">
            <Plus size={15} /> Ekle
          </button>
        </div>

        {/* Aktif kurallar */}
        <div className="divide-y divide-gray-50">
          {active.length === 0 && <div className="px-4 py-6 text-sm text-gray-400 text-center">Henüz kural yok. Sonuçsuz aramalardan 💡 ile hızlı ekleyebilirsin.</div>}
          {active.map((s) => (
            <div key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-800"><b>{s.term}</b> → {s.synonyms.join(', ')}
                <span className="text-[11px] text-gray-400 ml-2">{s.type} · {s.source}{s.hits ? ` · ${s.hits} kez` : ''}</span></span>
              <button onClick={() => del(s.id)} className="text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded p-1.5 flex-none"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* En çok tıklanan ürünler — katlanır (varsayılan kapalı) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <button onClick={() => setClickedOpen((v) => !v)}
          className={`w-full px-4 py-3 font-semibold text-gray-800 text-sm flex items-center gap-2 hover:bg-gray-50 ${clickedOpen ? 'border-b border-gray-100' : ''}`}>
          <MousePointerClick size={15} className="text-sky-500" /> En çok tıklanan ürünler
          <span className="text-[11px] font-normal text-gray-400 truncate">— arama sonuçlarından ürün performansı</span>
          <span className="text-[11px] font-semibold text-sky-600 ml-auto flex-none">{num(a?.total_clicks ?? 0)} tıklama</span>
          <ChevronDown size={16} className={`text-gray-400 flex-none transition-transform ${clickedOpen ? 'rotate-180' : ''}`} />
        </button>
        {clickedOpen && (
        <div className="divide-y divide-gray-50">
          {(a?.top_clicked_products ?? []).length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Henüz tıklama verisi yok.</div>
          )}
          {(a?.top_clicked_products ?? []).map((p) => (
            <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              {p.image
                ? <img src={p.image.replace('/buyuk/', '/thumb/')} alt="" loading="lazy"
                    className="w-9 h-[54px] object-cover rounded flex-none bg-gray-100"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                : <div className="w-9 h-[54px] rounded flex-none bg-gray-100 flex items-center justify-center text-gray-300">🛍️</div>}
              <div className="min-w-0 flex-grow">
                <div className="text-gray-800 truncate">
                  {p.url
                    ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-indigo-600 hover:underline">{p.name}</a>
                    : p.name}
                </div>
                {p.queries && <div className="text-[11px] text-gray-400 truncate" title={p.queries}>Aramalar: {p.queries}</div>}
              </div>
              <span className="flex items-center gap-3 flex-none text-gray-500">
                {p.price != null && <span className="text-[11px] tabular-nums hidden sm:inline">{money(p.price)}</span>}
                {p.avg_position != null && <span className="text-[11px]" title="Sonuç listesindeki ortalama sıra">~{p.avg_position}. sıra</span>}
                <span className="text-[11px]" title="Tıklayan farklı ziyaretçi">{num(p.sessions)} kişi</span>
                <span className="font-semibold text-gray-900 tabular-nums" title="Toplam tıklama">{num(p.clicks)}</span>
              </span>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Aramadan gelen satışlar — katlanır detay: kim ne aratmış, neye tıklamış, ne almış */}
      {(a?.attributed_orders ?? []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => setSalesOpen((v) => !v)}
            className={`w-full px-4 py-3 font-semibold text-gray-800 text-sm flex items-center gap-2 hover:bg-gray-50 ${salesOpen ? 'border-b border-gray-100' : ''}`}>
            <Wallet size={15} className="text-emerald-500" /> Aramadan gelen satışlar
            <span className="text-[11px] font-normal text-gray-400 truncate">— kim ne aratmış, ne almış</span>
            <span className="text-[11px] font-semibold text-emerald-600 ml-auto flex-none">
              {num(a?.conversions ?? 0)} sipariş · {money(a?.attributed_revenue ?? 0)}
            </span>
            <ChevronDown size={16} className={`text-gray-400 flex-none transition-transform ${salesOpen ? 'rotate-180' : ''}`} />
          </button>
          {salesOpen && (
            <div className="divide-y divide-gray-50">
              {(a?.attributed_orders ?? []).map((o, i) => (
                <div key={i} className="px-4 py-2 flex items-center gap-2.5 text-xs">
                  {o.product_image
                    ? <img src={o.product_image.replace('/buyuk/', '/thumb/')} alt="" loading="lazy"
                        className="w-7 h-[42px] object-cover rounded flex-none bg-gray-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                    : <div className="w-7 h-[42px] rounded flex-none bg-gray-100 flex items-center justify-center text-gray-300">🛍️</div>}
                  <div className="min-w-0 flex-grow">
                    <div className="text-gray-800 truncate">
                      {o.product_url
                        ? <a href={o.product_url} target="_blank" rel="noreferrer" className="hover:text-indigo-600 hover:underline">{o.product_name}</a>
                        : (o.product_name ?? '—')}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {o.raw_query && <><span className="text-indigo-500 font-medium">"{o.raw_query}"</span> arattı{o.searched_at ? ` · ${dt(o.searched_at)}` : ''}</>}
                      {o.customer_name && <> · <span className="text-gray-500">{o.customer_name}</span></>}
                      {o.order_no && <> · #{o.order_no}</>}
                    </div>
                  </div>
                  <span className="flex items-center gap-2.5 flex-none text-gray-500">
                    <span className="text-[11px] hidden sm:inline" title={`Sipariş: ${dt(o.order_date)}`}>{dur(o.minutes_to_order)}</span>
                    <span className="text-[11px] tabular-nums hidden md:inline">{dt(o.order_date)}</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">{money(Number(o.total_amount))}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
