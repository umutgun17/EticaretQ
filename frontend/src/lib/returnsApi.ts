import axios from 'axios'

/**
 * Public (müşteri) iade akışı için ayrı axios instance.
 * Auth header / tenant header EKLEMEZ — bu uçlar herkese açıktır ve
 * kimlik order_no + email/telefon doğrulaması ve şifreli token ile sağlanır.
 *
 * baseURL '/' → çağrılar `/r/{slug}/returns/...` köküne gider (api prefix değil).
 */
const returnsApi = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

export interface ReturnOrderItem {
  line_id: string
  name: string | null
  sku: string | null
  variant_info: string | null
  image_url: string | null
  qty: number
  unit_price: number
  status_label: string | null
}

export interface ReturnOrderView {
  order_no: string | null
  status_label: string | null
  order_date: string | null
  currency: string
  customer_name: string | null
  total_amount: number
  paid_amount: number
  cargo_company: string | null
  items: ReturnOrderItem[]
}

export interface ReturnEligibility {
  can_return: boolean
  can_cancel: boolean
  can_defect: boolean
  in_transit?: boolean
  return_window_days: number
  deadline: string | null
  reasons: string[]
}

export type RefundMethodValue = 'original' | 'store_credit' | 'bank_transfer' | 'none'

export interface RefundMethodOption {
  value: RefundMethodValue
  label: string
  promoted: boolean
  note: string
  /** Havale ile iade: müşteriden banka / ad soyad / IBAN alınır (kapıda ödeme siparişleri). */
  needs_bank_account?: boolean
}

/** Müşterinin havale ile iade için paylaştığı hesap bilgisi. */
export interface BankAccountInput {
  bank_name: string
  account_holder: string
  iban: string
}

export interface LookupResponse {
  token: string
  order: ReturnOrderView
  eligibility: ReturnEligibility
  refund_methods: RefundMethodOption[]
  /**
   * Siparişin ödeme yapısı. cod=true → kapıda ödeme: İPTAL'de ödeme adımı hiç gösterilmez
   * (tahsilat yapılmadığı için iade yoktur), İADE'de tek yöntem havaledir.
   */
  payment?: { cod: boolean; cod_fee: number }
  rules: {
    return_window_days: number
    refund_shipping: boolean
    require_condition_declaration: boolean
    promote_store_credit: boolean
  }
  /** Tenant'ın iade kargo firması (surat-kargo | dhl-kargo) — ekran metin/logosu buna göre. */
  cargo?: { provider: string; name: string }
}

export interface RefundLine {
  line_id: string
  name: string | null
  sku: string | null
  qty_returned: number
  unit_price: number
  effective_unit_price: number
  discount_share: number
  refundable: number
  /** Sepet kademesi düzeltmesinden bu satıra düşen pay */
  campaign_deduction?: number
  /** Kalem açıklaması (birim, KDV dahil): liste → ürün indirimi → 1+1 → sepet kademesi → ödenen → kupon */
  explain?: RefundLineExplain
}

export interface RefundLineExplain {
  list_unit: number
  product_discount_unit: number
  campaign_unit: number
  tier_unit: number
  paid_unit: number
  coupon_unit: number
  campaign_names: string[]
  has_tier: boolean
  /** Bu kalemde gerçekte uygulanmış sepet indirimi oranı (%) */
  tier_rate?: number
}

export interface TierCheck {
  status: 'recovered' | 'kept' | 'unenforced' | 'full_return'
  basket_before: number
  basket_after: number
  rate: number
  threshold: number
  top_threshold: number
  names: string[]
}

export interface TierRecovery {
  amount: number
  basket_before: number
  basket_after: number
  threshold: number
  /** Kalan ürünlerin eski / yeni sepet indirimi oranı (%) — yeni 0 ise indirim tamamen kalkar */
  old_rate?: number
  new_rate?: number
  lost: { name: string; pct: number; min: number }[]
  message: string
}

export interface RefundCalculation {
  currency: string
  lines: RefundLine[]
  items_refundable: number
  shipping_refundable: number
  total_refundable: number
  cap: number | null
  capped: boolean
  warnings: string[]
  breakdown?: {
    /** Sepet kampanyası telafisi: iade tutarından düşülen, geri alınan kampanya indirimi (0 = yok). */
    campaign_recovery?: number
    /** İndirimi geri alınan (sepette kalan) ürünün adı. */
    campaign_revoked_from?: string | null
    /** Sepet kademesi geri alımı (iade sonrası kalan sepet eşiğin altına düştüyse) */
    tier_recovery?: TierRecovery | null
    tier_check?: TierCheck | null
  }
}

export default returnsApi
