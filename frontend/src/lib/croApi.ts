import api from '@/lib/api'

/* CRO ürünü API sözleşmesi — backend CroController ile birebir */

export interface CroFunnel { sessions: number; views: number; add_to_carts: number; checkouts: number; purchases: number; revenue: number }
export interface CroRates { cr: number; atc_rate: number; atc_to_checkout: number; checkout_to_purchase: number; aov: number; rps: number }
export interface CroDevice { device: string; sessions: number; users: number; purchases: number; revenue: number; engagement_rate: number; conversion_rate: number }
export interface CroLanding { landing_page: string; sessions: number; users: number; new_users: number; purchases: number; revenue: number; engagement_rate: number; bounce_rate: number; conversion_rate: number; opportunity: boolean; potential_orders: number }
export interface CroTool { key: string; label: string; enabled: boolean; url: string; metric: Record<string, number> | null }
export interface CroActionLite { id: number; title: string; status: string; impact: number; confidence: number; ease: number; feature_url: string | null; expected_uplift: string | null; ice?: number }
export interface CroAuditSummary { run_id: string; at: string; avg_score: number; pages: { page_type: string; score: number; url: string }[] }

export interface CroOverview {
  period: { start: string; end: string; prev_start: string; prev_end: string; days: number }
  ga4_configured: boolean
  funnel: CroFunnel | null
  funnel_prev: CroFunnel | null
  rates: CroRates | null
  rates_prev: CroRates | null
  devices: CroDevice[]
  landing_pages: CroLanding[]
  tools: CroTool[]
  actions: { counts: Record<string, number>; top: CroActionLite[] }
  audit: CroAuditSummary | null
}

export type CroStatus = 'idea' | 'planned' | 'running' | 'done' | 'discarded'
export type CroCategory = 'pdp' | 'category' | 'cart' | 'checkout' | 'trust' | 'speed' | 'mobile' | 'search' | 'personalization' | 'retention' | 'other'

export interface CroAction {
  id: number
  key: string | null
  title: string
  category: CroCategory
  surface: string | null
  hypothesis: string | null
  description: string | null
  status: CroStatus
  impact: number
  confidence: number
  ease: number
  expected_uplift: string | null
  feature: string | null
  feature_url: string | null
  started_at: string | null
  finished_at: string | null
  result: string | null
  result_uplift: number | null
  ice: number
  created_at: string
}

export interface CroCheck { key: string; label: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string; advice: string | null; weight: number; group: string }
export interface CroAuditPage { id: number; run_id: string; page_type: string; url: string; http_status: number; ttfb_ms: number; total_ms: number; html_bytes: number; score: number; checks: CroCheck[]; meta: Record<string, unknown> | null; created_at: string }
export interface CroAuditHistory { run_id: string; at: string; avg_score: number; pages: number }

export const STATUS_LABELS: Record<CroStatus, string> = { idea: 'Fikir', planned: 'Planlı', running: 'Yayında', done: 'Tamamlandı', discarded: 'Vazgeçildi' }
export const STATUS_CLASSES: Record<CroStatus, string> = {
  idea: 'bg-gray-100 text-gray-600',
  planned: 'bg-sky-100 text-sky-700',
  running: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  discarded: 'bg-rose-100 text-rose-600',
}
export const CATEGORY_LABELS: Record<CroCategory, string> = {
  pdp: 'Ürün sayfası', category: 'Kategori', cart: 'Sepet', checkout: 'Ödeme', trust: 'Güven', speed: 'Hız',
  mobile: 'Mobil', search: 'Arama', personalization: 'Kişiselleştirme', retention: 'Geri kazanım', other: 'Diğer',
}
export const PAGE_TYPE_LABELS: Record<string, string> = { home: 'Ana sayfa', category: 'Kategori', product: 'Ürün sayfası', cart: 'Sepet / Ödeme', other: 'Diğer' }

export const croApi = {
  overview: async (period: string) => (await api.get<CroOverview>('/cro/overview', { params: { period } })).data,
  actions: async () => (await api.get<{ data: CroAction[]; catalog_size: number }>('/cro/actions')).data,
  createAction: async (payload: Partial<CroAction>) => (await api.post<{ data: CroAction }>('/cro/actions', payload)).data.data,
  updateAction: async (id: number, payload: Partial<CroAction>) => (await api.put<{ data: CroAction }>(`/cro/actions/${id}`, payload)).data.data,
  deleteAction: async (id: number) => (await api.delete(`/cro/actions/${id}`)).data,
  seedActions: async () => (await api.post<{ added: number }>('/cro/actions/seed')).data,
  audits: async () => (await api.get<{ run: { run_id: string; at: string } | null; pages: CroAuditPage[]; history: CroAuditHistory[] }>('/cro/audits')).data,
  runAudit: async () => (await api.post('/cro/audits/run')).data,
}

export const fmtNum = (n: number, locale = 'tr-TR') => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 10_000 ? (n / 1_000).toFixed(1) + 'K' : n.toLocaleString(locale)
export const fmtTl = (n: number, locale = 'tr-TR') => n.toLocaleString(locale, { maximumFractionDigits: 0 }) + ' TL'

