import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('fails closed when the internal admin secret is unavailable', async () => {
  const response = await exports.default.fetch(
    new Request('https://worker.test/v1/admin/usage?org_id=org-1'),
  )

  expect(response.status).toBe(503)
  await expect(response.json()).resolves.toMatchObject({ error: 'Service Unavailable' })
})
