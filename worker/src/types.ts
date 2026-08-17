import type { FitIntent, FitType, RefSizeRow, TargetSizeRow } from './algorithm/types'

export type PlanTier = 'trial' | 'starter' | 'growth'

export const PLAN_MONTHLY_REQUESTS: Record<PlanTier, number> = {
  trial: 1000,
  starter: 3000,
  growth: 10000,
}

export function isPlanTier(value: unknown): value is PlanTier {
  return value === 'trial' || value === 'starter' || value === 'growth'
}

export interface MerchantKVRecord {
  org_id: string
  shop: string
  plan_tier: PlanTier
  trial_requests_remaining: number
  widget_active: boolean
}

export interface ProductMappingKVRecord {
  garment_type: string
  fit_type: FitType
  is_active: boolean
}

export interface PredictRequestBody {
  ref_brand: string
  ref_garment: string
  ref_size: string
  shopify_product_id: string
  /** Reference garment fit. Defaults to regular when the widget omits it. */
  ref_fit?: FitType
  /** Optional shopper silhouette intent for dual-recommendation resolution */
  fit_intent?: FitIntent
}

export type ValidatedCharts = {
  reference: RefSizeRow[]
  target: TargetSizeRow[]
  targetFitType: FitType
}
