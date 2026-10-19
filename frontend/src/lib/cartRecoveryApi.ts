import api from './api'

// Sepet kurtarma otomasyonu — gerçek backend (ayarlar + istatistik).

export interface CartRecoverySettings {
  enabled: boolean
  coupon_amount: number
  coupon_min_basket: number
  coupon_valid_hours: number
  coupon_mode: 'percent' | 'fixed'
  coupon_percent: number
  coupon_round: number
  process_limit: number
  channels: { email: boolean; sms: boolean; whatsapp: boolean }
  delay_email: number
  delay_sms: number
  delay_whatsapp: number
  shop_url: string | null
  cart_url: string | null
  sms_template: string
  whatsapp_template: string
}

export interface ChannelStat {
  sent: number; opened: number; clicked: number; failed: number; skipped: number
  conversions: number; revenue: number
}

export interface CartDeliveryRow {
  id: number
  at: string | null
  channel: 'email' | 'sms' | 'whatsapp'
  recipient: string
  customer_name: string | null
  order_no: string | null
  coupon_code: string | null
  cart_total: number | null
  step: number | null
  status: string
  skip_reason: string | null
  error: string | null
  revenue: number | null
  converted: boolean
  is_test: boolean
}

export interface CartRecoveryStats {
  journeys: { total: number; active: number; converted: number; exhausted: number; stopped: number }
  revenue_total: number
  revenue_by_coupon: number
  coupons_issued: number
  coupons_used: number
  channels: Record<'email' | 'sms' | 'whatsapp', ChannelStat>
}

export interface MarketingFunnel {
  sent: number; opened: number; clicked: number; converted: number; failed: number; skipped: number; revenue: number
}
export interface MarketingMessageRow {
  id: number; channel: 'email' | 'sms' | 'whatsapp' | 'push'; contact: string
  name: string | null; is_test: boolean; subject: string | null
  order_no: string | null; coupon_code: string | null; stage: string | null
  source: string | null; status: string; reason: string | null
  opened: boolean; clicked: boolean; converted: boolean
  coupon_used: boolean | null // true = kuponla aldı, false = kuponsuz aldı, null = bilinmiyor/dönüşmedi
  revenue: number; at: string | null
}
export interface AnalyticsFilters {
  channel?: 'all' | 'email' | 'sms' | 'whatsapp' | 'push'
  status?: 'all' | 'sent' | 'failed' | 'skipped' | 'queued' | 'converted'
  days?: number // 0 = tümü
  source?: string // otomasyon kaynağı ('all' = hepsi)
  q?: string // isim / numara / e-posta / sipariş no / kupon kodu araması
  date_from?: string // YYYY-MM-DD (TR günü) — doluysa days yerine geçer
  date_to?: string
  recipient?: string // alıcı geçmişi: telefon (son 10 hane eşleşir) veya e-posta
}

export interface MarketingMessageDetail {
  id: number; channel: 'email' | 'sms' | 'whatsapp' | 'push'; contact: string
  name: string | null; source: string | null; is_test: boolean
  status: string; skip_reason: string | null; error: string | null
  subject: string | null; body: string | null
  order_no: string | null; stage: string | null; step: number | null
  coupon_code: string | null; cart_total: number | null
  cargo_company: string | null; cargo_tracking_no: string | null
  created_at: string | null; sent_at: string | null; opened_at: string | null
  clicked_at: string | null; converted_at: string | null
  coupon_used: boolean | null
  revenue: number; provider: string | null; provider_message_id: string | null; cost: number | null
}

export const marketingAnalyticsApi = {
  async get(f: AnalyticsFilters = {}): Promise<{ funnel: MarketingFunnel; messages: MarketingMessageRow[]; total: number; shown: number; sources: string[]; source_labels?: Record<string, string> }> {
    const { data } = await api.get('/marketing/analytics', { params: f })
    return data
  },
  async detail(id: number): Promise<MarketingMessageDetail> {
    const { data } = await api.get(`/marketing/messages/${id}`)
    return data
  },
}

export interface DeliveryRow {
  id: number; contact: string; message: string; status: string; is_test: boolean
  error: string | null; revenue: number; converted: boolean; at: string | null
}
export interface WheelReminder {
  settings: { enabled: boolean; whatsapp_enabled: boolean; hours_before: number; sms_template: string; opt_out_url: string; shop_url: string }
  stats: { reminded: number; redeemed: number; sms_sent: number; conversions: number; revenue: number }
  deliveries: DeliveryRow[]
}

export const wheelReminderApi = {
  async get(): Promise<WheelReminder> {
    const { data } = await api.get('/marketing/wheel-reminder')
    return data
  },
  async update(patch: { enabled?: boolean; whatsapp_enabled?: boolean; hours_before?: number; sms_template?: string; opt_out_url?: string }): Promise<WheelReminder> {
    const { data } = await api.put('/marketing/wheel-reminder', patch)
    return data
  },
}

export interface OverviewModule {
  key: string; name: string; enabled: boolean
  sent: number; conversions: number; revenue: number
}
export interface MarketingOverview {
  modules: OverviewModule[]
  totals: { sent: number; conversions: number; revenue: number }
}

export const marketingOverviewApi = {
  async get(): Promise<MarketingOverview> {
    const { data } = await api.get('/marketing/overview')
    return data
  },
}

export interface MarketingPrefs {
  window: { enabled: boolean; start: string; end: string }
  frequency: { enabled: boolean; per_day: number; per_week: number }
}

export const marketingPrefsApi = {
  async get(): Promise<MarketingPrefs> {
    const { data } = await api.get('/marketing/preferences')
    return data
  },
  async update(p: MarketingPrefs): Promise<MarketingPrefs> {
    const { data } = await api.put('/marketing/preferences', p)
    return data
  },
}

export const cartRecoveryApi = {
  async get(): Promise<{ settings: CartRecoverySettings; stats: CartRecoveryStats; deliveries: CartDeliveryRow[] }> {
    const { data } = await api.get('/marketing/cart-recovery')
    return data
  },
  async update(patch: Partial<Record<string, unknown>>): Promise<{ settings: CartRecoverySettings }> {
    const { data } = await api.put('/marketing/cart-recovery', patch)
    return data
  },
}
