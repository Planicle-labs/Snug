import type { FitIntent, FitType, RefSizeRow, TargetSizeRow } from './algorithm/types'
import { isPlanTier, type MerchantKVRecord, type PredictRequestBody, type ProductMappingKVRecord, type ReferenceCoverage } from './types'

const FIT_TYPES = new Set<FitType>(['slim', 'regular', 'relaxed', 'oversized'])
const FIT_INTENTS = new Set<FitIntent>(['true_silhouette', 'fitted'])
const MAX_TEXT_LENGTH = 160

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Accept null/missing as null; reject non-finite or non-positive numbers as invalid (undefined). */
function nullablePositiveMeasurement(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  return positiveFiniteNumber(value) ?? undefined
}

function parseFitType(value: unknown): FitType | null {
  return typeof value === 'string' && FIT_TYPES.has(value as FitType)
    ? value as FitType
    : null
}

function parseFitIntent(value: unknown): FitIntent | null | undefined {
  if (value === null || value === undefined) return undefined
  return typeof value === 'string' && FIT_INTENTS.has(value as FitIntent)
    ? value as FitIntent
    : null
}

interface MeasurementFields {
  size_label: string
  chest_min_cm: number
  chest_max_cm: number
  shoulder_min_cm: number | null
  shoulder_max_cm: number | null
  length_min_cm: number | null
  length_max_cm: number | null
}

/**
 * Shared garment measurement parsing.
 * Ease is intentionally not required — the engine infers it from fit_type via TSHIRT_EASE.
 * Extra KV fields (ease_value_cm, ease_source) are ignored for backward compatibility.
 */
function parseMeasurementFields(value: unknown): MeasurementFields | null {
  if (!isRecord(value)) return null

  const sizeLabel = nonEmptyString(value.size_label, 24)
  const chestMin = positiveFiniteNumber(value.chest_min_cm)
  const chestMax = positiveFiniteNumber(value.chest_max_cm)
  const shoulderMin = nullablePositiveMeasurement(value.shoulder_min_cm)
  const shoulderMax = nullablePositiveMeasurement(value.shoulder_max_cm)
  const lengthMin = nullablePositiveMeasurement(value.length_min_cm)
  const lengthMax = nullablePositiveMeasurement(value.length_max_cm)

  if (
    !sizeLabel || chestMin === null || chestMax === null ||
    shoulderMin === undefined || shoulderMax === undefined ||
    lengthMin === undefined || lengthMax === undefined ||
    chestMin > chestMax ||
    (shoulderMin !== null && shoulderMax !== null && shoulderMin > shoulderMax) ||
    (lengthMin !== null && lengthMax !== null && lengthMin > lengthMax)
  ) {
    return null
  }

  return {
    size_label: sizeLabel,
    chest_min_cm: chestMin,
    chest_max_cm: chestMax,
    shoulder_min_cm: shoulderMin,
    shoulder_max_cm: shoulderMax,
    length_min_cm: lengthMin,
    length_max_cm: lengthMax,
  }
}

function parseRefSizeRow(value: unknown): RefSizeRow | null {
  if (!isRecord(value)) return null
  const measurements = parseMeasurementFields(value)
  const fitType = parseFitType(value.fit_type)
  if (!measurements || !fitType) return null

  return {
    ...measurements,
    fit_type: fitType,
  }
}

function parseTargetSizeRow(value: unknown): { row: TargetSizeRow; fitType: FitType } | null {
  if (!isRecord(value)) return null
  const measurements = parseMeasurementFields(value)
  const fitType = parseFitType(value.fit_type)
  if (!measurements || !fitType) return null

  // TargetSizeRow is garment measurements only; fit type is chart-level for the engine.
  return { row: measurements, fitType }
}

/** Sort S → XL by garment chest midpoint so boundary adjacency uses real neighbours. */
export function sortChartByChestMid<T extends { chest_min_cm: number; chest_max_cm: number }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => (a.chest_min_cm + a.chest_max_cm) / 2 - (b.chest_min_cm + b.chest_max_cm) / 2,
  )
}

export function parseMerchantKVRecord(value: unknown): MerchantKVRecord | null {
  if (!isRecord(value)) return null

  const orgId = nonEmptyString(value.org_id, 128)
  const shop = nonEmptyString(value.shop, 253)?.toLowerCase()
  const planTier = isPlanTier(value.plan_tier) ? value.plan_tier : null
  const remaining = value.trial_requests_remaining

  if (!orgId || !shop || !planTier || typeof remaining !== 'number' || !Number.isSafeInteger(remaining) || remaining < 0 || typeof value.widget_active !== 'boolean') {
    return null
  }

  return {
    org_id: orgId,
    shop,
    plan_tier: planTier,
    trial_requests_remaining: remaining,
    widget_active: value.widget_active,
  }
}

