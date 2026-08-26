import { createMiddleware } from 'hono/factory'
import { parseMerchantKVRecord } from '../validation'

function originMatchesShop(origin: string | undefined, shop: string): boolean {
  if (!origin) return true // Allow direct server-to-server calls without browser Origin header
  try {
    const url = new URL(origin)
    const hostname = url.hostname.toLowerCase()
    const shopLower = shop.toLowerCase()
    if (hostname === shopLower) return true
    if (hostname.endsWith('.myshopify.com') && shopLower.endsWith('.myshopify.com')) {
      if (hostname.split('.')[0] === shopLower.split('.')[0]) return true
    }
    if (hostname === 'admin.shopify.com' || hostname === 'localhost' || hostname === '127.0.0.1') {
      return true
    }
    return false
  } catch {
    return false
  }
}

export const authMiddleware = createMiddleware(async (ctx, next) => {
  const apiKey = ctx.req.header('X-Snug-Key')?.trim()

  if (!apiKey || apiKey.length > 512) {
    return ctx.json({ error: 'Unauthorized', message: 'Missing or invalid API key' }, 401)
  }

  const recordRaw = await ctx.env.KV.get(`apikey:${apiKey}`, 'json')
  const record = parseMerchantKVRecord(recordRaw)

  if (!record) {
    return ctx.json({ error: 'Unauthorized', message: 'Invalid API key' }, 401)
  }

  if (!record.widget_active) {
    return ctx.json({ error: 'Forbidden', message: 'Widget is inactive' }, 403)
  }

  const origin = ctx.req.header('Origin')
  if (origin && !originMatchesShop(origin, record.shop)) {
    return ctx.json({ error: 'Unauthorized', message: 'Origin domain mismatch' }, 401)
  }

  // The DO is the quota authority. KV provides starting allowance on first init.
  ctx.set('org', record)
  await next()
})

