import { useEffect, useState } from 'react'
import {
  ShoppingCart, Mail, MessageSquare, Save, TrendingUp, Ticket, Users, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import { cartRecoveryApi, type CartRecoverySettings, type CartRecoveryStats, type CartDeliveryRow } from '@/lib/cartRecoveryApi'
import TemplateEditButton from '@/components/marketing/TemplateEditButton'
import MessageTemplateField from '@/components/marketing/MessageTemplateField'

const MSG_VARS = ['customer_name', 'shop_name', 'coupon_code', 'coupon_amount', 'coupon_min_basket', 'cart_total', 'cart_total_short', 'cart_url']

const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
function humanDelay(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} gün`
  if (min % 60 === 0) return `${min / 60} saat`
  return `${min} dk`
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled}
      className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-emerald-600' : 'bg-gray-300')}>
      <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

function Stat({ icon: Icon, label, value, sub, color = 'text-indigo-600' }: { icon: typeof Mail; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><Icon size={13} className={color} /> {label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'

export default function CartRecoveryPanel() {
  const [s, setS] = useState<CartRecoverySettings | null>(null)
  const [stats, setStats] = useState<CartRecoveryStats | null>(null)
  const [deliveries, setDeliveries] = useState<CartDeliveryRow[]>([])
  const [tab, setTab] = useState<'analytics' | 'flow'>('analytics')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    const d = await cartRecoveryApi.get()
    setS(d.settings); setStats(d.stats); setDeliveries(d.deliveries ?? [])
  }
  useEffect(() => { load() }, [])
  if (!s || !stats) return <div className="p-6 text-center text-gray-400">Yükleniyor…</div>

  const upd = (patch: Partial<CartRecoverySettings>) => setS({ ...s, ...patch })
  const updCh = (k: keyof CartRecoverySettings['channels']) => upd({ channels: { ...s.channels, [k]: !s.channels[k] } })

  async function save(extra?: Partial<Record<string, unknown>>) {
    setSaving(true); setErr(null)
    try {
      const payload = {
        cart_recovery_coupon_amount: s!.coupon_amount,
        cart_recovery_coupon_min_basket: s!.coupon_min_basket,
        cart_recovery_coupon_valid_hours: s!.coupon_valid_hours,
        cart_recovery_coupon_mode: s!.coupon_mode,
        cart_recovery_coupon_percent: s!.coupon_percent,
        cart_recovery_coupon_round: s!.coupon_round,
        cart_recovery_process_limit: s!.process_limit,
        cart_recovery_channels: s!.channels,
        cart_recovery_delay_email: s!.delay_email,
        cart_recovery_delay_sms: s!.delay_sms,
        cart_recovery_delay_whatsapp: s!.delay_whatsapp,
        shop_url: s!.shop_url, cart_url: s!.cart_url,
        cart_recovery_sms_template: s!.sms_template,
        cart_recovery_whatsapp_template: s!.whatsapp_template,
        ...extra,
      }
      const r = await cartRecoveryApi.update(payload)
      setS(r.settings); setSaved(true); setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Kaydedilemedi.')
    } finally { setSaving(false) }
  }

  async function toggleEnabled() {
    const next = !s!.enabled
    setS({ ...s!, enabled: next })
    await save({ cart_recovery_enabled: next })
  }

  const ch = stats.channels

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Başlık + ana switch */}
      <div className="flex items-center gap-3 mb-1">
        <ShoppingCart className="text-emerald-600" size={26} />
        <h1 className="text-xl font-semibold text-gray-900">Sepet Kurtarma</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={clsx('text-sm font-medium', s.enabled ? 'text-emerald-600' : 'text-gray-400')}>
            {s.enabled ? 'CANLI' : 'Kapalı'}
          </span>
          <Toggle on={s.enabled} onToggle={toggleEnabled} disabled={saving} />
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Sepetini tamamlamayan müşterileri otomatik yakalar; e-posta → SMS+kupon → WhatsApp sırasıyla geri kazanır.
        Ödeme yapan müşteriye <b>asla</b> mesaj/kupon gitmez.
      </p>

      {!s.enabled && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Otomasyon kapalı — sistem terk sepetleri izliyor ama mesaj göndermiyor (simülasyon). Açınca gerçek gönderim başlar.
        </div>
      )}

      {/* Sekmeler: girişte direkt aksiyonlar (Analitik), düzenleme ayrı sayfada (Akış) */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {([['analytics', 'Analitik'], ['flow', 'Akışı Düzenle']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
              tab === key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && (<>
      {/* İstatistik */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat icon={Users} label="Takipteki sepet" value={String(stats.journeys.active)} sub={`Toplam ${stats.journeys.total}`} />
        <Stat icon={CheckCircle2} label="Dönüşen" value={String(stats.journeys.converted)} sub="ödeme yapan" color="text-emerald-600" />
        <Stat icon={TrendingUp} label="Kupon cirosu" value={fmtMoney(stats.revenue_by_coupon)} sub={`Toplam ${fmtMoney(stats.revenue_total)}`} color="text-emerald-600" />
        <Stat icon={Ticket} label="Kupon" value={`${stats.coupons_used}/${stats.coupons_issued}`} sub="kullanılan / üretilen" color="text-rose-600" />
      </div>

      {/* Kanal hunisi */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-5">
        <div className="text-xs font-medium text-gray-700 mb-3">Kanal performansı</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([['email', 'E-posta', Mail], ['sms', 'SMS', MessageSquare], ['whatsapp', 'WhatsApp', MessageSquare]] as const).map(([key, label, Icon]) => (
            <div key={key} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-sm text-gray-700 mb-2"><Icon size={14} className="text-gray-500" /> {label}</div>
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Gönderildi</span><span className="font-semibold">{ch[key].sent}</span>
              </div>
              {key === 'email' && (
                <>
                  <div className="flex items-center justify-between text-xs text-gray-600 mt-1"><span>Açıldı</span><span className="font-semibold">{ch[key].opened}</span></div>
                  <div className="flex items-center justify-between text-xs text-gray-600 mt-1"><span>Tıklandı</span><span className="font-semibold">{ch[key].clicked}</span></div>
                </>
              )}
              {/* Kanal atıflı dönüşüm/ciro: bu kanaldan SONRA yapılan alışverişler */}
              <div className="flex items-center justify-between text-xs text-gray-600 mt-1">
                <span>Satışa dönüşen</span><span className="font-semibold text-emerald-600">{ch[key].conversions}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-600 mt-1">
                <span>Ciro</span><span className="font-semibold text-emerald-600">{fmtMoney(ch[key].revenue)}</span>
              </div>
              {ch[key].failed + ch[key].skipped > 0 && (
                <div className="text-[11px] text-amber-500 mt-1">{ch[key].failed} hata · {ch[key].skipped} atlandı</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gönderim gözlemi — kime, hangi kod, ne zaman, sonuç */}
      <div className="bg-white rounded-lg border border-gray-200 mb-5">
        <div className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
          <span>Gönderim geçmişi <span className="text-gray-400 font-normal">(kime · hangi kod · ne zaman · sonuç)</span></span>
          <span className="text-xs text-gray-400">{deliveries.length} kayıt</span>
        </div>
        {(
          <div className="overflow-x-auto border-t border-gray-100 max-h-[480px] overflow-y-auto">
            {deliveries.length === 0 ? (
              <div className="p-4 text-sm text-gray-400">Henüz gönderim yok.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-3 py-2 font-medium">Tarih</th>
                    <th className="px-3 py-2 font-medium">Kanal</th>
                    <th className="px-3 py-2 font-medium">Alıcı</th>
                    <th className="px-3 py-2 font-medium">Sipariş</th>
                    <th className="px-3 py-2 font-medium">Kupon kodu</th>
                    <th className="px-3 py-2 font-medium">Sepet</th>
                    <th className="px-3 py-2 font-medium">Durum</th>
                    <th className="px-3 py-2 font-medium text-right">Satış</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{d.at ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                          d.channel === 'email' ? 'bg-blue-50 text-blue-600' : d.channel === 'sms' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600')}>
                          {d.channel === 'email' ? 'E-posta' : d.channel === 'sms' ? 'SMS' : 'WhatsApp'}
                        </span>
                        {d.is_test && <span className="ml-1 px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">test</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        <div>{d.customer_name || '—'}</div>
                        <div className="text-[10px] text-gray-400">{d.recipient}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{d.order_no ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{d.coupon_code ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{d.cart_total != null ? fmtMoney(Number(d.cart_total)) : '—'}</td>
                      <td className="px-3 py-2">
                        {d.status === 'sent' ? <span className="text-emerald-600">gönderildi</span>
                          : d.status === 'failed' ? <span className="text-rose-600" title={d.error ?? ''}>hata</span>
                          : <span className="text-amber-500" title={d.skip_reason ?? ''}>atlandı{d.skip_reason ? ` (${d.skip_reason})` : ''}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {d.converted
                          ? <span className="text-emerald-600 font-semibold">{d.revenue != null ? fmtMoney(d.revenue) : '✓'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      </>)}

      {tab === 'flow' && (
      /* Akış düzenleme */
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Akış ayarları</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
            <button onClick={() => save()} disabled={saving} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
              <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>

        {/* Adımlar (kanal + gecikme) */}
        <div className="space-y-2 mb-5">
          {([
            ['email', 'E-posta hatırlatma (kuponsuz)', s.delay_email, (v: number) => upd({ delay_email: v })],
            ['sms', s.coupon_mode === 'percent' ? `SMS + sepete göre %${s.coupon_percent} kupon` : `SMS + ${s.coupon_amount} ₺ kupon`, s.delay_sms, (v: number) => upd({ delay_sms: v })],
            ['whatsapp', 'WhatsApp + aynı kupon (kalan süre hatırlatması)', s.delay_whatsapp, (v: number) => upd({ delay_whatsapp: v })],
          ] as const).map(([key, label, delay, setDelay], i) => (
            <div key={key} className="rounded-lg border border-gray-100">
              <div className="flex items-center gap-3 p-3">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-semibold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800">{label}</div>
                  <div className="text-[11px] text-gray-400">Terkten {humanDelay(delay)} sonra</div>
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" min={0.5} step={0.5} value={+(delay / 60).toFixed(2)}
                    onChange={(e) => setDelay(Math.max(5, Math.round(+e.target.value * 60)))} className={clsx(inputCls, 'w-20')} />
                  <span className="text-xs text-gray-400">saat</span>
                </div>
                <Toggle on={s.channels[key]} onToggle={() => updCh(key)} />
              </div>

              {/* Mesaj/şablon düzenleme — kanal açıksa */}
              {s.channels[key] && (
                <div className="px-3 pb-3 pt-1 border-t border-gray-50">
                  {key === 'email' ? (
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">HTML e-posta şablonu (sürükle-bırak editör)</span>
                      <TemplateEditButton templateKey="cart_recovery_1" label="E-posta şablonunu düzenle" />
                    </div>
                  ) : key === 'sms' ? (
                    <MessageTemplateField
                      value={s.sms_template}
                      onChange={(v) => upd({ sms_template: v })}
                      placeholder='{{shop_name}}: Sepetini unutma! {{coupon_amount}} TL kod: {{coupon_code}} ({{coupon_min_basket}} TL uzeri). Tamamla: {{cart_url}}'
                      channel="sms"
                      vars={MSG_VARS}
                    />
                  ) : (
                    <div className="text-xs text-gray-500 bg-emerald-50/60 border border-emerald-100 rounded-lg p-2.5">
                      Meta onaylı <b>"sepet_kurtarma_kupon"</b> şablonu gönderilir: müşteri adı + kupon tutarı + kupon kodu + <b>kalan geçerlilik süresi</b> (aciliyet).
                      Şablon Meta onayı beklerken gönderim <b>otomatik ertelenir</b>; onaylandığı an kendiliğinden akar — ek işlem gerekmez.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Kupon ayarları */}
        <div className="rounded-lg border border-gray-100 p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-sm font-medium text-gray-800">Kupon</h3>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button onClick={() => upd({ coupon_mode: 'percent' })}
                className={clsx('px-3 py-1.5 font-medium', s.coupon_mode === 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                Sepete göre % (önerilen)
              </button>
              <button onClick={() => upd({ coupon_mode: 'fixed' })}
                className={clsx('px-3 py-1.5 font-medium', s.coupon_mode === 'fixed' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                Sabit tutar
              </button>
            </div>
          </div>

          {s.coupon_mode === 'percent' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Sepetin yüzdesi (%)</label>
                  <input type="number" min={1} max={50} value={s.coupon_percent} onChange={(e) => upd({ coupon_percent: +e.target.value })} className={clsx(inputCls, 'w-full')} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Yuvarlama adımı (₺)</label>
                  <input type="number" min={5} max={500} step={5} value={s.coupon_round} onChange={(e) => upd({ coupon_round: +e.target.value })} className={clsx(inputCls, 'w-full')} />
                  <p className="text-[11px] text-gray-400 mt-1">Kupon bu tutarın katına yuvarlanır (25 → 25/50/75/100…).</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Kupon geçerlilik (saat)</label>
                  <input type="number" min={1} value={s.coupon_valid_hours} onChange={(e) => upd({ coupon_valid_hours: +e.target.value })} className={clsx(inputCls, 'w-full')} />
                </div>
              </div>
              <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                <b>Her müşteriye kendi sepetine göre kupon:</b> min. sepet şartı müşterinin kendi sepet tutarıdır (100'e aşağı yuvarlanır) — kupon mevcut sepetinde kesin geçerli olur, daha küçük alışverişe kaçamaz.
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                  {[550, 1200, 2400].map((cart) => {
                    const step = Math.max(5, s.coupon_round || 25)
                    const amt = Math.max(step, Math.round((cart * (s.coupon_percent || 10)) / 100 / step) * step)
                    const minB = Math.floor(cart / 100) * 100
                    return <span key={cart}>Sepet {cart}₺ → <b>{amt}₺ kupon</b> (min. {minB}₺)</span>
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Kupon tutarı (₺)</label>
                <input type="number" min={0} value={s.coupon_amount} onChange={(e) => upd({ coupon_amount: +e.target.value })} className={clsx(inputCls, 'w-full')} />
                <p className="text-[11px] text-gray-400 mt-1">Herkese aynı tutar, tek kullanımlık Ticimax kuponu.</p>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Min. sepet tutarı (₺)</label>
                <input type="number" min={0} value={s.coupon_min_basket} onChange={(e) => upd({ coupon_min_basket: +e.target.value })} className={clsx(inputCls, 'w-full')} />
                <p className="text-[11px] text-gray-400 mt-1">Kupon yalnızca bu tutarın üstünde geçerli. <b>0 = limit yok.</b></p>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Kupon geçerlilik (saat)</label>
                <input type="number" min={1} value={s.coupon_valid_hours} onChange={(e) => upd({ coupon_valid_hours: +e.target.value })} className={clsx(inputCls, 'w-full')} />
              </div>
            </div>
          )}
        </div>

        {/* Warm-up limiti */}
        <div className="rounded-lg border border-gray-100 p-4 mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="max-w-xs">
              <label className="block text-sm text-gray-600 mb-1">Çalışma başına azami gönderim (warm-up)</label>
              <input type="number" min={0} max={1000} value={s.process_limit}
                onChange={(e) => upd({ process_limit: +e.target.value })} className={clsx(inputCls, 'w-full')} />
            </div>
            <p className="text-[11px] text-gray-400 flex-1 min-w-[200px]">
              Her 10 dakikalık çalışmada en fazla bu kadar sepet işlenir — açılışta küçük başlayıp (ör. 50)
              her şey doğru akınca artırın. <b>0 = limitsiz (varsayılan 200).</b>
            </p>
          </div>
        </div>

        {/* URL'ler */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Mağaza adresi (shop_url)</label>
            <input value={s.shop_url ?? ''} onChange={(e) => upd({ shop_url: e.target.value })} placeholder="https://www.magazaniz.com" className={clsx(inputCls, 'w-full')} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Sepet adresi (cart_url)</label>
            <input value={s.cart_url ?? ''} onChange={(e) => upd({ cart_url: e.target.value })} placeholder="https://www.magazaniz.com/checkout" className={clsx(inputCls, 'w-full')} />
          </div>
        </div>

        {err && <div className="mt-3 text-xs text-rose-600 bg-rose-50 rounded-lg p-2">{err}</div>}

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
          <button onClick={() => save()} disabled={saving} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
            <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
