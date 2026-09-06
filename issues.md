# Review Issues

## P1: Add a migration and backfill for `clean_size_db`

**Location:** `packages/db/src/schema.ts:246-247`

Existing deployments have only the tracked `0000`/`0001` Drizzle migrations, while this change switches reference-brand reads and KV publishing to this new table without creating or populating it. Those deployments will either hit the caught missing-table error or get an empty result, produce no `brands:coverage` record, and the updated storefront widget will hide its trigger for all first-time visitors.

## P2: Normalize persisted brand slugs before filtering them

**Location:** `shopify-app/app/routes/app.brand.tsx:67-71`

For existing organizations with legacy underscore slugs such as `under_armour` or `ralph_lauren`, the DB-derived list uses canonical hyphenated slugs, so this raw `Set.has` drops their saved selections. The Brand Setup page then presents the organization as unconfigured and a subsequent save overwrites its stored reference-brand configuration.
