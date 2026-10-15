# Snug launch changes

**Status: NOT READY.** This is the consolidated work list from the available
launch audits, verified against the current `main` source on 2026-10-16.
It records findings and proposed outcomes; none of the changes below are
implemented by this document.

The code review removed one earlier fallback-options finding: the Liquid
button starts hidden, and the widget applies valid reference coverage before
showing it (`shopify-app/extensions/snug-widget/blocks/snug_widget.liquid:15-23`,
`shopify-app/extensions/snug-widget/assets/snug-widget.js:265-285`).

## Review completion

- **Muse:** audit task completed successfully.
- **Gemini:** report was written, but its Orca task remains dispatched without
  a completion message. Its live terminal reports that the provider is out of
  credits.
- **Grok:** the coordinator session stopped with a 402 usage-limit error before
  producing the final cross-check.

Not all three reviews finished. The list below consolidates the available
Muse and Gemini reports and the current-source checks; it does not claim a
completed Grok review.

## Blockers — resolve before launch

- [ ] **Allow real Shopify storefront domains through Worker auth.** The auth
  middleware accepts the `.myshopify.com` host and a few development hosts,
  while real stores can serve the storefront from a custom domain. Validate
  the request origin against the key's shop and that shop's registered,
  verified storefront domains; do not trust the client-supplied shop header by
  itself.
  Evidence: `worker/src/middleware/auth.ts:4-20,41-44`;
  `shopify-app/extensions/snug-widget/assets/snug-widget.js:608-619`.

- [ ] **Create and populate `clean_size_db` in production.** Add a Drizzle
  migration for the schema-defined table and a repeatable production seed of
  verified reference curves. Brand setup queries this table, and reference
  coverage depends on its data.
  Evidence: `packages/db/src/schema.ts:246-284`;
  `shopify-app/drizzle/0000_heavy_eddie_brock.sql`;
  `shopify-app/drizzle/0001_subscription_fit_identity.sql`;
  `shopify-app/app/lib/brands.server.ts:101-118`;
  `shopify-app/app/lib/seed-kv.ts:21-27`.

- [ ] **Fix the production seed upsert key.** Make `scripts/seed.mjs` use the
  same four-column conflict target as the current unique index and the typed
  seed implementation (`brand, garment_type, fit_type, size_label`).
  Evidence: `scripts/seed.mjs:152`;
  `packages/db/src/seed/seed_db.ts:44`;
  `shopify-app/drizzle/0001_subscription_fit_identity.sql:35-37`.

- [ ] **Replace placeholder Shopify app URLs and correct the OAuth callback.**
  Set `application_url` and `redirect_urls` to the chosen production host and
  the app's actual `/auth/callback` route before deploying the Shopify config.
  Evidence: `shopify-app/shopify.app.toml:3,29,32`;
  `shopify-app/app/shopify.server.ts:21`;
  `shopify-app/app/routes/auth.$.tsx`.

- [ ] **Request only justified Shopify scopes.** Remove unused protected
  customer and order scopes, and review theme scopes against actual API use.
  Keep the app config and `SCOPES` environment value aligned; retain only
  scopes required by implemented features and properly justified to Shopify.
  Evidence: `shopify-app/shopify.app.toml:8`;
  `shopify-app/.env.example:4`;
  `shopify-app/app/shopify.server.ts:23`.

## Prelaunch — resolve before onboarding merchants

- [ ] **Make chart boundary detection work with the measurements the dashboard
  saves.** The dashboard currently saves `chest_min_cm == chest_max_cm`; the
  sizing boundary rule treats exact point matches as ambiguous. Either collect
  real ranges or adjust the boundary rule for point charts, with a regression
  case using the dashboard's saved shape.
  Evidence: `shopify-app/app/routes/app.size-charts.tsx:370-371`;
  `worker/src/algorithm/sizing.ts:194-213`.

- [ ] **Standardize chest measurement scale.** State clearly whether merchants
  enter full chest circumference or half-width, update the CSV examples to
  that scale, and reject implausible values before saving. The template's
  chest examples (50–56 cm) are on a different scale from the seeded reference
  chart chest values (roughly 80–124 cm), while the UI only says “cm.”
  Evidence: `shopify-app/app/routes/app.size-charts.tsx:510,632`;
  `packages/db/src/seed/reference_data.ts:34-60`;
  `worker/src/validation.ts:18-20`.

- [ ] **Keep men's, women's, and unisex guides separate end to end.** Include
  gender in chart identity, database uniqueness, KV keys, Worker lookup, and
  size-guide rendering; alternatively, restrict merchants to one gender per
  garment and fit with clear UI copy.
  Evidence: `packages/db/src/schema.ts:80-81`;
  `shopify-app/app/routes/app.size-charts.tsx:362-385`;
  `shopify-app/app/lib/kv.server.ts:73-88`;
  `worker/src/handlers/sizeGuide.ts:78`.

- [ ] **Make reference-brand setup truthful and effective.** Either publish
  each merchant's selected brand slugs and enforce them in reference options
  and sizing, or remove the per-merchant selection and label the catalog as
  platform-wide. Do not show fabricated active-brand counts.
  Evidence: `shopify-app/app/routes/app.brand.tsx:132-152`;
  `worker/src/types.ts:15-21`;
  `worker/src/handlers/referenceOptions.ts:12-24`;
  `shopify-app/app/routes/app.widget.tsx:98-101`;
  `shopify-app/app/routes/app._index.tsx:132-135`.

