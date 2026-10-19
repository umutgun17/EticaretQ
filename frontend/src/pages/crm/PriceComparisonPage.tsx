import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import type { PaginatedResponse } from '@/types'
import {
  Scale, Search, TrendingDown, TrendingUp, ExternalLink, RefreshCw, Image as ImageIcon,
  PackageX, PackageSearch, Boxes, Ruler, FileText, Tag, Download, AlertTriangle, Settings, Loader2, GitCompare, Globe,
} from 'lucide-react'
import clsx from 'clsx'

type View =
  | 'all' | 'cheaper_on_trendyol' | 'cheaper_on_site' | 'missing_on_site' | 'missing_on_trendyol'
  | 'fewer_images_on_site' | 'fewer_images_on_trendyol' | 'stock_diff' | 'variant_diff' | 'content_diff' | 'campaign'
  | 'match_conflict'

interface MatchedRow {
  id: number
  name: string
  sku: string | null
  barcode: string | null
  brand: string | null
  url: string | null
  site_url: string | null
  images: string[] | string | null
  currency: string | null
  site_price: string | null
  site_stock: number | null
  site_image_count: number
  site_description_length: number
  site_variant_count: number
  site_in_stock_variants: number
  ty_title: string | null
  ty_main_id: string | null
  ty_url: string | null
  ty_price: string | null
  ty_price_source: 'buyer' | 'seller'
  ty_seller_price: string | null
  ty_buyer_price: string | null
  ty_list_price: string | null
  ty_buyer_price_at: string | null
  ty_promotions: unknown
  ty_quantity: number
  ty_variant_count: number
  ty_in_stock_variants: number
  ty_unmatched_variants: number
  ty_stock_verified: number
  ty_conflicts: number
  ty_stock_code: string | null
  ty_image_count: number
  ty_description_length: number
  ty_campaign: boolean
  ty_approved: boolean
  ty_on_sale: boolean
  ty_rating: string | null
  price_diff: string | null
  price_diff_pct: string | null
  image_diff: number
  variant_diff: number
  title_differs: boolean
}

interface MissingOnSiteRow {
  ty_main_id: string
  ty_color: string
  ty_title: string | null
  ty_brand: string | null
  ty_category: string | null
  ty_variant_count: number
  ty_quantity: number
  ty_seller_price: string | null
  ty_list_price: string | null
  ty_image_count: number
  images: string[] | string | null
  ty_url: string | null
  ty_approved: boolean
  ty_on_sale: boolean
  ty_campaign: boolean
  ty_sizes: string | null
  ty_stock_code: string | null
  ty_updated_at: string | null
}

interface MissingOnTrendyolRow {
  id: number
  name: string
  sku: string | null
  barcode: string | null
  brand: string | null
  category: string | null
  url: string | null
  site_url: string | null
  ty_url: string | null
  images: string[] | string | null
  currency: string | null
  site_price: string | null
  site_stock: number | null
  site_image_count: number
  site_variant_count: number
  site_in_stock_variants: number
  site_trendyol_flag: string | null
  platform_created_at: string | null
}

interface MatchConflictRow {
  id: number
  barcode_product_id: number
  ty_variant_count: number
  ty_quantity: number
  ty_title: string | null
  ty_url: string | null
  ty_main_id: string | null
  ty_stock_codes: string | null
  ty_barcodes: string | null
  ty_images: string[] | string | null
  ty_seller_price: string | null
  name: string
  sku: string | null
  images: string[] | string | null
  currency: string | null
  site_url: string | null
  site_price: string | null
  site_stock: number | null
  barcode_name: string
  barcode_sku: string | null
  barcode_images: string[] | string | null
  barcode_site_url: string | null
  barcode_site_price: string | null
  barcode_site_stock: number | null
}

type Row = MatchedRow | MissingOnSiteRow | MissingOnTrendyolRow | MatchConflictRow

