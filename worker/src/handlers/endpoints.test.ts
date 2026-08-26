import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, beforeEach } from 'vitest'

describe('Worker Endpoints Comprehensive Test Suite', () => {
  const orgId = 'org-endpoints-suite'
  const shop = 'endpoints-test.myshopify.com'
  const apiKey = 'key-endpoints-suite-abc'
  const productId = '8822991100'
  const internalSecret = env.INTERNAL_ADMIN_SECRET || 'test-endpoints-internal-secret'

  beforeEach(async () => {
    // 1. Auth setup in KV
    await env.KV.put(`apikey:${apiKey}`, JSON.stringify({
      org_id: orgId,
      shop: shop,
      plan_tier: 'trial',
      trial_requests_remaining: 500,
      widget_active: true,
    }))

    await env.KV.put(`shop:${shop}`, JSON.stringify({
      org_id: orgId,
      api_key: apiKey,
    }))

    // 2. Mappings setup in KV
    await env.KV.put(`merchant:${orgId}:mappings`, JSON.stringify({
      [productId]: {
        garment_type: 'tshirt',
        fit_type: 'regular',
        is_active: true,
      },
      '8822991101': {
        garment_type: 'tshirt',
        fit_type: 'slim',
        is_active: true,
      },
      '8822991102': {
        garment_type: 'tshirt',
        fit_type: 'regular',
        is_active: false, // inactive mapping
      },
    }))

    // 3. Size chart setup in KV
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
        guide_gender: 'unisex',
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
        guide_gender: 'unisex',
        show_size_guide: true,
      },
      {
        size_label: 'L',
        fit_type: 'regular',
        chest_min_cm: 106,
        chest_max_cm: 112,
        length_min_cm: 72,
        length_max_cm: 74,
        shoulder_min_cm: 46,
        shoulder_max_cm: 48,
        guide_gender: 'unisex',
        show_size_guide: true,
      },
    ]))

    // 4. Reference brand chart in KV
    await env.KV.put('brand:uniqlo:tshirt:regular', JSON.stringify([
      { size_label: 'S', fit_type: 'regular', chest_min_cm: 88, chest_max_cm: 94 },
      { size_label: 'M', fit_type: 'regular', chest_min_cm: 96, chest_max_cm: 102 },
      { size_label: 'L', fit_type: 'regular', chest_min_cm: 104, chest_max_cm: 110 },
    ]))
  })

  describe('Endpoint: GET /health', () => {
    it('returns status ok with 200', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/health'))
      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.status).toBe('ok')
    })
  })

  describe('Endpoint: GET /v1/config', () => {
    it('returns default config when no custom config exists in KV', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.position).toBe('below_add_to_cart')
      expect(data.button_text).toBe('Find Your Recommended Size')
      expect(data.button_color).toBe('#008060')
      expect(data.modal_position).toBe('center')
      expect(data.show_confidence).toBe(true)
      expect(data.show_reasoning).toBe(true)
    })

    it('returns custom widget config stored in KV with camelCase or snake_case', async () => {
      await env.KV.put(`widget_config:${orgId}`, JSON.stringify({
        position: 'above_add_to_cart',
        buttonText: 'What is my size?',
        primaryColor: '#ff4400',
        buttonTextColor: '#000000',
        modalPosition: 'drawer_right',
        showConfidence: false,
        showReasoning: false,
      }))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.position).toBe('above_add_to_cart')
      expect(data.button_text).toBe('What is my size?')
      expect(data.button_color).toBe('#ff4400')
      expect(data.button_text_color).toBe('#000000')
      expect(data.modal_position).toBe('drawer_right')
      expect(data.show_confidence).toBe(false)
      expect(data.show_reasoning).toBe(false)
    })
  })

  describe('Endpoint: POST /v1/recommend and POST /v1/size', () => {
    it('calculates recommendation successfully via POST /v1/recommend', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'uniqlo',
          ref_garment: 'tshirt',
          ref_size: 'M',
          shopify_product_id: productId,
        }),
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.predicted_size).toBe('M')
      expect(data.confidence).toBeGreaterThan(50)
      expect(data.reasoning).toBeDefined()
    })

    it('calculates recommendation successfully via POST /v1/size', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
        body: JSON.stringify({
          ref_brand: 'uniqlo',
          ref_garment: 'tshirt',
          ref_size: 'S',
          product_id: productId, // using product_id fallback
        }),
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.predicted_size).toBe('S')
    })
  })

  describe('Endpoint: GET /v1/product/:product_id and /v1/product/:id', () => {
    it('returns product mapping for valid product ID', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/product/${productId}`, {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.mapped).toBe(true)
      expect(data.shopify_product_id).toBe(productId)
      expect(data.garment_type).toBe('tshirt')
      expect(data.fit_type).toBe('regular')
      expect(data.is_active).toBe(true)
    })

    it('supports Shopify GID in path and matches underlying mapping', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/product/${encodeURIComponent(`gid://shopify/Product/${productId}`)}`, {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.mapped).toBe(true)
    })

    it('returns mapped: false for unmapped product ID', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/product/999999999', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.mapped).toBe(false)
    })
  })

  describe('Endpoint: GET /v1/size-guide and /v1/product/:product_id/size-guide', () => {
    it('returns size guide via /v1/product/:product_id/size-guide', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/product/${productId}/size-guide`, {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.enabled).toBe(true)
      expect(data.title).toContain('Unisex T-shirt')
      expect(data.unit).toBe('cm')
      expect(data.rows.length).toBe(3)
      expect(data.rows[0].size).toBe('S')
      expect(data.rows[0].chest).toBe(90)
    })

    it('returns size guide via query parameter /v1/size-guide?product_id=...', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/size-guide?product_id=${productId}`, {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.enabled).toBe(true)
      expect(data.rows.length).toBe(3)
    })

    it('returns enabled: false when product mapping is inactive', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/product/8822991102/size-guide', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.enabled).toBe(false)
    })
  })

  describe('Endpoint: GET /v1/admin/usage', () => {
    it('returns current usage via org_id query param', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/admin/usage?org_id=${orgId}`, {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.plan_tier).toBeDefined()
    })

    it('returns current usage via shop query param', async () => {
      const res = await exports.default.fetch(new Request(`https://worker.test/v1/admin/usage?shop=${shop}`, {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
      }))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.plan_tier).toBeDefined()
    })

    it('returns 400 Bad Request when neither shop nor org_id is provided', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/admin/usage', {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
      }))

      expect(res.status).toBe(400)
    })
  })

  describe('Endpoint: 404 Route Not Found', () => {
    it('returns standard JSON 404 response for non-existent route', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/unknown-route', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.error).toBe('Not Found')
      expect(data.message).toBe('Route not found')
    })
  })
})
