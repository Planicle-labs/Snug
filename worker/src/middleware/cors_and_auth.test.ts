import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, beforeEach } from 'vitest'

describe('CORS and Auth Middleware Comprehensive Tests', () => {
  const orgId = 'org-cors-auth-test'
  const shop = 'cors-auth-store.myshopify.com'
  const apiKey = 'key-cors-auth-12345'
  const internalSecret = env.INTERNAL_ADMIN_SECRET || 'test-cors-auth-secret'

  beforeEach(async () => {
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
  })

  describe('CORS Preflight (OPTIONS) & Response Headers', () => {
    it('handles OPTIONS preflight for /v1/config with 204 and correct CORS headers', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        method: 'OPTIONS',
        headers: {
          'Origin': `https://${shop}`,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'X-Snug-Key, Content-Type',
        },
      }))

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET, POST, OPTIONS')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Snug-Key')
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    it('handles OPTIONS preflight for /v1/size with X-Shop-Domain header', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/size', {
        method: 'OPTIONS',
        headers: {
          'Origin': `https://${shop}`,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Snug-Key, X-Shop-Domain',
        },
      }))

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Snug-Key')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Shop-Domain')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    })

    it('handles OPTIONS preflight for /v1/recommend with 204 and correct CORS headers', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/recommend', {
        method: 'OPTIONS',
      }))

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })

    it('handles OPTIONS preflight for /v1/admin/usage with 204 and correct CORS headers', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/admin/usage', {
        method: 'OPTIONS',
      }))

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('attaches CORS headers on 200 OK responses', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/health'))

      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('attaches CORS headers on 401 Unauthorized responses', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config'))

      expect(res.status).toBe(401)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('attaches CORS headers on 403 Forbidden responses', async () => {
      const inactiveKey = 'key-inactive-merchant'
      await env.KV.put(`apikey:${inactiveKey}`, JSON.stringify({
        org_id: 'org-inactive',
        shop: 'inactive.myshopify.com',
        plan_tier: 'trial',
        trial_requests_remaining: 1000,
        widget_active: false,
      }))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': inactiveKey,
          'Origin': 'https://inactive.myshopify.com',
        },
      }))

      expect(res.status).toBe(403)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('attaches CORS headers on 404 Not Found responses', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/non-existent-endpoint'))

      expect(res.status).toBe(404)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('Auth Middleware & Security Edge Cases', () => {
    it('authenticates via X-Snug-Key header', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(200)
    })

    it('rejects request when X-Snug-Key is missing even if X-Shop-Domain is provided', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Shop-Domain': shop,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(401)
      const data = await res.json() as any
      expect(data.error).toBe('Unauthorized')
      expect(data.message).toBe('Missing or invalid API key')
    })

    it('rejects request when X-Snug-Key is not provided', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(401)
      const data = await res.json() as any
      expect(data.error).toBe('Unauthorized')
      expect(data.message).toBe('Missing or invalid API key')
    })

    it('rejects overly long API keys (> 512 chars) with 401', async () => {
      const longKey = 'a'.repeat(513)
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': longKey,
          'Origin': `https://${shop}`,
        },
      }))

      expect(res.status).toBe(401)
    })

    it('rejects inactive merchant widget with 403 Forbidden', async () => {
      const inactiveKey = 'key-inactive-999'
      await env.KV.put(`apikey:${inactiveKey}`, JSON.stringify({
        org_id: 'org-inactive-999',
        shop: 'inactive-store.myshopify.com',
        plan_tier: 'trial',
        trial_requests_remaining: 500,
        widget_active: false,
      }))

      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': inactiveKey,
          'Origin': 'https://inactive-store.myshopify.com',
        },
      }))

      expect(res.status).toBe(403)
      const data = await res.json() as any
      expect(data.error).toBe('Forbidden')
      expect(data.message).toBe('Widget is inactive')
    })

    it('allows valid matching Origin domains', async () => {
      // Direct shopify domain
      const res1 = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': `https://${shop}`,
        },
      }))
      expect(res1.status).toBe(200)

      // localhost origin
      const res2 = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': 'http://localhost:3000',
        },
      }))
      expect(res2.status).toBe(200)

      // 127.0.0.1 origin
      const res3 = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': 'http://127.0.0.1:8080',
        },
      }))
      expect(res3.status).toBe(200)

      // shopify admin origin
      const res4 = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': 'https://admin.shopify.com',
        },
      }))
      expect(res4.status).toBe(200)
    })

    it('rejects mismatched Origin domain with 401 Unauthorized', async () => {
      const res = await exports.default.fetch(new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': apiKey,
          'Origin': 'https://evil-phishing-site.com',
        },
      }))

      expect(res.status).toBe(401)
      const data = await res.json() as any
      expect(data.error).toBe('Unauthorized')
      expect(data.message).toBe('Origin domain mismatch')
    })
  })
})
