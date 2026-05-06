# Snug — Complete Build Plan for a Two-Person Team

---

## Table of Contents

1. [Team Structure and Responsibilities](#1-team-structure-and-responsibilities)
2. [Guiding Principles](#2-guiding-principles)
3. [Complete Feature List](#3-complete-feature-list)
4. [Build Phases](#4-build-phases)
5. [Phase Breakdown with Tasks](#5-phase-breakdown-with-tasks)
6. [Dependency Map](#6-dependency-map)
7. [Definition of Done](#7-definition-of-done)
8. [Risk Register](#8-risk-register)
9. [What Gets Cut if Time is Short](#9-what-gets-cut-if-time-is-short)

---

## 1. Team Structure and Responsibilities

With two people, you cannot have clean separation by system layer. Instead split by product surface. Each person owns their surface end to end — database schema for their surface, backend logic, frontend if applicable, and testing.

### Person A — Platform and API

Owns everything the shopper never sees directly but that the entire product depends on.

- Cloudflare Worker (sizing API)
- Sizing algorithm implementation
- Cloudflare KV structure and reads/writes
- Upstash Redis usage enforcement and burst limiting
- Neon database schema and migrations
- Cron jobs (usage sync and billing rollover)
- Webhook handlers
- Silent API key generation and injection

### Person B — Merchant Experience

Owns everything the merchant interacts with and the shopper sees on the storefront.

- Shopify React Router dashboard (all routes)
- Polaris UI components
- Shopify OAuth flow (template-provided but needs configuration)
- Storefront widget (Theme App Extension)
- Widget JS bundle
- Garment mapping UI
- Analytics UI
- Billing UI

### Where they intersect

The database schema is jointly owned. Any schema change requires both people to agree before it is pushed. The KV key structure is defined by Person A but Person B's dashboard writes to KV on save operations — these writes must follow the structure Person A defines. Define the KV contract in writing before either person starts building.

---

## 2. Guiding Principles

These are the rules that prevent a two-person team from grinding to a halt.

**Build in vertical slices, not horizontal layers.** Do not finish the entire database before starting the API. Do not finish the entire API before starting the dashboard. Build one complete feature end to end — schema, backend, UI, tested — before starting the next. This gives you something working at every point and surfaces integration problems early.

**The algorithm is the product.** Every other part of the system is infrastructure that supports the algorithm. If you are ever unsure what to prioritise, the answer is whatever gets the algorithm running and serving real predictions faster.

**Fake things that are not built yet.** The dashboard needs brand data. Seed the database manually with five real brand size charts to unblock dashboard development. Fake it, note it, replace it later.

**Ship to real merchants as fast as possible.** The first beta merchant on a real Shopify store is worth more than three more features. Plan every phase with a shippable state in mind.

**Never break main.** Use feature branches. Person A and Person B work on separate branches. Merge to main only when a feature is complete and tested. Main is always deployable.

---

## 3. Complete Feature List

Every feature the system needs, across all surfaces. Organised by surface and marked with priority.

Priority levels:
- **P0** — Without this the product does not work at all
- **P1** — Without this the product cannot be used by a real merchant
- **P2** — Without this the product is incomplete but usable for early beta
- **P3** — Nice to have, post-beta

### Database and Infrastructure

| # | Feature | Priority | Owner |
|---|---|---|---|
| DB-01 | Neon Postgres project setup and connection strings | P0 | A |
| DB-02 | Full schema push via drizzle-kit (all tables) | P0 | A |
| DB-03 | Seed `anthropometric_anchors` with NIFT data | P0 | A |
| DB-04 | Seed `brand_size_charts` with 10 reference brands manually | P0 | A |
| DB-05 | Restricted Neon connection string for Worker | P0 | A |
| DB-06 | Cloudflare KV namespace setup and key structure documented | P0 | A |
| DB-07 | Upstash Redis project setup | P0 | A |
| DB-08 | Railway project setup, environment variables configured | P0 | B |

---

### Cloudflare Worker — Sizing API

| # | Feature | Priority | Owner |
|---|---|---|---|
| API-01 | Worker project scaffolded with Hono.js and TypeScript | P0 | A |
| API-02 | `POST /v1/size` endpoint skeleton | P0 | A |
| API-03 | API key validation via KV lookup (`apikey:{key}`) | P0 | A |
| API-04 | Origin header secondary validation | P0 | A |
| API-05 | Monthly usage cap enforcement via Redis atomic DECR | P0 | A |
| API-06 | Burst rate limiting via Redis INCR per minute bucket | P1 | A |
| API-07 | Input validation (brand, garment, size against KV) | P0 | A |
| API-08 | Reference brand size chart fetch from KV | P0 | A |
| API-09 | Merchant size chart fetch from KV | P0 | A |
| API-10 | Nine-step sizing algorithm implementation | P0 | A |
| API-11 | Five-signal confidence score computation | P0 | A |
| API-12 | Cross-fit penalty and boundary case penalty | P0 | A |
| API-13 | Boundary case detection and `suggested_sizes` output | P0 | A |
| API-14 | Full success response shape with reasoning block | P0 | A |
| API-15 | All 401, 422, 429, 500 error responses | P0 | A |
| API-16 | Usage log INSERT via `ctx.waitUntil()` (non-blocking) | P0 | A |
| API-17 | `GET /v1/product/{product_id}` for garment mapping lookup | P1 | A |
| API-18 | CORS headers for all responses | P0 | A |
| API-19 | Worker unit tests for algorithm (all edge cases) | P1 | A |
| API-20 | Worker deployed to Cloudflare production | P0 | A |

---

### Cron Jobs

| # | Feature | Priority | Owner |
|---|---|---|---|
| CRON-01 | Usage sync cron scaffolded on Railway | P1 | A |
| CRON-02 | COUNT usage_logs per org since billing_period_start | P1 | A |
| CRON-03 | UPDATE organizations.usage_remaining | P1 | A |
| CRON-04 | SET Redis usage:{org_id} counter from Neon count | P1 | A |
| CRON-05 | KV update for shop:{domain} after sync | P1 | A |
| CRON-06 | Redis counter rebuild if counter is missing | P1 | A |
| CRON-07 | Billing period rollover cron scaffolded on Railway | P1 | A |
| CRON-08 | Detect elapsed billing periods and reset counters | P1 | A |
| CRON-09 | Reset usage_remaining in Neon and Redis on rollover | P1 | A |

---

### Shopify App — OAuth and Install Flow

| # | Feature | Priority | Owner |
|---|---|---|---|
| AUTH-01 | React Router template configured with correct scopes | P0 | B |
| AUTH-02 | OAuth install flow working end to end on dev store | P0 | B |
| AUTH-03 | Session storage working in Neon via Drizzle adapter | P0 | B |
| AUTH-04 | Organization row created on install | P0 | A+B |
| AUTH-05 | Silent API key generated and stored on install | P0 | A+B |
| AUTH-06 | KV entries written on install (`apikey:{}`, `shop:{}`) | P0 | A+B |
| AUTH-07 | Redis usage counter initialised on install | P0 | A+B |
| AUTH-08 | API key injected into Theme App Extension on install | P0 | A+B |
| AUTH-09 | Webhooks registered on install | P0 | B |
| AUTH-10 | `app/uninstalled` webhook handler | P0 | B |
| AUTH-11 | `shop/redact` webhook handler (GDPR) | P1 | B |
| AUTH-12 | `customers/redact` webhook handler (GDPR) | P1 | B |
| AUTH-13 | `customers/data_request` webhook handler (GDPR) | P1 | B |

---

### Shopify App — Dashboard Routes

| # | Feature | Priority | Owner |
|---|---|---|---|
| DASH-01 | Home screen with three-state onboarding awareness | P0 | B |
| DASH-02 | Brand setup page (search, select, save brand slug) | P0 | B |
| DASH-03 | Brand not found — inline brand request form | P1 | B |
| DASH-04 | Brand request writes to `brand_requests` in Neon | P1 | B |
| DASH-05 | Fit size chart creation UI (per garment type) | P0 | B |
| DASH-06 | Fit size chart size row entry (per size label) | P0 | B |
| DASH-07 | Fit size chart saves to Neon and pushes to KV | P0 | A+B |
| DASH-08 | Fit size chart list and edit view | P1 | B |
| DASH-09 | Garment mapping UI — product list from Shopify API | P0 | B |
| DASH-10 | Garment mapping UI — assign garment type per product | P0 | B |
| DASH-11 | Garment mapping UI — chart override per product | P2 | B |
| DASH-12 | Widget configuration page (position, is_enabled) | P1 | B |
| DASH-13 | Widget config visual settings (config JSONB) | P2 | B |
| DASH-14 | Widget activation — theme editor deep link | P0 | B |
| DASH-15 | Widget activation — manual mark as active button | P1 | B |
| DASH-16 | Analytics page — summary stat cards | P1 | B |
| DASH-17 | Analytics page — recommendation volume over time | P2 | B |
| DASH-18 | Analytics page — reference brand breakdown table | P2 | B |
| DASH-19 | Analytics page — predicted size distribution table | P2 | B |
| DASH-20 | Analytics empty state | P1 | B |
| DASH-21 | Billing page — current plan and usage progress bar | P1 | B |
| DASH-22 | Billing page — plan comparison | P2 | B |
| DASH-23 | Billing page — Shopify billing API upgrade flow | P2 | B |
| DASH-24 | Navigation updated with all routes | P0 | B |
| DASH-25 | Error boundaries on all routes | P1 | B |
| DASH-26 | Loading states on all data-fetching routes | P1 | B |

---

### Storefront Widget — Theme App Extension

| # | Feature | Priority | Owner |
|---|---|---|---|
| WID-01 | Theme App Extension scaffolded via Shopify CLI | P0 | B |
| WID-02 | Vanilla JS bundle project setup | P0 | B |
| WID-03 | Read API key from Theme App Extension config | P0 | A+B |
| WID-04 | Read Shopify product ID from page context | P0 | B |
| WID-05 | Call Worker to check if product is mapped | P0 | B |
| WID-06 | Render reference brand dropdown | P0 | B |
| WID-07 | Render garment type selector | P0 | B |
| WID-08 | Render size label selector (filtered by brand+garment) | P0 | B |
| WID-09 | POST to Worker `/v1/size` with `X-Snug-Key` header | P0 | B |
| WID-10 | Display predicted size and confidence label | P0 | B |
| WID-11 | Display boundary case — two size suggestion UI | P1 | B |
| WID-12 | Handle monthly limit reached error gracefully | P1 | B |
| WID-13 | Handle brand not found error gracefully | P1 | B |
| WID-14 | Handle size not found error gracefully | P1 | B |
| WID-15 | Widget respects `is_enabled` and `position` config | P1 | B |
| WID-16 | Widget respects visual config (colors, button text) | P2 | B |
| WID-17 | Widget loading state while waiting for API response | P1 | B |
| WID-18 | Widget accessible (ARIA labels, keyboard navigation) | P2 | B |
| WID-19 | Widget bundle size under 10kb gzipped | P1 | B |
| WID-20 | Widget tested on Dawn theme | P1 | B |
| WID-21 | Widget tested on Debut theme | P2 | B |

---

## 4. Build Phases

Six phases. Each phase ends with a deployable, testable state. No phase starts until the previous one has a working build.

```
Phase 1 — Foundation         Weeks 1–2
  Database, infrastructure, algorithm core

Phase 2 — API Live           Weeks 3–4
  Worker running in production, manually testable

Phase 3 — Merchant Onboarding  Weeks 5–6
  Full install flow, brand setup, size chart creation

Phase 4 — Widget Live        Weeks 7–8
  Storefront widget serving real predictions

Phase 5 — Complete Dashboard   Weeks 9–10
  Analytics, billing, widget config, all GDPR webhooks

Phase 6 — Beta Hardening     Weeks 11–12
  Performance, edge cases, App Store prep
```

---

## 5. Phase Breakdown with Tasks

---

### Phase 1 — Foundation (Weeks 1–2)

**Goal:** Everything is set up, the database schema is live in Neon, the algorithm can run against seeded data in a test script, and both people can deploy their respective pieces.

**Person A tasks:**

- DB-01: Create Neon project, get connection strings (full and restricted)
- DB-06: Define and document KV namespace and all key patterns
- DB-07: Create Upstash Redis project, get credentials
- DB-02: Write full Drizzle schema for all tables, push to Neon
- DB-03: Seed `anthropometric_anchors` with NIFT male values
- DB-04: Manually seed `brand_size_charts` with 10 reference brands (Uniqlo, Zara, H&M, Snitch, Bewakoof, The Souled Store, Mango, Levis, Nike, Adidas) — use real published size charts
- API-01: Scaffold Cloudflare Worker project with Hono.js and TypeScript
- API-10: Implement the nine-step sizing algorithm as a pure function with no I/O
- API-11: Implement five-signal confidence score computation
- API-12: Implement cross-fit and boundary penalties
- API-13: Implement boundary case detection
- Write algorithm unit tests covering: exact range match, below range, above range, boundary case, cross-fit slim to oversized, cross-fit regular to regular, all ease source trust levels

**Person B tasks:**

- DB-08: Set up Railway project, configure environment variables
- AUTH-01: Verify React Router template scopes and TOML are correct
- AUTH-02: Confirm OAuth install flow works end to end on dev store (already done in prior work)
- AUTH-03: Confirm session storage in Neon works (already done)
- DASH-01: Polish home screen onboarding state machine
- DASH-24: Update navigation

**End of Phase 1 state:**
Algorithm runs correctly against seeded data in a test script. Database schema is live. Both people have working local dev environments. OAuth works. Navigation is correct.

---

### Phase 2 — API Live (Weeks 3–4)

**Goal:** The Cloudflare Worker is deployed to production and can serve real sizing predictions. A test request via curl returns a correct prediction.

**Person A tasks:**

- API-02: `POST /v1/size` endpoint skeleton
- API-03: API key validation via KV lookup
- API-04: Origin header secondary validation
- API-05: Monthly usage cap enforcement via Redis atomic DECR
- API-06: Burst rate limiting via Redis INCR
- API-07: Input validation against KV
- API-08: Reference brand size chart fetch from KV
- API-09: Merchant size chart fetch from KV (mock merchant data in KV for testing)
- API-14: Full success response shape
- API-15: All error responses (401, 422, 429, 500)
- API-16: Usage log INSERT via `ctx.waitUntil()`
- API-18: CORS headers
- API-20: Deploy Worker to Cloudflare production
- Manually populate KV with seeded brand data and one mock merchant entry for end-to-end testing

**Person B tasks:**

- AUTH-04: Organization row created on install (wire up OAuth callback to create org)
- AUTH-05: Silent API key generated and stored on install
- AUTH-09: Webhooks registered on install
- AUTH-10: `app/uninstalled` webhook handler (set widget_active false, delete session, update KV)
- DASH-02: Brand setup page — search, select, save brand slug to Neon

**Sync point:** At end of week 4, Person A and Person B sit together. Person B's install flow should write the KV entries that Person A's Worker reads. Test the full path: install app, Worker reads KV for that merchant, curl a prediction request, get a valid response.

**End of Phase 2 state:**
Worker is live in production. A merchant can install the app, and a correctly formatted curl request to the Worker returns a real sizing prediction for that merchant.

---

### Phase 3 — Merchant Onboarding (Weeks 5–6)

**Goal:** A merchant can install the app, set up their brand, create their fit size charts, and map their products to garment types entirely through the dashboard UI. No manual database intervention needed.

**Person A tasks:**

- AUTH-06: KV entries written correctly on install
- AUTH-07: Redis usage counter initialised on install
- CRON-01: Usage sync cron scaffolded on Railway
- CRON-02 through CRON-06: Full usage sync cron implementation
- CRON-07 through CRON-09: Billing period rollover cron implementation
- API-17: `GET /v1/product/{product_id}` for garment mapping lookup from KV

**Person B tasks:**

- DASH-05: Fit size chart creation UI
- DASH-06: Size row entry per size label
- DASH-07: Fit size chart save to Neon — trigger KV push on save
- DASH-08: Fit size chart list and edit view
- DASH-09: Garment mapping UI — fetch product list from Shopify Admin API
- DASH-10: Garment mapping UI — assign garment type per product, save to Neon
- DASH-14: Widget activation — theme editor deep link
- DASH-15: Widget activation — manual mark as active button
- DASH-25: Error boundaries on all routes
- DASH-26: Loading states on all routes

**End of Phase 3 state:**
A merchant can complete the entire onboarding flow — install, brand setup, size chart creation, product mapping, widget activation — with no manual database work. The dashboard is functional end to end for a new merchant.

---

### Phase 4 — Widget Live (Weeks 7–8)

**Goal:** The storefront widget is live on a real Shopify dev store product page, serving real predictions to a real browser.

**Person A tasks:**

- AUTH-08: API key injection into Theme App Extension config on install
- API-19: Worker unit tests for algorithm edge cases
- Fix any Worker bugs discovered during widget integration

**Person B tasks:**

- WID-01: Theme App Extension scaffolded via Shopify CLI
- WID-02: Vanilla JS bundle project setup (build tooling, output to extension assets)
- WID-03: Read API key from Theme App Extension config
- WID-04: Read Shopify product ID from page context
- WID-05: Call Worker to check if product is mapped
- WID-06: Render reference brand dropdown (populated from KV `brands:supported`)
- WID-07: Render garment type selector
- WID-08: Render size label selector filtered by brand and garment
- WID-09: POST to Worker with `X-Snug-Key` header
- WID-10: Display predicted size and confidence label
- WID-11: Boundary case two-size suggestion UI
- WID-17: Loading state while waiting for API response
- WID-12 through WID-14: All error state handling
- WID-15: Widget respects `is_enabled` and position config
- WID-20: Test on Dawn theme

**End of Phase 4 state:**
The widget is live on a dev store product page. A real browser can open a product page, interact with the widget, and receive a sizing prediction. This is the first moment the product works end to end as a shopper would experience it.

---

### Phase 5 — Complete Dashboard (Weeks 9–10)

**Goal:** Every dashboard route is built. A merchant has full visibility into their usage and analytics. GDPR webhooks are in place.

**Person A tasks:**

- AUTH-11 through AUTH-13: GDPR webhook handlers (shop/redact, customers/redact, customers/data_request)
- DB-05: Confirm restricted Neon connection string is correctly scoped
- Review analytics queries for performance — add indexes if COUNT queries on `usage_logs` are slow

**Person B tasks:**

- DASH-03: Brand not found inline brand request form
- DASH-04: Brand request writes to Neon
- DASH-11: Garment mapping chart override per product
- DASH-12: Widget configuration page
- DASH-16: Analytics page — summary stat cards
- DASH-20: Analytics empty state
- DASH-21: Billing page — current plan and usage progress bar
- DASH-17 through DASH-19: Analytics volume chart, brand breakdown, size distribution
- DASH-22: Billing plan comparison
- DASH-23: Shopify billing API upgrade flow
- DASH-13: Widget visual config settings

**End of Phase 5 state:**
Every dashboard route exists and works. Merchants can see their analytics, manage billing, configure their widget fully, and submit brand requests. All four GDPR webhooks return 200.

---

### Phase 6 — Beta Hardening (Weeks 11–12)

**Goal:** The product is ready for real merchants. Performance is acceptable, edge cases are handled, and the App Store listing is prepared.

**Person A tasks:**

- Worker load testing — simulate concurrent requests, verify Redis atomic behaviour holds under load
- Verify KV TTL strategy is correct — confirm no brand data expires prematurely
- Verify restricted Neon connection string truly cannot read or update outside usage_logs

**Person B tasks:**

- WID-18: Widget accessibility (ARIA labels, keyboard nav)
- WID-19: Widget bundle size audit — target under 10kb gzipped
- WID-21: Widget tested on at least one additional theme
- WID-16: Widget visual config from JSONB applied to widget rendering
- DASH-13: Widget config visual settings wired to widget rendering
- App Store listing content — screenshots, description, feature list
- Shopify App Store review checklist — confirm all mandatory items are met
- Privacy policy page

**Both together:**

- End-to-end test with a real external merchant (not your own test store)
- Identify the top five things that feel broken or confusing and fix them before submission
- Write the App Store listing description

**End of Phase 6 state:**
The product is submitted to the Shopify App Store for review.

---

## 6. Dependency Map

Some features cannot start until other features are done. These are the hard blockers.

```
DB-02 (schema pushed)
  └──► All other features depend on this

DB-03 + DB-04 (seeded data)
  └──► API-07, API-08, API-10 (algorithm needs data to run against)

API-01 (Worker scaffolded)
  └──► All API features

API-10 (algorithm)
  └──► API-02 (endpoint needs algorithm to call)
  └──► API-19 (tests need algorithm)

API-03 (API key validation)
  └──► AUTH-05 (key must be generated before Worker can validate it)
  └──► AUTH-08 (key must be in TAE config before widget can send it)
  └──► WID-03 (widget reads key from TAE)
  └──► WID-09 (widget sends key in header)

AUTH-04 + AUTH-05 + AUTH-06 (org, key, KV on install)
  └──► API-03 can be tested end-to-end

DASH-05 + DASH-06 + DASH-07 (size chart creation and KV push)
  └──► API-09 (Worker can only fetch merchant charts after they exist in KV)
  └──► WID-05 (widget can only check mapping after charts exist)

DASH-09 + DASH-10 (product mapping)
  └──► API-17 (product mapping lookup endpoint needs data)
  └──► WID-04 + WID-05 (widget reads product mapping)

WID-01 + WID-02 (TAE scaffolded)
  └──► All WID features
  └──► AUTH-08 (can only inject key into TAE after TAE exists)

CRON-01 through CRON-06 (usage sync)
  └──► DASH-21 (billing page needs accurate usage_remaining)
  └──► Redis counter stays accurate without this but drifts over time
```

---

## 7. Definition of Done

A feature is done when all five of these are true. Not three. Not four. All five.

1. **It works in production, not just locally.** Tested against the deployed Railway app or Cloudflare Worker, not just `localhost`.

2. **It handles its error cases.** Every input that should fail returns the correct error. Every network dependency that could be absent is handled gracefully.

3. **It does not break existing features.** Test the features that touch the same database tables or KV keys before marking anything done.

4. **The other person has reviewed the code.** Not a formal process — a 15-minute walk-through is enough. The point is that neither person is the only one who understands any part of the codebase.

5. **It is documented if it introduces a new contract.** Any new KV key pattern, any new API endpoint shape, any new database column that the other person's code needs to know about is written down before the PR is merged.

---

## 8. Risk Register

Risks that could derail the timeline, ordered by likelihood.

### Risk 1 — Shopify App Store review takes longer than expected

**Likelihood:** High. Shopify review typically takes 1–3 weeks and often requires revisions.

**Impact:** Launch delayed by weeks.

**Mitigation:** Submit for review at end of Phase 6 with the checklist complete. Do not wait until everything feels perfect. Start a second review iteration immediately if the first is rejected. Common rejection reasons: missing GDPR webhooks (handled in Phase 5), performance issues with the widget, incomplete privacy policy.

---

### Risk 2 — Widget breaks on specific merchant themes

**Likelihood:** Medium. Shopify themes vary enormously in their DOM structure and CSS.

**Impact:** Widget does not render or renders incorrectly on some merchant storefronts.

**Mitigation:** Test on Dawn (the most common free theme) in Phase 4. Test on at least one premium theme in Phase 6. Use CSS custom properties scoped to the widget container to avoid style conflicts.

---

### Risk 3 — Redis usage counter drifts from Neon truth

**Likelihood:** Medium. Cron job failures, Redis ephemeral storage resets, and clock skew can all cause drift.

**Impact:** Merchants see incorrect usage numbers. Over-serving or under-serving against plan limits.

**Mitigation:** The cron job rebuilds Redis from Neon on every run — drift is self-correcting as long as the cron runs. Add monitoring to alert if the cron has not run in over 15 minutes.

---

### Risk 4 — Algorithm produces wrong predictions for specific brand combinations

**Likelihood:** Medium. Especially for cross-fit predictions (slim reference, oversized target) and brands with unusual ease values.

**Impact:** Wrong size recommendation. Shopper orders wrong size. Defeats the purpose of the product.

**Mitigation:** Unit test every edge case in Phase 1 before the algorithm is wired to any I/O. Use real brand data for tests. Run manual validation against 20 known correct cross-brand size translations before beta launch.

---

### Risk 5 — KV cache serves stale data after merchant updates size charts

**Likelihood:** Low with the current design. Dashboard writes to KV on save.

**Impact:** Widget serves predictions based on outdated size data.

**Mitigation:** Dashboard KV write is triggered synchronously on every size chart save. No TTL on merchant chart KV keys — they are updated on write, not expired and re-fetched.

---

### Risk 6 — Railway cold starts affect dashboard load time

**Likelihood:** Low. Railway keeps processes warm for active apps.

**Impact:** Slow dashboard loads for merchants who open the app infrequently.

**Mitigation:** This does not affect the widget or the Worker at all. Dashboard cold starts are a minor UX issue, not a product-breaking problem. Acceptable for v0.

---

## 9. What Gets Cut if Time is Short

If the twelve-week plan is too aggressive for two people working part-time, here is what gets cut and in what order.

### Cut first (P3 features — no beta impact)

- WID-21: Widget testing on Debut theme. Dawn testing is sufficient.
- DASH-22, DASH-23: Billing plan comparison and Shopify billing upgrade flow. Free tier only for beta.

### Cut second (P2 features — beta works without these)

- DASH-11: Chart override per product in garment mappings. All products use the org-level chart.
- DASH-13, WID-16: Widget visual config. Widget renders with default styling.
- DASH-17 through DASH-19: Detailed analytics charts. Show summary stats only.
- WID-18: Widget accessibility. Add in Phase 7 post-beta.
- CRON-07 through CRON-09: Billing period rollover cron. If billing is not launched, this is not needed.

### Never cut (P0 and P1 features)

- The algorithm. The entire product is the algorithm.
- API key auth and origin validation. Without these the API is open to abuse.
- Usage cap enforcement. Without this free-tier merchants can drain the system.
- The full install flow. Without this no merchant can use the product.
- Size chart creation and product mapping UI. Without these the widget has no data.
- The widget serving a prediction. Without this there is no product.
- GDPR webhooks. Without these the app cannot be listed on the App Store.
- Error states in the widget. A widget that crashes silently is worse than no widget.

---

## Appendix — Week by Week Summary

| Week | Person A | Person B |
|---|---|---|
| 1 | DB setup, schema push, seed data, algorithm pure function | Railway setup, OAuth verify, home screen polish |
| 2 | Algorithm unit tests, Worker scaffold, KV structure docs | Nav, brand setup page start |
| 3 | Worker endpoints: auth, rate limiting, input validation | OAuth install writes org + key + KV |
| 4 | Worker endpoints: algorithm, response, usage log, deploy | Webhooks, brand setup complete |
| 5 | Cron jobs: usage sync | Size chart creation UI |
| 6 | Cron jobs: billing rollover, API product mapping endpoint | Garment mapping UI, widget activation |
| 7 | API key TAE injection, Worker unit tests | Theme App Extension scaffold, widget JS start |
| 8 | Worker bug fixes, integration support | Widget: all core features live on dev store |
| 9 | GDPR webhooks, Neon index review | Analytics page, billing page start |
| 10 | Load testing, restricted connection audit | Billing API, widget config, brand request form |
| 11 | Reference data management | Widget: accessibility, bundle size, second theme |
| 12 | KV sync optimization, cron schedule review | App Store listing, privacy policy, final testing |