interface Stats {
  counts: Record<View, number> & { missing_on_site_total?: number; missing_on_trendyol_total?: number }
  ty_rows: number
  ty_matched_rows: number
  ty_stock_verified_rows: number
  ty_conflict_rows: number
  site_base_url: string | null
  catalog_synced_at: string | null
  catalog_sync_error: string | null
  catalog_sync_running: boolean
  buyer_price_products: number
  buyer_price_at: string | null
  max_gap: number | null
  total_gap: number | null
  avg_gap_pct: number | null
  has_channel: boolean
}

interface Probe { ok: boolean; reason: 'no_channel' | 'no_credentials' | 'no_product_permission' | 'api_error' | null; message?: string | null; total?: number | null }

const VIEW_META: { key: View; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }[] = [
  { key: 'cheaper_on_trendyol', icon: TrendingDown, tone: 'text-red-600 dark:text-red-400' },
  { key: 'missing_on_site', icon: PackageSearch, tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'missing_on_trendyol', icon: PackageX, tone: 'text-orange-600 dark:text-orange-400' },
  { key: 'match_conflict', icon: GitCompare, tone: 'text-amber-700 dark:text-amber-300' },
  { key: 'fewer_images_on_site', icon: ImageIcon, tone: 'text-violet-600 dark:text-violet-400' },
  { key: 'stock_diff', icon: Boxes, tone: 'text-sky-600 dark:text-sky-400' },
  { key: 'variant_diff', icon: Ruler, tone: 'text-teal-600 dark:text-teal-400' },
  { key: 'content_diff', icon: FileText, tone: 'text-slate-600 dark:text-slate-300' },
  { key: 'campaign', icon: Tag, tone: 'text-pink-600 dark:text-pink-400' },
  { key: 'cheaper_on_site', icon: TrendingUp, tone: 'text-green-600 dark:text-green-400' },
  { key: 'fewer_images_on_trendyol', icon: ImageIcon, tone: 'text-indigo-600 dark:text-indigo-400' },
  { key: 'all', icon: Scale, tone: 'text-gray-600 dark:text-gray-300' },
]

const firstImage = (images: string[] | string | null | undefined): string | null => {
  if (!images) return null
  if (Array.isArray(images)) return images[0] ?? null
  try { const arr = JSON.parse(images); return Array.isArray(arr) ? arr[0] ?? null : null } catch { return null }
}

