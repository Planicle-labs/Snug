# Snug — Complete Technical Architecture

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Full Technology Stack](#2-full-technology-stack)
3. [Component Roles](#3-component-roles)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [UML Sequence Diagrams](#5-uml-sequence-diagrams)
6. [Infrastructure Topology](#6-infrastructure-topology)
7. [Database Schema](#7-database-schema)
8. [Security Model](#8-security-model)
9. [Failure Modes and Fallbacks](#9-failure-modes-and-fallbacks)
10. [Locked Decisions](#10-locked-decisions)

---

## 1. System Overview

Snug is a Shopify app that solves online apparel sizing inconsistency across brands. A shopper on a merchant's product page tells the widget what brand they already own and what size they wear in it. The system translates that into the correct size for the merchant's brand using garment measurements and ease values as the mathematical bridge.

The system has three distinct runtime surfaces:

| Surface | What it does | Who uses it |
|---|---|---|
| Storefront widget | Renders on product pages, collects shopper input, displays recommendation | Shoppers |
| Cloudflare Worker | Receives prediction requests, authenticates via API key, runs sizing algorithm, enforces usage limits | Called by widget |
| Remix dashboard | Embedded in Shopify Admin, merchant configuration and analytics | Merchants |

These three surfaces share three pieces of infrastructure: Neon Postgres as the source of truth, Cloudflare KV as the hot-path cache and auth store, and Upstash Redis for usage cap enforcement and burst protection.

---

## 2. Full Technology Stack

### Storefront Layer

| Component | Technology | Why |
|---|---|---|
| Widget UI | Vanilla JavaScript | Zero framework weight. Every framework adds kilobytes that penalise the merchant's Lighthouse score. The widget loads on every product page view. |
| Widget delivery | Cloudflare CDN | Sub-50ms asset delivery across India. More Indian edge locations than any competing CDN. |
| Widget injection | Shopify Theme App Extension | Required for App Store approval. Sandboxed, auditable, removes cleanly on uninstall. Apps injecting arbitrary script tags are rejected. |

### API Layer

| Component | Technology | Why |
|---|---|---|
| Runtime | Cloudflare Workers | V8 isolates — zero cold starts, ever. Vercel Functions and AWS Lambda have 100–400ms cold starts which makes the widget appear broken. Deploys globally to all Cloudflare edge locations automatically. |
| Router | Hono.js | The standard lightweight router built for the Workers runtime. Express and Fastify depend on Node.js APIs that do not exist in Workers. |
| Language | TypeScript | The sizing algorithm involves precise arithmetic across multiple data fields. TypeScript catches shape mismatches between KV payloads and algorithm inputs at compile time not runtime. |

### Cache and Auth Layer

| Component | Technology | Why |
|---|---|---|
| Hot-path cache and API key store | Cloudflare KV | Sub-millisecond reads because KV data is colocated at the same edge node as the Worker. Stores brand size charts, merchant org records, and API key mappings for validation. |
| Usage enforcement and burst limiting | Upstash Redis | The only option that is both atomic (INCR/DECR) and accessible over HTTP from Workers. Standard Redis uses TCP which Workers cannot open. KV has no atomic operations so cannot safely increment or decrement a counter under concurrent load. Redis is the enforcement gate for both monthly usage caps (atomic DECR) and per-minute burst limits (atomic INCR). |

### Database Layer

| Component | Technology | Why |
|---|---|---|
| Primary database | Neon Postgres | Serverless Postgres with an HTTP driver (`@neondatabase/serverless`) that works from Workers. Standard Postgres clients use TCP which Workers do not support. Scales to zero when idle — zero cost during development. |
| ORM | Drizzle ORM | Pure TypeScript, no native binary dependencies. Prisma uses a compiled Rust query engine that cannot run inside a V8 isolate. |

### Dashboard Layer

| Component | Technology | Why |
|---|---|---|
| Framework | Shopify React Router App Template (React Router v7) | Ships pre-configured with App Bridge, OAuth middleware, session token verification, and HMAC validation. Building this from scratch would take weeks and introduce significant security risk. |
| Component library | Shopify Polaris | Required for App Store approval. Embedded apps must match the Shopify Admin design system. |
| Session storage | `@shopify/shopify-app-session-storage-drizzle` | Official Shopify adapter connecting the React Router auth middleware to Drizzle and Neon instead of the default Prisma and SQLite. |
| Host | Railway | Full Node.js environment with persistent processes. Vercel serverless functions have execution time limits that can interfere with Shopify session token verification. |

### Background Jobs

| Component | Technology | Why |
|---|---|---|
| Usage sync cron | Node.js script on Railway | Runs every few minutes. Reads `usage_logs`, recomputes `usage_remaining` per merchant, writes back to Neon and Redis. Co-located with the Remix app on Railway — no separate service needed. |
| Billing period rollover cron | Node.js script on Railway | Runs once per day. Checks `billing_period_start` per merchant, resets usage counters on period rollover. Separate from usage sync due to different cadence. |

---

## 3. Component Roles

### Cloudflare Worker

The core of the product. Every shopper prediction request flows through here. The Worker has no persistent state of its own — it reads from KV and Redis, computes the prediction, writes a log row to Neon, and returns the result.

**Responsibilities:**
- Validate the request API key against `apikey:{key}` in KV
- Validate the request Origin header as secondary defense
- Enforce monthly usage cap via Redis atomic DECR on `usage:{org_id}`
- Enforce burst rate limits via Redis INCR on `rl:{org_id}:{minute_bucket}`
- Validate all prediction inputs
- Fetch reference brand size data from KV
- Fetch merchant size chart data from KV
- Run the nine-step sizing algorithm
- Compute the confidence score from five weighted signals
- Return the prediction response
- Write one `usage_logs` row to Neon via `ctx.waitUntil()` (non-blocking)

**What the Worker does NOT do:**
- Write to any table other than `usage_logs`
- Read from Neon on the critical path
- Manage merchant configuration
- Handle Shopify OAuth or webhooks
- Know anything about billing beyond reading the Redis usage counter

**Database access:** Restricted Neon connection string. INSERT on `usage_logs` only. Cannot read, update, or delete any row in any other table.

---

### Cloudflare KV

The hot-path cache and the API key validation store. Every value the Worker needs on the critical path lives here. Reads are sub-millisecond because KV data is physically colocated at the same edge node as the Worker executing the request.

**What is stored in KV:**

| Key pattern | Value | Written by | TTL |
|---|---|---|---|
| `apikey:{api_key}` | `{ org_id, shop_domain, widget_active, plan_tier }` | OAuth callback on install, dashboard on key rotation | No TTL |
| `shop:{shop_domain}` | `{ org_id, plan_tier, widget_active }` | OAuth callback, cron job, uninstall webhook | No TTL |
| `chart:{brand}:{garment}:{size}` | Full reference brand size row as JSON | Scraper pipeline after each run | 8 days |
| `chart:{brand}:{garment}:all` | All size rows for brand and garment as JSON array | Scraper pipeline after each run | 8 days |
| `brands:supported` | JSON array of all supported reference brand names | Scraper pipeline after each run | 8 days |
| `garments:supported` | JSON array of supported garment type enum values | Seeded at setup | No TTL |
| `merchant:{org_id}:charts:{garment}` | Merchant fit_size_charts rows for a garment type | Dashboard on save, cron job | No TTL |

**What KV is NOT used for:**
- Usage counters (no atomic operations — moved to Redis)
- Burst rate limit counters (same reason)
- Session storage
- Any data requiring transactional consistency

---

### Upstash Redis

Dual purpose: monthly usage cap enforcement via atomic DECR, and burst rate limiting via atomic INCR. Nothing else in the system touches Redis.

**Monthly usage cap:**

Key structure: `usage:{org_id}`

On every prediction request the Worker does an atomic DECR on `usage:{org_id}`. If the result goes below zero the request is rejected with 429 and the counter is INCR'd back. This closes the race condition that would exist if KV were the enforcement layer.

Counter lifecycle: the usage sync cron sets `usage:{org_id}` to the correct `usage_remaining` value on each run computed from Neon. On billing period rollover the billing cron resets the counter to the plan limit. If Redis loses the counter due to ephemeral storage, the cron rebuilds it from Neon on the next run.

**Burst rate limiting:**

Key structure: `rl:{org_id}:{minute_bucket}` where `minute_bucket = floor(Date.now() / 60000)`

TTL: 120 seconds on every key to prevent gaps at window boundaries.

Burst limits are plan-specific. Exact values are deferred until billing plans are finalised.

**Failure behaviour:** If Redis is unreachable the Worker fails open — the request proceeds without burst checking or usage enforcement. This is intentional. Blocking a shopper from a size recommendation because internal rate limiting infrastructure is down is a worse outcome than temporarily unenforced limits. The failure is logged to console and the cron job corrects any drift on next run.

---

### Neon Postgres

The source of truth for everything. The only permanent store. Every other system — KV and Redis — is a cache or a temporary counter derived from Neon data.

**Who reads and writes each table:**

| Table | Read by | Written by |
|---|---|---|
| `sessions` | React Router OAuth middleware | Shopify session adapter |
| `organizations` | Dashboard, cron job | OAuth callback, dashboard, uninstall webhook |
| `widget_configs` | Dashboard | Dashboard |
| `fit_size_charts` | Dashboard, cron job (for KV push) | Dashboard |
| `garment_mappings` | Dashboard | Dashboard |
| `usage_logs` | Cron job, analytics routes | Cloudflare Worker only (restricted connection) |
| `brand_size_charts` | Cron job (for KV push) | Scraper pipeline |
| `anthropometric_anchors` | Scraper pipeline (for ease inference) | Seeded once at setup |
| `brand_requests` | Dashboard | Dashboard |
| `scrape_runs` | Dashboard (operational visibility) | Scraper pipeline |

**Two connection strings:**
- Full access: used by the dashboard and cron jobs
- Restricted (INSERT on `usage_logs` only): used by the Cloudflare Worker

---

### React Router Dashboard App

The merchant-facing configuration interface. Runs on Railway, renders inside the Shopify Admin as an iframe. Merchants never navigate to a standalone URL — they access everything through Shopify.

**Responsibilities:**
- Handle Shopify OAuth install flow including HMAC validation, token exchange, and token storage
- Handle session token verification on every authenticated request
- Generate silent API key on install, store in Neon and KV, inject into Theme App Extension config
- Register webhooks on install
- Serve the onboarding flow: brand configuration, fit size chart creation, widget activation
- Let merchants create and manage fit size charts per garment type
- Let merchants map Shopify products to garment types with optional chart overrides
- Show analytics: recommendation volume, confidence distribution, top sizes, boundary case rate
- Show usage remaining against plan limit
- Handle brand requests
- Handle `app/uninstalled` webhook: set `widget_active = false` in Neon and KV, scrub access token
- Handle `shop/redact` webhook: delete all merchant data from Neon (GDPR mandatory)
- Handle `customers/redact` and `customers/data_request` webhooks: acknowledge and return 200 (Snug stores no customer-level data)

**What the dashboard does NOT do:**
- Serve shopper-facing content
- Run the sizing algorithm
- Manage Redis directly — cron job handles Redis sync

---

### Storefront Widget

The shopper-facing UI. A vanilla JS bundle injected via Theme App Extension. Renders on every product page where the merchant has mapped the product to a garment type.

**Responsibilities:**
- Read the API key from Theme App Extension config (injected automatically on install, never visible to merchant)
- Detect the current Shopify product ID from page context
- Call Worker to check if this product has a garment mapping
- Render the three-input form: reference brand, garment type, size label
- POST to the Worker `/v1/size` endpoint with `X-Snug-Key` header
- Display predicted size, confidence label, and suggested sizes
- Handle boundary cases: show two size options with fit preference guidance
- Handle error states: brand not found, size not found, monthly limit reached

**What the widget does NOT do:**
- Store any data locally
- Use cookies or session state
- Communicate directly with Neon or Shopify APIs
- Display `extra_measurements` data in the prediction UI — those are for the merchant's storefront size chart display only

---

### Cron Jobs (Railway)

Two separate jobs co-located with the dashboard on Railway.

**Usage sync cron (runs every few minutes):**
- For each active organization: count `usage_logs` rows since `billing_period_start`, compute `usage_remaining`, write to `organizations` in Neon, set `usage:{org_id}` counter in Redis, update `shop:{shop_domain}` in KV
- If Redis counter is missing due to ephemeral storage loss: rebuild from Neon count
- Push updated merchant fit chart data to KV after any dashboard save (can also be triggered directly by dashboard on save as an optimisation)

**Billing period rollover cron (runs once per day):**
- For each organization where `billing_period_start` is older than one billing period: reset `usage_remaining` to plan limit in Neon, reset `usage:{org_id}` in Redis to plan limit, update `billing_period_start` to now, update KV entry

---

### Scraper Pipeline

Async background service. Runs on a weekly schedule. The only component that writes to `brand_size_charts` and `scrape_runs`. Never called by any other component.

**Responsibilities:**
- Visit reference brand websites and extract size chart data
- Compute ease values using three ranked sources: explicit from brand, inferred from `anthropometric_anchors`, or user-calibrated from accumulated declarations
- Write or upsert rows to `brand_size_charts` in Neon
- Write a row to `scrape_runs` recording status, rows written, and any errors
- Push updated brand data to Cloudflare KV after each successful run

---

## 4. Data Flow Diagrams

### 4.1 Merchant Install Flow

```
Merchant clicks Install on Shopify App Store
        │
        ▼
Shopify redirects to /auth?shop=store.myshopify.com
        │
        ▼
React Router validates HMAC signature
        │
        ▼
React Router redirects merchant to Shopify OAuth consent screen
        │
        ▼
Merchant approves scopes:
  write_themes, read_themes, read_products,
  read_orders, read_customers
        │
        ▼
Shopify POSTs authorization code to /auth/callback
        │
        ▼
React Router exchanges code for permanent offline access token
        │
        ├──► Write session row to Neon (sessions table)
        │
        ├──► Create organization row in Neon
        │      org_id, shop_domain, plan_tier={default},
        │      usage_remaining={plan_limit},
        │      billing_period_start=now(),
        │      onboarding_complete=false,
        │      widget_active=false
        │
        ├──► Generate silent API key (crypto.randomUUID, never shown to merchant)
        │      Store api_key in organizations row in Neon
        │
        ├──► Create widget_configs row with defaults
        │
        ├──► Write KV entries:
        │      apikey:{api_key} → { org_id, shop_domain, widget_active: false, plan_tier }
        │      shop:{domain}   → { org_id, plan_tier, widget_active: false }
        │
        ├──► Set Redis counter: usage:{org_id} = {plan_limit}
        │
        ├──► Inject API key into Theme App Extension metafield config
        │      Merchant never sees or manages this key
        │      Widget reads it automatically from extension config
        │
        └──► Register webhooks with Shopify Admin API:
               app/uninstalled          → /webhooks/app/uninstalled
               shop/redact              → /webhooks/shop/redact
               customers/redact         → /webhooks/customers/redact
               customers/data_request   → /webhooks/customers/data_request
        │
        ▼
Shopify redirects merchant into embedded dashboard
        │
        ▼
Merchant sees onboarding flow:
  Step 1: Search for and confirm brand slug
  Step 2: Create first fit size chart
  Step 3: Map products to garment types
  Step 4: Activate widget via theme editor deep link
        │
        ▼
On completion:
  onboarding_complete = true
  widget_active = true
  KV entries updated
```

---

### 4.2 Shopper Prediction Request Flow

```
Shopper opens merchant product page
        │
        ▼
Widget JS loads via Theme App Extension from Cloudflare CDN
        │
        ▼
Widget reads API key from Theme App Extension config
Widget reads Shopify product ID from page context
        │
        ▼
Worker receives GET /v1/product/{product_id}
  KV lookup: merchant:{org_id}:charts:{garment}
  Returns garment_type if mapped, null if not
        │
        ├── [Not mapped] Widget renders "not available" state, exits
        │
        └── [Mapped] Widget renders input form
                │
                ▼
        Shopper selects:
          ref_brand:   e.g. "uniqlo"
          ref_garment: e.g. "hoodie"
          ref_size:    e.g. "M"
                │
                ▼
        Widget POSTs to Worker: POST /v1/size
          Headers: X-Snug-Key: {api_key}
                   Origin: merchant-store.myshopify.com
                │
                ▼
        ┌────────────────────────────────────────┐
        │           WORKER EXECUTION             │
        │                                        │
        │ Step 1: KV lookup apikey:{key}         │
        │   → { org_id, shop_domain,             │
        │       widget_active, plan_tier }        │
        │   Key not found → 401                  │
        │   widget_active false → 403            │
        │                                        │
        │ Step 2: Check Origin header            │
        │   Must match shop_domain from KV       │
        │   Mismatch → 401 (secondary defense)   │
        │                                        │
        │ Step 3: Redis DECR usage:{org_id}      │
        │   Result < 0 → INCR back, return 429   │
        │   { error: monthly_limit_reached }     │
        │                                        │
        │ Step 4: Redis INCR rl:{org}:{minute}   │
        │   Exceeds burst limit → return 429     │
        │   { error: burst_limit_exceeded }      │
        │                                        │
        │ Step 5: Validate inputs                │
        │   ref_brand in KV brands:supported     │
        │   ref_garment in KV garments:supported │
        │   ref_size exists for brand+garment    │
        │   Any invalid → 422                    │
        │                                        │
        │ Step 6: KV fetch ref brand row         │
        │   chart:{brand}:{garment}:{size}       │
        │                                        │
        │ Step 7: KV fetch merchant charts       │
        │   merchant:{org_id}:charts:{garment}   │
        │                                        │
        │ Step 8: Run nine-step sizing algorithm │
        │   Compute confidence score             │
        │   Apply penalties if applicable        │
        │                                        │
        │ Step 9: Return 200 response            │
        │   predicted_size, confidence,          │
        │   confidence_label, suggested_sizes,   │
        │   is_boundary_case, reasoning, meta    │
        │                                        │
        │ Step 10: ctx.waitUntil()               │
        │   INSERT usage_logs row (non-blocking) │
        └────────────────────────────────────────┘
                │
                ▼
        Widget displays result to shopper
```

---

### 4.3 Usage Cap Enforcement Flow

```
Worker receives prediction request
        │
        ▼
Redis: DECR usage:{org_id}
        │
        ├── [Result >= 0] Request proceeds normally
        │
        └── [Result < 0]
                │
                ▼
        Redis: INCR usage:{org_id} (restore counter)
                │
                ▼
        Return 429:
          { error: "monthly_limit_reached",
            message: "Monthly prediction limit reached.
                      Upgrade your plan to continue." }

─────────────────────────────────────────────

Every few minutes — Usage sync cron runs
        │
        ▼
For each active organization in Neon:
        │
        ▼
SELECT COUNT(*) FROM usage_logs
WHERE org_id = x
AND created_at >= billing_period_start
        │
        ▼
usage_remaining = plan_limit - count
        │
        ├──► UPDATE organizations
        │      SET usage_remaining = n, updated_at = now()
        │      WHERE org_id = x
        │
        ├──► Redis SET usage:{org_id} = n
        │      (replaces atomic counter with ground truth from Neon)
        │
        └──► KV write: shop:{domain}
               { org_id, plan_tier, widget_active }
               (includes updated context for Worker reads)

─────────────────────────────────────────────

Once per day — Billing period rollover cron runs
        │
        ▼
For each organization where billing period has elapsed:
        │
        ├──► UPDATE organizations
        │      SET usage_remaining = plan_limit,
        │          billing_period_start = now()
        │
        └──► Redis SET usage:{org_id} = plan_limit
               (reset enforcement counter to full plan limit)
```

---

### 4.4 Merchant Uninstall Flow

```
Merchant uninstalls Snug from Shopify Admin
        │
        ▼
Shopify POSTs to /webhooks/app/uninstalled
        │
        ▼
Webhook handler verifies HMAC signature
        │
        ▼
        ├──► DELETE sessions WHERE shop = shop_domain
        │      (scrub access token immediately)
        │
        ├──► UPDATE organizations
        │      SET widget_active = false
        │      WHERE shop_domain = x
        │
        └──► KV write: apikey:{api_key}
               { ..., widget_active: false }
             KV write: shop:{domain}
               { ..., widget_active: false }
        │
        ▼
Any in-flight Worker requests:
  Next KV read of apikey:{key} sees widget_active: false
  Worker returns 403 immediately
  KV propagates globally within 1–5 seconds
        │
        ▼
Merchant data retained in Neon for 30-day grace period
(allows clean reinstatement if merchant reinstalls)
        │
        ▼
shop/redact webhook fires after 30 days (Shopify-initiated)
        │
        ▼
Webhook handler deletes all merchant rows from Neon:
  DELETE FROM usage_logs WHERE org_id = x
  DELETE FROM fit_size_charts WHERE org_id = x
  DELETE FROM garment_mappings WHERE org_id = x
  DELETE FROM widget_configs WHERE org_id = x
  DELETE FROM brand_requests WHERE org_id = x
  DELETE FROM organizations WHERE org_id = x
```

---

### 4.5 Scraper Pipeline Flow

```
Weekly cron trigger fires
        │
        ▼
For each brand in target reference brand list:
        │
        ▼
Fetch brand website size chart pages
        │
        ▼
Parse size chart data:
  size_label, chest_min_cm, chest_max_cm,
  length_min_cm, length_max_cm,
  shoulder_min_cm, shoulder_max_cm,
  fit_type
        │
        ▼
Determine ease source (ranked):
        │
        ├── Source A: brand explicitly states ease value
        │     ease_source = 'explicit', trust = 1.00
        │
        ├── Source B: infer from anthropometric_anchors
        │     ease = midpoint(chest_range) - avg_chest_for_size
        │     ease_source = 'inferred', trust = 0.75
        │
        └── Source C: user-calibrated (50+ declarations exist)
              ease = midpoint(chest_range) - mean(body_anchors)
              ease_source = 'user_calibrated', trust = 0.85
        │
        ▼
UPSERT rows to brand_size_charts in Neon
  ON CONFLICT (brand, garment_type, size_label) DO UPDATE
        │
        ▼
Write row to scrape_runs in Neon:
  brand, status, rows_written,
  error_message, started_at, completed_at
        │
        ▼
Push updated data to Cloudflare KV:
  chart:{brand}:{garment}:{size} per row
  chart:{brand}:{garment}:all per brand+garment combination
  brands:supported updated list
        │
        ▼
Scrape run complete
```

---

## 5. UML Sequence Diagrams

### 5.1 Prediction Request Sequence

```
Shopper   Widget    Worker     KV        Redis     Neon
  │         │         │         │          │         │
  │─open───►│         │         │          │         │
  │         │─POST───►│         │          │         │
  │         │ /v1/size│         │          │         │
  │         │ X-Snug-Key        │          │         │
  │         │         │─GET────►│          │         │
  │         │         │ apikey  │          │         │
  │         │         │◄────────│          │         │
  │         │         │         │          │         │
  │         │         │─DECR──────────────►│         │
  │         │         │ usage:{}│          │         │
  │         │         │◄───────────────────│         │
  │         │         │         │          │         │
  │         │         │─INCR──────────────►│         │
  │         │         │ rl:{}   │          │         │
  │         │         │◄───────────────────│         │
  │         │         │         │          │         │
  │         │         │─GET────►│          │         │
  │         │         │ ref chart          │         │
  │         │         │◄────────│          │         │
  │         │         │         │          │         │
  │         │         │─GET────►│          │         │
  │         │         │ merchant│          │         │
  │         │         │ charts  │          │         │
  │         │         │◄────────│          │         │
  │         │         │         │          │         │
  │         │         │[run algorithm]      │         │
  │         │         │         │          │         │
  │         │◄─200────│         │          │         │
  │◄─result─│         │         │          │         │
  │         │         │         │          │         │
  │         │         │─INSERT (ctx.waitUntil)────────►│
  │         │         │ usage_logs         │         │
```

---

### 5.2 Merchant Install Sequence

```
Merchant  Shopify  ReactRouter  Neon      KV      Redis  ShopifyAPI
  │         │          │          │        │         │        │
  │─install►│          │          │        │         │        │
  │         │─redirect►│          │        │         │        │
  │         │ /auth    │          │        │         │        │
  │         │◄─redirect│          │        │         │        │
  │         │ OAuth    │          │        │         │        │
  │─approve►│          │          │        │         │        │
  │         │─callback►│          │        │         │        │
  │         │ +code    │          │        │         │        │
  │         │          │─exchange────────────────────────────►│
  │         │          │ code     │        │         │        │
  │         │          │◄─────────────────────────────────────│
  │         │          │ token    │        │         │        │
  │         │          │─INSERT──►│        │         │        │
  │         │          │ session  │        │         │        │
  │         │          │─INSERT──►│        │         │        │
  │         │          │ org+key  │        │         │        │
  │         │          │─INSERT──►│        │         │        │
  │         │          │ widget   │        │         │        │
  │         │          │─PUT─────────────►│         │        │
  │         │          │ apikey:{}│        │         │        │
  │         │          │ shop:{}  │        │         │        │
  │         │          │─SET──────────────────────►│        │
  │         │          │ usage:{} │        │         │        │
  │         │          │─inject key into TAE──────────────────►│
  │         │          │─register webhooks────────────────────►│
  │         │◄─redirect│          │        │         │        │
  │◄─loads──│          │          │        │         │        │
  │ dashboard          │          │        │         │        │
```

---

### 5.3 Cron Job Sequence

```
UsageCron   Neon       Redis      KV
  │           │           │         │
  │─SELECT───►│           │         │
  │  COUNT    │           │         │
  │  per org  │           │         │
  │◄──────────│           │         │
  │           │           │         │
  │[compute remaining]    │         │
  │           │           │         │
  │─UPDATE───►│           │         │
  │  orgs     │           │         │
  │           │           │         │
  │─SET──────────────────►│         │
  │  usage:{} │           │         │
  │           │           │         │
  │─PUT─────────────────────────────►│
  │  shop:{}  │           │         │

BillingCron  Neon       Redis      KV
  │           │           │         │
  │─SELECT───►│           │         │
  │  expired  │           │         │
  │  periods  │           │         │
  │◄──────────│           │         │
  │           │           │         │
  │─UPDATE───►│           │         │
  │  reset    │           │         │
  │  periods  │           │         │
  │           │           │         │
  │─SET──────────────────►│         │
  │  reset    │           │         │
  │  counters │           │         │
  │           │           │         │
  │─PUT─────────────────────────────►│
  │  updated  │           │         │
  │  KV entries           │         │
```

---

## 6. Infrastructure Topology

```
┌──────────────────────────────────────────────────────────────┐
│                      SHOPIFY PLATFORM                        │
│   App Store listing │ OAuth │ Webhooks │ Admin iframe        │
└──────────────────────────────┬───────────────────────────────┘
                               │
             ┌─────────────────▼─────────────────┐
             │              RAILWAY               │
             │                                   │
             │  ┌─────────────────────────────┐  │
             │  │   React Router Dashboard    │  │
             │  │   Polaris + App Bridge      │  │
             │  └──────────────┬──────────────┘  │
             │                 │                 │
             │  ┌──────────────▼──────────────┐  │
             │  │   Usage Sync Cron           │  │
             │  │   (every few minutes)       │  │
             │  └─────────────────────────────┘  │
             │                                   │
             │  ┌─────────────────────────────┐  │
             │  │   Billing Period Cron       │  │
             │  │   (once per day)            │  │
             │  └─────────────────────────────┘  │
             │                                   │
             │  ┌─────────────────────────────┐  │
             │  │   Scraper Pipeline          │  │
             │  │   (weekly cron)             │  │
             │  └─────────────────────────────┘  │
             └─────────────────┬─────────────────┘
                               │
             ┌─────────────────▼─────────────────┐
             │           NEON POSTGRES            │
             │                                   │
             │  sessions          organizations  │
             │  widget_configs    fit_size_charts │
             │  garment_mappings  usage_logs      │
             │  brand_size_charts scrape_runs     │
             │  anthropometric_anchors            │
             │  brand_requests                    │
             └──────┬──────────────┬─────────────┘
                    │              │
       ┌────────────▼──┐    ┌──────▼─────────────┐
       │ CLOUDFLARE KV │    │   UPSTASH REDIS     │
       │               │    │                    │
       │ apikey:{}     │    │ usage:{org_id}     │
       │ shop:{}       │    │ rl:{org}:{minute}  │
       │ chart:{}      │    │                    │
       │ merchant:{}   │    │ Usage cap +        │
       │ brands:{}     │    │ burst limiting     │
       └────────┬──────┘    └────────────────────┘
                │
       ┌────────▼──────────────────────────────────┐
       │         CLOUDFLARE WORKERS                │
       │                                           │
       │  POST /v1/size                            │
       │  GET  /v1/product/{id}                    │
       │  Hono.js + TypeScript                     │
       └────────────────┬──────────────────────────┘
                        │
       ┌────────────────▼──────────────────────────┐
       │         SHOPIFY STOREFRONT                │
       │                                           │
       │  Theme App Extension                      │
       │  Vanilla JS Widget                        │
       │  Served from Cloudflare CDN               │
       └───────────────────────────────────────────┘
                        ▲
                        │
               Shopper's browser
```

---

## 7. Database Schema

### organizations

```
org_id                uuid        PRIMARY KEY
shop_domain           text        UNIQUE NOT NULL
brand_slug            text        (lowercase, matches brand_size_charts.brand)
api_key               text        UNIQUE NOT NULL
                                  (crypto random, generated on install,
                                   never shown to merchant,
                                   injected into Theme App Extension automatically)
plan_tier             text        CHECK IN ('free', ...)
                                  (billing plans to be finalised)
usage_remaining       integer     NOT NULL
                                  (cache — maintained by cron job,
                                   Redis is the enforcement authority,
                                   this is the audit record and dashboard display value)
billing_period_start  timestamp   NOT NULL
onboarding_complete   boolean     NOT NULL DEFAULT false
widget_active         boolean     NOT NULL DEFAULT false
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()
```

---

### widget_configs

```
config_id             uuid        PRIMARY KEY
org_id                uuid        NOT NULL FK → organizations (1:1)
position              text        CHECK IN ('below_add_to_cart',
                                            'above_add_to_cart',
                                            'below_price')
is_enabled            boolean     NOT NULL DEFAULT true
config                jsonb       visual settings only
                                  (colors, button text, font overrides)
                                  not used for algorithm logic
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()
```

---

### fit_size_charts

```
chart_id              uuid        PRIMARY KEY
org_id                uuid        NOT NULL FK → organizations
garment_type          text        NOT NULL
                                  CHECK IN ('tshirt','shirt','polo',
                                            'sweatshirt','hoodie','jacket',
                                            'kurta','top')
size_label            text        NOT NULL (S/M/L/XL/38/40/etc.)
fit_type              text        NOT NULL
                                  CHECK IN ('slim','regular','oversized')
chest_min_cm          numeric     NOT NULL
chest_max_cm          numeric     NOT NULL
length_min_cm         numeric     nullable
length_max_cm         numeric     nullable
shoulder_min_cm       numeric     nullable
shoulder_max_cm       numeric     nullable
ease_value_cm         numeric     NOT NULL
ease_source           text        NOT NULL
                                  CHECK IN ('explicit','inferred',
                                            'user_calibrated')
extra_measurements    jsonb       nullable
                                  FOR STOREFRONT DISPLAY ONLY
                                  (waist, hip, sleeve, any custom measurements
                                   the merchant wants shown on their size chart UI)
                                  NOT used in sizing algorithm calculations
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

UNIQUE (org_id, garment_type, size_label)
```

---

### garment_mappings

```
mapping_id            uuid        PRIMARY KEY
org_id                uuid        NOT NULL FK → organizations
shopify_product_id    text        NOT NULL (Shopify GID)
garment_type          text        NOT NULL CHECK IN (garment enum)
chart_override_id     uuid        nullable FK → fit_size_charts
                                  (when null: use org-level chart for this
                                   garment_type via org_id + garment_type lookup)
                                  (when set: use this specific chart for this
                                   product only — for products with unique sizing
                                   that differ from the org default)
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

UNIQUE (org_id, shopify_product_id)
INDEX  (org_id, garment_type)
```

---

### usage_logs

```
log_id                uuid        PRIMARY KEY
org_id                uuid        NOT NULL
                                  (no FK — Worker uses restricted connection,
                                   cannot enforce referential integrity)
ref_brand             text        NOT NULL
ref_garment           text        NOT NULL
ref_size              text        NOT NULL
predicted_size        text        NOT NULL
confidence            integer     NOT NULL
                                  (confidence_label derived at query time:
                                   75-100 = high, 45-74 = medium, <45 = low)
is_boundary_case      boolean     NOT NULL
response_ms           integer     NOT NULL
created_at            timestamp   NOT NULL DEFAULT now()
```

---

### brand_requests

```
request_id            uuid        PRIMARY KEY
org_id                uuid        NOT NULL FK → organizations
brand_name            text        NOT NULL
brand_url             text        nullable
status                text        NOT NULL DEFAULT 'pending'
                                  CHECK IN ('pending','in_progress',
                                            'completed','rejected')
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()
```

---

### brand_size_charts

```
brand                 text        NOT NULL (lowercase slug)
garment_type          text        NOT NULL
                                  CHECK IN ('tshirt','shirt','polo',
                                            'sweatshirt','hoodie','jacket',
                                            'kurta','top')
size_label            text        NOT NULL
chest_min_cm          numeric     NOT NULL
chest_max_cm          numeric     NOT NULL
length_min_cm         numeric     nullable
length_max_cm         numeric     nullable
shoulder_min_cm       numeric     nullable
shoulder_max_cm       numeric     nullable
fit_type              text        NOT NULL
                                  CHECK IN ('slim','regular','oversized')
ease_value_cm         numeric     NOT NULL
ease_source           text        NOT NULL
                                  CHECK IN ('explicit','inferred',
                                            'user_calibrated')
scraped_at            timestamp   NOT NULL

PRIMARY KEY (brand, garment_type, size_label)
```

---

### anthropometric_anchors

```
gender                text        NOT NULL CHECK IN ('M','F','unisex')
size_label            text        NOT NULL (XS/S/M/L/XL/XXL)
avg_chest_cm          numeric     NOT NULL
source                text        NOT NULL (e.g. 'NIFT_2020')

PRIMARY KEY (gender, size_label)

Seed values (male, source: NIFT_2020):
  XS = 82cm
  S  = 86cm
  M  = 91cm
  L  = 96cm
  XL = 102cm
  XXL = 108cm
```

---

### scrape_runs

```
run_id                uuid        PRIMARY KEY
brand                 text        NOT NULL (references brand_size_charts.brand)
status                text        NOT NULL
                                  CHECK IN ('success','partial','failed')
rows_written          integer     NOT NULL DEFAULT 0
error_message         text        nullable
started_at            timestamp   NOT NULL
completed_at          timestamp   nullable
```

---

### sessions

```
id                    text        PRIMARY KEY
shop                  text        NOT NULL
state                 text        NOT NULL
isOnline              boolean     NOT NULL DEFAULT false
scope                 text        nullable
expires               timestamp   nullable
accessToken           text        NOT NULL
userId                integer     nullable
firstName             text        nullable
lastName              text        nullable
email                 text        nullable
accountOwner          boolean     nullable
locale                text        nullable
collaborator          boolean     nullable
emailVerified         boolean     nullable
refreshToken          text        nullable
refreshTokenExpires   timestamp   nullable

(managed entirely by @shopify/shopify-app-session-storage-drizzle adapter)
```

---

### Table relationships

```
organizations ──────────────── widget_configs       (1:1)
organizations ──────────────── fit_size_charts       (1:many)
organizations ──────────────── garment_mappings      (1:many)
organizations ──────────────── usage_logs            (1:many, soft — no FK)
organizations ──────────────── brand_requests        (1:many)

garment_mappings → fit_size_charts (lookup path when chart_override_id is null):
  org_id + garment_type → fit_size_charts WHERE org_id = x AND garment_type = y
  Updates to fit_size_charts propagate automatically to all mapped products

garment_mappings → fit_size_charts (when chart_override_id is set):
  chart_override_id → fit_size_charts.chart_id
  Used for products with unique sizing that differ from the org default

brand_size_charts ──────────── anthropometric_anchors
  (used by scraper during ease inference, not a runtime FK)

sessions ───────────────────── organizations
  (soft relationship via shop_domain text match,
   managed by Shopify session adapter)
```

---

### Check constraints summary

| Table | Column | Allowed values |
|---|---|---|
| `organizations` | `plan_tier` | to be finalised with billing plans |
| `fit_size_charts` | `garment_type` | tshirt, shirt, polo, sweatshirt, hoodie, jacket, kurta, top |
| `fit_size_charts` | `fit_type` | slim, regular, oversized |
| `fit_size_charts` | `ease_source` | explicit, inferred, user_calibrated |
| `garment_mappings` | `garment_type` | tshirt, shirt, polo, sweatshirt, hoodie, jacket, kurta, top |
| `brand_size_charts` | `garment_type` | tshirt, shirt, polo, sweatshirt, hoodie, jacket, kurta, top |
| `brand_size_charts` | `fit_type` | slim, regular, oversized |
| `brand_size_charts` | `ease_source` | explicit, inferred, user_calibrated |
| `anthropometric_anchors` | `gender` | M, F, unisex |
| `scrape_runs` | `status` | success, partial, failed |
| `brand_requests` | `status` | pending, in_progress, completed, rejected |

---

## 8. Security Model

### Authentication layers

| Layer | Mechanism | Enforces |
|---|---|---|
| Shopper → Worker | Silent API key (`X-Snug-Key` header) + Origin header + KV lookup | Only requests from registered merchant storefronts with a valid key are served |
| Merchant → Dashboard | Shopify OAuth + session tokens via `authenticate.admin` | Only authenticated Shopify merchants access the dashboard |
| Worker → Neon | Restricted Postgres role | Worker can only INSERT on `usage_logs` |
| Dashboard → Neon | Full Postgres role | Full read/write for the React Router app |
| Cron jobs → Neon | Full Postgres role | Read/write access for usage sync and billing |

### Silent API key model

Shopify provides two official mechanisms for authenticating storefront requests to an app backend:

1. **App Proxy** (`authenticate.public.appProxy`) — Shopify proxies storefront requests through `https://{shop}/apps/{subpath}` to the app's `application_url`. Shopify appends HMAC-signed query parameters (`signature`, `shop`, `timestamp`, `logged_in_customer_id`) to every proxied request, and the app middleware verifies the signature. This is Shopify's recommended approach for storefront-to-backend calls. ([Shopify docs: App Proxies](https://shopify.dev/docs/apps/build/online-store/app-proxies))

2. **OpenID Connect ID Tokens** (`auth.idToken()`) — For Admin UI extensions calling external domains, Shopify provides automatic `Authorization` headers with OpenID Connect tokens. This is scoped to Admin extensions, not storefront Theme App Extensions. ([Shopify docs: Admin Extensions Auth](https://shopify.dev/docs/api/admin-extensions/latest))

**Why Snug does not use App Proxy for prediction requests:** App Proxy routes to the app's `application_url` — in our case, the Remix dashboard on Railway. Railway adds 80–200ms of latency and cannot match Cloudflare Workers' global edge distribution. If prediction requests went through App Proxy → Railway → Worker, the sub-50ms latency target would be impossible. Theme App Extensions have no Shopify-provided authentication mechanism for direct calls to external APIs.

Snug uses a self-managed silent API key instead:

- On install the backend generates a cryptographically random key via `crypto.randomUUID()`
- The key is stored in Neon against the organization and written to KV as `apikey:{key}`
- The key is injected into the Theme App Extension metafield config automatically
- The merchant never sees, manages, or rotates this key
- The widget reads the key from its Theme App Extension config at runtime and sends it as `X-Snug-Key` on every Worker request
- The Worker validates the key via a KV lookup — sub-millisecond, on the critical path
- The Origin header is checked as a secondary defense against cross-site abuse from other storefronts
- Key rotation is programmatic: the dashboard generates a new key, updates Neon, KV, and the Theme App Extension metafield in a single operation with no merchant involvement

### Principle of least privilege

Every system component has access to exactly what it needs and nothing more:

| Component | Database access | KV access | Redis access |
|---|---|---|---|
| Cloudflare Worker | INSERT on `usage_logs` only | Read all KV keys | DECR `usage:{}`, INCR `rl:{}` |
| React Router Dashboard | Full read/write | Write `apikey:{}`, `shop:{}`, `merchant:{}` | None |
| Cron jobs | Full read/write | Write `shop:{}`, `merchant:{}` | SET `usage:{}` |
| Scraper pipeline | Write `brand_size_charts`, `scrape_runs` | Write `chart:{}`, `brands:supported` | None |

---

## 9. Failure Modes and Fallbacks

| Component | Failure | Behaviour | Recovery |
|---|---|---|---|
| Cloudflare KV | Unavailable | Worker cannot validate API key or fetch charts. Returns 503. Widget shows error state. | Automatic recovery when KV recovers. No data loss. |
| Upstash Redis | Unavailable | Worker fails open — usage enforcement and burst limiting disabled, requests proceed. Failure logged. | No shopper impact. Cron corrects any over-serving on next run. |
| Upstash Redis | Data loss (counter lost) | Usage counters lost. Worker cannot enforce caps until cron rebuilds. May over-serve during recovery window. | Cron detects missing counters and rebuilds from Neon COUNT query on next run. |
| Neon Postgres | Unavailable | Worker usage_log write fails silently in `ctx.waitUntil()`. Dashboard unavailable. Widget continues serving from KV. | Usage logs have a gap for the outage window. Dashboard recovers when Neon recovers. |
| Neon Postgres | Slow | Worker usage_log write is non-blocking — shopper never waits. Dashboard may be slow. | No shopper impact. Dashboard degrades gracefully. |
| Usage sync cron | Fails to run | Redis usage counters drift from Neon truth. Merchants may over-serve or under-serve slightly. | Next successful cron run corrects Redis counters and Neon records. |
| Billing cron | Fails to run | Billing period not rolled over. Merchants may be incorrectly limited or unlimited for one extra day. | Next successful daily run corrects the state. |
| Railway (dashboard host) | Down | Merchant dashboard unavailable. No shopper impact — Worker runs independently on Cloudflare edge. | Dashboard recovers when Railway recovers. Widget continues serving. |
| Scraper pipeline | Fails to run | Brand data in KV goes stale after 8-day TTL. The freshness signal in the confidence score degrades predictions over time. | Manual trigger of scraper. KV TTL set to 8 days to absorb one missed weekly run before any data expires. |
| Widget JS CDN | Unavailable | Widget does not load on product pages. No recommendation shown. Storefront otherwise fully functional. | Cloudflare CDN has extremely high availability SLA. |

---

## 10. Locked Decisions

| Decision | What was decided | Why |
|---|---|---|
| Auth model | Silent automated API key injected into Theme App Extension. Origin header as secondary defense. | App Proxy adds 80–200ms latency through Railway and breaks the sub-50ms target. Silent key has no UX burden on merchants. |
| Rate limiting | Plan-based monthly usage cap via Redis atomic DECR. Burst limiting via Redis atomic INCR. No API keys visible to merchants. | KV has no atomic operations — cannot safely enforce concurrent request limits without race conditions. |
| Rate limiting authority | Redis is the enforcement authority. Neon `usage_remaining` is the audit record and display cache. | Redis atomic operations close the race condition. Neon is rebuilt from on every cron run. |
| ORM | Drizzle ORM throughout all components | Prisma Rust binary cannot run in V8 isolates. Drizzle is pure TypeScript with no native dependencies. |
| Session storage | `@shopify/shopify-app-session-storage-drizzle` | Official Shopify adapter. Connects React Router auth middleware to Drizzle and Neon. |
| No TCP Postgres | Neon HTTP driver everywhere including Worker | Cloudflare Workers cannot open persistent TCP connections. |
| `body_min_cm` and `body_max_cm` | Not stored | Derived values. Computing `chest - ease` at inference time avoids three-column sync risk. |
| `confidence_label` | Not stored in `usage_logs` | Derived at query time from `confidence` integer. Storing both risks them going out of sync if thresholds change. |
| `extra_measurements` JSONB | Present in `fit_size_charts`, for storefront display only | Merchants may want to show waist, hip, sleeve on their storefront size chart UI. Explicitly not used in algorithm. |
| `chart_override_id` on `garment_mappings` | Nullable FK to `fit_size_charts` | Allows individual products to use a specific chart when they differ from the org default for that garment type. |
| `is_boundary_case` in `usage_logs` | Logged as boolean | Boundary case rate is analytically useful over time and not derivable from other logged fields. |
| Billing plans | Deferred | Plan names, limits, and burst thresholds to be defined when billing is built. |
| `returned` and `shopify_order_id` | Not in `usage_logs` | Return correlation requires a separate order events system. These fields would be null on every row at write time. |
| Product titles | Not stored in `garment_mappings` | Titles change in Shopify. Fetched from Shopify Admin API at dashboard render time using `read_products` scope. |
| Two cron jobs | Usage sync (every few minutes) and billing rollover (once per day) are separate | Different cadences. Conflating them into one job makes both harder to reason about and debug. |
| Scraper independence | Scraper is the only writer to `brand_size_charts` and `scrape_runs` | Clean separation of concerns. No other component can corrupt reference brand data. |
| Worker database access | Restricted connection string, INSERT on `usage_logs` only | Principle of least privilege. Limits blast radius if Worker is ever compromised. |