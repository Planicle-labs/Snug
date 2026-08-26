import { env, exports } from 'cloudflare:workers'
import { expect, it, describe } from 'vitest'

describe('Widget Config Handler', () => {
  it('fails with 401 Unauthorized when api key is missing', async () => {
    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/config', {
        headers: {
          Origin: 'https://test-shop.myshopify.com',
        },
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns default config when no custom config is stored', async () => {
    await env.KV.put(
      'apikey:test-key-config-default',
      JSON.stringify({
        org_id: 'org-config-test-1',
        shop: 'test-shop.myshopify.com',
        plan_tier: 'trial',
        trial_requests_remaining: 1000,
        widget_active: true,
      })
    )

    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': 'test-key-config-default',
          Origin: 'https://test-shop.myshopify.com',
        },
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      position: 'below_add_to_cart',
      button_text: 'Find Your Recommended Size',
      button_color: '#008060',
      button_text_color: '#ffffff',
      modal_position: 'center',
      show_confidence: true,
      show_reasoning: true,
    })
  })

  it('returns custom widget config stored in KV', async () => {
    await env.KV.put(
      'apikey:test-key-config-custom',
      JSON.stringify({
        org_id: 'org-config-test-2',
        shop: 'custom-shop.myshopify.com',
        plan_tier: 'starter',
        trial_requests_remaining: 3000,
        widget_active: true,
      })
    )

    await env.KV.put(
      'widget_config:org-config-test-2',
      JSON.stringify({
        position: 'below_size_selector',
        button_text: 'Check Size',
        button_color: '#111827',
        button_text_color: '#fafafa',
        modal_position: 'bottom_left',
        show_confidence: false,
        show_reasoning: false,
      })
    )

    const response = await exports.default.fetch(
      new Request('https://worker.test/v1/config', {
        headers: {
          'X-Snug-Key': 'test-key-config-custom',
          Origin: 'https://custom-shop.myshopify.com',
        },
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      position: 'below_size_selector',
      button_text: 'Check Size',
      button_color: '#111827',
      button_text_color: '#fafafa',
      modal_position: 'bottom_left',
      show_confidence: false,
      show_reasoning: false,
    })
  })
})
