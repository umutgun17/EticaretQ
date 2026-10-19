import api from './api'
import type { RefundLine, TierCheck, TierRecovery } from './returnsApi'

/**
 * Personel/Yönetici İade Yönetim Paneli (Faz 3) API client.
 * Tüm uçlar auth + permission:returns korumalı (api instance token/tenant header ekler).
 */

export interface ReturnTimer {
  deadline: string | null
  hours_left: number | null
  sla_breached: boolean
}

/** Liste satırındaki kalem özeti (Trendyol tarzı zengin satır + satır içi aksiyon için). */
export interface ReturnListRowItem {
  id: number
  product_name: string | null
  sku: string | null
  barcode: string | null
  variant_info: string | null
  image_url: string | null
  qty_ordered: number
  qty_requested: number
  qty_approved: number | null
  unit_price: number
  refundable_amount: number
  reason_code: string | null
  reason_note: string | null
  item_condition: string | null
}

export interface ReturnListRowAttachment {
  id: number
  kind: string
  url: string
}

/** Personel notu (iç kayıt — müşteri görmez; para onayı ekranlarında zorunlu gösterilir). */
export interface ReturnStaffNote {
  id: number
  note: string
  actor_name: string | null
  created_at: string | null
}

/** Havale ile iade (kapıda ödeme) için müşterinin/personelin girdiği hesap bilgisi. */
export interface ReturnBankAccount {
  /** Opsiyonel — havale IBAN + ad soyad ile yapılır, banka IBAN'da zaten kodludur. */
  bank_name: string
  account_holder: string
  iban: string
  collected_at?: string | null
  updated_by?: string | null
  updated_at?: string | null
}

export type ReturnTypeValue = 'return' | 'cancel' | 'defect' | 'shortage'

/** PERSONEL kaynaklı eksik/hatalı ürün iadesi ayrıntıları (type === 'shortage'). */
export type ShortageStage = 'pre_ship' | 'delivered' | 'returned'
/** Personel ekranı modu: eksik/hatalı ürün (varsayılan) veya geri dönen sipariş (ayrı sayfa + yetki). */
export type ShortageMode = 'shortage' | 'returned'
const shortageBase = (mode: ShortageMode = 'shortage') => (mode === 'returned' ? '/returns/returned' : '/returns/shortage')

export interface ReturnShortageInfo {
  /** pre_ship = depo çıkaramadı (gönderim öncesi) · delivered = teslimat sonrası müşteri bildirimi (Ticimax'a yazılmaz). */
  stage: ShortageStage
  stage_label: string
  /** Seçim siparişin tamamını kapsıyor mu (→ pre_ship'te iptal gibi, Ticimax statüsü yazılır). */
  is_full: boolean
  staff_note: string | null
  /** Yunbi tarafında tutulan işlem özeti (Ticimax'a not yazılmaz). */
  summary: string | null
  created_by_name: string | null
  ticimax: { dry_run: boolean; lines: { ok: boolean | null; text: string }[] } | null
  apology_coupon: { success: boolean; code: string | null; amount: number; days: number; dry_run: boolean; error: string | null } | null
}

export interface ReturnListRow {
  id: number
  public_code: string
  type: ReturnTypeValue
  status: string
  status_label: string
  order_no: string | null
  customer_name: string | null
  customer_email: string | null
  currency: string
  requested_amount: number
  approved_amount: number | null
  items_count: number
  created_at: string | null
  timer: ReturnTimer
  cargo_provider: string | null
  cargo_tracking_code: string | null
  /** Kargo firmasının takip sayfası (Sürat); sağlayıcıda takip linki yoksa null. */
  cargo_tracking_url: string | null
  /** Paket üzerindeki 11 haneli barkod (takip no'dan farklı) — depo eşleştirmesi için. */
  cargo_barcode: string | null
  /**
   * Kargo kodu ÜRETİLEMEDİ (sağlayıcı hatası) — talep kodsuz Pending'de takılı. Yalnız
   * cargo_tracking_code null iken dolu olur; kod üretilince temizlenir.
   */
  cargo_error: {
    error?: string
    at?: string
    retry_count?: number
    /** Otomatik yeniden deneme azami sayıya ulaştı → personel eli gerekiyor. */
    giving_up?: boolean
  } | null
  refund_method: string | null
  refund_method_label: string | null
  /** Sipariş kapıda ödemeli mi (canlı ödeme bloğundan tespit; havale/iadesiz yöntem de işaret eder). */
  is_cod: boolean
  /** Kapıda ödeme hizmet bedeli (bilgi amaçlı; iade tutarına dahil DEĞİL). */
  cod_fee: number
  /** Havale ile iade hesabı — onay pencerelerinde de gösterilir. */
  bank_account: ReturnBankAccount | null
  /** Siparişin ÖDEME TÜRÜ (iade yönteminden ayrı): cod | online · null = tespit edilememiş eski talep. */
  payment_type: 'cod' | 'online' | null
  payment_type_label: string | null
  platform_order_id: string | null
  admin_order_url: string | null
  /** Depoya teslim anı — kargo firmasının verdiği tarih/saat (yoksa cron anı). */
  received_at: string | null
  /** Kargo firmasından teslim kanıtı: tarih/saat, teslim alan, teslim yeri. */
  delivery: ReturnDelivery | null
  /** Talebi panelden açan personel (yalnız personel kaynaklı taleplerde). */
  created_by_name?: string | null
  shortage?: ReturnShortageInfo | null
  items?: ReturnListRowItem[]
  attachments?: ReturnListRowAttachment[]
  staff_notes?: ReturnStaffNote[]
}

