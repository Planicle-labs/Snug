# Snug — Technical Debt & Known Issues

Every problem, gap, contradiction, and bug found during the full codebase audit (2026-07-23). Each point is a discrete actionable fix. Worker findings were refreshed on 2026-08-02; see [issues.md](issues.md) for their canonical priority and status.

---

## Audit refresh — prioritized active blockers (2026-08-10)

This section records the follow-up audit findings in execution order. Items already
listed below are cross-referenced rather than duplicated.

### P0 — Prevents a working dashboard or storefront recommendation flow

**P0-1. Dashboard TypeScript build is blocked by duplicate Drizzle package instances**
- `shopify-app` resolves Drizzle query utilities and the `@snug/db` schema through
  two different physical `drizzle-orm@0.44.7` installations. TypeScript treats the
  otherwise identical `PgTable` and `SQL` types as incompatible, producing errors
  across analytics and webhook routes.
- **Impact:** `shopify-app` cannot pass `tsc --noEmit` or produce a reliable
  production build.
- **Fix:** Deduplicate/align the workspace's Drizzle peer dependency resolution,
  reinstall from the lockfile, and verify `pnpm --filter snug typecheck` passes.

**P0-2. Product mappings never reach the KV record consumed by the Worker**
- `app.products.tsx` persists `garment_mappings` in Neon, but does not publish
  `merchant:{org_id}:mappings`. Both `GET /v1/product/:product_id` and `POST
  /v1/size` read that KV record exclusively.
- **Impact:** a merchant can see a successful mapping in the dashboard while every
  storefront lookup returns `mapped: false` or a 404 prediction error.
- **Fix:** add a mapping KV sync helper and invoke it after create, update, and
  delete actions; add an integration test for the Neon-to-KV contract.

**P0-3. Brand setup calls an endpoint that is not implemented**
- Reconfirmed existing item **C4**: `app.brand.tsx` requests
  `GET /v1/brands/search`, but the Worker exposes no such route.
- **Impact:** merchants cannot validate or select their reference brand through
  the dashboard.
- **Fix:** implement and test the search endpoint, or change the dashboard to use
  an available, authorized data source.

**P0-4. Deployment URLs and Shopify API versions are still inconsistent**
- Reconfirmed existing items **F1**, **F2**, and **G3**: the app configuration
  still uses `https://example.com` for its application and redirect URLs, while
  the TOML webhook API version differs from `shopify.server.ts`.
- **Impact:** a deployed app cannot complete OAuth reliably and may register or
  process webhooks against an unintended API version.
- **Fix:** set the real deployed URL and callback, then choose one supported API
  version and apply it consistently.

### P1 — Breaks or degrades the storefront widget after the P0 flow is restored

**P1-1. Widget renders for unmapped products and after mapping lookup failures**
- `snug-widget.js` calls `showWidgetButton()` when the lookup reports
  `mapped: false` or when the request fails. The button then opens a modal that
  cannot return a recommendation for that product.
- **Impact:** shoppers are offered a sizing experience that ends in an avoidable
  error, including during Worker/network failures.
- **Fix:** render only when the lookup returns an active mapping; use a silent
  failure state for lookup errors.

**P1-2. Widget input options are not aligned with Worker-supported garment types**
- The widget hard-codes `pants`, `jeans`, `shorts`, and `dress`, but the Worker
  and database only support `tshirt`, `shirt`, `polo`, `sweatshirt`, `hoodie`,
  `jacket`, `kurta`, and `top`.
- **Impact:** shoppers can submit selections that cannot have a matching
  reference chart and receive a 404 instead of a recommendation.
- **Fix:** source supported brands, garments, and sizes from the Worker (or a
  shared generated manifest) and constrain the UI to that contract.

### P2 — Maintains an accurate and actionable engineering register

**P2-1. This debt register contains stale findings marked as active**
- The 2026-08-10 audit verified that the checked-in migration already contains
  the current trial fields and sizing tables, while **A1–A3** still describe an
  older state. Several Worker issues below have also been fixed by the recent
  `0744d83`, `0de8dd8`, and `4ffc7a1` commits.
- **Impact:** contributors can spend time fixing already-resolved work or make
  incorrect assumptions about the deployed schema.
- **Fix:** reconcile each historical item against code and deployment state,
  mark resolved entries explicitly, and retain only externally verified gaps.

