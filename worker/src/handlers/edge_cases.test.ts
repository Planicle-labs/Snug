import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, beforeEach } from 'vitest'

describe('Edge Cases and Defect Prevention Tests', () => {
  const orgId = 'org-edge-cases'
  const shop = 'edge-cases-store.myshopify.com'
  const apiKey = 'snug-edge-key-12345'
  const validProductId = '7766554433'
  const internalSecret = env.INTERNAL_ADMIN_SECRET || 'test-edge-internal-secret'

  beforeEach(async () => {
    // Basic valid auth
    await env.KV.put(`apikey:${apiKey}`, JSON.stringify({
      org_id: orgId,
      shop: shop,
      plan_tier: 'trial',
      trial_requests_remaining: 100,
      widget_active: true,
    }))

    await env.KV.put(`shop:${shop}`, JSON.stringify({
      org_id: orgId,
      api_key: apiKey,
    }))

    // Valid mapping
    await env.KV.put(`merchant:${orgId}:mappings`, JSON.stringify({
      [validProductId]: {
        garment_type: 'tshirt',
        fit_type: 'regular',
        is_active: true,
      },
    }))

    // Valid merchant chart
    await env.KV.put(`chart:${orgId}:tshirt:regular`, JSON.stringify([
      {
        size_label: 'S',
        fit_type: 'regular',
        chest_min_cm: 90,
        chest_max_cm: 96,
        length_min_cm: 68,
        length_max_cm: 70,
        shoulder_min_cm: 42,
        shoulder_max_cm: 44,
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'M',
        fit_type: 'regular',
        chest_min_cm: 98,
        chest_max_cm: 104,
        length_min_cm: 70,
        length_max_cm: 72,
        shoulder_min_cm: 44,
        shoulder_max_cm: 46,
        guide_gender: 'men',
        show_size_guide: true,
      },
    ]))

    // Valid reference brand chart
    await env.KV.put('brand:zara:tshirt:regular', JSON.stringify([
      { size_label: 'S', fit_type: 'regular', chest_min_cm: 88, chest_max_cm: 92 },
      { size_label: 'M', fit_type: 'regular', chest_min_cm: 94, chest_max_cm: 98 },
      { size_label: 'L', fit_type: 'regular', chest_min_cm: 100, chest_max_cm: 104 },
    ]))
  })

  describe('Malformed Payloads to /v1/recommend and /v1/size', () => {
    it('returns 400 Bad Request when request body is not valid JSON', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: 'invalid-non-json-string',
      }))

      expect(res.status).toBe(400)
      const data = await res.json() as any
      expect(data.error).toBe('Bad Request')
    })

    it('returns 400 Bad Request when required fields are missing or empty', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: '', // empty
          ref_size: 'M',
          shopify_product_id: validProductId,
        }),
      }))

      expect(res.status).toBe(400)
    })

    it('returns 400 Bad Request when fit_intent is an invalid enum value', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: validProductId,
          fit_intent: 'super_baggy', // invalid
        }),
      }))

      expect(res.status).toBe(400)
    })

    it('returns 400 Bad Request when ref_fit is an invalid enum value', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: validProductId,
          ref_fit: 'extra_slim_tight', // invalid
        }),
      }))

      expect(res.status).toBe(400)
    })
  })

  describe('Missing or Unmapped Entities (404 Handling)', () => {
    it('returns 404 when product is not mapped in merchant configuration', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: 'unmapped-product-1234',
        }),
      }))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.error).toBe('Not Found')
      expect(data.message).toContain('not mapped to an active merchant size chart')
    })

    it('returns 404 when reference brand chart is not found in KV', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'unknown-brand-xyz',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: validProductId,
        }),
      }))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.message).toContain("Reference brand size chart 'unknown-brand-xyz'")
    })

    it('returns 404 when reference size label does not exist in brand chart', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'XXXXL', // Zara chart only has S, M, L
          shopify_product_id: validProductId,
        }),
      }))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.message).toContain("Size 'XXXXL' for brand 'zara'")
    })

    it('returns 404 when merchant target size chart does not exist', async () => {
      // Map product to a garment/fit that has no chart in KV
      await env.KV.put(`merchant:${orgId}:mappings`, JSON.stringify({
        'missing-chart-prod': {
          garment_type: 'hoodie',
          fit_type: 'oversized',
          is_active: true,
        },
      }))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: 'missing-chart-prod',
        }),
      }))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.message).toContain("Merchant size chart for 'hoodie' (oversized) was not found")
    })
  })

  describe('Non-standard and Malformed Chart Data (422 Handling)', () => {
    it('returns 422 when merchant size chart contains negative or zero measurements', async () => {
      const badChartOrg = 'org-bad-chart'
      const badKey = 'key-bad-chart-1'

      await env.KV.put(`apikey:${badKey}`, JSON.stringify({
        org_id: badChartOrg,
        shop: 'bad-chart.myshopify.com',
        plan_tier: 'trial',
        trial_requests_remaining: 100,
        widget_active: true,
      }))

      await env.KV.put(`merchant:${badChartOrg}:mappings`, JSON.stringify({
        [validProductId]: { garment_type: 'tshirt', fit_type: 'regular', is_active: true },
      }))

      // Chart with negative chest
      await env.KV.put(`chart:${badChartOrg}:tshirt:regular`, JSON.stringify([
        { size_label: 'S', fit_type: 'regular', chest_min_cm: -50, chest_max_cm: -10 },
      ]))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': badKey,
          'Origin': 'https://bad-chart.myshopify.com',
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: validProductId,
        }),
      }))

      expect(res.status).toBe(422)
      const data = await res.json() as any
      expect(data.error).toBe('Unprocessable Entity')
    })

    it('returns 422 when merchant size chart contains mixed fit types', async () => {
      const mixedChartOrg = 'org-mixed-chart'
      const mixedKey = 'key-mixed-chart-1'

      await env.KV.put(`apikey:${mixedKey}`, JSON.stringify({
        org_id: mixedChartOrg,
        shop: 'mixed-chart.myshopify.com',
        plan_tier: 'trial',
        trial_requests_remaining: 100,
        widget_active: true,
      }))

      await env.KV.put(`merchant:${mixedChartOrg}:mappings`, JSON.stringify({
        [validProductId]: { garment_type: 'tshirt', fit_type: 'regular', is_active: true },
      }))

      // Mixed fit types in one chart
      await env.KV.put(`chart:${mixedChartOrg}:tshirt:regular`, JSON.stringify([
        { size_label: 'S', fit_type: 'regular', chest_min_cm: 90, chest_max_cm: 94 },
        { size_label: 'M', fit_type: 'oversized', chest_min_cm: 98, chest_max_cm: 104 },
      ]))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': mixedKey,
          'Origin': 'https://mixed-chart.myshopify.com',
        },
        body: JSON.stringify({
          ref_brand: 'zara',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: validProductId,
        }),
      }))

      expect(res.status).toBe(422)
    })
  })

  describe('Admin Usage Sync Security Edge Cases', () => {
    it('rejects invalid admin secret with 401 Unauthorized', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/admin/usage?org_id=${orgId}`, {
        headers: {
          'X-Internal-Secret': 'wrong-secret-signature',
        },
      }))

      expect(res.status).toBe(401)
      const data = await res.json() as any
      expect(data.error).toBe('Unauthorized')
    })
  })
})
