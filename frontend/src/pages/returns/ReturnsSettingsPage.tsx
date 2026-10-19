import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import { Settings, Save, CheckCircle, Loader2, Eye, EyeOff, Globe, AlertTriangle } from 'lucide-react'

// İade ürününün kendi ayar sayfası — Genel Ayarlar'dan taşındı (ürün-bazlı SaaS yapısı).
// Veri sözleşmesi aynı: tenant.settings.returns + tenant.settings.returns_integrations

type Intg = {
  sms: { enabled: boolean; dry_run: boolean; msgheader: string }
  // Talep kodu önekleri: önek + 8 rakam (örn. tba48291037). Boş = varsayılan IADE-XXXXXXXX.
  code_prefixes: { return: string; cancel: string; defect: string; shortage: string; returned: string }
  // Tenant'ın iade kargo firması: 'surat-kargo' | 'dhl-kargo' (CargoProviderFactory bunu okur).
  cargo_provider: string
  surat_kargo: {
    enabled: boolean; dry_run: boolean; username: string; password: string
    merchant: { name: string; phone: string; email: string; address: string; city: string; district: string; code: string }
  }
  dhl_kargo: {
    enabled: boolean; dry_run: boolean; test_mode: boolean
    client_id: string; client_secret: string; customer_number: string; password: string
  }
  // ERP & sipariş entegrasyonu (iptal belgesi + platform statü yazımı)
  nebim: { enabled: boolean; dry_run: boolean }
  ticimax: { enabled: boolean; dry_run: boolean; notify_customer: boolean }
  // Para iadesi (Faz 4): genel anahtar + indirim kodu + karta iade sağlayıcı kimlikleri
  refund: {
    enabled: boolean; dry_run: boolean
    store_credit: { valid_days: number; code_prefix: string; grup_adi: string }
    original: {
      enabled: boolean; dry_run: boolean
      iyzico: { api_key: string; secret_key: string }
      paytr: { merchant_id: string; merchant_key: string; merchant_salt: string }
    }
  }
  // Eksik/hatalı ürün iadesi (personel başlatır): özür kuponu + Ticimax kalem/not ayarları
  shortage: {
    coupon_enabled: boolean; coupon_amount: number; coupon_days: number; coupon_prefix: string
    coupon_grup_adi: string; coupon_min_amount: number; coupon_free_shipping: boolean
    item_durum_id: number; item_islem: number; note_field: number
  }
}
// DİKKAT: bool/sayı varsayılanları backend config/returns.php etkin varsayılanlarıyla uyumlu
// (kayıt yokken form bunları gösterir ve kaydedince açıkça yazar).
const emptyIntg: Intg = {
  sms: { enabled: false, dry_run: true, msgheader: '' },
  code_prefixes: { return: '', cancel: '', defect: '', shortage: '', returned: '' },
  cargo_provider: 'surat-kargo',
  surat_kargo: { enabled: false, dry_run: true, username: '', password: '', merchant: { name: '', phone: '', email: '', address: '', city: '', district: '', code: '' } },
  dhl_kargo: { enabled: false, dry_run: true, test_mode: false, client_id: '', client_secret: '', customer_number: '', password: '' },
  nebim: { enabled: false, dry_run: true },
  ticimax: { enabled: false, dry_run: true, notify_customer: false },
  refund: {
    enabled: false, dry_run: true,
    store_credit: { valid_days: 180, code_prefix: 'IADE', grup_adi: 'İade Bakiyesi' },
    original: { enabled: false, dry_run: true, iyzico: { api_key: '', secret_key: '' }, paytr: { merchant_id: '', merchant_key: '', merchant_salt: '' } },
  },
  shortage: {
    coupon_enabled: true, coupon_amount: 100, coupon_days: 90, coupon_prefix: 'OZUR',
    coupon_grup_adi: 'Özür Kuponu', coupon_min_amount: 0, coupon_free_shipping: false,
    item_durum_id: 0, item_islem: 0, note_field: 0,
  },
}

/** Boş string'leri PUT'tan ayıkla: tenant'ta olmayan opsiyonel metin alanı '' olarak
 *  kaydedilirse config varsayılanını ezer (SettingsController sanitize '' kabul eder). */
