import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

const apiKey = 'key-reference-options-test'
const shop = 'reference-options-store.myshopify.com'

const validCoverage = {
  brands: [
    {
      slug: 'bewakoof',
      name: 'Bewakoof',
      garments: [
        { garment: 'polo', label: 'Polo Shirt', sizes: ['S', 'M', 'L'] },
        { garment: 'tshirt', label: 'T-Shirt / Top', sizes: ['M', 'L', 'XL'] },
      ],
    },
    {
      slug: 'snitch',
      name: 'Snitch',
      garments: [{ garment: 'tshirt', label: 'T-Shirt / Top', sizes: ['S', 'M'] }],
    },
  ],
}

describe('Reference Options Handler', () => {
  beforeEach(async () => {
    await env.KV.put(`apikey:${apiKey}`, JSON.stringify({
      org_id: 'org-reference-options-test',
      shop,
      plan_tier: 'trial',
      trial_requests_remaining: 1000,
      widget_active: true,
    }))
    await env.KV.delete('brands:coverage')
  })

  it('fails with 401 Unauthorized when api key is missing', async () => {
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/reference-options', {
        headers: { Origin: `https://${shop}` },
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when coverage has not been published', async () => {
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/reference-options', {
        headers: { 'X-Snug-Key': apiKey, Origin: `https://${shop}` },
      })
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as any
    expect(body.message).toBe('Reference options have not been published yet')
  })

  it('returns published coverage with only DB-backed combos', async () => {
    await env.KV.put('brands:coverage', JSON.stringify(validCoverage))

    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/reference-options', {
        headers: { 'X-Snug-Key': apiKey, Origin: `https://${shop}` },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const body = (await response.json()) as any
    expect(body).toEqual(validCoverage)
    expect(body.brands).toHaveLength(2)
    expect(body.brands[0].garments).toHaveLength(2)
  })

  it('returns 422 when published coverage is malformed', async () => {
    await env.KV.put('brands:coverage', JSON.stringify({ brands: [{ slug: 'bewakoof' }] }))

    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/reference-options', {
        headers: { 'X-Snug-Key': apiKey, Origin: `https://${shop}` },
      })
    )

    expect(response.status).toBe(422)
  })

  it('handles OPTIONS preflight with 204', async () => {
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/reference-options', {
        method: 'OPTIONS',
        headers: {
          Origin: `https://${shop}`,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'X-Snug-Key, X-Shop-Domain',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Shop-Domain')
  })
})
