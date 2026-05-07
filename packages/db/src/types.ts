import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type {
  organizations,
  fitSizeCharts,
  usageLogs,
  brandSizeCharts,
  garmentMappings,
} from './schema'

// Inferred types from Drizzle schema
export type Organization = InferSelectModel<typeof organizations>
export type FitSizeChart = InferSelectModel<typeof fitSizeCharts>
export type UsageLog = InferInsertModel<typeof usageLogs>
export type BrandSizeChart = InferSelectModel<typeof brandSizeCharts>
export type GarmentMapping = InferSelectModel<typeof garmentMappings>

// Shared enums
export type GarmentType =
  | 'tshirt'
  | 'shirt'
  | 'polo'
  | 'sweatshirt'
  | 'hoodie'
  | 'jacket'
  | 'kurta'
  | 'top'

export type FitType = 'slim' | 'regular' | 'oversized'

export type EaseSource = 'explicit' | 'inferred' | 'user_calibrated'

export type ConfidenceLabel = 'high' | 'medium' | 'low'

// Worker API request shape
export interface PredictRequest {
  ref_brand: string
  ref_garment: GarmentType
  ref_size: string
  target_brand: string
}

// Worker API response shape
export interface PredictResponse {
  predicted_size: string
  confidence: number
  confidence_label: ConfidenceLabel
  suggested_sizes: string[]
  is_boundary_case: boolean
  below_range: boolean
  above_range: boolean
  reasoning: {
    body_anchor_cm: number
    ref_garment_mid_cm: number
    ref_ease_cm: number
    ref_ease_source: EaseSource
    ref_fit_type: FitType
    target_fit_type: FitType
    target_ease_cm: number
    target_garment_equiv_cm: number
    matched_range_min_cm: number
    matched_range_max_cm: number
    cross_fit_flag: boolean
    cross_fit_penalty_applied: number
  }
  meta: {
    ref_brand: string
    ref_garment: string
    ref_size: string
    target_brand: string
    ref_scraped_at: string
    target_scraped_at: string
  }
}

// KV record shapes — what the Worker reads from KV
export interface MerchantKVRecord {
  org_id: string
  plan_tier: string
  widget_active: boolean
  api_key: string
}

export interface BrandSizeChartKVRecord {
  brand: string
  garment_type: GarmentType
  size_label: string
  chest_min_cm: number
  chest_max_cm: number
  length_min_cm: number | null
  length_max_cm: number | null
  shoulder_min_cm: number | null
  shoulder_max_cm: number | null
  fit_type: FitType
  ease_value_cm: number
  ease_source: EaseSource
  scraped_at: string
}
