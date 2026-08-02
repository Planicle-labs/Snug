# Priyanshu — Actionable Task Breakdown

**Current status:** Durable Objects are the quota authority. Redis is deferred. Task completion below is superseded by the deployment blockers in [../issues.md](../issues.md).

---

## 1. Worker Scaffolding & Durable Object Logic

- [ ] **TASK-P03: Repair UsageCounter Durable Object & Milestone Checkpoints**
  - **File**: `worker/src/durable-objects/UsageCounter.ts`
  - **Details**: Replace `SqlStorageCursor.one()` calls used for optional query results, make first-use initialization reachable and atomic, and define how the authoritative initial allowance enters the DO.
  - **Milestone Checkpoints**: When usage hits specific checkpoints (e.g. 100, 200, 300, 400, 500 requests used or 20%, 50%, 80%, 100%), return `milestone_crossed: true` in DO response to trigger non-blocking `ctx.waitUntil()` sync to Neon Postgres.

- [ ] **TASK-P04: Harden Hono Middleware Setup**
  - **File**: `worker/src/middleware/auth.ts`, `worker/src/middleware/cors.ts`
  - **Details**: Implement API-key lookup in KV and retain Origin validation as browser defence in depth; do not treat Origin or a client-visible key as sufficient authorization. Add runtime validation and standard HTTP 400/401/422/429 responses.

- [ ] **TASK-P05: Complete Edge Quota Middleware**
  - **File**: `worker/src/middleware/rateLimit.ts`
  - **Details**: Call `UsageCounter` DO to authorize valid trial predictions atomically. Do not charge malformed or unsupported requests. Implement the checkpoint persistence invoked by `ctx.waitUntil()`.

---

## 2. Sizing Algorithm Engine

- [x] **TASK-P06: Core Sizing Algorithm Pure Function**
  - **File**: `worker/src/algorithm/sizing.ts`
  - **Details**: Implement the 9-step calculation pipeline:
    1. Resolve reference brand garment specs from KV.
    2. Deduct reference ease to extract body chest/shoulder values.
    3. Validate extracted body values against NIFT anchors (stubbed for v0).
    4. Fetch target merchant size chart from KV (`chart:{org_id}:{garment}`).
    5. Calculate target size match via body space delta minimization.
    6. Compute 5-signal confidence score (0-100).
    7. Apply cross-fit penalty (e.g., slim fit reference to oversized target).
    8. Detect boundary cases (`is_boundary_case: true`) and produce alternate size suggestions (`suggested_sizes: ["M", "L"]`).
    9. Format JSON response object.

- [x] **TASK-P07: Algorithm Unit Tests**
  - **File**: `worker/src/algorithm/sizing.test.ts`
  - **Details**: Test exact range match, cross-brand translation, boundary proximity, cross-fit penalties, and ease source trust multipliers with 100% Vitest coverage.

---

## 3. API Handlers & Endpoints

- [ ] **TASK-P08: Complete `POST /v1/size` Endpoint Handler**
  - **File**: `worker/src/handlers/size.ts`
  - **Details**: Integrate secure auth, validated KV fetches, sizing algorithm, correct target fit-type handling, and a real non-blocking write to `usage_logs`.

- [ ] **TASK-P09: Secure and complete `GET /v1/admin/usage`**
  - **File**: `worker/src/handlers/adminUsage.ts`
  - **Details**: Fail closed without `INTERNAL_ADMIN_SECRET`, fetch real-time usage from `UsageCounter`, execute the Neon update, and return `{ usage_remaining, monthly_conversions }`.

- [x] **TASK-P10: `GET /v1/product/:product_id` Mapping Lookup**
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
  - **Details**: Create explicit environments, declare required secrets (`DATABASE_URL`, `INTERNAL_ADMIN_SECRET`), generate binding types, enable observability, and deploy only after W-01 through W-04 pass.
