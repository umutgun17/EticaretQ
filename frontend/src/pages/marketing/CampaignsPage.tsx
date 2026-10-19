import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Send, Users, Gauge, ShieldCheck, Plus, Play, Pause, X, Trash2, RefreshCw,
  MessageSquare, ListChecks, FileText, AlertTriangle, CheckCircle2, Eye,
} from 'lucide-react'
import clsx from 'clsx'
import {
  campaignsApi, type Campaign, type WaCapacity, type CampaignSettings, type WaQuality,
  type MarketingListRow, type WaTemplate, type TemplateParamSpec, type ImportResult, type ContactRow,
  type BlacklistRow, type LimitSync, type QualityState, type SegmentOption, type EmailChannelInfo,
} from '@/lib/campaignsApi'

const fmtNum = (v: number) => new Intl.NumberFormat('tr-TR').format(v)
const fmtMoney = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'

const RATING_TR: Record<string, string> = { GREEN: 'Yüksek', YELLOW: 'Orta', RED: 'Düşük' }

export const STATUS_TR: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Taslak', cls: 'bg-gray-100 text-gray-600' },
  sending: { label: 'Gönderiliyor', cls: 'bg-blue-100 text-blue-700' },
  paused: { label: 'Duraklatıldı', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Tamamlandı', cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'İptal', cls: 'bg-gray-200 text-gray-500' },
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-indigo-600' }: { icon: typeof Send; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><Icon size={13} className={color} /> {label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

/** Şablon gövdesindeki {{n}} sayısını bulur. */
export function paramCount(tpl?: WaTemplate): number {
  const body = tpl?.components?.find(c => c.type === 'BODY')?.text ?? ''
  const m = body.match(/\{\{(\d+)\}\}/g) ?? []
  return m.reduce((max, x) => Math.max(max, parseInt(x.replace(/\D/g, ''), 10)), 0)
}

/** Şablonda dinamik URL butonu var mı? (tık takibi ancak bununla olur) */
export function hasDynamicUrlButton(tpl?: WaTemplate): boolean {
  const btns = tpl?.components?.find(c => c.type === 'BUTTONS')?.buttons ?? []
  return btns.some(b => b.type === 'URL' && (b.url ?? '').includes('{{1}}'))
}

// ------------------------------------------------------------- Kampanya oluştur

function CreateCampaignModal({ lists, segments, email, capacity, onClose, onCreated }: {
  lists: MarketingListRow[]
  segments: SegmentOption[]
  email: EmailChannelInfo | null
  capacity: WaCapacity | null
  onClose: () => void
  onCreated: () => void
}) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null)
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [targetType, setTargetType] = useState<'list' | 'segment'>('list')
  const [name, setName] = useState('')
  const [listId, setListId] = useState<number | ''>('')
  const [segmentId, setSegmentId] = useState<number | ''>('')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [tplName, setTplName] = useState('')
  const [params, setParams] = useState<TemplateParamSpec[]>([])
  const [coupon, setCoupon] = useState('')
  const [targetUrl, setTargetUrl] = useState('https://tonnyblack.com.tr')
  const [windowHours, setWindowHours] = useState(3)
  const [cooldownDays, setCooldownDays] = useState(2)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    campaignsApi.templates().then(d => setTemplates((d.data ?? []).filter(t => t.category === 'MARKETING')))
  }, [])

  const tpl = templates?.find(t => t.name === tplName)
  const nParams = paramCount(tpl)
  const dynBtn = hasDynamicUrlButton(tpl)
  const body = tpl?.components?.find(c => c.type === 'BODY')?.text ?? ''
  const selList = lists.find(l => l.id === listId)
  const selSegment = segments.find(s => s.id === segmentId)
  const isEmail = channel === 'email'
  const audienceCount = isEmail
    ? (selSegment?.with_email ?? 0)
    : targetType === 'segment' ? (selSegment?.with_phone ?? 0) : (selList?.contacts_count ?? 0)

  useEffect(() => {
    setParams(prev => Array.from({ length: nParams }, (_, i) => prev[i] ?? { source: 'static', value: '' }))
  }, [nParams])

  const EMAIL_STARTER = `<body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;padding:32px 24px">
    <h2 style="color:#111;margin-top:0">Merhaba {{ad}},</h2>
    <p style="color:#444;font-size:15px;line-height:1.6">Kampanya metniniz buraya…</p>
    <p style="text-align:center;margin:28px 0">
      <a href="https://tonnyblack.com.tr" style="background:#111;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;display:inline-block">Alışverişe Başla</a>
    </p>
    <p style="color:#888;font-size:13px">Kupon kodunuz: <b>{{kupon}}</b></p>
  </div>
</body>`

  async function submit() {
    if (isEmail) {
      if (!name.trim() || !segmentId || !subject.trim() || !bodyHtml.trim()) { setErr('İsim, segment, konu ve içerik zorunlu.'); return }
    } else if (!name.trim() || !tplName || (targetType === 'list' ? !listId : !segmentId)) {
      setErr('İsim, hedef ve şablon zorunlu.'); return
    }
    setSaving(true); setErr(null)
    try {
      await campaignsApi.create({
        name: name.trim(),
        channel,
        list_id: !isEmail && targetType === 'list' ? (listId as number) : null,
        segment_id: (isEmail || targetType === 'segment') ? (segmentId as number) : null,
        ...(isEmail
          ? { subject: subject.trim(), body_html: bodyHtml }
          : {
              template_name: tplName,
              template_lang: tpl?.language ?? 'tr',
              template_params: params,
              url_button: { enabled: dynBtn, target_url: dynBtn ? targetUrl : null },
            }),
        coupon_code: coupon.trim() || null,
        send_window_hours: windowHours,
        cooldown_days: cooldownDays,
      })
      onCreated(); onClose()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Kampanya oluşturulamadı.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Yeni Kampanya</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Kanal seçimi */}
          <div className="flex gap-2">
            {([['whatsapp', 'WhatsApp'], ['email', 'E-posta']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setChannel(k)}
                className={clsx('px-4 py-2 text-sm rounded-lg border font-medium',
                  channel === k ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                {label}
              </button>
            ))}
          </div>
          {isEmail && email && !email.enabled && (
            <div className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle size={12} /> E-posta kanalı kapalı — göndermeden önce Pazarlama Ayarları&apos;ndan gönderici adresi tanımlanmalı.
            </div>
          )}
          {isEmail && email?.enabled && (
            <div className="text-[11px] text-gray-400">Gönderici: {email.from} · günlük limit {fmtNum(email.daily_limit)} (bugün {fmtNum(email.sent_today)} gönderildi)</div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500">Kampanya adı</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={name} onChange={e => setName(e.target.value)} placeholder="Çanta Hediye Ağustos" />
            </label>
            <div className="block">
              <span className="text-xs text-gray-500">Hedef kitle</span>
              {!isEmail && (
                <div className="flex gap-3 mt-1 mb-1 text-xs">
                  <label className="flex items-center gap-1"><input type="radio" checked={targetType === 'list'} onChange={() => setTargetType('list')} /> Liste</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={targetType === 'segment'} onChange={() => setTargetType('segment')} /> Segment</label>
                </div>
              )}
              {(isEmail || targetType === 'segment') ? (
                <select className={clsx(inputCls, 'w-full mt-1')} value={segmentId} onChange={e => setSegmentId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Segment seçin…</option>
                  {segments.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({fmtNum(isEmail ? s.with_email : s.with_phone)} {isEmail ? 'e-postalı' : 'telefonlu'})
                    </option>
                  ))}
                </select>
              ) : (
                <select className={clsx(inputCls, 'w-full mt-1')} value={listId} onChange={e => setListId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Liste seçin…</option>
                  {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({fmtNum(l.contacts_count)} kişi)</option>)}
                </select>
              )}
            </div>
          </div>

          {isEmail && (
            <>
              <label className="block">
                <span className="text-xs text-gray-500">Konu — {'{{ad}}'} ve {'{{kupon}}'} kullanılabilir</span>
                <input className={clsx(inputCls, 'w-full mt-1')} value={subject} onChange={e => setSubject(e.target.value)} placeholder="{{ad}}, size özel %20 indirim 🎁" />
              </label>
              <div className="block">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">HTML içerik — linkler otomatik tık-takipli olur, alta abonelikten çıkış eklenir</span>
                  <div className="flex gap-2 text-xs">
                    {!bodyHtml.trim() && (
                      <button onClick={() => setBodyHtml(EMAIL_STARTER)} className="text-indigo-600 hover:underline">Hazır şablonla başla</button>
                    )}
                    <button onClick={() => setShowPreview(v => !v)} className="text-indigo-600 hover:underline">{showPreview ? 'Kodu göster' : 'Önizle'}</button>
                  </div>
                </div>
                {showPreview ? (
                  <iframe title="önizleme" sandbox="" srcDoc={bodyHtml} className="w-full h-72 mt-1 border border-gray-200 rounded-lg bg-white" />
                ) : (
                  <textarea rows={12} className={clsx(inputCls, 'w-full mt-1 font-mono text-xs')} value={bodyHtml} onChange={e => setBodyHtml(e.target.value)}
                    placeholder="<body>…</body>" />
                )}
              </div>
            </>
          )}

          {!isEmail && (<>
          <label className="block">
            <span className="text-xs text-gray-500">Meta onaylı pazarlama şablonu</span>
            <select className={clsx(inputCls, 'w-full mt-1')} value={tplName} onChange={e => setTplName(e.target.value)}>
              <option value="">{templates === null ? 'Şablonlar yükleniyor…' : 'Şablon seçin…'}</option>
              {(templates ?? []).map(t => (
                <option key={t.name + t.language} value={t.name} disabled={t.status !== 'APPROVED'}>
                  {t.name} {t.status !== 'APPROVED' ? `(${t.status === 'PENDING' ? 'onay bekliyor' : t.status})` : ''}
                </option>
              ))}
            </select>
          </label>

          {tpl && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{body}</div>
          )}

          {nParams > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-600">Şablon değişkenleri</div>
              {params.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-12 shrink-0">{'{{' + (i + 1) + '}}'}</span>
                  <select className={clsx(inputCls, 'w-40')} value={p.source}
                    onChange={e => setParams(ps => ps.map((x, j) => (j === i ? { ...x, source: e.target.value as TemplateParamSpec['source'] } : x)))}>
                    <option value="name">Müşteri adı</option>
                    <option value="coupon">Kupon kodu</option>
                    <option value="static">Sabit metin</option>
                  </select>
                  {p.source === 'static' && (
                    <input className={clsx(inputCls, 'flex-1')} value={p.value ?? ''} placeholder="Değer"
                      onChange={e => setParams(ps => ps.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  )}
                </div>
              ))}
            </div>
          )}
          </>)}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500">Kampanya kupon kodu (dönüşüm takibi için)</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={coupon} onChange={e => setCoupon(e.target.value)} placeholder="CANTA1000" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Gönderim penceresi (saat) — ısıtma hızı</span>
              <input type="number" min={1} max={72} className={clsx(inputCls, 'w-full mt-1')} value={windowHours}
                onChange={e => setWindowHours(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          </div>

          {!isEmail && (dynBtn ? (
            <label className="block">
              <span className="text-xs text-gray-500">Buton hedef adresi (tıklamalar ölçülür)</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
            </label>
          ) : tpl ? (
            <div className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Bu şablonda dinamik URL butonu yok — tıklama ölçümü yapılamaz.</div>
          ) : null)}

          <label className="block">
            <span className="text-xs text-gray-500">Sessizlik süresi — son X günde bu kanaldan pazarlama mesajı alanlar atlanır</span>
            <input type="number" min={0} max={90} className={clsx(inputCls, 'w-full mt-1')} value={cooldownDays}
              onChange={e => setCooldownDays(Math.max(0, Number(e.target.value) || 0))} />
          </label>

          {!isEmail && audienceCount > 0 && capacity && (
            <div className={clsx('rounded-lg border p-3 text-xs',
              audienceCount > capacity.remaining ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700')}>
              {audienceCount > capacity.remaining
                ? `Hedefte ${fmtNum(audienceCount)} kişi var; bugünkü kalan hak ${fmtNum(capacity.remaining)}. Limit AŞILMAZ — kalan kişilere sonraki günlerde otomatik devam edilir.`
                : `Hedefteki ${fmtNum(audienceCount)} kişinin tamamı bugünkü hakka (${fmtNum(capacity.remaining)}) sığıyor; ~${windowHours} saate yayılarak gönderilir.`}
            </div>
          )}
          {isEmail && audienceCount > 0 && email && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 p-3 text-xs">
              Hedefte {fmtNum(audienceCount)} e-postalı kişi var. Günlük limit {fmtNum(email.daily_limit)} —
              tamamı ~{fmtNum(Math.max(1, Math.ceil(audienceCount / Math.max(1, email.daily_limit))))} günde gönderilir.
              Abonelikten çıkanlar ve daha önce çıkmış adresler otomatik atlanır.
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Vazgeç</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Oluşturuluyor…' : 'Taslak Oluştur'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Şablon oluştur

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [buttonText, setButtonText] = useState('Alışverişe Başla')
  const [footer, setFooter] = useState('')
  const [optout, setOptout] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const nParams = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length

  async function submit() {
    setSaving(true); setErr(null)
    try {
      const examples = Array.from({ length: nParams }, (_, i) => (i === 0 ? 'Umut' : 'ORNEK' + (i + 1)))
      await campaignsApi.createTemplate({
        name: name.trim(), body_text: bodyText,
        example_params: examples.length ? examples : undefined,
        footer_text: footer.trim() || undefined,
        button_text: buttonText.trim() || undefined,
        optout_button: optout,
      })
      onCreated(); onClose()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Şablon oluşturulamadı.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Yeni WhatsApp Şablonu (Meta onayına gider)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs text-gray-500">Şablon adı (küçük harf, rakam ve _ )</span>
            <input className={clsx(inputCls, 'w-full mt-1')} value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="kampanya_ornegi" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Mesaj metni — değişkenler: {'{{1}}, {{2}}'} …</span>
            <textarea rows={6} className={clsx(inputCls, 'w-full mt-1')} value={bodyText} onChange={e => setBodyText(e.target.value)}
              placeholder={'Merhaba {{1}} 👋\n\n1.000 TL üzeri siparişinize {{2}} koduyla çanta hediye!'} />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500">Buton yazısı (tık takipli URL butonu; boş = butonsuz)</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={buttonText} onChange={e => setButtonText(e.target.value)} maxLength={25} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Alt bilgi (opsiyonel)</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={footer} onChange={e => setFooter(e.target.value)} maxLength={60} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={optout} onChange={e => setOptout(e.target.checked)} className="rounded border-gray-300 text-emerald-600" />
            "Listeden Çık" butonu ekle — basan numara otomatik karalisteye girer (önerilir)
          </label>
          <div className="text-[11px] text-gray-400">Onay genelde birkaç dakika–birkaç saat sürer. Silinen şablon adı 30 gün yeniden kullanılamaz.</div>
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Vazgeç</button>
          <button onClick={submit} disabled={saving || !name.trim() || !bodyText.trim()}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Gönderiliyor…' : 'Onaya Gönder'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Liste modalı

function ListModal({ list, onClose, onChanged }: { list: MarketingListRow | null; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(list?.name ?? '')
  const [text, setText] = useState('')
  const [minSpent, setMinSpent] = useState('')
  const [lastDays, setLastDays] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [contacts, setContacts] = useState<ContactRow[] | null>(null)
  const [listId, setListId] = useState<number | null>(list?.id ?? null)
  const [count, setCount] = useState(list?.contacts_count ?? 0)

  const loadContacts = useCallback((id: number) => {
    campaignsApi.showList(id).then(d => { setContacts(d.contacts.data); setCount(d.list.contacts_count) })
  }, [])
  useEffect(() => { if (listId) loadContacts(listId) }, [listId, loadContacts])

  async function save() {
    setSaving(true); setErr(null); setResult(null)
    try {
      if (!listId) {
        const d = await campaignsApi.createList({ name: name.trim(), contacts_text: text || undefined })
        setListId(d.list.id); setResult(d.import); setText('')
      } else if (text.trim()) {
        const d = await campaignsApi.addContacts(listId, text)
        setResult(d.import); setText('')
      }
      if (listId) loadContacts(listId)
      onChanged()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Kaydedilemedi.')
    } finally { setSaving(false) }
  }

  async function fillFromCustomers() {
    if (!listId) { setErr('Önce listeyi kaydedin.'); return }
    setSaving(true); setErr(null)
    try {
      const d = await campaignsApi.fillFromCustomers(listId, {
        min_total_spent: minSpent ? Number(minSpent) : undefined,
        last_order_days: lastDays ? Number(lastDays) : undefined,
      })
      setResult(d.import); loadContacts(listId); onChanged()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Doldurulamadı.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{listId ? `Liste: ${name}` : 'Yeni Müşteri Listesi'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {!listId && (
            <label className="block">
              <span className="text-xs text-gray-500">Liste adı</span>
              <input className={clsx(inputCls, 'w-full mt-1')} value={name} onChange={e => setName(e.target.value)} placeholder="VIP Müşteriler" />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-gray-500">Numara ekle — her satıra bir kişi: <code>telefon;isim</code> biçiminde (isim opsiyonel)</span>
            <textarea rows={6} className={clsx(inputCls, 'w-full mt-1 font-mono text-xs')} value={text} onChange={e => setText(e.target.value)}
              placeholder={'05321234567;Ayşe Yılmaz\n05339876543\n+90 543 111 22 33;Mehmet'} />
          </label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-gray-600">Veya müşteri tabanından doldur</div>
            <div className="flex flex-wrap items-center gap-2">
              <input className={clsx(inputCls, 'w-40')} placeholder="Min. toplam harcama ₺" value={minSpent} onChange={e => setMinSpent(e.target.value.replace(/\D/g, ''))} />
              <input className={clsx(inputCls, 'w-44')} placeholder="Son X günde sipariş" value={lastDays} onChange={e => setLastDays(e.target.value.replace(/\D/g, ''))} />
              <button onClick={fillFromCustomers} disabled={saving || !listId}
                className="px-3 py-2 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                Müşterilerden Ekle
              </button>
              {!listId && <span className="text-[11px] text-gray-400">önce listeyi kaydedin</span>}
            </div>
          </div>
          {result && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
              {fmtNum(result.added)} eklendi · {fmtNum(result.duplicate)} zaten vardı · {fmtNum(result.invalid)} geçersiz numara
              {result.invalid_samples.length > 0 && <span className="text-amber-600"> (ör: {result.invalid_samples.join(', ')})</span>}
            </div>
          )}
          {contacts && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Listede {fmtNum(count)} kişi — ilk {contacts.length} gösteriliyor</div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto text-xs">
                {contacts.map(c => (
                  <div key={c.id} className="flex justify-between px-3 py-1.5">
                    <span className="font-mono text-gray-700">{c.phone}</span>
                    <span className="text-gray-500">{c.name ?? '—'}{c.customer_id ? ' · müşteri ✓' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Kapat</button>
          <button onClick={save} disabled={saving || (!listId && !name.trim())}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Kaydediliyor…' : listId ? 'Numaraları Ekle' : 'Listeyi Oluştur'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Karaliste

function BlacklistTab() {
  const [rows, setRows] = useState<BlacklistRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const d = await campaignsApi.blacklist({ q: q || undefined, page })
    setRows(d.blacklist.data); setTotal(d.blacklist.total); setLastPage(d.blacklist.last_page)
  }, [q, page])
  useEffect(() => { load() }, [load])

  async function add() {
    if (!text.trim()) return
    setSaving(true); setMsg(null)
    try {
      const d = await campaignsApi.addBlacklist(text)
      setMsg(`${fmtNum(d.added)} numara karalisteye eklendi${d.invalid ? `, ${fmtNum(d.invalid)} geçersiz` : ''}.`)
      setText(''); await load()
    } finally { setSaving(false) }
  }

  async function remove(r: BlacklistRow) {
    if (!confirm(`${r.identifier} karalisteden çıkarılsın mı? Bu numaraya tekrar mesaj gidebilir.`)) return
    await campaignsApi.removeBlacklist(r.id); await load()
  }

  const SOURCE_TR: Record<string, string> = {
    wa_optout_button: '"Listeden Çık" butonu',
    panel: 'panelden eklendi',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-1">Karalisteye numara ekle</div>
        <div className="text-xs text-gray-400 mb-2">Buradaki numaralara WhatsApp üzerinden HİÇBİR gönderim yapılmaz — kampanya, sepet hatırlatma, sipariş bildirimi dâhil.</div>
        <textarea rows={3} className={clsx(inputCls, 'w-full font-mono text-xs')} value={text} onChange={e => setText(e.target.value)}
          placeholder={'05321234567\n0533 987 65 43'} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-emerald-700">{msg}</span>
          <button onClick={add} disabled={saving || !text.trim()}
            className="px-3 py-1.5 text-xs bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50">Karalisteye Ekle</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-700">Karaliste ({fmtNum(total)} numara)</div>
          <input className={clsx(inputCls, '!py-1.5 text-xs w-44')} placeholder="Numara ara…" value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }} />
        </div>
        <div className="divide-y divide-gray-50">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
              <div>
                <span className="font-mono text-gray-800">{r.identifier}</span>
                <span className="ml-2 text-gray-400">
                  {r.channel === 'all' ? 'tüm kanallar' : 'WhatsApp'} · {SOURCE_TR[r.source ?? ''] ?? r.reason ?? '—'} · {fmtDate(r.created_at)}
                </span>
              </div>
              <button onClick={() => remove(r)} className="p-1 text-gray-300 hover:text-red-600" title="Karalisteden çıkar"><Trash2 size={14} /></button>
            </div>
          ))}
          {rows.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">Karaliste boş.</div>}
        </div>
        {lastPage > 1 && (
          <div className="flex justify-end gap-1.5 px-4 py-3 border-t border-gray-100 text-xs">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">Önceki</button>
            <button disabled={page >= lastPage} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">Sonraki</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Ana sayfa

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [capacity, setCapacity] = useState<WaCapacity | null>(null)
  const [settings, setSettings] = useState<CampaignSettings | null>(null)
  const [quality, setQuality] = useState<WaQuality>({})
  const [qualityState, setQualityState] = useState<QualityState | null>(null)
  const [showQualityHistory, setShowQualityHistory] = useState(false)
  const [lists, setLists] = useState<MarketingListRow[]>([])
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [emailInfo, setEmailInfo] = useState<EmailChannelInfo | null>(null)
  const [limitSync, setLimitSync] = useState<LimitSync>({ tier: null, synced_at: null })
  const [tab, setTab] = useState<'campaigns' | 'lists' | 'blacklist'>('campaigns')
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [editList, setEditList] = useState<MarketingListRow | null | 'new'>(null)
  const [editingLimits, setEditingLimits] = useState(false)
  const [limitDraft, setLimitDraft] = useState({ limit: 0, reserve: 0, email: 0 })
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([campaignsApi.index(), campaignsApi.lists()])
    setCampaigns(c.campaigns); setCapacity(c.capacity); setSettings(c.settings); setQuality(c.quality ?? {})
    setQualityState(c.quality_state ?? null)
    setLimitSync(c.limit_sync ?? { tier: null, synced_at: null })
    setLists(l.lists); setSegments(c.segments ?? []); setEmailInfo(c.email ?? null)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    // Kalite nedeniyle otomatik duraklatılmışken de yenile — otomatik devam panele kendiliğinden yansısın.
    const anySending = campaigns.some(c => c.status === 'sending' || c.auto_paused_quality)
    if (!anySending) return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [campaigns, load])

  async function action(c: Campaign, act: 'start' | 'pause' | 'resume' | 'cancel') {
    if (act === 'cancel' && !confirm('Kampanya iptal edilsin mi? Bekleyen alıcılara gönderim yapılmaz.')) return
    setBusy(c.id); setErr(null)
    try {
      await campaignsApi.update(c.id, { action: act })
      await load()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'İşlem başarısız.')
    } finally { setBusy(null) }
  }

  async function removeCampaign(c: Campaign) {
    if (!confirm(`"${c.name}" silinsin mi?`)) return
    setBusy(c.id)
    try { await campaignsApi.destroy(c.id); await load() } finally { setBusy(null) }
  }

  async function removeList(l: MarketingListRow) {
    if (!confirm(`"${l.name}" listesi (${fmtNum(l.contacts_count)} kişi) silinsin mi?`)) return
    try { await campaignsApi.deleteList(l.id); await load() } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Liste silinemedi.')
    }
  }

  async function saveLimits() {
    const d = await campaignsApi.updateSettings({
      wa_daily_unique_limit: limitDraft.limit,
      wa_reserve_for_automations: limitDraft.reserve,
      email_daily_limit: limitDraft.email,
    })
    setCapacity(d.capacity); setSettings(d.settings); setEditingLimits(false)
  }

  async function sendTestEmail(c: Campaign) {
    const to = window.prompt('Test e-postası gönderilecek adres:')
    if (!to) return
    setBusy(c.id); setErr(null)
    try {
      await campaignsApi.testEmail(c.id, to.trim())
      window.alert(`Test e-postası ${to.trim()} adresine gönderildi.`)
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Test gönderilemedi.')
    } finally { setBusy(null) }
  }

  const qualityRating = quality.quality_rating ?? qualityState?.rating ?? null
  const qualityTr = useMemo(() => {
    if (qualityRating === 'GREEN') return { label: 'Yüksek (yeşil)', color: 'text-emerald-600' }
    if (qualityRating === 'YELLOW') return { label: 'Orta (sarı) — dikkat', color: 'text-amber-600' }
    if (qualityRating === 'RED') return { label: 'Düşük (kırmızı) — otomatik koruma devrede', color: 'text-red-600' }
    return { label: '—', color: 'text-gray-400' }
  }, [qualityRating])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Send size={20} className="text-blue-600" /> Toplu Kampanyalar</h1>
          <p className="text-sm text-gray-500 mt-0.5">WhatsApp + e-posta — liste veya segment hedefli gönderim; günlük limite ve ısıtma hızına otomatik uyar.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTemplate(true)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
            <FileText size={15} /> Şablon Oluştur
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5">
            <Plus size={15} /> Yeni Kampanya
          </button>
        </div>
      </div>

      {/* Kalite koruması bandı */}
      {qualityRating === 'RED' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-sm font-medium text-red-700 flex items-center gap-1.5">
            <AlertTriangle size={15} /> Numara kalitesi DÜŞÜK (Meta: RED) — kampanya gönderimleri otomatik duraklatıldı
          </div>
          <p className="text-xs text-red-600 mt-1.5 leading-relaxed">
            Meta bu puanı son 7 gündeki alıcı geri bildirimlerinden (engelleme/şikâyet) hesaplar. Bu numara sipariş
            bildirimi ve müşteri mesajlaşmasını da taşıdığı için koruma devreye girer: kalite Düşük olduğu sürece
            kampanya gönderimi yapılmaz. Kalite Orta/Yüksek seviyeye dönünce duraklatılan kampanyalar kaldığı yerden
            <b> otomatik</b> devam eder — işlem yapmanız gerekmez. Elle devam ettirseniz bile kalite Düşük kaldıkça
            sistem bir sonraki turda yeniden duraklatır.
          </p>
        </div>
      )}

      {/* Kapasite paneli */}
      {capacity && settings && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Gauge size={15} className="text-indigo-600" /> 24 Saatlik Gönderim Kapasitesi</div>
            <div className="flex items-center gap-3 text-xs">
              <span className={clsx('flex items-center gap-1', qualityTr.color)}>
                <ShieldCheck size={13} /> Numara kalitesi: {qualityTr.label}
                {qualityState?.checked_at && <span className="text-gray-400 font-normal">· kontrol {fmtDate(qualityState.checked_at)}</span>}
              </span>
              {(qualityState?.history?.length ?? 0) > 0 && (
                <button onClick={() => setShowQualityHistory(v => !v)} className="text-indigo-600 hover:underline">
                  {showQualityHistory ? 'Geçmişi gizle' : 'Kalite geçmişi'}
                </button>
              )}
              {editingLimits ? (
                <span className="flex items-center gap-1.5">
                  <input type="number" className={clsx(inputCls, 'w-24 !py-1')} value={limitDraft.limit} onChange={e => setLimitDraft(d => ({ ...d, limit: Number(e.target.value) || 0 }))} />
                  <span className="text-gray-400">limit ·</span>
                  <input type="number" className={clsx(inputCls, 'w-20 !py-1')} value={limitDraft.reserve} onChange={e => setLimitDraft(d => ({ ...d, reserve: Number(e.target.value) || 0 }))} />
                  <span className="text-gray-400">rezerv ·</span>
                  <input type="number" className={clsx(inputCls, 'w-24 !py-1')} value={limitDraft.email} onChange={e => setLimitDraft(d => ({ ...d, email: Number(e.target.value) || 0 }))} />
                  <span className="text-gray-400">e-posta/gün</span>
                  <button onClick={saveLimits} className="px-2 py-1 bg-emerald-600 text-white rounded">Kaydet</button>
                  <button onClick={() => setEditingLimits(false)} className="px-2 py-1 text-gray-500">İptal</button>
                </span>
              ) : (
                <button onClick={() => { setLimitDraft({ limit: settings.wa_daily_unique_limit, reserve: settings.wa_reserve_for_automations, email: settings.email_daily_limit ?? 1000 }); setEditingLimits(true) }}
                  className="text-indigo-600 hover:underline">Limitleri düzenle</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Gauge} label="Meta limiti (tekil kişi / 24s)" value={fmtNum(capacity.limit)}
              sub={limitSync.tier ? `Meta'dan otomatik senkron: ${limitSync.tier} (${fmtDate(limitSync.synced_at)})` : "WhatsApp Manager'daki mesajlaşma limitinizle aynı olmalı; Meta limit değişikliklerinde otomatik güncellenir"} />
            <StatCard icon={MessageSquare} label="Son 24 saatte kullanılan" value={fmtNum(capacity.used_24h)} sub="sipariş bildirimi + otomasyon + kampanya" color="text-blue-600" />
            <StatCard icon={ShieldCheck} label="Otomasyon rezervi" value={fmtNum(capacity.reserve)} sub="sipariş bildirimleri için ayrılan pay" color="text-amber-600" />
            <StatCard icon={CheckCircle2} label="Kampanyaya kalan hak" value={fmtNum(capacity.remaining)} sub="bu sayı AŞILMAZ; artan ertesi güne devreder" color="text-emerald-600" />
          </div>
          <div className="mt-3 text-[11px] text-gray-400 flex items-center gap-1">
            <ShieldCheck size={11} /> Otomatik koruma: numara kalitesi Düşük (kırmızı) olduğunda gönderen kampanyalar
            duraklatılır, kalite düzelince kaldığı yerden otomatik devam eder. Kalite her turda Meta&apos;dan kontrol edilir;
            Meta&apos;nın anlık kalite bildirimleri (webhook) beklemeden işlenir.
          </div>
          {showQualityHistory && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <div className="text-[11px] font-medium text-gray-500 mb-1">Kalite geçişleri (son {qualityState?.history.length ?? 0})</div>
              <div className="space-y-0.5">
                {qualityState?.history.map((h, i) => (
                  <div key={i} className="text-[11px] text-gray-500 font-mono">
                    {fmtDate(h.at)} · {RATING_TR[h.from ?? ''] ?? '—'} → <span className={h.to === 'RED' ? 'text-red-600' : h.to === 'GREEN' ? 'text-emerald-600' : 'text-amber-600'}>{RATING_TR[h.to] ?? h.to}</span>
                    <span className="text-gray-400"> ({h.source.startsWith('webhook') ? 'Meta bildirimi' : 'periyodik kontrol'})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-gray-200">
        {([['campaigns', 'Kampanyalar'], ['lists', 'Müşteri Listeleri'], ['blacklist', 'Karaliste']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'campaigns' && (
        <div className="space-y-3">
          {campaigns.length === 0 && (
            <div className="text-center text-gray-400 py-14 bg-white rounded-xl border border-gray-200">
              Henüz kampanya yok. Önce “Müşteri Listeleri” sekmesinden liste oluşturun, sonra “Yeni Kampanya” ile başlayın.
            </div>
          )}
          {campaigns.map(c => {
            const st = STATUS_TR[c.status] ?? STATUS_TR.draft
            const pct = c.stats.total > 0 ? Math.round(((c.stats.sent + c.stats.skipped + c.stats.failed) / c.stats.total) * 100) : 0
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Link to={`/marketing/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-emerald-700">{c.name}</Link>
                    <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-medium',
                      c.channel === 'email' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700')}>
                      {c.channel === 'email' ? 'E-posta' : 'WhatsApp'}
                    </span>
                    <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
                    {c.coupon_code && <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono">{c.coupon_code}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.channel === 'email' && (
                      <button onClick={() => sendTestEmail(c)} disabled={busy === c.id}
                        className="px-2 py-1 text-[11px] border border-indigo-200 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-40" title="Test e-postası gönder">
                        Test Gönder
                      </button>
                    )}
                    <Link to={`/marketing/campaigns/${c.id}`} className="p-1.5 text-gray-400 hover:text-indigo-600" title="Detay"><Eye size={16} /></Link>
                    {(c.status === 'draft' || c.status === 'paused') && (
                      <button onClick={() => action(c, c.status === 'draft' ? 'start' : 'resume')} disabled={busy === c.id}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 disabled:opacity-40" title={c.status === 'draft' ? 'Başlat' : 'Devam et'}><Play size={16} /></button>
                    )}
                    {c.status === 'sending' && (
                      <button onClick={() => action(c, 'pause')} disabled={busy === c.id} className="p-1.5 text-gray-400 hover:text-amber-600 disabled:opacity-40" title="Duraklat"><Pause size={16} /></button>
                    )}
                    {['draft', 'sending', 'paused'].includes(c.status) && (
                      <button onClick={() => action(c, 'cancel')} disabled={busy === c.id} className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-40" title="İptal et"><X size={16} /></button>
                    )}
                    {['draft', 'cancelled'].includes(c.status) && (
                      <button onClick={() => removeCampaign(c)} disabled={busy === c.id} className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-40" title="Sil"><Trash2 size={16} /></button>
                    )}
                  </div>
                </div>
                {c.paused_reason && c.status === 'paused' && (
                  <div className={clsx('mt-1.5 text-[11px] flex items-center gap-1', c.auto_paused_quality ? 'text-red-600' : 'text-amber-600')}>
                    <AlertTriangle size={11} /> {c.paused_reason}{c.auto_paused_quality && ' — işlem gerekmez, sistem takipte'}
                  </div>
                )}
                <div className="mt-2 text-xs text-gray-500">
                  {c.list_name ?? 'Hedef yok'}
                  {c.channel === 'email'
                    ? <> · konu: <span className="italic">{c.subject ?? '—'}</span></>
                    : <> · şablon: <span className="font-mono">{c.template_name}</span></>}
                  {' '}· {c.send_window_hours} saatlik pencere
                  {c.started_at && <> · başladı: {fmtDate(c.started_at)}</>}
                </div>
                {c.status !== 'draft' && (
                  <>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-500 shrink-0">%{c.progress_pct} tamamlandı</span>
                    </div>
                    {(c.stats.pending > 0 || c.eta_at) && c.status !== 'cancelled' && (
                      <div className="mt-1 text-[11px] text-gray-400">
                        {fmtNum(c.stats.pending)} kişi sırada{c.eta_at && <> · tahmini bitiş: <b className="text-gray-600">{fmtDate(c.eta_at)}</b></>}
                      </div>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                      <span><b>{fmtNum(c.stats.sent)}</b>/{fmtNum(c.stats.total)} gönderildi</span>
                      {c.channel !== 'email' && <span>{fmtNum(c.stats.delivered)} ulaştı</span>}
                      <span>{fmtNum(c.stats.read)} {c.channel === 'email' ? 'açtı' : 'okundu'}</span>
                      <span>{fmtNum(c.stats.clicked)} tıkladı</span>
                      <span className="text-emerald-700"><b>{fmtNum(c.stats.converted)}</b> satın aldı ({fmtNum(c.stats.coupon_used)} kuponla)</span>
                      <span className="text-emerald-700 font-medium">{fmtMoney(c.stats.revenue)}</span>
                      {c.stats.failed > 0 && <span className="text-red-500">{fmtNum(c.stats.failed)} hata</span>}
                      {c.stats.skipped > 0 && <span className="text-gray-400">{fmtNum(c.stats.skipped)} atlandı</span>}
                      {c.stats.blacklisted > 0 && <span className="text-red-500">{fmtNum(c.stats.blacklisted)} karaliste</span>}
                    </div>
                  </>
                )}
                {c.status === 'draft' && (
                  <div className="mt-2 text-xs text-gray-400">Hedefte {fmtNum(c.list_count)} kişi — “Başlat”a basınca hedef kopyalanır ve gönderim pencere hızında başlar.</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'lists' && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <div className="flex justify-between items-center px-4 py-3">
            <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><ListChecks size={15} className="text-indigo-600" /> Müşteri Listeleri</div>
            <button onClick={() => setEditList('new')} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1">
              <Plus size={13} /> Yeni Liste
            </button>
          </div>
          {lists.length === 0 && <div className="px-4 py-10 text-center text-gray-400 text-sm">Henüz liste yok.</div>}
          {lists.map(l => (
            <div key={l.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <button onClick={() => setEditList(l)} className="text-sm font-medium text-gray-800 hover:text-emerald-700">{l.name}</button>
                <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Users size={11} /> {fmtNum(l.contacts_count)} kişi · {fmtDate(l.created_at)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditList(l)} className="p-1.5 text-gray-400 hover:text-indigo-600" title="Görüntüle / ekle"><RefreshCw size={15} /></button>
                <button onClick={() => removeList(l)} className="p-1.5 text-gray-400 hover:text-red-600" title="Sil"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'blacklist' && <BlacklistTab />}

      {showCreate && <CreateCampaignModal lists={lists} segments={segments} email={emailInfo} capacity={capacity} onClose={() => setShowCreate(false)} onCreated={load} />}
      {showTemplate && <CreateTemplateModal onClose={() => setShowTemplate(false)} onCreated={load} />}
      {editList !== null && <ListModal list={editList === 'new' ? null : editList} onClose={() => setEditList(null)} onChanged={load} />}
    </div>
  )
}
