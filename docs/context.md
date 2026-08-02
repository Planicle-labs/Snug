# Snug — Current Project Context & State

---

## 1. Project Overview

**Snug** is an e-commerce sizing intelligence platform built for Shopify merchants. It eliminates apparel size uncertainty by translating a shopper's known size in a reference brand (e.g. Zara, Nike, Uniqlo) into their ideal size for the merchant's brand using physical garment measurements, Ease values (chest, length, shoulder), and anthropometric population anchors.

---

## 2. Recent Commits & Working Tree Status

As of the latest repository update, all uncommitted modifications have been organized into clean, logical commits on `main`:

1. **`dde46fe`**: `docs: relocate documentation files to root docs directory`
   - Relocated core specifications (`architecture.md`, `build_logs.md`, `database.md`, `prd.md`, `roadmap.md`) to `/docs`.
2. **`701786a`**: `feat(db): update schema and types for trial tracking and paid tier fields`
   - Updated `organizations` schema in `@snug/db` to support `planTier = 'trial'` with `trialRequestsRemaining = 1000` and paid tier billing fields (`baseFeeInr`, `perConversionInr`, `monthlyCapInr`, `billingPeriodStart`, etc.).
3. **`8807414`**: `feat(worker): scaffold cloudflare worker and usage counter durable object`
   - Scaffolded Cloudflare Worker project with Hono framework, `wrangler.toml`, `pnpm-lock.yaml`, and initial `UsageCounter` Durable Object.

---

## 3. Architecture & Tech Stack Summary (V1 Decision)

```
                       ┌────────────────────────────────────────┐
                       │           Shopify Storefront           │
                       │        (Theme App Extension JS)       │
                       └───────────────────┬────────────────────┘
                                           │
                                  POST /v1/size (API Key)
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Worker (Sizing API)                        │
│                                                                                 │
│   • Origin & API Key Auth     • 9-Step Sizing Algorithm    • Durable Objects    │
│   • KV Reader                 • Confidence Scoring Engine  • (UsageCounter)     │
└──────────────┬───────────────────────────┬──────────────────────────────┬───────┘
               │                           │                              │
               ▼                           │ (Checkpoint & Sync)          ▼
    ┌───────────────────┐                  │                   ┌────────────────────┐
    │  Cloudflare KV    │                  └──────────────────►│   Neon Postgres    │
    │ (Brand & Chart    │                                      │  (Usage Logs &     │
    │     Cache)        │◄─────────────────────────────────────┤  Dashboard State)  │
    └─────────▲─────────┘         GET /v1/admin/usage          └─────────▲──────────┘
              │                  (On-Demand Refresh)                     │
              └────────────────────────────┬─────────────────────────────┘
                                           │
                       ┌───────────────────┴────────────────────┐
                       │       Merchant React Router App        │
                       │    (Shopify Dashboard & Admin UI)      │
                       └────────────────────────────────────────┘
```

### Usage and reporting strategy
1. **Current authority:** `UsageCounter` Durable Objects provide serialized trial-quota transitions per organization.
2. **Current read model:** Cloudflare KV distributes API-key records, mappings, and charts; it is not a quota counter.
3. **Pending persistence:** milestone, analytics, and dashboard sync calls are scaffolded but currently only log. Neon writes and scheduled reconciliation remain implementation work.
4. **Deferred scale option:** Redis is not deployed. It will be considered only after measured load shows that a per-organization DO is a bottleneck.

See [issues.md](issues.md) for the deployment blockers and acceptance criteria.

---

## 4. Current State & Remaining Work Summary

| Surface | Status | Completed Features | Outstanding Work |
|---|---|---|---|
| **Database & Schema (`packages/db`)** | 🟢 Schema Pushed | Postgres setup, Drizzle schemas, trial fields, CHECK constraints | Seeding NIFT anthropometric anchors, seeding 10 reference brand size charts |
| **Merchant Dashboard (`shopify-app`)** | 🟡 60% Built | OAuth, 3-step onboarding UI, Brand setup, Size Charts UI, Garment Mapping UI | Analytics UI, Billing UI, On-demand usage fetch (`GET /v1/admin/usage`), KV cache sync triggers, GDPR webhooks |
| **Sizing API (`worker/`)** | 🟡 Not production ready | Hono routing, KV reads, sizing algorithm, and a `UsageCounter` DO scaffold | Fix admin auth and DO initialization; implement Neon persistence, runtime validation, reconciliation, and Worker-runtime tests (W-01 to W-10) |
| **Background Crons** | 🔴 0% Built | None | Daily Usage sync cron (DO -> Neon Postgres), billing period rollover cron |
| **Storefront Widget** | 🔴 0% Built | None | Theme App Extension scaffold, Vanilla JS bundle, sizing modal UI, boundary case two-size selector, Dawn theme integration |

---

## 5. Workstream Division

The remaining tasks are divided into two decoupled workstreams:
* **Priyanshu**: Sizing Engine, Cloudflare Worker Sizing API, `UsageCounter` DO, Worker-runtime tests, data seeding, actual Neon sync, and scheduled reconciliation.
* **Rudra**: Merchant Dashboard UI (Size Charts, Garment Tagging, Analytics with On-Demand Usage Loader, Billing), Storefront Theme App Extension Widget (with Boundary Case Two-Size UI), Dashboard KV Cache Sync, and GDPR Webhooks.
