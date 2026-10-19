import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import { Star, Save, CheckCircle, Copy, Check, Layout } from 'lucide-react'

/* ─── Widget Platform Presets ─── */
const WIDGET_PRESETS: Record<string, { label: string; selectors: Record<string, string> }> = {
  ticimax: {
    label: 'Ticimax',
    selectors: {
      review_widget_header_target: '#divUrunKodu',
      review_widget_insert_before: '#BenzerUrunDiv',
      review_widget_insert_fallback: '#divTabYorumlar,.urunOzellik,#divUrunOzellikAlani',
      review_widget_detail_container: '.product-detail,#urunDetay,.detay_sag,.detaySliderContainer,#divTabYorumlar',
      review_widget_listing_card: '.productItem,.product-item,.urunKutu',
      review_widget_listing_id_selector: '.detailLink[data-id],.detailUrl[data-id],.productDetail[data-id],.productName[data-id]',
      review_widget_listing_id_attr: 'data-id',
      review_widget_listing_badge_after: '.productName,.product-name,.urunAdi',
      review_widget_product_id_var: 'productDetailModel.productId',
    },
  },
  tsoft: {
    label: 'T-Soft',
    selectors: {
      review_widget_header_target: '.product-code,.productCode',
      review_widget_insert_before: '.similar-products,.benzerUrunler',
      review_widget_insert_fallback: '.product-tabs,.urunDetayTab,.product-description',
      review_widget_detail_container: '.product-detail-page,.productDetailPage,.detay_sag',
      review_widget_listing_card: '.product-card,.productCard,.product-item',
      review_widget_listing_id_selector: 'a[data-product-id],a[data-id],.product-card[data-id]',
      review_widget_listing_id_attr: 'data-product-id',
      review_widget_listing_badge_after: '.product-title,.productTitle,.product-name',
      review_widget_product_id_var: 'product.id',
    },
  },
  ideasoft: {
    label: 'IdeaSoft',
    selectors: {
      review_widget_header_target: '.product-code-holder,.product-sku',
      review_widget_insert_before: '.related-products,.relatedProducts',
      review_widget_insert_fallback: '#product-tabs,.product-tabs,.product-detail-tab',
      review_widget_detail_container: '.product-detail,.productDetail,.product-info',
      review_widget_listing_card: '.product-list-item,.product-item,.productItem',
      review_widget_listing_id_selector: '[data-product-id],[data-id],.product-item[data-id]',
      review_widget_listing_id_attr: 'data-product-id',
      review_widget_listing_badge_after: '.product-title,.product-name',
      review_widget_product_id_var: 'IdeasoftProduct.id',
    },
  },
  shopify: {
    label: 'Shopify',
    selectors: {
      review_widget_header_target: '.product__title,.product-single__title',
      review_widget_insert_before: '.product-recommendations,.related-products',
      review_widget_insert_fallback: '.product__description,.product-single__description,.product__info-container',
      review_widget_detail_container: '.product,.product-single,.product-template',
      review_widget_listing_card: '.product-card,.grid__item,.collection-product-card',
      review_widget_listing_id_selector: '[data-product-id],[data-id],.product-card[data-product-id]',
      review_widget_listing_id_attr: 'data-product-id',
      review_widget_listing_badge_after: '.product-card__title,.card__heading,.grid-product__title',
      review_widget_product_id_var: 'ShopifyAnalytics.meta.product.id',
    },
  },
  custom: {
    label: 'Ozel',
    selectors: {},
  },
}

const SELECTOR_FIELDS = [
  { key: 'review_widget_header_target', label: 'Yildiz Hedef Elementi', desc: 'Urun basliginda yildizlarin eklenecegi hedef element (CSS selector)' },
  { key: 'review_widget_insert_before', label: 'Widget Oncesi Element', desc: 'Widget bu elementin hemen oncesine eklenir (CSS selector)' },
  { key: 'review_widget_insert_fallback', label: 'Widget Fallback Elementi', desc: 'Birincil hedef bulunamazsa widget bu elementin sonrasina eklenir' },
  { key: 'review_widget_detail_container', label: 'Detay Sayfasi Container', desc: 'Urun detay sayfasini tanimlayan container selector(ler)' },
  { key: 'review_widget_listing_card', label: 'Listeleme Kart Selectoru', desc: 'Urun listeleme sayfasindaki kart elementleri' },
  { key: 'review_widget_listing_id_selector', label: 'Urun ID Selectoru', desc: 'Kart icindeki urun ID\'sini tasiyan element' },
  { key: 'review_widget_listing_id_attr', label: 'Urun ID Attribute', desc: 'Urun ID\'sinin bulundugu HTML attribute adi' },
  { key: 'review_widget_listing_badge_after', label: 'Badge Sonrasi Element', desc: 'Yildiz badge\'i bu elementin sonrasina eklenir' },
  { key: 'review_widget_product_id_var', label: 'JS Degisken Yolu', desc: 'Urun ID\'sini iceren JavaScript degisken yolu (ornek: productDetailModel.productId)' },
] as const

