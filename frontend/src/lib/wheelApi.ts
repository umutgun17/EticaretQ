import api from './api'

/**
 * Çark (Spin-to-Win) Kampanya Paneli API client.
 * Tüm uçlar auth + permission:wheel korumalı (api instance token/tenant header ekler).
 */

export type WheelPrizeType =
  | 'discount_percent'
  | 'discount_amount'
  | 'free_shipping'
  | 'gift'
  | 'custom'
  | 'none'

export type WheelStatus = 'draft' | 'active' | 'paused' | 'ended'

export interface WheelSlice {
  id?: number
  label: string
  prize_type: WheelPrizeType
  prize_value: number
  weight: number
  color: string | null
  sort_order?: number
  coupon_code_template: string | null
  stock_limit: number | null
  stock_used?: number
  // Min. sepet tutarı (TL) — Ticimax kuponunda MinimumUrunTutari. 0 = koşulsuz.
  min_basket?: number
}

export interface WheelDesign {
  // Seçilen hazır şablon (bkz wheelTemplates.ts). Renkler şablondan türetilir.
  template?: string
  primary_color: string
  // Arka plan gradyanının ikinci rengi (yoksa primary'den koyulaştırılır).
  primary_2?: string
  accent_color: string
  text_color: string
  pointer_color: string
  logo_url: string | null
  title: string
  subtitle: string
  button_label: string
  win_message: string
  lose_message: string
  tab_position: 'left' | 'right'
  tab_label: string
}

export interface WheelTrigger {
  type: 'delay' | 'exit_intent' | 'manual'
  delay_seconds: number
  device: 'all' | 'desktop' | 'mobile'
  frequency_days: number
  show_once_per_win: boolean
}

export interface WheelForm {
  collect_name: boolean
  collect_email: boolean
  collect_phone: boolean
  require_name: boolean
  require_email: boolean
  require_phone: boolean
  kvkk_required: boolean
  kvkk_text: string
  kvkk_version?: string
  comms_required: boolean
  comms_text: string
}

/**
 * Oyun kampanyası ayarları — wheel_campaigns.settings jsonb.
 * Çark kampanyası: A/B eşi (kazı kazan kampanyası) + yüzde. Kazı kazan kampanyası: süre + formsuz mod.
 */
export interface WheelScratchSettings {
  // A/B kampanyası: A (varsayılan) ve B oyun kampanyaları; ziyaretçilerin %N'i B'yi görür
  ab_percent: number
  ab_campaign_a_id: number | null
  ab_campaign_b_id: number | null
  // Kazı kazan: kupon geçerlilik (dakika) — kısa süre = aciliyet
  scratch_valid_minutes: number
  // Kazı kazan: true → form yok, kart açılır açılmaz herkes kazır (lead toplanmaz)
  scratch_skip_form: boolean
}

export type WheelVariant = 'wheel' | 'scratch'
// Kampanya türü: oyunlar + A/B testi (iki oyun kampanyasını karşılaştırır, kendi oyunu yok)
export type WheelGameType = 'wheel' | 'scratch' | 'ab'
export const GAME_LABELS: Record<WheelGameType, string> = { wheel: 'Çark', scratch: 'Kazı Kazan', ab: 'A/B Testi' }

export interface WheelCampaign {
  id: number
  name: string
  slug: string
  tenant_slug?: string
  status: WheelStatus
  status_label: string
  design: WheelDesign
  trigger_rules: WheelTrigger
  form_fields: WheelForm
  starts_at: string | null
  ends_at: string | null
  coupon_provider: 'display' | 'ticimax'
  coupon_valid_hours: number
  // Oyun türü (oluştururken seçilir, sonra değişmez)
  game_type: WheelGameType
  settings: WheelScratchSettings
  ab_a_name?: string | null
  ab_b_name?: string | null
  // Oyun kampanyası yayındaki bir A/B'nin A tarafıysa o A/B'nin adı
  ab_owner_name?: string | null
  is_live_now: boolean
  slices: WheelSlice[]
}

export interface WheelVariantStats {
  campaign_id: number
  name: string
  valid_minutes: number | null
  variant: WheelVariant
  spins: number
  wins: number
  coupons_issued: number
  coupons_redeemed: number
  redeem_rate: number
  revenue: number
}

export interface WheelCampaignRow {
  id: number
  name: string
  slug: string
  status: WheelStatus
  slices_count: number
  leads_count: number
  spins_count: number
  game_type?: WheelGameType
  ab_percent?: number
  ab_a_name?: string | null
  ab_b_name?: string | null
  ab_a_game?: WheelGameType | null
  ab_b_game?: WheelGameType | null
  ab_owner_name?: string | null
  scratch_valid_minutes?: number | null
  scratch_skip_form?: boolean | null
  created_at: string
}

