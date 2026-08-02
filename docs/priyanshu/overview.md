# Workstream 1: Priyanshu — Sizing Engine, Platform API & Infrastructure

---

## 1. Scope & Ownership

Priyanshu owns the core computation, API endpoints, background cron jobs, database seeding, and real-time usage limiting for Snug. This covers everything that processes shopper sizing requests behind the scenes.

**Status correction (2026-08-02):** The Worker is not production ready. Durable Objects are the current quota authority; Redis is deferred until scale requires it. See [../issues.md](../issues.md) for the active blockers.

### Core Components Owned:
* **Cloudflare Worker Sizing API (`worker/`)**: Endpoint handlers (`POST /v1/size`, `GET /v1/admin/usage`, `GET /v1/product/:product_id`), Hono routing, algorithm implementation, origin/API key auth, and CORS.
* **Usage Limit Enforcement & Checkpoints (`worker/src/durable-objects/UsageCounter.ts`)**: 
  - Cloudflare Durable Objects (`UsageCounter`) are intended to provide serialized trial quota checks at the edge; first-use handling must be fixed before deployment (W-02).
  - **Milestone Checkpoint Sync**: The `waitUntil()` integration exists as a scaffold, but Neon persistence is not implemented (W-03).
* **On-Demand Admin Usage API (`GET /v1/admin/usage`)**: Endpoint scaffold used by Rudra's dashboard to fetch live DO usage. It requires secure secret handling and real Neon persistence (W-01, W-03).
* **Sizing Algorithm Engine (`worker/src/algorithm/`)**: Pure 9-step mathematical translation function, 5-signal confidence scoring, cross-fit penalties, boundary case detection (`is_boundary_case: true`), and unit tests.
* **Data Seeding & Reference Data (`packages/db/src/seed/`)**: Seeding NIFT population anchors and 10 reference brand size charts into Neon & Cloudflare KV.
* **Daily Database Sync Cron (`worker/src/crons/`)**: Planned reconciliation job to sync Durable Object counters to Neon Postgres (`organizations.trial_requests_remaining`) and execute billing period rollovers. It does not exist yet.

---

## 2. Shared Contracts & Interdependencies with Rudra

### A. Cloudflare KV Key Structures (Priyanshu Reads / Rudra Writes)
* **`apikey:{api_key}`**:
  * *Priyanshu's Worker reads this on every `POST /v1/size` request for authentication and trial usage check.*
  * *Shape*: `{ org_id: string, shop: string, plan_tier: 'trial' | 'paid', trial_requests_remaining: number, widget_active: boolean }`
* **`chart:{org_id}:{garment_type}`**:
  * *Priyanshu's Worker reads merchant size chart when evaluating size prediction.*
* **`brand:{slug}:{garment_type}`**:
  * *Priyanshu seeds and reads reference brand size chart data.*

### B. Admin Usage On-Demand Sync Contract (`GET /v1/admin/usage`)
* **Headers**: `X-Internal-Secret: <INTERNAL_ADMIN_SECRET>`
* **Query Parameters**: `?shop=my-store.myshopify.com`
* **Worker Execution**:
  1. Resolves `org_id` for `shop`.
  2. Reads exact live usage counts from `UsageCounter` DO.
  3. Intended: updates `organizations.trial_requests_remaining` in Neon (not implemented yet).
  4. Responds with `{ allowed: boolean, usage_remaining: number, monthly_conversions: number, plan_tier: string }`.

### C. Storefront API Contract (`POST /v1/size`)
* **Headers**: `X-Snug-Key`, `Origin`
* **Request Body**:
  ```json
  {
    "ref_brand": "uniqlo",
    "ref_garment": "tshirt",
    "ref_size": "L",
    "shopify_product_id": "gid://shopify/Product/12345"
  }
  ```
* **Response Body**:
  ```json
  {
    "predicted_size": "M",
    "confidence": 88,
    "confidence_label": "high",
    "is_boundary_case": false,
    "suggested_sizes": ["M"],
    "reasoning": "Fits well based on chest measurement alignment"
  }
  ```

---

## 3. High-Level Delivery Milestones

1. **Milestone P1 [BLOCKED]**: Repair `UsageCounter` optional-row handling and establish authoritative counter initialization (W-02, W-04).
2. **Milestone P2 [COMPLETED]**: Built and unit-tested the pure 9-step sizing algorithm engine (`sizing.ts`) with 5-signal confidence scoring, cross-fit penalties, boundary case detection, and 100% Vitest coverage (`sizing.test.ts`).
3. **Milestone P3 [IN PROGRESS]**: Complete secure storefront/admin auth, runtime validation, real Neon analytics/sync, and Worker-runtime integration tests.
4. **Milestone P4 [IN PROGRESS]**: Perform deferred database seeding (NIFT anchors + 10 reference brand charts into Neon & KV), implement daily DO -> Neon Postgres reconciliation, and deploy Worker to Cloudflare production.
