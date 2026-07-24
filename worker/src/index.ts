import { Hono } from 'hono'
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types'
import type { MerchantKVRecord } from './middleware/auth'

import { corsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'

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

// Worker exports a fetch function. Hono wraps this cleanly.
// Instead of writing the fetch function yourself, you create a Hono app and call app.fetch.
// Hono's fetch has the exact same signature the Workers runtime expects.
const app = new Hono<AppEnv>()

app.use('*', corsMiddleware)
// for health_checks we don't require auth
app.use('/v1/*', authMiddleware)

app.use(rateLimitMiddleware)

app.get('/health', (c) => {
  return c.json({
    status:'ok',
    environment: c.env.ENVIRONMENT
  })
})

// Cloudflare needs to find it as a named export from your Worker bundle.
// Even though it is defined in a separate file, it must be re-exported from src/index.ts
export {UsageCounter} from './durable-objects/UsageCounter'
export default app