function stripEmptyStrings<T>(obj: T): T {
  if (Array.isArray(obj)) return obj
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() === '') continue
      out[k] = typeof v === 'object' && v !== null ? stripEmptyStrings(v) : v
    }
    return out as T
  }
  return obj
}

type Rules = {
  return_enabled: boolean; cancel_enabled: boolean
  return_window_days: number; manager_review_hours: number; shipment_expire_days: number
  refund_shipping: boolean; refund_shipping_cancel: boolean; refund_installment_fee: boolean; campaign_discount_recovery: boolean
  allow_store_credit: boolean; allow_original_refund: boolean
  defect_enabled: boolean; defect_max_days: number; defect_reject_reasons: string[]
}
// DİKKAT: backend config/returns.php default_rules ile AYNI olmalı — kayıt yokken form bu
// değerleri gösterir; uyumsuzluk "panel 14 / motor 30" türü yanılgı üretir (24 Tem olayı).
const emptyRules: Rules = {
  return_enabled: true, cancel_enabled: true,
  return_window_days: 30, manager_review_hours: 48, shipment_expire_days: 14,
  refund_shipping: false, refund_shipping_cancel: true, refund_installment_fee: true, campaign_discount_recovery: false,
  allow_store_credit: true, allow_original_refund: true,
  defect_enabled: false, defect_max_days: 365,
  defect_reject_reasons: [
    'Kullanım kaynaklı aşınma/yıpranma tespit edildi',
    'Üretim kusuru tespit edilemedi',
    'Fotoğraflar değerlendirme için yetersiz',
    'Ürün garanti/değerlendirme kapsamı dışında',
  ],
}

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const checkCls = 'rounded border-gray-300 text-indigo-600'

