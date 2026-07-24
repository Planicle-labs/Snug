# Priyanshu — Implementation Plan (plan.md)

---

## Executive Summary & Architectural Scope

This plan outlines the implementation roadmap for **Workstream 1 (Priyanshu)**, covering the sizing engine, platform API, Durable Objects, rate-limiting & quota enforcement, database seeding, on-demand admin usage sync, and daily background crons for Snug.

### Core Architectural Decisions & System Contracts

1. **4-Layer Hybrid Usage Sync Strategy**:
   - **Sub-Millisecond Edge Enforcement**: Cloudflare Durable Objects (`UsageCounter`) handle atomic trial decrements and conversion updates per request.
   - **Non-Blocking Milestone Checkpoint Sync**: When usage crosses specific milestones (100, 200, 300, 400, 500 requests used), the Worker uses `ctx.waitUntil()` to asynchronously update Neon Postgres (`organizations.trial_requests_remaining`) without blocking the shopper's response.
   - **On-Demand Admin Sync**: `GET /v1/admin/usage` enables Rudra's merchant dashboard to trigger a real-time fetch from the DO and flush remaining trial quotas directly into Neon Postgres.
   - **Daily Cron Safety Net**: Scheduled background cron syncs inactive DO states to Neon and handles billing period rollovers.

2. **Cloudflare KV Contracts (Priyanshu Reads / Writes)**:
   - `apikey:{api_key}`: `{ org_id, shop, plan_tier, trial_requests_remaining, widget_active }`
   - `chart:{org_id}:{garment_type}`: Merchant size chart data for prediction lookup.
   - `brand:{slug}:{garment_type}`: Reference brand size charts.
   - `brands:supported`: Array of supported reference brand slugs (e.g. Uniqlo, Zara, Nike).

3. **9-Step Pure Mathematical Sizing Algorithm**:
   - Pure function mapping shopper input + reference brand measurements + target merchant chart to predicted size, confidence score (0-100), cross-fit penalties, and boundary case suggestions (`suggested_sizes: ["M", "L"]`).

---

## Detailed Task Breakdown & Commit Roadmap

---

### TASK-P03: Complete UsageCounter Durable Object & Milestone Checkpoints

* **File**: `worker/src/durable-objects/UsageCounter.ts`
* **Architectural Scope**: Fix syntax and incomplete code in `UsageCounter.ts`, implement atomic trial decrements, conversion tracking, billing resets, and milestone checkpoint triggers.

#### Logic Steps as Commits:

* **Commit 1: `fix(worker): repair UsageCounter SQL syntax and incomplete action handler`**
  * **Rationale**: Resolve syntax error at SQL creation string and finish incomplete `if (body.action)` block (line 97).
  * **Implementation Logic**:
    1. Fix missing comma in `CREATE TABLE IF NOT EXISTS usage` SQL statement between `billing_start` and `updated_at`.
    2. Complete switch/if-else handler for `Actions.get_current_usage` returning `{ allowed, usage_remaining, monthly_conversions, plan_tier }`.

* **Commit 2: `feat(worker): implement milestone checkpoint detection in UsageCounter`**
  * **Rationale**: Enable non-blocking milestone flushes to Neon Postgres when usage crosses request thresholds.
  * **Implementation Logic**:
    1. Define milestone checkpoints array `[900, 800, 700, 600, 500, 400, 300, 200, 100, 0]` (corresponding to 100, 200, ..., 1000 requests used).
    2. In `check_and_decrement_trial`, calculate if previous `usage_remaining` crossed a checkpoint threshold when decremented to `newRemaining`.
    3. Return `milestone_crossed: true` and `checkpoint_value: newRemaining` in DO response payload.
  * **Verification**: Unit-test `UsageCounter` state transitions and confirm `milestone_crossed` flags fire accurately.

---

### TASK-P04: Hono Middleware Setup

