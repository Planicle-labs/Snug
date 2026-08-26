import { neon } from "@neondatabase/serverless";
import { ANTHROPOMETRIC_ANCHORS, REFERENCE_BRAND_CHARTS } from "./reference_data";

function getDatabaseUrl(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL environment variable is required for seeding.");
  }
  return dbUrl;
}

const sql = neon(getDatabaseUrl());

export async function seedDatabase() {
  console.log("Starting Database Seeding...");

  // 1. Seed Anthropometric Anchors
  console.log(`Seeding ${ANTHROPOMETRIC_ANCHORS.length} Anthropometric Anchors...`);
  for (const anchor of ANTHROPOMETRIC_ANCHORS) {
    await sql`
      INSERT INTO anthropometric_anchors (
        garment_type, size_label, chest_body_cm, shoulder_body_cm, height_cm, created_at, updated_at
      ) VALUES (
        ${anchor.garmentType}, ${anchor.sizeLabel}, ${String(anchor.chestBodyCm)}, ${anchor.shoulderBodyCm ? String(anchor.shoulderBodyCm) : null}, ${anchor.heightCm ? String(anchor.heightCm) : null}, NOW(), NOW()
      )
      ON CONFLICT (garment_type, size_label) DO UPDATE SET
        chest_body_cm = EXCLUDED.chest_body_cm,
        shoulder_body_cm = EXCLUDED.shoulder_body_cm,
        height_cm = EXCLUDED.height_cm,
        updated_at = NOW();
    `;
  }
  console.log("Anthropometric Anchors seeded successfully.");

  // 2. Seed Reference Brand Size Charts
  console.log(`Seeding ${REFERENCE_BRAND_CHARTS.length} Reference Brand Size Charts...`);
  for (const row of REFERENCE_BRAND_CHARTS) {
    await sql`
      INSERT INTO brand_size_charts (
        brand, garment_type, size_label, chest_min_cm, chest_max_cm, length_min_cm, length_max_cm, shoulder_min_cm, shoulder_max_cm, fit_type, ease_value_cm, ease_source, scraped_at
      ) VALUES (
        ${row.brand}, ${row.garmentType}, ${row.sizeLabel}, ${String(row.chestMinCm)}, ${String(row.chestMaxCm)}, ${row.lengthMinCm ? String(row.lengthMinCm) : null}, ${row.lengthMaxCm ? String(row.lengthMaxCm) : null}, ${row.shoulderMinCm ? String(row.shoulderMinCm) : null}, ${row.shoulderMaxCm ? String(row.shoulderMaxCm) : null}, ${row.fitType}, ${String(row.easeValueCm)}, ${row.easeSource}, NOW()
      )
      ON CONFLICT (brand, garment_type, fit_type, size_label) DO UPDATE SET
        chest_min_cm = EXCLUDED.chest_min_cm,
        chest_max_cm = EXCLUDED.chest_max_cm,
        length_min_cm = EXCLUDED.length_min_cm,
        length_max_cm = EXCLUDED.length_max_cm,
        shoulder_min_cm = EXCLUDED.shoulder_min_cm,
        shoulder_max_cm = EXCLUDED.shoulder_max_cm,
        ease_value_cm = EXCLUDED.ease_value_cm,
        ease_source = EXCLUDED.ease_source,
        scraped_at = NOW();
    `;
  }
  console.log("Reference Brand Size Charts seeded successfully.");
}

// Run directly if invoked as script
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("seed_db")) {
  seedDatabase()
    .then(() => {
      console.log("Database seeding completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Database seeding failed:", err);
      process.exit(1);
    });
}
