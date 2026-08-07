const DEFAULT_TRIAL_LIMIT = 1000
const MAX_STARTING_ALLOWANCE = 1_000_000
const MILESTONE_STEP = 100

export enum Actions {
  check_and_decrement_trial = 'check_and_decrement_trial',
  record_conversion = 'record_conversion',
  get_current_usage = 'get_current_usage',
  upgrade = 'upgrade',
  reset_billing_period = 'reset_billing_period',
}

type PlanTier = 'trial' | 'paid'

interface UsageRequestBody {
  action: Actions | string
  org_id: string
  plan_tier?: PlanTier
  usage_remaining?: number
  initial_usage_remaining?: number
}

type UsageRow = Record<string, string | number> & {
  usage_remaining: number
  monthly_conversions: number
  plan_tier: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRequestBody(value: unknown): UsageRequestBody | null {
  if (!isRecord(value) || typeof value.action !== 'string' || typeof value.org_id !== 'string') return null
  const orgId = value.org_id.trim()
  if (!orgId || orgId.length > 128) return null

  const validAllowance = (allowance: unknown): allowance is number | undefined =>
    allowance === undefined || (typeof allowance === 'number' && Number.isSafeInteger(allowance) && allowance >= 0 && allowance <= MAX_STARTING_ALLOWANCE)

  if (!validAllowance(value.usage_remaining) || !validAllowance(value.initial_usage_remaining)) return null
  if (value.plan_tier !== undefined && value.plan_tier !== 'trial' && value.plan_tier !== 'paid') return null

  const usageRemaining = value.usage_remaining
  const initialUsageRemaining = value.initial_usage_remaining
  return {
    action: value.action,
    org_id: orgId,
    ...(value.plan_tier ? { plan_tier: value.plan_tier } : {}),
    ...(usageRemaining !== undefined ? { usage_remaining: usageRemaining } : {}),
    ...(initialUsageRemaining !== undefined ? { initial_usage_remaining: initialUsageRemaining } : {}),
  }
}

export class UsageCounter {
  private readonly sql: SqlStorage

  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        org_id TEXT PRIMARY KEY,
        plan_tier TEXT NOT NULL DEFAULT 'trial',
        usage_remaining INTEGER NOT NULL DEFAULT 1000,
        monthly_conversions INTEGER NOT NULL DEFAULT 0,
        billing_start TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const body = parseRequestBody(await request.json())
      if (!body) {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }

      switch (body.action) {
        case Actions.check_and_decrement_trial:
          return this.checkAndDecrementTrial(body)
        case Actions.record_conversion:
          return this.recordConversion(body)
        case Actions.get_current_usage:
          return this.getCurrentUsage(body)
        case Actions.reset_billing_period:
          return this.resetBillingPeriod(body)
        case Actions.upgrade:
          return this.upgrade(body)
        default:
          return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'usage_counter_error', message: errorMessage(error) }))
      return Response.json({ error: 'Internal Durable Object error' }, { status: 500 })
    }
  }

  private checkAndDecrementTrial(body: UsageRequestBody): Response {
    // The Worker passes the organization’s persisted allowance exactly once.
    // INSERT ... ON CONFLICT makes first use and concurrent retries safe without
    // ever overwriting an existing Durable Object balance from stale KV data.
    if (body.initial_usage_remaining === undefined) {
      return Response.json({ error: 'initial_usage_remaining is required' }, { status: 400 })
    }

    this.sql.exec(
      `INSERT INTO usage (org_id, plan_tier, usage_remaining, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO NOTHING`,
      body.org_id,
      body.plan_tier ?? 'trial',
      body.initial_usage_remaining,
    )

    const row = this.sql.exec<{ usage_remaining: number }>(
      `UPDATE usage
       SET usage_remaining = usage_remaining - 1, updated_at = datetime('now')
       WHERE org_id = ? AND plan_tier = 'trial' AND usage_remaining > 0
       RETURNING usage_remaining`,
      body.org_id,
    ).toArray()[0]

    if (!row) {
      const existing = this.sql.exec<{ usage_remaining: number; plan_tier: string }>(
        'SELECT usage_remaining, plan_tier FROM usage WHERE org_id = ?',
        body.org_id,
      ).toArray()[0]

      if (!existing) {
        return Response.json({ error: 'Usage row was not initialized' }, { status: 500 })
      }

      return Response.json({
        allowed: existing.plan_tier === 'paid',
        usage_remaining: existing.usage_remaining,
        trial_exhausted: existing.plan_tier === 'trial' && existing.usage_remaining <= 0,
        milestone_crossed: false,
        checkpoint_value: null,
      })
    }

    const milestoneCrossed = row.usage_remaining % MILESTONE_STEP === 0
    return Response.json({
      allowed: true,
      usage_remaining: row.usage_remaining,
      trial_exhausted: row.usage_remaining === 0,
      milestone_crossed: milestoneCrossed,
      checkpoint_value: milestoneCrossed ? row.usage_remaining : null,
    })
  }

  private recordConversion(body: UsageRequestBody): Response {
    const row = this.sql.exec<{ monthly_conversions: number }>(
      `UPDATE usage
       SET monthly_conversions = monthly_conversions + 1, updated_at = datetime('now')
       WHERE org_id = ?
       RETURNING monthly_conversions`,
      body.org_id,
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Usage counter has not been initialized' }, { status: 409 })
    }

    return Response.json({ success: true, monthly_conversions: row.monthly_conversions })
  }

  private getCurrentUsage(body: UsageRequestBody): Response {
    const row = this.sql.exec<UsageRow>(
      'SELECT usage_remaining, monthly_conversions, plan_tier FROM usage WHERE org_id = ?',
      body.org_id,
    ).toArray()[0]

    if (!row) {
      return Response.json({ initialized: false, usage_remaining: null, monthly_conversions: 0, plan_tier: body.plan_tier ?? 'trial' })
    }

    return Response.json({
      initialized: true,
      allowed: row.plan_tier === 'paid' || row.usage_remaining > 0,
      usage_remaining: row.usage_remaining,
      monthly_conversions: row.monthly_conversions,
      plan_tier: row.plan_tier,
    })
  }

  private resetBillingPeriod(body: UsageRequestBody): Response {
    const targetUsage = body.usage_remaining ?? DEFAULT_TRIAL_LIMIT
    this.sql.exec(
      `INSERT INTO usage (org_id, plan_tier, usage_remaining, monthly_conversions, billing_start, updated_at)
       VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         usage_remaining = excluded.usage_remaining,
         monthly_conversions = 0,
         billing_start = datetime('now'),
         updated_at = datetime('now')`,
      body.org_id,
      body.plan_tier ?? 'trial',
      targetUsage,
    )
    return Response.json({ success: true, usage_remaining: targetUsage })
  }

  private upgrade(body: UsageRequestBody): Response {
    const planTier = body.plan_tier ?? 'paid'
    const usageRemaining = body.usage_remaining ?? 10_000
    this.sql.exec(
      `INSERT INTO usage (org_id, plan_tier, usage_remaining, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         plan_tier = excluded.plan_tier,
         usage_remaining = excluded.usage_remaining,
         updated_at = datetime('now')`,
      body.org_id,
      planTier,
      usageRemaining,
    )
    return Response.json({ success: true, plan_tier: planTier, usage_remaining: usageRemaining })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
