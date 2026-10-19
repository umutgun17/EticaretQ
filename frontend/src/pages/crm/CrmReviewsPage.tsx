import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import type { ProductReviewSummary, PaginatedResponse } from '@/types'
import { Star, MessageSquareText, Search, TrendingUp, Award, BarChart3 } from 'lucide-react'
import clsx from 'clsx'

interface ReviewSummaryWithProduct extends ProductReviewSummary {
  product: {
    id: number
    name: string
    brand: string | null
    category: string | null
    images: string[]
    sku: string | null
  } | null
}

interface ReviewStats {
  total_products: number
  total_reviews: number
  total_comments: number
  avg_rating: number
  rating_distribution: Record<number, number>
}

export default function CrmReviewsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<ReviewSummaryWithProduct[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('rate_count')
  const sentinelRef = useRef<HTMLDivElement>(null)

  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  const buildParams = useCallback(() => {
    const params: Record<string, string> = { per_page: '25', sort_by: sortBy, sort_dir: 'desc' }
    if (search) params.search = search
    return params
  }, [search, sortBy])

  const fetchItems = useCallback(() => {
    setLoading(true)
    api.get<PaginatedResponse<ReviewSummaryWithProduct>>('/crm/reviews', { params: buildParams() })
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
    api.get<ReviewStats>('/crm/reviews/stats').then((res) => setStats(res.data))
  }, [])

  const fetchMore = useCallback(() => {
    if (loadingMore || page >= lastPage) return
    setLoadingMore(true)
    const params = buildParams()
    params.page = String(page + 1)
    api.get<PaginatedResponse<ReviewSummaryWithProduct>>('/crm/reviews', { params })
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

  const formatRating = (rate: string | number) => {
    const num = typeof rate === 'string' ? parseFloat(rate) : rate
    return num.toFixed(1)
  }

  const totalRatings = stats ? Object.values(stats.rating_distribution).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <Star className="text-orange-600" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">{t('crm.reviews.trendyolReviews')}</h1>
            <p className="text-sm text-gray-500">{t('crm.reviews.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<BarChart3 size={18} className="text-orange-600" />}
            label={t('crm.reviews.totalRatings')}
            value={stats.total_reviews.toLocaleString(locale)}
            bg="bg-orange-50"
          />
          <StatCard
            icon={<MessageSquareText size={18} className="text-blue-600" />}
            label={t('crm.reviews.writtenReviews')}
            value={stats.total_comments.toLocaleString(locale)}
            bg="bg-blue-50"
          />
          <StatCard
            icon={<Star size={18} className="text-yellow-600" />}
            label={t('crm.reviews.avgRating')}
            value={formatRating(stats.avg_rating)}
            bg="bg-yellow-50"
          />
          <StatCard
            icon={<Award size={18} className="text-green-600" />}
            label={t('crm.reviews.reviewedProducts')}
            value={stats.total_products.toLocaleString(locale)}
            bg="bg-green-50"
          />
        </div>
      )}

      {/* Rating Distribution Bar */}
      {stats && totalRatings > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('crm.reviews.ratingDistribution')}</h2>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((rate) => {
              const count = stats.rating_distribution[rate] || 0
              const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0
              return (
                <div key={rate} className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1 w-10 shrink-0">
                    <span className="font-medium text-gray-700">{rate}</span>
                    <Star size={12} className="text-yellow-500 fill-yellow-500" />
                  </div>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all',
                        rate >= 4 ? 'bg-green-500' : rate === 3 ? 'bg-yellow-500' : 'bg-red-400'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-gray-500 text-xs w-20 text-right">
                    {count.toLocaleString(locale)} ({pct.toFixed(1)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Search + Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('crm.reviews.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="rate_count">{t('crm.reviews.sortMostRated')}</option>
          <option value="avg_rate">{t('crm.reviews.sortHighestRating')}</option>
          <option value="comment_count">{t('crm.reviews.sortMostComments')}</option>
          <option value="last_synced_at">{t('crm.reviews.sortLastUpdated')}</option>
        </select>
      </div>

      {/* Product Cards */}
      {loading ? (
        <div className="p-12 text-center text-gray-500">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center">
          <Star size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('crm.reviews.noReviews')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('crm.reviews.noReviewsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/crm/reviews/${item.product?.id}`)}
              className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:border-indigo-200 hover:shadow-sm transition-all text-left"
            >
              <div className="flex items-center gap-4">
                {/* Product Image */}
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                  {item.product?.images?.[0] ? (
                    <img src={item.product.images[0]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Star size={20} className="text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 truncate">
                    {item.product?.name || `${t('crm.favorites.product')} #${item.product_id}`}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    {item.product?.brand && (
                      <span className="text-xs text-gray-500">{item.product.brand}</span>
                    )}
                  </div>
                </div>

                {/* Rating */}
                <div className="text-center shrink-0">
                  <div className="flex items-center gap-1">
                    <Star size={16} className="text-yellow-500 fill-yellow-500" />
                    <span className="text-lg font-semibold text-gray-900">{formatRating(item.avg_rate)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.rate_count.toLocaleString(locale)} {t('crm.reviews.ratings')}
                  </div>
                </div>

                {/* Mini Distribution */}
                <div className="hidden md:flex items-end gap-0.5 h-8 shrink-0">
                  {[item.rate_one, item.rate_two, item.rate_three, item.rate_four, item.rate_five].map((count, i) => {
                    const maxCount = Math.max(item.rate_one, item.rate_two, item.rate_three, item.rate_four, item.rate_five, 1)
                    const height = Math.max((count / maxCount) * 28, 2)
                    return (
                      <div
                        key={i}
                        className={clsx(
                          'w-2 rounded-full',
                          i >= 3 ? 'bg-green-400' : i === 2 ? 'bg-yellow-400' : 'bg-red-300'
                        )}
                        style={{ height: `${height}px` }}
                        title={t('crm.reviews.starCount', { count: i + 1, total: count })}
                      />
                    )
                  })}
                </div>

                {/* Comments Count */}
                <div className="flex items-center gap-1.5 text-gray-500 shrink-0">
                  <MessageSquareText size={14} />
                  <span className="text-sm">{item.comment_count.toLocaleString(locale)}</span>
                </div>

                <TrendingUp size={16} className="text-gray-300 shrink-0" />
              </div>
            </button>
          ))}

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} />

          {loadingMore && (
            <div className="py-4 text-center text-sm text-gray-500">{t('common.loading')}</div>
          )}

          {!loadingMore && page >= lastPage && items.length > 0 && (
            <div className="py-4 text-center text-xs text-gray-400">
              {t('crm.reviews.showingTotal', { count: total })}
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
