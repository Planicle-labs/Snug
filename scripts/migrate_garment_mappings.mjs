import { neon } from "../shopify-app/node_modules/@neondatabase/serverless/index.mjs";
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
  console.log("Running Database Schema Migration for garment_mappings...");

  // 1. Add fit_type column if it doesn't exist
  await sql`
    ALTER TABLE garment_mappings 
    ADD COLUMN IF NOT EXISTS fit_type text DEFAULT 'regular' NOT NULL;
  `;
  console.log("Added 'fit_type' column to garment_mappings.");

  // 2. Add fit_type check constraint if it doesn't exist
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'garment_mappings_fit_type_check'
      ) THEN
        ALTER TABLE garment_mappings 
        ADD CONSTRAINT garment_mappings_fit_type_check 
        CHECK (fit_type IN ('slim', 'regular', 'oversized'));
      END IF;
    END $$;
  `;
  console.log("Added 'garment_mappings_fit_type_check' constraint.");

  // 3. Drop chart_override_id column if present
  await sql`
    ALTER TABLE garment_mappings 
    DROP COLUMN IF EXISTS chart_override_id;
  `;
  console.log("Dropped deprecated 'chart_override_id' column.");

  // 4. Verify updated garment_mappings columns
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'garment_mappings';
  `;
  console.log("Updated garment_mappings columns:", cols.map(c => c.column_name).join(", "));
}

main()
  .then(() => {
    console.log("Migration completed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
