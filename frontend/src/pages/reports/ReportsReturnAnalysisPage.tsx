import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import type { ReturnReportStats, ReturnTopProduct, ReturnTrendPoint, ReturnBySource } from '@/types'
import { RotateCcw, Package, TrendingDown, DollarSign, ShoppingBag, ArrowDownRight } from 'lucide-react'
import clsx from 'clsx'

type PeriodFilter = '' | '7d' | '30d' | '90d' | '180d' | '365d'

// periodLabels moved inside component

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={clsx('w-11 h-11 rounded-2xl flex items-center justify-center', colors[color])}>
          <Icon size={20} />
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-extrabold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function formatCurrency(val: number): string {
  return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
}

function RateBadge({ rate }: { rate: number }) {
  const color = rate > 10 ? 'bg-red-100 text-red-700' : rate > 5 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
  return <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', color)}>%{rate}</span>
}

export default function ReportsReturnAnalysisPage() {
  const { t } = useTranslation()

  const periodLabels: Record<string, string> = {
    '': t('reportsCommon.allTime'), '7d': t('reportsCommon.last7Days'), '30d': t('reportsCommon.last30Days'),
    '90d': t('reportsCommon.last90Days'), '180d': t('reportsCommon.last6Months'), '365d': t('reportsCommon.last1Year'),
  }

  const [stats, setStats] = useState<ReturnReportStats | null>(null)
  const [topProducts, setTopProducts] = useState<ReturnTopProduct[]>([])
  const [trend, setTrend] = useState<ReturnTrendPoint[]>([])
  const [sources, setSources] = useState<ReturnBySource[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodFilter>('')
  const [sort, setSort] = useState<'count' | 'rate'>('count')
  const [productLimit, setProductLimit] = useState(20)

  const fetchAll = useCallback(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (period) params.period = period

    Promise.all([
      api.get<ReturnReportStats>('/reports/returns/stats', { params }),
      api.get<ReturnTopProduct[]>('/reports/returns/top-products', { params: { ...params, sort, limit: String(productLimit), min_sales: '10' } }),
      api.get<ReturnTrendPoint[]>('/reports/returns/trend', { params: { months: '12' } }),
      api.get<ReturnBySource[]>('/reports/returns/by-source', { params }),
    ]).then(([statsRes, prodRes, trendRes, srcRes]) => {
      setStats(statsRes.data)
      setTopProducts(prodRes.data)
      setTrend(trendRes.data)
      setSources(srcRes.data)
    }).finally(() => setLoading(false))
  }, [period, sort, productLimit])

  useEffect(() => { fetchAll() }, [fetchAll])

  const maxTrend = Math.max(...trend.map(t => t.total_returns), 1)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <RotateCcw className="text-red-600" size={24} />
          <h1 className="text-xl font-extrabold text-gray-900">{t('reportsCommon.returnCancelTitle')}</h1>
        </div>
        <p className="text-sm text-gray-500">{t('reportsCommon.returnCancelDesc')}</p>
      </div>

      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="İade Sipariş"
            value={stats.total_returns.toLocaleString('tr-TR')}
            sub={`${stats.total_orders.toLocaleString('tr-TR')} ödemeli siparişten`}
            icon={RotateCcw}
            color="red"
          />
          <StatCard label="İade Oranı" value={`%${stats.return_rate_pct}`} icon={TrendingDown} color="orange" />
          <StatCard label="Gelir Kaybı" value={formatCurrency(stats.revenue_lost)} icon={DollarSign} color="purple" />
          <StatCard
            label="Kalem Durumu"
            value={`${(stats.returned_items + stats.pending_items + stats.cancelled_items).toLocaleString('tr-TR')} kalem`}
            sub={`${stats.returned_items.toLocaleString('tr-TR')} iade, ${stats.pending_items.toLocaleString('tr-TR')} talep, ${stats.cancelled_items.toLocaleString('tr-TR')} iptal`}
            icon={Package}
            color="blue"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as PeriodFilter)}
          className="text-sm border border-transparent shadow-sm rounded-full px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        >
          {Object.entries(periodLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as 'count' | 'rate')}
          className="text-sm border border-transparent shadow-sm rounded-full px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        >
          <option value="count">En Çok İade (Adet)</option>
          <option value="rate">En Yüksek İade Oranı</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* 2-column: Sources + Item Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Source-based returns */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ShoppingBag size={18} className="text-red-600" />
                Kaynak Bazlı İade
              </h2>
              {sources.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium">Kaynak</th>
                      <th className="pb-2 font-medium text-right">Toplam</th>
                      <th className="pb-2 font-medium text-right">İade</th>
                      <th className="pb-2 font-medium text-right">Oran</th>
                      <th className="pb-2 font-medium text-right">Kayıp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map(src => (
                      <tr key={src.order_source} className="border-b border-gray-50 last:border-0">
                        <td className="py-2.5 font-medium text-gray-900">{src.order_source}</td>
                        <td className="py-2.5 text-right text-gray-600">{src.total_count.toLocaleString('tr-TR')}</td>
                        <td className="py-2.5 text-right text-gray-600">{src.return_count.toLocaleString('tr-TR')}</td>
                        <td className="py-2.5 text-right"><RateBadge rate={src.return_rate_pct} /></td>
                        <td className="py-2.5 text-right text-gray-600">{formatCurrency(src.return_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">Veri bulunamadı</p>
              )}
            </div>

            {/* Item Status Summary */}
            {stats && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Kalem Durumları</h2>
                <div className="space-y-4">
                  {[
                    { label: 'İade Edildi', count: stats.returned_items, color: 'bg-red-500' },
                    { label: 'İade Talebi', count: stats.pending_items, color: 'bg-orange-500' },
                    { label: 'İptal Edildi', count: stats.cancelled_items, color: 'bg-gray-500' },
                  ].map(item => {
                    const total = stats.returned_items + stats.pending_items + stats.cancelled_items
                    const pct = total > 0 ? (item.count / total) * 100 : 0
                    return (
                      <div key={item.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-700">{item.label}</span>
                          <span className="font-medium text-gray-900">{item.count.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={clsx('h-full rounded-full', item.color)} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Monthly Trend */}
          {trend.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Aylık İade Trendi</h2>
              <div className="flex items-end gap-2 h-40">
                {trend.map(t => (
                  <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-red-500 hover:bg-red-600 rounded-t transition-colors cursor-default group relative"
                      style={{ height: `${Math.max((t.total_returns / maxTrend) * 100, 3)}%` }}
                      title={`${t.month}: ${t.total_returns} iade, ${formatCurrency(t.revenue_lost)} kayıp`}
                    >
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        {t.total_returns} iade / {formatCurrency(t.revenue_lost)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {trend.map(t => (
                  <div key={t.month} className="flex-1 text-center text-[10px] text-gray-400">
                    {t.month.slice(5)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Return Products */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ArrowDownRight size={18} className="text-red-600" />
              En Çok İade Edilen Ürünler
              <span className="text-xs text-gray-400 font-normal">(min. 10 satış)</span>
            </h2>
            {topProducts.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="pb-2 font-medium">Ürün</th>
                        <th className="pb-2 font-medium text-right">Satış</th>
                        <th className="pb-2 font-medium text-right">İade</th>
                        <th className="pb-2 font-medium text-right">Oran</th>
                        <th className="pb-2 font-medium text-right">Kayıp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map(p => (
                        <tr key={p.platform_product_id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2.5">
                            <div className="flex items-center gap-3">
                              {p.image_url ? (
                                <img src={p.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                  <Package size={16} className="text-gray-400" />
                                </div>
                              )}
                              <span className="font-medium text-gray-900 line-clamp-1">{p.product_name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-gray-600">{p.total_item_count.toLocaleString('tr-TR')}</td>
                          <td className="py-2.5 text-right text-gray-600">{p.return_item_count.toLocaleString('tr-TR')}</td>
                          <td className="py-2.5 text-right"><RateBadge rate={p.return_rate_pct} /></td>
                          <td className="py-2.5 text-right text-gray-600">{formatCurrency(p.return_revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {topProducts.length >= productLimit && (
                  <button
                    onClick={() => setProductLimit(prev => prev + 20)}
                    className="mt-4 w-full text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium py-2"
                  >
                    Daha Fazla Göster
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Veri bulunamadı</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
