import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Zap, Clock, GitBranch, Ticket, Flag, Mail, MessageSquare, Bell,
  Plus, Moon, Save, Play, Pause, Settings2, Sparkles, TrendingUp, ChevronDown,
  Users, CheckCircle2, XCircle, MinusCircle, MailOpen, MousePointerClick, ShoppingCart, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import {
  marketingApi, fmtMoney, fmtNum, CHANNEL_LABELS, STATUS_LABELS,
  JOURNEY_STATUS_LABELS, JOURNEY_STATUS_BADGE,
  waitText, type Automation, type FlowStep, type Channel, type Journey, type JourneyEvent,
} from '@/lib/marketingApi'
import CartRecoveryPanel from '@/components/marketing/CartRecoveryPanel'
import WheelReminderPanel from '@/components/marketing/WheelReminderPanel'
import OrderNotifyPanel from '@/components/marketing/OrderNotifyPanel'

function RealPanel({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="px-6 pt-5">
        <Link to="/marketing/automations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={15} /> Otomasyonlar
        </Link>
      </div>
      {children}
    </div>
  )
}

const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  email: Mail, sms: MessageSquare, whatsapp: MessageSquare, push: Bell,
}

const STEP_META: Record<string, { icon: typeof Zap; ring: string; bg: string; text: string }> = {
  trigger: { icon: Zap, ring: 'border-indigo-300', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  wait: { icon: Clock, ring: 'border-gray-300', bg: 'bg-gray-50', text: 'text-gray-600' },
  send: { icon: Mail, ring: 'border-blue-300', bg: 'bg-blue-50', text: 'text-blue-700' },
  condition: { icon: GitBranch, ring: 'border-amber-300', bg: 'bg-amber-50', text: 'text-amber-700' },
  coupon: { icon: Ticket, ring: 'border-violet-300', bg: 'bg-violet-50', text: 'text-violet-700' },
  goal: { icon: Flag, ring: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700' },
}

function StepCard({ step }: { step: FlowStep }) {
  const meta = STEP_META[step.type]
  const Icon = step.type === 'send' && step.channel ? CHANNEL_ICON[step.channel] : meta.icon

  let title = ''
  let sub: string | null = null
  switch (step.type) {
    case 'trigger': title = step.triggerLabel ?? 'Tetikleyici'; sub = 'Akış bu olayla başlar'; break
    case 'wait': title = waitText(step); sub = 'Sonraki adıma kadar bekle'; break
    case 'send': title = `${CHANNEL_LABELS[step.channel!]} gönder`; sub = step.templateName ?? null; break
    case 'condition': title = 'Koşul'; sub = step.conditionLabel ?? null; break
    case 'coupon': title = 'Kupon üret'; sub = step.couponLabel ?? null; break
    case 'goal': title = 'Hedef'; sub = step.goalLabel ?? null; break
  }

  return (
    <div className={clsx('relative bg-white rounded-lg border p-3.5 shadow-sm', meta.ring)}>
      <div className="flex items-start gap-3">
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', meta.bg)}>
          <Icon size={18} className={meta.text} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{title}</span>
            {step.type === 'send' && step.respectQuietHours && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px]" title="Sessiz saatlerde gönderilmez, yoğun saat penceresine ötelenir">
                <Moon size={10} /> sessiz saate duyarlı
              </span>
            )}
            {step.type === 'send' && step.respectQuietHours === false && (
              <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px]" title="İşlemsel — saat gözetmeksizin anında gider">anlık</span>
            )}
            {step.type === 'coupon' && step.couponOnlyIfNotConverted && (
              <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 text-[10px]">sadece dönüşmeyene</span>
            )}
          </div>
          {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
          {(step.reached != null || step.positive != null) && (
            <div className="flex items-center gap-3 mt-2 text-[11px]">
              {step.reached != null && (
                <span className="inline-flex items-center gap-1 text-gray-500"><Users size={11} /> {fmtNum(step.reached)} ulaştı</span>
              )}
              {step.positive != null && (
                <span className={clsx('inline-flex items-center gap-1 font-medium', meta.text)}>
                  <TrendingUp size={11} /> {fmtNum(step.positive)} {step.positiveLabel}
                </span>
              )}
            </div>
          )}
        </div>
        <button className="text-gray-300 hover:text-gray-500" title="Adımı düzenle (prototip)">
          <Settings2 size={15} />
        </button>
      </div>
    </div>
  )
}

