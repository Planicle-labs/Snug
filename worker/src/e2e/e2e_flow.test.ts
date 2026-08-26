import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, beforeEach } from 'vitest'

describe('Snug End-to-End (E2E) Flow: AppConfig -> KV -> Worker -> Recommendation -> Quota -> AdminSync', () => {
  const orgId = 'org-e2e-test'
  const shop = 'e2e-demo-store.myshopify.com'
  const apiKey = 'snug-api-key-e2e-12345'
  const productId = '9337587237101'
  const internalSecret = env.INTERNAL_ADMIN_SECRET || 'test-internal-secret-for-e2e'

  beforeEach(async () => {
    // ─── Step 1: App Config & Auth Setup in Cloudflare KV ────────────────────
    await env.KV.put(`apikey:${apiKey}`, JSON.stringify({
      org_id: orgId,
      shop: shop,
      plan_tier: 'trial',
      trial_requests_remaining: 1000,
      widget_active: true,
    }))

    await env.KV.put(`shop:${shop}`, JSON.stringify({
      org_id: orgId,
      api_key: apiKey,
    }))

    // ─── Step 2: Merchant Product Mappings in KV ────────────────────────────
    await env.KV.put(`merchant:${orgId}:mappings`, JSON.stringify({
      [productId]: {
        garment_type: 'tshirt',
        fit_type: 'regular',
        is_active: true,
      },
      [`gid://shopify/Product/${productId}`]: {
        garment_type: 'tshirt',
        fit_type: 'regular',
        is_active: true,
      },
      '9337587237102': {
        garment_type: 'tshirt',
        fit_type: 'oversized',
        is_active: true,
      },
    }))

    // ─── Step 3: Merchant Size Charts in KV ──────────────────────────────────
    // Regular Fit T-Shirt Chart
    await env.KV.put(`chart:${orgId}:tshirt:regular`, JSON.stringify([
      {
        size_label: 'S',
        fit_type: 'regular',
        chest_min_cm: 88,
        chest_max_cm: 92,
        length_min_cm: 68,
        length_max_cm: 70,
        shoulder_min_cm: 42,
        shoulder_max_cm: 44,
        ease_value_cm: 8,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'M',
        fit_type: 'regular',
        chest_min_cm: 96,
        chest_max_cm: 100,
        length_min_cm: 70,
        length_max_cm: 72,
        shoulder_min_cm: 44,
        shoulder_max_cm: 46,
        ease_value_cm: 8,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'L',
        fit_type: 'regular',
        chest_min_cm: 104,
        chest_max_cm: 108,
        length_min_cm: 72,
        length_max_cm: 74,
        shoulder_min_cm: 46,
        shoulder_max_cm: 48,
        ease_value_cm: 8,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'XL',
        fit_type: 'regular',
        chest_min_cm: 112,
        chest_max_cm: 116,
        length_min_cm: 74,
        length_max_cm: 76,
        shoulder_min_cm: 48,
        shoulder_max_cm: 50,
        ease_value_cm: 8,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
    ]))

    // Oversized Fit T-Shirt Chart
    await env.KV.put(`chart:${orgId}:tshirt:oversized`, JSON.stringify([
      {
        size_label: 'S',
        fit_type: 'oversized',
        chest_min_cm: 104,
        chest_max_cm: 110,
        length_min_cm: 70,
        length_max_cm: 72,
        shoulder_min_cm: 48,
        shoulder_max_cm: 50,
        ease_value_cm: 19,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'M',
        fit_type: 'oversized',
        chest_min_cm: 112,
        chest_max_cm: 118,
        length_min_cm: 72,
        length_max_cm: 74,
        shoulder_min_cm: 50,
        shoulder_max_cm: 52,
        ease_value_cm: 19,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
      {
        size_label: 'L',
        fit_type: 'oversized',
        chest_min_cm: 120,
        chest_max_cm: 126,
        length_min_cm: 74,
        length_max_cm: 76,
        shoulder_min_cm: 52,
        shoulder_max_cm: 54,
        ease_value_cm: 19,
        ease_source: 'inferred',
        guide_gender: 'men',
        show_size_guide: true,
      },
    ]))

    // ─── Step 4: Reference Brand Size Charts in KV ───────────────────────────
    await env.KV.put('brand:nike:tshirt:regular', JSON.stringify([
      { size_label: 'S', fit_type: 'regular', chest_min_cm: 88, chest_max_cm: 96, length_min_cm: 70, length_max_cm: 72, shoulder_min_cm: 43, shoulderMaxCm: 45 },
      { size_label: 'M', fit_type: 'regular', chest_min_cm: 96, chest_max_cm: 104, length_min_cm: 72, lengthMaxCm: 74, shoulder_min_cm: 45, shoulderMaxCm: 47 },
      { size_label: 'L', fit_type: 'regular', chest_min_cm: 104, chest_max_cm: 112, length_min_cm: 74, lengthMaxCm: 76, shoulder_min_cm: 47, shoulderMaxCm: 49 },
      { size_label: 'XL', fit_type: 'regular', chest_min_cm: 112, chest_max_cm: 124, length_min_cm: 76, lengthMaxCm: 78, shoulder_min_cm: 49, shoulderMaxCm: 52 },
    ]))

    await env.KV.put('brand:zara:tshirt:regular', JSON.stringify([
      { size_label: 'S', fit_type: 'regular', chest_min_cm: 88, chest_max_cm: 92, length_min_cm: 68, length_max_cm: 70, shoulder_min_cm: 42, shoulderMaxCm: 44 },
      { size_label: 'M', fit_type: 'regular', chest_min_cm: 94, chest_max_cm: 98, length_min_cm: 70, lengthMaxCm: 72, shoulder_min_cm: 44, shoulderMaxCm: 46 },
      { size_label: 'L', fit_type: 'regular', chest_min_cm: 100, chest_max_cm: 104, length_min_cm: 72, lengthMaxCm: 74, shoulder_min_cm: 46, shoulderMaxCm: 48 },
      { size_label: 'XL', fit_type: 'regular', chest_min_cm: 106, chest_max_cm: 110, length_min_cm: 74, lengthMaxCm: 76, shoulder_min_cm: 48, shoulderMaxCm: 50 },
    ]))
  })

  // ─── STAGE 1: Health & Authentication Checks ──────────────────────────────

  it('Stage 1: Health check returns status ok', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/health'))
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBe('ok')
  })

  it('Stage 1: Rejects prediction when API key is missing or invalid', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `https://${shop}`,
      },
      body: JSON.stringify({
        ref_brand: 'nike',
        ref_garment: 'tshirt',
        ref_size: 'L',
        shopify_product_id: productId,
      }),
    }))

    expect(res.status).toBe(401)
    const err = await res.json() as any
    expect(err.error).toBe('Unauthorized')
  })

  it('Stage 1: Rejects prediction when Origin domain does not match shop', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Snug-Key': apiKey,
        'Origin': 'https://malicious-store.com',
      },
      body: JSON.stringify({
        ref_brand: 'nike',
        ref_garment: 'tshirt',
        ref_size: 'L',
        shopify_product_id: productId,
      }),
    }))

    expect(res.status).toBe(401)
    const err = await res.json() as any
    expect(err.message).toBe('Origin domain mismatch')
  })

  // ─── STAGE 2: Storefront Product Mapping & Size Guide Check ───────────────

  it('Stage 2: Product mapping lookup returns mapped: true for mapped product', async () => {
    const res = await exports.default.fetch(new Request(`https://worker.test/v1/product/${productId}`, {
      headers: {
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.mapped).toBe(true)
    expect(data.garment_type).toBe('tshirt')
    expect(data.fit_type).toBe('regular')
    expect(data.is_active).toBe(true)
  })

  it('Stage 2: Product mapping lookup returns mapped: false for unmapped product', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/product/unmapped-999', {
      headers: {
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.mapped).toBe(false)
  })

  it('Stage 2: Storefront size guide lookup returns formatted measurement rows', async () => {
    const res = await exports.default.fetch(new Request(`https://worker.test/v1/product/${productId}/size-guide`, {
      headers: {
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.enabled).toBe(true)
    expect(data.unit).toBe('cm')
    expect(data.rows.length).toBe(4)
    expect(data.rows[0].size).toBe('S')
  })

  // ─── STAGE 3: End-to-End Recommendation Engine Calculations ───────────────

  it('Stage 3: Generates Size Recommendation with transparent reasoning (Nike M -> Merchant M)', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
      body: JSON.stringify({
        ref_brand: 'nike',
        ref_garment: 'tshirt',
        ref_size: 'M',
        shopify_product_id: productId,
      }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.predicted_size).toBe('M')
    expect(data.fitted_size).toBe('M')
    expect(data.silhouette_size).toBe('M')
    expect(data.confidence).toBeGreaterThanOrEqual(60)
    expect(data.confidence_label).toBeDefined()
    expect(data.reasoning).toContain('estimated body chest')
  })

  it('Stage 3: Generates Cross-Fit Silhouette Recommendation (Zara M Regular -> Oversized Tee)', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
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
        shopify_product_id: '9337587237102', // Mapped to oversized
      }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    // Zara M regular mid = 96cm -> body chest = 88cm -> target oversized intent = 88 + 19 = 107cm -> Overlays S (mid 107cm)
    expect(data.predicted_size).toBe('S')
    expect(data.silhouette_size).toBe('S')
    expect(data.reasoning).toContain('oversized')
  })

  it('Stage 3: Detects Boundary Cases and Returns Two Suggested Sizes for Storefront UI', async () => {
    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
      body: JSON.stringify({
        ref_brand: 'zara',
        ref_garment: 'tshirt',
        ref_size: 'L', // Zara L garment mid = 102cm, sits near border of Target M(98) and Target L(106)
        shopify_product_id: productId,
      }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.is_boundary_case).toBe(true)
    expect(data.suggested_sizes.length).toBe(2)
    expect(data.suggested_sizes).toContain('M')
    expect(data.suggested_sizes).toContain('L')
  })

  // ─── STAGE 4: Durable Object Quota Enforcement & Rollover ─────────────────

  it('Stage 4: Durable Object decrements trial quota atomically across requests', async () => {
    // 1st request
    const res1 = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Snug-Key': apiKey,
        'Origin': `https://${shop}`,
      },
      body: JSON.stringify({
        ref_brand: 'nike',
        ref_garment: 'tshirt',
        ref_size: 'S',
        shopify_product_id: productId,
      }),
    }))
    expect(res1.status).toBe(200)

    // Admin usage check to verify DO counter decremented
    const adminRes = await exports.default.fetch(new Request(`https://worker.test/v1/admin/usage?shop=${shop}`, {
      headers: {
        'X-Internal-Secret': internalSecret,
      },
    }))

    expect(adminRes.status).toBe(200)
    const usage = await adminRes.json() as any
    expect(usage.initialized).toBe(true)
    expect(usage.usage_remaining).toBeLessThan(1000)
  })

  it('Stage 4: Returns 429 Too Many Requests when merchant trial quota is exhausted', async () => {
    const exhaustedOrgId = 'org-exhausted-test'
    const exhaustedKey = 'key-exhausted-123'

    await env.KV.put(`apikey:${exhaustedKey}`, JSON.stringify({
      org_id: exhaustedOrgId,
      shop: 'exhausted.myshopify.com',
      plan_tier: 'trial',
      trial_requests_remaining: 0, // 0 remaining
      widget_active: true,
    }))

    await env.KV.put(`merchant:${exhaustedOrgId}:mappings`, JSON.stringify({
      [productId]: { garment_type: 'tshirt', fit_type: 'regular', is_active: true },
    }))

    await env.KV.put(`chart:${exhaustedOrgId}:tshirt:regular`, JSON.stringify([
      { size_label: 'M', fit_type: 'regular', chest_min_cm: 96, chest_max_cm: 102 },
    ]))

    const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Snug-Key': exhaustedKey,
        'Origin': 'https://exhausted.myshopify.com',
      },
      body: JSON.stringify({
        ref_brand: 'nike',
        ref_garment: 'tshirt',
        ref_size: 'M',
        shopify_product_id: productId,
      }),
    }))

    expect(res.status).toBe(429)
    const data = await res.json() as any
    expect(data.error).toBe('Too Many Requests')
    expect(data.message).toContain('limit reached')
  })
})
