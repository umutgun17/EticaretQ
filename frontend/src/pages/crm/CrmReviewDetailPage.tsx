import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import type { ProductReviewSummary, ProductReview, PaginatedResponse } from '@/types'
import { ArrowLeft, Star, MessageSquareText, Image, ThumbsUp, Filter, X } from 'lucide-react'
import clsx from 'clsx'

interface ReviewProduct {
  id: number
  name: string
  brand: string | null
  images: string[]
  metadata: Record<string, unknown>
}

interface ReviewDetailResponse {
  product: ReviewProduct
  summary: ProductReviewSummary | null
  reviews: PaginatedResponse<ProductReview>
}

export default function CrmReviewDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<ReviewProduct | null>(null)
  const [summary, setSummary] = useState<ProductReviewSummary | null>(null)
  const [reviews, setReviews] = useState<ProductReview[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  // Filters
  const [filterRate, setFilterRate] = useState<number | null>(null)
  const [filterHasImages, setFilterHasImages] = useState(false)
  const [filterHasComment, setFilterHasComment] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [lightboxImg, setLightboxImg] = useState<string | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)

  const buildParams = useCallback(() => {
    const params: Record<string, string> = { per_page: '20' }
    if (filterRate) params.rate = String(filterRate)
    if (filterHasImages) params.has_images = '1'
    if (filterHasComment) params.has_comment = '1'
    return params
  }, [filterRate, filterHasImages, filterHasComment])

  const fetchData = useCallback(() => {
    setLoading(true)
    api.get<ReviewDetailResponse>(`/crm/reviews/${id}`, { params: buildParams() })
      .then((res) => {
        setProduct(res.data.product)
        setSummary(res.data.summary)
        setReviews(res.data.reviews.data)
        setPage(res.data.reviews.current_page)
        setLastPage(res.data.reviews.last_page)
        setTotal(res.data.reviews.total)
        setLoading(false)
      })
      .catch(() => navigate('/crm/reviews'))
  }, [id, buildParams, navigate])

  const fetchMore = useCallback(() => {
    if (loadingMore || page >= lastPage) return
    setLoadingMore(true)
    const params = buildParams()
    params.page = String(page + 1)
    api.get<ReviewDetailResponse>(`/crm/reviews/${id}`, { params })
      .then((res) => {
        setReviews((prev) => [...prev, ...res.data.reviews.data])
        setPage(res.data.reviews.current_page)
        setLastPage(res.data.reviews.last_page)
        setLoadingMore(false)
      })
      .catch(() => setLoadingMore(false))
  }, [id, page, lastPage, loadingMore, buildParams])

  useEffect(() => { fetchData() }, [fetchData])

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

  const hasActiveFilters = filterRate !== null || filterHasImages || filterHasComment
  const clearFilters = () => {
    setFilterRate(null)
    setFilterHasImages(false)
    setFilterHasComment(false)
  }

  if (loading) {
    return <div className="p-12 text-center text-gray-500">{t('common.loading')}</div>
  }

  if (!product) return null

  // Mağaza-slug'lı sabit fallback kaldırıldı (tonny-black başka tenant'a
  // yanlış mağazayı açıyordu); metadata'da url yoksa link gösterilmez.
  const trendyolUrl = product.metadata?.trendyol_url
    ? `https://www.trendyol.com${(product.metadata.trendyol_url as string).split('?')[0]}`
    : null

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/crm/reviews')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('crm.reviews.backToReviews')}
      </button>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 shrink-0">
          {product.images?.[0] ? (
            <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Star size={24} className="text-gray-300" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold text-gray-900 leading-tight">{product.name}</h1>
          <div className="flex items-center gap-3 mt-1.5">
            {product.brand && <span className="text-sm text-gray-500">{product.brand}</span>}
            {trendyolUrl && (
              <a
                href={trendyolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-600 hover:underline"
              >
                {t('crm.reviews.viewOnTrendyol')}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-yellow-50 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-1 mb-1">
              <Star size={18} className="text-yellow-500 fill-yellow-500" />
              <span className="text-2xl font-extrabold text-gray-900">{parseFloat(summary.avg_rate).toFixed(1)}</span>
            </div>
            <div className="text-xs text-gray-500">{t('crm.reviews.averageRating')}</div>
          </div>
          <div className="bg-orange-50 rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-semibold text-gray-900">{summary.rate_count.toLocaleString(locale)}</div>
            <div className="text-xs text-gray-500">{t('crm.reviews.totalRatings')}</div>
          </div>
          <div className="bg-blue-50 rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-semibold text-gray-900">{summary.comment_count.toLocaleString(locale)}</div>
            <div className="text-xs text-gray-500">{t('crm.reviews.writtenReviews')}</div>
          </div>
          <div className="bg-green-50 rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-semibold text-gray-900">
              {summary.rate_count > 0
                ? (((summary.rate_five + summary.rate_four) / summary.rate_count) * 100).toFixed(0)
                : 0}%
            </div>
            <div className="text-xs text-gray-500">{t('crm.reviews.satisfaction')}</div>
          </div>
        </div>
      )}

      {/* Rating Distribution */}
      {summary && summary.rate_count > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('crm.reviews.ratingDistribution')}</h2>
          <div className="space-y-2">
            {([
              [5, summary.rate_five],
              [4, summary.rate_four],
              [3, summary.rate_three],
              [2, summary.rate_two],
              [1, summary.rate_one],
            ] as [number, number][]).map(([rate, count]) => {
              const pct = (count / summary.rate_count) * 100
              return (
                <button
                  key={rate}
                  onClick={() => setFilterRate(filterRate === rate ? null : rate)}
                  className={clsx(
                    'flex items-center gap-3 text-sm w-full rounded-lg px-2 py-1 transition-colors',
                    filterRate === rate ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center gap-1 w-10 shrink-0">
                    <span className="font-medium text-gray-700">{rate}</span>
                    <Star size={12} className="text-yellow-500 fill-yellow-500" />
                  </div>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        rate >= 4 ? 'bg-green-500' : rate === 3 ? 'bg-yellow-500' : 'bg-red-400'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-gray-500 text-xs w-24 text-right">
                    {count.toLocaleString(locale)} ({pct.toFixed(1)}%)
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900 flex-1">
          {t('crm.reviews.reviewsCount', { count: total.toLocaleString(locale) })}
        </h2>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors',
            hasActiveFilters
              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          )}
        >
          <Filter size={14} />
          {t('crm.products.filter')}
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <X size={12} />
            {t('crm.reviews.clear')}
          </button>
        )}
      </div>

      {/* Filter Options */}
      {showFilters && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filterHasComment}
              onChange={(e) => setFilterHasComment(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t('crm.reviews.hasComment')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filterHasImages}
              onChange={(e) => setFilterHasImages(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t('crm.reviews.hasPhoto')}
          </label>
          <div className="h-5 border-l border-gray-200" />
          {[5, 4, 3, 2, 1].map((rate) => (
            <button
              key={rate}
              onClick={() => setFilterRate(filterRate === rate ? null : rate)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                filterRate === rate
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {rate} <Star size={10} className="text-yellow-500 fill-yellow-500" />
            </button>
          ))}
        </div>
      )}

      {/* Reviews List */}
      {reviews.length === 0 ? (
        <div className="p-12 text-center">
          <MessageSquareText size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('crm.reviews.noReviewsForFilter')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} onImageClick={setLightboxImg} t={t} locale={locale} />
          ))}

          <div ref={sentinelRef} />

          {loadingMore && (
            <div className="py-4 text-center text-sm text-gray-500">{t('common.loading')}</div>
          )}
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxImg(null)}
        >
          <button
            onClick={() => setLightboxImg(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300"
          >
            <X size={28} />
          </button>
          <img
            src={lightboxImg}
            alt=""
            className="max-w-full max-h-[90vh] rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function ReviewCard({ review, onImageClick, t, locale }: { review: ProductReview; onImageClick: (url: string) => void; t: (key: string) => string; locale: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* User avatar placeholder */}
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-500">
            {review.user_full_name
              ? review.user_full_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
              : '?'}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">
              {review.user_full_name || t('crm.reviews.anonymous')}
            </div>
            <div className="text-xs text-gray-400">
              {review.comment_date_text || (review.reviewed_at
                ? new Date(review.reviewed_at).toLocaleDateString(locale, {
                    day: '2-digit', month: 'long', year: 'numeric'
                  })
                : '')}
            </div>
          </div>
        </div>
        {/* Rating Stars */}
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              size={14}
              className={clsx(
                s <= review.rate
                  ? 'text-yellow-500 fill-yellow-500'
                  : 'text-gray-200'
              )}
            />
          ))}
        </div>
      </div>

      {/* Comment */}
      {review.comment && (
        <p className="mt-3 text-sm text-gray-700 leading-relaxed">{review.comment}</p>
      )}

      {/* Images */}
      {review.images && review.images.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {review.images.map((img, i) => (
            <button
              key={i}
              onClick={() => onImageClick(img.url)}
              className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200 hover:border-indigo-300 transition-colors"
            >
              <img
                src={img.thumbnailUrl || img.url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Seller Reply */}
      {review.seller_reply && (
        <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
          <div className="text-xs font-medium text-orange-700 mb-1">{t('crm.reviews.sellerReply')}</div>
          <p className="text-sm text-gray-700">{review.seller_reply}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-50">
        {review.like_count > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <ThumbsUp size={12} />
            {review.like_count} {t('crm.reviews.helpful')}
          </span>
        )}
        {review.images && review.images.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Image size={12} />
            {review.images.length} {t('crm.reviews.photos')}
          </span>
        )}
      </div>
    </div>
  )
}
