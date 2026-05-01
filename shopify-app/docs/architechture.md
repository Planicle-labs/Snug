# Snug — Complete Technical Architecture

Everything in one place. The full technology stack, the role of every component, the data flow for every major operation, UML sequence diagrams, and the complete database schema.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Full Technology Stack](#2-full-technology-stack)
3. [Component Roles](#3-component-roles)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
   - 4.1 [Merchant Install Flow](#41-merchant-install-flow)
   - 4.2 [Shopper Prediction Request Flow](#42-shopper-prediction-request-flow)
   - 4.3 [Usage Cap Enforcement Flow](#43-usage-cap-enforcement-flow)
   - 4.4 [Merchant Uninstall Flow](#44-merchant-uninstall-flow)
   - 4.5 [Scraper Pipeline Flow](#45-scraper-pipeline-flow)
5. [UML Sequence Diagrams](#5-uml-sequence-diagrams)
   - 5.1 [Prediction Request Sequence](#51-prediction-request-sequence)
   - 5.2 [Merchant Install Sequence](#52-merchant-install-sequence)
   - 5.3 [Cron Job Sequence](#53-cron-job-sequence)
6. [Infrastructure Topology](#6-infrastructure-topology)
7. [Database Schema (ER)](#7-database-schema-er)
8. [Security Model](#8-security-model)
9. [Failure Modes and Fallbacks](#9-failure-modes-and-fallbacks)

---

## 1. System Overview

Snug is a Shopify app that solves online apparel sizing. A shopper on a merchant's product page tells the widget what brand they already own and what size they wear in it. The system translates that into the correct size for the merchant's brand using garment measurements as the mathematical bridge.

The system has four distinct runtime surfaces:

| Surface | What it does | Who uses it |
|---------|-------------|-------------|
| Storefront widget | Renders on product pages, collects shopper input, displays recommendation | Shoppers |
| Cloudflare Worker | Receives prediction requests, runs the sizing algorithm, enforces limits | Called by widget |
| Remix dashboard | Embedded in Shopify Admin, merchant configuration and analytics | Merchants |
| Scraper pipeline | Crawls brand websites, populates reference size chart data | Internal, runs on schedule |

These four surfaces share three pieces of infrastructure: Neon Postgres as the source of truth, Cloudflare KV as the hot-path cache, and Upstash Redis for burst protection.

---

## 2. Full Technology Stack

### Storefront Layer

| Component | Technology | Why |
|-----------|------------|-----|
| Widget UI | Vanilla JavaScript | Zero framework weight. Every framework adds kilobytes that penalise the merchant's Lighthouse score. The widget loads on every product page view. |
| Widget delivery | Cloudflare CDN | Sub-50ms asset delivery across India. More Indian edge locations than any competing CDN. |
| Widget injection | Shopify Theme App Extension | Required for App Store approval. Sandboxed, auditable, removes cleanly on uninstall. Apps injecting arbitrary script tags are rejected. |

### API Layer

| Component | Technology | Why |
|-----------|------------|-----|
| Runtime | Cloudflare Workers | V8 isolates — zero cold starts, ever. Vercel Functions and AWS Lambda have 100–400ms cold starts which makes the widget appear broken. Deploys globally to all CF edge locations automatically. |
| Router | Hono.js | The standard lightweight router built for the Workers runtime. Express and Fastify depend on Node.js APIs that do not exist in Workers. |
| Language | TypeScript | The sizing algorithm involves precise arithmetic across multiple data fields. TypeScript catches shape mismatches between KV payloads and algorithm inputs at compile time not runtime. |

### Cache Layer

| Component | Technology | Why |
|-----------|------------|-----|
| Hot-path cache | Cloudflare KV | Sub-millisecond reads because KV data is colocated at the same edge node as the Worker. Stores brand size charts, merchant org records, and usage remaining counts. |
| Burst rate limiting | Upstash Redis | The only option that is both atomic (INCR) and accessible over HTTP from Workers. Standard Redis uses TCP which Workers cannot open. KV has no atomic operations so cannot safely increment a counter under concurrent load. |

### Database Layer

| Component | Technology | Why |
|-----------|------------|-----|
| Primary database | Neon Postgres | Serverless Postgres with an HTTP driver (`@neondatabase/serverless`) that works from Workers. Standard Postgres clients use TCP which Workers do not support. Scales to zero when idle — zero cost during development. |
| ORM | Drizzle | Pure TypeScript, no native binary dependencies. Prisma uses a compiled Rust query engine that cannot run inside a V8 isolate. |

### Dashboard Layer

| Component | Technology | Why |
|-----------|------------|-----|
| Framework | Shopify Remix App Template (React Router v7) | Ships pre-configured with App Bridge, OAuth middleware, session token verification, and HMAC validation. Building this from scratch would take weeks and introduce significant security risk. |
| Component library | Shopify Polaris | Required for App Store approval. Embedded apps must match the Shopify Admin design system. |
| Session storage | `@shopify/shopify-app-session-storage-drizzle` | Official Shopify adapter that connects the Remix auth middleware to Drizzle/Neon instead of the default Prisma/SQLite. |
| Host | Railway | Full Node.js environment with persistent processes. Vercel's serverless functions have execution time limits that can interfere with Shopify's session token verification flow. |

### Background Jobs

| Component | Technology | Why |
|-----------|------------|-----|
| Cron job | Node.js script on Railway | Runs every few minutes. Reads `usage_logs`, recomputes `usage_remaining` per merchant, writes back to Neon and KV. Co-located with the Remix app on Railway — no separate service needed. |

---

## 3. Component Roles

### Cloudflare Worker

The core of the product. Every shopper prediction request flows through here. The Worker has no persistent state of its own — it reads from KV and Redis, computes the prediction, writes a log row to Neon, and returns the result.

**Responsibilities:**
- Validate the request Origin header against the merchant's KV record
- Enforce burst rate limits via Redis INCR
- Enforce monthly usage cap via KV `usage_remaining`
- Validate all four prediction inputs
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
- Know anything about billing beyond reading `usage_remaining` from KV

**Database access:** Restricted Neon connection. INSERT on `usage_logs` only. Cannot read, update, or delete any row in any table.

---

### Cloudflare KV

The hot-path cache. Every value the Worker needs on the critical path lives here. Reads are sub-millisecond because KV data is physically colocated at the same edge node as the Worker executing the request.

**What is stored in KV:**

| Key pattern | Value | Written by | TTL |
|-------------|-------|------------|-----|
| `shop:{shop_domain}` | `{ org_id, plan_tier, widget_active, usage_remaining, billing_period_start }` | OAuth callback + cron job | No TTL |
| `chart:{brand}:{garment}:{size}` | Full reference brand size row as JSON | Scraper pipeline | 8 days |
| `chart:{brand}:{garment}:all` | All size rows for brand+garment as JSON array | Scraper pipeline | 8 days |
| `brands:supported` | JSON array of all supported reference brand names | Scraper pipeline | 8 days |
| `garments:supported` | JSON array of supported garment types | Seeded at setup | No TTL |
| `merchant:{org_id}:charts:{garment}` | Merchant's fit_size_charts rows for a garment type | Dashboard on save | No TTL |

**What KV is NOT used for:**
- Rate limiting counters (no atomic operations)
- Any data that requires transactional consistency
- Session storage

---

### Upstash Redis

Single-purpose: burst rate limiting via atomic INCR. Nothing else in the system touches Redis.

**Key structure:** `rl:{org_id}:{minute_bucket}` where `minute_bucket = floor(Date.now() / 60000)`

**TTL:** 120 seconds on every key. Slightly longer than one minute to prevent gaps at window boundaries.

**Limits by plan:**

| Plan | Burst limit |
|------|-------------|
| free | 10 requests/minute |
| starter | 60 requests/minute |
| pro | 300 requests/minute |

**Failure behaviour:** If Redis is unreachable, the Worker fails open — the request proceeds without burst checking. This is intentional. Blocking a shopper from a size recommendation because internal rate limiting infrastructure is down is a worse outcome than temporarily unenforced burst limits. The failure is logged.

---

### Neon Postgres

The source of truth for everything. The only permanent store. Every other system — KV, Redis — is a cache or a temporary counter derived from Neon data.

**Who reads and writes each part:**

| Tables | Read by | Written by |
|--------|---------|------------|
| `sessions` | Remix OAuth middleware | Shopify adapter |
| `organizations`, `widget_configs` | Remix dashboard, cron job | OAuth callback, Remix dashboard |
| `fit_size_charts`, `garment_mappings` | Remix dashboard, cron job (for KV push) | Remix dashboard |
| `usage_logs` | Cron job, billing, analytics | Cloudflare Worker only |
| `brand_size_charts`, `anthropometric_anchors`, `scrape_runs` | Scraper, cron job (for KV push) | Scraper pipeline |
| `brand_requests` | Remix dashboard | Remix dashboard |

**Two connection strings:**
- Full access: used by Remix dashboard, cron job, and scraper
- Restricted (INSERT on `usage_logs` only): used by Cloudflare Worker

---

### Remix Dashboard App

The merchant-facing configuration interface. Runs on Railway, renders inside the Shopify Admin as an iframe. Merchants never navigate to a standalone URL — they access everything through Shopify.

**Responsibilities:**
- Handle Shopify OAuth install flow (HMAC validation, token exchange, token storage)
- Handle Shopify session token verification on every authenticated request
- Register `app/uninstalled` and `shop/redact` webhooks on install
- Serve the onboarding flow (brand configuration, widget activation)
- Let merchants create and manage fit size charts
- Let merchants map Shopify products to garment types
- Show analytics (recommendation volume, confidence distribution, top sizes)
- Show usage remaining against plan limit
- Handle brand requests
- Handle `app/uninstalled` webhook: set `widget_active = false` in Neon and KV, scrub access token
- Handle `shop/redact` webhook: delete merchant data from Neon (GDPR)

**What the dashboard does NOT do:**
- Serve shopper-facing content
- Run the sizing algorithm
- Write to `brand_size_charts` or scraper tables
- Manage Redis

---

### Storefront Widget

The shopper-facing UI. A vanilla JS bundle injected via Theme App Extension. Renders on every product page where the merchant has mapped the product to a garment type.

**Responsibilities:**
- Detect the current Shopify product ID from the page context
- Look up whether this product has a garment mapping (via a call to the Worker)
- Render the three-input form: reference brand, garment type, size label
- POST to the Worker's `/v1/size` endpoint
- Display the predicted size, confidence label, and suggested sizes
- Handle boundary cases (show two size options with fit preference guidance)
- Handle error states gracefully (brand not found, size not found, limit reached)

**What the widget does NOT do:**
- Store any data locally
- Use cookies or session state
- Communicate directly with Neon or Shopify APIs
- Know anything about the merchant's configuration beyond what it reads from the Worker response

---

### Cron Job

Runs on Railway alongside the Remix app. The bridge between Neon (source of truth) and KV (serving layer) for merchant usage data.

**Responsibilities:**
- Every few minutes: for each active merchant, count `usage_logs` rows since `billing_period_start`, compute `usage_remaining`, write to both `organizations` in Neon and `shop:{shop_domain}` in KV
- On billing period rollover: reset `usage_remaining` to plan limit, update `billing_period_start`
- On plan upgrade: immediately recompute `usage_remaining` based on new limit and push to KV
- Push updated merchant fit chart data to KV after dashboard saves (alternatively this can be triggered directly by the dashboard on save)

---

### Scraper Pipeline

A separate service, runs on a weekly schedule. Completely decoupled from the sizing layer — the Worker never calls the scraper and the scraper never calls the Worker.

**Responsibilities:**
- Visit brand websites and extract size chart data
- Infer ease values using anthropometric anchors when brands do not publish them explicitly
- Write rows to `brand_size_charts` using upsert semantics (update on conflict)
- Write a `scrape_runs` row recording success/failure/rows written
- After a successful run, push updated chart data to KV so the Worker immediately has fresh data

---

## 4. Data Flow Diagrams

### 4.1 Merchant Install Flow

```
Merchant clicks Install on App Store
        │
        ▼
Shopify redirects to /auth?shop=store.myshopify.com
        │
        ▼
Remix validates HMAC signature
        │
        ▼
Remix redirects merchant to Shopify OAuth consent screen
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
Remix exchanges code for permanent offline access token
        │
        ├──► Writes session row to Neon (sessions table)
        │
        ├──► Creates organization row in Neon
        │      org_id, shop_domain, plan_tier=free,
        │      usage_remaining=100, billing_period_start=now,
        │      onboarding_complete=false, widget_active=false
        │
        ├──► Creates widget_configs row with defaults
        │
        ├──► Writes KV entry: shop:{domain}
        │      { org_id, plan_tier, widget_active: false,
        │        usage_remaining: 100 }
        │
        └──► Registers webhooks:
               app/uninstalled → /webhooks/app/uninstalled
               shop/redact     → /webhooks/shop/redact
        │
        ▼
Shopify redirects merchant into embedded dashboard
        │
        ▼
Merchant sees onboarding flow:
  Step 1: Search for and confirm brand slug
  Step 2: Create first fit size chart
  Step 3: Activate widget via theme editor deep link
        │
        ▼
On completion:
  onboarding_complete = true
  widget_active = true
  KV entry updated
```

---

### 4.2 Shopper Prediction Request Flow

```
Shopper opens product page
        │
        ▼
Widget JS loads via Theme App Extension
        │
        ▼
Widget reads Shopify product ID from page context
        │
        ▼
Worker receives GET /v1/product/{product_id}
  └── KV lookup: merchant fit chart for this product
  └── Returns garment_type if mapped, null if not
        │
        ├── [Not mapped] Widget renders "not available" state
        │
        └── [Mapped] Widget renders input form
                │
                ▼
        Shopper selects:
          ref_brand:   "uniqlo"
          ref_garment: "hoodie"
          ref_size:    "M"
                │
                ▼
        Widget POSTs to Worker: POST /v1/size
                │
                ▼
        ┌─────────────────────────────────────┐
        │         WORKER EXECUTION            │
        │                                     │
        │ 1. KV: shop:{origin} → org record   │
        │    Check widget_active              │
        │    Check usage_remaining > 0        │
        │                                     │
        │ 2. Redis: INCR rl:{org}:{minute}    │
        │    Check against burst limit        │
        │                                     │
        │ 3. Validate inputs                  │
        │    ref_brand in brands:supported    │
        │    ref_garment in valid enum        │
        │                                     │
        │ 4. KV: chart:{brand}:{garment}:{size}│
        │    Fetch reference brand row        │
        │                                     │
        │ 5. KV: merchant:{org}:charts:{type} │
        │    Fetch merchant size chart rows   │
        │                                     │
        │ 6. Run sizing algorithm (9 steps)   │
        │    Compute confidence score         │
        │                                     │
        │ 7. Return response to widget        │
        │                                     │
        │ 8. ctx.waitUntil():                 │
        │    INSERT into usage_logs           │
        └─────────────────────────────────────┘
                │
                ▼
        Widget displays result:
          Predicted size, confidence label,
          suggested sizes, reasoning copy
```

---

### 4.3 Usage Cap Enforcement Flow

```
Every few minutes — Cron job runs
        │
        ▼
For each active organization:
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
        │      SET usage_remaining = n
        │      WHERE org_id = x
        │
        └──► KV write: shop:{domain}
               { ..., usage_remaining: n }
        │
        ▼
On next Worker request:
        │
        ▼
KV read: shop:{domain}
  └── usage_remaining = 0?
        │
        ├── [Yes] Return 429:
        │     { error: "monthly_limit_reached",
        │       message: "Upgrade your plan" }
        │
        └── [No] Proceed with request
```

---

### 4.4 Merchant Uninstall Flow

```
Merchant clicks Uninstall in Shopify Admin
        │
        ▼
Shopify POSTs to /webhooks/app/uninstalled
        │
        ▼
Remix webhook handler:
        │
        ├──► UPDATE organizations
        │      SET widget_active = false
        │      WHERE shop_domain = x
        │
        ├──► DELETE sessions
        │      WHERE shop = x
        │      (scrub access token)
        │
        └──► KV write: shop:{domain}
               { ..., widget_active: false }
        │
        ▼
Any in-flight Worker requests:
  Next KV read sees widget_active: false
  Returns 403 immediately
  No more predictions served
        │
        ▼
Merchant data retained in Neon for 30 days
(grace period for reinstall)
        │
        ▼
After 30 days: shop/redact webhook fires
Remix deletes all merchant rows from Neon
```

---

### 4.5 Scraper Pipeline Flow

```
Weekly schedule triggers scraper
        │
        ▼
For each brand in scrape list:
        │
        ▼
INSERT scrape_runs: status=in_progress, started_at=now
        │
        ▼
Fetch brand's size chart pages
        │
        ▼
Parse garment types, size labels,
chest ranges, fit types
        │
        ▼
For each size row:
  Ease value available explicitly?
  ├── [Yes] ease_source = explicit
  └── [No]  Look up avg_chest_cm from
            anthropometric_anchors
            ease = garment_midpoint - avg_chest
            ease_source = inferred
        │
        ▼
UPSERT into brand_size_charts
(insert or update on conflict of brand+garment+size)
        │
        ▼
UPDATE scrape_runs:
  status = success/partial/failed
  rows_written = n
  completed_at = now
  error_message = null or error string
        │
        ▼
Push updated rows to KV:
  chart:{brand}:{garment}:{size} for each row
  chart:{brand}:{garment}:all for each brand+garment
  brands:supported (full list refresh)
```

---

## 5. UML Sequence Diagrams

### 5.1 Prediction Request Sequence

```
Shopper    Widget     Worker      KV         Redis      Neon
  │          │          │          │           │          │
  │─ opens ─►│          │          │           │          │
  │          │          │          │           │          │
  │          │─ POST ──►│          │           │          │
  │          │  /v1/size│          │           │          │
  │          │          │─ GET ───►│           │          │
  │          │          │ shop:{}  │           │          │
  │          │          │◄─────────│           │          │
  │          │          │          │           │          │
  │          │          │─ INCR ──────────────►│          │
  │          │          │◄────────────────────-│          │
  │          │          │  count=n │           │          │
  │          │          │          │           │          │
  │          │          │─ GET ───►│           │          │
  │          │          │ ref chart│           │          │
  │          │          │◄─────────│           │          │
  │          │          │          │           │          │
  │          │          │─ GET ───►│           │          │
  │          │          │ merchant │           │          │
  │          │          │◄─────────│           │          │
  │          │          │          │           │          │
  │          │          │ [run algorithm]       │          │
  │          │          │          │           │          │
  │          │◄─ 200 ───│          │           │          │
  │◄─ shows ─│          │          │           │          │
  │  result  │          │          │           │          │
  │          │          │─ INSERT ────────────────────────►│
  │          │          │ usage_log│           │          │
  │          │          │ (non-blocking)        │          │
```

---

### 5.2 Merchant Install Sequence

```
Merchant   Shopify    Remix App   Neon        KV       Shopify API
  │          │           │          │          │           │
  │─ click ─►│           │          │          │           │
  │  Install │           │          │          │           │
  │          │─ redirect►│          │          │           │
  │          │ /auth     │          │          │           │
  │          │◄─ redirect│          │          │           │
  │          │ OAuth     │          │          │           │
  │─ approve►│           │          │          │           │
  │          │─ callback►│          │          │           │
  │          │ +code     │          │          │           │
  │          │           │─ exchange────────────────────────►│
  │          │           │  code    │          │           │
  │          │           │◄─────────────────────────────────│
  │          │           │  token   │          │           │
  │          │           │─ INSERT─►│          │           │
  │          │           │  session │          │           │
  │          │           │─ INSERT─►│          │           │
  │          │           │  org     │          │           │
  │          │           │─ INSERT─►│          │           │
  │          │           │  widget  │          │           │
  │          │           │─ PUT ───────────────►│           │
  │          │           │  shop:{} │          │           │
  │          │           │─ register webhooks ─────────────►│
  │          │◄─ redirect│          │          │           │
  │◄─ loads ─│           │          │          │           │
  │  dashboard           │          │          │           │
```

---

### 5.3 Cron Job Sequence

```
Cron       Neon         KV
  │          │           │
  │─ SELECT─►│           │
  │  COUNT   │           │
  │  per org │           │
  │◄─────────│           │
  │          │           │
  │ [compute remaining]  │
  │          │           │
  │─ UPDATE─►│           │
  │  orgs    │           │
  │          │           │
  │─ PUT ───────────────►│
  │  shop:{} │           │
  │  per org │           │
  │          │           │
  │ [check billing periods]
  │          │           │
  │─ UPDATE─►│           │
  │  reset   │           │
  │  expired │           │
  │  periods │           │
  │─ PUT ───────────────►│
  │  updated │           │
  │  KV entries          │
```

---

## 6. Infrastructure Topology

```
┌─────────────────────────────────────────────────────┐
│                  SHOPIFY PLATFORM                    │
│  App Store listing │ OAuth │ Webhooks │ Admin iframe │
└───────────────────────────┬─────────────────────────┘
                            │
              ┌─────────────▼──────────────┐
              │        RAILWAY              │
              │                            │
              │  ┌─────────────────────┐   │
              │  │   Remix Dashboard   │   │
              │  │   (React Router v7) │   │
              │  │   + Polaris         │   │
              │  └──────────┬──────────┘   │
              │             │              │
              │  ┌──────────▼──────────┐   │
              │  │     Cron Job        │   │
              │  │  (Node.js script)   │   │
              │  └─────────────────────┘   │
              └─────────────┬──────────────┘
                            │
              ┌─────────────▼──────────────┐
              │       NEON POSTGRES         │
              │                            │
              │  sessions                  │
              │  organizations             │
              │  widget_configs            │
              │  fit_size_charts           │
              │  garment_mappings          │
              │  usage_logs                │
              │  brand_size_charts         │
              │  anthropometric_anchors    │
              │  brand_requests            │
              │  scrape_runs               │
              └─────────────┬──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼──────────┐
│  CLOUDFLARE    │  │  CLOUDFLARE KV  │  │ UPSTASH REDIS   │
│  WORKERS       │  │                │  │                  │
│                │  │ shop:{}        │  │ rl:{org}:{min}   │
│  POST /v1/size │  │ chart:{}       │  │                  │
│  GET /v1/product│  │ merchant:{}   │  │ Burst limiting   │
│                │  │ brands:{}      │  │ only             │
└───────┬────────┘  └────────────────┘  └─────────────────-┘
        │
        │
┌───────▼────────────────────────────────────────────┐
│              SHOPIFY STOREFRONT                     │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Theme App Extension                         │  │
│  │  Vanilla JS Widget                           │  │
│  │  Served from Cloudflare CDN                  │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
        ▲
        │
   Shopper's browser
```

---

## 7. Database Schema (ER)

### Merchant-owned tables

```
organizations
─────────────────────────────────────────
org_id                uuid        PK
shop_domain           text        UNIQUE NOT NULL
brand_slug            text        (lowercase, matches brand_size_charts.brand)
plan_tier             text        CHECK IN ('free','starter','pro')
usage_remaining       integer     maintained by cron job
billing_period_start  timestamp   reset each billing cycle
onboarding_complete   boolean     NOT NULL DEFAULT false
widget_active         boolean     NOT NULL DEFAULT false
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

widget_configs
─────────────────────────────────────────
config_id             uuid        PK
org_id                uuid        FK → organizations (1:1)
position              text        CHECK IN ('below_add_to_cart',
                                           'above_add_to_cart',
                                           'below_price')
is_enabled            boolean     NOT NULL DEFAULT true
config                jsonb       visual settings (colors, button text, etc.)
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

fit_size_charts
─────────────────────────────────────────
chart_id              uuid        PK
org_id                uuid        FK → organizations
garment_type          text        CHECK IN ('tshirt','shirt','polo',
                                           'sweatshirt','hoodie','jacket',
                                           'kurta','top')
size_label            text        NOT NULL (S/M/L/XL/38/40/etc.)
fit_type              text        CHECK IN ('slim','regular','oversized')
chest_min_cm          numeric     NOT NULL
chest_max_cm          numeric     NOT NULL
length_min_cm         numeric     nullable
length_max_cm         numeric     nullable
shoulder_min_cm       numeric     nullable
shoulder_max_cm       numeric     nullable
ease_value_cm         numeric     NOT NULL
ease_source           text        CHECK IN ('explicit','inferred',
                                           'user_calibrated')
body_min_cm           numeric     computed: chest_min - ease_value
body_max_cm           numeric     computed: chest_max - ease_value
extra_measurements    jsonb       nullable (waist, hip, sleeve, custom)
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

UNIQUE (org_id, garment_type, size_label)

garment_mappings
─────────────────────────────────────────
mapping_id            uuid        PK
org_id                uuid        FK → organizations
shopify_product_id    text        NOT NULL (Shopify GID)
garment_type          text        CHECK IN (garment enum)
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()

UNIQUE (org_id, shopify_product_id)

usage_logs
─────────────────────────────────────────
log_id                uuid        PK
org_id                uuid        NOT NULL (no FK — restricted writer)
ref_brand             text        NOT NULL
ref_garment           text        NOT NULL
ref_size              text        NOT NULL
predicted_size        text        NOT NULL
confidence            integer     NOT NULL
response_ms           integer     NOT NULL
created_at            timestamp   NOT NULL DEFAULT now()

brand_requests
─────────────────────────────────────────
request_id            uuid        PK
org_id                uuid        FK → organizations
brand_name            text        NOT NULL
brand_url             text        nullable
status                text        CHECK IN ('pending','in_progress','completed')
created_at            timestamp   NOT NULL DEFAULT now()
updated_at            timestamp   NOT NULL DEFAULT now()
```

### Scraper-owned tables

```
brand_size_charts
─────────────────────────────────────────
brand                 text        NOT NULL (lowercase slug)
garment_type          text        CHECK IN (garment enum)
size_label            text        NOT NULL
chest_min_cm          numeric     NOT NULL
chest_max_cm          numeric     NOT NULL
length_min_cm         numeric     nullable
length_max_cm         numeric     nullable
shoulder_min_cm       numeric     nullable
shoulder_max_cm       numeric     nullable
fit_type              text        CHECK IN ('slim','regular','oversized')
ease_value_cm         numeric     NOT NULL
ease_source           text        CHECK IN ('explicit','inferred',
                                           'user_calibrated')
scraped_at            timestamp   NOT NULL

UNIQUE (brand, garment_type, size_label)

anthropometric_anchors
─────────────────────────────────────────
gender                text        CHECK IN ('M','F','unisex')
size_label            text        NOT NULL (XS/S/M/L/XL/XXL)
avg_chest_cm          numeric     NOT NULL
source                text        NOT NULL (e.g. 'NIFT_2020')

UNIQUE (gender, size_label)

scrape_runs
─────────────────────────────────────────
run_id                uuid        PK
brand                 text        NOT NULL
status                text        CHECK IN ('success','partial','failed')
rows_written          integer     NOT NULL DEFAULT 0
error_message         text        nullable
started_at            timestamp   NOT NULL
completed_at          timestamp   nullable
```

### Auth table (adapter-managed)

```
sessions
─────────────────────────────────────────
id                    text        PK
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
```

### Relationships

```
organizations ──────────────────── widget_configs     (1:1)
organizations ──────────────────── fit_size_charts    (1:many)
organizations ──────────────────── garment_mappings   (1:many)
organizations ──────────────────── usage_logs         (1:many)
organizations ──────────────────── brand_requests     (1:many)

fit_size_charts lookup path via garment_mappings:
  garment_mappings.org_id + garment_mappings.garment_type
    → fit_size_charts WHERE org_id = x AND garment_type = y
  (no direct FK — dynamic lookup, updates propagate automatically)

brand_size_charts ──────────────── scrape_runs        (soft: brand text match)
brand_size_charts ──────────────── anthropometric_anchors (used by scraper logic only)

sessions ───────────────────────── organizations      (soft: shop_domain text match)
```

---

## 8. Security Model

### Authentication layers

| Layer | Mechanism | Enforces |
|-------|-----------|---------|
| Shopper → Worker | Origin header + KV lookup | Only requests from registered merchant domains are served |
| Merchant → Dashboard | Shopify OAuth + session tokens | Only authenticated Shopify merchants access the dashboard |
| Worker → Neon | Restricted Postgres role | Worker can only INSERT on usage_logs |
| Dashboard → Neon | Full Postgres role | Full read/write for the Remix app |
| Scraper → Neon | Full Postgres role on scraper tables only | Scraper cannot touch merchant tables |

### Why there is no API key for the widget

The widget runs in a browser on the merchant's storefront. Any credential embedded in a browser-loaded JS file is publicly readable. Instead of a secret key, the Worker uses the browser-enforced Origin header — browsers set this automatically and correctly, and it cannot be spoofed by a different website. The Worker checks the origin against the registered shop domain in KV. If the origin does not match, the request is rejected.

This means the rate limiting and usage enforcement works by merchant identity derived from the origin, not from a secret. It also means the Widget has no credential to rotate, leak, or manage.

### Principle of least privilege

Every system component has access to exactly what it needs and nothing more. The Worker cannot read merchant configuration. The scraper cannot touch merchant data. The dashboard cannot write to `brand_size_charts`. This limits the blast radius of any single component being compromised.

---

## 9. Failure Modes and Fallbacks

| Component | Failure | Behaviour | Recovery |
|-----------|---------|-----------|----------|
| Cloudflare KV | Unavailable | Worker cannot validate origin or fetch charts. Returns 503. | KV has 99.9% uptime SLA. Automatic recovery when KV recovers. |
| Upstash Redis | Unavailable | Worker fails open — burst limiting disabled, request proceeds. Failure is logged. | No merchant impact. Burst limiting resumes when Redis recovers. |
| Neon Postgres | Unavailable | Worker cannot write usage_logs — failure is swallowed silently in ctx.waitUntil(). Dashboard unavailable. | Usage logs will have a gap. Dashboard recovers when Neon recovers. |
| Neon Postgres | Slow | Worker's usage_log write is non-blocking — shopper never waits. Dashboard may be slow. | No shopper impact. Dashboard degrades gracefully. |
| Cron job | Fails to run | usage_remaining in KV becomes stale. Merchants may over-serve slightly. | Next successful cron run corrects the count. Acceptable gap. |
| Scraper | Fails for a brand | brand_size_charts rows are not updated. KV data becomes stale after 8 days. Freshness signal in confidence score drops. | scrape_runs table records the failure. Retry on next schedule. |
| Railway (dashboard host) | Down | Merchant dashboard unavailable. No shopper impact — Worker runs independently on CF edge. | Dashboard recovers when Railway recovers. Widget continues serving. |
| Widget JS asset | CDN unavailable | Widget does not load on product pages. No recommendation shown. | CF CDN has extremely high availability. Storefront otherwise unaffected. |
