# Snug Shopify App — Product Requirements Document

---

## Overview

This document covers everything that needs to be built on the Shopify app side of Snug. The Cloudflare Worker sizing API is a separate system and is not covered here. This document is scoped strictly to the embedded Shopify app — the merchant-facing dashboard, the storefront widget, and the webhook handlers.

The app is a Shopify embedded app built with the React Router template, Polaris, Drizzle ORM, and Neon Postgres. It is hosted on Railway. The current state of the codebase has the following already built and working:

- OAuth install flow via the Shopify React Router template
- Session storage in Neon via Drizzle
- Home screen with setup state awareness
- Brand setup page with database write
- Uninstall webhook handler
- Organizations table in Neon

Everything below is what remains to be built.

---

## Database schema — additions required

The current schema has two tables: `sessions` and `organizations`. The following additions are needed before any new routes are built.

### Table: usage_events

Stores a log of every sizing recommendation served to a shopper on this merchant's storefront. Written by the Cloudflare Worker via the sizing API, read by the dashboard for analytics.

```typescript
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  refBrand: text('ref_brand').notNull(),
  refGarment: text('ref_garment').notNull(),
  refSize: text('ref_size').notNull(),
  targetBrand: text('target_brand').notNull(),
  predictedSize: text('predicted_size').notNull(),
  confidence: integer('confidence').notNull(),
  confidenceLabel: text('confidence_label').notNull(),
  isBoundaryCase: boolean('is_boundary_case').notNull(),
  responseMs: integer('response_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Table: brand_requests

When a merchant's brand is not in the Snug database, they submit a request. This table captures those requests so the team can action them.

```typescript
export const brandRequests = pgTable('brand_requests', {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  brandName: text('brand_name').notNull(),
  brandWebsite: text('brand_website'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Modification: organizations table

Add one column to the existing organizations table:

```typescript
planTier: text('plan_tier').default('free').notNull(),
```

This is needed for the billing section of the dashboard.

---

## Routes to build

### Already built
- `app._index.tsx` — home screen with setup state
- `app.brand.tsx` — brand setup
- `webhooks.app.uninstalled.tsx` — uninstall handler

### To build

| Route file | URL | Purpose |
|---|---|---|
| `app.analytics.tsx` | `/app/analytics` | Usage analytics for the merchant |
| `app.widget.tsx` | `/app/widget` | Widget configuration and preview |
| `app.billing.tsx` | `/app/billing` | Plan display and upgrade |
| `webhooks.shop.redact.tsx` | `/webhooks/shop/redact` | GDPR data deletion, mandatory for App Store |
| `webhooks.customers.redact.tsx` | `/webhooks/customers/redact` | GDPR customer data deletion, mandatory |
| `webhooks.customers.data_request.tsx` | `/webhooks/customers/data_request` | GDPR data request, mandatory |

---

## Route specifications

---

### app.analytics.tsx

**Purpose:** Shows the merchant how many sizing recommendations have been served, confidence distribution, and which sizes are most commonly predicted on their storefront.

**Loader:** Queries `usage_events` filtered by `shop`. Aggregates:
- Total recommendations this month
- Total recommendations all time
- Breakdown by confidence label (high / medium / low) as counts and percentages
- Top 5 most common `ref_brand` values — which brands shoppers are referencing most
- Top 5 most common `predictedSize` values
- Daily recommendation volume for the last 30 days for the chart

**UI sections:**

Section 1 — Summary stats row. Four stat cards side by side:
- Recommendations this month
- Recommendations all time
- High confidence rate (percentage of total that are high confidence)
- Boundary case rate (percentage that triggered a two-size suggestion)

Section 2 — Volume chart. A simple bar chart showing daily recommendation counts for the last 30 days. Use Polaris's `DataTable` if a proper chart library is not available, showing date and count columns. If volume is zero across all days, show an empty state card with the message "Recommendations will appear here once shoppers start using the widget."

Section 3 — Reference brand breakdown. A `DataTable` with columns: Brand, Recommendation count, Percentage of total. Shows which brands your shoppers are most commonly referencing when looking up sizes on your store.

Section 4 — Predicted size distribution. A `DataTable` with columns: Predicted size, Count, Percentage. Shows the spread of sizes being recommended.

**Empty state:** If the merchant has no usage events at all, show a single full-width card with an illustration placeholder, a heading "No recommendations yet", and the text "Once your widget is active and shoppers start using it, your analytics will appear here."

**No action function needed** — this is a read-only page.

---

### app.widget.tsx

**Purpose:** Lets the merchant configure widget behaviour and see its current activation status. Also provides the deep link to the Shopify theme editor.

**Loader:** Queries `organizations` for this shop, returns `isWidgetActive`, `brandName`, `brandId`. Also checks whether the brand is configured — if not, the widget configuration options are locked.

**Action:** Handles one form submission — toggling widget active state. Updates `organizations.isWidgetActive` for this shop.

**UI sections:**

Section 1 — Widget status card. Shows current status as a large badge (Active in green / Inactive in grey). If inactive and brand is configured, shows the theme editor deep link button:

```
https://{shop}/admin/themes/current/editor?context=apps
```

If brand is not configured, shows a disabled button with helper text "Configure your brand first before activating the widget."

Section 2 — Widget behaviour. A card with the following settings, each as a toggle or select. These are stored as additional columns on the `organizations` table (add them to schema):

| Setting | Type | Default | Description |
|---|---|---|---|
| `widgetPosition` | select | `below_size_selector` | Where the widget appears on the product page — below size selector or below add to cart |
| `showConfidenceScore` | boolean | `true` | Whether to show the confidence percentage to shoppers |
| `showReasoningLink` | boolean | `false` | Whether to show a "How did we calculate this?" link |

Section 3 — Preview. A static mockup card showing what the widget looks like on a product page. This is a non-interactive visual built with basic HTML and inline styles inside a Polaris Card. It does not need to be a live preview — just an accurate representation of what the shopper sees.

---

### app.billing.tsx

**Purpose:** Shows the merchant their current plan and usage. Allows upgrade. At v0 there are two plans.

**Plan definitions:**

| Plan | Price | Monthly recommendation limit | Support |
|---|---|---|---|
| Free | ₹0 | 500 | Email |
| Growth | ₹999/month | 10,000 | Priority email |

**Loader:** Queries `organizations` for `planTier`. Queries `usage_events` for recommendation count this month.

**Action:** Handles plan upgrade. Uses Shopify's billing API via `authenticate.admin` to create a recurring charge. The Shopify billing API handles the payment — you do not need Stripe or Razorpay. Shopify takes a revenue share and handles INR billing natively.

**Billing API flow for upgrade:**

```typescript
const { billing } = await authenticate.admin(request);

await billing.request({
  plan: "Growth",
  isTest: true, // set false in production
  returnUrl: `https://${shop}/admin/apps/snug/billing`,
});
```

This redirects the merchant to a Shopify-hosted payment confirmation page. On approval Shopify redirects back to your `returnUrl`.

**UI sections:**

Section 1 — Current plan card. Shows plan name, price, and a progress bar of recommendations used this month vs limit. Example: "342 of 500 recommendations used."

Section 2 — Plan comparison table. Side by side or a `DataTable` showing both plans with features and prices. The current plan is highlighted. If on Free, the Growth plan card has an "Upgrade to Growth" button that fires the billing action. If already on Growth, show "Current plan" with a contact link for enterprise.

Section 3 — Billing history. At v0 this can be a placeholder card with "Billing history will appear here" — Shopify manages the actual invoices.

---

### webhooks.shop.redact.tsx

**Purpose:** GDPR compliance. Shopify calls this when a merchant uninstalls and requests their shop data be deleted. Mandatory for App Store approval.

**What it does:** Deletes all rows from `usage_events` and `brand_requests` where `shop` matches. Deletes the row from `organizations`. Does not delete `sessions` — that is handled by the uninstall webhook already.

**Handler shape:**

```typescript
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await db.delete(usageEvents).where(eq(usageEvents.shop, shop));
  await db.delete(brandRequests).where(eq(brandRequests.shop, shop));
  await db.delete(organizations).where(eq(organizations.shop, shop));

  return new Response();
};
```

Register this in `shopify.app.toml` — it is already in the toml from the earlier setup.

---

### webhooks.customers.redact.tsx and webhooks.customers.data_request.tsx

**Purpose:** GDPR compliance. Shopify requires these endpoints to exist and return 200 for App Store approval. At v0 Snug does not store any customer-level data — only shop-level aggregates. So both handlers simply acknowledge the request and return 200.

**Handler shape for both:**

```typescript
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Snug does not store customer-level data.
  // No deletion or export required.
  return new Response();
};
```

Register both in `shopify.app.toml`:

```toml
[[webhooks.subscriptions]]
uri = "/webhooks/customers/redact"
topics = [ "customers/redact" ]

