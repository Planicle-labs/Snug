# Snug — Build Log

---

## Project context

Snug is a Shopify app that solves online apparel return rates caused by sizing inconsistencies across brands. The sizing layer translates a shopper's known size in one brand into the correct size in another brand using garment measurements and ease values as the mathematical bridge.

---

## Architecture decisions made

### Distribution strategy
- Build Shopify app first, not standalone website
- Shopify App Store is primary distribution channel
- Embedded dashboard IS the merchant-facing web app

### Authentication
- Shopify OAuth handles merchant auth
- Shopper API uses Origin header lookup in Cloudflare KV
- No API keys exposed to merchants

### Stack decisions
- Cloudflare Workers + Hono.js + TypeScript for sizing API
- Vanilla JS via Theme App Extension for widget
- Shopify React Router template for dashboard
- **Neon Postgres with Drizzle ORM and Neon HTTP driver** - critical for Cloudflare Workers
- Cloudflare Durable Objects for current trial-quota enforcement; Redis deferred until scale requires it
- Cloudflare KV for cache
- Railway for dashboard hosting

### Webhooks
- `app/uninstalled` — clears session
- `shop/redact` — GDPR shop deletion
- `customers/redact` — GDPR (to be built)
- `customers/data_request` — GDPR (to be built)

---

## Environment setup completed

| Task | Status |
|---|---|
| Node.js version verified | Done |
| Shopify CLI installed | Done |
| App scaffolded | Done |
| Scopes configured | Done |
| Webhooks configured | Done |

---

## Dependency changes made

| Change | Reason |
|---|---|
| Prisma replaced with Drizzle | Worker compatibility |
| `@neondatabase/serverless` installed | HTTP driver for Workers |
| `@shopify/shopify-app-session-storage-drizzle` installed | Session storage |

---

## Files created or modified

### `shopify.app.toml`
Cleaned demo blocks, configured scopes and webhooks.

### `app/db.server.ts`
Rewritten to use Neon HTTP driver (`drizzle-orm/neon-http`).

### `app/shopify.server.ts`
Uses `DrizzleSessionStoragePostgres` adapter.

### `app/schema.server.ts`
Full Drizzle schema including:
- `organizations` with brandSlug, apiKey, planTier, etc.
- `widget_configs`
- `fit_size_charts` with CHECK constraints
- `garment_mappings` with chartOverrideId
- `brand_requests`

### Route files
- `app._index.tsx` — 3-step onboarding
- `app.brand.tsx` — brand setup with search
- `app.size-charts.tsx` — size chart management
- `app.products.tsx` — product mapping
- `app.widget.tsx` — widget configuration

---

## Database

| Task | Status |
|---|---|
| Neon project created | Done |
| Schema pushed via drizzle-kit | Done |

---

## Dev server

| Task | Status |
|---|---|
| `shopify app dev` running | Done |
| Development store connected | Done |
| OAuth install flow works | Done |
| Home screen renders | Done |

---

## Current application state

The app runs with:
- 3-step onboarding flow (size charts → products → widget)
- Brand setup with search and inline brand request
- All navigation and routes working
- Lint and typecheck passing

---

## What Has Been Built

- `app._index.tsx` — home screen with 3-step onboarding
- `app.brand.tsx` — brand setup
- `app.size-charts.tsx` — size chart management  
- `app.products.tsx` — product to garment mapping
- `app.widget.tsx` — widget configuration
- Schema with all tables including CHECK constraints
- `worker/src/durable-objects/UsageCounter.ts` — Durable Object scaffold for atomic SQLite counter checks and milestone checkpoints; first-use handling requires W-02
- `worker/src/middleware/cors.ts` — OPTIONS 204 preflight and post-execution CORS headers
- `worker/src/middleware/auth.ts` — API key verification, active widget check, and Origin domain matching
- `worker/src/middleware/rateLimit.ts` — DO quota middleware; its milestone sync helper is currently a logging stub
- `worker/src/handlers/size.ts` — `POST /v1/size` handler with parallel chart reads and no prediction cache, so chart updates take effect immediately; analytics persistence is currently a logging stub
- `worker/src/handlers/adminUsage.ts` — `GET /v1/admin/usage` scaffold; secret handling and Neon persistence require W-01 and W-03
- `worker/src/handlers/product.ts` — `GET /v1/product/:product_id` storefront widget mapping lookup
- `worker/src/algorithm/types.ts` — Data contracts (`RefSizeRow`, `TargetSizeRow`, `SizingInput`, `SizingResult`) with clean `extends` inheritance
- `worker/src/algorithm/sizing.ts` — Pure 9-step deterministic sizing calculation engine with reverse ease deduction, 5-signal confidence scoring, cross-fit penalties, and boundary case proximity detection
- `worker/src/algorithm/sizing.test.ts` — Vitest unit test suite (5 tests covering happy path, cross-brand translation, boundary proximity, cross-fit penalties, and ease source trust; 100% pass rate in 3ms)
- `worker/src/handlers/size.ts` — Refactored `POST /v1/size` handler to use parallel `Promise.all` KV reads, execute pure `predictSize()`, and eliminate prediction caching (`pred:*`) to prevent stale cache bugs and save KV write costs

---

## What Still Needs Building

- `app.analytics.tsx` — usage analytics dashboard
- `app.billing.tsx` — billing page
- `webhooks.shop.redact.tsx` — GDPR shop deletion
- `webhooks.customers.redact.tsx` — GDPR customer data deletion
- `webhooks.customers.data_request.tsx` — GDPR customer data request
- Storefront widget Theme App Extension
- Seeding scripts for NIFT anthropometric anchors and 10 reference brand charts
- Daily usage sync background cron job
- Railway deployment

Before deployment, resolve the Worker blockers in [issues.md](issues.md).