export interface ReturnDelivery {
  delivered_at?: string | null
  delivered_at_raw?: string | null
  received_by?: string | null
  delivered_place?: string | null
  provider?: string | null
  backfilled?: boolean
}

export interface ReturnStats {
  total: number
  actionable: number
  pending: number
  processing: number
  received: number
  staff_approved: number
  manager_approved: number
  refunding: number
  completed: number
  rejected: number
  // Sekme rozetleri (index grup filtreleriyle birebir aynı kümeler)
  in_transit: number
  requested: number
  approved_group: number
  cancelled: number
  awaiting_manager: number
  defect_review: number
  /** Personel kaynaklı eksik/hatalı ürün iadeleri — para onayı bekleyen. */
  shortage_awaiting: number
  /** Geri dönen sipariş kayıtları (personel) — para onayı bekleyen. */
  returned_awaiting: number
  refunded_done: number
  closed: number
  sla_breached: number
  staff_review_hours: number
  manager_review_hours: number
}

export interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export interface ReturnDetailItem {
  id: number
  product_name: string | null
  sku: string | null
  barcode: string | null
  variant_info: string | null
  image_url: string | null
  qty_ordered: number
  qty_requested: number
  qty_approved: number | null
  unit_price: number
  refundable_amount: number
  reason_code: string | null
  reason_note: string | null
  item_condition: string | null
}

export interface ReturnTimelineEvent {
  id: number
  actor_type: string
  actor_name: string | null
  action: string
  from_status: string | null
  to_status: string | null
  amount: number | null
  note: string | null
  created_at: string | null
}

export interface ReturnAttachmentView {
  id: number
  kind: string
  original_name: string | null
  mime_type: string | null
  size_bytes: number | null
  url: string
}

export interface ReturnDetail extends ReturnListRow {
  customer_phone: string | null
  refund_method: string | null
  paid_amount_snapshot: number | null
  refunded_amount: number
  reject_reason: string | null
  cargo_tracking_code: string | null
  staff_approved_by: string | null
  staff_approved_at: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  eligibility_snapshot: Record<string, unknown> | null
  /** Sepet kampanyası telafisi: iade tutarından düşülen geri alınan kampanya indirimi (0 = yok). */
  campaign_recovery?: number
  /** İndirimi pasifleşen (sepette kalan) ürünün adı. */
  campaign_revoked_from?: string | null
  /** Talep anındaki iade hesabı (kalem açıklamalı; eski taleplerde explain yok) */
  calculation?: {
    lines: RefundLine[]
    items_refundable: number
    shipping_refundable: number
    total_refundable: number
    capped: boolean
    breakdown: { order_discount?: number; shipping_cost?: number; full_return?: boolean; campaign_recovery?: number; tier_recovery?: TierRecovery | null; tier_check?: TierCheck | null }
  } | null
  // Kusur bildirimi: müşteri şikâyeti + yönetici red ekranındaki tanımlı nedenler
  complaint: string | null
  defect_reject_reasons: string[] | null
  allowed_transitions: { value: string; label: string }[]
}