export function parsePredictRequest(value: unknown): PredictRequestBody | null {
  if (!isRecord(value)) return null

  const refBrand = nonEmptyString(value.ref_brand)
  const refGarment = nonEmptyString(value.ref_garment)
  const refSize = nonEmptyString(value.ref_size, 24)
  const productId = nonEmptyString(value.shopify_product_id, 128) ?? nonEmptyString(value.product_id, 128)
  const fitIntent = parseFitIntent(value.fit_intent)
  const refFit = value.ref_fit === undefined || value.ref_fit === null
    ? undefined
    : parseFitType(value.ref_fit)

  if (fitIntent === null || refFit === null) return null

  return refBrand && refGarment && refSize && productId
    ? {
        ref_brand: refBrand.toLowerCase(),
        ref_garment: refGarment.toLowerCase(),
        ref_size: refSize.toUpperCase(),
        shopify_product_id: productId,
        ...(refFit !== undefined ? { ref_fit: refFit } : {}),
        ...(fitIntent !== undefined ? { fit_intent: fitIntent } : {}),
      }
    : null
}

export function parseProductMappings(value: unknown): Record<string, ProductMappingKVRecord> | null {
  if (!isRecord(value)) return null

  const mappings: Record<string, ProductMappingKVRecord> = {}
  for (const [productId, mapping] of Object.entries(value)) {
    if (!isRecord(mapping)) return null
    const garmentType = nonEmptyString(mapping.garment_type, 64)
    const fitType = parseFitType(mapping.fit_type)
    if (!garmentType || !fitType || typeof mapping.is_active !== 'boolean') return null
    mappings[productId] = {
      garment_type: garmentType.toLowerCase(),
      fit_type: fitType,
      is_active: mapping.is_active,
    }
  }
  return mappings
}

/**
 * Reference coverage published under `brands:coverage`. Only combos present
 * here may be offered by the storefront widget; anything else 404s in /v1/size.
 */
export function parseReferenceCoverage(value: unknown): ReferenceCoverage | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.brands) || value.brands.length === 0 || value.brands.length > 200) return null

  const brands: ReferenceCoverage['brands'] = []
  for (const brand of value.brands) {
    if (!isRecord(brand)) return null
    const slug = nonEmptyString(brand.slug, 64)?.toLowerCase()
    const name = nonEmptyString(brand.name, 64)
    if (!slug || !name || !Array.isArray(brand.garments) || brand.garments.length === 0) return null

    const garments: ReferenceCoverage['brands'][number]['garments'] = []
    for (const garmentEntry of brand.garments) {
      if (!isRecord(garmentEntry)) return null
      const garment = nonEmptyString(garmentEntry.garment, 64)?.toLowerCase()
      const label = nonEmptyString(garmentEntry.label, 64)
      if (!garment || !label || !Array.isArray(garmentEntry.sizes) || garmentEntry.sizes.length === 0) return null
      const sizes: string[] = []
      for (const size of garmentEntry.sizes) {
        const sizeLabel = nonEmptyString(size, 24)?.toUpperCase()
        if (!sizeLabel) return null
        sizes.push(sizeLabel)
      }
      garments.push({ garment, label, sizes })
    }
    brands.push({ slug, name, garments })
  }
  return { brands }
}

export function parseReferenceChart(value: unknown): RefSizeRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null
  const rows = value.map((row) => parseRefSizeRow(row))
  if (!rows.every((row): row is RefSizeRow => row !== null)) return null
  return sortChartByChestMid(rows)
}

/**
 * Merchant chart: garment measurements + a single uniform fit_type across rows.
 * fit_type still arrives per-row from KV (dashboard writer); the engine takes it as targetFitType.
 */
export function parseTargetChart(value: unknown): { rows: TargetSizeRow[]; fitType: FitType } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null

  const parsed = value.map((row) => parseTargetSizeRow(row))
  if (!parsed.every((row): row is { row: TargetSizeRow; fitType: FitType } => row !== null)) {
    return null
  }

  const fitType = parsed[0].fitType
  if (!parsed.every((entry) => entry.fitType === fitType)) return null

  return {
    rows: sortChartByChestMid(parsed.map((entry) => entry.row)),
    fitType,
  }
}
