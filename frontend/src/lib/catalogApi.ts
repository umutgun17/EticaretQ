import api from './api'

/**
 * Kategori Zekası API client — Kategori Denetçisi (öneri kuyruğu) +
 * Akıllı Kategori Sıralaması önizlemesi. Uçlar auth + permission:marketing korumalı.
 */

export interface CatalogOverview {
  products_total: number
  products_active: number
  products_problem: number
  products_orphan: number
  categories_active: number
  categories_assignable: number
  suggestions: {
    review_pending: number
    auto_pending: number
    approved: number
    applied: number
    rejected: number
    failed: number
  }
  backlog_remaining: number
  last_tree_sync: string | null
}

export interface SuggestionSources {
  agree: string[]
  age_group: string | null
  family: { path: string | null; count: number | null; share: number | null } | null
  knn: { path: string | null; share: number | null } | null
  llm_confidence: number | null
}

export interface CategorySuggestionItem {
  id: number
  action: 'recategorize' | 'create_category'
  status: 'suggested' | 'approved' | 'rejected' | 'applied' | 'auto_applied' | 'failed'
  tier: 'auto' | 'review'
  confidence: number
  rationale: string | null
  error: string | null
  applied_at: string | null
  created_at: string | null
  product: { id: number; name: string; image: string | null; url: string | null } | null
  current_path: string | null
  current_category: string | null
  suggested_primary_id: number | null
  suggested_primary_path: string | null
  suggested_secondary_paths: string[]
  new_category: { name?: string; parent_platform_id?: number } | null
  sources: SuggestionSources
}

export interface RankingCategory {
  id: number
  name: string
  path: string
  product_count: number
}

export interface RankingSignals {
  sales: number
  engagement: number
  trend: number
  favorites: number
  reviews: number
  conversion: number
  freshness: number
  stock: number
  size_coverage: number
  q90: number
  stock_qty: number
}

export interface RankingPreviewItem {
  rank: number
  product_id: number
  name: string
  image: string | null
  url: string | null
  score: number
  discovery: boolean
  pinned?: boolean
  model?: string
  is_new: boolean
  season?: 'winter' | 'summer' | null
  off_season?: boolean
  old_sira: number | null
  old_position: number | null
  signals: RankingSignals
}

export interface RankingPreview {
  category: { id: number; path: string; pool: number }
  weights: Record<string, number>
  discovery?: DiscoverySettings
  season?: { enabled: boolean; mode: 'tier' | 'soft'; active: 'winter' | 'summer' | null; winter: [string, string]; summer: [string, string] }
  simulated?: boolean
  items: RankingPreviewItem[]
}

export interface PinResolved {
  code: string
  status: 'ok' | 'not_found' | 'out_of_stock'
  colors: number
  position?: number
  product_id?: number
  name?: string
  q90?: number
  stock_qty?: number
  missing_sizes?: number | null
}

export interface RankingPins {
  category_id?: number
  codes?: string[]
  resolved?: PinResolved[]
  counts: Record<string, number>
  apply_queued?: boolean
}

export interface AbStatus {
  enabled: boolean
  started_at: string
  period_days: number
  variant_a: Record<string, number>
  variant_b: Record<string, number>
  active_variant: 'A' | 'B'
  next_switch_at: string
}

export interface AbResults {
  ab: Partial<AbStatus>
  windows: { variant: 'A' | 'B'; from: string; to: string; running: boolean; orders: number; revenue: number; aov: number | null }[]
  totals: Record<'A' | 'B', { windows: number; orders: number; revenue: number; aov: number | null }>
  note: string
}

export interface DiscoverySettings {
  mode: 'bonus' | 'slot'
  interval: number
  max_age_days: number
  require_no_sales: boolean
  bonus_max: number
  guarantee_within: number
  guarantee_position: number
}

export interface DiscoveryCandidates {
  young: number
  stocked: number
  no_sales: number
  eligible: number
  coverage_depth: number
}

export interface RankingDiscovery {
  defaults: DiscoverySettings
  override: DiscoverySettings | null
  effective: DiscoverySettings
  probe: DiscoverySettings
  candidates: DiscoveryCandidates
  limits: { interval: [number, number]; max_age_days: [number, number]; bonus_max?: [number, number]; guarantee_within?: [number, number] }
}

export interface RankingWeights {
  defaults: Record<string, number>
  override: Record<string, number> | null
  effective: Record<string, number>
  history: {
    at: string; by: string
    action: 'save' | 'reset' | 'ab_start' | 'ab_stop' | 'discovery_save' | 'discovery_reset'
    weights: Record<string, number>
    discovery?: DiscoverySettings
  }[]
  ab: AbStatus | null
}

