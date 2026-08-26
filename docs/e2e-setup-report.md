# E2E Test Setup Report: App Config to Storefront Recommendation

Date: 2025-08-25
Scope: Full-stack verification of the Snug pipeline from merchant app config (Neon Postgres) through Cloudflare KV distribution, the sizing Worker, and the storefront widget on the Shopify dev store.

## Starting State

- Neon Postgres seeded (`scripts/seed.mjs`): 6 anthropometric anchors, 57 reference brand chart rows, 1 organization (`try-on-9231.myshopify.com`, trial plan, `widget_active=true`, api key `33d5eea2-9c6a-4625-a5d0-8b747ee95e4d`), 3 `fit_size_charts` rows (tshirt/regular: S/M/L), 19 `garment_mappings` rows.
- Worker deployed at `https://snug-worker.planicle-labs.workers.dev` but running stale code from 2026-08-21.
- Production KV namespace existed but contained no app-config for this org (one stale key from an older naming scheme).
- Existing `scripts/test-e2e.mjs` was not a real E2E: it duplicated the sizing algorithm locally, never started the Worker, and inserted fake rows directly into `usage_logs`.
- `worker/src/e2e/e2e_flow.test.ts` covers the Worker flow inside miniflare only (no Neon, no real KV).

## Architecture Under Test

```
Shopify dashboard (Remix) --save--> Neon Postgres (source of truth)
        |
        +-- kv.server.ts writers --> Cloudflare KV (config distribution)
        |       apikey:{key}, shop:{shop}, chart:{org}:{garment}:{fit},
        |       merchant:{org}:mappings, brand:{brand}:{garment}:{fit}
        |
Storefront widget (theme app extension)
        |-- GET  /v1/product/:id            (mapping check)
        |-- GET  /v1/product/:id/size-guide
        +-- POST /v1/size  (X-Snug-Key + Origin check)
                |
Cloudflare Worker (Hono)
        |-- KV reads -> predictSize() -> Durable Object quota debit
        +-- waitUntil: usage_logs INSERT into Neon
```

## Work Completed

### 1. Dependency hygiene
- Added `@neondatabase/serverless` as a root devDependency so `scripts/*.mjs` no longer import from `shopify-app/node_modules` by relative path.

### 2. New script: `scripts/publish-config.mjs`
The missing bridge between seeded database and Cloudflare KV. It:
- Reads the active organization, merchant charts, product mappings, and reference brand charts from Neon.
- Builds KV records with payload shapes identical to the dashboard writers (`app/lib/kv.server.ts` `pushApiKeyToKV`/`pushChartToKV`/`pushMappingsToKV`, and `app/lib/seed-kv.ts` `pushReferenceBrandsToKV`), including the body-midpoint sort order and `guide_gender`/`show_size_guide` derivation from `extra_measurements`.
- Publishes via wrangler CLI. `--remote` is explicit because wrangler 4 defaults `kv key put` to local state. `--local` mode targets the preview namespace for future `wrangler dev` based automated tests.

This exists because dashboard KV sync silently no-ops without `CLOUDFLARE_*` credentials in `shopify-app/.env`, and reference brand charts have no dashboard path at all.

### 3. Published 18 keys to production KV
- `apikey:33d5eea2-...`, `shop:try-on-9231.myshopify.com`
- `merchant:4b906041-...:mappings` (19 products, both gid and clean-id forms)
- `chart:4b906041-...:tshirt:regular` (3 rows)
- 14 `brand:*:tshirt:regular` reference chart keys

### 4. Redeployed the Worker
The deployed Worker (2026-08-21) predated the current key layout. Diagnosis chain: direct KV API reads returned the values while the Worker returned "not supported"; a leftover `brand:polo_ralph_lauren:tshirt` key (no fit suffix) proved an older schema had been live. `wrangler deploy` from `worker/` shipped current source; binding confirmed against production KV namespace `9adf9e3534794fc58cd25ce4f225c465`. Deleted the stale `polo_ralph_lauren` key.

