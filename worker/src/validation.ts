import type { FitIntent, FitType, RefSizeRow, TargetSizeRow } from './algorithm/types'
import type { MerchantKVRecord, PredictRequestBody, ProductMappingKVRecord } from './types'

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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Accept null/missing as null; reject non-finite numbers as invalid (undefined). */
function nullableMeasurement(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  return finiteNumber(value) ?? undefined
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
  const chestMin = finiteNumber(value.chest_min_cm)
  const chestMax = finiteNumber(value.chest_max_cm)
  const shoulderMin = nullableMeasurement(value.shoulder_min_cm)
  const shoulderMax = nullableMeasurement(value.shoulder_max_cm)
  const lengthMin = nullableMeasurement(value.length_min_cm)
  const lengthMax = nullableMeasurement(value.length_max_cm)

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
  const planTier = value.plan_tier === 'trial' || value.plan_tier === 'paid' ? value.plan_tier : null
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
  const productId = nonEmptyString(value.shopify_product_id, 128)
  const fitIntent = parseFitIntent(value.fit_intent)

  // fit_intent is optional; only reject when present but invalid
  if (fitIntent === null) return null

  return refBrand && refGarment && refSize && productId
    ? {
        ref_brand: refBrand.toLowerCase(),
        ref_garment: refGarment.toLowerCase(),
        ref_size: refSize.toUpperCase(),
        shopify_product_id: productId,
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
    if (!garmentType || typeof mapping.is_active !== 'boolean') return null
    mappings[productId] = { garment_type: garmentType.toLowerCase(), is_active: mapping.is_active }
  }
  return mappings
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
