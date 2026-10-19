import api from './api'

/**
 * Akıllı Arama paneli API client. Tüm uçlar auth + permission:marketing korumalı
 * (api instance token + X-Tenant-Id header'larını otomatik ekler).
 */

export interface SearchAnalytics {
  range: string
  range_days: number
  total_searches: number
  zero_result_searches: number
  zero_result_rate: number
  total_clicks: number
  ctr: number
  conversions: number
  attributed_revenue: number
  top_queries: { normalized_query: string; cnt: number; avg_results: number }[]
  top_zero_result_queries: { normalized_query: string; cnt: number }[]
  top_clicked_products: {
    id: number
    name: string
    url: string | null
    price: number | null
    image: string | null
    clicks: number
    sessions: number
    avg_position: number | null
    queries: string | null
  }[]
  // Sunucu-taraflı atıf (search:attribute-conversions): kim ne aratmış, ne almış
  attributed_orders: AttributedOrder[]
}

export interface AttributedOrder {
  order_no: string | null
  order_date: string
  total_amount: number
  customer_name: string | null
  items_count: number
  raw_query: string | null
  searched_at: string | null
  minutes_to_order: number | null
  product_name: string | null
  product_url: string | null
  product_image: string | null
}

export type SynonymType = 'synonym' | 'spelling' | 'redirect'
export type SynonymStatus = 'active' | 'suggested' | 'rejected'

export interface Synonym {
  id: number
  tenant_id: number
  term: string
  synonyms: string[]
  type: SynonymType
  source: 'manual' | 'auto'
  status: SynonymStatus
  hits: number
  meta?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

export interface SearchSettings {
  slug: string
  enabled: boolean
  domains: string
  base_url: string
  shop_url: string
  trigger: string
  input: string
  template: 'drawer' | 'fullscreen'
  require_stock: boolean
  require_variant_stock: boolean
  require_image: boolean
  badge_enabled: boolean
  theme: { font: string; accent: string; ink: string; ratio: string }
  placeholders: string
  material_terms: string
}

export interface SelectorCandidate {
  selector: string
  type: 'trigger' | 'input'
  html: string
}

export type SearchSettingsUpdate = Partial<Pick<SearchSettings,
  'enabled' | 'domains' | 'trigger' | 'input' | 'template' |
  'require_stock' | 'require_variant_stock' | 'require_image' | 'badge_enabled' | 'theme' | 'placeholders' | 'material_terms'>>

export const searchApi = {
  // range: 'today' | 'yesterday' | gün sayısı ('7'/'30'/'90')
  analytics: (range: string | number = '30') =>
    api.get<SearchAnalytics>('/search/analytics', { params: { range } }).then((r) => r.data),

  settings: () => api.get<SearchSettings>('/search/settings').then((r) => r.data),

  updateSettings: (data: SearchSettingsUpdate) =>
    api.put<SearchSettings & { ok: boolean }>('/search/settings', data).then((r) => r.data),

  detectSelectors: () =>
    api.get<{ candidates: SelectorCandidate[]; error?: string }>('/search/detect-selectors').then((r) => r.data),

  synonyms: () => api.get<Synonym[]>('/search/synonyms').then((r) => r.data),

  createSynonym: (data: { term: string; synonyms: string[]; type?: SynonymType; status?: SynonymStatus }) =>
    api.post<Synonym>('/search/synonyms', data).then((r) => r.data),

  updateSynonym: (id: number, data: Partial<Pick<Synonym, 'term' | 'synonyms' | 'type' | 'status'>>) =>
    api.put<Synonym>(`/search/synonyms/${id}`, data).then((r) => r.data),

  deleteSynonym: (id: number) => api.delete(`/search/synonyms/${id}`).then((r) => r.data),

  preview: (q: string) => api.get('/search/preview', { params: { q } }).then((r) => r.data),
}
