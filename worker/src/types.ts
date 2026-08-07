import type { FitIntent, FitType, RefSizeRow, TargetSizeRow } from './algorithm/types'

export interface MerchantKVRecord {
  org_id: string
  shop: string
  plan_tier: 'trial' | 'paid'
  trial_requests_remaining: number
  widget_active: boolean
}

export interface ProductMappingKVRecord {
  garment_type: string
  is_active: boolean
}

export interface PredictRequestBody {
  ref_brand: string
  ref_garment: string
  ref_size: string
  shopify_product_id: string
  /** Optional shopper silhouette intent for dual-recommendation resolution */
  fit_intent?: FitIntent
}

export type ValidatedCharts = {
  reference: RefSizeRow[]
  target: TargetSizeRow[]
  targetFitType: FitType
}
