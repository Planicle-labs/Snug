import { REFERENCE_BRAND_CHARTS } from "@snug/db/src/seed/reference_data";
import { kvPut } from "./kv.server";

export async function pushReferenceBrandsToKV() {
  console.log("[Seed KV] Starting Cloudflare KV Reference Brands Sync...");

  // Group reference brand rows by `brand:garmentType:fitType`
  const grouped = new Map<string, any[]>();

  for (const row of REFERENCE_BRAND_CHARTS) {
    const key = `brand:${row.brand}:${row.garmentType}:${row.fitType}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push({
      size_label: row.sizeLabel,
      fit_type: row.fitType,
      chest_min_cm: row.chestMinCm,
      chest_max_cm: row.chestMaxCm,
      length_min_cm: row.lengthMinCm,
      length_max_cm: row.lengthMaxCm,
      shoulder_min_cm: row.shoulderMinCm,
      shoulder_max_cm: row.shoulderMaxCm,
      ease_value_cm: row.easeValueCm,
      ease_source: row.easeSource,
    });
  }

  let successCount = 0;
  for (const [key, rows] of grouped.entries()) {
    // Sort rows by chest midpoint
    const sortedRows = [...rows].sort(
      (a, b) => (a.chest_min_cm + a.chest_max_cm) / 2 - (b.chest_min_cm + b.chest_max_cm) / 2
    );
    const success = await kvPut(key, sortedRows);
    if (success) {
      successCount++;
    }
  }

  console.log(`[Seed KV] Synced ${successCount}/${grouped.size} reference brand size charts to Cloudflare KV.`);
  return successCount;
}