export interface CancelPreviewLine { LineID: string; Qty1: number; OrderCancelReasonCode: string }
export interface CancelPreview {
  ok: boolean
  error: string | null
  scope: 'full' | 'partial' | null
  refund_amount: number | null
  nebim: { order_number: string | null; lines: CancelPreviewLine[]; payment: { Amount: number } | null } | null
  ticimax: { method: 'full' | 'partial'; note: string } | null
}
export interface NebimResultView {
  success: boolean
  dry_run: boolean | null
  order_number: string | null
  is_full: boolean | null
  error: string | null
  amount: number | null
  lines_count: number | null
}

export interface ReturnSmsEvent {
  id: number
  event: string
  sent: boolean
  dry_run: boolean
  message: string | null
  error: string | null
  created_at: string | null
}

// Faz 4 — para iadesi denemesi (store_credit kuponu / original manuel).
export interface RefundView {
  id: number
  provider: string // store_credit | original
  status: string // succeeded | dry_run | failed | pending_manual | processing
  amount: number
  currency: string
  coupon_code: string | null
  provider_txn_id: string | null
  attempts: number
  error_message: string | null
  processed_at: string | null
}

export interface ReturnDetailResponse {
  request: ReturnDetail
  items: ReturnDetailItem[]
  timeline: ReturnTimelineEvent[]
  sms: ReturnSmsEvent[]
  attachments: ReturnAttachmentView[]
  cancel_preview: CancelPreview | null
  nebim_result: NebimResultView | null
  ticimax_cancel: { method?: string; mode?: string; dry_run?: boolean; durum?: string; error?: string | null } | null
  ticimax_return: { method?: string; mode?: string; dry_run?: boolean; durum?: string; success?: boolean; error?: string | null; payload?: { durum?: string } | null } | null
  refunds: RefundView[]
  refund_actionable: boolean
}

export interface ReturnListParams {
  status?: string
  type?: string
  /** İade yöntemi filtresi: original (karta iade) | store_credit (indirim kuponu) */
  refund_method?: string
  /** Ödeme türü filtresi: cod (kapıda ödeme) | online (kartlı/online) */
  payment_type?: string
  q?: string
  from?: string
  to?: string
  page?: number
  per_page?: number
  sort_dir?: 'asc' | 'desc'
  /** sla: onaya en az süresi kalan üstte · workqueue: bekleyenler üstte, işlem görenler en sonda */
  sort?: 'sla' | 'workqueue'
}

// ── Muhasebe: kapıda ödeme havale ödeme emirleri ──

/** Muhasebeye iletildi damgası (çift havaleyi önler; talebin durumunu DEĞİŞTİRMEZ). */
export interface PayoutAccountingStamp {
  sent_at: string | null
  sent_by: string | null
  batch: string | null
}

export interface PayoutRow {
  id: number
  public_code: string
  order_no: string | null
  platform_order_id: string | null
  type: 'return' | 'cancel' | 'defect'
  type_label: string
  status: string
  status_label: string
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  currency: string
  amount: number
  refunded_amount: number
  account_holder: string | null
  iban: string | null
  bank_name: string | null
  cod_fee: number
  created_at: string | null
  staff_approved_at: string | null
  manager_approved_at: string | null
  transfer_txn: string | null
  accounting: PayoutAccountingStamp | null
  /** awaiting_approval: önce para onayı + havale kapanışı · approved: yalnız kapanış · paid · pipeline */
  payment_stage: 'awaiting_approval' | 'approved' | 'paid' | 'pipeline'
  /** Havale kapanışı bu satır için yapılabilir mi (IBAN var + yöntem havale + uygun durum). */
  payable: boolean
}

/** payable: ödenecek kuyruğu (para onayı bekleyenler dâhil) · pipeline: kargo sürecinde · paid: kapanmış. */
export type PayoutScope = 'payable' | 'pipeline' | 'paid'

export interface PayoutListResponse {
  scope: PayoutScope
  data: PayoutRow[]
  summary: {
    count: number
    amount: number
    missing_iban: number
    not_sent: number
    /** Fiilen ödenebilir (IBAN'ı girilmiş) satırların adedi/tutarı — muhasebeye giden kısım. */
    payable_count: number
    payable_amount: number
    currency: string
  }
  counts: Record<PayoutScope, number>
  truncated: boolean
  limit: number
}

export interface PayoutListParams {
  scope?: PayoutScope
  q?: string
  from?: string
  to?: string
  unsent_only?: boolean
  missing_iban_only?: boolean
  /** Yalnız IBAN'ı girilmiş, fiilen ödenebilir satırlar (çıktı/CSV varsayılanı). */
  only_payable?: boolean
}

