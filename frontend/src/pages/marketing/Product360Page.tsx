import { Rotate3d, ExternalLink, FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const DEMO_URL = '/widget/360/video360.html'

export default function Product360Page() {
  const { t } = useTranslation()
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <Rotate3d size={20} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-extrabold text-gray-900">{t('product360.title')}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
              <FlaskConical size={11} />
              {t('product360.demoBadge')}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{t('product360.desc')}</p>
        </div>
        <a
          href={DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg shrink-0"
        >
          <ExternalLink size={15} />
          {t('product360.openNewTab')}
        </a>
      </div>
      <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
        <iframe
          src={DEMO_URL}
          title={t('product360.title')}
          className="w-full h-full min-h-[720px] border-0"
        />
      </div>
    </div>
  )
}
