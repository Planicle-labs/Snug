import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { Actions } from './UsageCounter'

async function counterRequest(orgId: string, initialUsageRemaining = 2) {
  const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName(orgId))
  const response = await counter.fetch('http://usage-counter/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: Actions.check_and_decrement_trial,
      org_id: orgId,
      plan_tier: 'trial',
      initial_usage_remaining: initialUsageRemaining,
    }),
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('UsageCounter', () => {
  it('initializes from the supplied authoritative allowance and decrements atomically', async () => {
    const first = await counterRequest('first-use', 2)
    const second = await counterRequest('first-use', 999)

    expect(first.response.status).toBe(200)
    expect(first.body).toMatchObject({ allowed: true, usage_remaining: 1 })
    expect(second.body).toMatchObject({ allowed: true, usage_remaining: 0, trial_exhausted: true })
  })

  it('returns an exhausted decision instead of throwing when no quota remains', async () => {
    await counterRequest('exhausted', 1)
    const exhausted = await counterRequest('exhausted', 999)

    expect(exhausted.response.status).toBe(200)
    expect(exhausted.body).toMatchObject({
      allowed: false,
      usage_remaining: 0,
      trial_exhausted: true,
    })
  })

  it('does not create a default counter for an admin-style usage lookup', async () => {
    const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName('not-initialized'))
    const response = await counter.fetch('http://usage-counter/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: Actions.get_current_usage, org_id: 'not-initialized' }),
    })

    expect(await response.json()).toMatchObject({ initialized: false, usage_remaining: null })
  })
})
