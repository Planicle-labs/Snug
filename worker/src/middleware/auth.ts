import { createMiddleware } from "hono/factory";

export interface MerchantKVRecord{
  org_id: string;
  shop: string;
  plan_tier: "trial" | "paid";
  trial_requests_remaining: number;
  widget_active: boolean;
}

export const authMiddleware = createMiddleware(async (ctx, next) => {
  const apiKey = ctx.req.header("X-Snug-Key")
  if (!apiKey) {
    return ctx.json({ error: "Unauthorized", message: "Missing API Key" }, 401)
  }

  const record = (await ctx.env.KV.get(`apikey:${apiKey}`, "json")) as MerchantKVRecord | null;
  if (!record) {
    return ctx.json({ error: "Unauthorized", message: "Invalid API Key" }, 401)
  }

  if (!record.widget_active) {
    // meaning app is uninstalled or widget is not active inside the store
    return ctx.json({ error: "Forbidden", message: "Widget is inactive" }, 403)
  }

  const rawOrigin = ctx.req.header("Origin") || ctx.req.header("origin")
  const cleanOrigin = rawOrigin ? rawOrigin.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  if (!rawOrigin || cleanOrigin !== record.shop) {
    return ctx.json({ error: "Unauthorized", message: "Origin domain mismatch" }, 401)
  }

  if (record.trial_requests_remaining === 0) {
    return ctx.json({ error: "Forbidden", message: "No requests remaining" }, 403)
  }

  // set is used to ctx.set variables to be used downstream by our worker using ctx.var.org
  ctx.set("org", record);
  await next();
})
