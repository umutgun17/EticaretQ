/**
 * Pazarlama Otomasyonu — Panel API client (PROTOTİP).
 *
 * ŞU AN: tüm fonksiyonlar mock veri döndürür (backend yok). Amaç UX/kurguyu
 * gözle görmek. Backend hazır olunca her fonksiyonun içi `api.get/post(...)`
 * ile değiştirilecek — sayfa kodu (imzalar) aynı kalır.
 */

// import api from './api' // ← backend bağlanınca açılacak

export type Channel = 'email' | 'sms' | 'whatsapp' | 'push'

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'E-posta',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  push: 'Web Push',
}

export const CHANNEL_COLORS: Record<Channel, string> = {
  email: 'bg-blue-100 text-blue-700',
  sms: 'bg-emerald-100 text-emerald-700',
  whatsapp: 'bg-green-100 text-green-700',
  push: 'bg-amber-100 text-amber-700',
}

export type AutomationCategory = 'revenue' | 'lifecycle' | 'engagement'

export const CATEGORY_LABELS: Record<AutomationCategory, string> = {
  revenue: 'Ciro Motoru',
  lifecycle: 'Yaşam Döngüsü',
  engagement: 'Etkileşim',
}

export type FlowStatus = 'active' | 'paused' | 'draft'

export const STATUS_LABELS: Record<FlowStatus, string> = {
  active: 'Aktif',
  paused: 'Duraklatıldı',
  draft: 'Taslak',
}

export const STATUS_BADGE: Record<FlowStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
}

// ── Akış adımı (flow / journey builder) ──
export type StepType = 'trigger' | 'wait' | 'send' | 'condition' | 'coupon' | 'goal'

export interface FlowStep {
  id: string
  type: StepType
  // trigger
  triggerLabel?: string
  // wait
  waitValue?: number
  waitUnit?: 'minute' | 'hour' | 'day'
  // send
  channel?: Channel
  templateId?: string
  templateName?: string
  respectQuietHours?: boolean
  // condition (dallanma)
  conditionLabel?: string // örn "E-postayı açmadı VE siparişi tamamlamadı"
  // coupon
  couponLabel?: string
  couponOnlyIfNotConverted?: boolean
  // goal
  goalLabel?: string
  // ── Rapor sayıları (bu adıma kaç kişi ulaştı / olumlu aksiyon aldı) ──
  reached?: number
  positive?: number // açtı / tıkladı / kullandı / "evet" dalına geçti
  positiveLabel?: string // "açtı" | "tıkladı" | "kullandı" | "sonraki senaryoya geçti"
}

// ── Kişi yolculuğu (takip / raporlama) ──
export type JourneyStatus = 'active' | 'converted' | 'exited' | 'waiting'

export const JOURNEY_STATUS_LABELS: Record<JourneyStatus, string> = {
  active: 'Akışta',
  converted: 'Dönüştü',
  exited: 'Çıktı',
  waiting: 'Bekliyor',
}

export const JOURNEY_STATUS_BADGE: Record<JourneyStatus, string> = {
  active: 'bg-blue-100 text-blue-700',
  converted: 'bg-emerald-100 text-emerald-700',
  exited: 'bg-gray-100 text-gray-600',
  waiting: 'bg-amber-100 text-amber-700',
}

export interface JourneyEvent {
  at: string
  label: string
  channel?: Channel
  result?: 'ok' | 'fail' | 'skip' | 'open' | 'click' | 'convert'
}

export interface Journey {
  id: number
  contact: string
  enteredAt: string
  currentStep: string
  status: JourneyStatus
  revenue: number
  events: JourneyEvent[]
}

export interface AutomationStat {
  enrolled: number
  sent: number
  opened: number
  converted: number
  revenue: number // TL
}

export interface Automation {
  key: string
  name: string
  description: string
  category: AutomationCategory
  status: FlowStatus
  channels: Channel[]
  trigger: string
  steps: FlowStep[]
  stat: AutomationStat
}

export interface SegmentRule {
  field: string
  op: string
  value: string
}

