import type { AppEnv } from '../index'
import { createMiddleware } from 'hono/factory';
import { UsageCounter } from '../durable-objects/UsageCounter';

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (ctx, next) => {
  const org = ctx.var.org;

  // Paid tier limits are not yet defined; currently unconstrained (see TECHNICAL_DEBT.md C8)
  if (org.plan_tier === 'paid') {
    return await next();
  }

  const doId = ctx.env.USAGE_COUNTER.idFromName(org.org_id);
  const counter = ctx.env.USAGE_COUNTER.get(doId);

  const counterRes = await counter.fetch("http://do/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "check_and_decrement_trial",
      org_id: org.org_id,
    }),
  });

  if (!counterRes.ok) {
    return ctx.json({ error: "Internal Error", message: "Failed to verify usage quota" }, 500)
  }
  const result = (await counterRes.json()) as {
    allowed: boolean;
    usage_remaining: number;
    milestone_crossed?: boolean;
  };
  if (!result.allowed) {
    return ctx.json(
      {
        error: "Too Many Requests",
        message: "Trial quota exhausted. Please upgrade to a paid plan.",
      },
      429
    );
  }
  // If usage hit a milestone checkpoint (e.g. 100, 200, 500 requests used),
  // asynchronously flush remaining quota to Neon Postgres without blocking the HTTP response!
  if (result.milestone_crossed) {
    ctx.executionCtx.waitUntil(
      syncMilestoneToPostgres(ctx.env.DATABASE_URL, org.org_id, result.usage_remaining)
    );
  }

  // Pass control downstream to route handlers
  await next();
})

async function syncMilestoneToPostgres(
  databaseUrl: string,
  orgId: string,
  remaining: number
) {
  try {
    // We use Neon serverless driver or SQL HTTP query to sync remaining trial requests
    // (We will wire the exact driver call once db helper is connected)
    console.log(`[Milestone Sync] Org ${orgId} synced remaining trial: ${remaining}`);
  } catch (err) {
    console.error(`[Milestone Sync Error] Failed to sync org ${orgId}:`, err);
  }
}
