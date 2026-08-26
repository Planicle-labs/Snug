import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Shopify Mandatory GDPR Compliance Webhook: CUSTOMERS_DATA_REQUEST
 * Triggered when a customer requests a copy of their personal data from a merchant.
 * Snug stores size charts, product-to-garment mappings, and anonymized sizing logs
 * linked to merchant organizations. No customer personal identifiable information (PII)
 * is retained.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Shopify Compliance Webhook] Received ${topic} for ${shop}`, {
    customerId: (payload as any)?.customer?.id,
    ordersRequested: (payload as any)?.orders_requested?.length ?? 0,
  });

  // Snug recommendation engine does not store personal customer identity records.
  // Sizing usage logs are anonymous and tied to transient browser visitor IDs.
  return new Response(
    JSON.stringify({
      message: "Customer data request acknowledged. Snug does not retain customer personal identifiable information (PII).",
      shop,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
