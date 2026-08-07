import type { Context } from 'hono'
import type { AppEnv } from '../index'
import { Actions } from '../durable-objects/UsageCounter'
import { syncTrialUsage } from '../persistence'
import { timingSafeSecretEqual } from '../security'

interface UsageStats {
  initialized: boolean
  usage_remaining: number | null
  monthly_conversions: number
  plan_tier: string
}

function isUsageStats(value: unknown): value is UsageStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.initialized === 'boolean' &&
    (typeof record.usage_remaining === 'number' || record.usage_remaining === null) &&
    typeof record.monthly_conversions === 'number' && typeof record.plan_tier === 'string'
}

export async function handleAdminUsageSync(ctx: Context<AppEnv>) {
  const expectedSecret = ctx.env.INTERNAL_ADMIN_SECRET?.trim()
  const suppliedSecret = ctx.req.header('X-Internal-Secret')?.trim()
  if (!expectedSecret) {
    console.error(JSON.stringify({ event: 'admin_secret_missing' }))
    return ctx.json({ error: 'Service Unavailable', message: 'Internal endpoint is not configured' }, 503)
  }
  if (!suppliedSecret || !await timingSafeSecretEqual(expectedSecret, suppliedSecret)) {
    return ctx.json({ error: 'Unauthorized', message: 'Invalid internal secret' }, 401)
  }

  const shop = ctx.req.query('shop')?.trim().toLowerCase()
  const orgIdParam = ctx.req.query('org_id')?.trim()
  let orgId = orgIdParam

  if (!orgId && shop) {
    const shopRecord = await ctx.env.KV.get(`shop:${shop}`, 'json')
    if (typeof shopRecord === 'object' && shopRecord !== null && !Array.isArray(shopRecord)) {
      const candidate = (shopRecord as Record<string, unknown>).org_id
      if (typeof candidate === 'string' && candidate.trim()) orgId = candidate.trim()
    }
  }

  if (!orgId || orgId.length > 128) {
    return ctx.json({ error: 'Bad Request', message: "Provide a valid 'shop' or 'org_id' query parameter" }, 400)
  }

  const counter = ctx.env.USAGE_COUNTER.get(ctx.env.USAGE_COUNTER.idFromName(orgId))
  const counterResponse = await counter.fetch('http://usage-counter/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: Actions.get_current_usage, org_id: orgId }),
  })
  if (!counterResponse.ok) {
    return ctx.json({ error: 'Internal Error', message: 'Failed to fetch usage statistics' }, 500)
  }

  const usageStats: unknown = await counterResponse.json()
  if (!isUsageStats(usageStats)) {
    console.error(JSON.stringify({ event: 'invalid_usage_counter_response', orgId }))
    return ctx.json({ error: 'Internal Error', message: 'Usage counter returned invalid statistics' }, 500)
  }

  if (usageStats.initialized && usageStats.usage_remaining !== null) {
    ctx.executionCtx.waitUntil(syncTrialUsage(ctx.env.USAGE_SYNC_DATABASE_URL, orgId, usageStats.usage_remaining))
  }

  return ctx.json(usageStats, 200)
}
