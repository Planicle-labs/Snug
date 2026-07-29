import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { eq } from "drizzle-orm";
import {
  organizations,
  widgetConfigs,
  fitSizeCharts,
  garmentMappings,
  brandRequests,
  usageLogs,
  conversionEvents,
  sessions,
} from "@snug/db";
import { purgeMerchantFromKV } from "../lib/kv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Shopify Webhook] Received ${topic} for ${shop}`);

  try {
    const dbClient = db as any;
    // 1. Locate organization record by shop domain
    const orgs = await dbClient
      .select()
      .from(organizations as any)
      .where(eq((organizations as any).shop, shop))
      .limit(1);

    if (orgs.length > 0) {
      const org = orgs[0] as Record<string, any>;

      // 2. Purge Cloudflare KV edge cache
      await purgeMerchantFromKV(org.id, org.apiKey, org.shop);

      // 3. Delete merchant database records across tables in Neon Postgres
      await dbClient.delete(widgetConfigs as any).where(eq((widgetConfigs as any).orgId, org.id));
      await dbClient.delete(fitSizeCharts as any).where(eq((fitSizeCharts as any).orgId, org.id));
      await dbClient.delete(garmentMappings as any).where(eq((garmentMappings as any).orgId, org.id));
      await dbClient.delete(brandRequests as any).where(eq((brandRequests as any).orgId, org.id));
      await dbClient.delete(usageLogs as any).where(eq((usageLogs as any).orgId, org.id));
      await dbClient.delete(conversionEvents as any).where(eq((conversionEvents as any).orgId, org.id));
      await dbClient.delete(organizations as any).where(eq((organizations as any).id, org.id));
    }

    // 4. Clean up any active session tokens for the shop
    await dbClient.delete(sessions as any).where(eq((sessions as any).shop, shop));

    console.log(`[Shop Redact] Completed data redaction for shop ${shop}`);
  } catch (err) {
    console.error(`[Shop Redact Error] Failed to redact data for shop ${shop}:`, err);
  }

  // Mandatory 200 OK response for Shopify webhook acknowledgment
  return new Response(null, { status: 200 });
};
