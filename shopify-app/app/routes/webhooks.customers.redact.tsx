import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, usageLogs, conversionEvents } from "@snug/db";
import { eq, and } from "drizzle-orm";

/**
 * Shopify Mandatory GDPR Compliance Webhook: CUSTOMERS_REDACT
 * Triggered when a customer requests that a merchant delete their personal data.
 * Snug removes any visitor-associated event logs if a matching identifier is found.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Shopify Compliance Webhook] Received ${topic} for ${shop}`, {
    customerId: (payload as any)?.customer?.id,
    email: (payload as any)?.customer?.email ? "[REDACTED]" : undefined,
  });

  try {
    const customerId = (payload as any)?.customer?.id;
    if (customerId) {
      const dbClient = db as any;
      const [org] = await dbClient
        .select()
        .from(organizations as any)
        .where(eq((organizations as any).shop, shop))
        .limit(1);

      if (org) {
        const visitorIdStr = String(customerId);
        await dbClient
          .delete(conversionEvents as any)
          .where(
            and(
              eq((conversionEvents as any).orgId, org.id),
              eq((conversionEvents as any).visitorId, visitorIdStr)
            )
          );
        await dbClient
          .delete(usageLogs as any)
          .where(
            and(
              eq((usageLogs as any).orgId, org.id),
              eq((usageLogs as any).visitorId, visitorIdStr)
            )
          );
      }
    }
  } catch (err) {
    console.error(`[Customers Redact Error] Failed to redact data for shop ${shop}:`, err);
  }

  // Shopify requires a mandatory 200 OK acknowledgment
  return new Response(
    JSON.stringify({
      message: "Customer data redaction completed.",
      shop,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