export interface Segment {
  id: number
  name: string
  description: string
  type: 'dynamic' | 'static'
  members: number
  rules: SegmentRule[]
  updatedAt: string
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent'

export interface Campaign {
  id: number
  name: string
  channel: Channel
  segmentName: string
  status: CampaignStatus
  scheduledAt: string | null
  audience: number
  sent: number
  opened: number
  clicked: number
  revenue: number
}

export type WaTemplateStatus = 'approved' | 'pending' | 'rejected' | null

export interface Template {
  id: string
  name: string
  channel: Channel
  subject: string | null
  body: string
  variables: string[]
  waStatus: WaTemplateStatus
  updatedAt: string
}

export type MessageStatus = 'sent' | 'delivered' | 'opened' | 'clicked' | 'converted' | 'failed'

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  sent: 'Gönderildi',
  delivered: 'İletildi',
  opened: 'Açıldı',
  clicked: 'Tıklandı',
  converted: 'Dönüştü',
  failed: 'Başarısız',
}

export const MESSAGE_STATUS_BADGE: Record<MessageStatus, string> = {
  sent: 'bg-gray-100 text-gray-600',
  delivered: 'bg-blue-100 text-blue-700',
  opened: 'bg-indigo-100 text-indigo-700',
  clicked: 'bg-violet-100 text-violet-700',
  converted: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
}

export interface MessageLog {
  id: number
  contact: string
  channel: Channel
  source: string // otomasyon/kampanya adı
  status: MessageStatus
  sentAt: string
  revenue: number
}

export interface MarketingSettings {
  channels: Record<Channel, boolean>
  senderSms: string
  senderEmail: string
  quietStart: string // "22:00"
  quietEnd: string // "09:00"
  sendWindowStart: string // yoğun saat penceresi
  sendWindowEnd: string
  frequencyCapPerDay: number
  frequencyCapPerWeek: number
  respectIys: boolean
  iysConnected: boolean
  // ── E-posta gönderim alan adı (kendi mail sunucumuzdan gönderim) ──
  sendingDomain: string // ör. pazarlama.firmadomain.com
  sendingDomainVerified: boolean
  dns: DnsRecord[]
}

export interface DnsRecord {
  type: 'TXT' | 'CNAME' | 'MX'
  host: string
  value: string
  purpose: string // SPF / DKIM / DMARC / Return-Path
  ok: boolean
}

// ──────────────────────────────────────────────────────────────────
// MOCK VERİ — gerçek rakamlar canlı veriden (terk sepet vb.) esinlenildi
// ──────────────────────────────────────────────────────────────────

const delay = <T>(data: T, ms = 250): Promise<T> =>
  new Promise((r) => setTimeout(() => r(data), ms))

