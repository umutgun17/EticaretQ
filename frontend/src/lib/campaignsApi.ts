import api from './api'

// Toplu WhatsApp kampanyaları — listeler + kampanyalar + 24s kapasite + WABA şablonları.

export interface WaCapacity {
  limit: number
  reserve: number
  used_24h: number
  remaining: number
}

export interface CampaignSettings {
  wa_daily_unique_limit: number
  wa_reserve_for_automations: number
  email_daily_limit: number
}

export interface SegmentOption {
  id: number
  name: string
  total: number
  with_phone: number
  with_email: number
}

export interface EmailChannelInfo {
  enabled: boolean
  from: string | null
  daily_limit: number
  sent_today: number
}

export interface WaQuality {
  quality_rating?: string
  messaging_limit_tier?: string
  throughput?: { level?: string }
  display_phone_number?: string
}

export interface QualityTransition {
  at: string
  from: string | null
  to: string
  source: string
}

export interface QualityState {
  rating: string | null
  checked_at: string | null
  history: QualityTransition[]
  pause_reason: string
}

export interface TemplateParamSpec {
  source: 'name' | 'coupon' | 'static'
  value?: string | null
}

export interface CampaignStats {
  total: number
  pending: number
  sent: number
  skipped: number
  failed: number
  delivered: number
  read: number
  clicked: number
  converted: number
  coupon_used: number
  blacklisted: number
  revenue: number
  coupon_orders_total: number
}

export type CampaignStatus = 'draft' | 'sending' | 'paused' | 'completed' | 'cancelled'

export interface Campaign {
  id: number
  name: string
  channel: 'whatsapp' | 'email'
  segment_id: number | null
  segment_name: string | null
  subject: string | null
  body_html: string | null
  status: CampaignStatus
  progress_pct: number
  eta_at: string | null
  paused_reason: string | null
  auto_paused_quality?: boolean
  list_id: number | null
  list_name: string | null
  list_count: number
  template_name: string | null
  template_lang: string
  template_params: TemplateParamSpec[]
  url_button: { enabled?: boolean; target_url?: string | null }
  coupon_code: string | null
  send_window_hours: number
  cooldown_days: number
  attribution_days: number
  recipients_total: number
  started_at: string | null
  completed_at: string | null
  created_at: string | null
  stats: CampaignStats
}

export interface MarketingListRow {
  id: number
  name: string
  description: string | null
  contacts_count: number
  created_at: string
}

export interface ImportResult {
  added: number
  duplicate: number
  invalid: number
  invalid_samples: string[]
}

export interface ContactRow {
  id: number
  phone: string
  name: string | null
  customer_id: number | null
}

export interface RecipientRow {
  id: number
  phone: string | null
  email: string | null
  name: string | null
  status: 'pending' | 'sent' | 'skipped' | 'failed'
  skip_reason: string | null
  error: string | null
  sent_at: string | null
  converted_at: string | null
  revenue: number
  coupon_used: boolean
  message?: {
    id: number
    delivered_at: string | null
    opened_at: string | null
    clicked_at: string | null
    error: string | null
    skip_reason: string | null
  } | null
}

export interface WaTemplate {
  name: string
  status: string
  category: string
  language: string
  components?: Array<{
    type: string
    text?: string
    buttons?: Array<{ type: string; text?: string; url?: string }>
  }>
}

export interface CampaignPayloadInput {
  name?: string
  channel?: 'whatsapp' | 'email'
  list_id?: number | null
  segment_id?: number | null
  subject?: string
  body_html?: string
  template_name?: string
  template_lang?: string
  template_params?: TemplateParamSpec[]
  url_button?: { enabled: boolean; target_url?: string | null }
  coupon_code?: string | null
  send_window_hours?: number
  cooldown_days?: number
  attribution_days?: number
  action?: 'start' | 'pause' | 'resume' | 'cancel'
}

export interface BlacklistRow {
  id: number
  channel: string
  identifier: string
  reason: string | null
  source: string | null
  created_at: string
}

export interface LimitSync {
  tier: string | null
  synced_at: string | null
}

interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  total: number
}

export const campaignsApi = {
  index: () =>
    api.get<{ campaigns: Campaign[]; segments: SegmentOption[]; email: EmailChannelInfo; capacity: WaCapacity; settings: CampaignSettings; quality: WaQuality; quality_state: QualityState; limit_sync: LimitSync }>(
      '/marketing/campaigns',
    ).then(r => r.data),
  testEmail: (id: number, to: string) =>
    api.post<{ ok: boolean }>(`/marketing/campaigns/${id}/test-email`, { to }).then(r => r.data),
  updateSettings: (patch: Partial<CampaignSettings>) =>
    api.put<{ capacity: WaCapacity; settings: CampaignSettings }>('/marketing/campaign-settings', patch).then(r => r.data),
  create: (payload: CampaignPayloadInput) =>
    api.post<{ campaign: Campaign }>('/marketing/campaigns', payload).then(r => r.data),
  show: (id: number, params?: { status?: string; q?: string; page?: number; per_page?: number }) =>
    api.get<{ campaign: Campaign; recipients: Paginated<RecipientRow> }>(`/marketing/campaigns/${id}`, { params }).then(r => r.data),
  update: (id: number, payload: CampaignPayloadInput) =>
    api.put<{ campaign: Campaign }>(`/marketing/campaigns/${id}`, payload).then(r => r.data),
  destroy: (id: number) => api.delete(`/marketing/campaigns/${id}`).then(r => r.data),

  templates: (fresh = false) =>
    api.get<{ success: boolean; data: WaTemplate[] }>('/marketing/wa-templates', { params: fresh ? { fresh: 1 } : {} }).then(r => r.data),
  createTemplate: (payload: { name: string; body_text: string; example_params?: string[]; footer_text?: string; button_text?: string; optout_button?: boolean }) =>
    api.post('/marketing/wa-templates', payload).then(r => r.data),

  blacklist: (params?: { q?: string; page?: number }) =>
    api.get<{ blacklist: Paginated<BlacklistRow> }>('/marketing/blacklist', { params }).then(r => r.data),
  addBlacklist: (numbers_text: string) =>
    api.post<{ added: number; invalid: number }>('/marketing/blacklist', { numbers_text }).then(r => r.data),
  removeBlacklist: (id: number) => api.delete(`/marketing/blacklist/${id}`).then(r => r.data),

  lists: () => api.get<{ lists: MarketingListRow[] }>('/marketing/lists').then(r => r.data),
  createList: (payload: { name: string; description?: string; contacts_text?: string }) =>
    api.post<{ list: MarketingListRow; import: ImportResult }>('/marketing/lists', payload).then(r => r.data),
  showList: (id: number, page = 1) =>
    api.get<{ list: MarketingListRow; contacts: Paginated<ContactRow> }>(`/marketing/lists/${id}`, { params: { page } }).then(r => r.data),
  addContacts: (id: number, contacts_text: string) =>
    api.post<{ list: MarketingListRow; import: ImportResult }>(`/marketing/lists/${id}/contacts`, { contacts_text }).then(r => r.data),
  fillFromCustomers: (id: number, payload: { min_total_spent?: number; last_order_days?: number; limit?: number }) =>
    api.post<{ list: MarketingListRow; import: ImportResult }>(`/marketing/lists/${id}/fill-from-customers`, payload).then(r => r.data),
  deleteList: (id: number) => api.delete(`/marketing/lists/${id}`).then(r => r.data),
}
