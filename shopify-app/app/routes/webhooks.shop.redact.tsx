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
} from "@conveaux/db/schema";
import { purgeMerchantFromKV } from "../lib/kv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Shopify Webhook] Received ${topic} for ${shop}`);

  try {
    // 1. Locate organization record by shop domain
    const orgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.shop, shop))
      .limit(1);

    if (orgs.length > 0) {
      const org = orgs[0];

      // 2. Purge Cloudflare KV edge cache
      await purgeMerchantFromKV(org.id, org.apiKey, org.shop);

      // 3. Delete merchant database records across tables in Neon Postgres
      await db.delete(widgetConfigs).where(eq(widgetConfigs.orgId, org.id));
      await db.delete(fitSizeCharts).where(eq(fitSizeCharts.orgId, org.id));
      await db.delete(garmentMappings).where(eq(garmentMappings.orgId, org.id));
      await db.delete(brandRequests).where(eq(brandRequests.orgId, org.id));
      await db.delete(usageLogs).where(eq(usageLogs.orgId, org.id));
      await db.delete(conversionEvents).where(eq(conversionEvents.orgId, org.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }

    // 4. Clean up any active session tokens for the shop
    await db.delete(sessions).where(eq(sessions.shop, shop));

    console.log(`[Shop Redact] Completed data redaction for shop ${shop}`);
  } catch (err) {
    console.error(`[Shop Redact Error] Failed to redact data for shop ${shop}:`, err);
  }

  // Mandatory 200 OK response for Shopify webhook acknowledgment
  return new Response(null, { status: 200 });
};
