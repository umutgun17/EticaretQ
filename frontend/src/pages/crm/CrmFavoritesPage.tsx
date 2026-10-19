import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import type { ProductFavoriteGrouped, ProductFavorite, FavoriteStats, FavoriteChartPoint, PaginatedResponse } from '@/types'
import { Heart, Search, Package, Users, TrendingUp, AlertTriangle, Calendar, BarChart3, Eye } from 'lucide-react'
import clsx from 'clsx'

type ViewMode = 'grouped' | 'detailed'
type PeriodFilter = '' | 'today' | '7d' | '30d' | '90d' | '180d' | '365d'
type StockFilter = '' | 'in_stock' | 'out_of_stock'

const periodToDays: Record<string, number> = {
  '': 365,
  'today': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
}

export default function CrmFavoritesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<(ProductFavoriteGrouped | ProductFavorite)[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [stats, setStats] = useState<FavoriteStats | null>(null)
  const [chartData, setChartData] = useState<FavoriteChartPoint[]>([])
  const [topProducts, setTopProducts] = useState<ProductFavoriteGrouped[]>([])

  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  // Filters
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<PeriodFilter>('')
  const [stock, setStock] = useState<StockFilter>('')
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [sortBy, setSortBy] = useState('favorite_count')

  const sentinelRef = useRef<HTMLDivElement>(null)

  const getPeriodLabel = (p: string) => {
    const key = p || 'all'
    return t(`crm.favorites.periods.${key}`)
  }

  const buildParams = useCallback(() => {
    const params: Record<string, string> = {
      per_page: '30',
      sort_by: sortBy,
      sort_dir: 'desc',
      mode: viewMode,
    }
    if (search) params.search = search
    if (period) params.period = period
    if (stock) params.stock = stock
    return params
  }, [search, period, stock, viewMode, sortBy])

  const fetchItems = useCallback(() => {
    setLoading(true)
    api.get<PaginatedResponse<ProductFavoriteGrouped | ProductFavorite>>('/crm/favorites', { params: buildParams() })
      .then((res) => {
        setItems(res.data.data)
        setPage(res.data.current_page)
        setLastPage(res.data.last_page)
        setTotal(res.data.total)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [buildParams])

  const fetchStats = useCallback(() => {
    const params: Record<string, string> = {}
    if (period) params.period = period
    api.get<FavoriteStats>('/crm/favorites/stats', { params }).then((res) => setStats(res.data))
  }, [period])

  const fetchChart = useCallback(() => {
    const days = periodToDays[period] || 365
    api.get<{ data: FavoriteChartPoint[] }>('/crm/favorites/chart', { params: { days: String(days) } })
      .then((res) => setChartData(res.data.data))
  }, [period])

  const fetchTopProducts = useCallback(() => {
    const params: Record<string, string> = { limit: '5' }
    if (period) params.period = period
    else params.period = 'all'
    api.get<ProductFavoriteGrouped[]>('/crm/favorites/top-products', { params })
      .then((res) => setTopProducts(res.data))
  }, [period])

  const fetchMore = useCallback(() => {
    if (loadingMore || page >= lastPage) return
    setLoadingMore(true)
    const params = buildParams()
    params.page = String(page + 1)
    api.get<PaginatedResponse<ProductFavoriteGrouped | ProductFavorite>>('/crm/favorites', { params })
      .then((res) => {
        setItems((prev) => [...prev, ...res.data.data])
        setPage(res.data.current_page)
        setLastPage(res.data.last_page)
        setLoadingMore(false)
      })
      .catch(() => setLoadingMore(false))
  }, [page, lastPage, loadingMore, buildParams])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchChart() }, [fetchChart])
  useEffect(() => { fetchTopProducts() }, [fetchTopProducts])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (loading) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMore() },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading, fetchMore])

  // Update sort when view mode changes
  useEffect(() => {
    setSortBy(viewMode === 'grouped' ? 'favorite_count' : 'favorited_at')
  }, [viewMode])

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const maxChart = chartData.length > 0 ? Math.max(...chartData.map((d) => Math.max(d.total, d.unique_products)), 1) : 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-pink-100 rounded-xl flex items-center justify-center">
            <Heart className="text-pink-600" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">{t('crm.favorites.title')}</h1>
            <p className="text-sm text-gray-500">{t('crm.favorites.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={<Heart size={18} className="text-pink-600" />} label={t('crm.favorites.totalFavorites')} value={stats.total_favorites.toLocaleString(locale)} bg="bg-pink-50" />
          <StatCard icon={<Package size={18} className="text-blue-600" />} label={t('crm.favorites.uniqueProducts')} value={stats.unique_products.toLocaleString(locale)} bg="bg-blue-50" />
          <StatCard icon={<Users size={18} className="text-indigo-600" />} label={t('crm.favorites.uniqueMembers')} value={stats.unique_customers.toLocaleString(locale)} bg="bg-indigo-50" />
          <StatCard icon={<TrendingUp size={18} className="text-green-600" />} label={t('crm.favorites.today')} value={stats.today.toLocaleString(locale)} bg="bg-green-50" />
          <StatCard icon={<Calendar size={18} className="text-orange-600" />} label={t('crm.favorites.last7Days')} value={stats.last_7_days.toLocaleString(locale)} bg="bg-orange-50" />
          <StatCard icon={<AlertTriangle size={18} className="text-red-600" />} label={t('crm.favorites.outOfStockCount')} value={stats.out_of_stock_count.toLocaleString(locale)} bg="bg-red-50" />
        </div>
      )}

      {/* Chart + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 size={16} className="text-gray-400" />
              {t('crm.favorites.dailyTrend')}
            </h2>
            <span className="text-xs text-gray-400">{getPeriodLabel(period)}</span>
          </div>
          {chartData.length > 0 ? (
            <div className="flex items-end gap-[2px] h-32">
              {chartData.map((point) => {
                const totalPct = Math.max((point.total / maxChart) * 100, 2)
                const uniquePct = point.total > 0 ? (point.unique_products / point.total) * 100 : 0
                return (
                  <div key={point.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div
                      className="w-full rounded-t-sm min-h-[2px] relative overflow-hidden"
                      style={{ height: `${totalPct}%` }}
                    >
                      <div className="absolute inset-0 bg-pink-400" />
                      <div className="absolute bottom-0 left-0 right-0 bg-indigo-500" style={{ height: `${uniquePct}%` }} />
                    </div>
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      <div>{formatDate(point.date)}</div>
                      <div>{t('crm.favorites.favoriteTooltip', { total: point.total, products: point.unique_products })}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-sm text-gray-400">{t('crm.favorites.noData')}</div>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-pink-400 rounded-sm" /> {t('crm.favorites.totalFavoritesLegend')}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-sm" /> {t('crm.favorites.uniqueProductsLegend')}</span>
          </div>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('crm.favorites.mostFavorited')} ({getPeriodLabel(period)})</h2>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div
                  key={p.platform_product_id}
                  className={clsx('flex items-center gap-3', p.product_id && 'cursor-pointer')}
                  onClick={() => p.product_id && navigate(`/crm/products/${p.product_id}`)}
                >
                  <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                  <div className="w-8 h-8 rounded bg-gray-100 overflow-hidden shrink-0">
                    {p.product_image ? (
                      <img src={p.product_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={14} className="text-gray-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={clsx('text-xs font-medium line-clamp-2', p.product_id ? 'text-gray-900 hover:text-indigo-600' : 'text-gray-900')} title={p.product_name}>{p.product_name}</div>
                  </div>
                  <div className="text-xs font-semibold text-pink-600 shrink-0">{p.favorite_count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400 text-center py-6">{t('crm.favorites.noData')}</div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('crm.favorites.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
          className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 bg-white"
        >
          <option value="">{t('crm.favorites.periods.all')}</option>
          <option value="today">{t('crm.favorites.periods.today')}</option>
          <option value="7d">{t('crm.favorites.periods.7d')}</option>
          <option value="30d">{t('crm.favorites.periods.30d')}</option>
          <option value="90d">{t('crm.favorites.periods.90d')}</option>
          <option value="180d">{t('crm.favorites.periods.180d')}</option>
          <option value="365d">{t('crm.favorites.periods.365d')}</option>
        </select>
        <select
          value={stock}
          onChange={(e) => setStock(e.target.value as StockFilter)}
          className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 bg-white"
        >
          <option value="">{t('crm.favorites.allStock')}</option>
          <option value="in_stock">{t('crm.favorites.inStock')}</option>
          <option value="out_of_stock">{t('crm.favorites.outOfStock')}</option>
        </select>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grouped')}
            className={clsx(
              'px-3 py-2.5 text-sm transition-colors flex items-center gap-1.5',
              viewMode === 'grouped' ? 'bg-pink-50 text-pink-700 font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'
            )}
          >
            <Package size={14} />
            {t('crm.favorites.productBased')}
          </button>
          <button
            onClick={() => setViewMode('detailed')}
            className={clsx(
              'px-3 py-2.5 text-sm transition-colors flex items-center gap-1.5',
              viewMode === 'detailed' ? 'bg-pink-50 text-pink-700 font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'
            )}
          >
            <Eye size={14} />
            {t('crm.favorites.detailed')}
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-12 text-center text-gray-500">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center">
          <Heart size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('crm.favorites.noFavorites')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('crm.favorites.noFavoritesHint')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 w-12"></th>
                  <th className="px-4 py-3 font-medium text-gray-500">{t('crm.favorites.product')}</th>
                  <th className="px-4 py-3 font-medium text-gray-500">{t('crm.products.sku')}</th>
                  {viewMode === 'grouped' ? (
                    <>
                      <th className="px-4 py-3 font-medium text-gray-500 text-center">{t('crm.favorites.favorite')}</th>
                      <th className="px-4 py-3 font-medium text-gray-500 text-right">{t('crm.products.stock')}</th>
                      <th className="px-4 py-3 font-medium text-gray-500">{t('crm.favorites.lastFavorite')}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 font-medium text-gray-500">{t('crm.favorites.member')}</th>
                      <th className="px-4 py-3 font-medium text-gray-500 text-right">{t('crm.products.stock')}</th>
                      <th className="px-4 py-3 font-medium text-gray-500">{t('crm.orders.date')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item, idx) => {
                  const isGrouped = 'favorite_count' in item
                  const img = isGrouped ? (item as ProductFavoriteGrouped).product_image : (item as ProductFavorite).product_image
                  const name = isGrouped ? (item as ProductFavoriteGrouped).product_name : (item as ProductFavorite).product_name
                  const sku = isGrouped ? (item as ProductFavoriteGrouped).product_sku : (item as ProductFavorite).product_sku
                  const productId = isGrouped ? (item as ProductFavoriteGrouped).product_id : (item as ProductFavorite).product_id
                  const key = isGrouped ? `g-${(item as ProductFavoriteGrouped).platform_product_id}` : `d-${(item as ProductFavorite).id}-${idx}`

                  const mainStock = isGrouped
                    ? (item as ProductFavoriteGrouped).product_stock
                    : (item as ProductFavorite).product?.stock_quantity ?? null

                  const handleRowClick = () => {
                    if (productId) navigate(`/crm/products/${productId}`)
                  }

                  return (
                    <tr key={key} onClick={handleRowClick} className={clsx('hover:bg-gray-50/50 transition-colors', productId && 'cursor-pointer')}>
                      <td className="px-4 py-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                          {img ? (
                            <img src={img} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={16} className="text-gray-300" />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <div className={clsx('font-medium line-clamp-2', productId ? 'text-gray-900 hover:text-indigo-600' : 'text-gray-900')} title={name}>{name}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{sku || '-'}</td>
                      {isGrouped ? (
                        <>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-pink-50 text-pink-700 rounded-full text-xs font-semibold">
                              <Heart size={12} />
                              {(item as ProductFavoriteGrouped).favorite_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <StockBadge quantity={mainStock} t={t} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {formatDate((item as ProductFavoriteGrouped).last_favorited_at)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {(item as ProductFavorite).customer
                              ? `${(item as ProductFavorite).customer!.name} ${(item as ProductFavorite).customer!.surname || ''}`.trim()
                              : `${t('crm.favorites.member')} #${(item as ProductFavorite).platform_customer_id}`}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <StockBadge quantity={mainStock} t={t} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {formatDate((item as ProductFavorite).favorited_at)}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} />

          {loadingMore && (
            <div className="py-4 text-center text-sm text-gray-500">{t('common.loading')}</div>
          )}

          {!loadingMore && page >= lastPage && items.length > 0 && (
            <div className="py-4 text-center text-xs text-gray-400">
              {t('crm.favorites.showingTotal', { count: total.toLocaleString(locale) })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className={clsx('rounded-xl border border-gray-200 p-4', bg)}>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function StockBadge({ quantity, t, locale }: { quantity: number | null; t: (key: string) => string; locale: string }) {
  if (quantity === null) {
    return <span className="text-xs text-gray-400">-</span>
  }
  if (quantity <= 0) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-xs font-medium">
        {t('crm.favorites.stockNone')}
      </span>
    )
  }
  return (
    <span className="text-xs text-gray-600">{Number(quantity).toLocaleString(locale)}</span>
  )
}