* **Files**: `worker/src/middleware/auth.ts`, `worker/src/middleware/cors.ts`
* **Architectural Scope**: Validate incoming API key from `X-Snug-Key` against Cloudflare KV (`apikey:{key}`), validate `Origin` header against merchant domain, and enforce CORS headers.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement CORS middleware for storefront requests`**
  * **Rationale**: Allow cross-origin requests from Shopify storefronts while restricting unauthorized origins.
  * **Implementation Logic**:
    1. Construct Hono CORS middleware allowing `POST /v1/size`, `GET /v1/product/*`, and `OPTIONS`.
    2. Support headers: `X-Snug-Key`, `Content-Type`, `Origin`.

* **Commit 2: `feat(worker): implement KV API key and Origin authentication middleware`**
  * **Rationale**: Protect API endpoints and prevent key theft/misuse.
  * **Implementation Logic**:
    1. Extract `X-Snug-Key` from request headers.
    2. Lookup key in KV: `apikey:{key}`. If missing, return `401 Unauthorized`.
    3. Check `widget_active` flag. If false, return `403 Forbidden` (`widget_inactive`).
    4. Secondary validation: Check `Origin` header matches `shop` domain. If mismatch, return `401 Unauthorized`.
    5. Attach `org_id`, `shop`, `plan_tier`, `trial_requests_remaining` to Hono context (`c.set('org', ...)`) for handler downstream use.
  * **Verification**: Test with valid key, invalid key, inactive widget key, and origin mismatch.

---

### TASK-P05: Edge Rate-Limiting & Quota Middleware

* **File**: `worker/src/middleware/rateLimit.ts`
* **Architectural Scope**: Atomic trial quota checking via `UsageCounter` Durable Object before invoking sizing algorithm; trigger non-blocking `ctx.waitUntil()` sync to Neon when milestone is crossed.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement trial quota middleware with Durable Object binding`**
  * **Rationale**: Enforce hard quota limits at the edge in sub-millisecond time.
  * **Implementation Logic**:
    1. Get DO stub for `c.var.org.org_id` using `env.USAGE_COUNTER.get(id)`.
    2. Call `check_and_decrement_trial` via DO `fetch()`.
    3. If `allowed: false`, return `429 Too Many Requests` (`trial_exhausted`).
    4. If `milestone_crossed: true`, trigger `ctx.waitUntil(syncMilestoneToNeon(env, org_id, usage_remaining))`.
  * **Verification**: Mock DO response and verify 429 response when trial exhausted, and confirm `waitUntil` is invoked.

---

### TASK-P06: Core Sizing Algorithm Pure Function

* **File**: `worker/src/algorithm/sizing.ts`
* **Architectural Scope**: Pure 9-step mathematical translation function converting shopper's reference brand size to target merchant size with 5-signal confidence scoring and boundary detection.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): scaffold 9-step sizing algorithm engine structure`**
  * **Rationale**: Establish clean inputs/outputs and pure function signature for the algorithm.
  * **Implementation Logic**:
    1. Define input parameters (`refGarmentSpec`, `targetSizeChartRows`, `refGarmentType`, `targetFitType`).
    2. Step 1: Extract reference garment measurements (chest midpoint, ease).
    3. Step 2: Deduct reference ease to recover body chest anchor: `body_chest = ref_chest_mid - ref_ease`.

* **Commit 2: `feat(worker): implement NIFT anchor validation and target matching logic`**
  * **Rationale**: Validate recovered body chest against baseline population bounds and match target size.
  * **Implementation Logic**:
    1. Step 3: Check NIFT male chest bounds (80cm - 115cm). Flag out-of-bounds inputs (`below_range`, `above_range`).
    2. Step 4 & 5: Calculate target size fit. For each target size row, compute target body range `[chest_min - ease, chest_max - ease]` and target garment equivalence. Pick size with smallest delta to `body_chest`.

* **Commit 3: `feat(worker): implement 5-signal confidence scoring and penalties`**
  * **Rationale**: Compute transparent confidence percentage (0-100) based on mathematical alignment.
  * **Implementation Logic**:
    1. Step 6: Compute 5 signals:
       - Range Match Precision (0-30 pts)
       - Range Tightness (0-25 pts)
       - Ease Source Trust (0-20 pts)
       - Data Freshness (0-15 pts)
       - Secondary Measurements (Length/Shoulder) (0-10 pts)
    2. Step 7: Apply cross-fit penalty (e.g. -15 pts for slim reference -> oversized target).
    3. Map total score to confidence label (`high` >= 75, `medium` 45-74, `low` < 45).

* **Commit 4: `feat(worker): implement boundary case detection and response formatting`**
  * **Rationale**: Surface dual-size guidance (`suggested_sizes: ["M", "L"]`) when shopper falls near size boundaries.
  * **Implementation Logic**:
    1. Step 8: If `body_chest` is within 1.5cm of target size boundary, set `is_boundary_case: true` and populate `suggested_sizes` with both adjacent sizes.
    2. Step 9: Assemble final JSON payload with reasoning block.
  * **Verification**: Verify algorithm outputs exact JSON matching `PredictResponse` interface.

---

### TASK-P07: Algorithm Unit Tests

* **File**: `worker/src/algorithm/sizing.test.ts`
* **Architectural Scope**: Complete unit test suite validating sizing engine across all edge cases, fit translations, and boundary conditions using Vitest / Cloudflare Workers test runner.

#### Logic Steps as Commits:

* **Commit 1: `test(worker): add comprehensive unit tests for sizing algorithm`**
  * **Rationale**: Ensure 100% test coverage for algorithm core arithmetic.
  * **Implementation Logic**:
    1. Test 1: Exact chest range match (Uniqlo M -> Merchant M).
    2. Test 2: Out-of-bounds inputs (chest < 75cm, chest > 120cm).
    3. Test 3: Boundary proximity detection (body chest 93.8cm -> triggers `is_boundary_case: true` with `["M", "L"]`).
    4. Test 4: Cross-fit penalty (Slim fit reference to Oversized target).
    5. Test 5: Ease source trust multipliers (`explicit` vs `inferred`).
  * **Verification**: Execute `pnpm --filter worker test` and confirm all tests pass.

---

### TASK-P08: `POST /v1/size` Endpoint Handler

* **File**: `worker/src/handlers/size.ts`
* **Architectural Scope**: Main prediction API handler integrating auth, KV fetches, sizing algorithm, and non-blocking `usage_logs` INSERT via `ctx.waitUntil()`.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement POST /v1/size handler with non-blocking logging`**
  * **Rationale**: Connect storefront API request to sizing engine and flush analytics logs.
  * **Implementation Logic**:
    1. Validate request body (`ref_brand`, `ref_garment`, `ref_size`, `shopify_product_id`).
    2. Fetch reference chart from KV (`brand:{ref_brand}:{ref_garment}`).
    3. Fetch merchant size chart from KV (`chart:{org_id}:{ref_garment}`).
    4. Run sizing algorithm.
    5. Execute `ctx.waitUntil()` to insert log record into `usage_logs` in Neon Postgres using restricted connection string.
    6. Return `200 OK` JSON response.
  * **Verification**: Send test POST request via curl/Postman and verify response shape and Neon `usage_logs` insertion.

---

### TASK-P09: `GET /v1/admin/usage` On-Demand Admin Sync Endpoint

* **File**: `worker/src/handlers/adminUsage.ts`
* **Architectural Scope**: Secure internal endpoint called by Rudra's merchant dashboard to fetch live usage from `UsageCounter` DO, update `organizations.trial_requests_remaining` in Neon, and return stats.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement GET /v1/admin/usage on-demand sync handler`**
  * **Rationale**: Provide real-time usage stats to dashboard on page visit and sync edge state to database.
  * **Implementation Logic**:
    1. Verify `X-Internal-Secret` header matches `env.INTERNAL_ADMIN_SECRET`. Return `401` if invalid.
    2. Extract `shop` query parameter. Resolve `org_id` from KV `shop:{shop}` or Neon Postgres.
    3. Call `UsageCounter` DO stub to get exact live usage counts (`get_current_usage`).
    4. Execute `UPDATE organizations SET trial_requests_remaining = ... WHERE id = ...` in Neon Postgres.
    5. Return `{ allowed: boolean, usage_remaining: number, monthly_conversions: number, plan_tier: string }`.
  * **Verification**: Test endpoint with internal secret and confirm Neon DB is updated instantly.

---

### TASK-P10: `GET /v1/product/:product_id` Mapping Lookup

* **File**: `worker/src/handlers/product.ts`
* **Architectural Scope**: Light storefront endpoint allowing widget to check if a Shopify product is mapped to a garment type and active fit size chart.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement GET /v1/product/:product_id mapping lookup`**
  * **Rationale**: Enable storefront widget to determine whether to render sizing modal on product page.
  * **Implementation Logic**:
    1. Read `shopify_product_id` from URL parameter.
    2. Fetch merchant product mappings from KV (`merchant:{org_id}:mappings`).
    3. Return `{ mapped: true, garment_type: "tshirt", is_active: true }` or `{ mapped: false }`.
  * **Verification**: Verify response for mapped and unmapped product IDs.

---

### TASK-P01: Seed NIFT Anthropometric Anchors (Deferred)

* **File**: `packages/db/src/seed/anchors.ts`
* **Architectural Scope**: Populate `anthropometric_anchors` table with Indian NIFT 2020 male population average chest values (XS=82cm, S=86cm, M=91cm, L=96cm, XL=102cm, XXL=108cm). Defer to pre-deployment phase as code logic & engine testing rely on mock/stub objects.

#### Logic Steps as Commits:

* **Commit 1: `feat(db): implement NIFT anthropometric anchor seeding script`**
  * **Rationale**: Provide idempotent seeding mechanism using Drizzle ORM for NIFT population data during pre-deployment setup.
  * **Implementation Logic**:
    1. Define static array of NIFT 2020 male anchors with values: `XS: 82`, `S: 86`, `M: 91`, `L: 96`, `XL: 102`, `XXL: 108`.
    2. Write `seedAnchors()` using `drizzle-orm` with `ON CONFLICT (gender, size_label)` upsert semantics.
    3. Export executable entrypoint in `packages/db/src/seed/anchors.ts`.
  * **Verification**: Run `pnpm --filter @snug/db seed:anchors` and query Neon Postgres to verify 6 rows inserted.

---

### TASK-P02: Seed 10 Reference Brand Size Charts (Deferred)

* **Files**: `packages/db/src/seed/brands.ts`, `packages/db/src/seed/pushToKv.ts`
* **Architectural Scope**: Seed 10 top reference brands (Uniqlo, Zara, H&M, Nike, Adidas, Snitch, Bewakoof, The Souled Store, Mango, Levis) into Neon `brand_size_charts` and sync to Cloudflare KV (`brand:{slug}:{garment}` & `brands:supported`). Defer to pre-deployment integration phase.

#### Logic Steps as Commits:

* **Commit 1: `feat(db): populate reference brand size charts seed data`**
  * **Rationale**: Provide exact physical chest, length, shoulder, and ease values for the 10 core reference brands.
  * **Implementation Logic**:
    1. Create data dictionary for 10 reference brands across standard garment types (`tshirt`, `shirt`, `hoodie`, `jacket`, `polo`, `sweatshirt`).
    2. Include explicit/inferred ease values (`explicit`, `inferred`) and fit types (`slim`, `regular`, `oversized`).
    3. Implement `seedBrands()` with `ON CONFLICT (brand, garment_type, size_label)` upsert into `brand_size_charts`.

* **Commit 2: `feat(db): implement KV push script for brand size charts`**
  * **Rationale**: Enable fast edge reads for Cloudflare Worker by caching brand size charts and supported brand lists in KV.
  * **Implementation Logic**:
    1. Query all brand size charts from Neon.
    2. Group charts by `brand:{slug}:{garment}` and write JSON blobs to Cloudflare KV via REST API / Wrangler client.
    3. Write list of unique brand slugs to `brands:supported` in KV.
  * **Verification**: Verify KV keys via `wrangler kv:key list` and ensure worker reads return <2ms latency.

---

### TASK-P11: Daily Usage Sync Cron (Safety Net)

* **File**: `worker/src/crons/usageSync.ts`
* **Architectural Scope**: Scheduled daily cron job acting as a safety net to aggregate usage, sync DO state to Neon Postgres `organizations.trial_requests_remaining`, and execute billing period rollovers.

#### Logic Steps as Commits:

* **Commit 1: `feat(worker): implement scheduled cron handler for daily usage sync and rollover`**
  * **Rationale**: Ensure database consistency for inactive merchants and handle monthly billing period rollovers automatically.
  * **Implementation Logic**:
    1. Implement Hono / Wrangler `scheduled` event listener in `worker/src/crons/usageSync.ts`.
    2. Query active organizations from Neon Postgres.
    3. For each org, call `UsageCounter` DO to fetch current usage and update `organizations.trial_requests_remaining`.
    4. Check if `billing_period_start` exceeds 30 days; if so, trigger `reset_billing_period` on DO and reset Neon fields.
    5. Log sync execution metrics.
  * **Verification**: Trigger cron via `wrangler dev --test-scheduled` and confirm database update.

---

### TASK-P12: Cloudflare Worker Production Deployment

* **File**: `worker/wrangler.toml`
* **Architectural Scope**: Configure environment variables, KV bindings, DO bindings, secrets, and deploy Worker to Cloudflare production.

#### Logic Steps as Commits:

* **Commit 1: `config(worker): finalize wrangler.toml production bindings and secrets setup`**
  * **Rationale**: Set up production configuration for Cloudflare Workers environment.
  * **Implementation Logic**:
    1. Configure `wrangler.toml` with KV namespace bindings (`SNUG_KV`), Durable Object bindings (`USAGE_COUNTER`), and trigger schedules (`cron = ["0 0 * * *"]`).
    2. Set secrets via `wrangler secret put`: `DATABASE_URL`, `RESTRICTED_DATABASE_URL`, `INTERNAL_ADMIN_SECRET`.
    3. Deploy Worker using `pnpm --filter worker deploy`.
    4. Run smoke test against production worker URL (`POST https://api.snug.app/v1/size`).
  * **Verification**: Production curl test returns `200 OK` and logs appear in Cloudflare dashboard.

---

## Summary Matrix of Delivery Milestones

| Milestone | Tasks Covered | Core Deliverable |
|---|---|---|
| **P1** | TASK-P03 | Repair `UsageCounter` DO compile error & implement milestone checkpoint detection |
| **P2** | TASK-P06, TASK-P07 | Pure 9-step sizing algorithm engine with 5-signal confidence scoring & 100% unit test coverage using in-memory mocks |
| **P3** | TASK-P04, TASK-P05, TASK-P08, TASK-P09, TASK-P10 | Hono API handlers (`POST /v1/size`, `GET /v1/admin/usage`, `GET /v1/product/:product_id`), KV auth middleware, quota rate-limiting |
| **P4** | TASK-P01, TASK-P02, TASK-P11, TASK-P12 | Deferred database seeding (NIFT + 10 brands to Neon & KV), daily cron safety net, production `wrangler.toml` setup, secrets configuration, and Cloudflare Worker deployment |
