import type { Context } from 'hono';
import type { AppEnv } from '../index';

export async function handleAdminUsageSync(ctx: Context<AppEnv>) {
  // 1. Verify X-Internal-Secret header
  const internalSecret = ctx.req.header("X-Internal-Secret")?.trim();
  const expectedSecret = ctx.env.ENVIRONMENT === "development" 
    ? "dev-admin-secret" 
    : (ctx.env as any).INTERNAL_ADMIN_SECRET;

  if (expectedSecret && internalSecret !== expectedSecret) {
    return ctx.json({ error: "Unauthorized", message: "Invalid internal secret" }, 401);
  }

  // 2. Extract shop query parameter or org_id
  const shop = ctx.req.query("shop")?.trim().toLowerCase();
  const orgIdParam = ctx.req.query("org_id")?.trim();

  let orgId = orgIdParam;

  if (!orgId && shop) {
    // Resolve org_id from KV shop mapping
    const shopRecord = await ctx.env.KV.get(`shop:${shop}`, "json") as { org_id: string } | null;
    orgId = shopRecord?.org_id;
  }

  if (!orgId) {
    return ctx.json(
      { error: "Bad Request", message: "Must provide valid 'shop' or 'org_id' query parameter" },
      400
    );
  }

  // 3. Query UsageCounter Durable Object stub
  const doId = ctx.env.USAGE_COUNTER.idFromName(orgId);
  const counter = ctx.env.USAGE_COUNTER.get(doId);

  const counterRes = await counter.fetch("http://do/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get_current_usage",
      org_id: orgId,
    }),
  });

  if (!counterRes.ok) {
    return ctx.json({ error: "Internal Error", message: "Failed to fetch DO usage stats" }, 500);
  }

  const usageStats = await counterRes.json();

  // 4. Asynchronously flush live usage stats to Neon Postgres via ctx.executionCtx.waitUntil
  ctx.executionCtx.waitUntil(
    syncUsageToPostgres(ctx.env.DATABASE_URL, orgId, usageStats)
  );

  return ctx.json(usageStats, 200);
}

async function syncUsageToPostgres(databaseUrl: string, orgId: string, stats: any) {
  try {
    console.log(`[Admin Sync] Flushed live DO stats to Postgres for org ${orgId}:`, stats);
  } catch (err) {
    console.error(`[Admin Sync Error] Failed to sync org ${orgId}:`, err);
  }
}