export interface WheelStats {
  leads: number
  spins: number
  wins: number
  win_rate: number
  coupons_issued: number
  coupons_redeemed: number
  redeem_rate: number
  coupons_pending: number
  coupons_failed: number
  revenue: number
  by_slice: { prize_label: string; total: number; redeemed: number }[]
  // A/B kırılımı (çark vs kazı kazan); yalnız veri olan varyantlar döner
  by_variant: WheelVariantStats[]
}

export interface WheelLeadRow {
  id: number
  full_name: string | null
  email: string | null
  phone: string | null
  kvkk_consent: boolean
  is_test?: boolean
  prize_label: string | null
  coupon_code: string | null
  is_win: boolean | null
  coupon_status?: 'none' | 'pending' | 'issued' | 'failed' | 'redeemed' | 'expired' | null
  variant?: WheelVariant | null
  coupon_provider?: string | null
  coupon_expires_at?: string | null
  redeemed_at?: string | null
  comms_consent?: boolean
  // Çevirme anı (spin) ve — varsa — o kuponla verilen sipariş bilgileri.
  spun_at?: string | null
  used_at?: string | null
  order_id?: number | null
  order_no?: string | null
  order_total?: number | string | null
  created_at: string
}

export interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export type WheelCampaignPayload = Partial<
  Omit<WheelCampaign, 'id' | 'status_label' | 'is_live_now' | 'slices' | 'design' | 'ab_a_name' | 'ab_b_name' | 'ab_owner_name'>
> & {
  slices?: WheelSlice[]
  // Kısmi design gönderilebilir; backend config varsayılanlarıyla birleştirir (mergeArray).
  design?: Partial<WheelDesign>
}

export const wheelApi = {
  list: (params?: { status?: string; q?: string; page?: number; game_type?: WheelGameType; per_page?: number }) =>
    api.get<Paginated<WheelCampaignRow>>('/wheel/campaigns', { params }).then((r) => r.data),

  get: (id: number) => api.get<WheelCampaign>(`/wheel/campaigns/${id}`).then((r) => r.data),

  create: (payload: WheelCampaignPayload) =>
    api.post<WheelCampaign>('/wheel/campaigns', payload).then((r) => r.data),

  update: (id: number, payload: WheelCampaignPayload) =>
    api.put<WheelCampaign>(`/wheel/campaigns/${id}`, payload).then((r) => r.data),

  remove: (id: number) => api.delete(`/wheel/campaigns/${id}`).then((r) => r.data),

  leads: (id: number, params?: { page?: number; per_page?: number; from?: string; to?: string; include_test?: boolean; prize?: string; used?: '0' | '1'; q?: string }) =>
    api.get<Paginated<WheelLeadRow>>(`/wheel/campaigns/${id}/leads`, { params }).then((r) => r.data),

  // CSV (UTF-8 BOM) indirir — leads ile aynı filtreler. Blob olarak alıp indirir.
  leadsExport: async (id: number, params?: { from?: string; to?: string; prize?: string; used?: '0' | '1'; include_test?: boolean; q?: string }) => {
    const res = await api.get(`/wheel/campaigns/${id}/leads/export`, { params, responseType: 'blob' })
    const dispo = (res.headers['content-disposition'] as string) || ''
    const match = dispo.match(/filename="?([^"]+)"?/)
    const name = match?.[1] ?? `cark-katilimcilar-${id}.csv`
    const url = window.URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },

  stats: (id: number, params?: { from?: string; to?: string }) =>
    api.get<WheelStats>(`/wheel/campaigns/${id}/stats`, { params }).then((r) => r.data),

  // Test verilerini temizle (is_test lead/spin sil + Ticimax kuponlarını pasifleştir).
  purgeTest: (id: number) =>
    api.delete<{ deleted_spins: number; neutralized_coupons: number }>(`/wheel/campaigns/${id}/test-data`).then((r) => r.data),

  previewToken: (id: number) =>
    api.get<{ token: string; tenant: string | null; campaign: string }>(`/wheel/campaigns/${id}/preview-token`).then((r) => r.data),
}

// ── Sabitler / yardımcılar ──

export const PRIZE_TYPE_LABELS: Record<WheelPrizeType, string> = {
  discount_percent: 'Yüzde indirim (%)',
  discount_amount: 'Tutar indirim (TL)',
  free_shipping: 'Kargo bedava',
  gift: 'Hediye',
  custom: 'Özel metin',
  none: 'Kaybeden',
}

export const STATUS_LABELS: Record<WheelStatus, string> = {
  draft: 'Taslak',
  active: 'Yayında',
  paused: 'Duraklatıldı',
  ended: 'Bitti',
}

export const statusBadgeClass = (status: WheelStatus): string => {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-800'
    case 'paused':
      return 'bg-amber-100 text-amber-800'
    case 'ended':
      return 'bg-gray-200 text-gray-700'
    default:
      return 'bg-blue-100 text-blue-800'
  }
}

// Dilim için varsayılan renk paleti (yeni dilim eklerken döngüsel kullanılır)
export const SLICE_COLORS = [
  '#e11d48',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#06b6d4',
  '#ef4444',
]
