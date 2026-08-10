import { Hono } from 'hono'
import type { MerchantKVRecord } from './types'

import { corsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import { handleSizePrediction } from './handlers/size'
import { handleAdminUsageSync } from './handlers/adminUsage'
import { handleProductMappingLookup } from './handlers/product'
import { handleSizeGuideLookup } from './handlers/sizeGuide'

export type AppEnv = {
  Bindings: Env;
  Variables: {
    org: MerchantKVRecord;
  };
};

const app = new Hono<AppEnv>()

// Global CORS Middleware (Applies to all routes)
app.use('*', corsMiddleware)

// Public Health Check Endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  })
})

// Storefront Prediction Endpoint. It debits trial quota only after a prediction
// has passed request and configuration validation.
app.post('/v1/size', authMiddleware, handleSizePrediction)

// Storefront Product Mapping Lookup (Requires Auth)
app.get('/v1/product/:product_id', authMiddleware, handleProductMappingLookup)

// Storefront Size Guide (Requires Auth)
app.get('/v1/product/:product_id/size-guide', authMiddleware, handleSizeGuideLookup)

// Internal Admin Usage Sync Endpoint (Protected by X-Internal-Secret)
app.get('/v1/admin/usage', handleAdminUsageSync)

app.onError((error, ctx) => {
  console.error(JSON.stringify({ event: 'unhandled_request_error', path: ctx.req.path, message: error instanceof Error ? error.message : 'Unknown error' }))
  return ctx.json({ error: 'Internal Error', message: 'Unexpected server error' }, 500)
})

export { UsageCounter } from './durable-objects/UsageCounter'
export default app
