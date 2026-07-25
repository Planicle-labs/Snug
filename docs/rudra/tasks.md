# Rudra — Actionable Task Breakdown & Execution Schedule

---

## 📅 Timeline

**Target Completion Window:** July 24, 2026 – July 28, 2026 (5 Days Total)

| Date | Phase & Focus | Target Deliverables |
|---|---|---|
| **Day 1 (Jul 24)** | **Phase 1: Database & OAuth Setup** | TASK-R00 (Schema/Migration Sync), TASK-R01 (`afterAuth` Callback), `app.brand.tsx` schema fixes |
| **Day 2 (Jul 25)** | **Phase 2: Real-time KV Synchronization** | TASK-R02 (`kv.server.ts` helper), TASK-R03 (Size Chart KV Sync), Widget activation KV Sync |
| **Day 3 (Jul 26)** | **Phase 3: Storefront Widget Extension** | TASK-R04 (TAE Scaffold), TASK-R05 (Vanilla JS Bundle & Two-Size Boundary UI), TASK-R06 (Dawn Theme Testing) |
| **Day 4 (Jul 27)** | **Phase 4: Dashboard Routes & UX** | TASK-R07 (Analytics Route), TASK-R08 (Billing Route), TASK-R12 (Shopify Admin GraphQL Product Picker), Onboarding Step logic fix |
| **Day 5 (Jul 28)** | **Phase 5: Compliance & Webhooks** | TASK-R10 (Shop Redact), TASK-R11 (Customer GDPR Webhooks), Uninstall Webhook completion, `shopify.app.toml` & landing page polish |

---

## 1. Database Foundation & OAuth Install Sync

- [x] **TASK-R00: Schema & Migration Synchronization**
  - **Details**: Sync Drizzle schema with current trial model (`planTier: 'trial'`, `trialRequestsRemaining: 1000`, `conversionEvents`, `brandSizeCharts`). Generate and apply updated Drizzle migration. Fix legacy field references (`planTier: 'free'`, `usageRemaining: 500`) in `app.brand.tsx`.
  - **Target Date**: Jul 24, 2026

- [x] **TASK-R01: Automatic Org & API Key Creation on Install**
  - **File**: `shopify-app/app/shopify.server.ts`
  - **Details**: Add `afterAuth` callback to `shopifyApp` config to automatically insert an `organizations` row, generate a unique `api_key`, initialize `apikey:{key}` in Cloudflare KV, and set default trial quota.
  - **Target Date**: Jul 24, 2026

- [x] **TASK-R02: Dashboard KV Sync Utility**
  - **File**: `shopify-app/app/lib/kv.server.ts`
  - **Details**: Implement helper function `pushChartToKV(orgId, garmentType)` to sync fit size charts from Neon Postgres into Cloudflare KV key `chart:{org_id}:{garment_type}` whenever size charts are created/updated.
  - **Target Date**: Jul 25, 2026

- [x] **TASK-R03: Wire KV Sync in Size Chart & Widget Management Routes**
  - **Files**: `shopify-app/app/routes/app.size-charts.tsx`, `shopify-app/app/routes/app.widget.tsx`
  - **Details**: Trigger `pushChartToKV()` in the size chart action handler after successful database mutation. Update widget activation/deactivation action to update `apikey:{key}` record's `widget_active` status in KV.
  - **Target Date**: Jul 25, 2026

---

## 2. Storefront Widget (Theme App Extension)

- [x] **TASK-R04: Scaffold Theme App Extension**
  - **Directory**: `shopify-app/extensions/snug-widget/`
  - **Details**: Run Shopify CLI `shopify app generate extension` (theme app extension). Create app block liquid file `blocks/snug_widget.liquid`.
  - **Target Date**: Jul 26, 2026

