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
  const columns = await sql`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `;

  const tables = {};
  for (const c of columns) {
    if (!tables[c.table_name]) tables[c.table_name] = [];
    tables[c.table_name].push(c.column_name);
  }

  console.log("Current Postgres DB Table Columns:");
  for (const [t, cols] of Object.entries(tables)) {
    console.log(`  ${t}: ${cols.join(", ")}`);
  }
}

main().catch(console.error);
