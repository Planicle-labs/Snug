import type { Context } from 'hono'
import type { AppEnv } from '../index'
import { parseProductMappings } from '../validation'

export async function handleProductMappingLookup(ctx: Context<AppEnv>) {
  const paramOrQuery = ctx.req.param('product_id') || ctx.req.param('id') || ctx.req.query('product_id') || ctx.req.query('shopify_product_id') || ctx.req.query('id') || ''
  let rawId = paramOrQuery.trim()
  try {
    rawId = decodeURIComponent(rawId).trim()
  } catch {
    // Keep rawId if malformed percent encoding
  }

  if (!rawId || rawId.length > 128) {
    return ctx.json({ error: 'Bad Request', message: 'Missing or invalid product_id parameter' }, 400)
  }

  const mappingsRaw = await ctx.env.KV.get(`merchant:${ctx.var.org.org_id}:mappings`, 'json')
  if (mappingsRaw === null) {
    return ctx.json({ mapped: false, shopify_product_id: rawId }, 200)
  }

  const mappings = parseProductMappings(mappingsRaw)
  if (!mappings) {
    return ctx.json({ error: 'Unprocessable Entity', message: 'Merchant product mappings are malformed; refresh the configuration' }, 422)
  }

  const cleanId = rawId.replace(/^gid:\/\/shopify\/Product\//, '')
  const mapping = mappings[rawId] || mappings[cleanId] || mappings[`gid://shopify/Product/${cleanId}`]
  if (!mapping) return ctx.json({ mapped: false, shopify_product_id: rawId }, 200)

  return ctx.json({
    mapped: true,
    shopify_product_id: rawId,
    garment_type: mapping.garment_type,
    fit_type: mapping.fit_type,
    is_active: mapping.is_active,
  }, 200)
}
