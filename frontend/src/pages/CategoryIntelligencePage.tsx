import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FolderTree, PackageX, PackageSearch, Sparkles, Check, X, ExternalLink,
  ListOrdered, RefreshCw, AlertTriangle, Eye, GitBranch, Boxes, ShieldCheck,
  Save, RotateCcw, History, Pencil, FlaskConical, Rocket, Pin,
} from 'lucide-react'
import {
  catalogApi,
  type AbResults,
  type CatalogOverview,
  type CategorySuggestionItem,
  type DiscoverySettings,
  type RankingCategory,
  type RankingDiscovery,
  type RankingPins,
  type RankingPreview,
  type RankingWeights,
} from '@/lib/catalogApi'

const num = (n: number) => (n ?? 0).toLocaleString('tr-TR')
const pct = (n: number | null | undefined) => n == null ? '—' : `%${Math.round(n * 100)}`

/** Sinyal ağırlıkları — panelde formülü şeffaf gösterir. */
const WEIGHT_LABELS: Record<string, { label: string; desc: string }> = {
  sales: { label: 'Satış', desc: 'Son 90 gün ödenmiş satış adedi (log ölçek)' },
  engagement: { label: 'İnceleniyor', desc: 'GA4 görüntülenme + 3×sepete ekleme (90g)' },
  trend: { label: 'Trend', desc: 'Son 14 günün satış ivmesi (90g içindeki payı)' },
  favorites: { label: 'Favori', desc: 'Son 180 gün favoriye eklenme (log ölçek)' },
  reviews: { label: 'Yorum', desc: 'Bayesian yorum puanı (az yorumla şişirilemez, C=20)' },
  conversion: { label: 'Dönüşüm', desc: 'GA4 satın alma / görüntülenme oranı' },
  freshness: { label: 'Yenilik', desc: 'exp(−yaş/45g) — yeni ürün doğal öne çıkar, zamanla söner' },
  stock: { label: 'Stok', desc: 'Satılabilir stok derinliği (log ölçek)' },
}

const SIGNAL_KEYS = ['sales', 'engagement', 'trend', 'favorites', 'reviews', 'conversion', 'freshness', 'stock'] as const

function StatCard({ icon, label, value, sub, tone = 'indigo' }: {
  icon: ReactNode; label: string; value: string; sub?: string; tone?: string
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', violet: 'bg-violet-50 text-violet-600',
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

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return <div className="w-10 h-[60px] rounded-md bg-gray-100 flex items-center justify-center text-gray-300 flex-none">🛍️</div>
  }
  return <img src={src} alt={alt} loading="lazy" className="w-10 h-[60px] rounded-md object-cover bg-gray-100 flex-none" />
}

function TierBadge({ tier }: { tier: 'auto' | 'review' }) {
  return tier === 'auto'
    ? <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"><ShieldCheck size={11} /> otomatik</span>
    : <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"><Eye size={11} /> onaylık</span>
}