export const catalogApi = {
  overview: () =>
    api.get<CatalogOverview>('/catalog/overview').then(r => r.data),

  suggestions: (params: { status?: string; tier?: string; action?: string; page?: number; per_page?: number }) =>
    api.get<{ items: CategorySuggestionItem[]; total: number; page: number; per_page: number }>(
      '/catalog/suggestions', { params },
    ).then(r => r.data),

  approve: (id: number, apply = true) =>
    api.post<{ ok: boolean; status?: string; error?: string | null; note?: string }>(
      `/catalog/suggestions/${id}/approve`, { apply },
    ).then(r => r.data),

  reject: (id: number) =>
    api.post<{ ok: boolean }>(`/catalog/suggestions/${id}/reject`).then(r => r.data),

  bulk: (ids: number[], action: 'approve' | 'reject') =>
    api.post<{ ok: boolean; count: number; queued?: boolean }>(
      '/catalog/suggestions/bulk', { ids, action },
    ).then(r => r.data),

  treeAudit: () =>
    api.get<{
      duplicate_branches: { name: string; count: number; branches: { id: number; path: string; products: number }[] }[]
      empty_leaves: { id: number; name: string; path: string }[]
      orphans: { id: number; name: string; category: string | null; image: string | null }[]
    }>('/catalog/tree-audit').then(r => r.data),

  rankingCategories: () =>
    api.get<{
      categories: RankingCategory[]
      weights: Record<string, number>
      has_override: boolean
      config: Record<string, number>
      enabled: boolean
    }>('/catalog/ranking/categories').then(r => r.data),

  rankingPreview: (
    categoryId: number, limit = 100,
    weights?: Record<string, number>, discovery?: DiscoverySettings, pins?: string[],
  ) =>
    api.get<RankingPreview>('/catalog/ranking/preview', {
      params: {
        category_id: categoryId, limit,
        ...(weights ? { weights: JSON.stringify(weights) } : {}),
        ...(discovery ? { discovery: JSON.stringify(discovery) } : {}),
        ...(pins ? { pins: JSON.stringify(pins) } : {}),
      },
    }).then(r => r.data),

  rankingPins: (categoryId?: number) =>
    api.get<RankingPins>('/catalog/ranking/pins', {
      params: categoryId ? { category_id: categoryId } : {},
    }).then(r => r.data),

  saveRankingPins: (categoryId: number, codes: string[], apply: boolean) =>
    api.post<RankingPins & { ok: boolean }>(
      '/catalog/ranking/pins', { category_id: categoryId, codes, apply },
    ).then(r => r.data),

  rankingWeights: () =>
    api.get<RankingWeights>('/catalog/ranking/weights').then(r => r.data),

  // weights=null → varsayılana dön (reset)
  saveRankingWeights: (weights: Record<string, number> | null) =>
    api.post<RankingWeights & { ok: boolean }>(
      '/catalog/ranking/weights', weights ? { weights } : { reset: true },
    ).then(r => r.data),

  rankingDiscovery: (probe?: DiscoverySettings) =>
    api.get<RankingDiscovery>('/catalog/ranking/discovery', {
      params: probe
        ? {
          mode: probe.mode, interval: probe.interval, max_age_days: probe.max_age_days,
          require_no_sales: probe.require_no_sales ? 1 : 0, bonus_max: probe.bonus_max,
          guarantee_within: probe.guarantee_within, guarantee_position: probe.guarantee_position,
        }
        : {},
    }).then(r => r.data),

  // discovery=null → varsayılana dön (reset)
  saveRankingDiscovery: (discovery: DiscoverySettings | null) =>
    api.post<RankingDiscovery & { ok: boolean }>(
      '/catalog/ranking/discovery', discovery ? { discovery } : { reset: true },
    ).then(r => r.data),

  abStart: (variantB: Record<string, number>, periodDays: number) =>
    api.post<{ ok: boolean; effective: Record<string, number>; ab: AbStatus }>(
      '/catalog/ranking/ab', { action: 'start', variant_b: variantB, period_days: periodDays },
    ).then(r => r.data),

  abStop: () =>
    api.post<{ ok: boolean; effective: Record<string, number>; ab: AbStatus | null }>(
      '/catalog/ranking/ab', { action: 'stop' },
    ).then(r => r.data),

  abResults: () =>
    api.get<AbResults>('/catalog/ranking/ab/results').then(r => r.data),
}
