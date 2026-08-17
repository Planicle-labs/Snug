import { Actions } from '../durable-objects/UsageCounter'
import type { MerchantKVRecord } from '../types'
import { syncTrialUsage } from '../persistence'

export interface QuotaDecision {
  allowed: boolean
  usageRemaining: number | null
  milestoneCrossed: boolean
}

interface CounterResponse {
  allowed: boolean
  usage_remaining: number
  milestone_crossed: boolean
}

function isCounterResponse(value: unknown): value is CounterResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.allowed === 'boolean' &&
    typeof record.usage_remaining === 'number' && Number.isSafeInteger(record.usage_remaining) &&
    typeof record.milestone_crossed === 'boolean'
}

/**
 * Debits a trial only after the caller has produced a valid recommendation.
 * A DO serializes this state transition for a single organization.
 */
export async function consumeTrialQuota(env: Env, org: MerchantKVRecord): Promise<QuotaDecision> {
  const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName(org.org_id))
  const response = await counter.fetch('http://usage-counter/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: Actions.check_and_decrement_trial,
      org_id: org.org_id,
      plan_tier: org.plan_tier,
      initial_usage_remaining: org.trial_requests_remaining,
    }),
  })

  if (!response.ok) {
    throw new Error(`Usage counter returned ${response.status}`)
  }

  const result: unknown = await response.json()
  if (!isCounterResponse(result)) {
    throw new Error('Usage counter returned an invalid response')
  }

  return {
    allowed: result.allowed,
    usageRemaining: result.usage_remaining,
    milestoneCrossed: result.milestone_crossed,
  }
}

export function checkpointTrialUsage(env: Env, orgId: string, quota: QuotaDecision): Promise<void> | null {
  return quota.milestoneCrossed && quota.usageRemaining !== null
    ? syncTrialUsage(env.USAGE_SYNC_DATABASE_URL, orgId, quota.usageRemaining)
    : null
}