[[webhooks.subscriptions]]
uri = "/webhooks/customers/data_request"
topics = [ "customers/data_request" ]
```

---

## Navigation update

Once all routes are built, update the nav in `app.tsx` to include all sections:

```tsx
<s-app-nav>
  <s-link href="/app">Home</s-link>
  <s-link href="/app/brand">Brand Setup</s-link>
  <s-link href="/app/widget">Widget</s-link>
  <s-link href="/app/analytics">Analytics</s-link>
  <s-link href="/app/billing">Billing</s-link>
</s-app-nav>
```

---

## Brand setup page — improvements needed

The current `app.brand.tsx` has a placeholder `brandId` value hardcoded as `"placeholder"`. This needs to be connected to the actual Snug brand database.

The correct flow is:

1. Merchant types a brand name
2. The page queries the Cloudflare Worker or directly queries the `brands:supported` KV key to validate the brand exists in the Snug database
3. If found, the `brandId` is the slugified brand name from the database
4. If not found, show an inline error and surface the brand request form directly on this page instead of a mailto link

The brand request form on the same page should:
- Accept brand name and website URL
- Submit via a second form action
- Write to the `brand_requests` table
- Show a confirmation that the request was received

This makes the brand request flow self-contained rather than depending on an external email link.

---

## Onboarding state machine

The home screen loader needs to be aware of three possible states and render accordingly. The state is determined by querying `organizations` on every home screen load.

| State | Condition | Home screen shows |
|---|---|---|
| `not_started` | No org row exists for this shop | Warning banner, Step 1 primary, Step 2 disabled |
| `brand_configured` | Org row exists, `brandName` is set, `isWidgetActive` is false | Info banner, Step 1 done badge, Step 2 primary |
| `fully_active` | Org row exists, `brandName` is set, `isWidgetActive` is true | Success banner, both steps done |

The current implementation handles this correctly. No changes needed here beyond ensuring the `isWidgetActive` flag gets set to true when the merchant activates the widget via the theme editor. Since we cannot detect theme editor actions directly, the widget page should include a manual "Mark as active" button that sets this flag, in addition to the theme editor deep link.

---

## Error handling requirements

Every route loader and action must handle database errors gracefully. If a Neon query fails, the page should show a Polaris `Banner` with `tone="critical"` and the message "Something went wrong loading your data. Please refresh the page." Do not expose raw error messages to the merchant.

Every webhook handler must return `new Response()` with status 200 even if the database operation fails. Shopify will retry webhooks that receive non-200 responses, which can cause duplicate processing. Log the error to console but always return 200.

---

## What is not in scope for the app

The Cloudflare Worker sizing API is entirely separate. The scraper pipeline is entirely separate. The storefront widget JS bundle is a Theme App Extension and is built separately from the dashboard routes — it is covered in a separate spec. App Store submission, review guidelines compliance beyond GDPR webhooks, and billing plan enforcement at the API level are post-v0 concerns.