export default function ReturnsSettingsPage() {
  const { t } = useTranslation()
  const [intg, setIntg] = useState<Intg>(emptyIntg)
  const [intgSaving, setIntgSaving] = useState(false)
  const [intgSaved, setIntgSaved] = useState(false)
  const [showSuratPw, setShowSuratPw] = useState(false)
  const [showDhlSecret, setShowDhlSecret] = useState(false)
  const [showDhlPw, setShowDhlPw] = useState(false)
  const [rules, setRules] = useState<Rules>(emptyRules)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesSaved, setRulesSaved] = useState(false)
  // Ayarlar yüklenemezse form VARSAYILANLARI gösterir — bu yanıltıcıdır ve kayıt
  // varsayılanları yazar. Hata durumunda uyarı göster + kaydetmeyi kilitle.
  const [loadError, setLoadError] = useState(false)
  const [tenantName, setTenantName] = useState('')

  useEffect(() => {
    api.get('/settings').then((res) => {
      setTenantName(res.data.tenant?.name || '')
      const s = res.data.settings || {}
      const ri = (s as { returns_integrations?: Partial<Intg> }).returns_integrations
      if (ri) {
        setIntg({
          sms: { ...emptyIntg.sms, ...(ri.sms ?? {}) },
          code_prefixes: { ...emptyIntg.code_prefixes, ...(ri.code_prefixes ?? {}) },
          cargo_provider: ri.cargo_provider || emptyIntg.cargo_provider,
          surat_kargo: {
            ...emptyIntg.surat_kargo,
            ...(ri.surat_kargo ?? {}),
            merchant: { ...emptyIntg.surat_kargo.merchant, ...(ri.surat_kargo?.merchant ?? {}) },
          },
          dhl_kargo: { ...emptyIntg.dhl_kargo, ...(ri.dhl_kargo ?? {}) },
          nebim: { ...emptyIntg.nebim, ...(ri.nebim ?? {}) },
          ticimax: { ...emptyIntg.ticimax, ...(ri.ticimax ?? {}) },
          refund: {
            ...emptyIntg.refund,
            ...(ri.refund ?? {}),
            store_credit: { ...emptyIntg.refund.store_credit, ...(ri.refund?.store_credit ?? {}) },
            original: {
              ...emptyIntg.refund.original,
              ...(ri.refund?.original ?? {}),
              iyzico: { ...emptyIntg.refund.original.iyzico, ...(ri.refund?.original?.iyzico ?? {}) },
              paytr: { ...emptyIntg.refund.original.paytr, ...(ri.refund?.original?.paytr ?? {}) },
            },
          },
          shortage: { ...emptyIntg.shortage, ...(ri.shortage ?? {}) },
        })
      }
      const rr = (s as { returns?: Partial<Rules> }).returns
      if (rr) setRules({ ...emptyRules, ...rr })
    }).catch(() => setLoadError(true))
  }, [])

  const saveIntegrations = async () => {
    setIntgSaving(true)
    setIntgSaved(false)
    try {
      // code_prefixes stripEmptyStrings'ten muaf: '' göndermek BİLİNÇLİ "varsayılana dön" demek
      // (sanitize '' kabul eder); stripten geçse boş alan temizlenemezdi.
      const payload = { ...stripEmptyStrings(intg), code_prefixes: intg.code_prefixes }
      await api.put('/settings', { settings: { returns_integrations: payload } })
      setIntgSaved(true)
      setTimeout(() => setIntgSaved(false), 3000)
    } finally {
      setIntgSaving(false)
    }
  }
  const setMerchant = (f: keyof Intg['surat_kargo']['merchant'], v: string) =>
    setIntg((p) => ({ ...p, surat_kargo: { ...p.surat_kargo, merchant: { ...p.surat_kargo.merchant, [f]: v } } }))

  const saveRules = async () => {
    setRulesSaving(true)
    setRulesSaved(false)
    try {
      await api.put('/settings', { settings: { returns: rules } })
      setRulesSaved(true)
      setTimeout(() => setRulesSaved(false), 3000)
    } finally {
      setRulesSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-extrabold text-gray-900">İade Ayarları</h1>
        {tenantName && <span className="text-sm text-gray-500">Firma: <strong className="text-gray-700">{tenantName}</strong></span>}
      </div>

      {loadError && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-4">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <strong>Ayarlar yüklenemedi</strong> — aşağıda görünen değerler firmanın gerçek ayarları değil,
            formun varsayılanlarıdır. Sağ üstten doğru firmanın seçili olduğundan emin olup sayfayı yenileyin.
            Kaydetme bu durumda kilitlidir.
          </div>
        </div>
      )}

      {/* İade Kuralları */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Settings size={18} /> İade / İptal Kuralları
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Müşterinin web üzerinden iptal/iade talebi oluşturma koşulları. Tutar/gün değerleri güvenli aralıklara sabitlenir.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.return_enabled} onChange={(e) => setRules((p) => ({ ...p, return_enabled: e.target.checked }))} className={checkCls} />
            İade talepleri açık
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.cancel_enabled} onChange={(e) => setRules((p) => ({ ...p, cancel_enabled: e.target.checked }))} className={checkCls} />
            İptal talepleri açık
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">İade süresi (gün)</label>
            <input type="number" min={0} max={365} value={rules.return_window_days}
              onChange={(e) => setRules((p) => ({ ...p, return_window_days: Number(e.target.value) }))}
              className={inputCls} />
            <p className="mt-1 text-xs text-gray-500">
              <strong>Sipariş tarihinden</strong> itibaren iade talebi penceresi (teslim tarihinden değil).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kargo kodu geçerlilik süresi (gün)</label>
            <input type="number" min={1} max={60} value={rules.shipment_expire_days}
              onChange={(e) => setRules((p) => ({ ...p, shipment_expire_days: Number(e.target.value) }))}
              className={inputCls} />
            <p className="mt-1 text-xs text-gray-500">
              Müşteri iade kargo kodunu bu süre içinde kullanmazsa kod iptal edilir, talep kapatılır ve müşteriye SMS gönderilir.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Depo inceleme süresi (gün)</label>
            <input type="number" min={1} max={30} value={Math.round(rules.manager_review_hours / 24)}
              onChange={(e) => setRules((p) => ({ ...p, manager_review_hours: Math.max(1, Number(e.target.value)) * 24 }))}
              className={inputCls} />
            <p className="mt-1 text-xs text-gray-500">İade depoya ulaştığında personel onay sayacı.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.refund_shipping} onChange={(e) => setRules((p) => ({ ...p, refund_shipping: e.target.checked }))} className={checkCls} />
            Kargo ücreti iadeye dahil (tam iade)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.refund_shipping_cancel} onChange={(e) => setRules((p) => ({ ...p, refund_shipping_cancel: e.target.checked }))} className={checkCls} />
            İPTALLERDE kargo ücreti iadeye dahil
          </label>
          <p className="-mt-1 text-xs text-gray-500">Sipariş kargoya verilmeden iptal edildiği için kargo ücreti müşteriden kesilmez. Yukarıdaki ayar yalnızca normal iadeler için geçerlidir.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.refund_installment_fee} onChange={(e) => setRules((p) => ({ ...p, refund_installment_fee: e.target.checked }))} className={checkCls} />
            Taksit vade farkı iadeye dahil (tam iade/iptal)
          </label>
          <p className="-mt-1 text-xs text-gray-500">Taksitli ödemede iyzico vade farkını ürün tutarlarının üstüne ekler. Bu ayar açıkken tam iade/iptalde vade farkı da müşteriye iade edilir (yasal olarak cayma iadesinde tahsil edilen tüm tutarın iadesi gerekir). Kısmi iadeleri etkilemez.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rules.campaign_discount_recovery} onChange={(e) => setRules((p) => ({ ...p, campaign_discount_recovery: e.target.checked }))} className={checkCls} />
            Sepet kampanyası telafisi (çoklu ürün indirimi)
          </label>
          <p className="-mt-1 text-xs text-gray-500">"2. ürüne sepette ekstra indirim" tipi kampanyalarda, indirimsiz (baz) ürün iade edilirse kalan en pahalı kampanyalı ürünün indirimi geri alınır ve iade tutarından düşülür. Bu tarz kampanyanız yoksa kapalı bırakın. Kusur bildirimlerinde uygulanmaz.</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={rules.allow_original_refund} onChange={(e) => setRules((p) => ({ ...p, allow_original_refund: e.target.checked }))} className={checkCls} />
              Karta iade
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={rules.allow_store_credit} onChange={(e) => setRules((p) => ({ ...p, allow_store_credit: e.target.checked }))} className={checkCls} />
              İndirim kodu (store credit)
            </label>
          </div>
        </div>

        {/* Kullanım Sonrası Kusur Bildirimi */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Kullanım Sonrası Kusur Bildirimi</h3>
          <p className="text-xs text-gray-500 mb-3">
            İade süresi dolduktan sonra müşteri, kusur fotoğrafı + açıklama ile sorun bildirebilir.
            Kargo kodu otomatik verilmez; talep yalnızca <strong>firma yöneticisinin</strong> onay/red kararıyla ilerler.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={rules.defect_enabled} onChange={(e) => setRules((p) => ({ ...p, defect_enabled: e.target.checked }))} className={checkCls} />
              Kusur bildirimi açık
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">En geç (gün)</label>
              <input type="number" min={0} max={1095} value={rules.defect_max_days}
                onChange={(e) => setRules((p) => ({ ...p, defect_max_days: Number(e.target.value) }))}
                className={inputCls} />
              <p className="mt-1 text-xs text-gray-500">Sipariş tarihinden itibaren bildirim üst sınırı (0 = sınırsız).</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Red nedenleri (her satır bir neden)</label>
              <textarea rows={4} value={rules.defect_reject_reasons.join('\n')}
                onChange={(e) => setRules((p) => ({ ...p, defect_reject_reasons: e.target.value.split('\n') }))}
                onBlur={(e) => setRules((p) => ({ ...p, defect_reject_reasons: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }))}
                className={inputCls + ' resize-y font-normal'} />
              <p className="mt-1 text-xs text-gray-500">Yönetici reddederken bu listeden seçer; seçilen neden müşteriye SMS ile gider. Boş bırakılırsa varsayılan liste kullanılır.</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={saveRules} disabled={rulesSaving || loadError}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {rulesSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Kuralları Kaydet
          </button>
          {rulesSaved && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle size={16} /> Kaydedildi</span>}
        </div>
      </div>

      {/* İade Entegrasyonları (SMS + Sürat Kargo) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Globe size={18} /> İade Entegrasyonları
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          İade bildirimleri (SMS), kargo iade kodu üretimi, ERP/sipariş statüsü ve para iadesi.
          <strong> Dry-run açıkken</strong> ilgili adım gerçek işlem yapmaz; yalnızca loglanır.
        </p>

        {/* Talep Kodu Önekleri */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Talep Kodu Formatı</h3>
          <p className="text-xs text-gray-500 mb-3">
            Önek girilirse kodlar <strong>önek + 8 rakam</strong> olur (örn. <code className="bg-gray-100 px-1 rounded">tba48291037</code>) —
            kısa, tire içermez ve rakamlarda I/i, O/0 karışıklığı yaşanmaz. Boş bırakılırsa kod <strong>yalnız 10 rakamdan</strong> oluşur
            (örn. <code className="bg-gray-100 px-1 rounded">4829103756</code>). Küçük harf ve rakam; <strong>i</strong> ve <strong>ı</strong> harfleri
            kargo sistemlerindeki büyük/küçük harf karışıklığı nedeniyle kullanılamaz.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {([['return', 'İade öneki', 'tba'], ['cancel', 'İptal öneki', 'tbp'], ['defect', 'Kusur öneki', 'tbk'], ['shortage', 'Eksik/hatalı ürün öneki', 'tbe'], ['returned', 'Geri dönen sipariş öneki', 'tbg']] as const).map(([k, label, ph]) => (
              <div key={k}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input type="text" value={intg.code_prefixes[k]} maxLength={6}
                  onChange={(e) => {
                    const v = e.target.value.toLocaleLowerCase('tr').replace(/[^a-hj-z0-9]/g, '')
                    setIntg((p) => ({ ...p, code_prefixes: { ...p.code_prefixes, [k]: v } }))
                  }}
                  placeholder={`Örn: ${ph}`} className={inputCls} />
                <p className="mt-1 text-xs text-gray-500">
                  {intg.code_prefixes[k].length === 1
                    ? 'En az 2 karakter girin.'
                    : intg.code_prefixes[k]
                      ? <>Örnek kod: <code className="bg-gray-100 px-1 rounded">{intg.code_prefixes[k]}48291037</code></>
                      : 'Boş: yalnız 10 rakam.'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* SMS */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">NetGSM SMS</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gönderici Başlığı (msgheader)</label>
              <input
                type="text"
                value={intg.sms.msgheader}
                onChange={(e) => setIntg((p) => ({ ...p, sms: { ...p.sms, msgheader: e.target.value } }))}
                placeholder="Örn: TONNYBLACK"
                maxLength={20}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-500">NetGSM'de onaylı gönderici adı.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-7">
              <input type="checkbox" checked={intg.sms.enabled} onChange={(e) => setIntg((p) => ({ ...p, sms: { ...p.sms, enabled: e.target.checked } }))} className={checkCls} />
              SMS aktif
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-7">
              <input type="checkbox" checked={intg.sms.dry_run} onChange={(e) => setIntg((p) => ({ ...p, sms: { ...p.sms, dry_run: e.target.checked } }))} className={checkCls} />
              Dry-run (test, göndermez)
            </label>
          </div>
        </div>

        {/* Kargo Sağlayıcısı Seçimi — yalnız seçilen firmanın bilgileri gösterilir */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">İade Kargo Firması</h3>
          <p className="text-xs text-gray-500 mb-3">
            Müşterinin iade kodunu hangi kargo firmasıyla kullanacağını belirler. Kod üretimi, takip ve
            süre dolumu seçilen firmadan yapılır. Firma bilgileri aşağıda, seçime göre gösterilir.
          </p>
          <select
            value={intg.cargo_provider}
            onChange={(e) => setIntg((p) => ({ ...p, cargo_provider: e.target.value }))}
            className={inputCls + ' md:max-w-xs'}
          >
            <option value="surat-kargo">Sürat Kargo</option>
            <option value="dhl-kargo">DHL Kargo (MNG)</option>
          </select>
        </div>

        {/* Sürat Kargo */}
        {intg.cargo_provider === 'surat-kargo' && (
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Sürat Kargo</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kullanıcı Adı</label>
              <input type="text" value={intg.surat_kargo.username} onChange={(e) => setIntg((p) => ({ ...p, surat_kargo: { ...p.surat_kargo, username: e.target.value } }))} placeholder="Sürat entegrasyon kullanıcısı" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Şifre</label>
              <div className="relative">
                <input type={showSuratPw ? 'text' : 'password'} value={intg.surat_kargo.password} onChange={(e) => setIntg((p) => ({ ...p, surat_kargo: { ...p.surat_kargo, password: e.target.value } }))} placeholder="••••••••" className={inputCls + ' pr-10'} />
                <button type="button" onClick={() => setShowSuratPw(!showSuratPw)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                  {showSuratPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Şifre güvenli (maskeli) saklanır.</p>
            </div>
          </div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">İade Adresi (kargonun geleceği alıcı)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alıcı/Firma Adı *</label>
              <input type="text" value={intg.surat_kargo.merchant.name} onChange={(e) => setMerchant('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
              <input type="text" value={intg.surat_kargo.merchant.phone} onChange={(e) => setMerchant('phone', e.target.value)} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Adres *</label>
              <input type="text" value={intg.surat_kargo.merchant.address} onChange={(e) => setMerchant('address', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İl *</label>
              <input type="text" value={intg.surat_kargo.merchant.city} onChange={(e) => setMerchant('city', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İlçe *</label>
              <input type="text" value={intg.surat_kargo.merchant.district} onChange={(e) => setMerchant('district', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 mt-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.surat_kargo.enabled} onChange={(e) => setIntg((p) => ({ ...p, surat_kargo: { ...p.surat_kargo, enabled: e.target.checked } }))} className={checkCls} />
              Sürat Kargo aktif
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.surat_kargo.dry_run} onChange={(e) => setIntg((p) => ({ ...p, surat_kargo: { ...p.surat_kargo, dry_run: e.target.checked } }))} className={checkCls} />
              Dry-run (test, kargo oluşturmaz)
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-500">İade adresi Sürat'ın zorunlu kıldığı "alıcı" bilgisidir (kargonun geleceği yer). Dry-run kapatılınca gerçek kargo kodu üretilir.</p>
        </div>
        )}

        {/* DHL Kargo (MNG) */}
        {intg.cargo_provider === 'dhl-kargo' && (
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">DHL Kargo (MNG)</h3>
          <p className="text-xs text-gray-500 mb-3">
            DHL eCommerce (eski MNG Kargo) REST API kimlikleri: apizone.mngkargo.com.tr'den alınan
            API Key/Secret + DHL müşteri numarası ve API şifresi. İade varış adresi DHL'deki cari
            hesabınızın kayıtlı iade adresidir (panelden girilmez).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Client ID</label>
              <input type="text" value={intg.dhl_kargo.client_id} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, client_id: e.target.value } }))} placeholder="apizone uygulama anahtarı" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Client Secret</label>
              <div className="relative">
                <input type={showDhlSecret ? 'text' : 'password'} value={intg.dhl_kargo.client_secret} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, client_secret: e.target.value } }))} placeholder="••••••••" className={inputCls + ' pr-10'} />
                <button type="button" onClick={() => setShowDhlSecret(!showDhlSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                  {showDhlSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Müşteri Numarası</label>
              <input type="text" value={intg.dhl_kargo.customer_number} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, customer_number: e.target.value } }))} placeholder="DHL/MNG cari müşteri no" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Şifresi</label>
              <div className="relative">
                <input type={showDhlPw ? 'text' : 'password'} value={intg.dhl_kargo.password} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, password: e.target.value } }))} placeholder="••••••••" className={inputCls + ' pr-10'} />
                <button type="button" onClick={() => setShowDhlPw(!showDhlPw)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                  {showDhlPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Sırlar güvenli (maskeli) saklanır.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 mt-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.dhl_kargo.enabled} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, enabled: e.target.checked } }))} className={checkCls} />
              DHL Kargo aktif
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.dhl_kargo.dry_run} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, dry_run: e.target.checked } }))} className={checkCls} />
              Dry-run (test, kargo oluşturmaz)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.dhl_kargo.test_mode} onChange={(e) => setIntg((p) => ({ ...p, dhl_kargo: { ...p.dhl_kargo, test_mode: e.target.checked } }))} className={checkCls} />
              Sandbox (testapi)
            </label>
          </div>
        </div>
        )}

        {/* ERP & Sipariş Entegrasyonu */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">ERP &amp; Sipariş Entegrasyonu</h3>
          <p className="text-xs text-gray-500 mb-3">
            İptal onaylandığında ERP'de belge oluşturma (Nebim) ve platformda sipariş statüsü yazma (Ticimax).
            ikas kullanan firmalarda bu adımlar geçerli değildir; kapalı bırakın.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-sm font-medium text-gray-800 mb-2">Nebim V3 (iptal belgesi)</div>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={intg.nebim.enabled} onChange={(e) => setIntg((p) => ({ ...p, nebim: { ...p.nebim, enabled: e.target.checked } }))} className={checkCls} />
                  Aktif
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={intg.nebim.dry_run} onChange={(e) => setIntg((p) => ({ ...p, nebim: { ...p.nebim, dry_run: e.target.checked } }))} className={checkCls} />
                  Dry-run (ERP'ye yazmaz)
                </label>
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-sm font-medium text-gray-800 mb-2">Ticimax (sipariş statüsü)</div>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={intg.ticimax.enabled} onChange={(e) => setIntg((p) => ({ ...p, ticimax: { ...p.ticimax, enabled: e.target.checked } }))} className={checkCls} />
                  Aktif
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={intg.ticimax.dry_run} onChange={(e) => setIntg((p) => ({ ...p, ticimax: { ...p.ticimax, dry_run: e.target.checked } }))} className={checkCls} />
                  Dry-run (statü yazmaz)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={intg.ticimax.notify_customer} onChange={(e) => setIntg((p) => ({ ...p, ticimax: { ...p.ticimax, notify_customer: e.target.checked } }))} className={checkCls} />
                  Ticimax müşteri e-postası
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Para İadesi */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Para İadesi</h3>
          <p className="text-xs text-gray-500 mb-3">
            Yönetici onayı sonrası ödemenin iadesi. <strong>Dry-run açıkken</strong> gerçek para iadesi / kupon üretimi yapılmaz.
          </p>
          <div className="flex flex-wrap items-center gap-5 mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.refund.enabled} onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, enabled: e.target.checked } }))} className={checkCls} />
              Para iadesi aktif
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={intg.refund.dry_run} onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, dry_run: e.target.checked } }))} className={checkCls} />
              Dry-run (iade işlemez)
            </label>
          </div>

          <div className="rounded-lg border border-gray-100 p-3 mb-4">
            <div className="text-sm font-medium text-gray-800 mb-2">İndirim Kodu (store credit)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Geçerlilik (gün)</label>
                <input type="number" min={1} max={3650} value={intg.refund.store_credit.valid_days}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, store_credit: { ...p.refund.store_credit, valid_days: Number(e.target.value) } } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kod öneki</label>
                <input type="text" maxLength={20} value={intg.refund.store_credit.code_prefix}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, store_credit: { ...p.refund.store_credit, code_prefix: e.target.value } } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kupon grup adı</label>
                <input type="text" maxLength={60} value={intg.refund.store_credit.grup_adi}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, store_credit: { ...p.refund.store_credit, grup_adi: e.target.value } } }))} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-sm font-medium text-gray-800 mb-2">Karta İade (iyzico / PayTR)</div>
            <div className="flex flex-wrap items-center gap-5 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={intg.refund.original.enabled} onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, enabled: e.target.checked } } }))} className={checkCls} />
                Karta iade aktif
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={intg.refund.original.dry_run} onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, dry_run: e.target.checked } } }))} className={checkCls} />
                Dry-run
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">iyzico API Key</label>
                <input type="text" value={intg.refund.original.iyzico.api_key}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, iyzico: { ...p.refund.original.iyzico, api_key: e.target.value } } } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">iyzico Secret Key</label>
                <input type="password" value={intg.refund.original.iyzico.secret_key}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, iyzico: { ...p.refund.original.iyzico, secret_key: e.target.value } } } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PayTR Merchant ID</label>
                <input type="text" value={intg.refund.original.paytr.merchant_id}
                  onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, paytr: { ...p.refund.original.paytr, merchant_id: e.target.value } } } }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PayTR Key</label>
                  <input type="password" value={intg.refund.original.paytr.merchant_key}
                    onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, paytr: { ...p.refund.original.paytr, merchant_key: e.target.value } } } }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PayTR Salt</label>
                  <input type="password" value={intg.refund.original.paytr.merchant_salt}
                    onChange={(e) => setIntg((p) => ({ ...p, refund: { ...p.refund, original: { ...p.refund.original, paytr: { ...p.refund.original.paytr, merchant_salt: e.target.value } } } }))} className={inputCls} />
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">Sırlar güvenli (maskeli) saklanır; maskeli değeri değiştirmeden kaydetmek mevcut sırrı korur. Karta iade kapalıysa/başarısızsa yönetici onayı geri alınır.</p>
          </div>
        </div>

        {/* Eksik / Hatalı Ürün İadesi (personel) */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Eksik / Hatalı Ürün İadesi (Personel)</h3>
          <p className="text-xs text-gray-500 mb-3">
            Depo siparişi çıkaramadığında personelin panelden başlattığı iade. Yönetici para onayı verince müşteriye
            <strong> özür SMS'i</strong> (SMS Yönetimi → "Eksik/hatalı ürün — özür + kupon") ve aşağıdaki <strong>özel indirim kuponu</strong> gider.
            Kupon Ticimax'ta oluşturulur; "Para İadesi → Dry-run" açıksa kupon da yazılmaz.
          </p>
          <div className="rounded-lg border border-gray-100 p-3 mb-3">
            <div className="text-sm font-medium text-gray-800 mb-2">Özür Kuponu</div>
            <div className="flex flex-wrap items-center gap-5 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={intg.shortage.coupon_enabled} onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_enabled: e.target.checked } }))} className={checkCls} />
                Kupon gönder
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={intg.shortage.coupon_free_shipping} onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_free_shipping: e.target.checked } }))} className={checkCls} />
                Kuponla kargo ücretsiz
              </label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tutar (TL)</label>
                <input type="number" min={0} max={100000} step={1} value={intg.shortage.coupon_amount}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_amount: Number(e.target.value) } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Geçerlilik (gün)</label>
                <input type="number" min={1} max={730} value={intg.shortage.coupon_days}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_days: Number(e.target.value) } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kod öneki</label>
                <input type="text" maxLength={10} value={intg.shortage.coupon_prefix}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min. sepet (TL)</label>
                <input type="number" min={0} value={intg.shortage.coupon_min_amount}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_min_amount: Number(e.target.value) } }))} className={inputCls} />
                <p className="mt-1 text-xs text-gray-500">0 = koşulsuz</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kupon grup adı</label>
                <input type="text" maxLength={60} value={intg.shortage.coupon_grup_adi}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, coupon_grup_adi: e.target.value } }))} className={inputCls} />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-sm font-medium text-gray-800 mb-2">Ticimax İzleri</div>
            <p className="text-xs text-gray-500 mb-3">
              Sipariş statüsü değiştirilmez (kalan ürünler kargolanacak). Gönderilemeyen kalem Ticimax'ta
              <strong> "İptal Edildi"</strong> olarak işaretlenir (iptal akışıyla aynı kalem kodu). Farklı bir "Sipariş Ürün Durumu"
              (örn. "Gönderilemedi") kullanmak isterseniz ID + işlem kodunu girin; <strong>0 = iptal kodu</strong>.
              Ticimax'a not yazılmaz; işlem özeti ve personel notu Yunbi'de talep detayında tutulur.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kalem durumu ID (DurumID)</label>
                <input type="number" min={0} value={intg.shortage.item_durum_id}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, item_durum_id: Number(e.target.value) } }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kalem işlem kodu (Islem)</label>
                <input type="number" min={0} value={intg.shortage.item_islem}
                  onChange={(e) => setIntg((p) => ({ ...p, shortage: { ...p.shortage, item_islem: Number(e.target.value) } }))} className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={saveIntegrations} disabled={intgSaving || loadError} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            <Save size={16} /> {intgSaving ? t('common.saving') : t('common.save')}
          </button>
          {intgSaved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle size={16} /> {t('common.saved')}</span>}
        </div>
      </div>
    </div>
  )
}
