# Snug — Schema UML Reference

> This document is the single source of truth for the Snug database schema.
> Every table, its columns, and all relationships are captured here as ERDs.
> **No changes to `schema.ts` should be made without updating this file first.**

---

## Table of Contents

1. [Full ERD — All Tables](#1-full-erd--all-tables)
2. [sessions](#2-sessions)
3. [organizations](#3-organizations)
4. [widget_configs](#4-widget_configs)
5. [fit_size_charts](#5-fit_size_charts)
6. [garment_mappings](#6-garment_mappings)
7. [usage_logs](#7-usage_logs)
8. [conversion_events](#8-conversion_events)
9. [brand_size_charts](#9-brand_size_charts)
10. [anthropometric_anchors](#10-anthropometric_anchors)
11. [brand_requests](#11-brand_requests)
12. [scrape_runs](#12-scrape_runs)
13. [What scrape_runs and conversion_events actually are](#13-what-scrape_runs-and-conversion_events-actually-are)

---

## 1. Full ERD — All Tables

> Solid lines = foreign key (hard DB constraint). Dashed lines = soft reference (app-level only, no FK).

```mermaid
erDiagram

  sessions {
    text id PK
    text shop
    text state
    boolean isOnline
    text scope
    timestamp expires
    text accessToken
    bigint userId
    text firstName
    text lastName
    text email
    boolean accountOwner
    text locale
    boolean collaborator
    boolean emailVerified
    text refreshToken
    timestamp refreshTokenExpires
  }

  organizations {
    uuid id PK
    text shop UK
    text brand_slug
    text api_key UK
    text plan_tier
    integer trial_requests_remaining
    timestamp trial_exhausted_at
    integer base_fee_inr
    integer per_conversion_inr
    integer monthly_cap_inr
    text shopify_charge_id
    timestamp billing_period_start
    timestamp upgraded_at
    boolean onboarding_complete
    boolean widget_active
    timestamp installed_at
    timestamp updated_at
  }

  widget_configs {
    uuid id PK
    uuid org_id FK
    text position
    boolean is_enabled
    jsonb config
    timestamp created_at
    timestamp updated_at
  }

  fit_size_charts {
    uuid id PK
    uuid org_id FK
    text garment_type
    text size_label
    text fit_type
    numeric chest_min_cm
    numeric chest_max_cm
    numeric length_min_cm
    numeric length_max_cm
    numeric shoulder_min_cm
    numeric shoulder_max_cm
    numeric ease_value_cm
    text ease_source
    jsonb extra_measurements
    timestamp created_at
    timestamp updated_at
  }

  garment_mappings {
    uuid id PK
    uuid org_id FK
    text shopify_product_id
    text garment_type
    timestamp created_at
    timestamp updated_at
  }

  usage_logs {
    uuid id PK
    uuid org_id
    text ref_brand
    text ref_garment
    text ref_size
    text predicted_size
    integer confidence
    boolean is_boundary_case
    integer response_ms
    text visitor_id
    boolean led_to_conversion
    timestamp created_at
  }

  conversion_events {
    uuid id PK
    uuid org_id
    uuid usage_log_id
    text visitor_id
    text shopify_product_id
    boolean billed
    text billing_period
    timestamp created_at
  }

  brand_size_charts {
    text brand
    text garment_type
    text size_label
    numeric chest_min_cm
    numeric chest_max_cm
    numeric length_min_cm
    numeric length_max_cm
    numeric shoulder_min_cm
    numeric shoulder_max_cm
    text fit_type
    numeric ease_value_cm
    text ease_source
    timestamp scraped_at
  }

  anthropometric_anchors {
    text garment_type
    text size_label
    numeric chest_body_cm
    numeric shoulder_body_cm
    numeric height_cm
    timestamp created_at
    timestamp updated_at
  }

  brand_requests {
    uuid id PK
    uuid org_id FK
    text brand_name
    text brand_website
    text status
    timestamp created_at
    timestamp updated_at
  }

  scrape_runs {
    uuid id PK
    text brand
    text status
    integer rows_written
    text error_message
    timestamp started_at
    timestamp completed_at
  }

  organizations ||--|| widget_configs : "has one"
  organizations ||--o{ fit_size_charts : "owns"
  organizations ||--o{ garment_mappings : "owns"
  organizations ||--o{ brand_requests : "submits"
  usage_logs }o..o{ organizations : "soft ref"
  conversion_events }o..o{ usage_logs : "soft ref"
  conversion_events }o..o{ organizations : "soft ref"
  scrape_runs }o..|| brand_size_charts : "writes to brand"
```

---

## 2. sessions

> **Owner:** Shopify adapter (`@shopify/shopify-app-session-storage-drizzle`). Never write to this directly.

```mermaid
erDiagram
  sessions {
    text id PK "Shopify-generated session ID — text not UUID because Shopify controls the format"
    text shop "myshopify.com domain — join key to organizations"
    text state "OAuth CSRF state param — validates install flow"
    boolean isOnline "false = offline token used for background jobs. Snug uses offline tokens"
    text scope "Scopes granted during install. Stored to detect scope changes"
    timestamp expires "When session expires. Offline sessions are long-lived"
    text accessToken "Shopify Admin API token — NEVER log or expose in responses"
    bigint userId "Staff member ID — null for offline sessions"
    text firstName "Staff details — null for offline sessions"
    text lastName "Staff details — null for offline sessions"
    text email "Staff details — null for offline sessions"
    boolean accountOwner "Is this the store owner? Useful for restricting admin features"
    text locale "Staff preferred language — for future i18n"
    boolean collaborator "Is this a Shopify Partner collaborator?"
    boolean emailVerified "Has Shopify verified the staff email?"
    text refreshToken "Enables silent token refresh without full re-install"
    timestamp refreshTokenExpires "After this timestamp a full re-install is required"
  }
```

> **Do not touch this table.** The adapter owns the schema contract. Adding, renaming, or retyping any column will break the adapter silently.

---

## 3. organizations

> **Owner:** OAuth callback handler. The root record for every merchant. All other merchant-owned tables hang off this one.

```mermaid
erDiagram
  organizations {
    uuid id PK "DB-generated. Appears in KV keys and Worker requests"
    text shop UK "myshopify.com domain. UNIQUE — one store = one org. Join key to sessions"
    text brand_slug "Merchant brand e.g. snitch. Must exactly match brand_size_charts.brand"
    text api_key UK "Auto-generated on OAuth. Widget sends this to authenticate Worker calls"
    text plan_tier "trial or paid. CHECK constraint"
    integer trial_requests_remaining "Durable reporting value. Live enforcement is in UsageCounter DO"
    timestamp trial_exhausted_at "Null while trial is active. Set when counter hits 0"
    integer base_fee_inr "Monthly fixed fee in INR — paid tier only, nullable"
    integer per_conversion_inr "Per-conversion charge in INR — paid tier only, nullable"
    integer monthly_cap_inr "Max monthly charge cap — paid tier only, nullable"
    text shopify_charge_id "Shopify Billing API charge ID — paid tier only, nullable"
    timestamp billing_period_start "Start of current billing period. Resets on upgrade or period rollover"
    timestamp upgraded_at "When merchant moved to paid. Null on trial"
    boolean onboarding_complete "Has merchant finished initial setup? Separate from widget_active"
    boolean widget_active "Is widget actively serving? Worker checks this on every request"
    timestamp installed_at "First install — used for cohort retention analysis"
    timestamp updated_at "Last field change"
  }
```

**Key design notes:**
- `trial_requests_remaining` is the **durable reporting value** synced from the `UsageCounter` Durable Object at milestones. Never written on the hot prediction path.
- `onboarding_complete` and `widget_active` are intentionally split. Onboarding = has the merchant done initial setup. Widget active = is the widget currently live. A merchant can complete onboarding and then pause their widget.
- All billing columns (`base_fee_inr`, `per_conversion_inr`, etc.) are nullable — only populated on upgrade to paid.

---

## 4. widget_configs

> **Owner:** Merchant via dashboard. Created automatically with defaults when org is created. One-to-one with organizations.

```mermaid
erDiagram
  widget_configs {
    uuid id PK
    uuid org_id FK "UNIQUE — enforces 1:1 with organizations"
    text position "below_add_to_cart | above_add_to_cart | below_price. Widget JS reads this to know where to inject"
    boolean is_enabled "Merchant on/off toggle. Widget does not render when false"
    jsonb config "All visual settings: primary_color, button_label, font_size, animations. DB never queries inside this blob"
    timestamp created_at
    timestamp updated_at
  }
```

**Rule for what goes in explicit columns vs JSONB:**
If the system (Worker, app routing, widget loader) needs to branch on a value → explicit column.
If only the widget renderer reads it as a whole blob → JSONB. Position and is_enabled go in explicit columns. Button colour goes in JSONB.

---

## 5. fit_size_charts

> **Owner:** Merchant via dashboard. The **target side** of every prediction — the merchant's own sizing data.

```mermaid
erDiagram
  fit_size_charts {
    uuid id PK
    uuid org_id FK "Which merchant owns this row"
    text garment_type "tshirt | shirt | polo | sweatshirt | hoodie | jacket | kurta | top. CHECK constraint"
    text size_label "S | M | L | XL | 38 | 40 etc. Text because merchants use different size systems"
    text fit_type "slim | regular | oversized. CHECK constraint. Algorithm uses this for cross-fit penalty"
    numeric chest_min_cm "NOT NULL. Primary matching axis. Always centimetres — app converts on write"
    numeric chest_max_cm "NOT NULL. Algorithm uses midpoint of min+max as best estimate. Range width feeds confidence"
    numeric length_min_cm "Nullable. Secondary confidence signal for garments where length matters"
    numeric length_max_cm "Nullable"
    numeric shoulder_min_cm "Nullable. Most relevant for structured garments — jackets, shirts"
    numeric shoulder_max_cm "Nullable"
    numeric ease_value_cm "NOT NULL. Extra fabric beyond body measurement. Required for body-to-garment math in algorithm"
    text ease_source "explicit | inferred | user_calibrated. CHECK constraint. Feeds ease trust signal in confidence score"
    jsonb extra_measurements "Waist, hip, sleeve etc. Display-only in v0. Algorithm never reads this"
    timestamp created_at
    timestamp updated_at
  }
```

**Unique constraint:** `(org_id, garment_type, size_label)` — prevents duplicate size rows per merchant.

**How it gets to the Worker:** `pushChartToKV()` reads this table and writes `chart:{org_id}:{garment_type}` to Cloudflare KV sorted by chest midpoint. The Worker reads from KV on every prediction — it never queries Postgres on the hot path.

---

## 6. garment_mappings

> **Owner:** Merchant via the product mapping UI in the dashboard. Tells the widget which garment type a Shopify product belongs to.

```mermaid
erDiagram
  garment_mappings {
    uuid id PK
    uuid org_id FK "Which merchant owns this mapping"
    text shopify_product_id "Shopify GID e.g. gid://shopify/Product/8234567890. Stable — never changes even if product title changes"
    text garment_type "tshirt | shirt | polo etc. CHECK constraint. Used to look up the right fit_size_charts rows"
    timestamp created_at
    timestamp updated_at
  }
```

**Unique constraint:** `(org_id, shopify_product_id)` — one product maps to exactly one garment type per merchant.

**How it gets to the Worker:** `pushMappingsToKV()` writes `merchant:{org_id}:mappings` — a JSON object `{ shopify_product_id: { garment_type, is_active } }`. Widget sends the product ID, Worker does KV lookup → gets garment type → fetches chart from KV.

---

## 7. usage_logs

> **Owner:** Cloudflare Worker via `ctx.waitUntil()` — written asynchronously after the prediction response is already sent. **No FK constraints** — Worker uses a restricted DB user with INSERT-only permission on this table.

```mermaid
erDiagram
  usage_logs {
    uuid id PK
    uuid org_id "Soft ref to organizations — no FK. INSERT-only DB user cannot validate FK"
    text ref_brand "Brand the shopper said they own. Analytics: which reference brands are most used?"
    text ref_garment "Garment type the shopper selected"
    text ref_size "Size label the shopper entered for their reference brand"
    text predicted_size "Size the algorithm recommended for this merchant"
    integer confidence "0 to 100. Confidence label derived in app code — not stored here"
    boolean is_boundary_case "True if shopper sits within 2cm of a size band edge"
    integer response_ms "Prediction latency in ms — Worker performance monitoring"
    text visitor_id "Nullable anonymous shopper token — used to correlate with conversion_events"
    boolean led_to_conversion "Updated to true by order webhook when a purchase is attributed. Starts false"
    timestamp created_at "Primary time dimension for all analytics queries"
  }
```

**Indexes:**
- `(org_id, created_at)` — critical for per-org COUNT queries over time ranges in the analytics dashboard.

---

## 8. conversion_events

> **Owner:** Shopify order webhook handler. Written when a shopper who received a size prediction completes a purchase. **No FK constraints** — same restricted-user pattern as usage_logs.

```mermaid
erDiagram
  conversion_events {
    uuid id PK
    uuid org_id "Soft ref to organizations — no FK"
    uuid usage_log_id "Soft ref to usage_logs — the specific prediction that preceded this purchase"
    text visitor_id "Anonymous shopper token — the correlation key between prediction and Shopify order"
    text shopify_product_id "Which product was purchased"
    boolean billed "Has this conversion been included in a billing invoice? Starts false"
    text billing_period "Format YYYY-MM e.g. 2026-08. Used for monthly invoice grouping and capping"
    timestamp created_at
  }
```

**Indexes:**
- `(org_id, billing_period)` — billing cron: count unbilled conversions per org per month.
- `(visitor_id, shopify_product_id)` — deduplication: prevent double-counting if Shopify fires the webhook twice.

**Billing flow:** Cron reads `billed=false` rows grouped by `billing_period`, calculates `count * per_conversion_inr`, creates Shopify charge, then marks rows `billed=true`.

---

## 9. brand_size_charts

> **Owner:** WebScraper-Snug pipeline. The **reference side** of every prediction. Never written by the Shopify app or the Worker.

```mermaid
erDiagram
  brand_size_charts {
    text brand "Lowercase slug e.g. snitch, bewakoof. Part of composite PK"
    text garment_type "Same enum as fit_size_charts. CHECK constraint. Part of composite PK"
    text size_label "As printed on the garment. Part of composite PK"
    numeric chest_min_cm "NOT NULL. Always in cm — scraper converts from whatever unit the brand publishes"
    numeric chest_max_cm "NOT NULL"
    numeric length_min_cm "Nullable — not all brands publish length"
    numeric length_max_cm "Nullable"
    numeric shoulder_min_cm "Nullable"
    numeric shoulder_max_cm "Nullable"
    text fit_type "slim | regular | oversized. CHECK constraint. Drives cross-fit penalty in algorithm"
    numeric ease_value_cm "NOT NULL. How much extra fabric beyond body. Computed from scraped data + anthropometric_anchors"
    text ease_source "explicit | inferred | user_calibrated. CHECK constraint. Drives ease trust signal"
    timestamp scraped_at "When scraper last wrote this row. Feeds data freshness signal in confidence score"
  }
```

**Composite unique PK:** `(brand, garment_type, size_label)` — scraper uses upsert: re-scraping updates `scraped_at` and measurements, never duplicates.

**No FK to organizations.brand_slug** — scraper-owned table. Soft reference only: app validates `brand_slug` exists here, but DB does not enforce it with a constraint. This prevents a brand rename in the scraper from cascading into merchant records.

**Current scraped brands:**
`snitch` · `overlays` · `bewakoof` · `puma-india` · `rare-rabbit` · `nobero` · `souled-store` · `being-human` · `the-bear-house`

---

## 10. anthropometric_anchors

> **Owner:** Seeded once at DB setup from NIFT (National Institute of Fashion Technology) India survey data. Never updated at runtime.

```mermaid
erDiagram
  anthropometric_anchors {
    text garment_type "Part of composite PK. Same enum as fit_size_charts"
    text size_label "Part of composite PK. Canonical bucket: XS | S | M | L | XL | XXL"
    numeric chest_body_cm "NOT NULL. Population average body chest for this size. NIFT male seed values: XS=82 S=86 M=91 L=96 XL=102 XXL=108"
    numeric shoulder_body_cm "Nullable. Population average shoulder width"
    numeric height_cm "Nullable. Population average height for reference context"
    timestamp created_at
    timestamp updated_at
  }
```

**Composite unique PK:** `(garment_type, size_label)`

**Why it exists:** When the scraper cannot find explicit ease from a brand's website, it infers ease by comparing the scraped garment midpoint against the population average body measurement from this table. Without it the scraper falls back to hardcoded defaults which are less accurate.

**India-specific:** NIFT data reflects the Indian male body, which is the dominant use case for the initial target market. Future female / international rows can be added without schema changes.

---

## 11. brand_requests

> **Owner:** Merchant via dashboard — submitted when their brand is not found in `brand_size_charts` during onboarding.

```mermaid
erDiagram
  brand_requests {
    uuid id PK
    uuid org_id FK "Which merchant submitted this. Enables notification when brand is added"
    text brand_name "Exactly as merchant typed it — not slugified. Reveals spelling variants and regional names"
    text brand_website "Nullable. Scraper start URL. Merchant may not know it off the top of their head"
    text status "pending | in_progress | completed. CHECK constraint. Shown in merchant dashboard"
    timestamp created_at "Priority signal — older unfulfilled requests actioned first"
    timestamp updated_at "When status last changed"
  }
```

**Purpose:** This is the queue that tells the Snug team which brands to scrape next. Multiple merchants requesting the same brand signals higher priority. When the scraper successfully writes rows for a brand, the status updates to `completed` and the merchant is notified.

---

## 12. scrape_runs

> **Owner:** WebScraper-Snug pipeline. One row per brand per scrape attempt. The operational health log for the scraper system.

```mermaid
erDiagram
  scrape_runs {
    uuid id PK
    text brand "Which brand this run attempted. Matches brand_size_charts.brand"
    text status "success | partial | failed. CHECK constraint. partial = some garment types scraped not all"
    integer rows_written "Rows written to brand_size_charts. A success with 0 rows should fire an alert"
    text error_message "Nullable. Failure or partial reason. Null on success"
    timestamp started_at "When scraper began processing this brand"
    timestamp completed_at "Nullable — null if scraper crashed before finishing"
  }
```

**Why it exists:** Without this table there is no operational visibility into the scraper. Silently failed scrapes only surface when merchants complain about low confidence scores. `scrape_runs` lets the team monitor: which brands are failing, scrape duration trends (brand website slowdowns), and when data was last refreshed.

**Relationship to confidence score:** The confidence signal reads `scraped_at` from `brand_size_charts` rows. `scrape_runs` is the internal audit trail that explains *why* a `scraped_at` might be stale — was it a partial failure? When was the last successful run?

---

## 13. What scrape_runs and conversion_events actually are

### `scrape_runs` — the scraper's operation log

Think of it as a **per-run audit trail for WebScraper-Snug**. Every time the scraper runs for a brand, it writes one row:

```
brand=snitch | status=success | rows_written=24 | started_at=... | completed_at=...
brand=bewakoof | status=partial | rows_written=12 | error_message="hoodie tab not found" | ...
brand=overlays | status=failed | rows_written=0 | error_message="timeout on product page" | ...
```

This is completely invisible to merchants. It is internal operational tooling — it tells the Snug team:
- Is the scraper keeping data fresh?
- Which brands are failing and why?
- How long does each brand take? (useful for detecting site slowdowns)

It connects to the confidence score indirectly: `brand_size_charts.scraped_at` is what the algorithm reads for freshness. `scrape_runs` is what tells you *why* that timestamp might be stale.

---

### `conversion_events` — the purchase attribution table

This answers: **"Did a shopper who used the widget actually buy something?"**

```
Shopper flow:
  1. Lands on product page
  2. Widget fires → POST /v1/size → usage_logs row created { visitor_id: "abc123" }
  3. Shopper adds to cart → buys
  4. Shopify fires order/paid webhook → Shopify app handler
  5. App matches order line items by shopify_product_id + visitor_id cookie
  6. Writes conversion_events row { usage_log_id: ..., visitor_id: "abc123", billed: false }
  7. Sets usage_logs.led_to_conversion = true
```

This table serves two purposes:

**1. Merchant analytics:** "Your widget helped convert X shoppers this month — here is your conversion rate." Without this, the analytics dashboard can only show predictions served, not whether those predictions led to purchases.

**2. Billing on paid tier:** On a `per_conversion_inr` plan, the monthly billing cron:
- Counts `billed=false` rows per `billing_period` per org
- Calculates `count × per_conversion_inr` (capped by `monthly_cap_inr`)
- Creates Shopify billing charge
- Marks those rows `billed=true`

Without `conversion_events`, you cannot prove ROI to merchants and you cannot run a conversion-based billing model.

---

## Relationship Summary

| From | To | Type | Constraint |
|---|---|---|---|
| `sessions` | `organizations` | joined by `shop` domain | app-level (no FK) |
| `organizations` | `widget_configs` | one-to-one | FK + unique index |
| `organizations` | `fit_size_charts` | one-to-many | FK |
| `organizations` | `garment_mappings` | one-to-many | FK |
| `organizations` | `brand_requests` | one-to-many | FK |
| `usage_logs` | `organizations` | many-to-one | **soft — no FK** |
| `conversion_events` | `organizations` | many-to-one | **soft — no FK** |
| `conversion_events` | `usage_logs` | many-to-one | **soft — no FK** |
| `scrape_runs` | `brand_size_charts` | writes to via brand slug | **soft — no FK** |
| `organizations` | `brand_size_charts` | via `brand_slug` field | **soft — no FK** |

**Why `usage_logs` and `conversion_events` have no FKs:**
The Cloudflare Worker and Shopify webhook handler write these tables using a **restricted DB user with INSERT-only permission**. A FK constraint would require the writer to have SELECT on the referenced table to validate the reference — that violates least-privilege. The application layer validates `org_id` values before writing; the DB trusts the writer.
