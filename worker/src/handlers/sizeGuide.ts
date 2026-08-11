import type { Context } from 'hono'
import type { AppEnv } from '../index'
import { parseProductMappings } from '../validation'

type PublishedGuideRow = {
  size_label: string
  chest_min_cm: number
  length_min_cm: number | null
  shoulder_min_cm: number | null
  guide_gender: 'men' | 'women' | 'unisex'
  show_size_guide: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function publishedGuideRows(value: unknown): PublishedGuideRow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const rows: PublishedGuideRow[] = []
  for (const valueRow of value) {
    if (!isRecord(valueRow) || valueRow.show_size_guide !== true) continue
    const size = valueRow.size_label
    const chest = valueRow.chest_min_cm
    const length = valueRow.length_min_cm
    const shoulder = valueRow.shoulder_min_cm
    const gender = valueRow.guide_gender

    if (typeof size !== 'string' || !size.trim() || typeof chest !== 'number' || !Number.isFinite(chest)) return null
    if (length !== null && length !== undefined && (typeof length !== 'number' || !Number.isFinite(length))) return null
    if (shoulder !== null && shoulder !== undefined && (typeof shoulder !== 'number' || !Number.isFinite(shoulder))) return null
    if (gender !== 'men' && gender !== 'women' && gender !== 'unisex') return null

    rows.push({
      size_label: size.trim(),
      chest_min_cm: chest,
      length_min_cm: typeof length === 'number' ? length : null,
      shoulder_min_cm: typeof shoulder === 'number' ? shoulder : null,
      guide_gender: gender,
      show_size_guide: true,
    })
  }

  return rows.length ? rows : null
}

function guideTitle(gender: PublishedGuideRow['guide_gender'], garmentType: string) {
  const genderLabel = gender === 'men' ? 'Men’s' : gender === 'women' ? 'Women’s' : 'Unisex'
  const garmentLabel = garmentType === 'tshirt' ? 'T-shirt' : garmentType.replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
  return `${genderLabel} ${garmentLabel}`
}

/** Returns published size-guide measurements for one mapped storefront product. */
export async function handleSizeGuideLookup(ctx: Context<AppEnv>) {
  const productId = ctx.req.param('product_id')?.trim()
  if (!productId || productId.length > 128) {
    return ctx.json({ error: 'Bad Request', message: 'Missing or invalid product_id parameter' }, 400)
  }

  const mappingsRaw = await ctx.env.KV.get(`merchant:${ctx.var.org.org_id}:mappings`, 'json')
  const mappings = parseProductMappings(mappingsRaw)
  const mapping = mappings?.[productId]
  if (!mapping || !mapping.is_active) return ctx.json({ enabled: false }, 200)

  const chartRaw = await ctx.env.KV.get(`chart:${ctx.var.org.org_id}:${mapping.garment_type}`, 'json')
  const rows = publishedGuideRows(chartRaw)
  if (!rows) return ctx.json({ enabled: false }, 200)

  const gender = rows[0].guide_gender
  return ctx.json({
    enabled: true,
    title: guideTitle(gender, mapping.garment_type),
    unit: 'cm',
    rows: rows.map((row) => ({
      size: row.size_label,
      chest: row.chest_min_cm,
      length: row.length_min_cm,
      shoulder: row.shoulder_min_cm,
    })),
  }, 200)
}