---

## A. Schema & Database

**A1. Pushed migration is out of sync with current schema**
- `shopify-app/drizzle/0000_heavy_eddie_brock.sql` reflects the OLD schema: `api_key NOT NULL`, `plan_tier='free'`, `usage_remaining INTEGER DEFAULT 500`, `billing_period_start`.
- `packages/db/src/schema.ts` has been updated to the trial model: `planTier='trial'`, `trialRequestsRemaining=1000`, paid-tier fields nullable, `trialExhaustedAt`, `upgradedAt`, `baseFeeInr`, etc.
- New tables added to schema (`usageLogs`, `conversionEvents`, `brandSizeCharts`, `anthropometric_anchors`) are also not in the migration.
- **Fix:** Run `drizzle-kit generate` and push the new migration. The live Neon database is currently on a different schema than the code.

**A2. `app.brand.tsx` writes to non-existent schema fields**
- Line 97–100 of `app.brand.tsx` inserts an org with `planTier: "free"` and `usageRemaining: 500` — both are old field names that no longer exist in `schema.ts`.
- This will throw a Drizzle type error at runtime on the fallback org creation path.
- **Fix:** Update to `planTier: "trial"`, `trialRequestsRemaining: 1000`, and remove `usageRemaining`.

**A3. `anthropometric_anchors` table is in docs but not in `schema.ts`**
- `docs/database.md` documents an `anthropometric_anchors` table (NIFT population data used by the sizing algorithm). It is not present in `packages/db/src/schema.ts`.
- The algorithm cannot run without this data.
- **Fix:** Add the table to `schema.ts`, generate migration, seed NIFT values.

---

## B. Contradictions Between Documents

**B1. [RESOLVED] Usage enforcement: Durable Objects vs. Upstash Redis**
- **Decision:** Durable Objects are the current quota authority. Redis is explicitly deferred until measured scale requires it.
- **Documentation:** `architecture.md`, `context.md`, `database.md`, `roadmap.md`, and `build_logs.md` now reflect this decision. The transition criteria are recorded as S-01 in `issues.md`.

**B2. `organizations` trial quota field name mismatch across files**
- `schema.ts` uses `trialRequestsRemaining` (camelCase Drizzle field).
- `docs/priyanshu/overview.md` refers to `trial_requests_remaining` (snake_case Neon column).
- `MerchantKVRecord` in both `packages/db/src/types.ts` and `worker/src/middleware/auth.ts` uses `trial_requests_remaining`.
- All three are the same thing but inconsistently named across layers.
- **Fix:** Document the mapping explicitly: Drizzle camelCase ↔ Neon snake_case ↔ KV JSON field. This is implicit Drizzle behavior but it trips up anyone reading across layers.

**B3. Plan tier default inconsistency**
- `schema.ts` defaults `planTier` to `'trial'`.
- The pushed migration defaults `plan_tier` to `'free'`.
- `app.brand.tsx` hardcodes `planTier: 'free'` as a fallback.
- `MerchantKVRecord` type only allows `'trial' | 'paid'` — `'free'` is not a valid value.
- **Fix:** Standardise on `'trial'` everywhere. Remove all references to `'free'`.

---

## C. Worker — Missing Implementation

**C1. [PARTIAL] `POST /v1/size` endpoint exists**
- The handler performs mapping/chart lookup and sizing, but it has no runtime schemas, hard-codes target fit type, charges before validation, and its analytics helper only logs. See W-04, W-06, W-08, and W-10 in `issues.md`.

**C2. [RESOLVED] `GET /v1/product/:product_id` does not exist**
- **Status:** Resolved by commit `98ce064` (`worker/src/handlers/product.ts`). Implemented storefront product widget mapping lookup endpoint returning `{ mapped: true, garment_type: "tshirt" }` or `{ mapped: false }`.

**C3. [PARTIAL] `GET /v1/admin/usage` exists**
- The endpoint exists but has an authentication bypass when the development fallback or a missing secret is used, and its PostgreSQL sync helper only logs. See W-01, W-02, and W-03 in `issues.md`.

**C4. `GET /v1/brands/search` does not exist but is already called**
- `app.brand.tsx` action (intent=`search`) makes a live HTTP call to `${CLOUDFLARE_WORKER_URL}/v1/brands/search?q=...`. This endpoint does not exist in the Worker.
- Every brand search in the dashboard currently returns an error or throws.
- **Fix:** Implement this endpoint in the Worker to query `brandSizeCharts` by brand name prefix.