export interface ReturnReport {
  from: string
  to: string
  total: { count: number; requested: number; approved: number; refunded: number }
  by_type: Record<'cancel' | 'return', { count: number; approved: number; refunded: number }>
  by_status: { status: string; label: string; count: number; requested: number; approved: number; refunded: number }[]
  by_refund_method: { method: string; count: number; approved: number }[]
}

// ── SMS Yönetimi (İade Yönetimi alt sayfası) ──

export interface ReturnSmsLogRow {
  id: number
  event: string
  event_label: string
  sent: boolean
  dry_run: boolean
  event_disabled: boolean
  message: string | null
  error: string | null
  created_at: string | null
  request: {
    id: number
    public_code: string
    customer_name: string | null
    customer_phone: string | null
    type: 'return' | 'cancel'
  } | null
}

export interface ReturnSmsEventSetting {
  key: string
  label: string
  default_template: string
  enabled: boolean
  template: string | null
}

export interface ReturnSmsSettings {
  enabled: boolean
  dry_run: boolean
  msgheader: string | null
  events: ReturnSmsEventSetting[]
  placeholders: string[]
}

// ── EKSİK / HATALI ÜRÜN İADESİ (personel başlatır) ──

export interface ShortageOrderItem {
  line_id: string
  name: string | null
  sku: string | null
  barcode: string | null
  variant_info: string | null
  image_url: string | null
  qty: number
  /** Daha önce eksik/hatalı iadesi açılmış adetler düşülmüş kalan adet. */
  qty_available: number
  qty_prior_shortage: number
  unit_price: number
  status_label: string | null
}

export interface ShortageLookupResponse {
  order: {
    platform_order_id: string
    order_no: string | null
    status: number
    status_label: string | null
    order_date: string | null
    currency: string
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    total_amount: number
    paid_amount: number
    shipping_cost: number
    cargo_company: string | null
    cargo_tracking_no: string | null
    admin_url: string | null
    custom_fields: Record<string, string>
    items: ShortageOrderItem[]
  }
  eligibility: { can_create: boolean; status: number; status_label: string | null; reasons: string[] }
  existing: { id: number; public_code: string; type: string; type_label: string; status: string; status_label: string; amount: number; created_at: string | null }[]
  payment: { cod: boolean; cod_fee: number; checked: boolean }
  /** Sipariş durumundan otomatik: pre_ship (gönderilmemiş) / delivered (kargoda-teslim) / null (uygun değil). */
  stage: ShortageStage | null
  stage_label: string | null
  reasons: Record<string, string>
  warnings: string[]
}

export interface ShortagePreviewResponse {
  calculation: {
    currency: string
    lines: { line_id: string; name: string | null; qty_returned: number; unit_price: number; effective_unit_price: number; discount_share: number; refundable: number }[]
    items_refundable: number
    shipping_refundable: number
    total_refundable: number
    cap: number | null
    capped: boolean
    warnings: string[]
  }
  is_full: boolean
}

export interface ShortageCreatePayload {
  platform_order_id: string
  items: { line_id: string; qty: number; reason_code: string; reason_note?: string }[]
  staff_note?: string
}

export interface ShortageCreateResponse {
  id: number
  public_code: string
  status: string
  status_label: string
  refund_method: string | null
  requested_amount: number
  approved_amount: number
  currency: string
  is_full: boolean
  stage: ShortageStage | null
  ticimax: Record<string, unknown> | null
  settled: { coupon: { success: boolean; code: string; amount: number; dry_run: boolean; error: string | null } | null; sms: { sent: boolean; dry_run: boolean; message: string } } | null
  message: string
}