export default function ReviewWidgetSettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [tenantSettings, setTenantSettings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get('/settings')
      .then((res) => {
        setTenantSettings(res.data.settings || {})
      })
      .catch(() => {
        if (user?.tenant?.settings) {
          setTenantSettings(user.tenant.settings as Record<string, string>)
        }
      })
  }, [user])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { settings: tenantSettings })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const updateSetting = (key: string, value: string) => {
    setTenantSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handlePlatformChange = useCallback((platform: string) => {
    const preset = WIDGET_PRESETS[platform]
    if (!preset) return
    setTenantSettings((prev) => {
      const next: Record<string, string> = { ...prev, review_widget_platform: platform }
      if (platform !== 'custom' && preset.selectors) {
        for (const [key, value] of Object.entries(preset.selectors)) {
          next[key] = value
        }
      }
      return next
    })
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-gray-900">{t('reviewWidgetCommon.title')}</h1>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Star size={18} /> {t('reviewWidgetCommon.widgetSettings')}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('reviewWidgetCommon.widgetActive')}</label>
              <p className="text-xs text-gray-500">{t('reviewWidgetCommon.widgetActiveDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => updateSetting('review_widget_enabled', tenantSettings.review_widget_enabled === 'true' ? 'false' : 'true')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${tenantSettings.review_widget_enabled === 'true' ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tenantSettings.review_widget_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {tenantSettings.review_widget_enabled === 'true' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('reviewWidgetCommon.negativeReductionRate')}</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tenantSettings.review_negative_reduction || '65'}
                  onChange={(e) => updateSetting('review_negative_reduction', e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">{t('reviewWidgetCommon.negativeReductionDesc')}</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('reviewWidgetCommon.fullHideLowRated')}</label>
                  <p className="text-xs text-gray-500">{t('reviewWidgetCommon.fullHideDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSetting('review_auto_full_hide', tenantSettings.review_auto_full_hide === 'false' ? 'true' : 'false')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${tenantSettings.review_auto_full_hide !== 'false' ? 'bg-indigo-600' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tenantSettings.review_auto_full_hide !== 'false' ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {tenantSettings.review_auto_full_hide !== 'false' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('reviewWidgetCommon.fullHideThreshold')}</label>
                  <input
                    type="number"
                    min={1.0}
                    max={5.0}
                    step={0.1}
                    value={tenantSettings.review_auto_full_hide_threshold || '2.5'}
                    onChange={(e) => updateSetting('review_auto_full_hide_threshold', e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('reviewWidgetCommon.fullHideThresholdDesc')}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('reviewWidgetCommon.allowedDomains')}</label>
                <input
                  type="text"
                  value={tenantSettings.review_widget_domains || ''}
                  onChange={(e) => updateSetting('review_widget_domains', e.target.value)}
                  placeholder="www.magazaniz.com, magazaniz.com"
                  className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">{t('reviewWidgetCommon.allowedDomainsDesc')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('reviewWidgetCommon.embedCode')}</label>
                <div className="relative">
                  <textarea
                    readOnly
                    rows={3}
                    value={`<script src="https://hub.yunbi.ai/widget/reviews.js"\n        data-tenant="${user?.tenant?.slug || 'TENANT_SLUG'}"\n        data-mode="auto"></script>`}
                    className="w-full max-w-lg px-3 py-2 pr-10 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`<script src="https://hub.yunbi.ai/widget/reviews.js"\n        data-tenant="${user?.tenant?.slug || 'TENANT_SLUG'}"\n        data-mode="auto"></script>`)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 rounded"
                    title={t('feedCommon.copy')}
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Bu kodu sitenizin {'<head>'} veya {'<body>'} etiketine ekleyin.</p>
              </div>

              {/* Widget Placement / Selector Config */}
              <div className="border-t border-gray-100 pt-4 mt-4">
                <h3 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                  <Layout size={16} /> {t('reviewWidgetCommon.widgetPlacement')}
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  {t('reviewWidgetCommon.widgetPlacementDesc')}
                </p>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('reviewWidgetCommon.platform')}</label>
                  <select
                    value={tenantSettings.review_widget_platform || 'ticimax'}
                    onChange={(e) => handlePlatformChange(e.target.value)}
                    className="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {Object.entries(WIDGET_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>{preset.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {(tenantSettings.review_widget_platform || 'ticimax') !== 'custom'
                      ? 'Secilen platforma uygun selector\'lar otomatik ayarlanir. Gerekirse asagidan duzenleyebilirsiniz.'
                      : 'Tum selector alanlari manuel olarak girilmelidir.'}
                  </p>
                </div>

                <div className="space-y-3">
                  {SELECTOR_FIELDS.map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <input
                        type="text"
                        value={tenantSettings[field.key] || ''}
                        onChange={(e) => updateSetting(field.key, e.target.value)}
                        placeholder={WIDGET_PRESETS.ticimax.selectors[field.key as keyof typeof WIDGET_PRESETS.ticimax.selectors] || ''}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <p className="mt-0.5 text-xs text-gray-400">{field.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="pt-2 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Save size={16} />
              {saving ? t('common.saving') : t('common.save')}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle size={16} /> {t('common.saved')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