**C5. [PARTIAL] `UsageCounter` DO is called in the request path**
- The middleware invokes the DO, but optional SQL rows are read with `.one()`, which throws on zero rows. New-org initialization and exhausted-quota handling therefore fail. See W-02 and W-04 in `issues.md`.

**C6. Worker secret requirements are not declared**
- `DATABASE_URL` and `INTERNAL_ADMIN_SECRET` need deploy-time validation. Configure `secrets.required` and set each secret through Wrangler or the Cloudflare dashboard before deployment. See W-01, W-03, and W-09 in `issues.md`.

**C7. [RESOLVED] Sizing algorithm implemented & tested**
- The pure sizing algorithm is implemented and unit-tested. Production integration is not complete because the handler hard-codes target fit type and assumes chart order for boundary neighbours; see W-06 and W-07 in `issues.md`.

**C8. Paid plan pricing and request limits undefined (No infinite request mechanism)**
- Paid plan pricing tiers, request allowances, and Shopify usage billing limits are not yet defined.
- Consequently, no limits or infinite request mechanisms are implemented for `plan_tier = 'paid'` merchants in `rateLimitMiddleware` or `UsageCounter` DO.
- **Fix:** Once paid plan pricing and billing rules are finalized, implement paid-tier rate-limiting and overage billing enforcement in `rateLimit.ts` and `UsageCounter.ts`.

---

## D. Dashboard — Missing or Broken Features

**D1. No `afterAuth` callback — install flow is broken**
- `shopify.server.ts` has no `afterAuth` hook. When a merchant installs the app, no `organizations` row is created, no `api_key` is generated, no KV entries are written (`apikey:{key}`, `shop:{domain}`), and no DO counter is initialised.
- Every subsequent dashboard query that does `WHERE shop = session.shop` returns null.
- **Fix:** Add `afterAuth` callback to `shopifyApp()` in `shopify.server.ts` (TASK-R01).

**D2. KV is never written after widget activate/deactivate**
- `app.widget.tsx` updates `organizations.widgetActive` in Neon but does not write to KV.
- The Worker reads `widget_active` from `apikey:{key}` in KV, not from Neon. So activating or deactivating the widget in the dashboard has zero effect on the Worker.
- **Fix:** After Neon update, write updated `apikey:{key}` record to KV.

**D3. KV is never written after size chart create/delete**
- `app.size-charts.tsx` writes to `fitSizeCharts` in Neon but never calls any KV sync.
- The Worker reads `chart:{org_id}:{garment_type}` from KV. New charts are invisible to the Worker until KV is updated.
- **Fix:** Implement `pushChartToKV()` in `app/lib/kv.server.ts` and call it in the `add-size` and `delete` action handlers (TASK-R02, R03).

**D4. `app.products.tsx` uses a raw text input for product IDs**
- The garment mapping UI has a plain text `<input>` where the user manually types `gid://shopify/Product/1234567890`. This is error-prone and not acceptable UX.
- The `read_products` scope is already granted in `shopify.app.toml`.
- **Fix:** Use the Shopify Admin API (via `authenticate.admin`) to fetch the product list and render a proper selector.

**D5. `app.analytics.tsx` does not exist**
- Specified in `prd.md` and `roadmap.md` (DASH-16 through DASH-20). Not built.
- **Fix:** Build the route (TASK-R07).

**D6. `app.billing.tsx` does not exist**
- Specified in `prd.md` (DASH-21 through DASH-23). Not built.
- **Fix:** Build the route (TASK-R08).

**D7. `onboardingStep` logic in `app._index.tsx` has a gap — step 2 never fires**
- The step logic: `if (hasSizeCharts && hasProductMappings && isWidgetActive) → step 3`, `else if (hasSizeCharts) → step 1`, `else if (org.brandSlug) → step 0`. Step 2 (has size charts AND product mappings but widget not yet active) is never assigned. A merchant who has completed both steps 1 and 2 sees `onboardingStep = 1` (same as having only size charts), and the "almost there" banner never appears at the right moment.
- **Fix:** Add `else if (hasSizeCharts && hasProductMappings) → step 2` between step 3 and step 1 checks.

