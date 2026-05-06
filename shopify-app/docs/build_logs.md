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
- Upstash Redis for rate limiting
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

---

## What Still Needs Building

- `app.analytics.tsx` — usage analytics dashboard
- `app.billing.tsx` — billing page
- `webhooks.shop.redact.tsx` — GDPR shop deletion
- `webhooks.customers.redact.tsx` — GDPR  
- `webhooks.customers.data_request.tsx` — GDPR
- Storefront widget Theme App Extension
- Cloudflare Worker sizing API
- CSV upload for size charts
- Railway deployment