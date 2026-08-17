import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { DrizzleSessionStoragePostgres } from "@shopify/shopify-app-session-storage-drizzle";
import db from "./db.server";
import { sessions, organizations } from "@snug/db";
import { eq } from "drizzle-orm";
import { pushApiKeyToKV } from "./lib/kv.server";
import { randomUUID } from "crypto";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new DrizzleSessionStoragePostgres(db as any, sessions as any),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session }) => {
      try {
        await shopify.registerWebhooks({ session });
      } catch (err) {
        console.error("Failed to register webhooks in afterAuth:", err);
      }

      const shop = session.shop;
      const dbClient = db as any;
      const orgTable = organizations as any;
      const [existingOrg] = await dbClient
        .select()
        .from(orgTable)
        .where(eq(orgTable.shop, shop))
        .limit(1);

      if (!existingOrg) {
        const apiKey = randomUUID();
        const [newOrg] = await dbClient
          .insert(orgTable)
          .values({
            shop,
            apiKey,
            planTier: "trial",
            trialRequestsRemaining: 1000,
            onboardingComplete: false,
            widgetActive: false,
          })
          .returning();

        const newOrgRecord = newOrg as Record<string, any>;
        if (newOrgRecord && newOrgRecord.apiKey) {
          await pushApiKeyToKV({
            api_key: String(newOrgRecord.apiKey),
            org_id: String(newOrgRecord.id),
            shop: String(newOrgRecord.shop),
            plan_tier: (newOrgRecord.planTier || "trial") as "trial" | "starter" | "growth",
            trial_requests_remaining: Number(newOrgRecord.trialRequestsRemaining ?? 1000),
            widget_active: Boolean(newOrgRecord.widgetActive),
          });
        }
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
