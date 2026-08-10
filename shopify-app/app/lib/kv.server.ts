import db from "../db.server";
import { fitSizeCharts, garmentMappings } from "@snug/db";
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
  const dbClient = db as any;
  const fitSizeChartsTable = fitSizeCharts as any;

  const charts = await dbClient
    .select()
    .from(fitSizeChartsTable)
    .where(
      and(
        eq(fitSizeChartsTable.orgId, orgId),
        eq(fitSizeChartsTable.garmentType, garmentType)
      )
    );

  const key = `chart:${orgId}:${garmentType}`;

  if (charts.length === 0) {
    return kvDelete(key);
  }

  // A database query without ORDER BY has no stable order. The Worker also
  // normalizes this defensively, but publishing ordered rows keeps every KV
  // consumer consistent and makes boundary recommendations explainable.
  const orderedCharts = [...charts].sort((left: any, right: any) => {
    const leftBodyMid = (Number(left.chestMinCm) + Number(left.chestMaxCm)) / 2 - Number(left.easeValueCm);
    const rightBodyMid = (Number(right.chestMinCm) + Number(right.chestMaxCm)) / 2 - Number(right.easeValueCm);
    return leftBodyMid - rightBodyMid;
  });

  const kvData = orderedCharts.map((c: any) => ({
    size_label: c.sizeLabel,
    fit_type: c.fitType,
    chest_min_cm: Number(c.chestMinCm),
    chest_max_cm: Number(c.chestMaxCm),
    length_min_cm: c.lengthMinCm === null ? null : Number(c.lengthMinCm),
    length_max_cm: c.lengthMaxCm === null ? null : Number(c.lengthMaxCm),
    shoulder_min_cm: c.shoulderMinCm === null ? null : Number(c.shoulderMinCm),
    shoulder_max_cm: c.shoulderMaxCm === null ? null : Number(c.shoulderMaxCm),
    ease_value_cm: Number(c.easeValueCm),
    ease_source: c.easeSource,
    guide_gender: c.extraMeasurements?.guideGender ?? "unisex",
    show_size_guide: Boolean(c.extraMeasurements?.showOnStorefront),
  }));

  return kvPut(key, kvData);
}

/** Publish the product-to-garment lookup used by the storefront Worker. */
export async function pushMappingsToKV(orgId: string) {
  const dbClient = db as any;
  const mappings = await dbClient
    .select()
    .from(garmentMappings as any)
    .where(eq((garmentMappings as any).orgId, orgId));

  const key = `merchant:${orgId}:mappings`;
  if (!mappings.length) return kvDelete(key);

  const payload = Object.fromEntries(mappings.map((mapping: any) => [
    mapping.shopifyProductId,
    { garment_type: mapping.garmentType, is_active: true },
  ]));
  return kvPut(key, payload);
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