/* ── Akıllı Filtre (CRO) ── */
export interface FilterFacetCfg { key: string; label: string; type: string; enabled: boolean; collapsed: boolean }
export interface FilterCatalogItem { key: string; label: string; type: string; coverage: number; coverage_pct: number; distinct: number | null; source: 'core' | 'spec' }
export interface FilterTheme { preset: 'minimal' | 'soft' | 'bold'; accent: string; radius: number; chip: 'pill' | 'square'; swatch: 'circle' | 'square'; font: string; drawer_width?: number }
export interface FilterSizeRange { key?: string; label: string; tokens: string; min: number; max: number }
export interface FilterRules { hide_out_of_stock: boolean; require_image?: boolean; size_in_stock_only: boolean; show_counts: boolean; per_page: number; sort_default: string; show_more_limit: number; sticky_apply: boolean; price_buckets: boolean; quick_add: boolean; size_ranges?: FilterSizeRange[]; hidden_categories?: number[] }
export interface FilterSettings {
  slug: string; base_url: string; shop_url: string; enabled: boolean; domains: string
  template: 'sidebar' | 'topbar' | 'drawer'; mode: 'native' | 'takeover'; theme: FilterTheme; rules: FilterRules; selectors: { hide: string; mount: string; hide_native?: string; mount_native?: string; css_native?: string }
  facets: FilterFacetCfg[]; facets_customized: boolean; catalog: { active_products: number; facets: FilterCatalogItem[] }
  templates: string[]; modes?: string[]; theme_presets: string[]; sorts: Record<string, string>
}
export interface FilterAnalytics {
  range_days: number; sessions: number; filter_sessions: number; filter_usage_rate: number; click_rate_with_filter: number; click_rate_without_filter: number
  conversions: number; revenue: number
  top_facets: { facet: string; c: number; s: number }[]; top_values: { facet: string; value: string; c: number }[]
  top_categories: { category_path: string; s: number }[]; daily: { d: string; views: number; applies: number; clicks: number }[]
}
export interface FilterFacetValue { value: string; label: string; count: number; hex?: string | null; url?: string }
export interface FilterFacetPreview { key: string; label: string; type: string; total_values: number; values: FilterFacetValue[]; min?: number; max?: number; buckets?: { min: number; max: number; count: number }[]; currency?: string }
export interface FilterDetect { url: string; http: number; hide: { selector: string; found: boolean }[]; mount: { selector: string; found: boolean }; mode?: string; ticimax: boolean; ticimax_globals?: boolean; widget_embedded: boolean }