const EVENT_META: Record<string, { icon: typeof Mail; color: string }> = {
  ok: { icon: CheckCircle2, color: 'text-gray-400' },
  fail: { icon: XCircle, color: 'text-rose-500' },
  skip: { icon: MinusCircle, color: 'text-amber-500' },
  open: { icon: MailOpen, color: 'text-indigo-500' },
  click: { icon: MousePointerClick, color: 'text-violet-500' },
  convert: { icon: ShoppingCart, color: 'text-emerald-600' },
}

function JourneyRow({ j }: { j: Journey }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-gray-700">
            <ChevronRight size={13} className={clsx('text-gray-400 transition-transform', open && 'rotate-90')} /> {j.contact}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">{j.enteredAt}</td>
        <td className="px-4 py-3 text-xs text-gray-700">{j.currentStep}</td>
        <td className="px-4 py-3">
          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', JOURNEY_STATUS_BADGE[j.status])}>{JOURNEY_STATUS_LABELS[j.status]}</span>
        </td>
        <td className="px-4 py-3 text-right font-medium text-emerald-700">{j.revenue ? fmtMoney(j.revenue) : '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-4 pb-4 bg-gray-50/60">
            <div className="ml-5 border-l-2 border-gray-200 pl-4 py-2 space-y-2">
              {j.events.map((e: JourneyEvent, i: number) => {
                const m = EVENT_META[e.result ?? 'ok']
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <m.icon size={13} className={m.color} />
                    <span className="text-gray-400 w-20 shrink-0">{e.at}</span>
                    <span className="text-gray-700">{e.label}</span>
                    {e.channel && <span className="text-[10px] text-gray-400">· {CHANNEL_LABELS[e.channel]}</span>}
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Connector({ branch }: { branch?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-3 bg-gray-300" />
      {branch ? (
        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">evet ise ↓</span>
      ) : (
        <button className="w-5 h-5 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 flex items-center justify-center" title="Araya adım ekle (prototip)">
          <Plus size={12} />
        </button>
      )}
      <div className="w-px h-3 bg-gray-300" />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={clsx('text-lg font-semibold', accent ?? 'text-gray-800')}>{value}</div>
    </div>
  )
}

export default function AutomationDetailPage() {
  const { key } = useParams<{ key: string }>()

  // Gerçek backend'e bağlı paneller (diğerleri henüz prototip)
  if (key === 'cart_recovery') return <RealPanel><CartRecoveryPanel /></RealPanel>
  if (key === 'wheel_coupon') return <RealPanel><WheelReminderPanel /></RealPanel>
  if (key === 'order_status') return <RealPanel><OrderNotifyPanel /></RealPanel>

  return <AutomationDetailMock keyName={key} />
}

function AutomationDetailMock({ keyName: key }: { keyName?: string }) {
  const [a, setA] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'flow' | 'journeys' | 'audience' | 'settings'>('flow')
  const [journeys, setJourneys] = useState<Journey[]>([])

  useEffect(() => {
    if (!key) return
    marketingApi.getAutomation(key).then((d) => { setA(d); setLoading(false) })
    marketingApi.getJourneys(key).then(setJourneys)
  }, [key])

  if (loading) return <div className="p-6 text-center text-gray-400">Yükleniyor…</div>
  if (!a) return <div className="p-6 text-center text-gray-400">Otomasyon bulunamadı.</div>

  const openRate = a.stat.sent ? Math.round((a.stat.opened / a.stat.sent) * 100) : 0
  const convRate = a.stat.sent ? ((a.stat.converted / a.stat.sent) * 100).toFixed(1) : '0'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/marketing/automations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={15} /> Otomasyonlar
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="text-indigo-600" size={24} />
            <h1 className="text-xl font-extrabold text-gray-900">{a.name}</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">{STATUS_LABELS[a.status]}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">{a.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {a.status === 'active' ? <><Pause size={15} /> Duraklat</> : <><Play size={15} /> Aktifleştir</>}
          </button>
          <button className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Save size={15} /> Kaydet
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Akışa giren (30g)" value={fmtNum(a.stat.enrolled)} />
        <Stat label="Açılma oranı" value={`%${openRate}`} accent="text-indigo-700" />
        <Stat label="Dönüşüm oranı" value={`%${convRate}`} accent="text-blue-700" />
        <Stat label="Kurtarılan ciro" value={fmtMoney(a.stat.revenue)} accent="text-emerald-700" />
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-6">
        {([['flow', 'Akış'], ['journeys', 'Kişi Yolculukları'], ['audience', 'Hedef Kitle'], ['settings', 'Ayarlar']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx('pb-2.5 text-sm font-medium border-b-2 -mb-px transition', tab === k ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'flow' && (
        <div className="max-w-xl mx-auto">
          {a.steps.map((step, i) => (
            <div key={step.id}>
              <StepCard step={step} />
              {i < a.steps.length - 1 && <Connector branch={a.steps[i + 1].type === 'wait' && step.type === 'condition'} />}
            </div>
          ))}
          <div className="flex justify-center mt-3">
            <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600">
              <Plus size={15} /> Adım ekle
            </button>
          </div>

          <div className="mt-6 flex items-start gap-2 text-xs text-gray-500 bg-indigo-50/60 border border-indigo-100 rounded-lg p-3">
            <Sparkles size={15} className="text-indigo-500 shrink-0 mt-0.5" />
            <span>
              <b>AI önerisi:</b> Bu akışta WhatsApp adımından önce kişiye özel ürün başlığı + görsel ekleyerek dönüşümü ~%12 artırabilirsin.
              Metinler ürün verisi ve marka tonundan otomatik üretilebilir.
            </span>
          </div>
        </div>
      )}

      {tab === 'journeys' && (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            Her kişinin akış içindeki yolculuğu — hangi adımda, ne açtı/tıkladı, hangi senaryoya geçti. Satıra tıklayarak adım adım zaman çizelgesini aç.
          </p>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Kişi</th>
                  <th className="text-left px-4 py-3 font-medium">Giriş</th>
                  <th className="text-left px-4 py-3 font-medium">Bulunduğu adım</th>
                  <th className="text-left px-4 py-3 font-medium">Durum</th>
                  <th className="text-right px-4 py-3 font-medium">Ciro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {journeys.map((j) => <JourneyRow key={j.id} j={j} />)}
                {journeys.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Bu otomasyon için henüz kişi yolculuğu yok.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audience' && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-sm text-gray-600 space-y-3">
          <div><span className="text-gray-400">Tetikleyici olay:</span> <b className="text-gray-800">{a.trigger}</b></div>
          <div className="flex items-start gap-2">
            <GitBranch size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <span>Her gönderim öncesi otomatik kontrol: <b>izin/İYS</b>, <b>sessiz saat</b>, <b>frekans limiti</b>, kanal aktif/kredili mi. Koşulu geçemeyen kişi o adımı atlar.</span>
          </div>
          <div className="flex items-start gap-2">
            <TrendingUp size={15} className="text-emerald-500 mt-0.5 shrink-0" />
            <span>Kişi hedefe ulaşırsa (ör. sipariş tamamlandı) akış <b>anında durur</b> ve ciro bu otomasyona atfedilir.</span>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
          {[
            ['Sessiz saat penceresine uy', 'Anlık olmayan gönderimler 10:00–20:00 arasına ötelenir', true],
            ['Frekans limiti uygula', 'Aynı kişiye günde 1, haftada 3 mesaj sınırı', true],
            ['İYS izin kontrolü', 'Ticari gönderim öncesi İYS izni doğrulanır', true],
            ['Dönüşümde akışı durdur', 'Sipariş tamamlanınca kalan adımlar iptal edilir', true],
          ].map(([title, desc, on]) => (
            <div key={title as string} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium text-gray-800">{title as string}</div>
                <div className="text-xs text-gray-500">{desc as string}</div>
              </div>
              <span className={clsx('relative inline-flex h-6 w-11 items-center rounded-full', on ? 'bg-emerald-500' : 'bg-gray-300')}>
                <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
              </span>
            </div>
          ))}
          <div className="px-4 py-3 flex items-center justify-between text-gray-500">
            <span className="flex items-center gap-2"><ChevronDown size={14} /> Gelişmiş ayarlar</span>
          </div>
        </div>
      )}
    </div>
  )
}
