import db from "../db.server";
import { fitSizeCharts } from "@conveaux/db/schema";
import { eq, and } from "drizzle-orm";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

export interface MerchantKVPayload {
  org_id: string;
  shop: string;
  plan_tier: "trial" | "paid";
  trial_requests_remaining: number;
  widget_active: boolean;
  api_key: string;
}

export async function kvPut(key: string, value: any): Promise<boolean> {
  if (!ACCOUNT_ID || !KV_NAMESPACE_ID || !API_TOKEN) {
    console.warn(`[KV Sync] Cloudflare KV credentials not configured. Key '${key}' skipped.`);
    return false;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: typeof value === "string" ? value : JSON.stringify(value),
    });
    if (!res.ok) {
      console.error(`[KV Sync] Failed to write key '${key}': ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[KV Sync] Error writing key '${key}':`, err);
    return false;
  }
}

export async function kvDelete(key: string): Promise<boolean> {
  if (!ACCOUNT_ID || !KV_NAMESPACE_ID || !API_TOKEN) {
    return false;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
      },
    });
    return res.ok;
  } catch (err) {
    console.error(`[KV Sync] Error deleting key '${key}':`, err);
    return false;
  }
}

export async function pushApiKeyToKV(payload: MerchantKVPayload) {
  const key = `apikey:${payload.api_key}`;
  const shopKey = `shop:${payload.shop}`;
  await kvPut(shopKey, { org_id: payload.org_id, api_key: payload.api_key });
  return kvPut(key, payload);
}

export async function pushChartToKV(orgId: string, garmentType: string) {
  const charts = await db
    .select()
    .from(fitSizeCharts)
    .where(
      and(
        eq(fitSizeCharts.orgId, orgId),
        eq(fitSizeCharts.garmentType, garmentType)
      )
    );

  const key = `chart:${orgId}:${garmentType}`;

  if (charts.length === 0) {
    return kvDelete(key);
  }

  const kvData = charts.map((c) => ({
    size_label: c.sizeLabel,
    fit_type: c.fitType,
    chest_min_cm: Number(c.chestMinCm),
    chest_max_cm: Number(c.chestMaxCm),
    length_min_cm: c.lengthMinCm ? Number(c.lengthMinCm) : null,
    length_max_cm: c.lengthMaxCm ? Number(c.lengthMaxCm) : null,
    shoulder_min_cm: c.shoulderMinCm ? Number(c.shoulderMinCm) : null,
    shoulder_max_cm: c.shoulderMaxCm ? Number(c.shoulderMaxCm) : null,
    ease_value_cm: Number(c.easeValueCm),
    ease_source: c.easeSource,
  }));

  return kvPut(key, kvData);
}

export async function purgeMerchantFromKV(orgId: string, apiKey?: string | null, shop?: string | null) {
  const deletePromises: Promise<boolean>[] = [];

  if (apiKey) {
    deletePromises.push(kvDelete(`apikey:${apiKey}`));
  }
  if (shop) {
    deletePromises.push(kvDelete(`shop:${shop}`));
  }
  deletePromises.push(kvDelete(`merchant:${orgId}:mappings`));

  const COMMON_GARMENTS = ['tshirt', 'shirt', 'hoodie', 'jacket', 'pants', 'jeans', 'shorts', 'dress'];
  COMMON_GARMENTS.forEach((g) => {
    deletePromises.push(kvDelete(`chart:${orgId}:${g}`));
  });

  const results = await Promise.all(deletePromises);
  console.log(`[KV Purge] Purged KV records for org ${orgId}: ${results.filter(Boolean).length} keys deleted.`);
  return true;
}
