# Worker fixes — first principles and operating model

**Updated:** 2026-08-02  
**Scope:** `worker/` and the Shopify-side integration that writes Worker configuration to KV.

This document explains the fixes recorded in [issues.md](issues.md): what changed, why it is correct at a systems level, and what is intentionally still open. The current design uses **Durable Objects (DOs)** for quota coordination, **KV** to distribute read-mostly configuration, and **Neon Postgres** for reporting. Redis is deliberately not in the runtime path.

## The model in one sentence

A recommendation is valid only after its input and chart data have been checked; a valid trial recommendation spends exactly one credit in the organization’s DO; the result is then reported to Neon without holding up the customer response.

That order matters. Validation answers “can we make a recommendation?”; the DO answers “may this organization spend a credit?”; reporting answers “what happened?” Each concern has a different consistency and latency requirement.

## W-01: the internal endpoint now fails closed

### What changed

- Removed the `dev-admin-secret` fallback from both the Worker and the Shopify analytics loader.
- Declared `INTERNAL_ADMIN_SECRET` as a required Worker secret.
- The admin endpoint returns `503` when the secret is absent and `401` for a missing or incorrect supplied secret.
- The comparison hashes both values and uses `crypto.subtle.timingSafeEqual`.

### First principle

Authentication must deny access when its verifier is unavailable. A conditional such as “only compare when a secret exists” converts a deployment mistake into public access. That is the opposite of fail-closed security.

String comparisons can stop at their first different character. Their running time may therefore reveal partial information about a secret. Hashing makes both inputs a fixed length, then timing-safe equality removes that early-exit signal. This is defense in depth; the primary protection is keeping the secret out of source control and configuring it in every environment.

### Operating requirement

Before deploy, set the same non-development value in the Worker and the Shopify application:

```sh
wrangler secret put INTERNAL_ADMIN_SECRET
```

The command intentionally prompts for the value rather than placing it in shell history or source files.

## W-02 and W-04: quota is a single atomic state transition

### What changed

- Replaced `SqlStorageCursor.one()` for optional queries with `toArray()[0]`.
- First use performs `INSERT ... ON CONFLICT DO NOTHING`, passing the organization’s configured trial allowance from KV.
- The subsequent conditional `UPDATE ... RETURNING` decrements only an existing trial balance that is positive.
- The sizing handler debits the quota only after request parsing, mapping/chart validation, and deterministic prediction succeed.
- A read-only admin lookup no longer creates a default 1,000-credit counter.

### First principle

The quota is a balance. Spending one credit must be one indivisible transition:

```text
remaining > 0  →  remaining - 1
```

If the read, check, and write are separate requests, concurrent requests can both observe the same credit and both spend it. A per-organization DO is the coordination point: one organization maps deterministically to one instance, and SQLite executes the conditional update there. The `RETURNING` row is the proof that this request was allowed.

KV is fast distribution, not the counter. It only seeds the DO on the first insert. `ON CONFLICT DO NOTHING` makes later stale KV reads harmless: they cannot overwrite a live DO balance. After initialization, the DO is the authority.

Charging before validation is wrong for the same reason a payment processor does not charge before it knows an order is valid. Invalid JSON, an unmapped product, or a malformed chart produces no recommendation and now consumes no credit.

### Resulting request path

```text
browser request
  → validate request and KV data
  → calculate prediction
  → atomically debit organization DO (trial only)
  → return prediction
  → write analytics/checkpoint in waitUntil
```

Paid plans remain unconstrained by the current product policy; defining a paid-plan rate or usage limit is separate product work.

## W-03: reporting writes are real; reconciliation needs a registry

### What changed

- Prediction events now insert into `usage_logs` through Neon’s parameterized HTTP driver.
- At quota milestones and an authenticated admin lookup, the Worker updates the organization’s remaining trial balance through `USAGE_SYNC_DATABASE_URL`.
- Writes run with `ctx.executionCtx.waitUntil`, so customers are not blocked on reporting latency.
- Failures are emitted as JSON log events (`usage_log_failed` and `usage_sync_failed`) rather than silently printed as pretend success.

### First principle

The response path must make the customer-facing decision durable before responding. It does not need to wait for analytics: a delayed chart on a dashboard is preferable to a slow or failed size recommendation. `waitUntil` preserves the background task beyond the response while keeping it outside the decision path.

The reporting connection is intentionally split from the event-log connection. `DATABASE_URL` only needs permission to insert usage events. `USAGE_SYNC_DATABASE_URL` needs the narrowly additional permission to update a quota checkpoint. They should be different database roles, not one broad owner credential.

### Why a cron was not added yet

