# Rudra — Actionable Task Breakdown

---

## 1. OAuth Install & KV Synchronization

- [ ] **TASK-R01: Automatic Org & API Key Creation on Install**
  - **File**: `shopify-app/app/shopify.server.ts`
  - **Details**: Add `afterAuth` callback to `shopifyApp` config to automatically insert an `organizations` row, generate a unique `api_key`, initialize `apikey:{key}` in Cloudflare KV, and set default trial quota.

- [ ] **TASK-R02: Dashboard KV Sync Utility**
  - **File**: `shopify-app/app/lib/kv.server.ts`
  - **Details**: Implement helper function `pushChartToKV(orgId, garmentType)` to sync fit size charts from Neon Postgres into Cloudflare KV key `chart:{org_id}:{garment_type}` whenever size charts are created/updated.

- [ ] **TASK-R03: Wire KV Sync in Size Chart Management Route**
  - **File**: `shopify-app/app/routes/app.size-charts.tsx`
  - **Details**: Trigger `pushChartToKV()` in the action handler after successful database mutation.

---

## 2. Storefront Widget (Theme App Extension)

- [ ] **TASK-R04: Scaffold Theme App Extension**
  - **Directory**: `shopify-app/extensions/snug-widget/`
  - **Details**: Run Shopify CLI `shopify app generate extension` (theme app extension). Create app block liquid file `blocks/snug_widget.liquid`.

- [ ] **TASK-R05: Storefront Widget Vanilla JS Bundle (< 10KB)**
  - **Directory**: `shopify-app/extensions/snug-widget/assets/`
  - **Details**: Write pure Vanilla JS modal/widget script:
    1. Read API key and product ID from page liquid context.
    2. Check mapping status via `GET /v1/product/:product_id`.
    3. Render dropdowns for reference brand, garment, and known size.
    4. Call Worker `POST /v1/size`.
    5. Handle Standard Case (`is_boundary_case: false`): Render single recommended size badge & confidence indicator.
    6. Handle Boundary Case (`is_boundary_case: true`): Render **Two-Size Suggestion UI** showing both adjacent sizes (e.g. M & L) with fit preference guidance ("Snug fit" vs "Relaxed fit").
    7. Gracefully handle trial limit (429) or unmapped product states.

- [ ] **TASK-R06: Shopify Dawn Theme Testing**
  - **Details**: Embed Theme App Extension on Shopify Dawn theme and verify responsiveness, accessibility, and position options.

---

## 3. Analytics & Billing Dashboard Routes

- [ ] **TASK-R07: Build Usage Analytics Dashboard with On-Demand Worker Sync**
  - **File**: `shopify-app/app/routes/app.analytics.tsx`
  - **Details**: In route `loader`, call Priyanshu's `GET /v1/admin/usage?shop=...` endpoint to trigger real-time Durable Object sync to Neon Postgres. Display total recommendations count, conversion rate metric cards, top requested reference brands table, boundary case percentage, and predicted size distribution chart.

- [ ] **TASK-R08: Build Billing Page**
  - **File**: `shopify-app/app/routes/app.billing.tsx`
  - **Details**: Fetch real-time usage via `GET /v1/admin/usage`, display current plan tier (`trial` vs `paid`), render progress bar showing trial requests used out of 1000, and handle upgrade flow using Shopify Billing API.

- [ ] **TASK-R09: Widget Visual Customizer**
  - **File**: `shopify-app/app/routes/app.widget.tsx`
  - **Details**: Allow merchants to configure widget position, primary button background colors, text labels, and store settings in `widget_configs`.

---

## 4. Mandatory GDPR Webhooks

- [ ] **TASK-R10: Shop Redact Webhook**
  - **File**: `shopify-app/app/routes/webhooks.shop.redact.tsx`
  - **Details**: Delete merchant records from Neon Postgres and purge `apikey:{key}` and `chart:{org_id}:*` keys from Cloudflare KV upon shop redaction.

- [ ] **TASK-R11: Customer Redact & Data Request Webhooks**
  - **Files**: `shopify-app/app/routes/webhooks.customers.redact.tsx`, `shopify-app/app/routes/webhooks.customers.data_request.tsx`
  - **Details**: Handle GDPR compliance webhooks by returning HTTP 200 OK responses.
