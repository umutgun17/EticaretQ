/** Pazarlama segmentasyonu — API client. */
import api from './api'

export interface SegmentDefinition {
  membership?: 'any' | 'member' | 'guest'
  has_phone?: boolean
  has_email?: boolean
  min_orders?: number
  max_orders?: number
  min_total?: number
  max_total?: number
  min_max_order?: number
  last_order_older_days?: number
  last_order_within_days?: number
  first_order_within_days?: number
  sources?: string[]
}

export interface SegmentCounts {
  total: number
  with_phone: number
  with_email: number
}

export interface Segment {
  id: number
  name: string
  description: string | null
  definition: SegmentDefinition
  is_system: boolean
  sort: number
  counts: SegmentCounts
}

export interface SegmentsOverview {
  profiles: { total: number; with_phone: number; with_email: number; refreshed_at: string | null }
  segments: Segment[]
  export_fields: Record<string, string>
}

export interface SegmentPreview extends SegmentCounts {
  definition: SegmentDefinition
  sample: Array<{
    name: string | null
    phone: string | null
    email: string | null
    is_member: boolean
    orders_count: number
    total_spent: string
    last_order_at: string | null
  }>
}

export const segmentApi = {
  list: () => api.get<SegmentsOverview>('/segments').then(r => r.data),
  create: (p: { name: string; description?: string; definition: SegmentDefinition }) =>
    api.post<{ segment: Segment }>('/segments', p).then(r => r.data),
  update: (id: number, p: { name: string; description?: string; definition: SegmentDefinition }) =>
    api.put<{ segment: Segment }>(`/segments/${id}`, p).then(r => r.data),
  remove: (id: number) => api.delete(`/segments/${id}`).then(r => r.data),
  preview: (definition: SegmentDefinition) =>
    api.post<SegmentPreview>('/segments/preview', { definition }).then(r => r.data),
  refresh: () => api.post<{ profiles: number }>('/segments/refresh').then(r => r.data),
  export: async (id: number, fields: string[], require?: 'phone' | 'email') => {
    const res = await api.get(`/segments/${id}/export`, {
      params: { fields: fields.join(','), ...(require ? { require } : {}) },
      responseType: 'blob',
    })
    const cd = (res.headers['content-disposition'] as string | undefined) ?? ''
    const m = cd.match(/filename="?([^";]+)"?/)
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = m?.[1] ?? 'segment.csv'
    a.click()
    URL.revokeObjectURL(url)
  },
}