- [x] **TASK-R05: Storefront Widget Vanilla JS Bundle (< 10KB)**
  - **Directory**: `shopify-app/extensions/snug-widget/assets/`
  - **Details**: Write pure Vanilla JS modal/widget script:
    1. Read API key and product ID from page liquid context.
    2. Check mapping status via `GET /v1/product/:product_id`.
    3. Render dropdowns for reference brand, garment, and known size.
    4. Call Worker `POST /v1/size`.
    5. Handle Standard Case (`is_boundary_case: false`): Render single recommended size badge & confidence indicator.
    6. Handle Boundary Case (`is_boundary_case: true`): Render **Two-Size Suggestion UI** showing both adjacent sizes (e.g. M & L) with fit preference guidance ("Snug fit" vs "Relaxed fit").
    7. Gracefully handle trial limit (429) or unmapped product states.
  - **Target Date**: Jul 26, 2026

- [ ] **TASK-R06: Shopify Dawn Theme Testing**
  - **Details**: Embed Theme App Extension on Shopify Dawn theme and verify responsiveness, accessibility, and position options.
  - **Target Date**: Jul 26, 2026

---

## 3. Analytics & Billing Dashboard Routes

- [x] **TASK-R07: Build Usage Analytics Dashboard with On-Demand Worker Sync**
  - **File**: `shopify-app/app/routes/app.analytics.tsx`
  - **Details**: In route `loader`, call Priyanshu's `GET /v1/admin/usage?shop=...` endpoint to trigger real-time Durable Object sync to Neon Postgres. Display total recommendations count, conversion rate metric cards, top requested reference brands table, boundary case percentage, and predicted size distribution chart. Add link to `app.tsx` navigation.
  - **Target Date**: Jul 27, 2026

- [ ] **TASK-R08: Build Billing Page**
  - **File**: `shopify-app/app/routes/app.billing.tsx`
  - **Details**: Fetch real-time usage via `GET /v1/admin/usage`, display current plan tier (`trial` vs `paid`), render progress bar showing trial requests used out of 1000, and handle upgrade flow using Shopify Billing API. Add link to `app.tsx` navigation.
  - **Target Date**: Jul 27, 2026

- [x] **TASK-R09: Widget Visual Customizer**
  - **File**: `shopify-app/app/routes/app.widget.tsx`
  - **Details**: Allow merchants to configure widget position, primary button background colors, text labels, and store settings in `widget_configs`.
  - **Target Date**: Jul 27, 2026

- [ ] **TASK-R12: Shopify Admin GraphQL Product Picker Integration**
  - **File**: `shopify-app/app/routes/app.products.tsx`
  - **Details**: Replace manual GID text input with Shopify Admin GraphQL API product selector using `read_products` scope. Fix `onboardingStep = 2` logic in `app._index.tsx`.
  - **Target Date**: Jul 27, 2026

---

## 4. Webhooks, Compliance & Final Polish

- [x] **TASK-R10: Shop Redact Webhook**
  - **File**: `shopify-app/app/routes/webhooks.shop.redact.tsx`
  - **Details**: Delete merchant records from Neon Postgres and purge `apikey:{key}` and `chart:{org_id}:*` keys from Cloudflare KV upon shop redaction.
  - **Target Date**: Jul 28, 2026

- [ ] **TASK-R11: Customer Redact & Data Request Webhooks**
  - **Files**: `shopify-app/app/routes/webhooks.customers.redact.tsx`, `shopify-app/app/routes/webhooks.customers.data_request.tsx`
  - **Details**: Handle GDPR compliance webhooks by returning HTTP 200 OK responses.
  - **Target Date**: Jul 28, 2026

- [ ] **TASK-R13: Complete Uninstall Webhook & App Configuration**
  - **Files**: `shopify-app/app/routes/webhooks.app.uninstalled.tsx`, `shopify-app/shopify.app.toml`, `shopify-app/app/routes/_index/route.tsx`
  - **Details**: Update uninstall webhook to set `widget_active = false` in Neon and update KV. Configure real URLs and register GDPR webhooks in `shopify.app.toml`. Update landing page copy with Snug product messaging.
  - **Target Date**: Jul 28, 2026