const MOCK_AUTOMATIONS: Automation[] = [
  {
    key: 'cart_recovery',
    name: 'Sepet Kurtarma',
    description: 'Ödemesini tamamlamayan (terk edilmiş sepet) müşterileri kademeli olarak geri kazan.',
    category: 'revenue',
    status: 'active',
    channels: ['email', 'sms', 'whatsapp'],
    trigger: 'Sipariş oluştu ama ödeme tamamlanmadı (status=Alındı, ödeme=yok)',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Terk edilmiş sepet tespit edildi', reached: 2017 },
      { id: 's2', type: 'wait', waitValue: 1, waitUnit: 'hour', reached: 2017 },
      { id: 's3', type: 'send', channel: 'email', templateName: 'Sepetini unuttun mu?', respectQuietHours: true, reached: 2017, positive: 645, positiveLabel: 'açtı' },
      { id: 's4', type: 'condition', conditionLabel: 'E-postayı açmadı VE sipariş tamamlanmadı', reached: 1372, positive: 1372, positiveLabel: '2. senaryoya geçti' },
      { id: 's5', type: 'wait', waitValue: 10, waitUnit: 'hour', reached: 1372 },
      { id: 's6', type: 'send', channel: 'sms', templateName: 'Sepet hatırlatma (SMS)', respectQuietHours: true, reached: 1372, positive: 410, positiveLabel: 'tıkladı' },
      { id: 's7', type: 'condition', conditionLabel: 'Hâlâ sipariş tamamlanmadı', reached: 1100, positive: 1100, positiveLabel: '3. senaryoya geçti' },
      { id: 's8', type: 'wait', waitValue: 1, waitUnit: 'day', reached: 1100 },
      { id: 's9', type: 'coupon', couponLabel: '%10 indirim kuponu (Ticimax)', couponOnlyIfNotConverted: true, reached: 980, positive: 240, positiveLabel: 'kullandı' },
      { id: 's10', type: 'send', channel: 'whatsapp', templateName: 'Sepet + kupon (WhatsApp)', respectQuietHours: true, reached: 980, positive: 300, positiveLabel: 'tıkladı' },
      { id: 's11', type: 'goal', goalLabel: 'Sipariş tamamlandı → akış durur, ciro kurtarıldı sayılır', reached: 318 },
    ],
    stat: { enrolled: 2017, sent: 4180, opened: 1342, converted: 318, revenue: 214500 },
  },
  {
    key: 'stock_reminder',
    name: 'Stok Hatırlatma',
    description: 'Tükenen ürün için "haber ver" diyen müşteriye stok gelince bildir.',
    category: 'revenue',
    status: 'active',
    channels: ['email', 'push'],
    trigger: 'Abone olunan ürünün stoğu 0 → >0 oldu',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Ürün yeniden stokta' },
      { id: 's2', type: 'send', channel: 'email', templateName: 'Beklediğin ürün geldi', respectQuietHours: true },
      { id: 's3', type: 'send', channel: 'push', templateName: 'Stok bildirimi (push)', respectQuietHours: true },
      { id: 's4', type: 'goal', goalLabel: 'Ürün satın alındı' },
    ],
    stat: { enrolled: 540, sent: 612, opened: 410, converted: 96, revenue: 58200 },
  },
  {
    key: 'price_alarm',
    name: 'Fiyat Alarmı',
    description: 'Takip edilen ürünün fiyatı düşünce müşteriyi uyar.',
    category: 'revenue',
    status: 'draft',
    channels: ['email', 'push'],
    trigger: 'Takip edilen ürünün fiyatı düştü',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Fiyat düşüşü tespit edildi' },
      { id: 's2', type: 'send', channel: 'push', templateName: 'Fiyat düştü (push)', respectQuietHours: true },
      { id: 's3', type: 'send', channel: 'email', templateName: 'Takip ettiğin ürün indirimde', respectQuietHours: true },
      { id: 's4', type: 'goal', goalLabel: 'Ürün satın alındı' },
    ],
    stat: { enrolled: 0, sent: 0, opened: 0, converted: 0, revenue: 0 },
  },
  {
    key: 'wheel_coupon',
    name: 'Çark Kupon Takibi',
    description: 'Çarkta kazanılan kuponu anında ilet, kullanılmadıysa süre dolmadan hatırlat.',
    category: 'revenue',
    status: 'active',
    channels: ['sms', 'whatsapp'],
    trigger: 'Çark çevrildi ve kupon kazanıldı',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Çark kuponu kazanıldı' },
      { id: 's2', type: 'send', channel: 'sms', templateName: 'Kupon kodun (anında)', respectQuietHours: false },
      { id: 's3', type: 'condition', conditionLabel: 'Kupon kullanılmadı' },
      { id: 's4', type: 'wait', waitValue: 21, waitUnit: 'hour' },
      { id: 's5', type: 'send', channel: 'whatsapp', templateName: 'Kuponun bitmek üzere', respectQuietHours: true },
      { id: 's6', type: 'goal', goalLabel: 'Kupon kullanıldı (sipariş)' },
    ],
    stat: { enrolled: 1280, sent: 1890, opened: 980, converted: 240, revenue: 132000 },
  },
  {
    key: 'order_status',
    name: 'Sipariş Bilgilendirme',
    description: 'Sipariş alındı / hazırlanıyor / kargoda / teslim — her statüde, kanalı tenant seçer.',
    category: 'lifecycle',
    status: 'active',
    channels: ['sms', 'whatsapp', 'email'],
    trigger: 'Sipariş statüsü değişti',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Sipariş alındı' },
      { id: 's2', type: 'send', channel: 'sms', templateName: 'Siparişin alındı', respectQuietHours: false },
      { id: 's3', type: 'trigger', triggerLabel: 'Kargoya verildi' },
      { id: 's4', type: 'send', channel: 'whatsapp', templateName: 'Kargo takip', respectQuietHours: false },
      { id: 's5', type: 'goal', goalLabel: 'Teslim edildi' },
    ],
    stat: { enrolled: 21837, sent: 43200, opened: 31200, converted: 0, revenue: 0 },
  },
  {
    key: 'welcome',
    name: 'Yeni Üye Karşılama',
    description: 'Yeni kaydolan üyeye karşılama ve ilk alışveriş teşviki.',
    category: 'lifecycle',
    status: 'active',
    channels: ['email', 'sms'],
    trigger: 'Yeni üye kaydı',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Üye oluştu' },
      { id: 's2', type: 'send', channel: 'email', templateName: 'Aramıza hoş geldin', respectQuietHours: true },
      { id: 's3', type: 'condition', conditionLabel: '3 gün içinde sipariş vermedi' },
      { id: 's4', type: 'wait', waitValue: 3, waitUnit: 'day' },
      { id: 's5', type: 'coupon', couponLabel: 'İlk alışveriş %10', couponOnlyIfNotConverted: true },
      { id: 's6', type: 'send', channel: 'sms', templateName: 'İlk siparişine özel', respectQuietHours: true },
      { id: 's7', type: 'goal', goalLabel: 'İlk sipariş verildi' },
    ],
    stat: { enrolled: 3400, sent: 5100, opened: 2980, converted: 612, revenue: 287000 },
  },
  {
    key: 'birthday',
    name: 'Doğum Günü',
    description: 'Üyenin doğum gününde kutlama + hediye kupon.',
    category: 'engagement',
    status: 'active',
    channels: ['sms', 'email'],
    trigger: 'Üyenin doğum günü (bugün)',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Doğum günü' },
      { id: 's2', type: 'coupon', couponLabel: 'Doğum günü hediyesi %15' },
      { id: 's3', type: 'send', channel: 'sms', templateName: 'İyi ki doğdun', respectQuietHours: true },
      { id: 's4', type: 'goal', goalLabel: 'Kupon kullanıldı' },
    ],
    stat: { enrolled: 890, sent: 890, opened: 540, converted: 134, revenue: 76800 },
  },
  {
    key: 'order_anniversary',
    name: 'Sipariş Yıldönümü',
    description: 'İlk siparişin üzerinden 1 yıl geçen müşteriye "seni özledik".',
    category: 'engagement',
    status: 'paused',
    channels: ['email'],
    trigger: 'İlk sipariş tarihinden 1 yıl sonra',
    steps: [
      { id: 's1', type: 'trigger', triggerLabel: 'Sipariş yıldönümü' },
      { id: 's2', type: 'send', channel: 'email', templateName: 'Seni özledik', respectQuietHours: true },
      { id: 's3', type: 'goal', goalLabel: 'Geri döndü (sipariş)' },
    ],
    stat: { enrolled: 410, sent: 410, opened: 180, converted: 28, revenue: 19400 },
  },
]