function StatusBadge({ status }: { status: CategorySuggestionItem['status'] }) {
  const map: Record<string, string> = {
    suggested: 'bg-sky-50 text-sky-700', approved: 'bg-indigo-50 text-indigo-700',
    applied: 'bg-emerald-50 text-emerald-700', auto_applied: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-gray-100 text-gray-500', failed: 'bg-rose-50 text-rose-700',
  }
  const label: Record<string, string> = {
    suggested: 'öneri', approved: 'onaylı', applied: 'uygulandı',
    auto_applied: 'oto-uygulandı', rejected: 'reddedildi', failed: 'hata',
  }
  return <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${map[status]}`}>{label[status]}</span>
}

/** 0..1 sinyal değerini mini yatay bar olarak gösterir. */
function SignalBar({ value, title }: { value: number; title: string }) {
  const w = Math.max(2, Math.min(100, Math.round(value * 100)))
  return (
    <div title={`${title}: ${value.toFixed(3)}`} className="w-full">
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-indigo-400" style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

// ───────────────────────── Genel Bakış ─────────────────────────

function OverviewTab({ data, onRefresh }: { data: CatalogOverview; onRefresh: () => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Boxes size={18} />} label="Aktif ürün" value={num(data.products_active)}
          sub={`toplam ${num(data.products_total)}`} tone="indigo" />
        <StatCard icon={<PackageX size={18} />} label="Sorunlu ürün" value={num(data.products_problem)}
          sub="kategorisiz / kırık kategori" tone="rose" />
        <StatCard icon={<PackageSearch size={18} />} label="Navigasyonda görünmez" value={num(data.products_orphan)}
          sub="hiçbir aktif kategoride değil" tone="amber" />
        <StatCard icon={<FolderTree size={18} />} label="Aktif kategori" value={num(data.categories_active)}
          sub={`${num(data.categories_assignable)} atanabilir`} tone="sky" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Eye size={18} />} label="Onay bekleyen" value={num(data.suggestions.review_pending)}
          sub="senin kararın gerekiyor" tone="amber" />
        <StatCard icon={<ShieldCheck size={18} />} label="Otomatik (bekliyor)" value={num(data.suggestions.auto_pending)}
          sub="katmanlar hemfikir, güven ≥%85" tone="emerald" />
        <StatCard icon={<Check size={18} />} label="Uygulandı" value={num(data.suggestions.applied)}
          sub="Ticimax'a yazıldı" tone="emerald" />
        <StatCard icon={<Sparkles size={18} />} label="Sınıflandırma kuyruğu" value={num(data.backlog_remaining)}
          sub="henüz analiz edilmedi" tone="violet" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 text-[13px] text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1.5">Nasıl çalışır?</div>
        <p><b>Kategori Denetçisi</b> sorunlu ürünleri 3 katmanla sınıflandırır: <b>1) Model ailesi</b> — aynı stok kodlu, kategorisi düzgün kardeş ürünler; <b>2) Kurallar + benzerlik</b> — beden setinden yaş grubu (çocuk/yetişkin) + yapay zekâ embedding'iyle en yakın 20 komşunun kategori dağılımı; <b>3) Görselli yapay zekâ</b> — Claude ürün fotoğrafına bakıp kategori ağacından 1 birincil + gerekli ikincil kategorileri seçer.</p>
        <p className="mt-1.5">Katmanlar <b>hemfikirse ve güven ≥%85 ise</b> öneri "otomatik" katmanına düşer; aksi halde (ör. beden seti çocuk derken yapay zekâ yetişkin kategorisi seçtiyse) <b>onayına sunulur</b>. Her öneride ürünün önceki durumu saklanır — geri alınabilir. Yeni kategori açma önerileri her zaman onay gerektirir.</p>
        {data.last_tree_sync && <p className="mt-1.5 text-[11.5px] text-gray-400">Son ağaç senkronu: {new Date(data.last_tree_sync).toLocaleString('tr-TR')}</p>}
      </div>

      <button onClick={onRefresh} className="text-xs text-indigo-600 font-medium flex items-center gap-1 hover:underline">
        <RefreshCw size={13} /> Yenile
      </button>
    </div>
  )
}

// ───────────────────────── Öneriler ─────────────────────────

function SuggestionsTab() {
  const [status, setStatus] = useState('suggested')
  const [tier, setTier] = useState('')
  const [items, setItems] = useState<CategorySuggestionItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkNote, setBulkNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await catalogApi.suggestions({ status, tier: tier || undefined, page, per_page: perPage })
      setItems(r.items); setTotal(r.total); setSel(new Set())
    } finally { setLoading(false) }
  }, [status, tier, page, perPage])

  useEffect(() => { void load() }, [load])

  const act = async (id: number, action: 'approve' | 'reject') => {
    setBusyId(id)
    try {
      if (action === 'approve') await catalogApi.approve(id, true)
      else await catalogApi.reject(id)
      await load()
    } finally { setBusyId(null) }
  }

  const selectable = items.filter(s => (s.status === 'suggested' || s.status === 'failed') && s.action !== 'create_category')
  const allSelected = selectable.length > 0 && selectable.every(s => sel.has(s.id))
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(selectable.map(s => s.id)))
  const toggleOne = (id: number) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const bulkAct = async (action: 'approve' | 'reject') => {
    if (sel.size === 0) return
    setBulkBusy(true); setBulkNote(null)
    try {
      const r = await catalogApi.bulk(Array.from(sel), action)
      setBulkNote(action === 'approve'
        ? `${r.count} öneri onaylandı — Ticimax'a arka planda uygulanıyor (birkaç dakika sürebilir; "Uygulanan" sekmesinden izlenebilir).`
        : `${r.count} öneri reddedildi.`)
      await load()
    } finally { setBulkBusy(false) }
  }

  const filters: { key: string; label: string }[] = [
    { key: 'suggested', label: 'Bekleyen' }, { key: 'applied', label: 'Uygulanan' },
    { key: 'rejected', label: 'Reddedilen' }, { key: 'failed', label: 'Hatalı' }, { key: 'all', label: 'Tümü' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map(f => (
          <button key={f.key} onClick={() => { setStatus(f.key); setPage(1) }}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${status === f.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
            {f.label}
          </button>
        ))}
        <div className="w-px h-5 bg-gray-200 mx-1" />
        {[{ k: '', l: 'Hepsi' }, { k: 'review', l: 'Onaylık' }, { k: 'auto', l: 'Otomatik' }].map(t => (
          <button key={t.k} onClick={() => { setTier(t.k); setPage(1) }}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${tier === t.k ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {t.l}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">{num(total)} kayıt</span>
        <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600">
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / sayfa</option>)}
        </select>
      </div>

      {selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300" />
            Sayfadakilerin tümünü seç ({selectable.length})
          </label>
          {sel.size > 0 && (
            <>
              <span className="text-xs text-indigo-600 font-semibold">{sel.size} seçili</span>
              <button disabled={bulkBusy} onClick={() => void bulkAct('approve')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                <Check size={13} /> Seçilenleri Onayla & Uygula
              </button>
              <button disabled={bulkBusy} onClick={() => void bulkAct('reject')}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 flex items-center gap-1">
                <X size={13} /> Seçilenleri Reddet
              </button>
            </>
          )}
          {bulkBusy && <span className="text-xs text-gray-400">İşleniyor…</span>}
        </div>
      )}
      {bulkNote && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{bulkNote}</div>
      )}

      <div className="space-y-2">
        {loading && <div className="text-sm text-gray-400 py-8 text-center">Yükleniyor…</div>}
        {!loading && items.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">Kayıt yok.</div>}
        {!loading && items.map(s => (
          <div key={s.id} className={`bg-white border rounded-xl p-3.5 ${sel.has(s.id) ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200'}`}>
            <div className="flex gap-3">
              {(s.status === 'suggested' || s.status === 'failed') && s.action !== 'create_category' && (
                <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleOne(s.id)}
                  className="mt-1 flex-none rounded border-gray-300 cursor-pointer" />
              )}
              <Thumb src={s.product?.image ?? null} alt={s.product?.name ?? ''} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-gray-900 truncate">{s.product?.name ?? `Ürün #${s.product?.id}`}</span>
                  {s.product?.url && (
                    <a href={s.product.url} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-indigo-500"><ExternalLink size={13} /></a>
                  )}
                  <TierBadge tier={s.tier} />
                  <StatusBadge status={s.status} />
                  <span className="text-[10.5px] font-semibold text-gray-400">güven {pct(s.confidence)}</span>
                </div>

                <div className="mt-1.5 text-[12px] leading-relaxed">
                  <span className="text-gray-400">Mevcut:</span>{' '}
                  <span className="text-rose-600">{s.current_path || s.current_category || 'Kategorisiz / kırık'}</span>
                  {s.action === 'create_category' ? (
                    <>
                      <span className="text-gray-300 mx-1.5">→</span>
                      <span className="text-violet-700 font-medium">🆕 Yeni kategori önerisi: {s.new_category?.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-300 mx-1.5">→</span>
                      <span className="text-emerald-700 font-medium">{s.suggested_primary_path}</span>
                      {s.suggested_secondary_paths.length > 0 && (
                        <span className="text-gray-400"> &nbsp;+ ikincil: {s.suggested_secondary_paths.join(' · ')}</span>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                  {s.sources.family?.path && <span>👪 aile: {s.sources.family.path} ({pct(s.sources.family.share)}, {s.sources.family.count} kardeş)</span>}
                  {s.sources.knn?.path && <span>🧭 komşular: {s.sources.knn.path} ({pct(s.sources.knn.share)})</span>}
                  {s.sources.llm_confidence != null && <span>🤖 görselli AI: {pct(s.sources.llm_confidence)}</span>}
                  {s.sources.age_group && <span>📏 beden→{s.sources.age_group === 'cocuk' ? 'çocuk' : 'yetişkin'}</span>}
                  {s.sources.agree.length > 0 && <span className="text-emerald-500">✓ hemfikir: {s.sources.agree.join('+')}</span>}
                </div>

                {s.rationale && <div className="mt-1 text-[11.5px] text-gray-500 italic">{s.rationale}</div>}
                {s.error && <div className="mt-1 text-[11.5px] text-rose-600">Hata: {s.error}</div>}
              </div>

              {(s.status === 'suggested' || s.status === 'failed') && (
                <div className="flex flex-col gap-1.5 flex-none">
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'approve')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                    <Check size={13} /> {s.action === 'create_category' ? 'Onayla' : 'Onayla & Uygula'}
                  </button>
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'reject')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 flex items-center gap-1">
                    <X size={13} /> Reddet
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {total > perPage && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">← Önceki</button>
          <span className="text-xs text-gray-400">{page} / {Math.ceil(total / perPage)}</span>
          <button disabled={page >= Math.ceil(total / perPage)} onClick={() => setPage(p => p + 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Sonraki →</button>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Ağaç Denetimi ─────────────────────────

function TreeAuditTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof catalogApi.treeAudit>> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    catalogApi.treeAudit().then(setData).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Yükleniyor…</div>
  if (!data) return null

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={16} className="text-amber-500" />
          <span className="text-sm font-semibold text-gray-800">Dublike dallar ({data.duplicate_branches.length})</span>
          <span className="text-[11px] text-gray-400">— aynı adlı kategori birden çok yolda yaşıyor; birleştirme kararı size ait</span>
        </div>
        <div className="space-y-2">
          {data.duplicate_branches.map(d => (
            <div key={d.name} className="text-[12px]">
              <span className="font-semibold text-gray-700 capitalize">{d.name}</span> <span className="text-gray-400">×{d.count}</span>
              <ul className="ml-4 mt-0.5 space-y-0.5">
                {d.branches.map(b => (
                  <li key={b.id} className="text-gray-500">
                    {b.path} <span className="text-gray-300">· {num(b.products)} ürün · id {b.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-800">Boş yaprak kategoriler ({data.empty_leaves.length})</span>
        </div>
        <ul className="space-y-0.5 text-[12px] text-gray-500">
          {data.empty_leaves.map(e => <li key={e.id}>{e.path} <span className="text-gray-300">· id {e.id}</span></li>)}
        </ul>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <PackageSearch size={16} className="text-rose-500" />
          <span className="text-sm font-semibold text-gray-800">Navigasyonda görünmeyen ürünler (ilk {data.orphans.length})</span>
          <span className="text-[11px] text-gray-400">— hiçbir aktif kategoriye atanmamış; Denetçi bunları sırayla çözer</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {data.orphans.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-[12px] text-gray-600">
              <Thumb src={o.image} alt={o.name} />
              <div className="min-w-0">
                <div className="truncate">{o.name}</div>
                <div className="text-[10.5px] text-gray-400">#{o.id} · {o.category || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Akıllı Sıralama ─────────────────────────

const HISTORY_ACTION_LABEL: Record<string, string> = {
  reset: 'varsayılana döndü', ab_start: 'A/B testi başlattı (varyant B)', ab_stop: 'A/B testini durdurdu',
  pins_save: 'manuel ilk sıraları değiştirdi',
  discovery_save: 'keşif slotunu değiştirdi', discovery_reset: 'keşif slotunu varsayılana döndürdü',
}

function fmtDiscovery(d?: DiscoverySettings) {
  if (!d) return ''
  const base = `≤${d.max_age_days} gün${d.require_no_sales ? ' · yalnız satmamışlar' : ''}`
  if (d.mode === 'slot') return `her ${d.interval}. sıra · ${base}`
  return `yenilik bonusu +${Math.round((d.bonus_max ?? 0) * 100)} puan · ilk ${d.guarantee_within}'de 1 garanti · ${base}`
}

function fmtWeights(w: Record<string, number>) {
  return SIGNAL_KEYS.map(k => `${WEIGHT_LABELS[k].label} %${Math.round((w[k] ?? 0) * 100)}`).join(' · ')
}

function RankingTab() {
  const [cats, setCats] = useState<RankingCategory[]>([])
  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<number | ''>('')
  const [preview, setPreview] = useState<RankingPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [wInfo, setWInfo] = useState<RankingWeights | null>(null)
  const [sliders, setSliders] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  // Keşif slotu (yeni ürün vitrini)
  const [disc, setDisc] = useState<RankingDiscovery | null>(null)
  const [dForm, setDForm] = useState<DiscoverySettings | null>(null)
  const [dEditing, setDEditing] = useState(false)
  const [dSaving, setDSaving] = useState(false)
  const [dFlash, setDFlash] = useState<string | null>(null)
  // A/B
  const [pins, setPins] = useState<RankingPins | null>(null)
  const [pinText, setPinText] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinFlash, setPinFlash] = useState<string | null>(null)

  const [abSetup, setAbSetup] = useState(false)
  const [abSliders, setAbSliders] = useState<Record<string, number>>({})
  const [abPeriod, setAbPeriod] = useState(7)
  const [abBusy, setAbBusy] = useState(false)
  const [abResults, setAbResults] = useState<AbResults | null>(null)
  const [abError, setAbError] = useState<string | null>(null)

  const toSliders = (w: Record<string, number>) =>
    Object.fromEntries(SIGNAL_KEYS.map(k => [k, Math.round((w[k] ?? 0) * 100)]))

  useEffect(() => {
    catalogApi.rankingCategories().then(r => { setCats(r.categories); setEnabled(r.enabled) })
    catalogApi.rankingWeights().then(r => {
      setWInfo(r); setSliders(toSliders(r.effective))
      if (r.ab?.enabled) catalogApi.abResults().then(setAbResults).catch(() => {})
    })
    catalogApi.rankingDiscovery().then(r => { setDisc(r); setDForm(r.effective) })
    catalogApi.rankingPins().then(setPins).catch(() => {})
  }, [])

  // Kategori değişince o kategorinin manuel ilk sıralarını getir
  useEffect(() => {
    setPinFlash(null)
    if (!selected) { setPinText(''); return }
    catalogApi.rankingPins(Number(selected)).then(r => { setPins(r); setPinText((r.codes ?? []).join('\n')) }).catch(() => {})
  }, [selected])

  const pinCodes = useMemo(
    () => Array.from(new Set(pinText.split(/[\s,;]+/).map(c => c.trim().toLocaleUpperCase('en-US')).filter(Boolean))),
    [pinText],
  )
  const pinDirty = !!selected && pins?.category_id === selected && pinCodes.join('|') !== (pins.codes ?? []).join('|')

  const savePins = async (apply: boolean) => {
    if (!selected) return
    setPinBusy(true); setPinFlash(null)
    try {
      const r = await catalogApi.saveRankingPins(Number(selected), pinCodes, apply)
      setPins(r); setPinText((r.codes ?? []).join('\n'))
      setPinFlash(r.apply_queued
        ? 'Kaydedildi — sıralama birkaç dakika içinde siteye yazılıyor.'
        : 'Kaydedildi — bir sonraki otomatik sıralamada (04:30 / 13:30) siteye yansır.')
      setPreview(await catalogApi.rankingPreview(Number(selected), 100))
    } catch {
      setPinFlash('Kaydedilemedi, tekrar deneyin.')
    } finally { setPinBusy(false) }
  }

  // Düzenlerken aday sayısını sunucudan canlı tahmin et (yazma yok, debounce'lu).
  useEffect(() => {
    if (!dEditing || !dForm) return
    const t = setTimeout(() => {
      catalogApi.rankingDiscovery(dForm)
        .then(r => setDisc(prev => prev ? { ...prev, candidates: r.candidates, probe: r.probe } : r))
        .catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [dEditing, dForm])

  const ab = wInfo?.ab?.enabled ? wInfo.ab : null

  const sliderTotal = useMemo(() => SIGNAL_KEYS.reduce((a, k) => a + (sliders[k] ?? 0), 0), [sliders])
  // Canlı normalize edilmiş pay (%) — kaydedilecek gerçek değerler
  const normPct = useMemo(() => {
    const t = sliderTotal || 1
    return Object.fromEntries(SIGNAL_KEYS.map(k => [k, ((sliders[k] ?? 0) / t) * 100])) as Record<string, number>
  }, [sliders, sliderTotal])

  const dirty = useMemo(() => {
    if (!wInfo) return false
    const eff = toSliders(wInfo.effective)
    return SIGNAL_KEYS.some(k => (sliders[k] ?? 0) !== eff[k])
  }, [sliders, wInfo])

  const warnings = useMemo(() => {
    if (!editing) return []
    const w: string[] = []
    const dom = SIGNAL_KEYS.find(k => normPct[k] > 60)
    if (dom) w.push(`${WEIGHT_LABELS[dom].label} %${Math.round(normPct[dom])} ile aşırı baskın — diğer sinyaller etkisizleşir, vitrin tekdüzeleşebilir.`)
    if (normPct.freshness + normPct.stock < 5) w.push('Yenilik + Stok toplamı %5\'in altında — yeni ürünler ve derin stok gömülebilir.')
    if (sliderTotal === 0) w.push('Tüm ağırlıklar 0 — en az bir sinyale değer verin.')
    return w
  }, [editing, normPct, sliderTotal])

  const dDirty = useMemo(() => {
    if (!disc || !dForm) return false
    return dForm.mode !== disc.effective.mode
      || dForm.interval !== disc.effective.interval
      || dForm.max_age_days !== disc.effective.max_age_days
      || dForm.require_no_sales !== disc.effective.require_no_sales
      || dForm.bonus_max !== disc.effective.bonus_max
      || dForm.guarantee_within !== disc.effective.guarantee_within
      || dForm.guarantee_position !== disc.effective.guarantee_position
  }, [disc, dForm])

  const compute = async () => {
    if (!selected) return
    setLoading(true); setPreview(null)
    try {
      setPreview(await catalogApi.rankingPreview(
        Number(selected), 100,
        editing && dirty ? sliders : undefined,
        dEditing && dDirty && dForm ? dForm : undefined,
        pinDirty ? pinCodes : undefined,
      ))
    } finally { setLoading(false) }
  }

  const saveDiscovery = async (reset = false) => {
    setDSaving(true)
    try {
      const r = await catalogApi.saveRankingDiscovery(reset ? null : dForm)
      setDisc(r); setDForm(r.effective); setDEditing(false)
      setDFlash(reset
        ? 'Keşif slotu varsayılana döndü.'
        : r.effective.mode === 'slot'
          ? `Kaydedildi — bu gece 04:30 cron'undan itibaren tüm kategorilerde her ${r.effective.interval}. sıra yeni ürüne ayrılır.`
          : `Kaydedildi — bu gece 04:30 cron'undan itibaren yeni ürünler yenilik bonusuyla doğal karışır (ilk ${r.effective.guarantee_within} sırada 1 garanti).`)
      setTimeout(() => setDFlash(null), 7000)
      const w = await catalogApi.rankingWeights().catch(() => null)
      if (w) setWInfo(w)
    } finally { setDSaving(false) }
  }

  const cancelEdit = () => {
    if (wInfo) setSliders(toSliders(wInfo.effective))
    setEditing(false)
  }

  const save = async (reset = false) => {
    if (!reset && sliderTotal === 0) return
    setSaving(true)
    try {
      const r = await catalogApi.saveRankingWeights(reset ? null : sliders)
      setWInfo(r); setSliders(toSliders(r.effective)); setEditing(false)
      setFlash(reset ? 'Varsayılan ağırlıklara dönüldü.' : 'Ağırlıklar kaydedildi — bu gece cron\'dan itibaren tüm kategoriler bu ağırlıklarla sıralanır.')
      setTimeout(() => setFlash(null), 6000)
    } finally { setSaving(false) }
  }

  const abStart = async () => {
    setAbBusy(true); setAbError(null)
    try {
      await catalogApi.abStart(abSliders, abPeriod)
      const r = await catalogApi.rankingWeights()
      setWInfo(r); setSliders(toSliders(r.effective)); setAbSetup(false)
      setAbResults(await catalogApi.abResults().catch(() => null))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setAbError(err.response?.data?.message ?? 'Test başlatılamadı')
    } finally { setAbBusy(false) }
  }

  const abStop = async () => {
    if (!window.confirm('A/B testi durdurulsun mu? Ağırlıklar teste girmeden önceki haline döner.')) return
    setAbBusy(true)
    try {
      await catalogApi.abStop()
      const r = await catalogApi.rankingWeights()
      setWInfo(r); setSliders(toSliders(r.effective)); setAbResults(null)
    } finally { setAbBusy(false) }
  }

  const abSliderTotal = SIGNAL_KEYS.reduce((a, k) => a + (abSliders[k] ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            Skor formülü (ağırlıklar)
            {ab && <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-50 text-violet-600 rounded px-1.5 py-0.5">A/B testi sürüyor — varyant {ab.active_variant}</span>}
            {!ab && wInfo?.override && <span className="text-[10px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">özel ayar aktif</span>}
            {editing && dirty && <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">kaydedilmedi</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowHistory(v => !v)} title="Değişiklik geçmişi"
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1">
              <History size={13} /> Geçmiş
            </button>
            {!editing ? (
              <button onClick={() => setEditing(true)} disabled={!!ab}
                title={ab ? 'A/B testi sürerken ağırlık düzenlenemez — önce testi durdurun' : undefined}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1">
                <Pencil size={13} /> Düzenle
              </button>
            ) : (
              <>
                <button onClick={cancelEdit} disabled={saving}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50">
                  İptal
                </button>
                {wInfo?.override && (
                  <button onClick={() => save(true)} disabled={saving}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 flex items-center gap-1">
                    <RotateCcw size={13} /> Varsayılana Dön
                  </button>
                )}
                <button onClick={() => save(false)} disabled={!dirty || saving || sliderTotal === 0}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1">
                  <Save size={13} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {SIGNAL_KEYS.map(k => (
            <div key={k} className="border border-gray-100 rounded-lg p-2" title={WEIGHT_LABELS[k].desc}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-gray-700">{WEIGHT_LABELS[k].label}</span>
                <span className="text-[12px] font-bold text-indigo-600">%{Math.round(normPct[k])}</span>
              </div>
              {editing ? (
                <input type="range" min={0} max={100} step={1} value={sliders[k] ?? 0}
                  onChange={e => setSliders(s => ({ ...s, [k]: Number(e.target.value) }))}
                  className="w-full mt-1 accent-indigo-600" />
              ) : (
                <div className="h-1.5 mt-2 mb-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, normPct[k])}%` }} />
                </div>
              )}
              <div className="text-[10.5px] text-gray-400 leading-snug">{WEIGHT_LABELS[k].desc}</div>
            </div>
          ))}
        </div>
        {warnings.map((w, i) => (
          <div key={i} className="mt-2 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
          </div>
        ))}
        {flash && <div className="mt-2 text-[11.5px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">{flash}</div>}
        <div className="mt-2 text-[11.5px] text-gray-500 leading-relaxed">
          {editing
            ? <>Kaydırıcılarla stratejinizi belirleyin — paylar otomatik %100'e oranlanır. <b>Kaydet</b>'e basana kadar canlıya hiçbir şey yansımaz; kaydetmeden <b>Denemeyi Önizle</b> ile sonucu görebilirsiniz.</>
            : <>Sıralama bu ağırlıklarla hesaplanır. Değiştirmek için <b>Düzenle</b>'ye basın.</>}
          {' '}Tüm sinyaller <b>kategori havuzu içinde</b> normalize edilir. Skora ek: <b>beden-kırığı cezası</b>, <b>stoksuz ürün ×0.3</b>, <b>beden katmanı</b> (kategorinin cinsiyet aralığında çekirdek bedeni tam olanlar önce), <b>sezon</b> (kışın sandalet/terlik/keten, yazın bot/kar botu/mont stoklu sezonluk ürünlerin arkasına iner; yalnız karışık üst kategorilerde etkili), {disc?.effective.mode === 'slot' ? <>her {disc.effective.interval}. sıraya <b>🆕 keşif slotu</b></> : <><b>🆕 yenilik bonusu</b> (yeni ürün doğal karışır)</>} (aşağıdaki kart).
          {!enabled && <span className="text-amber-600"> Canlı yazım kill-switch'i şu an KAPALI.</span>}
        </div>
        {showHistory && (
          <div className="mt-2 border-t border-gray-100 pt-2 space-y-1 max-h-44 overflow-y-auto">
            {(wInfo?.history?.length ?? 0) === 0 && <div className="text-[11.5px] text-gray-400">Henüz değişiklik yapılmamış.</div>}
            {wInfo?.history?.map((h, i) => (
              <div key={i} className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2">
                <span className="text-gray-400">{new Date(h.at).toLocaleString('tr-TR')}</span>
                <span className="font-medium text-gray-600">{h.by}</span>
                <span className={h.action === 'save' ? 'text-indigo-600' : h.action.startsWith('discovery') ? 'text-emerald-600' : 'text-gray-500'}>
                  {HISTORY_ACTION_LABEL[h.action] ?? ''}
                  {h.action === 'save' || h.action === 'ab_start' ? ` — ${fmtWeights(h.weights)}` : ''}
                  {h.action.startsWith('discovery') ? ` — ${fmtDiscovery(h.discovery)}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Keşif Slotu (yeni ürün vitrini) ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Rocket size={15} className="text-emerald-600" /> Keşif slotu — yeni ürün vitrini
            {disc?.override && <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-600 rounded px-1.5 py-0.5">özel ayar aktif</span>}
            {dEditing && dDirty && <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">kaydedilmedi</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {!dEditing ? (
              <button onClick={() => setDEditing(true)} disabled={!disc}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                <Pencil size={13} /> Düzenle
              </button>
            ) : (
              <>
                <button onClick={() => { if (disc) setDForm(disc.effective); setDEditing(false) }} disabled={dSaving}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50">
                  İptal
                </button>
                {disc?.override && (
                  <button onClick={() => saveDiscovery(true)} disabled={dSaving}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 flex items-center gap-1">
                    <RotateCcw size={13} /> Varsayılana Dön
                  </button>
                )}
                <button onClick={() => saveDiscovery(false)} disabled={!dDirty || dSaving}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                  <Save size={13} /> {dSaving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </>
            )}
          </div>
        </div>

        {!disc || !dForm ? (
          <div className="text-[12px] text-gray-400 py-2">Yükleniyor…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="border border-gray-100 rounded-lg p-2.5">
                <div className="text-[12px] font-medium text-gray-700">Yöntem</div>
                {dEditing ? (
                  <select value={dForm.mode}
                    onChange={e => setDForm(f => f ? { ...f, mode: e.target.value as DiscoverySettings['mode'] } : f)}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200">
                    <option value="bonus">Doğal karışım (yenilik bonusu)</option>
                    <option value="slot">Sabit slot (her N. sıra)</option>
                  </select>
                ) : (
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">{dForm.mode === 'slot' ? 'sabit slot' : 'doğal karışım'}</div>
                )}
                <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                  {dForm.mode === 'slot'
                    ? 'Her N. sıra mekanik olarak yeni ürüne ayrılır.'
                    : 'Yeni ürün skoruna yaşıyla eriyen bonus eklenir; hak ettiği yere yerleşir, katı desen olmaz.'}
                </div>
              </div>

              {dForm.mode === 'slot' ? (
                <div className="border border-gray-100 rounded-lg p-2.5">
                  <div className="text-[12px] font-medium text-gray-700">Slot aralığı</div>
                  {dEditing ? (
                    <input type="number" min={disc.limits.interval[0]} max={disc.limits.interval[1]} step={1}
                      value={dForm.interval}
                      onChange={e => setDForm(f => f ? { ...f, interval: Number(e.target.value) } : f)}
                      className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                  ) : (
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">her {dForm.interval}. sıra</div>
                  )}
                  <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                    Yeni ürüne ayrılan sıralar: <b className="text-gray-600">
                      {[1, 2, 3, 4, 5].map(i => i * (dForm.interval || 4)).join(' · ')} …
                    </b>
                  </div>
                </div>
              ) : (
                <div className="border border-gray-100 rounded-lg p-2.5">
                  <div className="text-[12px] font-medium text-gray-700">Yenilik bonusu (ilk gün)</div>
                  {dEditing ? (
                    <input type="number" min={0} max={30} step={1}
                      value={Math.round((dForm.bonus_max ?? 0) * 100)}
                      onChange={e => setDForm(f => f ? { ...f, bonus_max: Math.max(0, Math.min(30, Number(e.target.value))) / 100 } : f)}
                      className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                  ) : (
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">+{Math.round((dForm.bonus_max ?? 0) * 100)} puan</div>
                  )}
                  <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                    Skor 0–100 ölçeğinde; {dForm.max_age_days}. günde sıfıra iner. Yalnız <b className="text-gray-600">çekirdek bedeni tam</b> yeni ürünlere işler. Öneri 6–10.
                  </div>
                </div>
              )}

              {dForm.mode === 'bonus' && (
                <div className="border border-gray-100 rounded-lg p-2.5">
                  <div className="text-[12px] font-medium text-gray-700">İlk sayfa garantisi</div>
                  {dEditing ? (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[11px] text-gray-500">ilk</span>
                      <input type="number" min={0} max={50} step={1} value={dForm.guarantee_within}
                        onChange={e => setDForm(f => f ? { ...f, guarantee_within: Number(e.target.value) } : f)}
                        className="w-14 text-sm border border-gray-200 rounded-lg px-1.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                      <span className="text-[11px] text-gray-500">sırada yoksa →</span>
                      <input type="number" min={1} max={50} step={1} value={dForm.guarantee_position}
                        onChange={e => setDForm(f => f ? { ...f, guarantee_position: Number(e.target.value) } : f)}
                        className="w-14 text-sm border border-gray-200 rounded-lg px-1.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                      <span className="text-[11px] text-gray-500">.</span>
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">
                      {dForm.guarantee_within > 0 ? `ilk ${dForm.guarantee_within}'de 1 (→ ${dForm.guarantee_position}.)` : 'kapalı'}
                    </div>
                  )}
                  <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                    İlk sıralarda hiç yeni ürün yoksa en iyi çekirdek-bedenli yeni ürün o sıraya terfi eder. 0 = garanti yok.
                  </div>
                </div>
              )}

              <div className="border border-gray-100 rounded-lg p-2.5">
                <div className="text-[12px] font-medium text-gray-700">Yeni ürün yaş penceresi</div>
                {dEditing ? (
                  <input type="number" min={disc.limits.max_age_days[0]} max={disc.limits.max_age_days[1]} step={5}
                    value={dForm.max_age_days}
                    onChange={e => setDForm(f => f ? { ...f, max_age_days: Number(e.target.value) } : f)}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                ) : (
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">{dForm.max_age_days} gün</div>
                )}
                <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                  Ürünün mağazaya eklenme tarihi bu kadar gün içindeyse “yeni” sayılır.
                </div>
              </div>

              <div className="border border-gray-100 rounded-lg p-2.5">
                <div className="text-[12px] font-medium text-gray-700">Satış şartı</div>
                {dEditing ? (
                  <label className="flex items-start gap-2 mt-1.5 cursor-pointer">
                    <input type="checkbox" checked={dForm.require_no_sales}
                      onChange={e => setDForm(f => f ? { ...f, require_no_sales: e.target.checked } : f)}
                      className="mt-0.5 accent-emerald-600" />
                    <span className="text-[11.5px] text-gray-600 leading-snug">Yalnız <b>hiç satmamış</b> ürünler slota girsin</span>
                  </label>
                ) : (
                  <div className={`text-lg font-bold mt-0.5 ${dForm.require_no_sales ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {dForm.require_no_sales ? 'yalnız satmamışlar' : 'satsa da girer'}
                  </div>
                )}
                <div className="text-[10.5px] text-gray-400 leading-snug mt-1">
                  Kapalıyken ürün satış yapmaya başlasa da yaş penceresi bitene kadar slotta kalır.
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { l: 'Yaş penceresindeki ürün', v: disc.candidates.young },
                { l: 'Stoklu', v: disc.candidates.stocked },
                { l: 'Slota uygun (aday)', v: disc.candidates.eligible, hi: true },
                { l: 'Kapsanan sıra (üst sınır)', v: disc.candidates.coverage_depth },
              ].map(x => (
                <div key={x.l} className={`rounded-lg px-2.5 py-2 border ${x.hi ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
                  <div className={`text-base font-bold ${x.hi ? 'text-emerald-700' : 'text-gray-700'}`}>{num(x.v)}</div>
                  <div className="text-[10.5px] text-gray-500 leading-snug">{x.l}</div>
                </div>
              ))}
            </div>

            {dEditing && dForm.mode === 'bonus' && dForm.bonus_max > 0.12 && (
              <div className="mt-2 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                +{Math.round(dForm.bonus_max * 100)} puan yüksek — ilk 6 ile 12. sıra arasındaki skor farkı ~6–9 puan; taze ürünler çok satanların önüne geçer.
              </div>
            )}
            {dEditing && dForm.mode === 'slot' && dForm.interval <= 3 && (
              <div className="mt-2 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Aralık {dForm.interval} — listenin yaklaşık {Math.round(100 / dForm.interval)}%’i keşif slotu olur; çok satanlar belirgin şekilde geri gider.
              </div>
            )}
            {dEditing && dForm.max_age_days >= 240 && (
              <div className="mt-2 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {dForm.max_age_days} günlük pencere geniş — “yeni ürün” tanımı büyük ölçüde “eski ama satmayan ürün”e dönüşebilir.
              </div>
            )}
            {dFlash && <div className="mt-2 text-[11.5px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">{dFlash}</div>}

            <div className="mt-2 text-[11.5px] text-gray-500 leading-relaxed">
              Ayar <b>tüm ana ve alt kategorilerde</b> geçerlidir (kampanya kategorileri hariç). {dForm.mode === 'slot' ? (<>
                Her kategori kendi havuzu içinde her <b>{dForm.interval}.</b> sıraya en iyi skorlu yeni ürünü çeker. Slot <b>yalnız terfi ettirir</b>: doğal sırası
                {' '}zaten yukarıda olan yeni ürün aşağı itilmez.</>) : (<>
                Yeni ürün (yaş penceresinde, stoklu, <b>kategorinin cinsiyet aralığında çekirdek bedeni tam</b>) skoruna eklenme gününden itibaren
                {' '}<b>eriyen bir bonus</b> alır; satış geldikçe bonusun yerini gerçek performans alır. Bedeni zayıf yeni ürün bonusla öne çıkamaz;
                {' '}beden katmanı her zaman bonusun üstündedir.</>)}
              {' '}Aday sayısı kategoriye bölündüğü için gerçek kapsama derinliği yukarıdaki üst sınırdan düşüktür. Değişiklik <b>bu gece 04:30</b> yazımında vitrine yansır.
            </div>
          </>
        )}
      </div>

      {/* ── A/B Testi (zaman dönüşümlü) ── */}
      <div className={`border rounded-xl p-4 ${ab ? 'bg-violet-50/40 border-violet-200' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <FlaskConical size={15} className="text-violet-600" /> A/B Testi
            {ab && <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-600 text-white rounded px-1.5 py-0.5">sürüyor</span>}
          </div>
          {ab ? (
            <button onClick={abStop} disabled={abBusy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              {abBusy ? '…' : 'Testi Durdur'}
            </button>
          ) : !abSetup ? (
            <button onClick={() => { setAbSliders(toSliders(wInfo?.effective ?? {})); setAbSetup(true); setAbError(null) }}
              disabled={!wInfo || editing}
              title={editing ? 'Önce ağırlık düzenlemeyi bitirin' : undefined}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
              Test Kur
            </button>
          ) : null}
        </div>

        {!ab && !abSetup && (
          <div className="text-[11.5px] text-gray-500 leading-relaxed">
            İki ağırlık setini dönüşümlü olarak canlıda dener: <b>Varyant A</b> = mevcut ağırlıklarınız, <b>Varyant B</b> = sizin belirleyeceğiniz
            deneme seti. Seçtiğiniz dönem uzunluğunda (örn. 7 gün) otomatik dönüşür, her dönemin sipariş/ciro sonuçları burada karşılaştırılır.
          </div>
        )}

        {!ab && abSetup && (
          <div className="space-y-2">
            <div className="text-[11.5px] text-gray-500">
              <b>Varyant A (mevcut):</b> {wInfo ? fmtWeights(wInfo.effective) : '—'}
            </div>
            <div className="text-[12px] font-semibold text-gray-700 mt-1">Varyant B ağırlıkları:</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SIGNAL_KEYS.map(k => (
                <div key={k} className="border border-gray-100 rounded-lg p-2 bg-white">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-gray-700">{WEIGHT_LABELS[k].label}</span>
                    <span className="text-[12px] font-bold text-violet-600">%{Math.round(((abSliders[k] ?? 0) / (abSliderTotal || 1)) * 100)}</span>
                  </div>
                  <input type="range" min={0} max={100} step={1} value={abSliders[k] ?? 0}
                    onChange={e => setAbSliders(s => ({ ...s, [k]: Number(e.target.value) }))}
                    className="w-full mt-1 accent-violet-600" />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="text-[12px] text-gray-600">Dönem:</label>
              <select value={abPeriod} onChange={e => setAbPeriod(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                <option value={3}>3 gün</option>
                <option value={7}>7 gün (önerilen)</option>
                <option value={14}>14 gün</option>
              </select>
              <button onClick={abStart} disabled={abBusy || abSliderTotal === 0}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                {abBusy ? 'Başlatılıyor…' : 'Testi Başlat'}
              </button>
              <button onClick={() => setAbSetup(false)} disabled={abBusy}
                className="text-xs font-semibold text-gray-600 px-2.5 py-1.5 rounded-lg border border-gray-200">
                Vazgeç
              </button>
              {abError && <span className="text-[11.5px] text-red-600">{abError}</span>}
            </div>
            <div className="text-[11px] text-gray-400">
              Test sırasında ağırlıklar elle değiştirilemez. Varyant geçişleri gece yazımıyla vitrine yansır; kampanya dönemlerine denk getirmemeye çalışın.
            </div>
          </div>
        )}

        {ab && (
          <div className="space-y-2">
            <div className="text-[11.5px] text-gray-600 leading-relaxed">
              <div><b>Şu an vitrinde:</b> Varyant {ab.active_variant} · sonraki geçiş {new Date(ab.next_switch_at).toLocaleDateString('tr-TR')} ({ab.period_days} günlük dönemler, başlangıç {new Date(ab.started_at).toLocaleDateString('tr-TR')})</div>
              <div className="mt-0.5"><span className="font-semibold text-gray-700">A:</span> {fmtWeights(ab.variant_a)}</div>
              <div><span className="font-semibold text-violet-700">B:</span> {fmtWeights(ab.variant_b)}</div>
            </div>
            {abResults && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] min-w-[560px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-violet-100">
                      <th className="py-1.5 pr-2">Dönem</th>
                      <th className="py-1.5 pr-2">Varyant</th>
                      <th className="py-1.5 pr-2 text-right">Sipariş</th>
                      <th className="py-1.5 pr-2 text-right">Ciro</th>
                      <th className="py-1.5 text-right">Ort. Sepet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abResults.windows.map((w, i) => (
                      <tr key={i} className="border-b border-violet-50">
                        <td className="py-1 pr-2 text-gray-600">{new Date(w.from).toLocaleDateString('tr-TR')} – {new Date(w.to).toLocaleDateString('tr-TR')}{w.running && <span className="ml-1 text-[10px] text-violet-600 font-semibold">sürüyor</span>}</td>
                        <td className="py-1 pr-2 font-bold text-gray-700">{w.variant}</td>
                        <td className="py-1 pr-2 text-right">{num(w.orders)}</td>
                        <td className="py-1 pr-2 text-right">{num(Math.round(w.revenue))} ₺</td>
                        <td className="py-1 text-right">{w.aov != null ? `${num(Math.round(w.aov))} ₺` : '—'}</td>
                      </tr>
                    ))}
                    {(['A', 'B'] as const).map(v => abResults.totals[v].windows > 0 && (
                      <tr key={v} className="font-semibold text-gray-800 bg-violet-50/60">
                        <td className="py-1 pr-2">Toplam ({abResults.totals[v].windows} tam dönem)</td>
                        <td className="py-1 pr-2">{v}</td>
                        <td className="py-1 pr-2 text-right">{num(abResults.totals[v].orders)}</td>
                        <td className="py-1 pr-2 text-right">{num(Math.round(abResults.totals[v].revenue))} ₺</td>
                        <td className="py-1 text-right">{abResults.totals[v].aov != null ? `${num(Math.round(abResults.totals[v].aov!))} ₺` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[10.5px] text-gray-400 mt-1">{abResults.note}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={selected} onChange={e => setSelected(e.target.value ? Number(e.target.value) : '')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white min-w-[280px]">
          <option value="">Kategori seç…</option>
          {cats.map(c => <option key={c.id} value={c.id}>{pins?.counts?.[c.id] ? '📌 ' : ''}{c.path} ({num(c.product_count)})</option>)}
        </select>
        <button onClick={compute} disabled={!selected || loading}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
          <ListOrdered size={15} /> {loading ? 'Hesaplanıyor…' : (editing && dirty) || (dEditing && dDirty) || pinDirty ? 'Denemeyi Önizle' : 'Sıralamayı Hesapla'}
        </button>
        {preview && (
          <span className="text-xs text-gray-400">
            {preview.category.path} — havuz {num(preview.category.pool)} ürün, ilk {preview.items.length} gösteriliyor
            {preview.simulated && <span className="ml-1 text-amber-600 font-semibold">(kaydedilmemiş deneme ayarlarıyla)</span>}
            {preview.discovery && <span className="ml-1 text-emerald-600">🆕 {fmtDiscovery(preview.discovery)}</span>}
            {preview.season?.enabled && <span className="ml-1 text-sky-600">{preview.season.active === 'winter' ? '❄️ Kış sezonu: yazlık ürünler (sandalet/terlik/keten) arkada' : preview.season.active === 'summer' ? '☀️ Yaz sezonu: kışlık ürünler (bot/kar botu/mont) arkada' : 'Geçiş dönemi: sezon kuralı pasif'}</span>}
          </span>
        )}
      </div>

      {/* ── Manuel ilk sıralar (stok koduyla sabitleme) ── */}
      {selected !== '' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Pin size={15} className="text-amber-600" /> Manuel ilk sıralar
              {(pins?.codes?.length ?? 0) > 0 && pins?.category_id === selected && <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">{pins.codes!.length} kod sabit</span>}
              {pinDirty && <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">kaydedilmedi</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => savePins(false)} disabled={!pinDirty || pinBusy}
                className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 flex items-center gap-1">
                <Save size={13} /> Kaydet
              </button>
              <button onClick={() => savePins(true)} disabled={pinBusy || !enabled || (!pinDirty && !(pins?.codes?.length))}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 flex items-center gap-1">
                <Rocket size={13} /> {pinBusy ? 'Kaydediliyor…' : 'Kaydet ve şimdi uygula'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <textarea value={pinText} onChange={e => setPinText(e.target.value)} rows={8} spellCheck={false}
                placeholder={'Her satıra bir stok kodu — yazdığınız sıra vitrindeki sıradır\nTBMHH005\nTBA9060\n…'}
                className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-200" />
              <div className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                Her kodun bu kategorideki stoklu renkleri içinden <b>en çok satanı</b> o sıraya konur; kalan sıralar akıllı
                sıralamayla devam eder, sabitlenen ürün ikinci kez listelenmez. Belirli bir renk için <span className="font-mono">KOD|RENK</span> yazılabilir.
                Listeyi boşaltıp kaydetmek sabitlemeyi kaldırır.
              </div>
              {pinFlash && <div className="text-[12px] text-emerald-600 font-medium mt-1">{pinFlash}</div>}
            </div>
            <div className="text-[12px]">
              {pins?.category_id === selected && (pins.resolved?.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {pins.resolved!.map(r => (
                    <div key={r.code} className="flex items-start gap-2">
                      <span className={`w-5 text-right font-bold ${r.status === 'ok' ? 'text-gray-700' : 'text-rose-400'}`}>{r.status === 'ok' ? r.position : '—'}</span>
                      <span className="font-mono text-gray-700 shrink-0">{r.code}</span>
                      {r.status === 'ok' ? (
                        <span className="text-gray-500 min-w-0 truncate" title={r.name}>
                          {r.name} · {num(r.q90 ?? 0)} satış · {num(r.stock_qty ?? 0)} stok
                          {(r.missing_sizes ?? 0) > 0 && <span className="text-amber-600 font-medium"> · {r.missing_sizes} beden eksik</span>}
                        </span>
                      ) : (
                        <span className="text-rose-500 font-medium">
                          {r.status === 'out_of_stock' ? 'tüm renkleri stoksuz — atlandı' : 'bu kategoride bulunamadı — atlandı'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400 py-2">Bu kategoride manuel sabitlenmiş ürün yok — sıralama tamamen otomatik.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-[12px] min-w-[980px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-2 py-2">Ürün</th>
                <th className="px-2 py-2 w-16 text-right">Skor</th>
                {SIGNAL_KEYS.map(k => <th key={k} className="px-2 py-2 w-[72px]" title={WEIGHT_LABELS[k].desc}>{WEIGHT_LABELS[k].label}</th>)}
                <th className="px-2 py-2 w-20 text-right">Satış 90g</th>
                <th className="px-2 py-2 w-16 text-right">Stok</th>
                <th className="px-2 py-2 w-20 text-right">Beden kaps.</th>
                <th className="px-2 py-2 w-20 text-right">Eski sıra</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map(it => (
                <tr key={it.product_id} className={`border-b border-gray-50 ${it.pinned ? 'bg-amber-50/60' : it.discovery ? 'bg-violet-50/50' : ''}`}>
                  <td className="px-3 py-1.5 font-bold text-gray-700">{it.rank}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-[220px]">
                      <Thumb src={it.image} alt={it.name} />
                      <div className="min-w-0">
                        <div className="truncate max-w-[260px] text-gray-800">{it.name}</div>
                        <div className="flex items-center gap-1.5">
                          {it.pinned && <span className="text-[10px] font-semibold text-amber-700">📌 manuel</span>}
                          {it.discovery && <span className="text-[10px] font-semibold text-violet-600">🆕 keşif slotu</span>}
                          {it.is_new && !it.discovery && <span className="text-[10px] font-semibold text-violet-400">yeni ürün</span>}
                          {it.off_season && <span className="text-[10px] font-semibold text-sky-600">{it.season === 'summer' ? '☀️' : '❄️'} sezon dışı</span>}
                          {it.signals.stock_qty <= 0 && <span className="text-[10px] font-semibold text-rose-500">stoksuz ×0.3</span>}
                          {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-indigo-500"><ExternalLink size={11} /></a>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-bold text-indigo-700">{it.score.toFixed(3)}</td>
                  {SIGNAL_KEYS.map(k => (
                    <td key={k} className="px-2 py-1.5"><SignalBar value={it.signals[k]} title={WEIGHT_LABELS[k].label} /></td>
                  ))}
                  <td className="px-2 py-1.5 text-right text-gray-600">{num(it.signals.q90)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600">{num(it.signals.stock_qty)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${it.signals.size_coverage < 1 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {pct(it.signals.size_coverage)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-400">
                    {it.old_position ? (
                      <span title={`Ticimax Sira: ${it.old_sira}`}>
                        {it.old_position}
                        {it.old_position !== it.rank && (
                          <span className={it.old_position > it.rank ? 'text-emerald-500' : 'text-rose-400'}>
                            {' '}{it.old_position > it.rank ? '↑' : '↓'}{Math.abs(it.old_position - it.rank)}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Ana sayfa ─────────────────────────

export default function CategoryIntelligencePage() {
  const [tab, setTab] = useState<'overview' | 'suggestions' | 'tree' | 'ranking'>('overview')
  const [overview, setOverview] = useState<CatalogOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = useCallback(() => {
    setError(null)
    catalogApi.overview().then(setOverview).catch(() => setError('Veri yüklenemedi — mağaza seçili mi?'))
  }, [])

  useEffect(() => { loadOverview() }, [loadOverview])

  const tabs = [
    { key: 'overview' as const, label: 'Genel Bakış', icon: <Boxes size={14} /> },
    { key: 'suggestions' as const, label: 'Kategori Önerileri', icon: <Sparkles size={14} /> },
    { key: 'tree' as const, label: 'Ağaç Denetimi', icon: <GitBranch size={14} /> },
    { key: 'ranking' as const, label: 'Akıllı Sıralama', icon: <ListOrdered size={14} /> },
  ]

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
          <FolderTree size={20} className="text-indigo-600" /> Kategori Zekası
        </h1>
        <p className="text-[13px] text-gray-500 mt-1">
          Otomatik kategori denetimi (Kategori Denetçisi) ve kategori-içi akıllı ürün sıralaması — tüm kararlar sinyalleriyle şeffaf.
        </p>
      </div>

      <div className="flex gap-1.5 mb-5 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-[13px] font-medium px-3.5 py-2 -mb-px border-b-2 flex items-center gap-1.5 ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.icon} {t.label}
            {t.key === 'suggestions' && overview && overview.suggestions.review_pending > 0 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{overview.suggestions.review_pending}</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-3 mb-4">{error}</div>}

      {tab === 'overview' && overview && <OverviewTab data={overview} onRefresh={loadOverview} />}
      {tab === 'overview' && !overview && !error && <div className="text-sm text-gray-400 py-8 text-center">Yükleniyor…</div>}
      {tab === 'suggestions' && <SuggestionsTab />}
      {tab === 'tree' && <TreeAuditTab />}
      {tab === 'ranking' && <RankingTab />}
    </div>
  )
}
