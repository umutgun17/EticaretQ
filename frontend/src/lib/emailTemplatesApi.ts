import api from './api'

// Pazarlama e-posta şablonları — gerçek backend API'si (GrapesJS editör).

export interface EmailTemplate {
  id: number
  key: string
  name: string
  category: string
  subject: string
  preheader?: string | null
  html?: string | null
  design?: Record<string, unknown> | null
  is_active: boolean
  is_system: boolean
  variables?: string[] | null
  updated_at?: string
}

export type EmailTemplateListItem = Omit<EmailTemplate, 'html' | 'design'>

export interface EmailTemplatePayload {
  key?: string
  name: string
  category?: string
  subject: string
  preheader?: string | null
  html?: string | null
  design?: Record<string, unknown> | null
  variables?: string[] | null
  is_active?: boolean
}

export const CATEGORY_LABELS: Record<string, string> = {
  cart_recovery: 'Sepet Kurtarma',
  membership: 'Üyelik',
  transactional: 'İşlemsel',
  lifecycle: 'Yaşam Döngüsü',
  product: 'Ürün',
  general: 'Genel',
}

export const emailTemplatesApi = {
  async list(): Promise<EmailTemplateListItem[]> {
    const { data } = await api.get('/marketing/email-templates')
    return data.templates
  },
  async get(id: number): Promise<EmailTemplate> {
    const { data } = await api.get(`/marketing/email-templates/${id}`)
    return data.template
  },
  async create(payload: EmailTemplatePayload): Promise<EmailTemplate> {
    const { data } = await api.post('/marketing/email-templates', payload)
    return data.template
  },
  async update(id: number, payload: EmailTemplatePayload): Promise<EmailTemplate> {
    const { data } = await api.put(`/marketing/email-templates/${id}`, payload)
    return data.template
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/marketing/email-templates/${id}`)
  },
  async preview(id: number, vars?: Record<string, string>): Promise<{ subject: string; html: string; preheader: string | null }> {
    const { data } = await api.post(`/marketing/email-templates/${id}/preview`, { vars: vars ?? {} })
    return data.preview
  },
}
