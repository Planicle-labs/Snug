# Workstream 1: Priyanshu — Sizing Engine, Platform API & Infrastructure

---

## 1. Scope & Ownership

Priyanshu owns the core computation, API endpoints, background cron jobs, database seeding, and real-time usage limiting for Snug. This covers everything that processes shopper sizing requests behind the scenes.

### Core Components Owned:
* **Cloudflare Worker Sizing API (`worker/`)**: Endpoint handlers (`POST /v1/size`, `GET /v1/admin/usage`, `GET /v1/product/:product_id`), Hono routing, algorithm implementation, origin/API key auth, and CORS.
* **Usage Limit Enforcement & Checkpoints (`worker/src/durable-objects/UsageCounter.ts`)**: 
  - Cloudflare Durable Objects (`UsageCounter`) providing single-threaded sub-millisecond trial quota checks & atomic request decrements at the edge.
  - **Milestone Checkpoint Sync**: Triggers non-blocking `ctx.waitUntil()` writes to Neon Postgres whenever usage crosses milestone checkpoints (e.g. 100, 200, 300, 400, 500 requests used).
* **On-Demand Admin Usage API (`GET /v1/admin/usage`)**: Endpoint called by Rudra's dashboard on page visit to fetch real-time usage stats from DO and immediately sync/persist to Neon Postgres.
* **Sizing Algorithm Engine (`worker/src/algorithm/`)**: Pure 9-step mathematical translation function, 5-signal confidence scoring, cross-fit penalties, boundary case detection (`is_boundary_case: true`), and unit tests.
* **Data Seeding & Reference Data (`packages/db/src/seed/`)**: Seeding NIFT population anchors and 10 reference brand size charts into Neon & Cloudflare KV.
* **Daily Database Sync Cron (`worker/src/crons/`)**: Daily background sync job acting as a safety net to sync Durable Object counters to Neon Postgres (`organizations.trial_requests_remaining`) and execute billing period rollovers.

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
  3. Updates `organizations.trial_requests_remaining` in Neon.
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

1. **Milestone P1**: Fix `UsageCounter` DO compile error and add milestone checkpoint triggers.
2. **Milestone P2**: Build and unit-test the pure 9-step sizing algorithm engine with boundary case detection using isolated in-memory test mocks.
3. **Milestone P3**: Wire `POST /v1/size` with KV lookups, `UsageCounter` DO checks, milestone `ctx.waitUntil()` DB sync, and `GET /v1/admin/usage` endpoint.
4. **Milestone P4**: Perform deferred database seeding (NIFT anchors + 10 reference brand charts into Neon & KV), implement daily DO -> Neon Postgres sync cron job, and deploy Worker to Cloudflare production.