const MOCK_SEGMENTS: Segment[] = [
  {
    id: 1,
    name: 'Uykuya dalanlar (win-back)',
    description: 'Son 30 gündür giriş yapmamış ama daha önce alışveriş yapmış üyeler.',
    type: 'dynamic',
    members: 1840,
    rules: [
      { field: 'Son giriş', op: 'şundan eski', value: '30 gün' },
      { field: 'Toplam sipariş', op: '>', value: '0' },
    ],
    updatedAt: '2026-06-29 08:00',
  },
  {
    id: 2,
    name: 'VIP müşteriler',
    description: 'Toplam harcaması 5.000 TL üzeri sadık müşteriler.',
    type: 'dynamic',
    members: 312,
    rules: [{ field: 'Toplam harcama', op: '>=', value: '5000 TL' }],
    updatedAt: '2026-06-29 08:00',
  },
  {
    id: 3,
    name: 'Tek siparişliler',
    description: 'Yalnızca 1 sipariş vermiş, ikinciye teşvik edilecek.',
    type: 'dynamic',
    members: 2670,
    rules: [{ field: 'Toplam sipariş', op: '=', value: '1' }],
    updatedAt: '2026-06-29 08:00',
  },
  {
    id: 4,
    name: 'İstanbul - kadın',
    description: 'İstanbul ilindeki kadın üyeler (kampanya hedefleme).',
    type: 'dynamic',
    members: 4120,
    rules: [
      { field: 'Şehir', op: '=', value: 'İstanbul' },
      { field: 'Cinsiyet', op: '=', value: 'Kadın' },
    ],
    updatedAt: '2026-06-28 19:30',
  },
  {
    id: 5,
    name: 'Yılbaşı kampanya listesi',
    description: 'Manuel yüklenmiş statik liste (CSV).',
    type: 'static',
    members: 980,
    rules: [],
    updatedAt: '2026-06-20 12:00',
  },
]