- [ ] **Protect quota from copied storefront keys.** Add a merchant-visible
  rotation flow that updates KV and shop metafields, apply abuse throttling
  before quota debit, and replace Origin-only trust with a verified Shopify
  App Proxy flow or a server-issued signed storefront token. The API key is
  public in storefront HTML, and Origin-less requests currently bypass the
  host check.
  Evidence: `shopify-app/extensions/snug-widget/blocks/snug_widget.liquid:11`;
  `shopify-app/app/lib/metafields.server.ts:47-69`;
  `worker/src/middleware/auth.ts:4-5`;
  `worker/src/middleware/cors.ts:3-9`;
  `worker/src/middleware/rateLimit.ts`.

- [ ] **Implement billing and quota rollover, or remove paid-plan promises.**
  Add a Shopify billing flow, accurate plan selection and usage display, and
  billing-period resets for the Durable Object. Until then, show honest trial
  terms and what happens when the lifetime trial allowance is exhausted.
  Evidence: `worker/src/durable-objects/UsageCounter.ts:99-151`;
  `worker/src/handlers/size.ts:80`;
  `packages/db/src/plans.ts`;
  `shopify-app/app/routes/app._index.tsx:290-300`.

- [ ] **Show measured analytics only.** Remove the synthetic impression
  multiplier and label or omit conversion metrics until a real conversion
  event and attribution writer exists.
  Evidence: `shopify-app/app/routes/app.analytics.tsx:201`;
  `worker/src/persistence.ts:18-26`.

- [ ] **Surface Cloudflare KV publish failures in merchant actions.** If a KV
  write fails, return an actionable failure or a persistent retryable
  “sync pending” state instead of reporting that the widget or product mapping
  was saved successfully.
  Evidence: `shopify-app/app/lib/kv.server.ts:21-25`;
  `shopify-app/app/routes/app.widget.tsx:235-244`;
  `shopify-app/app/routes/app.products.tsx:281-285`.

- [ ] **Make reference publishing complete and multi-merchant safe.** Replace
  the one-organization `LIMIT 1` publish behavior with publishing for all
  active organizations (or an explicit per-organization publish path). Add a
  preflight that confirms reference curves and `brands:coverage` exist before
  telling a merchant the widget is live.
  Evidence: `scripts/publish-config.mjs:80-118`;
  `shopify-app/app/lib/seed-kv.ts:15,21-27`;
  `shopify-app/extensions/snug-widget/assets/snug-widget.js:265-268`.

- [ ] **Make `relaxed` fit consistently supported or remove it.** Align schema
  checks and migrations, dashboard choices/defaults, and KV cleanup with the
  fit types accepted by the engine and publishing scripts.
  Evidence: `worker/src/algorithm/sizing.ts:17-22`;
  `worker/src/validation.ts:4`;
  `packages/db/src/schema.ts:88-91,116-119,212-215`;
  `shopify-app/app/routes/app.size-charts.tsx:37-47`;
  `shopify-app/app/lib/kv.server.ts:9-10`.

- [ ] **Normalize saved brand slugs before matching them to the catalog.**
  Normalize legacy underscore names such as `ralph_lauren` before testing
  membership against normalized catalog slugs, so opening and saving setup
  does not silently drop previously selected brands.
  Evidence: `shopify-app/app/routes/app.brand.tsx:66-72`;
  `shopify-app/app/lib/brands.server.ts:20-39`.

- [ ] **Allow merchants to edit existing size charts.** Upsert rows by the
  chart's unique key or replace rows transactionally so saving changed
  measurements does not fail on a uniqueness conflict.
  Evidence: `shopify-app/app/routes/app.size-charts.tsx:363-385`;
  `packages/db/src/schema.ts:80-81`.

## Later — schedule after launch blockers

- [ ] **Make uninstall and shop-redaction cleanup unconditional and complete.**
  Delete sessions by shop even when webhook authentication returns no session;
  clear merchant API-key and worker-URL metafields, all possible chart KV keys,
  and Durable Object state during erasure.
  Evidence: `shopify-app/app/routes/webhooks.app.uninstalled.tsx:17-19,34-43`;
  `shopify-app/app/routes/webhooks.shop.redact.tsx:31-48`;
  `shopify-app/app/lib/kv.server.ts:9-10,195-199`.

- [ ] **Align customer redaction with the data actually stored.** The current
  write path omits `visitor_id`, so the customer-redact query cannot match a
  stored visitor. Either store and delete the relevant identifier or make the
  handler explicitly reflect the no-customer-PII retention policy.
  Evidence: `shopify-app/app/routes/webhooks.customers.redact.tsx:31-47`;
  `worker/src/persistence.ts:18-26`.

- [ ] **Render the widget's configured confidence and dual recommendations.**
  Honor `show_confidence` and distinguish fitted/silhouette recommendations
  from adjacent-size boundary choices.
  Evidence: `shopify-app/extensions/snug-widget/assets/snug-widget.js:271-273,665-726`;
  `worker/src/algorithm/types.ts:73-99`.

- [ ] **Paginate the Shopify product catalog.** Replace the first-100-only
  query with cursor pagination and show merchants when additional products
  remain unmapped.
  Evidence: `shopify-app/app/routes/app.products.tsx:150-170`.

- [ ] **Heal missing API-key KV records during reauthentication.** Reconcile
  the `apikey:*` record for existing organizations after auth, or provide a
  merchant-triggered resync action.
  Evidence: `shopify-app/app/shopify.server.ts:49-91`;
  `shopify-app/app/lib/kv.server.ts`.

