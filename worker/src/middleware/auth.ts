import { createMiddleware } from 'hono/factory'
import { parseMerchantKVRecord } from '../validation'

function originMatchesShop(origin: string | undefined, shop: string): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === shop
  } catch {
    return false
  }
}

export const authMiddleware = createMiddleware(async (ctx, next) => {
  const apiKey = ctx.req.header('X-Snug-Key')?.trim()
  if (!apiKey || apiKey.length > 512) {
    return ctx.json({ error: 'Unauthorized', message: 'Missing API key' }, 401)
  }

  const recordRaw = await ctx.env.KV.get(`apikey:${apiKey}`, 'json')
  const record = parseMerchantKVRecord(recordRaw)
  if (!record) {
    return ctx.json({ error: 'Unauthorized', message: 'Invalid API key' }, 401)
  }

  if (!record.widget_active) {
    return ctx.json({ error: 'Forbidden', message: 'Widget is inactive' }, 403)
  }

  // Origin protects browser behaviour and CORS only. It is not used as proof
  // of identity: a non-browser client can forge it, which is tracked in W-05.
  if (!originMatchesShop(ctx.req.header('Origin'), record.shop)) {
    return ctx.json({ error: 'Unauthorized', message: 'Origin domain mismatch' }, 401)
  }

  // The DO is the quota authority. KV can be stale, so it only supplies the
  // authoritative starting allowance when this organization is first initialized.
  ctx.set('org', record)
  await next()
})
