import db from "../db.server";
import { cleanSizeDb } from "@snug/db";
import { kvPut } from "./kv.server";
import { normalizeBrandSlug } from "./brands.server";

function normalizeFitType(rawFit: string): "slim" | "regular" | "relaxed" | "oversized" {
  const f = String(rawFit || "").toLowerCase().trim();
  if (f === "slim") return "slim";
  if (f === "regular" || f === "regular_plus") return "regular";
  if (f === "oversized" || f === "oversized_plus") return "oversized";
  if (f === "relaxed" || f === "relaxed_plus" || f === "box") return "relaxed";
  return "regular";
}

export async function pushReferenceBrandsToKV() {
  console.log("[Seed KV] Starting Cloudflare KV Reference Brands Sync exclusively from clean_size_db...");

  const dbClient = db as any;
  const grouped = new Map<string, any[]>();

  // Fetch live clean curves exclusively from clean_size_db in connected database
  let cleanDbRows: any[] = [];
  try {
    cleanDbRows = await dbClient.select().from(cleanSizeDb as any);
  } catch (err) {
    console.warn("[Seed KV] Warning: Could not query clean_size_db from DB:", err);
  }

  // Add curves exclusively from clean_size_db
  for (const row of cleanDbRows) {
    const rawBrand = row.brandName || row.brand_name || "";
    const rawCategory = row.category || "";
    const rawFit = row.fit || "";
    const rawSize = row.sizeLabel || row.size_label || "";
    const rawChest = row.garmentChestCm || row.garment_chest_cm;
    const rawLength = row.garmentLengthCm || row.garment_length_cm;
    const rawShoulder = row.garmentShoulderCm || row.garment_shoulder_cm;

    const slug = normalizeBrandSlug(String(rawBrand));
    const garment = String(rawCategory).toLowerCase() === "t-shirt" ? "tshirt" : String(rawCategory).toLowerCase();
    const normFit = normalizeFitType(String(rawFit));
    const key = `brand:${slug}:${garment}:${normFit}`;

    const chestVal = Number(rawChest);
    if (!Number.isFinite(chestVal) || chestVal <= 0) continue;

    const sizeLabel = String(rawSize).trim().toUpperCase();
    if (!sizeLabel) continue;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    const entry = {
      size_label: sizeLabel,
      fit_type: normFit,
      chest_min_cm: chestVal,
      chest_max_cm: chestVal,
      length_min_cm: rawLength ? Number(rawLength) : null,
      length_max_cm: rawLength ? Number(rawLength) : null,
      shoulder_min_cm: rawShoulder ? Number(rawShoulder) : null,
      shoulder_max_cm: rawShoulder ? Number(rawShoulder) : null,
      ease_value_cm: normFit === "slim" ? 5 : normFit === "oversized" ? 19 : normFit === "relaxed" ? 12 : 8,
      ease_source: "inferred",
    };
    const existingIndex = grouped.get(key)!.findIndex((item) => item.size_label === sizeLabel);
    if (existingIndex >= 0) {
      grouped.get(key)![existingIndex] = entry;
    } else {
      grouped.get(key)!.push(entry);
    }
  }

  // Ensure every brand/garment has a :regular fit baseline curve so default storefront lookups never 404
  const brandGarments = new Set<string>();
  for (const k of grouped.keys()) {
    const [_, slug, garment] = k.split(":");
    brandGarments.add(`${slug}:${garment}`);
  }

  for (const bg of brandGarments) {
    const regularKey = `brand:${bg}:regular`;
    if (!grouped.has(regularKey)) {
      const fallbackKey = grouped.has(`brand:${bg}:relaxed`)
        ? `brand:${bg}:relaxed`
        : grouped.has(`brand:${bg}:slim`)
        ? `brand:${bg}:slim`
        : grouped.has(`brand:${bg}:oversized`)
        ? `brand:${bg}:oversized`
        : null;
      if (fallbackKey && grouped.has(fallbackKey)) {
        const cloned = grouped.get(fallbackKey)!.map((entry) => ({
          ...entry,
          fit_type: "regular" as const,
          ease_value_cm: 8,
        }));
        grouped.set(regularKey, cloned);
      }
    }
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

  // Sync supported brand slugs list to KV
  const uniqueBrands = Array.from(
    new Set(cleanDbRows.map((r) => normalizeBrandSlug(String(r.brandName || r.brand_name || ""))))
  ).filter(Boolean);
  if (uniqueBrands.length > 0) {
    await kvPut("brands:supported", uniqueBrands);
  }

  // Structured brand x garment coverage for the storefront widget. Sizes come
  // from the :regular rows because the widget never sends ref_fit and the
  // worker defaults it to regular. Mirrors scripts/publish-config.mjs.
  const garmentLabels: Record<string, string> = { tshirt: "T-Shirt / Top", polo: "Polo Shirt" };
  const brandNames = new Map<string, string>();
  for (const row of cleanDbRows) {
    const slug = normalizeBrandSlug(String(row.brandName || row.brand_name || ""));
    if (slug && !brandNames.has(slug)) brandNames.set(slug, String(row.brandName || row.brand_name || "").trim());
  }
  const coverage: { brands: Array<{ slug: string; name: string; garments: Array<{ garment: string; label: string; sizes: string[] }> }> } = { brands: [] };
  for (const bg of brandGarments) {
    const sep = bg.indexOf(":");
    const slug = bg.slice(0, sep);
    const garment = bg.slice(sep + 1);
    const regularRows = grouped.get(`brand:${bg}:regular`) || [];
    if (regularRows.length === 0) continue;
    const sortedSizes = [...regularRows]
      .sort((a, b) => (a.chest_min_cm + a.chest_max_cm) / 2 - (b.chest_min_cm + b.chest_max_cm) / 2)
      .map((row) => row.size_label);
    let brandEntry = coverage.brands.find((b) => b.slug === slug);
    if (!brandEntry) {
      brandEntry = { slug, name: brandNames.get(slug) || slug, garments: [] };
      coverage.brands.push(brandEntry);
    }
    brandEntry.garments.push({
      garment,
      label: garmentLabels[garment] || (garment.charAt(0).toUpperCase() + garment.slice(1)),
      sizes: sortedSizes,
    });
  }
  coverage.brands.sort((a, b) => a.name.localeCompare(b.name));
  if (coverage.brands.length > 0) {
    await kvPut("brands:coverage", coverage);
  }

  console.log(`[Seed KV] Synced ${successCount}/${grouped.size} database size charts to Cloudflare KV.`);
  return successCount;
}

