import { FileBarChart2 } from 'lucide-react'

/**
 * İade Yönetimi → İptal/İade Raporu (kullanıcı kararı 2026-07-21): şimdilik boş —
 * Tonny Black tenant'ında iadeler biriktikçe burada raporlama sayfası yapılacak.
 */
export default function ReturnsInsightsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2 mb-5">
        <FileBarChart2 size={22} /> İptal/İade Raporu
      </h1>

      <div className="bg-white rounded-lg border border-gray-200 px-6 py-16 text-center">
        <FileBarChart2 className="mx-auto mb-4 text-gray-300" size={48} />
        <div className="text-gray-700 font-medium mb-1">Raporlama çok yakında</div>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          İade ve iptal talepleri biriktikçe bu sayfada sebep, ürün, tutar ve süreç
          performansı kırılımlarıyla detaylı raporlama sunulacak.
        </p>
      </div>
    </div>
  )
}