export default function PriceComparisonPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const tc = (k: string, o?: Record<string, unknown>) => t(`trendyolCompare.${k}`, o)

  const [view, setView] = useState<View>('cheaper_on_trendyol')
  const [items, setItems] = useState<Row[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(true)
  const [campaignOnly, setCampaignOnly] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const money = (v: string | number | null | undefined, currency = 'TRY') => {
    if (v === null || v === undefined || v === '') return '—'
    const n = typeof v === 'string' ? parseFloat(v) : v
    if (Number.isNaN(n)) return '—'
    return n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
  }
  const dt = (v: string | null | undefined) => v ? new Date(v).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : tc('neverSynced')

  const buildParams = useCallback((p: number) => {
    const params: Record<string, string> = { per_page: '25', page: String(p), view }
    if (search) params.search = search
    params.in_stock_only = inStockOnly ? '1' : '0'
    if (campaignOnly) params.campaign_only = '1'
    return params
  }, [view, search, inStockOnly, campaignOnly])

  const fetchStats = useCallback(() => {
    api.get<Stats>('/trendyol-compare/stats').then((r) => setStats(r.data)).catch(() => setStats(null))
  }, [])

  const fetchItems = useCallback((p: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    api.get<PaginatedResponse<Row>>('/trendyol-compare', { params: buildParams(p) })
      .then((res) => {
        setItems((prev) => (append ? [...prev, ...res.data.data] : res.data.data))
        setPage(res.data.current_page); setLastPage(res.data.last_page); setTotal(res.data.total)
      })
      .catch(() => { if (!append) setItems([]) })
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [buildParams])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => {
    api.get<Probe>('/trendyol-compare/probe').then((r) => setProbe(r.data)).catch(() => setProbe(null))
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => fetchItems(1, false), search ? 350 : 0)
    return () => clearTimeout(timer)
  }, [fetchItems, search])

  // Senkron sürerken istatistikleri tazele
  useEffect(() => {
    if (!stats?.catalog_sync_running && !syncing) return
    const id = setInterval(() => {
      api.get<Stats>('/trendyol-compare/stats').then((r) => {
        setStats(r.data)
        if (!r.data.catalog_sync_running) { setSyncing(false); fetchItems(1, false) }
      })
    }, 8000)
    return () => clearInterval(id)
  }, [stats?.catalog_sync_running, syncing, fetchItems])

  const startSync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      await api.post('/trendyol-compare/sync')
      setSyncMsg(tc('sync.started'))
      setStats((s) => s ? { ...s, catalog_sync_running: true } : s)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setSyncMsg(err.response?.data?.message || tc('sync.failed'))
      setSyncing(false)
    }
  }

  const exportUrl = () => {
    const p = new URLSearchParams(buildParams(1))
    p.delete('page'); p.delete('per_page')
    return `/api/trendyol-compare/export?${p.toString()}`
  }

  const downloadCsv = async () => {
    const res = await api.get(exportUrl().replace(/^\/api/, ''), { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = `trendyol-kiyas-${view}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const noCatalog = stats !== null && stats.ty_rows === 0
  const currentMeta = VIEW_META.find((v) => v.key === view)!

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <div className="flex items-center gap-3">
            <Scale className="text-indigo-500" size={26} />
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">{tc('title')}</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tc('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadCsv} disabled={loading || total === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            <Download size={15} /> {tc('exportCsv')}
          </button>
          <button onClick={startSync} disabled={syncing || stats?.catalog_sync_running || probe?.ok === false}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {(syncing || stats?.catalog_sync_running) ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {(syncing || stats?.catalog_sync_running) ? tc('sync.running') : tc('sync.button')}
          </button>
        </div>
      </div>

      {/* Erişim / durum bantları */}
      {probe && !probe.ok && (
        <div className="mt-3 mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">{tc(`probe.${probe.reason || 'api_error'}.title`)}</div>
              <div className="mt-0.5">{tc(`probe.${probe.reason || 'api_error'}.body`)}</div>
              {probe.message && probe.reason === 'api_error' && <div className="mt-1 text-xs opacity-80 font-mono">{probe.message}</div>}
              <Link to="/settings/channels" className="inline-flex items-center gap-1 mt-2 font-medium underline">
                <Settings size={14} /> {tc('probe.goToSettings')}
              </Link>
            </div>
          </div>
        </div>
      )}
      {syncMsg && <div className="mt-2 mb-2 text-sm text-indigo-700 dark:text-indigo-300">{syncMsg}</div>}
      {stats?.catalog_sync_error && probe?.ok && (
        <div className="mt-2 mb-2 text-sm text-red-600 dark:text-red-400">{tc('sync.lastError')}: {stats.catalog_sync_error}</div>
      )}

      {/* Özet kartlar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 my-4">
        <StatCard icon={<Boxes size={16} />} label={tc('stats.tyRows')} value={stats ? stats.ty_rows.toLocaleString(locale) : '—'}
          sub={stats ? tc('stats.matchedRowsVerified', { n: stats.ty_matched_rows.toLocaleString(locale), v: stats.ty_stock_verified_rows.toLocaleString(locale), c: stats.ty_conflict_rows.toLocaleString(locale) }) : ''} />
        <StatCard icon={<TrendingDown size={16} />} label={tc('views.cheaper_on_trendyol')} value={stats ? stats.counts.cheaper_on_trendyol.toLocaleString(locale) : '—'} tone="danger"
          sub={stats?.avg_gap_pct != null ? tc('stats.avgGap', { pct: stats.avg_gap_pct }) : ''} />
        <StatCard icon={<PackageSearch size={16} />} label={tc('views.missing_on_site')} value={stats ? stats.counts.missing_on_site.toLocaleString(locale) : '—'} tone="warn"
          sub={stats?.counts.missing_on_site_total != null ? tc('stats.inStockOfTotal', { n: stats.counts.missing_on_site_total.toLocaleString(locale) }) : ''} />
        <StatCard icon={<PackageX size={16} />} label={tc('views.missing_on_trendyol')} value={stats ? stats.counts.missing_on_trendyol.toLocaleString(locale) : '—'} tone="warn"
          sub={stats?.counts.missing_on_trendyol_total != null ? tc('stats.inStockOfTotal', { n: stats.counts.missing_on_trendyol_total.toLocaleString(locale) }) : ''} />
        <StatCard icon={<ImageIcon size={16} />} label={tc('views.fewer_images_on_site')} value={stats ? stats.counts.fewer_images_on_site.toLocaleString(locale) : '—'} tone="violet" />
        <StatCard icon={<RefreshCw size={16} />} label={tc('stats.lastSynced')} value={dt(stats?.catalog_synced_at)} small
          sub={stats ? tc('stats.buyerPriceAt', { n: stats.buyer_price_products.toLocaleString(locale), at: stats.buyer_price_at ? new Date(stats.buyer_price_at).toLocaleDateString(locale) : '—' }) : ''} />
      </div>

      {/* Görünüm sekmeleri */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {VIEW_META.map(({ key, icon: Icon, tone }) => (
          <button key={key} onClick={() => setView(key)}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition',
              view === key
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
            <Icon size={13} className={view === key ? '' : tone} />
            {tc(`views.${key}`)}
            {stats && <span className={clsx('ml-0.5 tabular-nums', view === key ? 'opacity-80' : 'text-gray-400')}>{stats.counts[key]?.toLocaleString(locale)}</span>}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-1.5">
        <currentMeta.icon size={13} className={currentMeta.tone} /> {tc(`viewHelp.${view}`)}
      </p>

      {/* Filtreler */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tc('searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        {view !== 'match_conflict' && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            {tc('filters.inStock')}
          </label>
        )}
        {view !== 'missing_on_site' && view !== 'missing_on_trendyol' && view !== 'match_conflict' && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={campaignOnly} onChange={(e) => setCampaignOnly(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            {tc('filters.campaignOnly')}
          </label>
        )}
      </div>

      {/* Tablo */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          {view === 'missing_on_site' ? (
            <MissingOnSiteTable rows={items as MissingOnSiteRow[]} loading={loading} money={money} tc={tc} noCatalog={noCatalog} />
          ) : view === 'missing_on_trendyol' ? (
            <MissingOnTrendyolTable rows={items as MissingOnTrendyolRow[]} loading={loading} money={money} tc={tc} noCatalog={noCatalog} />
          ) : view === 'match_conflict' ? (
            <MatchConflictTable rows={items as MatchConflictRow[]} loading={loading} money={money} tc={tc} noCatalog={noCatalog} />
          ) : (
            <MatchedTable rows={items as MatchedRow[]} loading={loading} money={money} tc={tc} view={view} noCatalog={noCatalog} locale={locale} />
          )}
        </div>
      </div>

      {!loading && page < lastPage && (
        <div className="text-center mt-4">
          <button onClick={() => fetchItems(page + 1, true)} disabled={loadingMore}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            {loadingMore ? t('common.loading') : tc('loadMore', { shown: items.length, total })}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Tablolar ---------- */

type Money = (v: string | number | null | undefined, currency?: string) => string
type Tc = (k: string, o?: Record<string, unknown>) => string

function EmptyRow({ colSpan, loading, tc, noCatalog }: { colSpan: number; loading: boolean; tc: Tc; noCatalog: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-gray-400">
        {loading ? tc('loading') : noCatalog ? tc('emptyNoCatalog') : tc('empty')}
      </td>
    </tr>
  )
}

function ProductCell({ img, name, sub, url }: { img: string | null; name: string | null; sub?: string | null; url?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      {img ? <img src={img} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0 bg-gray-100" loading="lazy" />
        : <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0" />}
      <div className="min-w-0">
        {url ? (
          <a href={url.startsWith('http') ? url : undefined} target="_blank" rel="noreferrer" className="font-medium text-gray-900 dark:text-white truncate max-w-xs block hover:text-indigo-600">{name}</a>
        ) : <div className="font-medium text-gray-900 dark:text-white truncate max-w-xs">{name}</div>}
        {sub && <div className="text-xs text-gray-400 truncate max-w-xs">{sub}</div>}
      </div>
    </div>
  )
}

/** Elle kontrol icin: her satirdan site ve Trendyol urun sayfasina dogrudan link */
function LinkPair({ site, ty, tc }: { site?: string | null; ty?: string | null; tc: Tc }) {
  const ok = (u?: string | null) => !!u && u.startsWith('http')
  if (!ok(site) && !ok(ty)) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {ok(site) && (
        <a href={site!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600">
          <Globe size={10} /> {tc('table.openSite')} <ExternalLink size={9} />
        </a>
      )}
      {ok(ty) && (
        <a href={ty!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-orange-200 dark:border-orange-800 text-[11px] text-orange-700 dark:text-orange-300 hover:border-orange-400">
          <Tag size={10} /> {tc('table.openTy')} <ExternalLink size={9} />
        </a>
      )}
    </div>
  )
}

function Th({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return <th className={clsx('font-medium px-4 py-3 whitespace-nowrap', right ? 'text-right' : center ? 'text-center' : 'text-left')}>{children}</th>
}

function Pill({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap',
      ok === true ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : ok === false ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400')}>{children}</span>
  )
}

function MatchedTable({ rows, loading, money, tc, view, noCatalog, locale }: { rows: MatchedRow[]; loading: boolean; money: Money; tc: Tc; view: View; noCatalog: boolean; locale: string }) {
  const showImages = view === 'fewer_images_on_site' || view === 'fewer_images_on_trendyol' || view === 'all'
  const showVariants = view === 'variant_diff' || view === 'stock_diff' || view === 'all'
  const showContent = view === 'content_diff'
  const cols = 5 + (showImages ? 1 : 0) + (showVariants ? 1 : 0) + (showContent ? 1 : 0)
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
        <tr>
          <Th>{tc('table.product')}</Th>
          <Th right>{tc('table.sitePrice')}</Th>
          <Th right>{tc('table.tyPrice')}</Th>
          <Th right>{tc('table.diff')}</Th>
          <Th center>{tc('table.stock')}</Th>
          {showImages && <Th center>{tc('table.images')}</Th>}
          {showVariants && <Th center>{tc('table.variants')}</Th>}
          {showContent && <Th>{tc('table.content')}</Th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {(loading || rows.length === 0) ? <EmptyRow colSpan={cols} loading={loading} tc={tc} noCatalog={noCatalog} /> : rows.map((row) => {
          const diff = row.price_diff !== null ? parseFloat(row.price_diff) : null
          const cheaperTy = diff !== null && diff > 0
          const cur = row.currency || 'TRY'
          const siteOut = (row.site_stock ?? 0) <= 0
          const tyOut = (row.ty_quantity ?? 0) <= 0
          return (
            <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
              <td className="px-4 py-3">
                <ProductCell img={firstImage(row.images)} name={row.name} sub={[row.sku, row.ty_stock_code].filter(Boolean).join(' · ')} url={row.site_url} />
                {row.title_differs && row.ty_title && (
                  <div className="text-[11px] text-gray-400 mt-1 truncate max-w-xs" title={row.ty_title}>TY: {row.ty_title}</div>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {row.ty_campaign && <Pill ok={null}><Tag size={10} className="inline mr-0.5" />{tc('badges.campaign')}</Pill>}
                  {row.ty_approved === false && <Pill ok={false}>{tc('badges.notApproved')}</Pill>}
                  {row.ty_on_sale === false && <Pill ok={false}>{tc('badges.notOnSale')}</Pill>}
                  {row.ty_conflicts > 0 && <Pill ok={false}><GitCompare size={10} className="inline mr-0.5" />{tc('badges.conflict', { n: row.ty_conflicts })}</Pill>}
                  {row.ty_stock_verified === 0 && row.ty_conflicts === 0 && <Pill ok={null}>{tc('badges.barcodeOnly')}</Pill>}
                </div>
                <LinkPair site={row.site_url} ty={row.ty_url} tc={tc} />
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                {money(row.site_price, cur)}
                <a href={row.site_url?.startsWith('http') ? row.site_url : undefined} target="_blank" rel="noreferrer" className="block text-[11px] text-gray-400 hover:text-indigo-600">{tc('table.siteStock')}: {row.site_stock ?? 0}</a>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <a href={row.ty_url || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-900 dark:text-white hover:text-indigo-600 font-medium">
                  {money(row.ty_price, cur)}{row.ty_url && <ExternalLink size={12} className="text-gray-400" />}
                </a>
                <div className="text-[11px] text-gray-400">
                  {row.ty_price_source === 'buyer'
                    ? tc('table.buyerPrice', { seller: money(row.ty_seller_price, cur) })
                    : tc('table.sellerPriceOnly')}
                </div>
                {row.ty_list_price && parseFloat(row.ty_list_price) > parseFloat(row.ty_price || '0') && (
                  <div className="text-[11px] text-gray-400 line-through">{money(row.ty_list_price, cur)}</div>
                )}
              </td>
              <td className={clsx('px-4 py-3 text-right whitespace-nowrap font-semibold',
                cheaperTy ? 'text-red-600 dark:text-red-400' : diff && diff < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400')}>
                <span className="inline-flex items-center gap-1 justify-end">
                  {cheaperTy ? <TrendingDown size={14} /> : diff && diff < 0 ? <TrendingUp size={14} /> : null}
                  {diff !== null ? money(Math.abs(diff), cur) : '—'}
                  {row.price_diff_pct !== null && <span className="text-xs opacity-70">({Math.abs(parseFloat(row.price_diff_pct))}%)</span>}
                </span>
                {cheaperTy && <div className="text-[11px] font-normal text-red-500/80">{tc('table.tyCheaper')}</div>}
              </td>
              <td className="px-4 py-3 text-center whitespace-nowrap">
                <div className="flex flex-col items-center gap-1">
                  <Pill ok={!siteOut}>{tc('table.site')}: {row.site_stock ?? 0}</Pill>
                  <Pill ok={!tyOut}>TY: {row.ty_quantity}</Pill>
                </div>
              </td>
              {showImages && (
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  <div className={clsx('font-semibold', row.image_diff > 0 ? 'text-violet-600 dark:text-violet-400' : row.image_diff < 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400')}>
                    {tc('table.site')} {row.site_image_count} / TY {row.ty_image_count}
                  </div>
                  {row.image_diff !== 0 && <div className="text-[11px] text-gray-400">{row.image_diff > 0 ? tc('table.siteMissingImages', { n: row.image_diff }) : tc('table.tyMissingImages', { n: -row.image_diff })}</div>}
                </td>
              )}
              {showVariants && (
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  <div className="text-gray-700 dark:text-gray-300">{tc('table.site')} {row.site_variant_count} ({row.site_in_stock_variants}) / TY {row.ty_variant_count} ({row.ty_in_stock_variants})</div>
                  {row.ty_unmatched_variants > 0 && <div className="text-[11px] text-amber-600">{tc('table.unmatchedVariants', { n: row.ty_unmatched_variants })}</div>}
                  {row.variant_diff !== 0 && <div className="text-[11px] text-gray-400">{row.variant_diff > 0 ? tc('table.tyMoreSizes', { n: row.variant_diff }) : tc('table.siteMoreSizes', { n: -row.variant_diff })}</div>}
                </td>
              )}
              {showContent && (
                <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                  <div>{tc('table.descLen')}: {tc('table.site')} {row.site_description_length.toLocaleString(locale)} / TY {row.ty_description_length.toLocaleString(locale)}</div>
                  <div>{tc('table.title')}: {row.title_differs ? <span className="text-amber-600">{tc('table.differs')}</span> : <span className="text-green-600">{tc('table.same')}</span>}</div>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function MissingOnSiteTable({ rows, loading, money, tc, noCatalog }: { rows: MissingOnSiteRow[]; loading: boolean; money: Money; tc: Tc; noCatalog: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
        <tr>
          <Th>{tc('table.tyProduct')}</Th>
          <Th>{tc('table.modelColor')}</Th>
          <Th>{tc('table.sizes')}</Th>
          <Th right>{tc('table.tyPrice')}</Th>
          <Th center>{tc('table.tyStock')}</Th>
          <Th center>{tc('table.images')}</Th>
          <Th center>{tc('table.status')}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {(loading || rows.length === 0) ? <EmptyRow colSpan={7} loading={loading} tc={tc} noCatalog={noCatalog} /> : rows.map((r) => (
          <tr key={`${r.ty_main_id}|${r.ty_color}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
            <td className="px-4 py-3">
              <ProductCell img={firstImage(r.images)} name={r.ty_title} sub={[r.ty_brand, r.ty_category].filter(Boolean).join(' · ')} url={r.ty_url} />
              <LinkPair ty={r.ty_url} tc={tc} />
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
              <div className="font-mono">{r.ty_main_id}</div>
              {r.ty_color && <div>{r.ty_color}</div>}
              {r.ty_stock_code && r.ty_stock_code !== r.ty_main_id && <div className="text-gray-400">{r.ty_stock_code}</div>}
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 max-w-[180px]">{r.ty_sizes || '—'} <span className="text-gray-400">({r.ty_variant_count})</span></td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <div className="font-medium text-gray-900 dark:text-white">{money(r.ty_seller_price)}</div>
              {r.ty_list_price && parseFloat(r.ty_list_price) > parseFloat(r.ty_seller_price || '0') && <div className="text-[11px] text-gray-400 line-through">{money(r.ty_list_price)}</div>}
            </td>
            <td className="px-4 py-3 text-center"><Pill ok={r.ty_quantity > 0}>{r.ty_quantity}</Pill></td>
            <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.ty_image_count}</td>
            <td className="px-4 py-3 text-center">
              <div className="flex flex-col items-center gap-1">
                <Pill ok={r.ty_approved}>{r.ty_approved ? tc('badges.approved') : tc('badges.notApproved')}</Pill>
                <Pill ok={r.ty_on_sale}>{r.ty_on_sale ? tc('badges.onSale') : tc('badges.notOnSale')}</Pill>
                {r.ty_campaign && <Pill ok={null}>{tc('badges.campaign')}</Pill>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MissingOnTrendyolTable({ rows, loading, money, tc, noCatalog }: { rows: MissingOnTrendyolRow[]; loading: boolean; money: Money; tc: Tc; noCatalog: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
        <tr>
          <Th>{tc('table.product')}</Th>
          <Th>{tc('table.category')}</Th>
          <Th right>{tc('table.sitePrice')}</Th>
          <Th center>{tc('table.siteStock')}</Th>
          <Th center>{tc('table.variants')}</Th>
          <Th center>{tc('table.images')}</Th>
          <Th center>{tc('table.ticimaxFlag')}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {(loading || rows.length === 0) ? <EmptyRow colSpan={7} loading={loading} tc={tc} noCatalog={noCatalog} /> : rows.map((r) => (
          <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
            <td className="px-4 py-3">
              <ProductCell img={firstImage(r.images)} name={r.name} sub={[r.sku, r.barcode].filter(Boolean).join(' · ')} url={r.site_url} />
              <LinkPair site={r.site_url} ty={r.ty_url} tc={tc} />
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{r.category || '—'}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-gray-900 dark:text-white">{money(r.site_price, r.currency || 'TRY')}</td>
            <td className="px-4 py-3 text-center"><Pill ok={(r.site_stock ?? 0) > 0}>{r.site_stock ?? 0}</Pill></td>
            <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.site_variant_count} ({r.site_in_stock_variants})</td>
            <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.site_image_count}</td>
            <td className="px-4 py-3 text-center"><Pill ok={r.site_trendyol_flag ? r.site_trendyol_flag.toLowerCase().startsWith('e') : null}>{r.site_trendyol_flag || '—'}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MatchConflictTable({ rows, loading, money, tc, noCatalog }: { rows: MatchConflictRow[]; loading: boolean; money: Money; tc: Tc; noCatalog: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
        <tr>
          <Th>{tc('table.tyProduct')}</Th>
          <Th>{tc('table.stockCodeProduct')}</Th>
          <Th>{tc('table.barcodeProduct')}</Th>
          <Th center>{tc('table.variants')}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {(loading || rows.length === 0) ? <EmptyRow colSpan={4} loading={loading} tc={tc} noCatalog={noCatalog} /> : rows.map((r) => {
          const cur = r.currency || 'TRY'
          return (
            <tr key={`${r.id}|${r.barcode_product_id}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
              <td className="px-4 py-3">
                <ProductCell img={firstImage(r.ty_images)} name={r.ty_title} sub={r.ty_main_id} url={r.ty_url} />
                <div className="text-[11px] text-gray-400 mt-1 max-w-xs break-words">{r.ty_stock_codes}</div>
                <div className="text-[11px] text-gray-400 max-w-xs break-words">{r.ty_barcodes}</div>
                <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">{money(r.ty_seller_price, cur)} · TY {tc('table.stock').toLowerCase()}: {r.ty_quantity}</div>
                <LinkPair ty={r.ty_url} tc={tc} />
              </td>
              <td className="px-4 py-3">
                <ProductCell img={firstImage(r.images)} name={r.name} sub={r.sku} url={r.site_url} />
                <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">{money(r.site_price, cur)} · {tc('table.stock').toLowerCase()}: {r.site_stock ?? 0}</div>
                <LinkPair site={r.site_url} tc={tc} />
              </td>
              <td className="px-4 py-3">
                <ProductCell img={firstImage(r.barcode_images)} name={r.barcode_name} sub={r.barcode_sku} url={r.barcode_site_url} />
                <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">{money(r.barcode_site_price, cur)} · {tc('table.stock').toLowerCase()}: {r.barcode_site_stock ?? 0}</div>
                <LinkPair site={r.barcode_site_url} tc={tc} />
              </td>
              <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.ty_variant_count}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function StatCard({ icon, label, value, sub, tone = 'neutral', small }: {
  icon: React.ReactNode; label: string; value: string; sub?: string
  tone?: 'neutral' | 'danger' | 'success' | 'warn' | 'violet'; small?: boolean
}) {
  const toneClass = {
    neutral: 'text-gray-500 dark:text-gray-400',
    danger: 'text-red-600 dark:text-red-400',
    success: 'text-green-600 dark:text-green-400',
    warn: 'text-amber-600 dark:text-amber-400',
    violet: 'text-violet-600 dark:text-violet-400',
  }[tone]
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3">
      <div className={clsx('flex items-center gap-1.5 mb-1', toneClass)}>
        {icon}
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-tight">{label}</span>
      </div>
      <div className={clsx('font-semibold text-gray-900 dark:text-white', small ? 'text-xs' : 'text-xl')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  )
}
