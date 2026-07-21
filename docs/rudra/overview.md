# Workstream 2: Rudra — Merchant Dashboard, Storefront Widget & Shopify Integrations

---

## 1. Scope & Ownership

Rudra owns everything the merchant sees in the Shopify Admin dashboard, everything the shopper sees on the storefront widget, and all Shopify OAuth/webhook integrations.

### Core Components Owned:
* **Storefront Widget Extension (`shopify-app/extensions/snug-widget/`)**: Theme App Extension liquid blocks, Vanilla JS widget bundle (< 10KB), sizing recommendation modal UI, two-size boundary case selector UI, and Dawn theme integration.
* **Merchant Dashboard UI (`shopify-app/app/routes/`)**: Size chart management, product tagging, analytics charts, widget visual customizer, and billing setup.
* **Shopify OAuth & Webhooks (`shopify-app/app/`)**: Install flow triggers, session storage, and mandatory GDPR webhooks (`shop/redact`, `customers/redact`, `customers/data_request`).
* **KV Cache Sync Helper (`shopify-app/app/lib/kv.server.ts`)**: Dashboard utility to update Cloudflare KV whenever merchants update size charts or shop settings.

---

## 2. Shared Contracts & Interdependencies with Priyanshu

### A. Dashboard KV Writes (Rudra Writes / Priyanshu Reads)
* **`chart:{org_id}:{garment_type}`**:
  * *Rudra's dashboard writes to KV when a merchant saves or updates fit size charts in `app.size-charts.tsx`.*
* **`apikey:{api_key}`**:
  * *Rudra's OAuth install callback creates the organization row, generates `api_key`, and initializes this KV key.*

### B. Storefront API Consumption & Response Handling
* Rudra's Storefront Widget reads `api_key` from liquid block context.
* Widget sends `POST` request to Priyanshu's Worker `POST /v1/size` with header `X-Snug-Key: <api_key>`.
* Widget parses JSON prediction response and handles:
  1. **Standard Match (`is_boundary_case: false`)**:
     - Displays single recommended size badge (e.g., "Your recommended size is **M**").
     - Displays confidence label badge (`high`, `medium`, `low`).
  2. **Boundary Case Match (`is_boundary_case: true`)**:
     - **Definition**: Occurs when a shopper's calculated measurements fall right on the threshold between two adjacent sizes (e.g. between **M** and **L**).
     - **UI Behavior**: Displays a **Two-Size Suggestion UI** showing both options (e.g. **M** and **L**) with fit guidance copy:
       > *"You sit between sizes! Choose **M** for a snug fit or **L** for a relaxed fit."*
     - Allows shopper to toggle between snug vs. relaxed fit preference.
  3. **Error & Quota Handling**:
     - Gracefully handles HTTP 429 (monthly trial cap reached) or missing brand/unmapped product states.

---

## 3. High-Level Delivery Milestones

1. **Milestone R1**: Complete automatic organization creation and `apikey:{key}` initialization in KV on Shopify OAuth install.
2. **Milestone R2**: Wire synchronous KV cache updates whenever merchants save size charts in `app.size-charts.tsx`.
3. **Milestone R3**: Build Theme App Extension storefront widget (Vanilla JS bundle) with boundary case two-size recommendation UI and test on Dawn theme.
4. **Milestone R4**: Build Analytics (`app.analytics.tsx`), Billing (`app.billing.tsx`), Widget Customizer (`app.widget.tsx`), and GDPR webhooks.
