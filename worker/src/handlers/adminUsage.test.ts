import { env, exports } from 'cloudflare:workers'
import { expect, it, describe } from 'vitest'

describe('Admin Usage Sync Handler', () => {
  it('fails with 401 Unauthorized when the internal admin secret is missing or invalid', async () => {
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/admin/usage?org_id=org-1'),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('fetches usage stats with valid internal secret', async () => {
    const secret = env.INTERNAL_ADMIN_SECRET || 'test-admin-secret-key'
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/admin/usage?org_id=org-test-1', {
        headers: {
          'X-Internal-Secret': secret,
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      initialized: false,
      usage_remaining: null,
      monthly_conversions: 0,
      plan_tier: 'trial',
    })
  })
})