---

## E. Webhooks & Compliance

**E1. Uninstall webhook only deletes sessions — not Neon or KV**
- `webhooks.app.uninstalled.tsx` only runs `db.delete(sessions).where(eq(sessions.shop, shop))`.
- It does not: set `organizations.widgetActive = false`, write `apikey:{key}` to KV with `widget_active: false`, or reset the DO counter.
- This means an uninstalled merchant's API key still validates in the Worker.
- **Fix:** Add Neon update + KV write inside the uninstall handler.

**E2. Three mandatory GDPR webhooks are not built and not registered**
- `shop/redact`, `customers/redact`, `customers/data_request` are required by Shopify for App Store listing. None of the three route files exist. None are registered in `shopify.app.toml`.
- **Fix:** Create the three route files and add the webhook subscriptions to `shopify.app.toml` (TASK-R10, R11).

---

## F. Configuration & Infrastructure

**F1. `shopify.app.toml` has a placeholder `application_url`**
- `application_url = "https://example.com"` — the app is not pointing at its real Railway URL. OAuth redirects and embedded app frame will not work in any deployed environment.
- **Fix:** Set to the actual Railway deployment URL.

**F2. `shopify.app.toml` `redirect_urls` is also placeholder**
- `redirect_urls = ["https://example.com/api/auth"]` — same issue as above.
- **Fix:** Update to `https://<railway-url>/auth/callback`.

**F3. Theme App Extension scaffolded**
- `shopify-app/extensions/snug-widget/` scaffolded with manifest, liquid app block, css, js, and locales (TASK-R04).

**F4. Reference brand seeding scripts do not exist**
- `packages/db/src/seed/anchors.ts` and `packages/db/src/seed/brands.ts` are referenced in task docs but the files do not exist. Without seed data the algorithm has nothing to run against.
- **Fix:** Create and run the seed scripts (TASK-P01, P02).

**F5. No cron job exists for usage sync or billing rollover**
- `worker/src/crons/usageSync.ts` is referenced in task docs but not created. Without this, DO counters can drift from Neon over time.
- **Fix:** Implement and schedule the daily sync cron on Railway (TASK-P11).

---

## G. Minor / Code Quality

**G1. CORS `Access-Control-Allow-Origin: *` is too permissive**
- `worker/src/middleware/cors.ts` sets `Allow-Origin: *`. Since each request already validates the `Origin` header against the merchant's `shop` domain in `auth.ts`, the CORS header could be set to the specific origin rather than wildcard.
- **Fix:** After auth validates the origin, set `Access-Control-Allow-Origin` to `ctx.req.header("Origin")` on non-OPTIONS responses.

**G2. `_index/route.tsx` has un-updated template copy**
- The public landing page still reads "A short heading about [your app]" and "A tagline about [your app]". This is the first thing a non-merchant sees.
- **Fix:** Replace with Snug branding and value proposition copy.

**G3. `shopify.app.toml` API version is `2026-07` but code uses `ApiVersion.October25`**
- The TOML uses `api_version = "2026-07"` for webhooks. `shopify.server.ts` specifies `ApiVersion.October25` (`2025-10`). These should match.
- **Fix:** Align both to the same Shopify API version.

**G4. `randomUUID()` imported from Node `crypto` — may break in edge environments**
- Several route files import `{ randomUUID } from "crypto"`. This works fine in Node (Railway) but would fail in a Cloudflare Workers context. The Worker should use `crypto.randomUUID()` from the global scope.
- Not a current problem (Worker doesn't use it yet) but worth noting before any server code is copied between environments.

**G5. No error boundaries on individual routes**
- `app.tsx` has a global `ErrorBoundary` using `boundary.error()`. None of the individual route files (`app.brand.tsx`, `app.size-charts.tsx`, etc.) export their own `ErrorBoundary`. A loader crash on any page shows the top-level boundary with no route-specific recovery UX.
- **Fix:** Add per-route `ErrorBoundary` components (DASH-25 in roadmap).

**G6. No loading states on individual routes**
- No route uses `useNavigation` for full-page loading beyond form submit states. The `useNavigation` import exists in `app.brand.tsx` and `app.size-charts.tsx` for submit buttons but there are no skeleton states or loading indicators for the initial data load.
- **Fix:** Add loading states (DASH-26 in roadmap).