const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 1,
    name: 'Yaz İndirimi Duyurusu',
    channel: 'email',
    segmentName: 'İstanbul - kadın',
    status: 'sent',
    scheduledAt: '2026-06-25 11:00',
    audience: 4120,
    sent: 4090,
    opened: 1840,
    clicked: 420,
    revenue: 96300,
  },
  {
    id: 2,
    name: 'VIP özel ön satış',
    channel: 'sms',
    segmentName: 'VIP müşteriler',
    status: 'scheduled',
    scheduledAt: '2026-07-01 10:00',
    audience: 312,
    sent: 0,
    opened: 0,
    clicked: 0,
    revenue: 0,
  },
  {
    id: 3,
    name: 'İkinci siparişe %15',
    channel: 'whatsapp',
    segmentName: 'Tek siparişliler',
    status: 'draft',
    scheduledAt: null,
    audience: 2670,
    sent: 0,
    opened: 0,
    clicked: 0,
    revenue: 0,
  },
]

const MOCK_TEMPLATES: Template[] = [
  { id: 't1', name: 'Sepetini unuttun mu?', channel: 'email', subject: '{{ad}}, sepetin seni bekliyor 🛒', body: 'Merhaba {{ad}}, sepetinde {{urun_sayisi}} ürün kaldı. Tamamlamak için tıkla.', variables: ['ad', 'urun_sayisi', 'sepet_linki'], waStatus: null, updatedAt: '2026-06-28' },
  { id: 't2', name: 'Sepet hatırlatma (SMS)', channel: 'sms', subject: null, body: '{{ad}}, sepetindeki ürünler tükenmeden siparişini tamamla: {{kisa_link}}', variables: ['ad', 'kisa_link'], waStatus: null, updatedAt: '2026-06-28' },
  { id: 't3', name: 'Sepet + kupon (WhatsApp)', channel: 'whatsapp', subject: null, body: 'Merhaba {{ad}} 👋 Sepetine özel %10 indirim: {{kupon}}. Son gün bugün!', variables: ['ad', 'kupon'], waStatus: 'approved', updatedAt: '2026-06-27' },
  { id: 't4', name: 'Kargo takip', channel: 'whatsapp', subject: null, body: 'Siparişin kargoya verildi 🚚 Takip: {{kargo_link}}', variables: ['kargo_link'], waStatus: 'approved', updatedAt: '2026-06-20' },
  { id: 't5', name: 'Kuponun bitmek üzere', channel: 'whatsapp', subject: null, body: '{{ad}}, çark kuponun {{kupon}} bugün doluyor! Kaçırma.', variables: ['ad', 'kupon'], waStatus: 'pending', updatedAt: '2026-06-29' },
  { id: 't6', name: 'Beklediğin ürün geldi', channel: 'email', subject: '{{urun}} yeniden stokta!', body: 'Haber vermiştik: {{urun}} tekrar satışta. Stoklar sınırlı.', variables: ['urun', 'urun_linki'], waStatus: null, updatedAt: '2026-06-22' },
  { id: 't7', name: 'Aramıza hoş geldin', channel: 'email', subject: 'Hoş geldin {{ad}} 🎉', body: 'Aramıza katıldığın için teşekkürler! İlk siparişine özel sürprizimiz var.', variables: ['ad'], waStatus: null, updatedAt: '2026-06-15' },
  { id: 't8', name: 'İyi ki doğdun', channel: 'sms', subject: null, body: 'İyi ki doğdun {{ad}}! 🎂 Sana özel %15 hediye: {{kupon}}', variables: ['ad', 'kupon'], waStatus: null, updatedAt: '2026-06-10' },
]

