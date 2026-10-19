/** İYS Aktarım paneli — API client. */
import api from './api'

export interface IysSettings {
  enabled: boolean
  daily_target: number
  window_start: string
  window_end: string
  brand_code: string
  recipient_type: 'BIREYSEL' | 'TACIR'
  source: string
}

export interface IysTypeResult {
  ok: boolean
  code?: string | null
  at?: string
}

export interface IysRecentRow {
  id: number
  name: string | null
  phone: string | null
  email: string | null
  first_order_at: string | null
  first_order_no: string | null
  order_source: string | null
  status: 'pending' | 'sent' | 'partial' | 'failed'
  types_result: Record<string, IysTypeResult> | null
  attempts: number
  last_attempt_at: string | null
  last_error: string | null
}

export interface IysOverview {
  settings: IysSettings
  config: { ready: boolean; missing: string[] }
  stock: {
    total: number
    pending: number
    sent: number
    partial: number
    failed: number
    remaining: number
    seeded: boolean
  }
  today: { date: string; quota: number; attempted: number; sent: number }
  series: Array<{ d: string; attempted: number; sent: number }>
  eta_days: number | null
  recent: IysRecentRow[]
}

export const iysApi = {
  overview: () => api.get<IysOverview>('/iys/overview').then(r => r.data),
  updateSettings: (s: Partial<IysSettings>) =>
    api.put<{ settings: IysSettings }>('/iys/settings', s).then(r => r.data),
  seed: () => api.post<{ added: number; total: number }>('/iys/seed').then(r => r.data),
  test: (payload: { phone?: string; email?: string }) =>
    api.post<{ results: Record<string, { ok: boolean; code?: string; error?: string }> }>('/iys/test', payload).then(r => r.data),
}
