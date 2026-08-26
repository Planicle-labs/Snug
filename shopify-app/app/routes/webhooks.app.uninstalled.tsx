import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { eq } from "drizzle-orm";
import { sessions, organizations } from "@snug/db";
import { pushApiKeyToKV } from "../lib/kv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[Shopify Webhook] Received ${topic} for ${shop}`);

  try {
    const dbClient = db as any;

    // Clean up session tokens
    if (session) {
      await dbClient.delete(sessions).where(eq(sessions.shop, shop));
    }

    // Mark organization widget as inactive
    const [org] = await dbClient
      .select()
      .from(organizations as any)
      .where(eq((organizations as any).shop, shop))
      .limit(1);

    if (org) {
      await dbClient
        .update(organizations as any)
        .set({ widgetActive: false, updatedAt: new Date() })
        .where(eq((organizations as any).id, org.id));

      if (org.apiKey) {
        await pushApiKeyToKV({
          api_key: String(org.apiKey),
          org_id: String(org.id),
          shop: String(org.shop),
          plan_tier: (org.planTier || "trial") as "trial" | "starter" | "growth",
          trial_requests_remaining: Number(org.trialRequestsRemaining ?? 1000),
          widget_active: false,
        });
      }
    }
  } catch (err) {
    console.error(`[App Uninstalled Error] Failed to process webhook for ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
};

