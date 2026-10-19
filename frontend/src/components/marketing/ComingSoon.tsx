import { Hammer } from 'lucide-react'
import type { ReactNode } from 'react'

export default function ComingSoon({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {icon}
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 inline-flex items-center gap-1">
          <Hammer size={11} /> Yapım aşamasında
        </span>
      </div>
      <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <Hammer size={22} className="text-amber-500" />
        </div>
        <p className="text-gray-600 text-sm max-w-md mx-auto">{desc}</p>
        <p className="text-gray-400 text-xs mt-3">Bu modül sırada — sepet kurtarma kurgusu tamamlandı, sonraki adımlarda devreye alınacak.</p>
      </div>
    </div>
  )
}
