import { useEffect, useState, type ReactNode } from 'react'
import {
  Settings2, Mail, MessageSquare, Bell, Save, Check, Copy, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import clsx from 'clsx'
import { marketingChannelsApi, type MarketingChannels } from '@/lib/marketingChannelsApi'
import EmailSendingCard from '@/components/marketing/EmailSendingCard'
import SendingPrefsCard from '@/components/marketing/SendingPrefsCard'

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled}
      className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-emerald-600' : 'bg-gray-300')}>
      <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

function ChannelCard({ icon: Icon, title, desc, on, onToggle, toggling, children }:
  { icon: typeof Mail; title: string; desc: string; on: boolean; onToggle: () => void; toggling?: boolean; children?: ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className={clsx('w-11 h-11 rounded-2xl flex items-center justify-center shrink-0', on ? 'bg-indigo-50' : 'bg-gray-100')}>
          <Icon size={20} className={on ? 'text-indigo-600' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{title}</span>
            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium', on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
              {on ? 'Aktif' : 'Kapalı'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        <Toggle on={on} onToggle={onToggle} disabled={toggling} />
      </div>
      {on && children && <div className="border-t border-gray-100 p-4 bg-gray-50/50">{children}</div>}
    </div>
  )
}

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-start gap-2 bg-white border border-gray-200 rounded-lg p-2">
        <code className={clsx('flex-1 text-[11px] text-gray-700 break-all', mono && 'font-mono')}>{value}</code>
        <button onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}
          className="shrink-0 text-gray-400 hover:text-indigo-600" title="Kopyala">
          {done ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

const POSITIONS = [
  { v: 'top-left', l: 'Sol üst' }, { v: 'top-right', l: 'Sağ üst' },
  { v: 'bottom-left', l: 'Sol alt' }, { v: 'bottom-right', l: 'Sağ alt' },
]

export default function MarketingSettingsPage() {
  const [c, setC] = useState<MarketingChannels | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function load() { setC(await marketingChannelsApi.get()) }
  useEffect(() => { load() }, [])
  if (!c) return <div className="p-6 text-center text-gray-400">Yükleniyor…</div>

  async function patch(part: Record<string, unknown>, key: string) {
    setBusy(key)
    try { setC(await marketingChannelsApi.update(part)); setSaved(key); setTimeout(() => setSaved(null), 2000) }
    catch (e: unknown) { const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message; if (m) alert(m) }
    finally { setBusy(null) }
  }
  const SaveBtn = ({ k, onClick }: { k: string; onClick: () => void }) => (
    <div className="flex items-center gap-2">
      {saved === k && <span className="text-xs text-emerald-600">Kaydedildi ✓</span>}
      <button onClick={onClick} disabled={busy === k} className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
        <Save size={14} /> Kaydet
      </button>
    </div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 className="text-indigo-600" size={26} />
        <h1 className="text-xl font-extrabold text-gray-900">Ayarlar</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">Her kanalı açıp ayarlarını yapılandırın. Kapalı kanalların ayarları gizlenir.</p>

      {/* E-POSTA */}
      <ChannelCard icon={Mail} title="E-posta" desc="Kendi alan adınızdan (DKIM imzalı) e-posta gönderimi."
        on={c.email.enabled} toggling={busy === 'email-toggle'}
        onToggle={() => patch({ email: { enabled: !c.email.enabled } }, 'email-toggle')}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Gönderen adı</label>
              <input className={clsx(inputCls, 'w-full')} value={c.email.from_name ?? ''} onChange={(e) => setC({ ...c, email: { ...c.email, from_name: e.target.value } })} placeholder="Marka Adınız" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Gönderen adresi</label>
              <input className={clsx(inputCls, 'w-full')} value={c.email.from_address ?? ''} onChange={(e) => setC({ ...c, email: { ...c.email, from_address: e.target.value } })} placeholder="bilgi@e.firma.com" />
            </div>
          </div>
          <div className="flex justify-end"><SaveBtn k="email-info" onClick={() => patch({ email: { from_name: c.email.from_name, from_address: c.email.from_address } }, 'email-info')} /></div>
          <EmailSendingCard embedded />
        </div>
      </ChannelCard>

      {/* SMS */}
      <ChannelCard icon={MessageSquare} title="SMS" desc="NetGSM üzerinden SMS gönderimi."
        on={c.sms.enabled} toggling={busy === 'sms-toggle'}
        onToggle={() => patch({ sms: { enabled: !c.sms.enabled } }, 'sms-toggle')}>
        <div className="space-y-3">
          <div className={clsx('flex items-center gap-2 text-xs rounded-lg p-2.5', c.sms.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {c.sms.connected ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {c.sms.connected ? 'NetGSM hesabı bağlı.' : 'NetGSM kanalı bağlı değil — Kanallar bölümünden ekleyin.'}
          </div>
          <div className="max-w-xs">
            <label className="block text-sm text-gray-600 mb-1">SMS gönderici başlığı</label>
            <input className={clsx(inputCls, 'w-full')} maxLength={11} value={c.sms.header ?? ''} onChange={(e) => setC({ ...c, sms: { ...c.sms, header: e.target.value.toUpperCase() } })} placeholder="TONNYBLACK" />
            <p className="text-[11px] text-gray-400 mt-1">NetGSM'de onaylı başlık (en fazla 11 karakter).</p>
          </div>
          <div className="flex justify-end"><SaveBtn k="sms-info" onClick={() => patch({ sms: { header: c.sms.header } }, 'sms-info')} /></div>
        </div>
      </ChannelCard>

      {/* WHATSAPP */}
      <ChannelCard icon={MessageSquare} title="WhatsApp" desc="Meta WhatsApp Cloud API ile mesajlaşma."
        on={c.whatsapp.enabled} toggling={busy === 'wa-toggle'}
        onToggle={() => patch({ whatsapp: { enabled: !c.whatsapp.enabled } }, 'wa-toggle')}>
        <div className={clsx('flex items-start gap-2 text-xs rounded-lg p-3', c.whatsapp.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          {c.whatsapp.configured ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
          {c.whatsapp.configured
            ? 'WhatsApp numarası bağlı — proaktif gönderim için Meta onaylı şablon gerekir.'
            : 'WhatsApp henüz bağlı değil. Meta\'yı yeniden bağlayıp telefon numarası (phone_number_id) tanımlayın; ardından bu kanal kullanılabilir.'}
        </div>
      </ChannelCard>

      {/* WEB PUSH */}
      <ChannelCard icon={Bell} title="Web Push" desc="Tarayıcı bildirimi — site ziyaretçilerine kampanya/indirim."
        on={c.push.enabled} toggling={busy === 'push-toggle'}
        onToggle={() => patch({ push: { enabled: !c.push.enabled } }, 'push-toggle')}>
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-3">
            <div className="text-xs font-medium text-indigo-900">Siteye eklenecek kod</div>
            <CopyRow label="1) Sitenin <head> bölümüne ekleyin:" value={c.push.embed_script} />
            <CopyRow label={`2) Site köküne "${c.push.sw_file}" dosyası oluşturup içine yazın:`} value={c.push.sw_content} />
            <p className="text-[11px] text-indigo-700/70">Bu iki adım eklenince siteniz push bildirimlerini destekler.</p>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">İzin verilen alan adları</label>
            <input className={clsx(inputCls, 'w-full')} value={c.push.domains} onChange={(e) => setC({ ...c, push: { ...c.push, domains: e.target.value } })} placeholder="firma.com, *.firma.com" />
            <p className="text-[11px] text-gray-400 mt-1">Virgülle ayırın. Yalnızca bu alan adlarından abonelik kabul edilir.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Onay kutusu başlığı</label>
              <input className={clsx(inputCls, 'w-full')} value={c.push.prompt.title} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, title: e.target.value } } })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Alt metin</label>
              <input className={clsx(inputCls, 'w-full')} value={c.push.prompt.body} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, body: e.target.value } } })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Konum</label>
              <select className={clsx(inputCls, 'w-full')} value={c.push.prompt.position} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, position: e.target.value } } })}>
                {POSITIONS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tema rengi</label>
              <input type="color" className="w-full h-[38px] border border-gray-300 rounded-lg" value={c.push.prompt.color} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, color: e.target.value } } })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Gösterim gecikmesi (sn)</label>
              <input type="number" min={0} className={clsx(inputCls, 'w-full')} value={c.push.prompt.delay} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, delay: +e.target.value } } })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">"Şimdi değil" erteleme (gün)</label>
              <input type="number" min={1} className={clsx(inputCls, 'w-full')} value={c.push.prompt.snooze_days} onChange={(e) => setC({ ...c, push: { ...c.push, prompt: { ...c.push.prompt, snooze_days: +e.target.value } } })} />
            </div>
          </div>
          <div className="flex justify-end">
            <SaveBtn k="push-info" onClick={() => patch({ push: { domains: c.push.domains, prompt: c.push.prompt } }, 'push-info')} />
          </div>
        </div>
      </ChannelCard>

      {/* Global: gönderim saatleri + frekans */}
      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-3">Genel gönderim kuralları</h2>
      <SendingPrefsCard />
    </div>
  )
}
