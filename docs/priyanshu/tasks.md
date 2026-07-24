# Priyanshu — Actionable Task Breakdown

---

## 1. Worker Scaffolding & Durable Object Logic

- [x] **TASK-P03: Complete UsageCounter Durable Object & Milestone Checkpoints**
  - **File**: `worker/src/durable-objects/UsageCounter.ts`
  - **Details**: Complete incomplete `if (body.action)` block (line 97), handling `check_and_decrement_trial` (1000 trial limit), `record_conversion`, `get_current_usage`, and `reset_billing_period`.
  - **Milestone Checkpoints**: When usage hits specific checkpoints (e.g. 100, 200, 300, 400, 500 requests used or 20%, 50%, 80%, 100%), return `milestone_crossed: true` in DO response to trigger non-blocking `ctx.waitUntil()` sync to Neon Postgres.

- [x] **TASK-P04: Hono Middleware Setup**
  - **File**: `worker/src/middleware/auth.ts`, `worker/src/middleware/cors.ts`
  - **Details**: Implement API key lookup in KV (`apikey:{key}`) and Origin header validation for storefront requests. Return standard HTTP 401/422/429 JSON errors.

- [x] **TASK-P05: Edge Rate-Limiting & Quota Middleware**
  - **File**: `worker/src/middleware/rateLimit.ts`
  - **Details**: Call `UsageCounter` DO on each request to check and decrement trial request allowance atomically with sub-millisecond edge latency. If `milestone_crossed` is true, invoke non-blocking `ctx.waitUntil()` DB sync.

---

## 2. Sizing Algorithm Engine

- [ ] **TASK-P06: Core Sizing Algorithm Pure Function**
  - **File**: `worker/src/algorithm/sizing.ts`
  - **Details**: Implement the 9-step calculation pipeline:
    1. Resolve reference brand garment specs from KV.
    2. Deduct reference ease to extract body chest/shoulder values.
    3. Validate extracted body values against NIFT anchors.
    4. Fetch target merchant size chart from KV (`chart:{org_id}:{garment}`).
    5. Calculate target size match.
    6. Compute 5-signal confidence score (0-100).
    7. Apply cross-fit penalty (e.g., slim fit reference to oversized target).
    8. Detect boundary cases (`is_boundary_case: true`) and produce alternate size suggestions (`suggested_sizes: ["M", "L"]`).
    9. Format JSON response object.

- [ ] **TASK-P07: Algorithm Unit Tests**
  - **File**: `worker/src/algorithm/sizing.test.ts`
  - **Details**: Test exact range match, out-of-bounds inputs, boundary proximity, cross-fit translations, and missing measurement fallbacks.

---

## 3. API Handlers & Endpoints

- [ ] **TASK-P08: `POST /v1/size` Endpoint Handler**
  - **File**: `worker/src/handlers/size.ts`
  - **Details**: Integrate auth, KV fetches, sizing algorithm, and trigger non-blocking log write to `usage_logs` via `ctx.waitUntil()`.

- [ ] **TASK-P09: `GET /v1/admin/usage` On-Demand Admin Sync Endpoint**
  - **File**: `worker/src/handlers/adminUsage.ts`
  - **Details**: Handle dashboard requests to fetch real-time usage stats from `UsageCounter` DO, execute `UPDATE organizations SET trial_requests_remaining = ...` in Neon Postgres, and return `{ usage_remaining, monthly_conversions }`.

- [ ] **TASK-P10: `GET /v1/product/:product_id` Mapping Lookup**
  - **File**: `worker/src/handlers/product.ts`
  - **Details**: Return whether a Shopify product is mapped to a garment type and active fit size chart.

---

## 4. Deferred Database Seeding & Reference Data

- [ ] **TASK-P01: Seed NIFT Anthropometric Anchors**
  - **File**: `packages/db/src/seed/anchors.ts`
  - **Details**: Insert NIFT 2020 male population average chest values (XS=82cm, S=86cm, M=91cm, L=96cm, XL=102cm, XXL=108cm) into `anthropometric_anchors`. Deferred to pre-deployment integration phase.

- [ ] **TASK-P02: Seed 10 Reference Brand Size Charts**
  - **File**: `packages/db/src/seed/brands.ts`
  - **Details**: Populate `brand_size_charts` table with real measurements for 10 top brands (Uniqlo, Zara, H&M, Nike, Adidas, Snitch, Bewakoof, The Souled Store, Mango, Levis).
  - **KV Push Script**: Add a script to populate `brand:{slug}:{garment}` keys in Cloudflare KV. Deferred to pre-deployment integration phase.

---

## 5. Background Crons & Deployment

- [ ] **TASK-P11: Daily Usage Sync Cron (Safety Net)**
  - **File**: `worker/src/crons/usageSync.ts`
  - **Details**: Scheduled daily cron job to query active `UsageCounter` DOs, aggregate total usage, update `organizations.trial_requests_remaining` in Neon Postgres, and write sync logs.

- [ ] **TASK-P12: Cloudflare Worker Production Deployment**
  - **Details**: Configure production environment secrets (`DATABASE_URL`, `KV`, `USAGE_COUNTER`, `INTERNAL_ADMIN_SECRET`) in `wrangler.toml` and deploy Worker.
