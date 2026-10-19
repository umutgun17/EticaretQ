import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileBarChart } from 'lucide-react'
import { returnsAdminApi, fmtMoney, type ReturnReport } from '@/lib/returnsAdminApi'

/** İade/İptal mutabakat raporu (finans özeti) — tarih aralığı + tür/durum/yöntem kırılımı. */
export default function ReturnsReportPage() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [data, setData] = useState<ReturnReport | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await returnsAdminApi.report({ from, to }))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/returns" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Listeye dön
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2"><FileBarChart size={20} /> İade / İptal Finans Özeti</h1>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1" />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1" />
        </div>
      </div>

      {loading || !data ? (
        <div className="text-gray-400">Yükleniyor...</div>
      ) : (
        <div className="space-y-6">
          {/* Özet kartları */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Toplam talep" value={String(data.total.count)} />
            <Card label="İptal / İade" value={`${data.by_type.cancel.count} / ${data.by_type.return.count}`} />
            <Card label="Onaylanan tutar" value={fmtMoney(data.total.approved)} />
            <Card label="İade edilen tutar" value={fmtMoney(data.total.refunded)} />
          </div>

          {/* Durum kırılımı */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-700 px-4 py-3 border-b">Durum Bazlı</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Durum</th>
                  <th className="px-4 py-2 font-medium text-center">Adet</th>
                  <th className="px-4 py-2 font-medium text-right">Talep</th>
                  <th className="px-4 py-2 font-medium text-right">Onaylanan</th>
                  <th className="px-4 py-2 font-medium text-right">İade edilen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.by_status.map((s) => (
                  <tr key={s.status}>
                    <td className="px-4 py-2 text-gray-800">{s.label}</td>
                    <td className="px-4 py-2 text-center tabular-nums">{s.count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.requested)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.approved)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.refunded)}</td>
                  </tr>
                ))}
                {data.by_status.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Bu aralıkta kayıt yok.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold text-gray-800">
                <tr>
                  <td className="px-4 py-2">Toplam</td>
                  <td className="px-4 py-2 text-center tabular-nums">{data.total.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(data.total.requested)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(data.total.approved)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(data.total.refunded)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* İade yöntemi kırılımı */}
          {data.by_refund_method.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700 px-4 py-3 border-b">İade Yöntemi Bazlı (onaylanan)</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {data.by_refund_method.map((m) => (
                    <tr key={m.method}>
                      <td className="px-4 py-2 text-gray-800">{m.method === 'store_credit' ? 'İndirim kodu' : m.method === 'original' ? 'Karta iade' : m.method}</td>
                      <td className="px-4 py-2 text-center tabular-nums">{m.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(m.approved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}
