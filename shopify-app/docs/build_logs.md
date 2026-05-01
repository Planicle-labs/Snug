# Snug — Build Log

---

## Project context

Snug is a Shopify app that solves online apparel return rates caused by sizing inconsistencies across brands. The sizing layer translates a shopper's known size in one brand into the correct size in another brand using garment measurements and ease values as the mathematical bridge. The internal project name is Snug. The repo is called Snug. The product may be referred to as Planicle in earlier parts of this conversation — they are the same thing.

---

## Architecture decisions made

### Distribution strategy
- Decided to build Shopify app first, not a standalone website
- Shopify App Store is the primary distribution channel at launch
- A standalone marketing website is deferred until there is traction
- The embedded dashboard iframe IS the merchant-facing web app — no separate portal needed

### Authentication
- Dropped API key model for v0
- Merchant auth is handled entirely by Shopify OAuth and session tokens via the React Router template
- Shopper-facing API auth uses Origin header lookup in Cloudflare KV — no keys exposed to merchants
- Clerk and WorkOS explicitly ruled out — not needed because Shopify is the identity provider
- SHA-256 hashed API key model noted as a future expansion for headless storefronts

### Stack decisions
- Cloudflare Workers + Hono.js + TypeScript for the sizing API
- Vanilla JS bundle via Theme App Extension for the storefront widget
- Shopify React Router template (migrated from Remix) for the embedded dashboard
- Neon Postgres with Drizzle ORM and the Neon HTTP driver for the database
- Drizzle chosen over Prisma because Prisma's Rust binary cannot run in Workers
- Upstash Redis for atomic rate limiting only
- Cloudflare KV for hot-path cache and merchant origin lookup
- Railway for hosting the embedded dashboard
- Cloudflare CDN for widget asset delivery

### Scopes decided
Final approved scopes in `shopify.app.toml`:
```
write_themes, read_themes, read_products, read_orders, read_customers
```
`write_metafields` was attempted but rejected by Shopify as an invalid scope and removed.

### Webhooks decided
- `app/uninstalled` — clears session, marks merchant inactive
- `shop/redact` — GDPR mandatory, registered in toml but noted as production-only
- `customers/redact` — GDPR mandatory, to be built
- `customers/data_request` — GDPR mandatory, to be built
- `app/scopes_update` — removed, not needed

---

## Documents produced

### Full technical reference
The original Planicle sizing layer spec was provided as context. It covers the complete inference algorithm, data model, confidence scoring system, API contract, and infrastructure. This document was treated as the source of truth for all architecture decisions.

### Stack breakdown (first version)
Produced a complete top-down stack breakdown covering all layers from shopper browser to Neon Postgres, explaining technology choices and why at each layer. Included an end-to-end request flow table with latency estimates.

### Stack breakdown (revised, no API keys)
Revised version after the decision to drop API keys for v0. Updated the Worker auth step to use Origin header lookup instead. Updated the KV key structure accordingly. Confirmed everything else in the stack was unaffected.

### Auth deep dive
Produced a complete breakdown of the three separate auth problems in Snug: shopper to sizing API, merchant installing the app, and merchant using the dashboard. Covered the full OAuth flow, session token mechanism, and what the React Router template handles automatically.

### Merchant onboarding rundown
Produced a full step-by-step breakdown of both entry points — App Store install and website — through to widget active on storefront. Covered the four onboarding screens inside the dashboard, failure cases, and the uninstall grace period.

### Shopify install flow document
A separate document was shared covering the OAuth install sequence in detail. Key corrections applied: WorkOS removed from Step 5, widget brand detection clarified, `app/uninstalled` webhook gap identified and noted.

### Shopify app PRD
Produced a complete product requirements document covering all remaining routes to build, database schema additions, route specifications with loader and action logic, billing API flow, GDPR webhook handlers, navigation updates, brand setup improvements, onboarding state machine, and error handling requirements.

---

## Environment setup completed

| Task | Status |
|---|---|
| Node.js version verified (v24.12.0) | Done |
| Shopify CLI installed (v3.94.3) | Done |
| Shopify Partner account confirmed ready | Done |
| App scaffolded via `shopify app init` | Done |
| React Router template selected, TypeScript | Done |
| App created in Partner dashboard as `snug` | Done |
| Nested `.git` folder removed from scaffolded app | Done |
| `shopify.app.toml` cleaned of demo metafield and metaobject blocks | Done |
| Scopes corrected to final approved set | Done |
| Webhooks corrected to `app/uninstalled` and `shop/redact` only | Done |

---

