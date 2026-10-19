import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { returnsListPath } from './returnsListState'
import {
  ArrowLeft, CheckCircle2, XCircle, Truck, Upload, Clock, AlertTriangle, ShieldCheck, Paperclip, Wallet, Copy, RefreshCw, StickyNote,
  ExternalLink, PackageCheck, Landmark, Banknote, PackageX, Gift, Calculator, Receipt, MessageSquareText, Info as InfoIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/contexts/AuthContext'
import {
  returnsAdminApi,
  statusBadgeClass,
  cargoProviderLabel,
  fmtMoney,
  fmtHoursLeft,
  typeBadge,
  type ReturnDetailResponse,
  type ReturnDetail,
} from '@/lib/returnsAdminApi'

const REJECTABLE = ['pending', 'awaiting_shipment', 'in_transit', 'received', 'staff_approved', 'processing']

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [data, setData] = useState<ReturnDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectFile, setRejectFile] = useState<File | null>(null)
  const [showReject, setShowReject] = useState(false)

  // Kusur bildirimi kararı (yalnızca yönetici): red nedeni tanımlı listeden seçilir
  const [showDefectReject, setShowDefectReject] = useState(false)
  const [defectReason, setDefectReason] = useState('')
  const [defectNote, setDefectNote] = useState('')

  // Personel notu (iç kayıt — telefonla çözülen kapsam değişiklikleri vb.; müşteri görmez)
  const [staffNote, setStaffNote] = useState('')

  // Havale ile iade (kapıda ödeme): hesap bilgisi girişi + "havale yapıldı" kapanışı
  const [showBank, setShowBank] = useState(false)
  const [bankForm, setBankForm] = useState({ bank_name: '', account_holder: '', iban: '' })
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferNote, setTransferNote] = useState('')
  const [transferTxn, setTransferTxn] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setData(await returnsAdminApi.detail(Number(id)))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      setShowReject(false)
      setRejectReason('')
      setRejectFile(null)
      setShowDefectReject(false)
      setDefectReason('')
      setDefectNote('')
      setStaffNote('')
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'İşlem başarısız oldu.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !data) {
    return <div className="p-6 text-gray-400">Yükleniyor...</div>
  }

  const r = data.request
  const num = Number(id)
  const canRejectNow = REJECTABLE.includes(r.status)
  // İADE/KUSUR: personel gelen kargoyu onaylar (received) → onayda Ticimax 'Iade' otomatik çalışır.
  const showStaffApprove = (r.type === 'return' || r.type === 'defect') && r.status === 'received' && user?.can_staff_approve_returns
  // PARA gate'i (yalnızca para): İADE/KUSUR staff_approved'dan, İPTAL processing'den (ERP zaten otomatik işlendi).
  // shortage (personel başlattı, eksik/hatalı ürün): kargo/depo adımı yok → doğrudan para onayı.
  const showManagerApprove = user?.can_manager_approve_returns && (
    ((r.type === 'return' || r.type === 'defect' || r.type === 'shortage') && r.status === 'staff_approved') ||
    (r.type === 'cancel' && r.status === 'processing')
  )
  // KUSUR kararı: yalnızca firma yöneticisi (admin) / süper admin — backend ayrıca denetler.
  const isDefectReview = r.type === 'defect' && r.status === 'defect_review'
  const canDecideDefect = isDefectReview && !!user?.is_admin
  // Kusur fotoğrafları şikâyet kutusunda (üstte) gösterilir; alttaki genel Görseller'e girmez.
  const customerPhotos = r.type === 'defect' ? data.attachments.filter((a) => a.kind === 'customer_upload') : []
  const otherAttachments = data.attachments.filter((a) => !(r.type === 'defect' && a.kind === 'customer_upload'))
  // İPTAL ÖNİZLEMESİ yalnızca Pending'de (henüz otomatik işlenmemiş / ERP hatası) gösterilir.
  const preview = data.cancel_preview

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to={returnsListPath()} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Listeye dön
      </Link>

      {/* Başlık */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-xl font-extrabold text-gray-900">{r.public_code}</h1>
        <span className={clsx('text-xs px-2 py-0.5 rounded', typeBadge(r.type, true, r.shortage?.stage).cls)}>
          {typeBadge(r.type, true, r.shortage?.stage).label}
        </span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full', statusBadgeClass(r.status))}>{r.status_label}</span>
        {r.timer.deadline && (
          <span className={clsx('inline-flex items-center gap-1 text-sm', r.timer.sla_breached ? 'text-rose-600' : 'text-gray-500')}>
            {r.timer.sla_breached ? <AlertTriangle size={14} /> : <Clock size={14} />}
            {r.timer.sla_breached
              ? `${fmtHoursLeft(r.timer.hours_left ?? 0)} gecikme`
              : `Onaya kalan: ${fmtHoursLeft(r.timer.hours_left ?? 0)}`}
          </span>
        )}
      </div>

      {error && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 text-sm rounded-md border border-rose-200">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sol: bilgiler */}
        <div className="lg:col-span-2 space-y-6">
          {/* Müşteri & sipariş */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Sipariş & Müşteri</h2>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              {r.admin_order_url ? (
                <div>
                  <div className="text-xs text-gray-400">Sipariş No</div>
                  <a href={r.admin_order_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline" title="Ticimax panelde aç">
                    {r.order_no ?? '—'}
                  </a>
                </div>
              ) : (
                <Info label="Sipariş No" value={r.order_no} />
              )}
              {r.platform_order_id && (
                r.admin_order_url ? (
                  <div>
                    <div className="text-xs text-gray-400">Sipariş ID</div>
                    <a href={r.admin_order_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline" title="Ticimax panelde aç">
                      {r.platform_order_id}
                    </a>
                  </div>
                ) : (
                  <Info label="Sipariş ID" value={r.platform_order_id} />
                )
              )}
              <Info label="Müşteri" value={r.customer_name} />
              <Info label="E-posta" value={r.customer_email} />
              <Info label="Telefon" value={r.customer_phone} />
              <Info label="İade yöntemi" value={r.refund_method_label ?? (r.refund_method === 'store_credit' ? 'İndirim kodu' : r.refund_method === 'original' ? 'Karta iade' : '—')} />
              {/* Ödeme şekli = müşterinin siparişi nasıl ödediği (iade yönteminden ayrı). */}
              {r.payment_type && <Info label="Ödeme şekli" value={r.payment_type_label ?? (r.payment_type === 'cod' ? 'Kapıda ödeme' : 'Kartlı / online')} />}
              <Info label="Oluşturma" value={r.created_at} />
            </div>
          </div>

          {/* EKSİK / HATALI ÜRÜN — personel kaynaklı talep: kim açtı, kapsam, Ticimax izleri, özür kuponu */}
          {r.type === 'shortage' && (
            <div className={clsx('rounded-lg border-2 overflow-hidden', r.shortage?.stage === 'returned' ? 'border-teal-400 bg-teal-50' : 'border-rose-300 bg-rose-50')}>
              <div className={clsx('px-4 py-2 flex items-center gap-2', r.shortage?.stage === 'returned' ? 'bg-teal-600' : 'bg-rose-500')}>
                <PackageX size={16} className="text-white" />
                <span className="text-xs font-bold text-white uppercase tracking-wide">
                  {r.shortage?.stage === 'returned' ? 'Geri Dönen Sipariş — Personel Kaydetti (müşteriye bildirim yok)' : r.shortage?.stage === 'delivered' ? 'Teslimat Sonrası Eksik / Hatalı Ürün — Personel Başlattı' : 'Eksik / Hatalı Ürün — Personel Başlattı'}
                </span>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <Info label="Başlatan personel" value={r.shortage?.created_by_name ?? r.created_by_name ?? null} />
                  <Info label="Senaryo" value={r.shortage?.stage_label ?? null} />
                  <Info label="Kapsam" value={r.shortage?.stage === 'returned'
                    ? (r.shortage?.is_full ? 'Siparişin TAMAMI — onay sonrası Ticimax\'ta İptal' : 'Kısmi — Ticimax statüsü değiştirilmez')
                    : r.shortage?.stage === 'delivered'
                    ? (r.shortage?.is_full ? 'Siparişin TAMAMI — Ticimax\'a yazılmadı' : 'Kısmi — Ticimax\'a yazılmadı')
                    : (r.shortage?.is_full ? 'Siparişin TAMAMI (iptal gibi işlendi)' : 'Kısmi — kalan ürünler kargolanacak')} />
                </div>
                {r.shortage?.summary && (
                  <div className="text-xs text-gray-600 bg-white border border-rose-100 rounded px-3 py-2">{r.shortage.summary}</div>
                )}
                {r.shortage?.staff_note && (
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Personel açıklaması</div>
                    <div className="rounded bg-white border border-rose-200 px-3 py-2 whitespace-pre-wrap text-gray-800">{r.shortage.staff_note}</div>
                  </div>
                )}
                {r.shortage?.ticimax?.lines?.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Ticimax{r.shortage.ticimax.dry_run ? ' (dry-run)' : ''}</div>
                    <ul className="space-y-0.5 text-xs">
                      {r.shortage.ticimax.lines.map((l, i) => (
                        <li key={i} className={clsx('flex items-start gap-1', l.ok === false ? 'text-rose-700' : l.ok === null ? 'text-gray-500' : 'text-emerald-700')}>
                          <span>{l.ok === false ? '✕' : l.ok === null ? '•' : '✓'}</span><span>{l.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {r.shortage?.apology_coupon ? (
                  <div className={clsx('rounded border px-3 py-2 flex items-start gap-2', r.shortage.apology_coupon.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-100 border-rose-300 text-rose-800')}>
                    <Gift size={15} className="mt-0.5 shrink-0" />
                    <div className="text-xs">
                      {r.shortage.apology_coupon.success ? (
                        <>Özür kuponu <b className="font-mono">{r.shortage.apology_coupon.code}</b> — {fmtMoney(r.shortage.apology_coupon.amount, r.currency)}, {r.shortage.apology_coupon.days} gün geçerli{r.shortage.apology_coupon.dry_run ? ' (dry-run — Ticimax\'a yazılmadı)' : ''}. Müşteriye SMS ile iletildi.</>
                      ) : (
                        <>Özür kuponu oluşturulamadı: {r.shortage.apology_coupon.error ?? 'bilinmeyen hata'}</>
                      )}
                    </div>
                  </div>
                ) : r.shortage?.stage === 'returned' ? (
                  <p className="text-xs text-teal-800">Geri dönen sipariş: müşteriye SMS / kupon gönderilmez. Para iadesi onaylanınca {r.shortage?.is_full ? 'sipariş Ticimax\'ta İptal yapılır.' : 'yalnız para iadesi yapılır (kısmi seçim).'}</p>
                ) : (
                  <p className="text-xs text-gray-500">Para iadesi onaylanınca müşteriye özür SMS'i ve özel indirim kuponu gönderilir (İade Ayarları → Eksik/Hatalı Ürün).</p>
                )}
              </div>
            </div>
          )}

          {/* KUSUR ŞİKÂYETİ — kusur fotoğrafları + müşterinin yazdığı sorun metni */}
          {r.type === 'defect' && (r.complaint || customerPhotos.length > 0) && (
            <div className="bg-fuchsia-50 rounded-lg border border-fuchsia-200 p-4">
              <h2 className="text-sm font-semibold text-fuchsia-800 mb-2">Müşteri Şikâyeti</h2>
              {customerPhotos.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {customerPhotos.map((a) => (
                    <AuthImage key={a.id} url={a.url} alt={a.original_name ?? 'Kusur fotoğrafı'}
                      className="w-28 h-28 rounded-lg object-cover border border-fuchsia-200 hover:opacity-90 cursor-zoom-in" />
                  ))}
                </div>
              )}
              {r.complaint && <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.complaint}</p>}
            </div>
          )}

          {/* HAVALE İLE İADE (kapıda ödeme): müşteri kapıda ödediği için karta iade mümkün değil.
              Bilgi public formda müşteriden alınır; eski taleplerde personel buradan girer.
              Onayı veren kişi kaçırmasın diye kart belirgin (amber başlık) tasarlandı. */}
          {(r.refund_method === 'bank_transfer' || (r.is_cod && r.type !== 'cancel')) && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 overflow-hidden">
              <div className="bg-amber-400 px-4 py-2 flex items-center gap-2">
                <Banknote size={16} className="text-amber-900" />
                <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  Kapıda Ödemeli Sipariş — Havale ile İade
                </span>
              </div>
              <div className="p-4">
              <p className="text-xs text-amber-900 mb-3">
                Para kapıda nakit/kart ile tahsil edildiği için <b>karta iade yapılamaz</b>;
                ödeme aşağıdaki hesaba havale ile yapılır.
              </p>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Landmark size={15} /> Havale Bilgileri
                </h2>
                {!showBank && (
                  <button onClick={() => { setShowBank(true); setBankForm({
                    bank_name: r.bank_account?.bank_name ?? '',
                    account_holder: r.bank_account?.account_holder ?? r.customer_name ?? '',
                    iban: r.bank_account?.iban ?? '',
                  }) }} className="text-xs text-sky-700 hover:underline">
                    {r.bank_account ? 'Düzenle' : 'Bilgi Gir'}
                  </button>
                )}
              </div>

              {!showBank && (r.bank_account ? (
                <div className="rounded-md bg-white border border-amber-200 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <Info label="Hesap sahibi" value={r.bank_account.account_holder} />
                  <div className="sm:col-span-2">
                    <div className="text-xs text-gray-400">IBAN</div>
                    <div className="font-mono text-sm font-semibold text-gray-900 break-all">{r.bank_account.iban}</div>
                  </div>
                  {r.bank_account.bank_name && <Info label="Banka" value={r.bank_account.bank_name} />}
                  {r.bank_account.updated_by && (
                    <div className="sm:col-span-3 text-[11px] text-gray-400">
                      Son güncelleyen: {r.bank_account.updated_by}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md bg-white border border-rose-300 px-3 py-2.5 text-xs text-rose-700">
                  <b>Havale bilgisi henüz yok.</b> Müşteriyle iletişime geçip hesap sahibi ad soyad
                  ve IBAN bilgisini girin — para onayı bu bilgi olmadan tamamlanamaz.
                </div>
              ))}

              {showBank && (
                <div className="space-y-2">
                  <input value={bankForm.account_holder} onChange={(e) => setBankForm({ ...bankForm, account_holder: e.target.value })}
                    placeholder="Hesap sahibi ad soyad *" className="w-full rounded-md border-2 border-amber-200 bg-white px-3 py-2 text-sm" />
                  <input value={bankForm.iban} onChange={(e) => setBankForm({ ...bankForm, iban: e.target.value.toUpperCase() })}
                    placeholder="IBAN * — TR00 0000 0000 0000 0000 0000 00" className="w-full rounded-md border-2 border-amber-200 bg-white px-3 py-2 text-sm font-mono" />
                  <input value={bankForm.bank_name} onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                    placeholder="Banka adı (isteğe bağlı)" className="w-full rounded-md border-2 border-amber-200 bg-white px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button disabled={busy}
                      onClick={() => act(async () => {
                        await returnsAdminApi.saveBankAccount(num, {
                          bank_name: bankForm.bank_name.trim(),
                          account_holder: bankForm.account_holder.trim(),
                          iban: bankForm.iban.replace(/\s+/g, '').toUpperCase(),
                        })
                        setShowBank(false)
                      })}
                      className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50">
                      Kaydet
                    </button>
                    <button onClick={() => setShowBank(false)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-md text-gray-600">
                      Vazgeç
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Havale bu bilgilere yapılacak — IBAN'ı müşteriden birebir teyit edin.
                  </p>
                </div>
              )}
              </div>
            </div>
          )}

          {/* PERSONEL NOTLARI — telefonla çözülen kapsam değişiklikleri vb. iç kayıt (müşteri görmez).
              Para onayı verilirken bu notlar ayrıca onay bloklarında zorunlu gösterilir. */}
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
            <h2 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
              <StickyNote size={15} /> Personel Notları
              <span className="text-[11px] font-normal text-amber-600">— iç kayıt, müşteri görmez</span>
            </h2>
            {(r.staff_notes ?? []).length === 0 ? (
              <p className="text-xs text-amber-700/70 mb-2">Henüz not yok. Telefonla çözülen durumları (ör. fazladan gönderilen ürün, kapsam değişikliği) buraya yazın.</p>
            ) : (
              <ul className="space-y-2 mb-3">
                {(r.staff_notes ?? []).map((n) => (
                  <li key={n.id} className="bg-white rounded-md border border-amber-200 px-3 py-2">
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</div>
                    <div className="text-[11px] text-gray-400 mt-1">{[n.actor_name, n.created_at].filter(Boolean).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            )}
            {(user?.can_add_return_notes ?? user?.can_staff_approve_returns) && (
              <div className="flex gap-2 items-start">
                <textarea
                  value={staffNote}
                  onChange={(e) => setStaffNote(e.target.value)}
                  placeholder="Not ekle (ör. müşteri aradı, 2. ürünü de aynı pakette gönderecek)..."
                  rows={2}
                  className="flex-1 text-sm border border-amber-300 rounded-md px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <button
                  disabled={busy || staffNote.trim().length < 3}
                  onClick={() => act(() => returnsAdminApi.addNote(num, staffNote.trim()))}
                  className="px-3 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 shrink-0"
                >
                  Not Ekle
                </button>
              </div>
            )}
          </div>

          {/* Kalemler */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-700 px-4 py-3 border-b">İade Edilen Ürünler</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Ürün</th>
                  <th className="px-4 py-2 font-medium text-center">Sipariş Adedi</th>
                  <th className="px-4 py-2 font-medium text-center">İade Edilen</th>
                  <th className="px-4 py-2 font-medium text-right">Birim</th>
                  <th className="px-4 py-2 font-medium text-right">İade Tutarı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {it.image_url && <img src={it.image_url} alt="" className="w-9 h-9 rounded object-cover border" />}
                        <div>
                          <div className="text-gray-900">{it.product_name ?? it.sku}</div>
                          <div className="text-xs text-gray-500">
                            {it.variant_info} {it.sku && `· ${it.sku}`}
                            {it.reason_note && ` · ${it.reason_note}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{it.qty_ordered}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={clsx(it.qty_requested < it.qty_ordered && 'font-medium text-amber-700')}>
                        {it.qty_requested}
                      </span>
                      {it.qty_approved !== null && it.qty_approved !== it.qty_requested && (
                        <span className="text-xs text-violet-600"> → {it.qty_approved} onaylı</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(it.unit_price, r.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtMoney(it.refundable_amount, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* İADE HESABI — personel müşteriye anlatabilsin diye adım adım */}
          <RefundExplainCard r={r} items={data.items} />

          {/* İPTAL ÖNİZLEMESİ (Pending) — yönetici onaydan önce kontrol eder */}
          {preview && (
            <div className={clsx('rounded-lg border p-4', preview.ok ? 'bg-violet-50 border-violet-200' : 'bg-rose-50 border-rose-200')}>
              <h2 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                <ShieldCheck size={15} /> İptal Önizlemesi (onay öncesi kontrol)
              </h2>
              {preview.ok ? (
                <div className="space-y-1.5 text-sm text-gray-700">
                  <div>
                    <span className="text-gray-500">Kapsam: </span>
                    <span className={clsx('font-medium px-1.5 py-0.5 rounded text-xs', preview.scope === 'full' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700')}>
                      {preview.scope === 'full' ? 'TAM İPTAL (tüm sipariş)' : 'KISMİ İPTAL (seçili kalemler)'}
                    </span>
                  </div>
                  <Row label="İade tutarı" value={fmtMoney(preview.refund_amount ?? 0, r.currency)} strong />
                  <div className="text-xs text-gray-500 pt-1">
                    <span className="font-medium text-gray-600">Nebim:</span> {preview.nebim?.order_number} · {preview.nebim?.lines.length} kalem (ModelType 34)
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">Ticimax:</span> {preview.ticimax?.note}
                  </div>
                  <p className="text-[11px] text-gray-400 pt-1">İptal ERP işlemi müşteri talebiyle otomatik yürür; bu kayıt henüz işlenmemiş (Pending). Otomatik işlemde sorun olduysa aşağıdaki sonuç/hata kontrol edilmelidir.</p>
                </div>
              ) : (
                <div className="text-sm text-rose-700 flex items-start gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{preview.error ?? 'İptal önizlemesi alınamadı.'}</span>
                </div>
              )}
            </div>
          )}

          {/* OTOMATİK ERP İŞLEM SONUÇLARI (iptal: Nebim+Ticimax / iade: Ticimax 'Iade') */}
          {(data.nebim_result || data.ticimax_cancel || data.ticimax_return) && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Otomatik İşlem Sonuçları</h2>
              <div className="space-y-1.5 text-sm">
                {data.nebim_result && (
                  <div className="flex items-center gap-2">
                    {data.nebim_result.success ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-rose-500" />}
                    <span className="text-gray-700">
                      Nebim (ERP): {data.nebim_result.order_number ?? '—'} · {data.nebim_result.is_full ? 'tam' : 'kısmi'}
                      {data.nebim_result.amount !== null && <> · {fmtMoney(data.nebim_result.amount, r.currency)}</>}
                      {data.nebim_result.dry_run && <span className="text-[11px] text-amber-600"> (test/dry-run)</span>}
                      {data.nebim_result.error && <span className="text-rose-600"> — {data.nebim_result.error}</span>}
                    </span>
                  </div>
                )}
                {data.ticimax_cancel && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-gray-700">
                      Ticimax iptal: {data.ticimax_cancel.method === 'full' ? 'tam iptal' : 'kalem iptali'}
                      {data.ticimax_cancel.dry_run && <span className="text-[11px] text-amber-600"> (test/dry-run)</span>}
                      {data.ticimax_cancel.error && <span className="text-rose-600"> — {data.ticimax_cancel.error}</span>}
                    </span>
                  </div>
                )}
                {data.ticimax_return && (
                  <div className="flex items-center gap-2">
                    {data.ticimax_return.success ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-rose-500" />}
                    <span className="text-gray-700">
                      Ticimax iade: statü '{data.ticimax_return.payload?.durum === 'KismiIadeYapildi' ? 'Kısmi İade Yapıldı' : 'İade Ödemesi Yapıldı'}'
                      {data.ticimax_return.dry_run && <span className="text-[11px] text-amber-600"> (test/dry-run)</span>}
                      {data.ticimax_return.error && <span className="text-rose-600"> — {data.ticimax_return.error}</span>}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PARA İADESİ (Faz 4) — store_credit indirim kuponu / original manuel. */}
          {data.refunds.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Wallet size={15} className="text-violet-500" /> Para İadesi
              </h2>
              <ul className="space-y-2.5 text-sm">
                {data.refunds.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    {f.status === 'succeeded' || f.status === 'dry_run'
                      ? <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                      : f.status === 'failed'
                        ? <XCircle size={15} className="text-rose-500 mt-0.5 shrink-0" />
                        : <Clock size={15} className="text-amber-500 mt-0.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-700">
                        {refundProviderLabel(f.provider)} · {fmtMoney(f.amount, f.currency)}
                        <span className="text-[11px] text-gray-400"> · {refundStatusLabel(f.status)}</span>
                        {f.status === 'dry_run' && <span className="text-[11px] text-amber-600"> (test/dry-run — Ticimax'a yazılmadı)</span>}
                        {f.attempts > 1 && <span className="text-[11px] text-gray-400"> · {f.attempts} deneme</span>}
                      </div>
                      {f.coupon_code && (
                        <button
                          onClick={() => navigator.clipboard?.writeText(f.coupon_code!)}
                          title="Kopyala"
                          className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 bg-violet-50 text-violet-700 rounded font-mono text-xs hover:bg-violet-100"
                        >
                          {f.coupon_code} <Copy size={12} />
                        </button>
                      )}
                      {f.error_message && <div className="text-xs text-rose-600 break-words mt-0.5">{f.error_message}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* BİLDİRİMLER (SMS) — Yunbi üzerinden gözlem; her gönderim (dry-run dahil) audit'e yazılır */}
          {data.sms.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Bildirimler (SMS)</h2>
              <ul className="space-y-2 text-sm">
                {data.sms.map((s) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className={clsx('mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                      s.error ? 'bg-rose-500' : s.sent ? 'bg-emerald-500' : 'bg-amber-400')} />
                    <div className="min-w-0">
                      <div className="text-gray-700">
                        {smsEventLabel(s.event)}
                        <span className="text-[11px] text-gray-400"> · {s.sent ? 'gönderildi' : s.dry_run ? 'test/dry-run' : 'gönderilmedi'}</span>
                      </div>
                      {s.message && <div className="text-xs text-gray-500 break-words">{s.message}</div>}
                      {s.error && <div className="text-[11px] text-rose-600">{s.error}</div>}
                      <div className="text-[11px] text-gray-400">{s.created_at}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Zaman çizelgesi */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">İşlem Geçmişi</h2>
            <ol className="space-y-3">
              {data.timeline.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                  <div>
                    <div className="text-gray-800">
                      <span className="font-medium">{actionLabel(e.action)}</span>
                      {e.to_status && <span className="text-gray-400"> → {e.to_status}</span>}
                      {e.amount !== null && <span className="text-gray-500"> · {fmtMoney(e.amount, r.currency)}</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      {[e.actor_name, e.actor_type, e.created_at].filter(Boolean).join(' · ')}
                      {e.note && ` — ${e.note}`}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Ekler */}
          {otherAttachments.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Paperclip size={15} /> Görseller
              </h2>
              <div className="flex flex-wrap gap-3">
                {otherAttachments.map((a) => (
                  <div key={a.id}>
                    <AuthImage url={a.url} alt={a.original_name ?? ''}
                      className="w-24 h-24 rounded-lg object-cover border hover:opacity-90 cursor-zoom-in" />
                    <div className="text-[11px] text-gray-400 mt-1 max-w-24 truncate">{a.kind}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sağ: tutar + aksiyonlar */}
        <div className="space-y-6">
          {/* Tutar özeti */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Tutar</h2>
            <Row label="Talep edilen" value={fmtMoney(r.requested_amount, r.currency)} />
            {(r.campaign_recovery ?? 0) > 0 && (
              <div className="py-1 text-xs text-amber-700 bg-amber-50 -mx-1 px-1 rounded" title={r.campaign_revoked_from ? `İndirimi pasifleşen ürün: ${r.campaign_revoked_from}` : undefined}>
                {r.calculation?.breakdown?.tier_recovery ? 'Sepet indirimi düzeltmesi' : 'Kampanya telafisi'}: −{fmtMoney(r.campaign_recovery!, r.currency)} düşüldü
                {r.campaign_revoked_from && <div className="text-[10px] text-amber-600 truncate">Pasifleşen indirim: {r.campaign_revoked_from}</div>}
              </div>
            )}
            <Row label="Onaylanan" value={r.approved_amount !== null ? fmtMoney(r.approved_amount, r.currency) : '—'} strong />
            <Row label="Ödenen (snapshot)" value={r.paid_amount_snapshot !== null ? fmtMoney(r.paid_amount_snapshot, r.currency) : '—'} muted />
            {r.refunded_amount > 0 && <Row label="İade edilen" value={fmtMoney(r.refunded_amount, r.currency)} />}
            {(r.staff_approved_by || r.manager_approved_by) && (
              <div className="mt-3 pt-3 border-t text-xs text-gray-500 space-y-1">
                {r.staff_approved_by && <div className="flex items-center gap-1"><CheckCircle2 size={13} className="text-cyan-500" /> Personel: {r.staff_approved_by}</div>}
                {r.manager_approved_by && <div className="flex items-center gap-1"><ShieldCheck size={13} className="text-violet-500" /> Yönetici: {r.manager_approved_by}</div>}
              </div>
            )}
            {r.reject_reason && (
              <div className="mt-3 pt-3 border-t text-xs text-rose-600">
                <span className="font-medium">Red gerekçesi:</span> {r.reject_reason}
              </div>
            )}
          </div>

          {/* Kargo — takip kodu firmanın takip sayfasına gider, teslim bilgisi kargo firmasından */}
          {r.cargo_tracking_code && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Truck size={15} /> Kargo
              </h2>
              <Row label="Firma" value={cargoProviderLabel(r.cargo_provider)} />
              <div className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="text-gray-500">Takip kodu</span>
                {r.cargo_tracking_url ? (
                  <a href={r.cargo_tracking_url} target="_blank" rel="noopener noreferrer"
                    title={`${cargoProviderLabel(r.cargo_provider)} takip sayfasında aç`}
                    className="inline-flex items-center gap-1 font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline">
                    {r.cargo_tracking_code} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="font-mono text-xs text-gray-700">{r.cargo_tracking_code}</span>
                )}
              </div>
              {/* Paket üzerindeki barkod (takip no'dan farklı) — depo eşleştirmesi için */}
              {r.cargo_barcode && <Row label="Barkod" value={r.cargo_barcode} />}
              {(r.delivery?.delivered_at || r.received_at) && (
                <div className="mt-3 pt-3 border-t text-xs text-gray-600 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <PackageCheck size={13} /> Depoya teslim: {(r.delivery?.delivered_at ?? r.received_at ?? '').slice(0, 16).replace('T', ' ')}
                  </div>
                  {r.delivery?.received_by && <div>Teslim alan: {r.delivery.received_by}</div>}
                  {r.delivery?.delivered_place && <div className="text-gray-400">{r.delivery.delivered_place}</div>}
                </div>
              )}
            </div>
          )}

          {/* Aksiyonlar */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">İşlemler</h2>

            {/* KUSUR KARARI — yalnızca firma yöneticisi */}
            {isDefectReview && !canDecideDefect && (
              <p className="text-xs text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-md px-3 py-2">
                Bu kusur bildirimi <b>firma yöneticisinin</b> onay/red kararını bekliyor.
              </p>
            )}
            {canDecideDefect && !showDefectReject && (
              <>
                <button
                  disabled={busy}
                  onClick={() => act(() => returnsAdminApi.approveDefect(num))}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-fuchsia-600 text-white rounded-md hover:bg-fuchsia-700 disabled:opacity-50"
                >
                  <CheckCircle2 size={15} /> Kusuru Onayla (kargo kodu gönder)
                </button>
                <p className="text-[11px] text-gray-400 px-1">
                  Onayladığınızda kargo firmasında iade kodu oluşturulur ve müşteriye SMS ile gönderilir;
                  süreç normal iade akışıyla devam eder.
                </p>
                <button
                  disabled={busy}
                  onClick={() => setShowDefectReject(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-rose-300 text-rose-600 rounded-md hover:bg-rose-50 disabled:opacity-50"
                >
                  <XCircle size={15} /> Reddet (nedenli SMS)
                </button>
              </>
            )}
            {canDecideDefect && showDefectReject && (
              <div className="space-y-2 border-t pt-3">
                <label className="block text-xs font-medium text-gray-600">Red nedeni (müşteriye SMS ile iletilir)</label>
                <select
                  value={defectReason}
                  onChange={(e) => setDefectReason(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                >
                  <option value="">Neden seçiniz...</option>
                  {(r.defect_reject_reasons ?? []).map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
                <textarea
                  value={defectNote}
                  onChange={(e) => setDefectNote(e.target.value)}
                  placeholder="İç not (opsiyonel, SMS'e girmez)..."
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !defectReason}
                    onClick={() => act(() => returnsAdminApi.rejectDefect(num, defectReason, defectNote.trim() || undefined))}
                    className="flex-1 px-3 py-2 text-sm bg-rose-600 text-white rounded-md hover:bg-rose-700 disabled:opacity-50"
                  >
                    Reddet ve SMS Gönder
                  </button>
                  <button onClick={() => setShowDefectReject(false)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {/* Kargo / işlem adımları */}
            {r.allowed_transitions.map((tr) => (
              <button
                key={tr.value}
                disabled={busy}
                onClick={() => {
                  // Kapanmış talebi yeniden açmak istisnai bir işlemdir → yanlış tıklamaya karşı onay.
                  if (r.status === 'cancelled_by_customer'
                    && !window.confirm('Bu talep kapanmış (müşteri vazgeçti / kod süresi doldu). Ürün depoya ulaştıysa talep yeniden açılıp "Depoya ulaştı" durumuna alınacak ve müşteriye bilgilendirme SMS\'i gidecek. Devam edilsin mi?')) return
                  act(() => returnsAdminApi.transition(num, tr.value))
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <Truck size={15} /> {tr.label}
              </button>
            ))}

            {/* ONAY ANINDA KAPIDA ÖDEME VURGUSU: onayı veren kişi, paranın kapıda tahsil edildiğini
                ve hangi hesaba havale yapılacağını burada, butonun hemen üstünde görür. */}
            {r.is_cod && (showStaffApprove || showManagerApprove) && (
              <div className="rounded-md border-2 border-amber-400 bg-amber-50 overflow-hidden">
                <div className="bg-amber-400 px-3 py-1.5 flex items-center gap-1.5">
                  <Banknote size={14} className="text-amber-900" />
                  <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">Kapıda Ödemeli Sipariş</span>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {r.type === 'cancel' ? (
                    <p className="text-xs text-amber-900">Tahsilat yapılmadı — iade edilecek tutar yok.</p>
                  ) : r.bank_account ? (
                    <>
                      <p className="text-xs text-amber-900">Karta iade yapılamaz; ödeme havale ile yapılacak:</p>
                      <div className="rounded bg-white border border-amber-200 px-2.5 py-2">
                        <div className="text-xs text-gray-800"><span className="text-gray-400">Ad soyad:</span> <b>{r.bank_account.account_holder}</b></div>
                        <div className="text-xs text-gray-800 break-all"><span className="text-gray-400">IBAN:</span> <b className="font-mono">{r.bank_account.iban}</b></div>
                        {r.bank_account.bank_name && <div className="text-xs text-gray-800"><span className="text-gray-400">Banka:</span> {r.bank_account.bank_name}</div>}
                      </div>
                    </>
                  ) : (
                    <div className="rounded bg-white border border-rose-300 px-2.5 py-2 text-xs text-rose-700">
                      <b>Havale bilgisi yok.</b> Soldaki "Havale Bilgileri" bölümünden ad soyad + IBAN
                      girmeden para onayı tamamlanamaz.
                    </div>
                  )}
                </div>
              </div>
            )}

            {showStaffApprove && (
              <button
                disabled={busy}
                onClick={() => act(() => returnsAdminApi.approveStaff(num, {}))}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50"
              >
                <CheckCircle2 size={15} /> Personel Onayı Ver
              </button>
            )}

            {showManagerApprove && (
              <>
                {(r.staff_notes ?? []).length > 0 && (
                  <div className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                    <div className="text-xs font-semibold text-amber-800 flex items-center gap-1 mb-1">
                      <StickyNote size={13} /> Onaydan önce personel notlarını okuyun!
                    </div>
                    <ul className="space-y-1">
                      {(r.staff_notes ?? []).map((n) => (
                        <li key={n.id} className="text-xs text-gray-700 whitespace-pre-wrap">
                          • {n.note}
                          <span className="text-[10px] text-gray-400"> ({[n.actor_name, n.created_at?.slice(0, 16)].filter(Boolean).join(' · ')})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  disabled={busy}
                  onClick={() => act(() => returnsAdminApi.approveManager(num, {}))}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                >
                  <ShieldCheck size={15} /> Para İadesini Onayla
                </button>
                <p className="text-[11px] text-gray-400 px-1">
                  {r.type === 'cancel'
                    ? 'İptal işlemi otomatik tamamlandı. Bu onay yalnızca müşteriye para iadesini başlatır.'
                    : r.type === 'shortage' && r.shortage?.stage === 'returned'
                      ? 'GERİ DÖNEN SİPARİŞ: tutar karta iade edilir ve (tam kapsamda) sipariş Ticimax\'ta İptal yapılır. Müşteriye SMS / kupon gitmez.'
                    : r.type === 'shortage'
                      ? 'Gönderilemeyen ürünün bedeli karta iade edilir; müşteriye özür SMS\'i ve özel indirim kuponu gider. Sipariş statüsüne dokunulmaz.'
                      : 'Yalnızca para iadesi onayı. Personel onayını veren yönetici gerekirse para onayını da verebilir.'}
                </p>
                {r.refund_method === 'store_credit' && (
                  <p className="text-[11px] text-violet-600 px-1 flex items-start gap-1">
                    <Wallet size={13} className="mt-0.5 shrink-0" />
                    <span>Onayladığınızda indirim kodu Ticimax üzerinde oluşturulup müşteriye SMS ile gönderilecektir.</span>
                  </p>
                )}
                {r.refund_method === 'bank_transfer' && (
                  <p className="text-[11px] text-sky-700 px-1 flex items-start gap-1">
                    <Landmark size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Kapıda ödemeli sipariş — otomatik karta iade yapılamaz. Onayladığınızda talep
                      "havale bekliyor" durumuna geçer; parayı gönderdikten sonra aşağıdaki
                      <b> Havale Yapıldı</b> ile kapatın.
                    </span>
                  </p>
                )}
              </>
            )}

            {/* HAVALE YAPILDI: para onayı verilmiş, ödeme banka üzerinden elle yapılıyor. */}
            {user?.can_manager_approve_returns && r.refund_method === 'bank_transfer'
              && ['manager_approved', 'refunding'].includes(r.status) && (
              !showTransfer ? (
                <button
                  disabled={busy}
                  onClick={() => setShowTransfer(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50"
                >
                  <Banknote size={15} /> Havale Yapıldı — Talebi Kapat
                </button>
              ) : (
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs text-gray-500">
                    Havale tutarı: <b>{fmtMoney(r.approved_amount ?? r.requested_amount, r.currency)}</b>
                    {r.bank_account && <> · <span className="font-mono">{r.bank_account.iban}</span></>}
                  </div>
                  <input value={transferTxn} onChange={(e) => setTransferTxn(e.target.value)}
                    placeholder="Dekont / referans no (opsiyonel)"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
                  <textarea value={transferNote} onChange={(e) => setTransferNote(e.target.value)}
                    placeholder="Açıklama (zorunlu): havaleyi kim, hangi hesaptan yaptı?"
                    rows={2} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button
                      disabled={busy || transferNote.trim().length < 3}
                      onClick={() => act(async () => {
                        await returnsAdminApi.markTransferred(num, { note: transferNote.trim(), txn: transferTxn.trim() || undefined })
                        setShowTransfer(false); setTransferNote(''); setTransferTxn('')
                      })}
                      className="flex-1 px-3 py-2 text-sm bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50"
                    >
                      Onayla ve Kapat
                    </button>
                    <button onClick={() => setShowTransfer(false)} className="px-3 py-2 text-sm border border-gray-200 rounded-md text-gray-600">
                      Vazgeç
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Müşteriye iade tamamlandı SMS'i gönderilir ve sipariş Ticimax'ta "iade ödemesi yapıldı" olarak işaretlenir.
                  </p>
                </div>
              )
            )}

            {/* Para iadesi yarıda kaldıysa (onay verildi ama kupon açılmadı / karta iade manuel) elle tetik/yeniden dene. */}
            {user?.can_manager_approve_returns && data.refund_actionable && (
              <button
                disabled={busy}
                onClick={() => act(() => returnsAdminApi.refund(num))}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-violet-300 text-violet-700 rounded-md hover:bg-violet-50 disabled:opacity-50"
              >
                <RefreshCw size={15} /> Para İadesini İşle / Yeniden Dene
              </button>
            )}

            {canRejectNow && !showReject && (
              <button
                disabled={busy}
                onClick={() => setShowReject(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-rose-300 text-rose-600 rounded-md hover:bg-rose-50 disabled:opacity-50"
              >
                <XCircle size={15} /> Reddet
              </button>
            )}

            {showReject && (
              <div className="space-y-2 border-t pt-3">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Red gerekçesi (zorunlu)..."
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                />
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <Upload size={14} />
                  <span>{rejectFile ? rejectFile.name : 'Kanıt görseli ekle (opsiyonel)'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setRejectFile(e.target.files?.[0] ?? null)} />
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={busy || rejectReason.trim().length < 3}
                    onClick={() => act(() => returnsAdminApi.reject(num, rejectReason, rejectFile ?? undefined))}
                    className="flex-1 px-3 py-2 text-sm bg-rose-600 text-white rounded-md hover:bg-rose-700 disabled:opacity-50"
                  >
                    Reddet
                  </button>
                  <button onClick={() => setShowReject(false)} className="px-3 py-2 text-sm border rounded-md">
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {/* Görsel yükleme */}
            {!r.status.match(/completed|cancelled_by_customer/) && (
              <label className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer">
                <Upload size={15} /> Görsel yükle
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) act(() => returnsAdminApi.uploadAttachment(num, f))
                  }}
                />
              </label>
            )}

            {r.status === 'manager_approved' && (
              <p className="text-[11px] text-gray-400 px-1 pt-1">
                Para iadesi adımı (Faz 4) ayrıca işlenecektir.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-gray-800">{value ?? '—'}</div>
    </div>
  )
}

/**
 * İade hesabı açıklaması (personel için): talep anındaki hesap (metadata.calculation) kalem kalem,
 * fiş görünümünde — liste → ürün indirimi → ürün kampanyası (1+1) → sepet indirimi → ödenen →
 * kupon payı → sepet indirimi düzeltmesi → iade. Altta müşteriye okunabilecek hazır metin.
 */
function RefundExplainCard({ r, items }: { r: ReturnDetail; items: ReturnDetailResponse['items'] }) {
  const [copied, setCopied] = useState(false)
  const c = r.calculation
  if (!c || !c.lines?.length) return null
  const m = (v: number) => fmtMoney(v, r.currency)
  const tier = c.breakdown?.tier_recovery ?? null
  const check = c.breakdown?.tier_check ?? null
  const hasExplain = c.lines.some((l) => l.explain)
  const nameOf = (l: { name: string | null; sku: string | null }) =>
    l.name ?? items.find((it) => it.sku && it.sku === l.sku)?.product_name ?? l.sku ?? 'Ürün'
  const isTierName = (n: string) => /TL\s*(üzeri|üzerine)/i.test(n)
  const pct = (v?: number) => `%${(v ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`

  // Müşteriye anlatım metni
  const parts: string[] = []
  c.lines.forEach((l) => {
    const e = l.explain
    const nm = nameOf(l)
    if (!e) { parts.push(`${nm} (${l.qty_returned} adet) için ${m(l.refundable)}`); return }
    let t = `${nm} ürününü ${l.qty_returned > 1 ? `${l.qty_returned} adet, tanesi ` : ''}${m(e.paid_unit)} ödeyerek aldınız`
    const disc: string[] = []
    if (e.campaign_unit > 0) disc.push(e.campaign_names.filter((n) => !isTierName(n)).join(', ') || 'ürün kampanyası')
    if (e.tier_unit > 0) disc.push('sepet indirimi')
    if (disc.length) t += ` (${disc.join(' ve ')} uygulanmış fiyat)`
    if (e.coupon_unit > 0) t += `; kullandığınız indirim kodunun bu ürüne düşen ${m(e.coupon_unit * l.qty_returned)} payı düşülür`
    parts.push(t)
  })
  let script = parts.join('. ') + '.'
  if (tier) {
    script += ` Siparişinizde ${Math.round(tier.threshold).toLocaleString('tr-TR')} TL üzeri sepet indirimi vardı; bu iadeden sonra elinizde kalan ürünlerin tutarı ${m(tier.basket_after)} olduğu için `
      + ((tier.new_rate ?? 0) > 0
        ? `kalan ürünlerinizin sepet indirimi ${pct(tier.old_rate)} yerine ${pct(tier.new_rate)} oluyor; aradaki ${m(tier.amount)} iade tutarından düşülüyor.`
        : `indirim şartı sağlanmıyor ve kalan ürünlerinize uygulanan ${m(tier.amount)} indirim iade tutarından düşülüyor.`)
  }
  if (c.shipping_refundable > 0) script += ` Kargo ücreti ${m(c.shipping_refundable)} de iade ediliyor.`
  script += ` Toplam iade tutarınız ${m(c.total_refundable)}.`

  const copy = () => {
    navigator.clipboard?.writeText(script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  type Tone = 'base' | 'minus' | 'paid' | 'warn' | 'result'
  const Step = ({ n, label, note, value, tone }: { n?: number; label: string; note?: string; value: number; tone: Tone }) => (
    <div className={clsx(
      'flex items-center gap-3 px-3 py-2 rounded-lg',
      tone === 'paid' && 'bg-indigo-50 ring-1 ring-indigo-100',
      tone === 'warn' && 'bg-amber-50 ring-1 ring-amber-200',
      tone === 'result' && 'bg-emerald-600 text-white',
    )}>
      <span className={clsx(
        'w-6 h-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold',
        tone === 'base' && 'bg-gray-100 text-gray-500',
        tone === 'minus' && 'bg-green-100 text-green-700',
        tone === 'paid' && 'bg-indigo-600 text-white',
        tone === 'warn' && 'bg-amber-500 text-white',
        tone === 'result' && 'bg-white/20 text-white',
      )}>
        {tone === 'minus' || tone === 'warn' ? '−' : tone === 'result' ? '✓' : n ?? '•'}
      </span>
      <div className="min-w-0 flex-1">
        <div className={clsx('text-sm leading-tight', tone === 'paid' && 'font-semibold text-indigo-900', tone === 'result' && 'font-semibold', tone === 'warn' && 'font-medium text-amber-900', (tone === 'base' || tone === 'minus') && 'text-gray-700')}>{label}</div>
        {note && <div className={clsx('text-[11px] leading-tight mt-0.5', tone === 'result' ? 'text-emerald-100' : 'text-gray-400')}>{note}</div>}
      </div>
      <div className={clsx(
        'tabular-nums text-sm shrink-0',
        tone === 'minus' && 'text-green-700',
        tone === 'warn' && 'text-amber-700 font-semibold',
        tone === 'paid' && 'text-indigo-900 font-bold',
        tone === 'result' && 'text-base font-bold',
        tone === 'base' && 'text-gray-500',
      )}>{tone === 'minus' || tone === 'warn' ? '−' : ''}{m(value)}</div>
    </div>
  )

  return (
    <div className="rounded-xl overflow-hidden border-2 border-indigo-200 shadow-sm bg-white">
      {/* Başlık bandı */}
      <div className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 text-white px-4 py-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white/15 grid place-items-center shrink-0"><Calculator size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">İade Hesabı — bu tutar nasıl çıktı?</div>
          <div className="text-[12px] text-indigo-100 leading-tight mt-0.5">Müşteri sorarsa hesap yapmayın: adımlar ve hazır anlatım aşağıda.</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-indigo-200">Toplam iade</div>
          <div className="text-2xl font-bold tabular-nums leading-tight">{m(c.total_refundable)}</div>
          {tier && <div className="text-[11px] text-amber-200">sepet düzeltmesi −{m(tier.amount)} dahil</div>}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!hasExplain && (
          <div className="flex gap-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
            <InfoIcon size={14} className="shrink-0 mt-0.5 text-gray-400" />
            <span>Bu talep ayrıntılı hesap dökümünden (10 Ekim) önce açıldı. İade tutarı = müşterinin ürün için ödediği birim fiyat × iade adedi{(c.breakdown?.order_discount ?? 0) > 0 ? ' − indirim kodunun orantılı payı' : ''}.</span>
          </div>
        )}

        {/* Ürün fişleri */}
        {c.lines.map((l) => {
          const e = l.explain
          let i = 0
          return (
            <div key={l.line_id} className="rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 rounded-t-lg">
                <Receipt size={15} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-900 truncate">{nameOf(l)}</span>
                <span className="ml-auto text-[11px] font-semibold bg-gray-900 text-white rounded-full px-2 py-0.5 shrink-0">{l.qty_returned} adet iade</span>
              </div>
              <div className="p-2 space-y-1">
                {e ? (
                  <>
                    <Step n={++i} tone="base" label="Liste fiyatı" value={e.list_unit} />
                    {e.product_discount_unit > 0 && <Step tone="minus" label="Ürün indirimi" note="sitede indirimli satış fiyatı" value={e.product_discount_unit} />}
                    {e.campaign_unit > 0 && <Step tone="minus" label={e.campaign_names.filter((n) => !isTierName(n)).join(', ') || 'Ürün kampanyası'} note="kampanya indiriminin bu ürüne düşen payı" value={e.campaign_unit} />}
                    {e.tier_unit > 0 && <Step tone="minus" label={`Sepet indirimi${e.tier_rate ? ` (${pct(e.tier_rate)})` : ''}`} note={e.campaign_names.filter(isTierName).join(' + ')} value={e.tier_unit} />}
                    <Step tone="paid" label="Müşterinin bu ürün için ödediği" note={l.qty_returned > 1 ? `birim fiyat · ${l.qty_returned} adet` : 'birim fiyat'} value={e.paid_unit} />
                    {e.coupon_unit > 0 && <Step tone="minus" label="İndirim kodu payı" note="kupon tüm ürünlere fiyatlarıyla orantılı dağıtılır" value={e.coupon_unit} />}
                    {(l.campaign_deduction ?? 0) > 0 && <Step tone="warn" label="Sepet indirimi düzeltmesi" note="aşağıdaki sarı kutuda açıklandı" value={l.campaign_deduction!} />}
                  </>
                ) : (
                  <Step tone="paid" label="Ödenen birim fiyat" note={`× ${l.qty_returned} adet`} value={l.effective_unit_price} />
                )}
                <Step tone="result" label="Bu ürün için iade" note={e && l.qty_returned > 1 ? `${l.qty_returned} adet toplamı` : undefined} value={l.refundable} />
              </div>
            </div>
          )
        })}

        {/* Sepet indirimi kontrolü — kademe varsa her zaman: kesildi / korunuyor / eşik yoktu / tam iade */}
        {check && (() => {
          const thr = `${Math.round(check.status === 'recovered' && tier ? tier.threshold : check.threshold).toLocaleString('tr-TR')} TL`
          const tone = check.status === 'recovered' ? 'amber' : check.status === 'kept' ? 'green' : 'slate'
          const title = check.status === 'recovered' ? `Sepet indirimi düzeltmesi: −${m(tier?.amount ?? 0)}`
            : check.status === 'kept' ? 'Sepet indirimi korunuyor — ek kesinti yok'
            : check.status === 'unenforced' ? 'Sepet indirimi geri alınmadı — sipariş tarihinde eşik uygulanmıyordu'
            : 'Tüm ürünler iade ediliyor — sepet indirimi kontrolü gerekmez'
          return (
            <div className={clsx('rounded-lg border-2 p-3',
              tone === 'amber' && 'bg-amber-50 border-amber-300',
              tone === 'green' && 'bg-emerald-50 border-emerald-300',
              tone === 'slate' && 'bg-slate-50 border-slate-300')}>
              <div className={clsx('flex items-center gap-2 font-semibold text-[13px]',
                tone === 'amber' && 'text-amber-900', tone === 'green' && 'text-emerald-900', tone === 'slate' && 'text-slate-800')}>
                {tone === 'amber' ? <AlertTriangle size={16} className="text-amber-500" /> : tone === 'green' ? <CheckCircle2 size={16} className="text-emerald-600" /> : <InfoIcon size={16} className="text-slate-500" />}
                {title}
              </div>

              {/* Sepet akışı: sipariş → iade → kalan */}
              {check.status !== 'full_return' && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-white border border-gray-200 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Sipariş sepeti</div>
                    <div className="text-sm font-semibold tabular-nums">{m(check.basket_before)}</div>
                    <div className="text-[10px] text-gray-500">{pct(check.rate)} sepet indirimi aldı</div>
                  </div>
                  <div className="rounded-md bg-white border border-gray-200 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">İade edilen</div>
                    <div className="text-sm font-semibold tabular-nums">−{m(check.basket_before - check.basket_after)}</div>
                    <div className="text-[10px] text-gray-500">indirimsiz tutar</div>
                  </div>
                  <div className={clsx('rounded-md px-2 py-1.5 border', check.status === 'kept' ? 'bg-emerald-100 border-emerald-200' : 'bg-white border-gray-200')}>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Kalan sepet</div>
                    <div className="text-sm font-semibold tabular-nums">{m(check.basket_after)}</div>
                    <div className={clsx('text-[10px]', check.status === 'recovered' ? 'text-amber-700 font-medium' : 'text-gray-500')}>
                      eşik {thr} {check.status === 'kept' ? '✓ üstünde' : '✗ altında'}
                    </div>
                  </div>
                </div>
              )}

              <div className={clsx('mt-2 text-xs leading-relaxed',
                tone === 'amber' && 'text-amber-900', tone === 'green' && 'text-emerald-900', tone === 'slate' && 'text-slate-700')}>
                {check.status === 'recovered' && tier && (
                  (tier.new_rate ?? 0) > 0
                    ? <>İadeden sonra kalan ürünler artık {thr} eşiğini geçmiyor; kalan ürünlerin sepet indirimi <b>{pct(tier.old_rate)} yerine {pct(tier.new_rate)}</b> olur. Aradaki <b>{m(tier.amount)}</b> iade tutarından düşüldü — böylece müşteri kalan ürünleri hak ettiği fiyatla almış olur.</>
                    : <>İadeden sonra kalan ürünler artık {thr} eşiğini geçmiyor; <b>kalan ürünlerdeki {pct(tier.old_rate)} indirim ({m(tier.amount)})</b> iade tutarından düşüldü — müşteri kalan ürünleri indirimsiz fiyatıyla almış olur. İade edilen ürünün kendi indirimi zaten iade edilmiyor (müşteri ödediğini geri alıyor).</>
                )}
                {check.status === 'kept' && <>Kalan ürünler hâlâ {thr} eşiğinin üstünde; müşteri sepet indirimini hak etmeye devam ediyor. İade tutarı = ürün için ödenen tutar.</>}
                {check.status === 'unenforced' && <>Bu sipariş, indirimin sepet tutarına bakılmadan herkese uygulandığı bir saatte verilmiş (Tonny: 4 Eki 23:00 – 6 Eki 06:00). Kalan sepet eşiğin altında olsa da müşteri bu indirimi zaten koşulsuz almıştı; bu yüzden geri alınmaz. İade tutarı = ürün için ödenen tutar.</>}
                {check.status === 'full_return' && <>Müşteri ödediği tutarın tamamını geri alır.</>}
              </div>
            </div>
          )
        })()}

        {/* Toplam */}
        <div className="rounded-lg bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="text-sm">
            <div className="font-semibold">Toplam iade</div>
            <div className="text-[11px] text-gray-400">
              {c.lines.length} ürün{c.shipping_refundable > 0 ? ` + kargo ${m(c.shipping_refundable)}` : ''}{c.capped ? ' · ödenen tutarla sınırlandı' : ''}
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums">{m(c.total_refundable)}</div>
        </div>

        {/* Müşteriye anlatım */}
        <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/70 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <MessageSquareText size={16} className="text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">Müşteriye böyle anlatın</span>
            <button
              type="button"
              onClick={copy}
              className={clsx('ml-auto text-xs font-medium rounded-md px-2.5 py-1 flex items-center gap-1 transition', copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700')}
            >
              <Copy size={12} /> {copied ? 'Kopyalandı' : 'Metni kopyala'}
            </button>
          </div>
          <p className="text-[13px] text-indigo-950 leading-relaxed bg-white rounded-md border border-indigo-100 p-2.5">“{script}”</p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={clsx('tabular-nums', strong && 'font-semibold text-gray-900', muted && 'text-gray-400')}>{value}</span>
    </div>
  )
}

/**
 * Yetkili istekle indirilen ek görseli: görsel uçları auth istediğinden düz <img src>
 * 401 alır (Bearer token header'ı taşınamaz) → blob'u axios ile çekip object-URL göster.
 * Tıklayınca tam boyut yeni sekmede açılır.
 */
function AuthImage({ url, alt, className }: { url: string; alt: string; className: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let obj: string | null = null
    let cancelled = false
    returnsAdminApi.fetchAttachmentBlob(url)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u)
        else { obj = u; setSrc(u) }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (obj) URL.revokeObjectURL(obj)
    }
  }, [url])

  // Büyütme açıkken Escape ile kapat
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (failed) {
    return <div className={clsx(className, 'bg-gray-100 flex items-center justify-center text-[10px] text-gray-400')}>yüklenemedi</div>
  }
  if (!src) {
    return <div className={clsx(className, 'bg-gray-100 animate-pulse')} />
  }
  return (
    <>
      <img src={src} alt={alt} title={alt} className={className} onClick={() => setOpen(true)} />
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center"
            aria-label="Kapat"
          >
            <XCircle size={22} />
          </button>
          <img
            src={src} alt={alt}
            className="max-w-[92vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    submit: 'Talep oluşturuldu',
    transition: 'Durum güncellendi',
    auto_transition: 'Otomatik durum güncellemesi (kargo takip)',
    cancel_process: 'İptal otomatik işlendi (Nebim+Ticimax)',
    cancel_process_failed: 'İptal otomatik işlemde sorun',
    staff_approve: 'Personel onayladı',
    manager_approve: 'Para iadesi onaylandı',
    ticimax_return_status: 'Ticimax sipariş statüsü güncellendi (ödeme sonrası)',
    ticimax_staff_approved: "Ticimax'ta İade Ulaştı Ödeme Yapılacak statüsüne çekildi",
    ticimax_reject_revert: 'Ticimax sipariş statüsü iade öncesine geri çekildi',
    manager_approve_reverted: 'Onay geri alındı (ödeme kanalı reddetti)',
    refund: 'Para iadesi işlendi (kupon)',
    refund_failed: 'Para iadesinde sorun',
    refund_reverted: 'İade denemesi geri alındı (tekrar denenebilir)',
    refund_pending_manual: 'Karta iade manuel işaretlendi',
    refund_bank_transfer_opened: 'Havale ile iade açıldı (ödeme bekleniyor)',
    bank_account_saved: 'Havale bilgisi kaydedildi',
    closed_without_refund: 'Kapıda ödeme iptali — iade gerekmediği için kapatıldı',
    reject: 'Reddedildi',
    lookup: 'Sipariş sorgulandı',
    cargo_created: 'İade kargo kodu oluşturuldu',
    cargo_create_failed: 'Kargo kodu oluşturulamadı',
    ticimax_return_requested: "Ticimax'ta İade Talebi Alındı statüsüne çekildi",
    shipment_expired: 'İade kodu süresi doldu — kargo kaydı silindi',
    customer_photos: 'Müşteri kusur fotoğrafları yüklendi',
    staff_note: 'Personel notu',
    defect_approve: 'Kusur bildirimi yönetici tarafından ONAYLANDI (kargo kodu)',
    defect_reject: 'Kusur bildirimi yönetici tarafından REDDEDİLDİ',
  }
  if (action.startsWith('sms_')) return 'SMS: ' + smsEventLabel(action.slice(4))
  return map[action] ?? action
}

function smsEventLabel(event: string): string {
  const map: Record<string, string> = {
    submitted: 'Talep alındı',
    cancel_processing: 'İptal işleme alındı',
    cargo_code: 'İade kargo kodu',
    in_transit: 'Kargo yola çıktı',
    received: 'Depoya ulaştı',
    staff_approved: 'Depo incelemesi onaylandı',
    approved: 'Onaylandı',
    rejected: 'Reddedildi',
    defect_approved: 'Kusur bildirimi onaylandı (kargo kodu)',
    defect_rejected: 'Kusur bildirimi reddedildi (nedenli)',
    refunded: 'İade tamamlandı',
    expired: 'İade kodu süresi doldu',
  }
  return map[event] ?? event
}

function refundProviderLabel(provider: string): string {
  const map: Record<string, string> = {
    store_credit: 'İndirim kodu',
    paytr: 'Karta iade (PayTR)',
    iyzico: 'Karta iade (iyzico)',
    original: 'Karta iade (manuel)',
    bank_transfer: 'Havale / EFT (kapıda ödeme)',
  }
  return map[provider] ?? 'Karta iade'
}

function refundStatusLabel(status: string): string {
  const map: Record<string, string> = {
    succeeded: 'tamamlandı',
    dry_run: 'hazırlandı',
    failed: 'başarısız',
    pending_manual: 'havale/manuel ödeme bekliyor',
    processing: 'işleniyor',
  }
  return map[status] ?? status
}
