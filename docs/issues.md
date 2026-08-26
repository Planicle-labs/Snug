# Snug — Active Issues

**Last audited:** 2026-08-02  
**Scope:** Cloudflare Worker (`worker/`) and its documented integration contracts.

This is the canonical engineering issue list. `TECHNICAL_DEBT.md` retains earlier cross-repository findings; this document supersedes its Worker-status claims where they differ.

## Current decisions

- **Durable Objects are the current quota-enforcement authority.** One `UsageCounter` instance is routed by `org_id` and owns atomic trial-quota state.
- **Neon Postgres is the durable reporting and configuration store.** It must receive real usage events and checkpoint/admin syncs; those writes are not implemented yet.
- **Cloudflare KV is a read cache and authentication/config distribution store.** It is not a quota counter.
- **Redis is deferred.** Re-evaluate it only when measured traffic or multi-region throughput makes a per-organization Durable Object a bottleneck. It is not part of the current runtime or deployment requirements.

## Implementation status (2026-08-02)

| Issue | Status | Result |
| --- | --- | --- |
| W-01 | Fixed | Admin access now requires a configured secret and fails closed. |
| W-02 | Fixed | First use and quota exhaustion use optional SQL rows safely. |
| W-03 | Partially fixed | Usage events and checkpoints now persist to Neon; reconciliation remains. |
| W-04 | Fixed | The DO receives the initial allowance once and debits after prediction validation. |
| W-05 | Open | Requires a storefront credential or Shopify proxy design decision. |
| W-06 | Fixed | Target-chart fit type flows into the sizing algorithm. |
| W-07 | Fixed | Charts are ordered by normalized body measurement before boundary selection. |
| W-08 | Fixed | Request and KV payloads receive runtime validation and controlled errors. |
| W-09 | Partially fixed | Required secrets, generated bindings, current compatibility date, and logs are configured; isolated staging resources still need provisioned IDs. |
| W-10 | Partially fixed | Cloudflare Vitest runtime coverage now guards the critical regression paths. |

The implemented fixes and their first-principles rationale are in [fix.md](fix.md).

## Deployment blockers

### W-01 — Admin usage endpoint can be called without a protected secret — Fixed

- **Severity:** Critical
- **Evidence:** `worker/wrangler.toml` sets `ENVIRONMENT = "development"`; `worker/src/handlers/adminUsage.ts` accepts the hard-coded `dev-admin-secret`. If production mode is used without `INTERNAL_ADMIN_SECRET`, the current conditional accepts every request.
- **Impact:** An attacker can query usage for arbitrary shops or organization IDs and trigger the intended internal sync path.
- **Implemented:** Removed both development fallbacks (Worker and dashboard), declared `INTERNAL_ADMIN_SECRET` as required, fail-closed with `503` when it is absent, and compare SHA-256 digests with Workers' timing-safe equality API. Worker-runtime coverage verifies the absent-secret path.

### W-02 — New trial organizations cannot initialize their Durable Object counter — Fixed

- **Severity:** Critical
- **Evidence:** `UsageCounter` calls `SqlStorageCursor.one()` after `UPDATE ... RETURNING` and after a zero-row `SELECT`. Cloudflare throws when `one()` receives zero rows, so the subsequent create-if-missing branches are unreachable.
- **Impact:** The first `POST /v1/size` for a new trial organization returns 500; an exhausted organization also returns 500 instead of 429. New `GET /v1/admin/usage` calls fail for the same reason.
- **Implemented:** Optional rows use `toArray()[0]`; `INSERT ... ON CONFLICT DO NOTHING` seeds the counter exactly once before its conditional decrement. Runtime tests cover first use, normal decrement, exhaustion, and a read-only admin lookup.

### W-03 — Usage persistence and analytics are no-ops — Partially fixed

