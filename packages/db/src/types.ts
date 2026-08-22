import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type {
  organizations,
  fitSizeCharts,
  usageLogs,
  brandSizeCharts,
  garmentMappings,
  anthropometricAnchors,
  conversionEvents,
  widgetConfigs,
  brandRequests,
} from './schema'
import type { PlanTier } from './plans'

export type Organization = InferSelectModel<typeof organizations>
export type FitSizeChart = InferSelectModel<typeof fitSizeCharts>
export type UsageLog = InferInsertModel<typeof usageLogs>
export type BrandSizeChart = InferSelectModel<typeof brandSizeCharts>
export type GarmentMapping = InferSelectModel<typeof garmentMappings>
export type AnthropometricAnchor = InferSelectModel<typeof anthropometricAnchors>
export type ConversionEvent = InferSelectModel<typeof conversionEvents>
export type WidgetConfig = InferSelectModel<typeof widgetConfigs>
export type BrandRequest = InferSelectModel<typeof brandRequests>

/** v0 product writes are tshirt | polo. Other values are reserved in the CHECK. */
export type GarmentType =
  | 'tshirt'
  | 'shirt'
  | 'polo'
  | 'sweatshirt'
  | 'hoodie'
  | 'jacket'
  | 'kurta'
  | 'top'

export type ActiveGarmentType = 'tshirt' | 'polo'

export type FitType = 'slim' | 'regular' | 'oversized'

export type EaseSource = 'explicit' | 'inferred' | 'user_calibrated'

export type ConfidenceLabel = 'high' | 'medium' | 'low'

export interface MerchantKVRecord {
  org_id: string
  shop: string
  plan_tier: PlanTier
  widget_active: boolean
  api_key: string
  trial_requests_remaining: number
}

export interface ProductMappingKVRecord {
  garment_type: string
  fit_type: FitType
  is_active: boolean
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