const MOCK_MESSAGES: MessageLog[] = [
  { id: 1, contact: 'a***@gmail.com', channel: 'email', source: 'Sepet Kurtarma', status: 'converted', sentAt: '2026-06-29 13:40', revenue: 1290 },
  { id: 2, contact: '0532***4521', channel: 'sms', source: 'Çark Kupon Takibi', status: 'clicked', sentAt: '2026-06-29 13:10', revenue: 0 },
  { id: 3, contact: 'm***@hotmail.com', channel: 'email', source: 'Yeni Üye Karşılama', status: 'opened', sentAt: '2026-06-29 12:55', revenue: 0 },
  { id: 4, contact: '0541***1102', channel: 'whatsapp', source: 'Sepet Kurtarma', status: 'converted', sentAt: '2026-06-29 12:30', revenue: 2450 },
  { id: 5, contact: 'b***@gmail.com', channel: 'email', source: 'Stok Hatırlatma', status: 'delivered', sentAt: '2026-06-29 12:05', revenue: 0 },
  { id: 6, contact: '0505***8890', channel: 'sms', source: 'Sipariş Bilgilendirme', status: 'sent', sentAt: '2026-06-29 11:50', revenue: 0 },
  { id: 7, contact: 'c***@gmail.com', channel: 'push', source: 'Fiyat Alarmı', status: 'failed', sentAt: '2026-06-29 11:20', revenue: 0 },
  { id: 8, contact: '0533***2245', channel: 'whatsapp', source: 'Doğum Günü', status: 'converted', sentAt: '2026-06-29 10:40', revenue: 890 },
]

const MOCK_JOURNEYS: Record<string, Journey[]> = {
  cart_recovery: [
    {
      id: 1, contact: 'a***@gmail.com', enteredAt: '29.06 09:12', currentStep: 'Tamamlandı', status: 'converted', revenue: 1290,
      events: [
        { at: '09:12', label: 'Terk sepet (2 ürün, 1.290₺)', result: 'ok' },
        { at: '10:12', label: 'E-posta gönderildi', channel: 'email', result: 'ok' },
        { at: '10:40', label: 'E-posta açıldı', channel: 'email', result: 'open' },
        { at: '10:44', label: 'Linke tıkladı', channel: 'email', result: 'click' },
        { at: '10:51', label: 'Sipariş tamamlandı → akış durdu', result: 'convert' },
      ],
    },
    {
      id: 2, contact: '0532***4521', enteredAt: '29.06 08:05', currentStep: '2. senaryo: SMS bekliyor', status: 'active', revenue: 0,
      events: [
        { at: '08:05', label: 'Terk sepet (1 ürün, 540₺)', result: 'ok' },
        { at: '09:05', label: 'E-posta gönderildi', channel: 'email', result: 'ok' },
        { at: '—', label: 'E-posta açılmadı → 2. senaryo tetiklendi', result: 'fail' },
        { at: '19:05', label: 'SMS gönderimi sessiz saat penceresine ötelendi', channel: 'sms', result: 'skip' },
      ],
    },
    {
      id: 3, contact: 'm***@hotmail.com', enteredAt: '28.06 21:30', currentStep: '3. senaryo: kupon + WhatsApp', status: 'active', revenue: 0,
      events: [
        { at: '28.06 21:30', label: 'Terk sepet (3 ürün, 2.180₺)', result: 'ok' },
        { at: '28.06 22:30', label: 'E-posta gönderildi', channel: 'email', result: 'ok' },
        { at: '28.06 23:10', label: 'E-posta açıldı (sipariş yok)', channel: 'email', result: 'open' },
        { at: '29.06 09:10', label: 'SMS gönderildi', channel: 'sms', result: 'ok' },
        { at: '29.06 09:10', label: 'SMS linki tıklanmadı → 3. senaryo', result: 'fail' },
        { at: '29.06 10:00', label: '%10 kupon üretildi (KUPON10)', result: 'ok' },
        { at: '29.06 10:01', label: 'WhatsApp + kupon gönderildi', channel: 'whatsapp', result: 'ok' },
      ],
    },
    {
      id: 4, contact: '0541***1102', enteredAt: '27.06 14:00', currentStep: 'Kupon kullanılmadı → çıktı', status: 'exited', revenue: 0,
      events: [
        { at: '27.06 14:00', label: 'Terk sepet (1 ürün, 890₺)', result: 'ok' },
        { at: '27.06 15:00', label: 'E-posta gönderildi (açılmadı)', channel: 'email', result: 'fail' },
        { at: '28.06 01:00', label: 'SMS gönderildi (tıklanmadı)', channel: 'sms', result: 'fail' },
        { at: '28.06 10:00', label: 'WhatsApp + kupon gönderildi', channel: 'whatsapp', result: 'ok' },
        { at: '29.06 10:00', label: 'Kupon süresi doldu, kullanılmadı → akış kapandı', result: 'skip' },
      ],
    },
  ],
}