## Dependency changes made

| Change | Reason |
|---|---|
| Prisma uninstalled (`@prisma/client`, `prisma`) | Replaced with Drizzle |
| `prisma/` directory deleted | No longer needed |
| `setup` and `prisma` scripts removed from `package.json` | No longer needed |
| `drizzle-orm@0.44.7` installed | Pinned to version compatible with session storage adapter |
| `drizzle-kit` installed as dev dependency | For schema migrations and push |
| `@neondatabase/serverless` installed | Neon HTTP driver for Workers-compatible Postgres |
| `@shopify/shopify-app-session-storage-drizzle` installed | Replaces Prisma session storage adapter |
| Installed with `--legacy-peer-deps` due to peer dependency conflict with drizzle-orm version | Noted as acceptable tradeoff |

---

## Files created or modified

### `shopify.app.toml`
Cleaned and rewritten. Removed all demo template blocks. Final state: correct client ID, correct scopes, correct webhooks only, no metafields or metaobjects.

### `app/db.server.ts`
Rewritten from Prisma to Drizzle. Creates and exports a Neon HTTP connection using `drizzle-orm/neon-http`.

### `app/shopify.server.ts`
Rewritten to use `DrizzleSessionStoragePostgres` instead of `PrismaSessionStorage`. Fixed a file corruption issue where markdown link rendering had embedded broken URLs in the SHOP_CUSTOM_DOMAIN environment variable references.

### `app/schema.server.ts`
Created from scratch. Defines the Drizzle schema for the `sessions` table (auto-generated by the adapter with correct column names including `refreshToken` and `refreshTokenExpires`) and the `organizations` table.

### `drizzle.config.ts`
Created. Points at `app/schema.server.ts`, outputs to `./drizzle`, uses PostgreSQL dialect, reads `DATABASE_URL` from environment.

### `app/routes/app.tsx`
Modified to add Polaris `AppProvider` with `enTranslations` wrapping the outlet. Fixed missing i18n provider error. Updated nav to remove Additional page link and add Brand Setup link.

### `app/routes/app._index.tsx`
Completely rewritten. Implements the three-state onboarding home screen: not started, brand configured but widget inactive, fully active. Queries `organizations` table. Shows warning or success banner, step cards with status badges, conditional button states.

### `app/routes/app.brand.tsx`
Created. Brand setup page with loader querying current brand from `organizations`, action writing brand selection to database, brand request card with mailto fallback. Uses `randomUUID` for org ID generation.

### `app/routes/app.additional.tsx`
Deleted. Template demo page, not needed.

### `app/routes/webhooks.app.scopes_update.tsx`
Deleted. Scopes update webhook removed from the app.

### `app/routes/webhooks.app.uninstalled.tsx`
Already correct from template — uses Drizzle to delete sessions where shop matches. Left untouched.

---

## Database

| Task | Status |
|---|---|
| Neon project created | Done |
| `DATABASE_URL` added to `.env` | Done |
| `sessions` table pushed to Neon via `drizzle-kit push` | Done |
| `organizations` table added to schema and pushed to Neon | Done |

---

## Dev server

| Task | Status |
|---|---|
| `shopify app dev` running successfully | Done |
| Development store connected (`try-on-9231.myshopify.com`) | Done |
| OAuth install flow completed on dev store | Done |
| Home screen rendering correctly in Shopify Admin iframe | Done |
| Brand Setup page accessible from nav and home screen button | Done |

---

## Current application state

The app is running in development. A merchant who installs sees the home screen with the two-step onboarding flow. Step 1 takes them to the brand setup page where they can enter their brand name and save it to the database. Step 2 (widget activation) is disabled until Step 1 is complete. The uninstall webhook is wired up and deletes the merchant session from Neon on uninstall.

---

## What has not been built yet

As specified in the PRD produced in this conversation:

- `app.analytics.tsx` — usage analytics dashboard
- `app.widget.tsx` — widget configuration and theme editor deep link
- `app.billing.tsx` — plan display and Shopify billing API integration
- `webhooks.shop.redact.tsx` — GDPR shop data deletion
- `webhooks.customers.redact.tsx` — GDPR customer data deletion
- `webhooks.customers.data_request.tsx` — GDPR data request handler
- `usageEvents` table in schema
- `brandRequests` table in schema
- `planTier` column added to `organizations`
- Brand setup page connected to real Snug brand database instead of placeholder brandId
- Brand request form writing to database instead of mailto link
- Storefront widget Theme App Extension
- Cloudflare Worker sizing API
- Railway deployment configuration