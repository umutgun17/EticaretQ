import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import { Truck, Save, CheckCircle, Copy, Check } from 'lucide-react'

/* "Bugün Kargoda" widget'ı — kargo cutoff geri sayacı ayarları.
   Ayarlar tenants.settings düz anahtarlarında tutulur (review widget ile aynı model). */

const DAYS = [
  { iso: 1, label: 'Pazartesi' },
  { iso: 2, label: 'Salı' },
  { iso: 3, label: 'Çarşamba' },
  { iso: 4, label: 'Perşembe' },
  { iso: 5, label: 'Cuma' },
  { iso: 6, label: 'Cumartesi' },
  { iso: 7, label: 'Pazar' },
]

// Gün-bazlı kesim satırı: off = o gün kargo yok; same = kesim aynı gün HH:MM;
// prev = kesim ÖNCEKİ gün HH:MM (ör. Cumartesi kargosu için Cuma 23:59'a kadar sipariş)
type DayCut = { mode: 'off' | 'same' | 'prev'; t: string }

export default function ShippingWidgetSettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [tenantSettings, setTenantSettings] = useState<Record<string, string>>({})
  const [tenantSlug, setTenantSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get('/settings')
      .then((res) => {
        setTenantSettings(res.data.settings || {})
        // Süper-admin tenant değiştirince de doğru slug gelsin diye API yanıtı esas alınır
        if (res.data.tenant?.slug) setTenantSlug(res.data.tenant.slug)
      })
      .catch(() => {
        if (user?.tenant?.settings) setTenantSettings(user.tenant.settings as Record<string, string>)
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

  const enabled = tenantSettings.shipping_widget_enabled === 'true'
  const urgentMin = tenantSettings.shipping_urgent_minutes || '60'

  // Tek doğruluk kaynağı tenantSettings.shipping_day_cutoffs (JSON string); yoksa
  // eski cutoff+günler+Cuma-istisnası ayarlarından türetilir (ilk kayıtta JSON'a döner).
  const dayCuts: Record<number, DayCut> = (() => {
    const out: Record<number, DayCut> = {}
    DAYS.forEach((d) => { out[d.iso] = { mode: 'off', t: tenantSettings.shipping_cutoff_time || '16:00' } })
    try {
      const raw = JSON.parse(tenantSettings.shipping_day_cutoffs || '')
      if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
        for (const [k, v] of Object.entries(raw as Record<string, { t?: string; prev?: boolean }>)) {
          const iso = parseInt(k, 10)
          if (iso >= 1 && iso <= 7 && v?.t) out[iso] = { mode: v.prev ? 'prev' : 'same', t: v.t }
        }
        return out
      }
    } catch { /* JSON yok/bozuk → eski ayarlardan türet */ }
    const cutoff = tenantSettings.shipping_cutoff_time || '16:00'
    ;(tenantSettings.shipping_days || '1,2,3,4,5,6')
      .split(',').map((d) => parseInt(d, 10)).filter((d) => d >= 1 && d <= 7)
      .forEach((d) => { out[d] = { mode: 'same', t: cutoff } })
    if (tenantSettings.shipping_friday_extension === 'true') out[6] = { mode: 'prev', t: '23:59' }
    return out
  })()

  const setDayCut = (iso: number, patch: Partial<DayCut>) => {
    const next = { ...dayCuts, [iso]: { ...dayCuts[iso], ...patch } }
    const obj: Record<string, { t: string; prev: boolean }> = {}
    DAYS.forEach((d) => {
      const c = next[d.iso]
      if (c.mode !== 'off') obj[String(d.iso)] = { t: c.t, prev: c.mode === 'prev' }
    })
    if (Object.keys(obj).length === 0) return // en az bir kargo günü kalmalı
    updateSetting('shipping_day_cutoffs', JSON.stringify(obj))
  }

  // DİKKAT: shipping.js her değiştiğinde v artmalı — Cloudflare edge TTL origin max-age'i
  // ezdiğinden eski sürüm saatlerce serve edilebiliyor (çark v=7 dersi).
  const embedCode = `<script src="https://hub.yunbi.ai/widget/shipping.js?v=4"\n        data-tenant="${tenantSlug || user?.tenant?.slug || 'TENANT_SLUG'}"\n        async crossorigin="anonymous"></script>`

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-gray-900">Kargo Bildirimi</h1>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Truck size={18} /> Widget Ayarları
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Ürün detay sayfasında, fiyatın hemen altında "X sa Y dk içinde sipariş verirsen bugün kargoda!"
          geri sayacı gösterir. Saat sunucudan alınır; kargo saatinden sonra otomatik olarak
          "yarın kargoda" / bir sonraki kargo gününe döner.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700">Widget Aktif</label>
              <p className="text-xs text-gray-500">Kapalıyken widget hiçbir sayfada görünmez.</p>
            </div>
            <button
              type="button"
              onClick={() => updateSetting('shipping_widget_enabled', enabled ? 'false' : 'true')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kargo Günleri ve Kesim Saatleri</label>
                <p className="text-xs text-gray-500 mb-2">
                  Her kargo günü için sipariş kesim saatini ayrı girin (Türkiye saati). Sayaç kesim
                  saatine geri sayar — gerçekçi saatler girin, tutamayacağınız söz güven kaybettirir.
                  <b> "Önceki gün"</b>: o günün kargosuna çıkacak siparişler bir önceki gün girilen
                  saate kadar alınır — ör. Cumartesi = önceki gün 23:59 → Cuma gece yarısına kadar
                  "yarın kargoda!" sayacı, Cumartesi'ye geçince "Pazartesi günü kargoda!".
                </p>
                <div className="space-y-1.5 max-w-md">
                  {DAYS.map((d) => {
                    const c = dayCuts[d.iso]
                    return (
                      <div key={d.iso} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.mode === 'off' ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>
                        <span className={`w-24 text-sm font-medium ${c.mode === 'off' ? 'text-gray-400' : 'text-gray-700'}`}>{d.label}</span>
                        <select
                          value={c.mode}
                          onChange={(e) => setDayCut(d.iso, { mode: e.target.value as DayCut['mode'] })}
                          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="off">Kargo yok</option>
                          <option value="same">Kesim aynı gün</option>
                          <option value="prev">Kesim önceki gün</option>
                        </select>
                        {c.mode !== 'off' && (
                          <input
                            type="time"
                            value={c.t}
                            onChange={(e) => e.target.value && setDayCut(d.iso, { t: e.target.value })}
                            className="w-28 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        )}
                        {c.mode === 'prev' && (
                          <span className="text-xs text-gray-400">
                            {DAYS[(d.iso + 5) % 7].label} {c.t}'a kadar sipariş
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Kargo olmayan günlerde sayaç bir sonraki kargo gününü gösterir:
                  "Şimdi sipariş verirsen Pazartesi günü kargoda!"
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aciliyet Eşiği (dakika)</label>
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={urgentMin}
                  onChange={(e) => updateSetting('shipping_urgent_minutes', e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">Kalan süre bu eşiğin altına inince sayaç turuncu "son dakika" görünümüne geçer.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">İzinli Domainler</label>
                <input
                  type="text"
                  value={tenantSettings.shipping_widget_domains || ''}
                  onChange={(e) => updateSetting('shipping_widget_domains', e.target.value)}
                  placeholder="www.magazaniz.com, magazaniz.com"
                  className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">Virgülle ayırın. Boş bırakılırsa widget hiçbir sitede çalışmaz (güvenlik).</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Yerleşim Selector'ü (opsiyonel)</label>
                <input
                  type="text"
                  value={tenantSettings.shipping_widget_selector || ''}
                  onChange={(e) => updateSetting('shipping_widget_selector', e.target.value)}
                  placeholder="before:#divSatinAl (boşsa Ticimax varsayılanları denenir)"
                  className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">"before:SEL" elementin önüne, "after:SEL" arkasına ekler (çıplak selector = arkasına). Boş bırakın: sepet butonu bloğunun önü otomatik bulunur.</p>
              </div>

              {/* Önizleme — widget'la aynı görünüm, statik örnek */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Önizleme</label>
                <div className="max-w-md space-y-2">
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[13px]" style={{ background: '#f0faf4', border: '1px solid #b7e4c7', color: '#14532d' }}>
                    <Truck size={20} className="flex-none" />
                    <span><b>2 sa 14 dk</b> içinde sipariş verirsen <b>bugün kargoda!</b></span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[13px]" style={{ background: '#fff4ec', border: '1px solid #fdc9a5', color: '#9a3412' }}>
                    <Truck size={20} className="flex-none" />
                    <span><b>42 dk</b> içinde sipariş verirsen <b>bugün kargoda!</b></span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[13px]" style={{ background: '#f4f7fb', border: '1px solid #d5e0ef', color: '#1e3a5f' }}>
                    <Truck size={20} className="flex-none" />
                    <span>Şimdi sipariş verirsen <b>yarın kargoda!</b></span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gömme Kodu</label>
                <div className="relative">
                  <textarea
                    readOnly
                    rows={3}
                    value={embedCode}
                    className="w-full max-w-lg px-3 py-2 pr-10 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(embedCode)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 rounded"
                    title={t('feedCommon.copy')}
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Bu kodu sitenizin {'<head>'} veya {'<body>'} etiketine ekleyin. Sayaç yalnızca ürün detay sayfalarında görünür.</p>
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