const MOCK_SETTINGS: MarketingSettings = {
  channels: { email: true, sms: true, whatsapp: true, push: false },
  senderSms: 'MARKA',
  senderEmail: 'pazarlama@ornek-firma.com',
  quietStart: '22:00',
  quietEnd: '09:00',
  sendWindowStart: '10:00',
  sendWindowEnd: '20:00',
  frequencyCapPerDay: 1,
  frequencyCapPerWeek: 3,
  respectIys: true,
  iysConnected: false,
  sendingDomain: 'pazarlama.ornek-firma.com',
  sendingDomainVerified: false,
  dns: [
    { type: 'TXT', host: 'pazarlama.ornek-firma.com', value: 'v=spf1 include:mail.yunbi.ai ~all', purpose: 'SPF', ok: true },
    { type: 'CNAME', host: 'yunbi1._domainkey.pazarlama.ornek-firma.com', value: 'yunbi1.dkim.yunbi.ai', purpose: 'DKIM', ok: true },
    { type: 'CNAME', host: 'yunbi2._domainkey.pazarlama.ornek-firma.com', value: 'yunbi2.dkim.yunbi.ai', purpose: 'DKIM', ok: false },
    { type: 'CNAME', host: 'bounce.pazarlama.ornek-firma.com', value: 'bounce.yunbi.ai', purpose: 'Return-Path (bounce)', ok: false },
    { type: 'TXT', host: '_dmarc.pazarlama.ornek-firma.com', value: 'v=DMARC1; p=none; rua=mailto:dmarc@yunbi.ai', purpose: 'DMARC', ok: true },
  ],
}

export const marketingApi = {
  listAutomations: () => delay(MOCK_AUTOMATIONS),
  getAutomation: (key: string) =>
    delay(MOCK_AUTOMATIONS.find((a) => a.key === key) ?? null),
  listSegments: () => delay(MOCK_SEGMENTS),
  listCampaigns: () => delay(MOCK_CAMPAIGNS),
  listTemplates: () => delay(MOCK_TEMPLATES),
  listMessages: () => delay(MOCK_MESSAGES),
  getSettings: () => delay(MOCK_SETTINGS),
  getJourneys: (key: string) => delay(MOCK_JOURNEYS[key] ?? []),
}

export function fmtMoney(v: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v) + ' ₺'
}

export function fmtNum(v: number): string {
  return new Intl.NumberFormat('tr-TR').format(v)
}

export function waitText(step: FlowStep): string {
  const u = step.waitUnit === 'minute' ? 'dakika' : step.waitUnit === 'hour' ? 'saat' : 'gün'
  return `${step.waitValue} ${u} bekle`
}
