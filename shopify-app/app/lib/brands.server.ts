import { sql } from "drizzle-orm";
import db from "../db.server";

export interface MasterBrand {
  slug: string;
  name: string;
  color: string;
  categories: string[];
  gender: ("menswear" | "womenswear" | "unisex" | "kids")[];
  styles: ("streetwear" | "casual" | "formal" | "ethnic" | "activewear")[];
  region: "india" | "global" | "both";
  tier: "affordable" | "mid" | "premium";
  verified: boolean;
  productCount?: number;
  chartCount?: number;
  source?: string;
  confidence?: string;
}

export function normalizeBrandSlug(brandName: string): string {
  const lower = brandName.toLowerCase().trim();
  if (lower === "h_m" || lower === "h&m" || lower === "hm") return "hm";
  if (lower === "levi" || lower === "levis" || lower === "levi's" || lower === "levi-s") return "levis";
  if (lower === "the-souled-store" || lower === "the souled store" || lower === "souledstore") return "souledstore";
  if (lower === "marks-and-spencer" || lower === "marks & spencer" || lower === "marksandspencer") return "marksandspencer";
  if (lower === "ralph_lauren" || lower === "ralph-lauren" || lower === "ralph lauren") return "ralph-lauren";
  if (lower === "under_armour" || lower === "under-armour" || lower === "under armour") return "under-armour";
  if (lower === "allen-solly" || lower === "allen_solly" || lower === "allen solly") return "allen-solly";
  if (lower === "peter-england" || lower === "peter_england" || lower === "peter england") return "peter-england";
  if (lower === "van-heusen" || lower === "van_heusen" || lower === "van heusen") return "van-heusen";

  return lower
    .replace(/['’]/g, "")
    .replace(/[._]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatCategoryLabel(cat: string): string {
  const c = cat.toLowerCase().replace(/[-_]/g, "");
  if (c === "tshirt") return "T-Shirt";
  if (c === "polo") return "Polo";
  if (c === "shirt") return "Shirt";
  if (c === "sweatshirt") return "Sweatshirt";
  if (c === "hoodie") return "Hoodie";
  if (c === "jacket") return "Jacket";
  if (c === "kurta") return "Kurta";
  if (c === "top") return "Top";
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function getBrandColor(slug: string): string {
  const palette = [
    "#111827",
    "#DC2626",
    "#2563EB",
    "#7C3AED",
    "#059669",
    "#D97706",
    "#DB2777",
    "#0891B2",
    "#4F46E5",
    "#0D9488",
    "#78350F",
    "#EAB308",
  ];
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash << 5) - hash + slug.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

let cachedBrands: MasterBrand[] | null = null;
let cacheExpiry = 0;
const BRANDS_CACHE_TTL_MS = 60 * 1000;

export async function fetchDatabaseBrands(forceFresh = false): Promise<MasterBrand[]> {
  const now = Date.now();
  if (!forceFresh && cachedBrands && now < cacheExpiry) {
    return cachedBrands;
  }

  const dbClient = db as any;

  let cleanBrandRows: Array<{
    brand_name: string;
    categories: string[] | string;
    fits: string[] | string;
    region: string | null;
    product_count: number | null;
    chart_count: number | string;
    confidence: string | null;
    source: string | null;
  }> = [];

  try {
    const res = await dbClient.execute(sql`
      SELECT 
        brand_name,
        array_agg(DISTINCT category) as categories,
        array_agg(DISTINCT fit) as fits,
        max(region) as region,
        max(product_count) as product_count,
        count(*) as chart_count,
        max(confidence) as confidence,
        max(source) as source
      FROM clean_size_db
      GROUP BY brand_name
      ORDER BY brand_name;
    `);
    cleanBrandRows = (res && Array.isArray(res.rows) ? res.rows : Array.isArray(res) ? res : []) as any[];
  } catch (err) {
    console.warn("[BrandsServer] Error querying clean_size_db:", err);
  }

  const brandMap = new Map<string, MasterBrand>();

  for (const row of cleanBrandRows) {
    const rawName = String(row.brand_name || "").trim();
    if (!rawName) continue;
    const slug = normalizeBrandSlug(rawName);

    let rawCategories: string[] = [];
    if (Array.isArray(row.categories)) {
      rawCategories = row.categories;
    } else if (typeof row.categories === "string") {
      rawCategories = row.categories.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim());
    }
    const categories = Array.from(new Set(rawCategories.map((c) => formatCategoryLabel(String(c))))).filter(Boolean);

    let rawFits: string[] = [];
    if (Array.isArray(row.fits)) {
      rawFits = row.fits;
    } else if (typeof row.fits === "string") {
      rawFits = row.fits.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim().toLowerCase());
    }

    const styles: ("streetwear" | "casual" | "formal" | "ethnic" | "activewear")[] = [];
    const catLower = categories.map((c) => c.toLowerCase());
    if (catLower.some((c) => c.includes("kurta"))) styles.push("ethnic");
    if (catLower.some((c) => c.includes("hoodie") || c.includes("sweatshirt")) || rawFits.includes("oversized")) {
      styles.push("streetwear");
    }
    if (catLower.some((c) => c.includes("shirt") || c.includes("polo"))) styles.push("formal");
    if (styles.length === 0 || catLower.some((c) => c.includes("t-shirt") || c.includes("polo"))) {
      styles.push("casual");
    }

    let region: "india" | "global" | "both" = "india";
    const regUpper = String(row.region || "").toUpperCase();
    if (regUpper === "GLOBAL") region = "global";
    else if (regUpper === "BOTH") region = "both";
    else if (regUpper === "IN" || regUpper === "INDIA") region = "india";

    const brand: MasterBrand = {
      slug,
      name: rawName,
      color: getBrandColor(slug),
      categories: categories.length > 0 ? categories : ["T-Shirt"],
      gender: catLower.some((c) => c.includes("top")) ? ["womenswear", "unisex"] : ["menswear", "unisex"],
      styles: Array.from(new Set(styles)),
      region,
      tier: "mid",
      verified: true,
      productCount: Number(row.product_count || 0),
      chartCount: Number(row.chart_count || 0),
      source: String(row.source || "clean_size_db"),
      confidence: String(row.confidence || "high"),
    };

    brandMap.set(slug, brand);
  }

  const allBrands = Array.from(brandMap.values());
  allBrands.sort((a, b) => {
    const pDiff = (b.productCount || 0) - (a.productCount || 0);
    if (pDiff !== 0) return pDiff;
    return (b.chartCount || 0) - (a.chartCount || 0) || a.name.localeCompare(b.name);
  });

  cachedBrands = allBrands;
  cacheExpiry = Date.now() + BRANDS_CACHE_TTL_MS;

  return allBrands;
}

export async function resolveBrandSlugs(slugs: string[]): Promise<MasterBrand[]> {
  const allBrands = await fetchDatabaseBrands();
  const brandBySlug = new Map<string, MasterBrand>();
  for (const b of allBrands) {
    brandBySlug.set(b.slug, b);
  }

  const seen = new Set<string>();
  const result: MasterBrand[] = [];
  for (const raw of slugs) {
    const slug = normalizeBrandSlug(raw);
    if (seen.has(slug)) continue;
    const found = brandBySlug.get(slug);
    if (found) {
      seen.add(slug);
      result.push(found);
    }
  }

  return result;
}