### 5. Verified the full API path against production
| Check | Result |
|---|---|
| `GET /health` | 200, `environment: production` |
| `GET /v1/product/9337587237101` | `mapped: true`, tshirt/regular |
| `GET /v1/product/9337587237101/size-guide` | `enabled: true`, 3 rows, "Men's T-shirt" |
| `POST /v1/size` Zara M | `predicted_size: L`, confidence 60 (medium), body chest 88.0 cm, delta 6.0 cm |
| Unmapped product | 404 with correct message |
| Missing/invalid API key | 401 |
| `GET /v1/admin/usage?shop=...` | 200, DO counter reachable |
| Neon `usage_logs` | Prediction row persisted by the Worker (`zara M -> L`, 60%, 970 ms) |

The Zara M -> L result matches the hand-derived expectation from the algorithm (Zara M garment mid 96 cm, minus ease 8 = body 88; nearest merchant chart mid 89.99 = L).

### 6. Graphical pass on the dev store
- Started `shopify app dev` (tunnel + theme extension preview).
- Resolved a port conflict: an orphaned CLI child from the first background instance held port 9293 and crashed the user's instance with `EADDRINUSE`; orphans killed by pid.
- User added the "Snug Size Recommender" block in the theme editor and reached the widget modal. First submit returned "Failed to fetch" because the block's API key was empty and the worker URL still pointed at the dead `snug-worker.workers.dev` default. Correct values supplied:
  - Snug API Key: `33d5eea2-9c6a-4625-a5d0-8b747ee95e4d`
  - Snug Worker API Endpoint: `https://snug-worker.planicle-labs.workers.dev`
  - Test on a mapped product (the 19 mapped items are t-shirts; `cordelia-dress` is not mapped).

## Issues Found (Open)

1. **Merchant chart data quality**: `fit_size_charts` rows have lengths shifted by one row (S shows length 80.01, which equals M's chest) and chest values (70/80.01/89.99) look like body measurements rather than garment measurements. Consequence: every recommendation collapses toward L. Fix in the dashboard Size Charts UI.
2. **Dashboard KV sync is a silent no-op** until `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_NAMESPACE_ID`, and `CLOUDFLARE_API_TOKEN` are added to `shopify-app/.env`. Until then, saving charts/mappings in the UI updates Neon but not KV; rerun `node scripts/publish-config.mjs` after dashboard edits.
3. **Widget renders on unmapped products** and only errors after the shopper submits the form. Consider hiding the trigger when `/v1/product/:id` returns `mapped: false`.
4. `worker/.dev.vars` is missing `USAGE_SYNC_DATABASE_URL` (milestone sync to Neon will log failures if a quota milestone is crossed).

## Not Completed (Deferred)

- Rewrite of `scripts/test-e2e.mjs` into an automated HTTP-level harness (boot wrangler dev, seed local KV via `publish-config.mjs --local`, assert auth/mapping/guide/prediction/quota/persistence). The file still contains the old DB-only simulation. The in-miniflare suite `worker/src/e2e/e2e_flow.test.ts` remains the automated coverage for now.
- Adding Cloudflare credentials to `shopify-app/.env`.

## Commands Reference

```bash
# Publish app config from Neon to production KV (rerun after dashboard edits)
node scripts/publish-config.mjs

# Publish to local wrangler dev KV instead (for automated tests)
node scripts/publish-config.mjs --local

# Redeploy the Worker
cd worker && ./node_modules/.bin/wrangler deploy

# Run the dashboard against the dev store
cd shopify-app && pnpm dev

# In-miniflare Worker test suite
pnpm --filter worker test
```

## Environment Identifiers

| Item | Value |
|---|---|
| Cloudflare account ID | `5a7ebcaab36e928964f57703c190adf6` |
| KV production namespace | `9adf9e3534794fc58cd25ce4f225c465` (snug-kv-production) |
| KV preview namespace | `76761b47b9b54f689f6e32e22f5ad6db` (snug-kv-preview) |
| Worker URL | `https://snug-worker.planicle-labs.workers.dev` |
| Dev store | `try-on-9231.myshopify.com` |
| Org ID | `4b906041-8f20-4ce3-8762-c7979d4d2681` |
