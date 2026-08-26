import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { Actions } from './UsageCounter'

async function callCounter(orgId: string, payload: Record<string, unknown>) {
  const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName(orgId))
  const response = await counter.fetch('http://usage-counter/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id: orgId, ...payload }),
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('Durable Objects Quota Enforcement and Lifecycle', () => {
  it('records initial trial allowance and decrements atomically', async () => {
    const orgId = 'do-test-atomic-dec'
    const step1 = await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 3,
      plan_tier: 'trial',
    })

    expect(step1.response.status).toBe(200)
    expect(step1.body).toMatchObject({
      allowed: true,
      usage_remaining: 2,
      trial_exhausted: false,
    })

    const step2 = await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 999, // Should NOT override existing balance
    })

    expect(step2.body).toMatchObject({
      allowed: true,
      usage_remaining: 1,
      trial_exhausted: false,
    })

    const step3 = await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 999,
    })

    expect(step3.body).toMatchObject({
      allowed: true,
      usage_remaining: 0,
      trial_exhausted: true,
    })

    // 4th call when exhausted -> allowed: false
    const step4 = await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 999,
    })

    expect(step4.body).toMatchObject({
      allowed: false,
      usage_remaining: 0,
      trial_exhausted: true,
    })
  })

  it('triggers milestone_crossed at 100-step boundaries', async () => {
    const orgId = 'do-test-milestone'
    // Starting at 101 -> decrementing to 100 should cross milestone
    const res = await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 101,
      plan_tier: 'trial',
    })

    expect(res.body).toMatchObject({
      allowed: true,
      usage_remaining: 100,
      milestone_crossed: true,
      checkpoint_value: 100,
    })
  })

  it('records conversions for initialized orgs', async () => {
    const orgId = 'do-test-conversions'
    // First initialize
    await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 100,
    })

    // Record conversion
    const conv1 = await callCounter(orgId, { action: Actions.record_conversion })
    expect(conv1.response.status).toBe(200)
    expect(conv1.body).toMatchObject({ success: true, monthly_conversions: 1 })

    const conv2 = await callCounter(orgId, { action: Actions.record_conversion })
    expect(conv2.body).toMatchObject({ success: true, monthly_conversions: 2 })

    const stats = await callCounter(orgId, { action: Actions.get_current_usage })
    expect(stats.body).toMatchObject({
      initialized: true,
      monthly_conversions: 2,
      usage_remaining: 99,
    })
  })

  it('handles upgrade action and sets new plan tier and usage quota', async () => {
    const orgId = 'do-test-upgrade'
    // Start as trial with 1 remaining
    await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 1,
      plan_tier: 'trial',
    })

    // Upgrade to starter
    const upgradeRes = await callCounter(orgId, {
      action: Actions.upgrade,
      plan_tier: 'starter',
      usage_remaining: 3000,
    })

    expect(upgradeRes.response.status).toBe(200)
    expect(upgradeRes.body).toMatchObject({
      success: true,
      plan_tier: 'starter',
      usage_remaining: 3000,
    })

    const checkRes = await callCounter(orgId, { action: Actions.get_current_usage })
    expect(checkRes.body).toMatchObject({
      initialized: true,
      plan_tier: 'starter',
      usage_remaining: 3000,
    })
  })

  it('resets billing period resetting monthly_conversions to 0', async () => {
    const orgId = 'do-test-reset-billing'
    await callCounter(orgId, {
      action: Actions.check_and_decrement_trial,
      initial_usage_remaining: 50,
    })
    await callCounter(orgId, { action: Actions.record_conversion })

    const resetRes = await callCounter(orgId, {
      action: Actions.reset_billing_period,
      usage_remaining: 3000,
      plan_tier: 'starter',
    })

    expect(resetRes.response.status).toBe(200)
    expect(resetRes.body).toMatchObject({
      success: true,
      usage_remaining: 3000,
    })

    const stats = await callCounter(orgId, { action: Actions.get_current_usage })
    expect(stats.body).toMatchObject({
      usage_remaining: 3000,
      monthly_conversions: 0,
      plan_tier: 'starter',
    })
  })

  it('rejects invalid action requests with 400', async () => {
    const orgId = 'do-test-invalid'
    const res = await callCounter(orgId, {
      action: 'invalid_action_xyz',
    })

    expect(res.response.status).toBe(400)
  })
})
