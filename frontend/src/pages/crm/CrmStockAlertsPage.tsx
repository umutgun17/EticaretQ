import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { BellRing, ChevronDown, Package, Save, Settings, Copy, Check } from 'lucide-react'

/* "Gelince Haber Ver" — ürün bazında bekleyen talepler + kişi listesi. */

interface Row {
  platform_product_id: string
  product_id: number | null
  product_name: string
  image: string | null
  stock_quantity: number | null
  active_count: number
  notified_count: number
  last_request_at: string | null
}

interface AlertItem {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  variant_label: string | null
  status: string
  notified_at: string | null
  created_at: string
  customer: { id: number; name: string | null; surname: string | null; email: string | null; phone: string | null } | null
}

export default function CrmStockAlertsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, AlertItem[]>>({})

  // Ayarlar (tenants.settings düz anahtarları — announce ile aynı model)
  const { user } = useAuth()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [copied, setCopied] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    api.get('/settings').then((res) => {
      setSettings(res.data.settings || {})
      if (res.data.tenant?.slug) setSlug(res.data.tenant.slug)
    }).catch(() => undefined)
    api.get<Row[]>('/crm/stock-alerts').then((res) => {
      setRows(res.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const toggle = (pid: string) => {
    if (open === pid) { setOpen(null); return }
    setOpen(pid)
    if (!detail[pid]) {
      api.get<AlertItem[]>(`/crm/stock-alerts/${pid}`).then((res) =>
        setDetail((prev) => ({ ...prev, [pid]: res.data }))
      )
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await api.put('/settings', { settings })
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const enabled = settings.stock_alert_widget_enabled === 'true'
  const embed = `<script src="https://hub.yunbi.ai/widget/stock-alert.js?v=2"\n        data-tenant="${slug || user?.tenant?.slug || 'TENANT_SLUG'}" async></script>`

  if (loading) {
    return <div className="p-12 text-center text-gray-500">Yükleniyor…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
          <BellRing size={22} className="text-indigo-600" /> Gelince Haber Ver
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Tükenen ürünler için müşterilerin bıraktığı bildirim talepleri. Stok gelince SMS otomatik gider;
          bekleyen sayısı yüksek ürünler tedarik için güçlü bir taleptir.
        </p>
      </div>

      {/* Ayarlar — varsayılan kapalı, başlığa tıklayınca açılır */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-semibold text-gray-900 flex items-center gap-2"><Settings size={16} /> Ayarlar</span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
        </button>

        {settingsOpen && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-700">Widget Aktif</div>
            <p className="text-xs text-gray-500">Kapalıyken mağazadaki buton talep kabul etmez.</p>
          </div>
          <button
            type="button"
            onClick={() => setSettings((p) => ({ ...p, stock_alert_widget_enabled: enabled ? 'false' : 'true' }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">İzinli Domainler</label>
          <input
            value={settings.stock_alert_widget_domains || ''}
            onChange={(e) => setSettings((p) => ({ ...p, stock_alert_widget_domains: e.target.value }))}
            placeholder="www.magazaniz.com, magazaniz.com"
            className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">Virgülle ayırın. Buton yalnızca bu alan adlarından çağrılabilir (güvenlik).</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tema Buton Seçicisi (CSS)</label>
          <input
            value={settings.stock_alert_selector || ''}
            onChange={(e) => setSettings((p) => ({ ...p, stock_alert_selector: e.target.value }))}
            placeholder='.sold-out-notify, button.gelince-haber-ver'
            className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Temadaki mevcut "tükendi / gelince haber ver" butonunun seçicisi. Script bu butona tıklamayı yakalar,
            kendi e-posta/telefon formunu açar ve ürünü sayfadan otomatik tespit eder — temada başka değişiklik gerekmez.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gömme Kodu</label>
          <div className="relative">
            <textarea readOnly rows={2} value={embed}
              className="w-full max-w-lg px-3 py-2 pr-10 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none" />
            <button type="button" className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
              onClick={() => { navigator.clipboard.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Temaya bir kez eklenir; ürün sayfasındaki formda <code className="bg-gray-100 px-1 rounded">data-yunbi-stock-alert="ÜRÜN_ID"</code> kullanılır
            veya <code className="bg-gray-100 px-1 rounded">YunbiStockAlert.subscribe()</code> çağrılır.
          </p>
        </div>

        <div className="flex justify-end">
          <button onClick={saveSettings} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">
            {savedOk ? <Check size={14} /> : <Save size={14} />}
            {saving ? 'Kaydediliyor…' : savedOk ? 'Kaydedildi' : 'Kaydet'}
          </button>
        </div>
        </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-500">
          Henüz talep yok. Mağazaya "Gelince Haber Ver" butonu eklendiğinde talepler burada birikecek.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.platform_product_id}>
              <button onClick={() => toggle(r.platform_product_id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left">
                {r.image
                  ? <img src={r.image} className="w-10 h-10 rounded object-cover bg-gray-100" />
                  : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center"><Package size={16} className="text-gray-400" /></div>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{r.product_name}</div>
                  <div className="text-xs text-gray-500">
                    Stok: {r.stock_quantity ?? '—'} · Bildirilen: {r.notified_count}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                  {r.active_count} bekleyen
                </span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${open === r.platform_product_id ? 'rotate-180' : ''}`} />
              </button>

              {open === r.platform_product_id && (
                <div className="px-4 pb-3">
                  {!detail[r.platform_product_id] ? (
                    <div className="text-xs text-gray-400 py-2">Yükleniyor…</div>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody>
                        {detail[r.platform_product_id].map((a) => (
                          <tr key={a.id} className="border-t border-gray-50">
                            <td className="py-1.5 pr-3 text-gray-800">
                              {a.customer ? `${a.customer.name ?? ''} ${a.customer.surname ?? ''}`.trim() || a.name || '—' : (a.name || '—')}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-500">{a.email || a.phone || '—'}</td>
                            <td className="py-1.5 pr-3 text-gray-400">{a.variant_label || ''}</td>
                            <td className="py-1.5 text-right">
                              <span className={`px-2 py-0.5 rounded-full ${a.status === 'active' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                                {a.status === 'active' ? 'Bekliyor' : 'Bildirildi'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
