import { Hono } from 'hono'
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types'
import type { MerchantKVRecord } from './middleware/auth'

import { corsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'
import { handleSizePrediction } from './handlers/size'
import { handleAdminUsageSync } from './handlers/adminUsage'
import { handleProductMappingLookup } from './handlers/product'

interface Env{
  DATABASE_URL: string,
  ENVIRONMENT: string,
  KV: KVNamespace,
  USAGE_COUNTER:DurableObjectNamespace
}

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

// Storefront Prediction Endpoint (Requires Auth + Rate Limiting)
app.post('/v1/size', authMiddleware, rateLimitMiddleware, handleSizePrediction)

// Storefront Product Mapping Lookup (Requires Auth)
app.get('/v1/product/:product_id', authMiddleware, handleProductMappingLookup)

// Internal Admin Usage Sync Endpoint (Protected by X-Internal-Secret)
app.get('/v1/admin/usage', handleAdminUsageSync)

export { UsageCounter } from './durable-objects/UsageCounter'
export default app