export const returnsAdminApi = {
  shortageLookup: (ref: string, mode: ShortageMode = 'shortage') =>
    api.post<ShortageLookupResponse>(`${shortageBase(mode)}/lookup`, { ref }).then((r) => r.data),
  shortagePreview: (platform_order_id: string, items: { line_id: string; qty: number }[], mode: ShortageMode = 'shortage') =>
    api.post<ShortagePreviewResponse>(`${shortageBase(mode)}/preview`, { platform_order_id, items }).then((r) => r.data),
  shortageCreate: (payload: ShortageCreatePayload, mode: ShortageMode = 'shortage') =>
    api.post<ShortageCreateResponse>(shortageBase(mode), payload).then((r) => r.data),

  list: (params: ReturnListParams) =>
    api.get<Paginated<ReturnListRow>>('/returns', { params }).then((r) => r.data),

  stats: () => api.get<ReturnStats>('/returns/stats').then((r) => r.data),

  report: (params: { from?: string; to?: string }) =>
    api.get<ReturnReport>('/returns/report', { params }).then((r) => r.data),

  detail: (id: number) =>
    api.get<ReturnDetailResponse>(`/returns/${id}`).then((r) => r.data),

  transition: (id: number, to_status: string, note?: string) =>
    api.post(`/returns/${id}/transition`, { to_status, note }).then((r) => r.data),

  approveStaff: (id: number, payload: { approved_amount?: number; note?: string }) =>
    api.post(`/returns/${id}/approve-staff`, payload).then((r) => r.data),

  approveManager: (id: number, payload: { approved_amount?: number; note?: string }) =>
    api.post(`/returns/${id}/approve-manager`, payload).then((r) => r.data),

  // Para iadesini elle tetikle / yeniden dene (store_credit kuponu). İdempotent.
  refund: (id: number) =>
    api.post(`/returns/${id}/refund`, {}).then((r) => r.data),

  /**
   * Ek görselini YETKİLİ istekle indirip object-URL döndürür. Görsel uçları auth ister;
   * düz <img src>/<a href> Authorization header taşıyamadığı için 401 alır (2026-07-24 saha).
   */
  fetchAttachmentBlob: (url: string) =>
    api.get(url, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data as Blob)),

  // Kusur bildirimi kararı — yalnızca firma yöneticisi (backend ayrıca denetler)
  approveDefect: (id: number, note?: string) =>
    api.post(`/returns/${id}/defect-approve`, { note }).then((r) => r.data),

  rejectDefect: (id: number, reason: string, note?: string) =>
    api.post(`/returns/${id}/defect-reject`, { reason, note }).then((r) => r.data),

  // Havale ile iade (kapıda ödeme): hesap bilgisini kaydet/düzelt.
  saveBankAccount: (id: number, payload: { bank_name?: string; account_holder: string; iban: string }) =>
    api.put<{ message: string; request: ReturnDetail }>(`/returns/${id}/bank-account`, payload).then((r) => r.data),

  // Havale FİİLEN yapıldı → talebi kapat (Refunded + Ticimax statüsü + müşteriye SMS).
  markTransferred: (id: number, payload: { amount?: number; txn?: string; note: string }) =>
    api.post(`/returns/${id}/mark-transferred`, payload).then((r) => r.data),

  // Personel notu ekle (iç kayıt; müşteriye bildirim gitmez). Yanıt: güncel not listesi.
  addNote: (id: number, note: string) =>
    api.post<{ staff_notes: ReturnStaffNote[] }>(`/returns/${id}/notes`, { note }).then((r) => r.data),

  reject: (id: number, reason: string, attachment?: File) => {
    const form = new FormData()
    form.append('reason', reason)
    if (attachment) form.append('attachment', attachment)
    return api.post(`/returns/${id}/reject`, form).then((r) => r.data)
  },

  // ── Muhasebe: havale ödeme emirleri (IBAN taşır → uçlar yönetici yetkisi arar) ──
  payouts: (params: PayoutListParams) =>
    api.get<PayoutListResponse>('/returns/payouts', { params }).then((r) => r.data),

  /** Aynı listenin Excel uyumlu CSV'si — tarayıcıda indirme tetikler. */
  payoutsExport: async (params: PayoutListParams) => {
    const res = await api.get('/returns/payouts/export', { params, responseType: 'blob' })
    const match = /filename="?([^";]+)"?/.exec(String(res.headers['content-disposition'] ?? ''))
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = match?.[1] ?? 'kapida-odeme-havale-listesi.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  /** Seçili talepleri "muhasebeye iletildi" olarak damgala (durum değişmez, para hareketi YOK). */
  markAccountingSent: (ids: number[], note?: string) =>
    api.post<{ batch: string; marked: number; skipped: number; message: string }>(
      '/returns/payouts/mark-sent', { ids, note }).then((r) => r.data),

  smsLog: (params: { event?: string; status?: string; q?: string; page?: number; per_page?: number }) =>
    api.get<Paginated<ReturnSmsLogRow>>('/returns/sms/log', { params }).then((r) => r.data),

  smsSettings: () => api.get<ReturnSmsSettings>('/returns/sms/settings').then((r) => r.data),

  saveSmsSettings: (payload: { enabled: boolean; events: { key: string; enabled: boolean; template: string | null }[] }) =>
    api.put<ReturnSmsSettings>('/returns/sms/settings', payload).then((r) => r.data),

  uploadAttachment: (id: number, file: File, kind = 'inspection') => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    return api.post(`/returns/${id}/attachments`, form).then((r) => r.data)
  },
}

