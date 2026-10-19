import { useEffect, useState } from 'react'
import { Server, Globe, Check, Copy, RefreshCw, AlertTriangle, Mail } from 'lucide-react'
import clsx from 'clsx'
import { emailSendingApi, type EmailSendingConfig, type DnsRecord } from '@/lib/emailSendingApi'

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
      title="Kopyala"
      className="shrink-0 text-gray-400 hover:text-indigo-600"
    >
      {done ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
    </button>
  )
}

export default function EmailSendingCard({ embedded = false }: { embedded?: boolean } = {}) {
  const [config, setConfig] = useState<EmailSendingConfig | null>(null)
  const [records, setRecords] = useState<DnsRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    emailSendingApi.get()
      .then((d) => { setConfig(d.config); setRecords(d.records) })
      .finally(() => setLoading(false))
  }, [])

  async function handleVerify() {
    setVerifying(true)
    try {
      const r = await emailSendingApi.verify()
      setRecords(r.records)
      setVerified(r.verified)
    } finally { setVerifying(false) }
  }

  async function handleToggle() {
    if (!config) return
    setToggling(true)
    try {
      const r = await emailSendingApi.toggle(!config.enabled)
      setConfig({ ...config, enabled: r.email_enabled })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      if (msg) alert(msg)
    } finally { setToggling(false) }
  }

  if (loading) return <div className="bg-white rounded-lg border border-gray-200 p-5 mb-5 text-sm text-gray-400">Gönderim bilgileri yükleniyor…</div>

  if (!config?.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>Gönderim domaini henüz kurulmadı. Sunucuda <code className="bg-amber-100 px-1 rounded">marketing:email-setup</code> komutu çalıştırılmalı.</div>
      </div>
    )
  }

  const allOk = records.length > 0 && records.every((r) => r.ok)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Server size={17} className="text-indigo-600" />
        <h2 className="font-medium text-gray-900">E-posta Gönderim Alan Adı</h2>
        <span className={clsx('ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full', config.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
          <Mail size={11} /> {config.enabled ? 'Aktif' : 'Kapalı'}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        E-postalar bizim sunucumuzdan çıkar ama firmanın kendi adresinden görünür. Aşağıdaki 3 DNS kaydını firmanın DNS paneline ekletin; yayılınca "Doğrula"ya basın.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
        <div>
          <div className="text-[11px] text-gray-400 flex items-center gap-1"><Globe size={11} /> Gönderim domaini</div>
          <div className="font-mono text-gray-800 text-xs mt-0.5">{config.sending_domain}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-400 flex items-center gap-1"><Mail size={11} /> Gönderici</div>
          <div className="font-mono text-gray-800 text-xs mt-0.5">{config.from_address}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-400">Sunucu IP</div>
          <div className="font-mono text-gray-800 text-xs mt-0.5">{config.ip ?? '-'}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button onClick={handleVerify} disabled={verifying} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw size={14} className={verifying ? 'animate-spin' : ''} /> {verifying ? 'Kontrol ediliyor…' : 'Doğrula'}
        </button>
        {verified !== null && (
          verified
            ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={13} /> Tüm kayıtlar doğrulandı — gönderime hazır</span>
            : <span className="inline-flex items-center gap-1 text-xs text-amber-600"><AlertTriangle size={13} /> Bazı kayıtlar henüz yayılmamış</span>
        )}
        {!embedded && (
          <button
            onClick={handleToggle}
            disabled={toggling || (!config.enabled && !allOk)}
            title={!config.enabled && !allOk ? 'Önce DNS kayıtlarını doğrulayın' : ''}
            className={clsx('ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50',
              config.enabled ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-600 text-white hover:bg-emerald-700')}
          >
            {config.enabled ? 'Gönderimi Kapat' : 'Gönderimi Aç'}
          </button>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Amaç</th>
              <th className="text-left px-3 py-2 font-medium">Tür</th>
              <th className="text-left px-3 py-2 font-medium">Host</th>
              <th className="text-left px-3 py-2 font-medium">Değer</th>
              <th className="text-center px-3 py-2 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {records.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50 align-top">
                <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">{r.purpose}</td>
                <td className="px-3 py-2 text-gray-500">{r.type}</td>
                <td className="px-3 py-2 font-mono text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="break-all">{r.host}</span>
                    <CopyBtn text={r.host} />
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-gray-600">
                  <span className="inline-flex items-start gap-1.5">
                    <span className="break-all max-w-[260px] inline-block">{r.value}</span>
                    <CopyBtn text={r.value} />
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  {r.ok === undefined
                    ? <span className="text-gray-300">—</span>
                    : r.ok
                      ? <Check size={15} className="text-emerald-500 inline" />
                      : <AlertTriangle size={14} className="text-amber-500 inline" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        SPF + DKIM + DMARC tamamlandığında "From" firmanın alt alan adından görünür ve Gmail/Outlook "doğrulanmış" kabul eder. DNS yayılması 1–48 saat sürebilir.
      </p>

      {/* Spam'a düşmeme checklist'i */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="text-xs font-medium text-gray-700 mb-2">Spam koruması</div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {[
            { ok: records.find((r) => r.purpose === 'SPF')?.ok, label: 'SPF (gönderim yetkisi)' },
            { ok: records.find((r) => r.purpose === 'DKIM')?.ok, label: 'DKIM (imza)' },
            { ok: records.find((r) => r.purpose === 'DMARC')?.ok, label: 'DMARC (politika)' },
            { ok: true, label: 'Tek-tık abonelik iptali (RFC 8058)' },
            { ok: true, label: 'Suppression listesi (iptal/bounce engeli)' },
            { ok: true, label: 'HTML + düz metin alternatifi' },
          ].map((it, i) => (
            <li key={i} className="flex items-center gap-1.5 text-gray-600">
              {it.ok === true
                ? <Check size={13} className="text-emerald-500 shrink-0" />
                : it.ok === false
                  ? <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                  : <span className="w-[13px] text-center text-gray-300 shrink-0">–</span>}
              {it.label}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-400 mt-2">
          Ayrıca önerilir: sunucu IP'sinin <b>PTR/ters DNS</b> kaydı (hosting sağlayıcısından), gönderim hacmini kademeli artırma (warm-up) ve düşük başlangıçta DMARC <code className="bg-gray-100 px-1 rounded">p=none</code>.
        </p>
      </div>
    </div>
  )
}