A scheduled Worker cannot list every production DO instance. IDs are derived from organization IDs, and Cloudflare does not expose a production “enumerate all objects” API to Worker code. A cron that has no authoritative organization list cannot reconcile anything reliably.

The correct next design is:

```text
organizations registry in Neon
  → scheduled Worker pages active organization IDs
  → each ID routes to its deterministic UsageCounter DO
  → Worker updates Neon checkpoint and performs billing rollover
```

This needs a scoped registry-query credential, paging, retries, idempotent rollover keys, and alerting. It is documented as remaining work rather than represented by an empty cron handler.

## W-06 and W-07: predictions use the chart actually supplied

### What changed

- `fit_type` is now required in every validated merchant chart row.
- A merchant chart must have one uniform fit type, which is passed to the cross-fit confidence calculation.
- The Shopify KV writer sorts rows by normalized body-chest midpoint.
- The Worker sorts again before selecting neighbouring sizes, so old or independently-written KV data is still safe.
- A boundary flag is set only if a real adjacent recommendation exists.

### First principle

Array position is not a business rule. Database query order is undefined unless explicitly ordered, so “previous row” and “next row” have no sizing meaning until the code derives an ordering. Here the relevant ordering is body space:

```text
body midpoint = (chest minimum + chest maximum) / 2 − ease
```

The nearest row in that ordered space is the best match. A boundary is only meaningful if there is another size beside it; an outermost size has no lower or higher alternative, so it should not create false uncertainty.

## W-08: types are not validation

### What changed

- Added runtime parsers for prediction bodies, KV merchant records, product mappings, reference charts, and merchant charts.
- Enforced non-empty bounded strings, valid plans/fit types/ease sources, finite numeric measurements, and valid min/max ranges.
- Invalid client data returns `400`; corrupt or incompatible distributed configuration returns `422`.
- A global Hono error handler produces a controlled `500` and structured diagnostic log for unexpected failures.

### First principle

TypeScript disappears at deployment. KV values, JSON bodies, and external writers are untyped at runtime. Casting an unknown value tells the compiler to trust it; it does not make `trim()` exist or turn `"NaN"` into a measurement. The boundary where data enters the trusted system is where it must be checked.

Separating `400` from `422` also assigns responsibility accurately: the caller can fix an invalid request, while an operator must repair a malformed published configuration.

## W-09 and W-10: the Worker is configured and tested as a Worker

### What changed

- Updated the compatibility date and made the unqualified deployment production rather than development.
- Added required-secret declarations and Workers observability sampling.
- Generated `worker/worker-configuration.d.ts` using `wrangler types`, replacing the hand-written binding interface.
- Added `@cloudflare/vitest-pool-workers` and runtime tests for the DO state machine and fail-closed admin configuration, alongside pure algorithm and validation tests.

### First principle

Configuration is executable policy. If code assumes a secret or binding exists but the deployment system does not verify it, an otherwise valid build can become an insecure runtime. Generated types couple code to the actual Wrangler configuration, so a renamed binding fails during validation instead of as a production request.

The important behavior here is platform behavior: DO SQLite cursors, bindings, and request execution. Unit tests alone cannot prove those integration points. The Workers Vitest pool runs them in a local Workers runtime with isolated storage.

### Remaining environment work

Staging must not point at production KV or DO state. Add a named staging environment only after a distinct KV namespace and the corresponding DO migration are provisioned. Then configure the required secrets in every environment and commit regenerated binding types.

## W-05: the remaining security boundary

The browser currently receives a long-lived API key, and a non-browser attacker can forge `Origin`. The current origin check remains useful for browser and CORS behavior, but it is not authentication.

The next implementation needs one product decision:

- **Signed short-lived storefront token:** Shopify app issues a token bound to a shop, expiry, and optionally product/visitor; Worker verifies it. This keeps direct Worker calls but adds token issuance and rotation.
- **Shopify-verified proxy:** storefront calls the app proxy; the app verifies Shopify context and calls the Worker with a service credential. This removes the long-lived key from the browser but adds an application hop.

Either option must have expiration, key rotation, replay/rate-abuse handling, and tests. Redis does not solve this authentication problem and remains deferred until measured scale requires a separate burst-control layer.

## Verification performed

From `worker/`:

```text
pnpm --filter worker exec tsc --noEmit
pnpm --filter worker test
wrangler deploy --dry-run
```

The suite passes 13 tests, including Workers-runtime DO tests. Local test output warns that the two production-only sync/admin secrets are absent from `.dev.vars`; that is expected for the fail-closed configuration test. Supply non-production values before manually exercising the local admin or Neon sync paths.
