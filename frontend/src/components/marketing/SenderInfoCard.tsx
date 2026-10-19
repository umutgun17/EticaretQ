import { useEffect, useState } from 'react'
import { MessageSquare, Mail, Save } from 'lucide-react'
import { senderApi, type SenderInfo } from '@/lib/emailSendingApi'

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

export default function SenderInfoCard() {
  const [data, setData] = useState<SenderInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { senderApi.get().then(setData) }, [])
  if (!data) return <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4 text-sm text-gray-400">Yükleniyor…</div>

  const upd = (patch: Partial<SenderInfo>) => setData({ ...data, ...patch })

  async function save() {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await senderApi.update({
        sms_header: data!.sms_header,
        email_from_name: data!.email_from_name,
        email_from_address: data!.email_from_address,
      })
      setData(r); setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Kaydedilemedi.')
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare size={17} className="text-indigo-600" />
        <h2 className="font-medium text-gray-900">Gönderici bilgileri</h2>
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
            <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1 flex items-center gap-1"><MessageSquare size={13} /> SMS gönderici başlığı</label>
          <input className={inputCls} value={data.sms_header ?? ''} maxLength={11} onChange={(e) => upd({ sms_header: e.target.value.toUpperCase() })} placeholder="TONNYBLACK" />
          <p className="text-[11px] text-gray-400 mt-1">NetGSM'de onaylı başlık olmalı (en fazla 11 karakter).</p>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1 flex items-center gap-1"><Mail size={13} /> E-posta gönderen adı</label>
          <input className={inputCls} value={data.email_from_name ?? ''} onChange={(e) => upd({ email_from_name: e.target.value })} placeholder="Marka Adınız" />
          <p className="text-[11px] text-gray-400 mt-1">Alıcının "Kimden" kısmında göreceği isim.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm text-gray-600 mb-1 flex items-center gap-1"><Mail size={13} /> E-posta gönderen adresi</label>
          <input className={inputCls} value={data.email_from_address ?? ''} onChange={(e) => upd({ email_from_address: e.target.value })} placeholder="bilgi@e.firmadomain.com" />
          <p className="text-[11px] text-gray-400 mt-1">
            DKIM imzası için <b>gönderim alan adında</b> olmalı{data.sending_domain ? <> (<code className="bg-gray-100 px-1 rounded">@{data.sending_domain}</code>)</> : ''}.
          </p>
        </div>
      </div>

      {err && <div className="mt-3 text-xs text-rose-600 bg-rose-50 rounded-lg p-2">{err}</div>}
    </div>
  )
}