// ── Görsel yardımcılar ──

export const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800'
    case 'awaiting_shipment':
    case 'in_transit':
      return 'bg-blue-100 text-blue-800'
    case 'received':
      return 'bg-indigo-100 text-indigo-800'
    case 'staff_approved':
      return 'bg-cyan-100 text-cyan-800'
    case 'manager_approved':
      return 'bg-violet-100 text-violet-800'
    case 'processing':
    case 'refunding':
      return 'bg-sky-100 text-sky-800'
    case 'refunded':
    case 'completed':
      return 'bg-emerald-100 text-emerald-800'
    case 'rejected':
    case 'cancelled_by_customer':
      return 'bg-rose-100 text-rose-800'
    case 'defect_review':
      return 'bg-fuchsia-100 text-fuchsia-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

/** Kalan/geciken süreyi gün+saat (kısa sürelerde saat+dakika) olarak yazar: "2 gün 5 sa", "1 sa 30 dk", "45 dk". */
export const fmtHoursLeft = (hours: number): string => {
  const totalMin = Math.max(0, Math.round(Math.abs(hours) * 60))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return h > 0 ? `${d} gün ${h} sa` : `${d} gün`
  if (h > 0) return m > 0 ? `${h} sa ${m} dk` : `${h} sa`
  return `${m} dk`
}

/** Kargo sağlayıcı anahtarı → görünen ad (backend CargoProviderFactory ile aynı sözlük). */
export const cargoProviderLabel = (provider: string | null | undefined): string => {
  const map: Record<string, string> = {
    'surat-kargo': 'Sürat Kargo',
    surat: 'Sürat Kargo',
    'dhl-kargo': 'DHL Kargo',
  }
  return (provider && map[provider]) || provider || 'Kargo'
}

/** Müşteri akışındaki (PublicReturnPage) sebep kodlarının okunur karşılığı. */
export const reasonLabel = (code: string | null | undefined): string | null => {
  if (!code) return null
  const map: Record<string, string> = {
    size: 'Beden / ölçü uymadı',
    not_satisfied: 'Üründen memnun kalmadı',
    defective: 'Hasarlı / kusurlu ürün',
    wrong_item: 'Yanlış ürün geldi',
    changed_mind: 'Vazgeçti / fikri değişti',
    // İptal akışına özel nedenler
    wrong_selection: 'Yanlış ürün / beden / adet seçmiş',
    found_cheaper: 'Daha uygun fiyat bulmuş',
    late_delivery: 'Teslimat süresi uzun',
    address_error: 'Adres / alıcı bilgisi hatalı',
    duplicate_order: 'Mükerrer sipariş',
    other: 'Diğer',
    // Eksik/hatalı ürün iadesi (personel) nedenleri
    missing: 'Eksik ürün',
    defective_stock: 'Hatalı / kusurlu ürün',
    stock_error: 'Stok hatası',
    not_collected: 'Müşteri teslim almadı',
    refused: 'Müşteri teslimatı reddetti',
    returned_other: 'Diğer (kargo geri gönderdi)',
  }
  return map[code] ?? code
}

/** Talep türü rozeti: etiket + renk sınıfı (liste + detay aynı görünsün). */
export const typeBadge = (type: string, long = false, stage?: string | null): { label: string; cls: string } => {
  // Geri dönen sipariş = shortage + stage 'returned' → ayrı ad ve renk (yönetici ayırt edebilsin).
  if (type === 'shortage' && stage === 'returned') {
    return { label: long ? 'Geri Dönen Sipariş (Personel)' : 'Geri Dönen Sipariş', cls: 'bg-teal-100 text-teal-800 ring-1 ring-teal-400' }
  }
  switch (type) {
    case 'cancel':
      return { label: 'İptal', cls: 'bg-orange-100 text-orange-700' }
    case 'defect':
      return { label: long ? 'Kusur Bildirimi' : 'Kusur', cls: 'bg-fuchsia-100 text-fuchsia-700' }
    case 'shortage':
      return { label: long ? 'Eksik / Hatalı Ürün (Personel)' : 'Eksik/Hatalı', cls: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300' }
    default:
      return { label: 'İade', cls: 'bg-gray-100 text-gray-700' }
  }
}

export const fmtMoney = (amount: number | null | undefined, currency = 'TRY'): string => {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount)
}
