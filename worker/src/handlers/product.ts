import type { Context } from 'hono'
import type { AppEnv } from '../index'
import { parseProductMappings } from '../validation'

export async function handleProductMappingLookup(ctx: Context<AppEnv>) {
  const productId = ctx.req.param('product_id')?.trim()
  if (!productId || productId.length > 128) {
    return ctx.json({ error: 'Bad Request', message: 'Missing or invalid product_id parameter' }, 400)
  }

  const mappingsRaw = await ctx.env.KV.get(`merchant:${ctx.var.org.org_id}:mappings`, 'json')
  if (mappingsRaw === null) {
    return ctx.json({ mapped: false, shopify_product_id: productId }, 200)
  }

  const mappings = parseProductMappings(mappingsRaw)
  if (!mappings) {
    return ctx.json({ error: 'Unprocessable Entity', message: 'Merchant product mappings are malformed; refresh the configuration' }, 422)
  }

  const mapping = mappings[productId]
  if (!mapping) return ctx.json({ mapped: false, shopify_product_id: productId }, 200)

  return ctx.json({
    mapped: true,
    shopify_product_id: productId,
    garment_type: mapping.garment_type,
    is_active: mapping.is_active,
  }, 200)
}
