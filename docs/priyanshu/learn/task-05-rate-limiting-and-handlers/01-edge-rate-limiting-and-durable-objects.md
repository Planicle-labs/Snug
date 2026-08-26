# Module 01: Edge Rate-Limiting & Durable Object Atomic Execution

---

## 1. Threat Modeling & Architectural Requirements

### The Problem: Public Storefront API Quotas
Shopify storefront widgets run inside public shopper browsers. A merchant on the **Trial Plan** is allocated a quota of **1,000 free request calculations**.

Without edge rate-limiting enforced before executing computation or database queries:
- Malicious bots or exhausted trial accounts would consume server resources.
- Querying a relational database (Neon Postgres) on every request introduces **50–150ms of database roundtrip latency**, destroying storefront response speeds.
- Using Cloudflare KV for quota counters fails because KV is **eventually consistent** (taking up to 60 seconds to propagate writes across edge locations), allowing parallel race-condition requests to bypass quotas.

---

## 2. Comparison of Storage Architectures

| Architecture | Read Latency | Write Latency | Consistency Model | Race Condition Risk |
|---|---|---|---|---|
| **Neon Postgres SQL** | 50–150ms | 50–150ms | Strong Consistency | Low (Transaction locked) |
| **Cloudflare KV** | < 2ms | Seconds | Eventual Consistency | **High** (Stale edge reads allow over-quota bursts) |
| **Cloudflare Durable Objects** | **< 2ms** | **< 2ms** | **Strong Single-Isolate** | **Zero** (Single-threaded isolate memory execution) |

---

## 3. Implementation of `worker/src/middleware/rateLimit.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../index';

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (ctx, next) => {
  const org = ctx.var.org;

  // Paid tier limits are not yet defined; currently unconstrained (see TECHNICAL_DEBT.md C8)
  if (org.plan_tier === 'paid') {
    return await next();
  }

  // Get Durable Object stub for this organization
  const doId = ctx.env.USAGE_COUNTER.idFromName(org.org_id);
  const counter = ctx.env.USAGE_COUNTER.get(doId);

  // Issue atomic decrement request to DO isolate
  const counterRes = await counter.fetch("http://do/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "check_and_decrement_trial",
      org_id: org.org_id,
    }),
  });

  if (!counterRes.ok) {
    return ctx.json({ error: "Internal Error", message: "Failed to verify usage quota" }, 500);
  }

  const result = (await counterRes.json()) as {
    allowed: boolean;
    usage_remaining: number;
    milestone_crossed?: boolean;
  };

  if (!result.allowed) {
    return ctx.json(
      {
        error: "Too Many Requests",
        message: "Trial quota exhausted. Please upgrade to a paid plan.",
      },
      429
    );
  }

  // If usage hit a milestone checkpoint (e.g. 100, 200, 500 requests used),
  // asynchronously flush remaining quota to Neon Postgres without blocking the HTTP response!
  if (result.milestone_crossed) {
    ctx.executionCtx.waitUntil(
      syncMilestoneToPostgres(ctx.env.DATABASE_URL, org.org_id, result.usage_remaining)
    );
  }

  // Pass control downstream to route handlers
  await next();
});

async function syncMilestoneToPostgres(
  databaseUrl: string,
  orgId: string,
  remaining: number
) {
  try {
    console.log(`[Milestone Sync] Org ${orgId} synced remaining trial: ${remaining}`);
  } catch (err) {
    console.error(`[Milestone Sync Error] Failed to sync org ${orgId}:`, err);
  }
}
```
