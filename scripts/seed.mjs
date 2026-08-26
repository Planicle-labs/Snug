import { neon } from "../shopify-app/node_modules/@neondatabase/serverless/index.mjs";

const ANTHROPOMETRIC_ANCHORS = [
  { garmentType: 'tshirt', sizeLabel: 'XS', chestBodyCm: 82, shoulderBodyCm: 41, heightCm: 165 },
  { garmentType: 'tshirt', sizeLabel: 'S',  chestBodyCm: 86, shoulderBodyCm: 43, heightCm: 170 },
  { garmentType: 'tshirt', sizeLabel: 'M',  chestBodyCm: 91, shoulderBodyCm: 45, heightCm: 175 },
  { garmentType: 'tshirt', sizeLabel: 'L',  chestBodyCm: 96, shoulderBodyCm: 47, heightCm: 180 },
  { garmentType: 'tshirt', sizeLabel: 'XL', chestBodyCm: 102, shoulderBodyCm: 49, heightCm: 183 },
  { garmentType: 'tshirt', sizeLabel: 'XXL', chestBodyCm: 108, shoulderBodyCm: 51, heightCm: 185 },
];

const REFERENCE_BRAND_CHARTS = [
  // ─── ZARA (Regular) ──────────────────────────────────────────────────────────
  { brand: 'zara', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 92, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 42, shoulderMaxCm: 44, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'zara', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 94, chestMaxCm: 98, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 44, shoulderMaxCm: 46, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'zara', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 100, chestMaxCm: 104, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 46, shoulderMaxCm: 48, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'zara', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 106, chestMaxCm: 110, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 48, shoulderMaxCm: 50, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── NIKE (Athletic Regular) ─────────────────────────────────────────────────
  { brand: 'nike', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 96, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'nike', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 104, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'nike', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 112, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'nike', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 124, lengthMinCm: 76, lengthMaxCm: 78, shoulderMinCm: 49, shoulderMaxCm: 52, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── UNIQLO (Boxy Regular) ───────────────────────────────────────────────────
  { brand: 'uniqlo', garmentType: 'tshirt', sizeLabel: 'XS', chestMinCm: 80, chestMaxCm: 88, lengthMinCm: 64, lengthMaxCm: 66, shoulderMinCm: 41, shoulderMaxCm: 43, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'uniqlo', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 96, lengthMinCm: 67, lengthMaxCm: 69, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'uniqlo', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 104, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'uniqlo', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 112, lengthMinCm: 73, lengthMaxCm: 75, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'uniqlo', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 120, lengthMinCm: 76, lengthMaxCm: 78, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── H&M (Regular) ───────────────────────────────────────────────────────────
  { brand: 'hm', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 86, chestMaxCm: 92, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 42, shoulderMaxCm: 44, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'hm', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 94, chestMaxCm: 100, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 44, shoulderMaxCm: 46, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'hm', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 102, chestMaxCm: 108, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 46, shoulderMaxCm: 48, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'hm', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 110, chestMaxCm: 116, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 48, shoulderMaxCm: 50, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── H_M Alias (as used in widget dropdowns) ─────────────────────────────────
  { brand: 'h_m', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 86, chestMaxCm: 92, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 42, shoulderMaxCm: 44, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'h_m', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 94, chestMaxCm: 100, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 44, shoulderMaxCm: 46, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'h_m', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 102, chestMaxCm: 108, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 46, shoulderMaxCm: 48, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'h_m', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 110, chestMaxCm: 116, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 48, shoulderMaxCm: 50, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── LEVIS (Regular) ─────────────────────────────────────────────────────────
  { brand: 'levis', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 94, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levis', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 102, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levis', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 110, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levis', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 118, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── LEVI Alias ─────────────────────────────────────────────────────────────
  { brand: 'levi', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 94, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levi', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 102, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levi', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 110, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'levi', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 118, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── SNITCH (Indian D2C Fit) ─────────────────────────────────────────────────
  { brand: 'snitch', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 94, chestMaxCm: 98, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 44, shoulderMaxCm: 46, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'snitch', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 100, chestMaxCm: 104, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 46, shoulderMaxCm: 48, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'snitch', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 106, chestMaxCm: 110, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 48, shoulderMaxCm: 50, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'snitch', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 116, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 50, shoulderMaxCm: 52, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── BEWAKOOF (Indian D2C Fit) ───────────────────────────────────────────────
  { brand: 'bewakoof', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 92, chestMaxCm: 96, lengthMinCm: 68, lengthMaxCm: 70, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'bewakoof', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 98, chestMaxCm: 102, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'bewakoof', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 108, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'bewakoof', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 110, chestMaxCm: 114, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── ADIDAS (Regular) ────────────────────────────────────────────────────────
  { brand: 'adidas', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 94, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'adidas', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 95, chestMaxCm: 102, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'adidas', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 103, chestMaxCm: 110, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'adidas', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 111, chestMaxCm: 118, lengthMinCm: 76, lengthMaxCm: 78, shoulderMinCm: 49, shoulderMaxCm: 52, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── RALPH LAUREN / POLO (Regular) ───────────────────────────────────────────
  { brand: 'ralph_lauren', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 90, chestMaxCm: 96, lengthMinCm: 69, lengthMaxCm: 71, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'ralph_lauren', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 102, lengthMinCm: 71, lengthMaxCm: 73, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'ralph_lauren', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 102, chestMaxCm: 108, lengthMinCm: 73, lengthMaxCm: 75, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'ralph_lauren', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 108, chestMaxCm: 114, lengthMinCm: 75, lengthMaxCm: 77, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── GAP (Regular) ───────────────────────────────────────────────────────────
  { brand: 'gap', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 94, lengthMinCm: 69, lengthMaxCm: 71, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'gap', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 102, lengthMinCm: 71, lengthMaxCm: 73, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'gap', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 110, lengthMinCm: 73, lengthMaxCm: 75, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'gap', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 118, lengthMinCm: 75, lengthMaxCm: 77, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── LULULEMON (Athletic Fit) ────────────────────────────────────────────────
  { brand: 'lululemon', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 88, chestMaxCm: 94, lengthMinCm: 69, lengthMaxCm: 71, shoulderMinCm: 43, shoulderMaxCm: 45, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'lululemon', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 96, chestMaxCm: 102, lengthMinCm: 71, lengthMaxCm: 73, shoulderMinCm: 45, shoulderMaxCm: 47, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'lululemon', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 110, lengthMinCm: 73, lengthMaxCm: 75, shoulderMinCm: 47, shoulderMaxCm: 49, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'lululemon', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 112, chestMaxCm: 118, lengthMinCm: 75, lengthMaxCm: 77, shoulderMinCm: 49, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },

  // ─── UNDER ARMOUR (Fitted / Athletic) ────────────────────────────────────────
  { brand: 'under_armour', garmentType: 'tshirt', sizeLabel: 'S', chestMinCm: 86, chestMaxCm: 92, lengthMinCm: 70, lengthMaxCm: 72, shoulderMinCm: 42, shoulderMaxCm: 44, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'under_armour', garmentType: 'tshirt', sizeLabel: 'M', chestMinCm: 94, chestMaxCm: 102, lengthMinCm: 72, lengthMaxCm: 74, shoulderMinCm: 44, shoulderMaxCm: 46, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'under_armour', garmentType: 'tshirt', sizeLabel: 'L', chestMinCm: 104, chestMaxCm: 112, lengthMinCm: 74, lengthMaxCm: 76, shoulderMinCm: 46, shoulderMaxCm: 48, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
  { brand: 'under_armour', garmentType: 'tshirt', sizeLabel: 'XL', chestMinCm: 114, chestMaxCm: 122, lengthMinCm: 76, lengthMaxCm: 78, shoulderMinCm: 48, shoulderMaxCm: 51, fitType: 'regular', easeValueCm: 8, easeSource: 'inferred' },
];

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVarsPath = path.join(ROOT, "worker", ".dev.vars");
  if (existsSync(devVarsPath)) {
    const match = readFileSync(devVarsPath, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
    if (match) return match[1];
  }
  const envPath = path.join(ROOT, "shopify-app", ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
    if (match) return match[1];
  }
  throw new Error("DATABASE_URL not set and neither worker/.dev.vars nor shopify-app/.env has a DATABASE_URL entry");
}

const sql = neon(resolveDatabaseUrl());

async function main() {
  console.log("Seeding Neon Database with NIFT Anchors & Reference Brands...");

  // 1. Seed Anthropometric Anchors
  console.log(`Seeding ${ANTHROPOMETRIC_ANCHORS.length} Anthropometric Anchors...`);
  for (const a of ANTHROPOMETRIC_ANCHORS) {
    await sql`
      INSERT INTO anthropometric_anchors (
        garment_type, size_label, chest_body_cm, shoulder_body_cm, height_cm, created_at, updated_at
      ) VALUES (
        ${a.garmentType}, ${a.sizeLabel}, ${String(a.chestBodyCm)}, ${a.shoulderBodyCm ? String(a.shoulderBodyCm) : null}, ${a.heightCm ? String(a.heightCm) : null}, NOW(), NOW()
      )
      ON CONFLICT (garment_type, size_label) DO UPDATE SET
        chest_body_cm = EXCLUDED.chest_body_cm,
        shoulder_body_cm = EXCLUDED.shoulder_body_cm,
        height_cm = EXCLUDED.height_cm,
        updated_at = NOW();
    `;
  }
  console.log("Anthropometric Anchors seeded.");

  // 2. Seed Reference Brand Size Charts
  console.log(`Seeding ${REFERENCE_BRAND_CHARTS.length} Reference Brand Size Charts...`);
  for (const r of REFERENCE_BRAND_CHARTS) {
    await sql`
      INSERT INTO brand_size_charts (
        brand, garment_type, size_label, chest_min_cm, chest_max_cm, length_min_cm, length_max_cm, shoulder_min_cm, shoulder_max_cm, fit_type, ease_value_cm, ease_source, scraped_at
      ) VALUES (
        ${r.brand}, ${r.garmentType}, ${r.sizeLabel}, ${String(r.chestMinCm)}, ${String(r.chestMaxCm)}, ${r.lengthMinCm ? String(r.lengthMinCm) : null}, ${r.lengthMaxCm ? String(r.lengthMaxCm) : null}, ${r.shoulderMinCm ? String(r.shoulderMinCm) : null}, ${r.shoulderMaxCm ? String(r.shoulderMaxCm) : null}, ${r.fitType}, ${String(r.easeValueCm)}, ${r.easeSource}, NOW()
      )
      ON CONFLICT (brand, garment_type, size_label) DO UPDATE SET
        chest_min_cm = EXCLUDED.chest_min_cm,
        chest_max_cm = EXCLUDED.chest_max_cm,
        length_min_cm = EXCLUDED.length_min_cm,
        length_max_cm = EXCLUDED.length_max_cm,
        shoulder_min_cm = EXCLUDED.shoulder_min_cm,
        shoulder_max_cm = EXCLUDED.shoulder_max_cm,
        fit_type = EXCLUDED.fit_type,
        ease_value_cm = EXCLUDED.ease_value_cm,
        ease_source = EXCLUDED.ease_source,
        scraped_at = NOW();
    `;
  }
  console.log("Reference Brand Size Charts seeded.");

  const [anchorsCount] = await sql`SELECT count(*) as count FROM anthropometric_anchors;`;
  const [brandsCount] = await sql`SELECT count(*) as count FROM brand_size_charts;`;
  console.log(`DB Status: ${anchorsCount.count} anchors, ${brandsCount.count} reference brand size rows in Postgres.`);
}

main()
  .then(() => {
    console.log("Seeding complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
