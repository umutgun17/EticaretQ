import { useEffect, useState } from 'react'
import { Disc3, MessageSquare, Ticket, TrendingUp, ShoppingCart, Save, AlertTriangle, Inbox } from 'lucide-react'
import clsx from 'clsx'
import { wheelReminderApi, type WheelReminder } from '@/lib/cartRecoveryApi'
import MessageTemplateField from '@/components/marketing/MessageTemplateField'

const WHEEL_VARS = ['shop_name', 'coupon_code', 'prize', 'hours', 'url']

const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)
const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled}
      className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-emerald-600' : 'bg-gray-300')}>
      <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

function Stat({ icon: Icon, label, value, color }: { icon: typeof Ticket; label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><Icon size={13} className={color} /> {label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  )
}

export default function WheelReminderPanel() {
  const [d, setD] = useState<WheelReminder | null>(null)
  const [tab, setTab] = useState<'analytics' | 'flow'>('analytics')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function load() { setD(await wheelReminderApi.get()) }
  useEffect(() => { load() }, [])
  if (!d) return <div className="p-6 text-center text-gray-400">Yükleniyor…</div>

  const { settings: s, stats, deliveries } = d
  async function save(patch: { enabled?: boolean; whatsapp_enabled?: boolean; hours_before?: number; sms_template?: string; opt_out_url?: string }) {
    setSaving(true)
    try { setD(await wheelReminderApi.update(patch)); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    finally { setSaving(false) }
  }
  const convRate = stats.sms_sent > 0 ? Math.round((stats.conversions / stats.sms_sent) * 100) : 0

  // Canlı SMS önizleme: şablonu örnek değerlerle doldur + red linkini ekle + kontör hesapla.
  const sampleUrl = s.shop_url || 'https://magaza.com'
  const rendered = (s.sms_template?.trim()
    ? s.sms_template
        .replace(/\{\{\s*prize\s*\}\}/g, '100 TL')
        .replace(/\{\{\s*hours\s*\}\}/g, '2')
        .replace(/\{\{\s*coupon_code\s*\}\}/g, 'TL100-ABCDE')
        .replace(/\{\{\s*url\s*\}\}/g, sampleUrl)
        .replace(/\{\{\s*shop_name\s*\}\}/g, 'Mağaza')
    : `Carkta kazandiginiz 100 TL kuponun son 2 saati! Hemen alisverise basla: ${sampleUrl} Kod: TL100-ABCDE`)
  const previewText = s.opt_out_url?.trim() ? `${rendered.trimEnd()} Red: ${s.opt_out_url.trim()}` : rendered
  // NetGSM kontör hesabı: Türkçe karakter varsa TR modu (150/kontör), özel harfler
  // (ç ğ ı ş Ğ İ Ş) 2 karakter sayılır. Saf ASCII ise standart (160/kontör).
  const hasTr = Array.from(previewText).some((c) => c.charCodeAt(0) > 127)
  const trDoubles = (previewText.match(/[çğışĞİŞ]/g) || []).length
  const effLen = previewText.length + (hasTr ? trDoubles : 0)
  const smsLimit = hasTr ? 150 : 160
  const credits = effLen === 0 ? 0 : Math.ceil(effLen / smsLimit)
  const overLimit = credits >= 2

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Disc3 className="text-rose-600" size={26} />
        <h1 className="text-xl font-semibold text-gray-900">Çark Entegrasyonu</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={clsx('text-sm font-medium', s.enabled ? 'text-emerald-600' : 'text-gray-400')}>{s.enabled ? 'CANLI' : 'Kapalı'}</span>
          <Toggle on={s.enabled} onToggle={() => save({ enabled: !s.enabled })} disabled={saving} />
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Çarkta kupon kazanıp <b>henüz kullanmamış</b> müşterilere, kupon bitimine az kala son hatırlatma SMS'i gönderir.
        Sipariş veren / kuponu kullanan kişiye <b>asla</b> gönderilmez.
      </p>

      {!s.enabled && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Kapalı — sistem uygun kuponları izliyor ama SMS göndermiyor (simülasyon). Açınca gerçek gönderim başlar.
        </div>
      )}

      {/* Sekmeler: girişte direkt aksiyonlar (Analitik), düzenleme ayrı sayfada (Akış) */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {([['analytics', 'Analitik'], ['flow', 'Akışı Düzenle']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
              tab === key ? 'border-rose-600 text-rose-700' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat icon={MessageSquare} label="Gönderilen SMS" value={fmtNum(stats.sms_sent)} color="text-blue-600" />
        <Stat icon={ShoppingCart} label={`Satışa dönüşüm (%${convRate})`} value={fmtNum(stats.conversions)} color="text-indigo-600" />
        <Stat icon={TrendingUp} label="Bu otomasyon cirosu" value={fmtMoney(stats.revenue)} color="text-emerald-600" />
        <Stat icon={Ticket} label="Hatırlatılan kupon" value={fmtNum(stats.reminded)} color="text-rose-600" />
      </div>
      )}

      {tab === 'flow' && (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Ayarlar</h2>
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
        </div>
        <div className="max-w-xs mb-4">
          <label className="block text-sm text-gray-600 mb-1">Bitimine kaç saat kala gönderilsin?</label>
          <input type="number" min={1} max={72} value={s.hours_before}
            onChange={(e) => setD({ ...d, settings: { ...s, hours_before: +e.target.value } })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500" />
        </div>

        {/* WhatsApp kanalı — Meta onaylı şablonla gönderim, başarısızsa SMS'e düşer */}
        <div className="mb-4 flex items-center justify-between gap-3 max-w-md bg-emerald-50/60 border border-emerald-100 rounded-lg px-3 py-2.5">
          <div>
            <div className="text-sm font-medium text-gray-800">WhatsApp ile gönder</div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Meta onaylı "cark_kupon_hatirlatma" şablonu kullanılır. WhatsApp gönderilemezse otomatik SMS'e düşer.
            </p>
          </div>
          <Toggle on={!!s.whatsapp_enabled} onToggle={() => save({ whatsapp_enabled: !s.whatsapp_enabled })} disabled={saving} />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">SMS metni</label>
          <MessageTemplateField
            value={s.sms_template}
            onChange={(v) => setD({ ...d, settings: { ...s, sms_template: v } })}
            placeholder="Çarkta kazandığın {{prize}} kuponun son {{hours}} saati! Hemen alışverişe başla: {{url}} Kod: {{coupon_code}}"
            channel="sms"
            vars={WHEEL_VARS}
            note="{{hours}} her zaman SAAT olarak yazılır (dakika değil). Red linki otomatik eklenir — metne yazmayın."
          />
        </div>

        {/* SMS Red (ret) linki — İYS ticari ileti zorunluluğu, SMS sonuna eklenir */}
        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">SMS Red linki (zorunlu — İYS)</label>
          <input type="url" value={s.opt_out_url} placeholder="https://onay.li/NO45"
            onChange={(e) => setD({ ...d, settings: { ...s, opt_out_url: e.target.value } })}
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500" />
          <p className="text-[11px] text-gray-400 mt-1">Her SMS'in sonuna "Red: &lt;link&gt;" olarak otomatik eklenir. Müşteri buradan çıkış yapar.</p>
        </div>

        {/* Canlı önizleme + karakter/kontör sayacı */}
        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">Önizleme (örnek değerlerle)</label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800 break-words">{previewText}</div>
          <div className="flex items-center gap-2 mt-1.5 text-[11px]">
            <span className={clsx('font-medium', overLimit ? 'text-red-600' : 'text-gray-500')}>
              {previewText.length} karakter{hasTr && trDoubles > 0 ? ` (${effLen} hesaplanan)` : ''} · {credits} kontör
            </span>
            <span className="text-gray-400">({hasTr ? 'Türkçe modu → 150/kontör, özel harf 2x' : 'ASCII → 160/kontör'})</span>
            {overLimit && (
              <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle size={12} /> {smsLimit} sınırını aştı, {credits} kontör!
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={() => save({ hours_before: s.hours_before, sms_template: s.sms_template, opt_out_url: s.opt_out_url })} disabled={saving}
            className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
            <Save size={15} /> Kaydet
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Gönderici başlığı ve gönderim saat aralığı/frekans kuralları Ayarlar'dan gelir. Gece SMS atılmaz; kupon
          gece dolacaksa sistem <b>akşamdan</b> (6-10 saat kala) hatırlatma gönderir, hatırlatmasız bırakmaz.
        </p>
      </div>
      )}

      {tab === 'analytics' && (
      /* Gönderim detayı: kime / ne zaman / hangi SMS gitti + satışa dönüş */
      <div className="bg-white rounded-lg border border-gray-200 mt-6 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <Inbox size={16} className="text-gray-500" />
          <h2 className="font-medium text-gray-900">Gönderim detayı</h2>
          <span className="text-xs text-gray-400">son {deliveries.length} SMS</span>
        </div>
        {deliveries.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            Henüz gönderim yok. Otomasyon açılıp uygun kupon bulunduğunda gönderimler burada listelenir.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Kime</th>
                  <th className="text-left px-4 py-2.5 font-medium">Ne zaman</th>
                  <th className="text-left px-4 py-2.5 font-medium">SMS</th>
                  <th className="text-center px-4 py-2.5 font-medium">Durum</th>
                  <th className="text-right px-4 py-2.5 font-medium">Satış</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deliveries.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                      {m.contact}
                      {m.is_test && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 align-middle">TEST</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{m.at ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-md"><span className="line-clamp-2">{m.message}</span></td>
                    <td className="px-4 py-2.5 text-center">
                      {m.status === 'sent'
                        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Gönderildi</span>
                        : <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700" title={m.error ?? ''}>Başarısız</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {m.converted
                        ? <span className="font-semibold text-emerald-700">{fmtMoney(m.revenue)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
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
