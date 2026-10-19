import api from './api'

export interface PushPrompt {
  title: string; body: string; allow: string; deny: string
  color: string; position: string; delay: number; snooze_days: number
}
export interface MarketingChannels {
  email: { enabled: boolean; from_name: string | null; from_address: string | null; sending_domain: string | null; dkim_ready: boolean }
  sms: { enabled: boolean; header: string | null; connected: boolean }
  whatsapp: { enabled: boolean; configured: boolean }
  push: {
    enabled: boolean; domains: string; prompt: PushPrompt
    embed_script: string; sw_file: string; sw_content: string
  }
}

export const marketingChannelsApi = {
  async get(): Promise<MarketingChannels> {
    const { data } = await api.get('/marketing/channels')
    return data
  },
  async update(patch: Record<string, unknown>): Promise<MarketingChannels> {
    const { data } = await api.put('/marketing/channels', patch)
    return data
  },
}