- **Severity:** High
- **Evidence:** `syncMilestoneToPostgres`, `logUsageEvent`, and `syncUsageToPostgres` only call `console`; none uses `DATABASE_URL`. There is no Worker scheduled handler or configured cron.
- **Impact:** Neon usage logs and remaining quota never update. Dashboard analytics and billing data are incomplete or stale.
- **Implemented:** `logUsageEvent` inserts parameterized usage rows with Neon’s HTTP driver. Milestone and admin syncs update `organizations` through a dedicated `USAGE_SYNC_DATABASE_URL`; all background failures are structured logs and run via `waitUntil`.
- **Still required:** A scheduled reconciliation must be built around a durable organization registry. A Worker cannot discover all production DO IDs on its own, so adding a cron without that registry would only create a non-working job. See [fix.md](fix.md#w-03-durable-reporting-is-now-real-reconciliation-is-a-separate-system) for the required design.

### W-04 — Quota initialization and charge timing are incorrect — Fixed

- **Severity:** High
- **Evidence:** The authenticated KV record includes `trial_requests_remaining`, but an unknown `UsageCounter` always starts at 1,000. The rate-limit middleware decrements before body, mapping, and chart validation.
- **Impact:** Existing quota can be reset and malformed, unsupported, or misconfigured requests consume trial credit.
- **Implemented:** KV supplies the initial allowance only to the first successful DO insert. Thereafter the DO is authoritative. Validation and prediction happen before the debit, so malformed and unsupported inputs do not consume a trial request.

### W-05 — Storefront credentials and Origin are insufficient abuse protection — Open, design decision required

- **Severity:** High
- **Evidence:** The API key is shipped to browser-side widget code and authentication trusts a client-supplied `Origin` header.
- **Impact:** A copied key plus a forged Origin from a non-browser client can drain quota or generate unwanted traffic.
- **Required fix:** Do not treat Origin as authentication. Introduce short-lived signed storefront credentials or a Shopify-verified proxy flow, then retain Origin/CORS checks as browser controls.

## Correctness and resilience

### W-06 — Sizing handler ignores the merchant chart's fit type — Fixed

- **Severity:** Medium
- **Evidence:** `handleSizePrediction` passes `targetFitType: 'regular'` even though KV chart data contains `fit_type`.
- **Impact:** Cross-fit confidence penalties are wrong for slim and oversized target charts.
- **Implemented:** Validated merchant rows include `fit_type`, charts must have one uniform target fit, and that value is passed to `predictSize`.

### W-07 — Boundary recommendations depend on unsorted chart arrays — Fixed

- **Severity:** Medium
- **Evidence:** `predictSize` uses `bestIndex - 1` and `bestIndex + 1` as adjacent sizes. The dashboard KV writer does not explicitly order chart rows.
- **Impact:** A boundary recommendation can choose a non-adjacent size or mark an outer boundary without an alternate recommendation.
- **Implemented:** The KV writer publishes charts in normalized body-measurement order and the Worker sorts defensively before finding neighbours. An outermost size is only called a boundary when a real adjacent alternative exists.

### W-08 — Request and KV payloads lack runtime validation — Fixed

- **Severity:** Medium
- **Evidence:** Request and KV JSON are cast to TypeScript types. A truthy non-string request field throws at `.trim()`, and malformed chart rows can propagate `NaN` into a prediction.
- **Impact:** Invalid input becomes a 500 response or an unreliable recommendation.
- **Implemented:** Type guards validate request fields, authentication records, mappings, reference charts, and merchant charts before use. Malformed client inputs return `400`; malformed distributed configuration returns `422`; unexpected failures use a structured global error handler.

### W-09 — Production configuration does not guard secrets, bindings, or observability — Partially fixed

- **Severity:** Medium
- **Evidence:** The Worker has one root environment marked development, a hand-written `Env`, no required-secret declaration, a stale compatibility date, and no Workers Logs configuration.
- **Impact:** Production can be deployed with unsafe development values and missing secrets; diagnosing failures is unnecessarily difficult.
- **Implemented:** The default deploy is production rather than development; required secrets, observability sampling, and a current compatibility date are declared. `worker-configuration.d.ts` is generated by Wrangler and replaces the hand-written binding interface.
- **Still required:** Provision a separate staging KV namespace and DO migration, then add a named staging environment with those real identifiers. Reusing production IDs for a nominal staging environment would be unsafe.

### W-10 — Worker integration tests are missing — Partially fixed

- **Severity:** Medium
- **Evidence:** The only test file covers the pure sizing algorithm. Auth, CORS, KV, Durable Object state transitions, and the Hono routes have no Worker-runtime coverage.
- **Impact:** Compile and algorithm tests pass while critical request-path failures remain undetected.
- **Implemented:** The Cloudflare Vitest Workers pool now exercises DO initialization, decrement, exhaustion, and read-only usage lookup; the absent-admin-secret path; invalid request/chart data; and sizing order/boundary cases.
- **Still required:** Add a test Neon endpoint, signed-storefront credential tests after W-05 is designed, and scheduled reconciliation tests when the organization registry exists.

## Future scale work

### S-01 — Evaluate Redis only after measured DO pressure

- **Severity:** Deferred
- **Trigger:** Sustained per-organization request rates, latency, or cost show that a single `UsageCounter` instance is the constraint.
- **Decision required then:** Keep DOs as the source of coordination and add Redis only for short-window burst protection, or migrate the counter with an explicit reconciliation and rollback plan. Do not add Redis pre-emptively.

## Documentation follow-up

- The architecture document preserves its detailed historical Redis design, while its current-status section supersedes those flows. The database, roadmap, context, build log, and technical-debt docs reflect the Durable Object decision.
- Learning notes under `docs/priyanshu/learn/` are instructional snapshots, not the source of truth for the live architecture.
