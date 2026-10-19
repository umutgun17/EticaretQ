import api from './api'

// Pazarlama e-posta gönderim kimliği (gönderici domaini + DNS) — gerçek backend.

export interface EmailSendingConfig {
  sending_domain: string | null
  from_address: string | null
  from_name: string | null
  selector: string | null
  ip: string | null
  enabled: boolean
  configured: boolean
}

export interface DnsRecord {
  purpose: string
  type: string
  host: string
  value: string
  ok?: boolean
}

export interface SenderInfo {
  sms_header: string | null
  email_from_address: string | null
  email_from_name: string | null
  sending_domain?: string | null
}

export const senderApi = {
  async get(): Promise<SenderInfo> {
    const { data } = await api.get('/marketing/sender')
    return data
  },
  async update(payload: Partial<SenderInfo>): Promise<SenderInfo> {
    const { data } = await api.put('/marketing/sender', payload)
    return data
  },
}

export const emailSendingApi = {
  async get(): Promise<{ config: EmailSendingConfig; records: DnsRecord[] }> {
    const { data } = await api.get('/marketing/email/sending')
    return data
  },
  async verify(): Promise<{ records: DnsRecord[]; verified: boolean }> {
    const { data } = await api.post('/marketing/email/sending/verify')
    return data
  },
  async toggle(enabled: boolean): Promise<{ email_enabled: boolean }> {
    const { data } = await api.post('/marketing/email/sending/toggle', { enabled })
    return data
  },
}