export const filterApi = {
  settings: async () => (await api.get<FilterSettings>('/cro/filter/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<FilterSettings>('/cro/filter/settings', patch)).data,
  refreshCatalog: async () => (await api.post('/cro/filter/catalog/refresh')).data,
  facetValues: async (key: string) => (await api.get<FilterFacetPreview>('/cro/filter/facet-values', { params: { key } })).data,
  categories: async () => (await api.get<{ data: { platform_category_id: number; name: string; path: string; url: string; depth: number; product_count: number }[] }>('/cro/filter/categories')).data.data,
  analytics: async (range = 30) => (await api.get<FilterAnalytics>('/cro/filter/analytics', { params: { range } })).data,
  detect: async (path?: string) => (await api.get<FilterDetect>('/cro/filter/detect', { params: path ? { path } : {} })).data,
}

/* ── Mobil Alt Bar (CRO) ── */
export interface BarItem { key: string; type: string; label: string; icon: string; url: string; enabled: boolean }
export interface BarTheme { preset: string; accent: string; bg: string; ink: string; labels: boolean; icon_style: 'line' | 'solid'; radius: number; hide_on_scroll: boolean; show_shadow: boolean; center_item?: string }
export interface BarRules { cart_badge: boolean; account_name: boolean; categories_source: 'yunbi' | 'theme'; search_action: 'yunbi' | 'theme'; cart_action: 'page' | 'side'; hide_paths: string; hide_page_types: string[]; max_width: number; sheet_levels: number }
export interface BarSettings {
  enabled: boolean; domains: string; theme: BarTheme; rules: BarRules; items: BarItem[]; items_customized: boolean
  slug: string; base_url: string; shop_url: string; cart_url: string; presets: string[]; item_types: string[]; icons: string[]; default_items: BarItem[]
  categories_preview: { id: number; name: string; url: string; count: number; children?: { name: string; url: string; count: number }[] }[]
}
export interface BarAnalytics {
  range_days: number; sessions: number; views: number; clicks: number; click_sessions: number; engagement_rate: number; clicks_per_session: number
  by_item: { item: string; c: number; s: number }[]; by_page_type: { page_type: string; item: string; c: number }[]; by_path: { page_path: string; c: number; s: number }[]
  sheet_opens: number; sheet_clicks: { value: string; c: number }[]; daily: { d: string; sessions: number; clicks: number }[]
}
export const barApi = {
  settings: async () => (await api.get<BarSettings>('/cro/bottombar/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<BarSettings>('/cro/bottombar/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<BarAnalytics>('/cro/bottombar/analytics', { params: { range } })).data,
}

/* ── Akıllı Menü (CRO) ── */
export interface MenuTheme { preset: string; accent: string; bg: string; ink: string; tile_bg: string; radius: number; label_case: 'normal' | 'upper'; columns: number; image_fit: 'cover' | 'contain'; show_shadow: boolean; full_width?: boolean; logo_url?: string }
export interface MenuRules {
  mount: 'hamburger' | 'bottombar' | 'both'; max_width: number; default_tab: 'remember' | 'sales' | 'catalog'; sort: 'sales_30d' | 'sales_7d' | 'catalog'
  season_boost: boolean; personalize: boolean; show_recent: boolean; badges: boolean; show_counts: boolean; hide_min_products: number; max_tiles: number; group_headers: boolean
  virtual_position: 'top' | 'bottom' | 'both'; show_products: boolean; products_count: number; product_name_max: number; products_source: 'auto' | 'popular' | 'personal'; show_search: boolean; show_all_link: boolean
  segments_max: number; footer_links: boolean; hide_paths: string; nav_promo?: boolean
}
export interface MenuVirtual { key: string; label: string; url: string; style: 'chip' | 'card' | 'hero'; icon: string; emoji?: string; look?: 'plain' | 'solid' | 'gradient' | 'glow'; color?: string; color2?: string; auto_price?: boolean; image?: string; note?: string; enabled: boolean; count?: number; counts?: Record<string, number>; bands?: Record<string, { min: number; max: number; count: number; share: number }> }
export interface MenuOverrides { pinned: string[]; hidden: string[]; labels: Record<string, string>; images: Record<string, string>; order: Record<string, string[]>; segments_hidden: string[]; segments_order: string[] }
export interface MenuTile { id: number; name: string; label: string; url: string; path: string; group: string | null; group_url: string | null; count: number; q7: number; q30: number; rev30: number; season: number; img: string | null; img_auto: string | null; pinned: boolean; small: boolean; db_count: number }
export interface MenuSegment { id: number; name: string; url: string; count: number; q30: number; tiles: MenuTile[] }
export interface MenuProduct { pid: string; name: string; url: string; price: number; dprice: number | null; img: string; q: number }
export interface MenuData { segments: MenuSegment[]; all_roots: { id: number; name: string; url: string; count: number; hidden: boolean }[]; products: Record<string, MenuProduct[]>; generated_at: string }
export interface MenuCandidate { product_id: number; name: string; url: string; in_stock: boolean; rank: number; image: string | null; thumb: string | null; image_score: number; whiteness: number | null; coverage: number | null; score: number }
export interface MenuPick { image: string | null; score: number | null; picked_at: string | null; candidates: MenuCandidate[] }
export interface MenuSettings {
  enabled: boolean; domains: string; theme: MenuTheme; rules: MenuRules; virtual: MenuVirtual[]; virtual_customized: boolean; overrides: MenuOverrides
  slug: string; base_url: string; shop_url: string; presets: string[]; default_virtual: MenuVirtual[]; bottombar_enabled: boolean; data: MenuData
  picks: Record<string, MenuPick>; picking: boolean
}
export interface MenuAnalytics {
  range_days: number; opens: number; open_sessions: number; clicks: number; click_sessions: number; click_rate: number
  by_source: { source: string; c: number }[]; by_tab: { value: string; c: number }[]; by_tile: { segment: string; value: string; c: number; avg_pos: number }[]
  by_virtual: { value: string; c: number }[]; tile_by_sort_source: { source: string; c: number }[]; product_clicks: number; recent_clicks: number
  daily: { d: string; opens: number; clicks: number }[]
  by_type: { type: string; c: number; s: number }[]
  by_tile_all: { segment: string | null; value: string; c: number; s: number; avg_pos: number | null }[]
  by_virtual_seg: { segment: string | null; value: string; c: number }[]
  by_product: { segment: string | null; value: string; c: number; avg_pos: number | null; name: string }[]
  by_recent: { value: string; c: number; name: string | null }[]
  by_position: { position: number; c: number }[]
  by_footer: { value: string; c: number }[]
  by_all: { value: string; c: number }[]
  by_more: { value: string; c: number }[]
  search_clicks: number; close_noclick: number
  hourly: { h: number; c: number }[]
  segment_views: { segment: string | null; c: number }[]
}
export const menuApi = {
  settings: async (fresh = false) => (await api.get<MenuSettings>('/cro/menu/settings', { params: fresh ? { fresh: 1 } : {} })).data,
  update: async (patch: Record<string, unknown>) => (await api.put<MenuSettings>('/cro/menu/settings', patch)).data,
  refresh: async () => (await api.post<{ ok: boolean; data: MenuData }>('/cro/menu/refresh')).data,
  pickImages: async (path?: string) => (await api.post<{ ok: boolean; queued?: boolean; pick?: MenuPick | null }>('/cro/menu/pick-images', path ? { path } : {})).data,
  analytics: async (range = 30) => (await api.get<MenuAnalytics>('/cro/menu/analytics', { params: { range } })).data,
}

/* ── "Bugüne Özel" Hero Ürün kulakçığı (CRO) ── */
export interface HeroVariant { vid: string; label: string; stock: number }
export interface HeroColor { id: number; name: string; hex: string | null; hex2: string | null; img: string; url: string; price: number; dprice: number | null; stock: number }
export interface HeroProduct { id: number; pid: string; name: string; brand: string | null; sku: string | null; url: string; price: number; dprice: number | null; discount_pct: number; img: string | null; imgs: string[]; stock: number; in_stock: boolean; active: boolean; rating: number | null; variants: HeroVariant[]; color?: string | null; colors?: HeroColor[] }
export interface HeroSet { id: string; title: string; subtitle: string; eyebrow?: string; badge?: string; start_date: string | null; end_date: string | null; products: number[]; coupon: string; coupon_text: string; enabled: boolean }
export interface HeroTheme { preset: string; accent: string; accent2: string; ink: string; bg: string; radius: number; tab_style: 'ribbon' | 'pill' | 'badge'; tab_position: string; tab_text: string; tab_emoji: string; tab_pulse: boolean; tab_timer: boolean; drawer_width: number; card_layout: 'row' | 'grid'; layout?: 'full' | 'minimal' | 'panel'; font: string }
export interface HeroRules {
  eyebrow: string; title: string; subtitle: string; timer_mode: 'midnight' | 'set_end' | 'off'; timer_label: string
  auto_open: boolean; auto_open_delay: number; auto_open_scroll: number; exit_intent: boolean; frequency: 'day' | 'session' | 'always'; no_auto_page_types?: string[]
  quick_add: boolean; show_stock: boolean; stock_threshold: number; show_discount_badge: boolean; best_color?: boolean; cta_text: string; view_text: string
  footer_text: string; footer_url: string; hide_paths: string; hide_page_types: string[]; mobile_sheet: boolean; max_width: number; min_width: number
}
export interface HeroSettings {
  enabled: boolean; domains: string; theme: HeroTheme; rules: HeroRules; sets: HeroSet[]
  slug: string; base_url: string; shop_url: string; today: string; active_set_id: string | null; ends_at: number | null
  products: Record<number, HeroProduct>; shown_colors?: Record<number, { id: number; color: string; sales: number; clicks: number; changed: boolean }>; presets: string[]; tab_styles: string[]; tab_positions: string[]; timer_modes: string[]; frequencies: string[]; max_products: number
}
export interface HeroAnalytics {
  range_days: number; sessions: number; open_sessions: number; opens: number; open_rate: number; clicks: number; atc: number; coupons: number; closes: number
  click_sessions: number; engagement_rate: number; conversions: number; revenue: number
  by_source: { source: string; c: number; s: number }[]; source_engagement: { source: string; opened: number; engaged: number }[]
  by_product: { product_id: number; name: string | null; url: string | null; clicks: number; atc: number; conv: number; rev: number }[]
  by_set: { set_id: string | null; views: number; opens: number; clicks: number; atc: number; conv: number; rev: number }[]
  by_device: { device: string | null; views: number; opens: number; acts: number }[]
  daily: { d: string; views: number; opens: number; acts: number; conv: number; rev: number }[]
  hourly: { h: number; c: number }[]; errors: { value: string; c: number }[]
}
/* ── "Flaş İndirim" ana sayfa vitrini (CRO) ── */
export interface FlashProduct extends HeroProduct { sold14: number; segment?: string | null; why?: { sold: number; clicks: number; score: number; seg: string } }
export interface FlashSet { id: string; title: string; subtitle: string; eyebrow: string; start_date: string | null; end_date: string | null; products: number[]; coupon: string; coupon_mode: 'none' | 'code' | 'auto'; coupon_pct: number; coupon_text: string; enabled: boolean }
export interface FlashTheme { preset: string; layout: 'spotlight' | 'grid' | 'rail' | 'split' | 'tabs' | 'stories'; accent: string; accent2: string; bg: string; ink: string; card_bg: string; radius: number; rain: boolean; font: string; container_width: number; width: 'container' | 'full'; dark_cards: boolean }
export interface FlashRules {
  eyebrow: string; title: string; subtitle: string; timer_mode: 'midnight' | 'set_end' | 'off'; timer_label: string
  pages: string[]; mount: string; mount_mode: 'replace' | 'before' | 'after' | 'prepend'; mount_fallback: string
  max_products: number; rows: number; rotate_hours: number; rotate_step: number; rotate_mode: 'time' | 'visitor'; min_sizes: number; quick_add: boolean; show_sold: boolean; sold_threshold: number; show_stock: boolean; stock_threshold: number
  show_bar: boolean; show_segment: boolean; cta_text: string; view_text: string; footer_text: string; footer_url: string; coupon_label: string
  hover_swap: boolean; min_width: number; max_width: number; hide_paths: string
}
export interface FlashSettings {
  enabled: boolean; domains: string; theme: FlashTheme; rules: FlashRules; sets: FlashSet[]
  slug: string; base_url: string; shop_url: string; today: string; active_set_id: string | null; ends_at: number | null
  products: Record<number, FlashProduct>; presets: string[]; layouts: string[]; timer_modes: string[]; mount_modes: string[]; max_products: number
}
export interface FlashAnalytics {
  range_days: number; sessions: number; clicks: number; atc: number; coupons: number; tabs: number; ctas: number; click_sessions: number; engagement_rate: number; conversions: number; revenue: number
  by_product: { product_id: number; name: string | null; url: string | null; clicks: number; atc: number; conv: number; rev: number }[]
  by_layout: { layout: string | null; views: number; acts: number; conv: number; rev: number }[]
  by_set: { set_id: string | null; views: number; clicks: number; atc: number; conv: number; rev: number }[]
  by_device: { device: string | null; views: number; acts: number }[]
  daily: { d: string; views: number; acts: number; conv: number; rev: number }[]
  errors: { value: string; c: number }[]
}
export const flashApi = {
  settings: async () => (await api.get<FlashSettings>('/cro/flash/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<FlashSettings>('/cro/flash/settings', patch)).data,
  products: async (params: { q?: string; ids?: string; limit?: number; discounted?: number }) => (await api.get<{ data: FlashProduct[] }>('/cro/flash/products', { params })).data.data,
  suggest: async (params: { count?: number; q?: string; segments?: string; days?: number }) => (await api.get<{ data: FlashProduct[]; reason?: string; days?: number }>('/cro/flash/suggest', { params })).data,
  analytics: async (range = 30) => (await api.get<FlashAnalytics>('/cro/flash/analytics', { params: { range } })).data,
}

export const heroApi = {
  settings: async () => (await api.get<HeroSettings>('/cro/hero/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<HeroSettings>('/cro/hero/settings', patch)).data,
  products: async (params: { q?: string; ids?: string; limit?: number; discounted?: number }) => (await api.get<{ data: HeroProduct[] }>('/cro/hero/products', { params })).data.data,
  suggest: async (count = 3) => (await api.get<{ data: HeroProduct[]; reason?: string }>('/cro/hero/suggest', { params: { count } })).data,
  analytics: async (range = 30) => (await api.get<HeroAnalytics>('/cro/hero/analytics', { params: { range } })).data,
}

/* ── Ürün Galerisi (CRO) ── */
export interface GalleryTheme { accent: string; bg: string; thumb_size: number; thumb_style: 'square' | 'round' | 'tall' | 'photo'; thumb_gap: number; radius: number; indicator: 'dots' | 'counter' | 'both' | 'none'; aspect: 'photo' | '1:1' | '2:3' | '3:4' | '4:5' | 'auto'; fit: 'cover' | 'contain'; zoom_hint: boolean; viewer_bg: string; font: string }
export interface GalleryRules { devices: 'mobile' | 'all' | 'desktop'; max_width: number; viewer_enabled: boolean; zoom_enabled: boolean; indicator_arrows: boolean; show_title: boolean; share_button: boolean; download_button: boolean; max_zoom: number; double_tap_zoom: number; thumbs_on_page: boolean; thumbs_in_viewer: boolean; swipe_main: boolean; autoplay: boolean; source_selector: string; hide_selector: string; mount_selector: string; preload: number; hide_paths: string }
export interface GallerySettings {
  enabled: boolean; domains: string; theme: GalleryTheme; rules: GalleryRules
  slug: string; base_url: string; shop_url: string; devices: string[]; thumb_styles: string[]; indicators: string[]; defaults: { theme: GalleryTheme; rules: GalleryRules }
}
export interface GalleryAnalytics {
  range_days: number; sessions: number; views: number; swipes: number; thumbs: number; opens: number; zooms: number; open_sessions: number; zoom_sessions: number; interact_sessions: number
  interact_rate: number; open_rate: number; zoom_rate: number; avg_image_count: number
  depth: { image_index: number; c: number }[]; by_product: { product_id: number; page_path: string; c: number; s: number }[]; errors: { value: string; c: number }[]; daily: { d: string; sessions: number; opens: number; zooms: number }[]
}
export const galleryApi = {
  settings: async () => (await api.get<GallerySettings>('/cro/gallery/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<GallerySettings>('/cro/gallery/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<GalleryAnalytics>('/cro/gallery/analytics', { params: { range } })).data,
}

/* ── "Uygulamaya Özel" kulakçığı (CRO) ── */
export interface AppPromoTheme { preset: string; accent: string; accent2: string; ink: string; bg: string; radius: number; tab_position: string; tab_text: string; tab_badge: string; tab_emoji: string; tab_pulse: boolean; font: string }
export interface AppPromoRules {
  code: string; discount_label: string; eyebrow: string; title: string; subtitle: string; terms: string; valid_until: string | null
  ios_url: string; android_url: string; landing_url: string; show_code_web: boolean; show_qr: boolean; in_app_mode: 'code' | 'hide'
  cta_ios: string; cta_android: string; copy_text: string
  auto_open: boolean; auto_open_delay: number; auto_open_scroll: number; exit_intent: boolean; auto_open_mobile?: boolean; tab_close?: boolean; tab_close_days?: number; frequency: 'day' | 'session' | 'always'; no_auto_page_types: string[]
  hide_paths: string; hide_page_types: string[]; max_width: number; min_width: number
}
export interface AppPromoSettings {
  enabled: boolean; domains: string; theme: AppPromoTheme; rules: AppPromoRules
  slug: string; base_url: string; shop_url: string; go_url: string; presets: string[]; tab_positions: string[]; frequencies: string[]; in_app_modes: string[]
  defaults: { theme: AppPromoTheme; rules: AppPromoRules }
}
export interface AppPromoOrderStats { total: number; app: number; app_rev: number; app_share: number; code_orders: number; code_rev: number; code_web: number }
export interface AppPromoAnalytics {
  range_days: number; code: string; first_event_at: string | null
  sessions: number; open_sessions: number; opens: number; open_rate: number; clicks: number; click_sessions: number; click_rate: number
  copies: number; copy_sessions: number; redirects: number; qr_scans: number; store_visits: number; closes: number; inapp_sessions: number
  by_source: { source: string; c: number; s: number }[]; by_click: { source: string; platform: string; c: number; s: number }[]
  by_redirect: { source: string; platform: string; c: number }[]; by_device: { device: string | null; views: number; opens: number; acts: number }[]
  by_platform: { platform: string; views: number; opens: number; clicks: number; copies: number }[]; errors: { value: string; c: number }[]
  orders: { current: AppPromoOrderStats; previous: AppPromoOrderStats }
  code_by_source: { order_source: string; c: number; rev: number }[]
  new_app_customers: { n: number; from_web: number; with_code: number }; code_users: { n: number; first_orders: number }
  daily: { d: string; views: number; opens: number; clicks: number; copies: number; redirects: number; orders: number; app_orders: number; code_orders: number; code_rev: number }[]
}
export const appPromoApi = {
  settings: async () => (await api.get<AppPromoSettings>('/cro/app/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<AppPromoSettings>('/cro/app/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<AppPromoAnalytics>('/cro/app/analytics', { params: { range } })).data,
}

/* ── Sepet Kampanyası (CRO) ── */
export interface CartTier { threshold: number; type: 'shipping' | 'percent' | 'amount' | 'gift'; value: number; label: string; short: string }
export interface CartTheme { accent: string; accent2: string; ok: string; ink: string; muted: string; bg: string; track: string; radius: number; font: string; style: 'card' | 'flat'; badge_color: string; celebrate: boolean }
export interface CartRules {
  tiers: CartTier[]; basis: 'before_discount' | 'after_discount'; title: string; msg_next: string; msg_reached: string; msg_all: string; msg_empty: string
  show_savings: boolean; show_value: boolean; shipping_fee: number; cta_text: string; cta_url: string; show_cta: boolean
  suggest_enabled: boolean; suggest_title: string; suggest_unlock: string; suggest_max: number; suggest_side: boolean; suggest_checkout: boolean; suggest_hide_all: boolean
  started_at: string; impact_sources: string
  side_enabled: boolean; side_price: boolean; side_summary: boolean; side_mount: string
  checkout_enabled: boolean; checkout_price: boolean; checkout_summary: boolean; checkout_mount: string; checkout_summary_mount: string; checkout_hide_selector: string; checkout_paths: string
  hide_paths: string; currency: string; max_width: number
}
export interface CartSettings {
  enabled: boolean; domains: string; theme: CartTheme; rules: CartRules
  slug: string; base_url: string; shop_url: string; tier_types: string[]; bases: string[]; defaults: { theme: CartTheme; rules: CartRules }
}
export interface CartAnalytics {
  range_days: number; sessions: number; by_surface: { surface: string; s: number; c: number }[]; unlocks: { tier: number; c: number; s: number }[]
  ctas: number; cta_sessions: number; cta_rate: number; checkout_sessions: number
  suggest_sessions: number; adds: number; add_sessions: number; add_rate: number; add_fails: number; top_added: { id: number; name: string; c: number }[]
  tier_dist: { tier: number; c: number; avg_basis: number }[]; avg_basis: number; near_miss: { tier: number; c: number; avg_remaining: number }[]
  daily: { d: string; sessions: number; unlocks: number; ctas: number }[]; errors: { value: string; c: number }[]
}
export interface CartImpactBlock { orders: number; revenue: number; aov: number; disc: number; disc_share: number; orders_per_day: number | null; revenue_per_day: number | null; days: number; bands: { threshold: number; orders: number; share: number }[] }
export interface CartImpact {
  started_at: string | null; message?: string; now?: string; sources?: string[]; tiers?: number[]; same_day_window?: boolean
  campaign?: CartImpactBlock; baseline_28d?: CartImpactBlock; baseline_dow?: CartImpactBlock; baseline_3m?: CartImpactBlock
  daily?: { d: string; c: number; rev: string; aov: string; ge0: number; disc: number }[]
}
export const cartApi = {
  settings: async () => (await api.get<CartSettings>('/cro/cart/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<CartSettings>('/cro/cart/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<CartAnalytics>('/cro/cart/analytics', { params: { range } })).data,
  impact: async () => (await api.get<CartImpact>('/cro/cart/impact')).data,
}

/* ── Ürün Rozetleri ── */
export type BadgeKind = 'category' | 'tag' | 'bestseller' | 'popular' | 'new' | 'low_stock' | 'top_rated'
export interface BadgeType { id: string; kind: BadgeKind; label: string; color: string; icon: string; enabled: boolean; list: boolean; pdp: boolean; params: Record<string, number>; corner?: '' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; design?: 'standard' | 'spotlight' | 'bar' }
export interface BadgeTheme { style: 'solid' | 'soft' | 'outline' | 'glass'; shape: 'pill' | 'rounded' | 'square' | 'ribbon'; size: 's' | 'm' | 'l'; uppercase: boolean; list_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; list_direction: 'column' | 'row'; list_offset: number; mobile_bottom?: boolean; mobile_compact?: boolean; shadow: boolean; font: string; pdp_style: string; proof_style: 'card' | 'plain'; proof_accent: string }
export interface BadgeRules {
  list_enabled: boolean; pdp_enabled: boolean; list_max: number; pdp_max: number; exclusive: string[]; new_skip_category: boolean; hide_out_of_stock: boolean
  proof_enabled: boolean; proof_sold_24h: boolean; proof_sold_24h_min: number; proof_sold_24h_text: string; proof_sold_7d: boolean; proof_sold_7d_min: number; proof_sold_7d_text: string
  proof_views: boolean; proof_views_min: number; proof_views_text: string;
  proof_round: boolean; proof_max_lines: number; proof_sold_30d: boolean; proof_sold_30d_min: number; proof_sold_30d_text: string
  proof_rank: boolean; proof_rank_max: number; proof_rank_min_qty: number; proof_rank_text: string
  proof_cart: boolean; proof_cart_min: number; proof_cart_hours: number; proof_cart_text: string
  proof_fav: boolean; proof_fav_min: number; proof_fav_text: string; proof_atc: boolean; proof_atc_min: number; proof_atc_text: string
 proof_sizes: boolean; proof_sizes_max_stock: number; proof_sizes_text: string
  list_card_selector: string; list_id_selector: string; list_image_selector: string; pdp_badge_position: 'image' | 'price' | 'title'; pdp_image_mount: string; pdp_price_mount: string; pdp_badge_mount: string; pdp_proof_mount: string; hide_paths: string
}
export interface BadgeSample { pid: string; name: string; image: string | null; url: string | null; value: string | null; badges: string[] }
export interface BadgeSettings {
  enabled: boolean; domains: string; theme: BadgeTheme; rules: BadgeRules; types: BadgeType[]
  slug: string; base_url: string; shop_url: string; kinds: BadgeKind[]; icons: string[]; category_names: Record<string, string>
  defaults: { theme: BadgeTheme; rules: BadgeRules; types: BadgeType[] }
  build: null | { built_at: string; duration_ms: number | null; counts: Record<string, number>; badged: number; proof: number; notes: string[]; samples: Record<string, BadgeSample[]> }
  build_error?: string | null
}
export interface BadgeAnalytics {
  range_days: number; pages: number; sessions: number; cards: number; badged_cards: number
  baseline: { impressions: number; clicks: number; ctr: number | null }
  types: { id: string; label: string; color: string; impressions: number; clicks: number; ctr: number | null; pdp_views: number }[]
  pdp_total: number; daily: { d: string; bc: number; uc: number; pv: number }[]
}
export const badgeApi = {
  settings: async () => (await api.get<BadgeSettings>('/cro/badges/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<BadgeSettings>('/cro/badges/settings', patch)).data,
  categories: async (q: string) => (await api.get<{ items: { id: string; name: string; path: string; product_count: number; is_active: boolean }[] }>('/cro/badges/categories', { params: { q } })).data.items,
  analytics: async (range = 30) => (await api.get<BadgeAnalytics>('/cro/badges/analytics', { params: { range } })).data,
}

/* ── 404 Sayfası ── */
export type NotFoundTemplate = 'lost_pair' | 'space' | 'balloons' | 'detective' | 'arcade' | 'minimal'
export interface NotFoundProduct { id: number; pid: string; name: string; url: string; price: number; dprice: number | null; discount_pct: number; img: string | null; rating: number | null }
export interface NotFoundContent {
  title: string; subtitle: string; show_search: boolean; show_matched: boolean; matched_title: string
  show_products: boolean; products_title: string; products_source: 'bestseller' | 'new' | 'manual'; products_days: number; product_count: number; product_ids: number[]
  show_categories: boolean; categories: { name: string; url: string }[]; home_text: string; coupon_code: string; coupon_text: string; accent: string
}
export interface NotFoundRules { display: 'overlay' | 'inline' | 'auto'; mount_selector: string; hide_selectors: string; search_url: string; detect_paths: string; detect_selectors: string }
export interface NotFoundSettings {
  enabled: boolean; domains: string; template: NotFoundTemplate; content: NotFoundContent; rules: NotFoundRules
  slug: string; base_url: string; shop_url: string; templates: NotFoundTemplate[]; manual_products: NotFoundProduct[]
  defaults: { content: NotFoundContent; rules: NotFoundRules }
}
export interface NotFoundAnalytics {
  range_days: number; views: number; sessions: number; views_matched: number; saved_sessions: number; saved_rate: number | null
  clicks: Record<string, number>; searches: number; games: number; coupons: number; by_template: Record<string, number>
  broken: { p: string; c: number; last: string; ref: string | null }[]
  top_products: { id: number; name: string; clicks: number }[]
  daily: { d: string; v: number; c: number }[]
}
export const notFoundApi = {
  settings: async () => (await api.get<NotFoundSettings>('/cro/notfound/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<NotFoundSettings>('/cro/notfound/settings', patch)).data,
  products: async (q: string) => (await api.get<{ items: NotFoundProduct[] }>('/cro/notfound/products', { params: { q } })).data.items,
  analytics: async (range = 30) => (await api.get<NotFoundAnalytics>('/cro/notfound/analytics', { params: { range } })).data,
}

/* ── Sana Özel öneri kulakçığı ── */
export interface ForYouRules {
  title: string; tab_text: string
  subtitle_bestseller: string; subtitle_category: string; subtitle_viewed: string; subtitle_cart: string; subtitle_history: string
  count: number; accent: string; side: 'left' | 'right'; show_add: boolean
  nudge_after: number; nudge_text: string; product_page: 'subtle' | 'normal' | 'hidden'; hide_paths: string
  bestseller_days: number; use_history: boolean
  pulse: boolean; auto_open: boolean; auto_views: number; auto_delay: number; auto_idle: number; auto_exit: boolean; auto_daily: number
}
export interface ForYouSettings { enabled: boolean; domains: string; rules: ForYouRules; defaults: ForYouRules; modes: string[]; slug: string; base_url: string; shop_url: string }
export interface ForYouAnalytics {
  range_days: number; sessions: number; nudges: number; opens: number; open_sessions: number; open_rate: number
  nudge_opens: number; nudge_rate: number | null; clicks: number; click_sessions: number; engagement_rate: number; atc: number; closes: number
  conversions: number; orders: number; revenue: number
  by_mode: { mode: string; views: number; opens: number; clicks: number; atc: number; conv: number; rev: number }[]
  by_product: { product_id: number; name: string | null; url: string | null; clicks: number; atc: number; conv: number; rev: number }[]
  by_device: { device: string | null; views: number; opens: number; acts: number }[]
  by_page: { t: string; c: number }[]
  by_source: { s: string; c: number; n: number }[]
  source_engagement: { s: string; opened: number; engaged: number }[]
  daily: { d: string; views: number; opens: number; acts: number; conv: number; rev: number }[]
  errors: { value: string; c: number }[]
}
export const forYouApi = {
  settings: async () => (await api.get<ForYouSettings>('/cro/foryou/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<ForYouSettings>('/cro/foryou/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<ForYouAnalytics>('/cro/foryou/analytics', { params: { range } })).data,
}

/* ── Hoş geldin hediyesi ── */
export interface WelcomeRules {
  code: string; percent: number; eyebrow: string; title: string; text: string; cta: string; revealed_title: string; revealed_text: string
  shop_cta: string; shop_url: string; image_url: string; accent: string; position: 'left' | 'right'
  delay: number; min_pages: number; exit_intent: boolean; product_page: boolean; hide_paths: string; dismiss_days: number
  hide_customers: boolean; remind: boolean; remind_text: string; remind_days: number; started_at: string
}
export interface WelcomeSettings { enabled: boolean; domains: string; rules: WelcomeRules; defaults: WelcomeRules; code_orders_90d: number; slug: string; base_url: string; shop_url: string }
export interface WelcomeAnalytics {
  range_days: number; code: string; started_at: string; sessions: number; reveals: number; reveal_rate: number; copies: number; dismisses: number; ctas: number
  conversions: number; coupon_conversions: number; revenue: number; discount: number; code_orders: number; code_revenue: number
  by_trigger: { s: string; n: number }[]; trigger_engagement: { s: string; shown: number; revealed: number }[]
  by_device: { device: string | null; views: number; reveals: number; conv: number }[]
  daily: { d: string; views: number; reveals: number; conv: number; rev: number }[]
  errors: { value: string; c: number }[]
}
export const welcomeApi = {
  settings: async () => (await api.get<WelcomeSettings>('/cro/welcome/settings')).data,
  update: async (patch: Record<string, unknown>) => (await api.put<WelcomeSettings>('/cro/welcome/settings', patch)).data,
  analytics: async (range = 30) => (await api.get<WelcomeAnalytics>('/cro/welcome/analytics', { params: { range } })).data,
}
