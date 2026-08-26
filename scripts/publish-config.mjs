#!/usr/bin/env node
/**
 * Publishes merchant app-config from Postgres to Cloudflare KV, mirroring the
 * payload shapes written by shopify-app/app/lib/kv.server.ts and seed-kv.ts.
 *
 * The dashboard routes call these writers on save, but they no-op without
 * CLOUDFLARE_* credentials, and reference brand charts have no UI path at all.
 * This script is the deterministic bridge used for environments where the
 * dashboard cannot sync (fresh installs, CI, local dev against wrangler dev).
 *
 * Usage:
 *   node scripts/publish-config.mjs            # production KV namespace
 *   node scripts/publish-config.mjs --local    # wrangler dev local KV state
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER_DIR = path.join(ROOT, 'worker')
const WRANGLER_BIN = path.join(WORKER_DIR, 'node_modules', '.bin', 'wrangler')
const LOCAL = process.argv.includes('--local')

const NAMESPACE_ID = '9adf9e3534794fc58cd25ce4f225c465'
const PREVIEW_NAMESPACE_ID = '76761b47b9b54f689f6e32e22f5ad6db'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const devVarsPath = path.join(WORKER_DIR, '.dev.vars')
  if (existsSync(devVarsPath)) {
    const match = readFileSync(devVarsPath, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)
    if (match) return match[1]
  }
  throw new Error('DATABASE_URL not set and worker/.dev.vars has no DATABASE_URL entry')
}

function num(value) {
  return value === null || value === undefined ? null : Number(value)
}

function cleanProductId(rawId) {
  return String(rawId).replace(/^gid:\/\/shopify\/Product\//, '')
}

async function loadConfig() {
  const sql = neon(resolveDatabaseUrl())

  const [org] = await sql`
    SELECT id, shop, api_key, plan_tier, trial_requests_remaining, widget_active
    FROM organizations
    WHERE widget_active = true AND api_key IS NOT NULL
    ORDER BY installed_at DESC
    LIMIT 1
  `
  if (!org) throw new Error('No active organization with an API key found in organizations table')

  const charts = await sql`
    SELECT garment_type, fit_type, size_label, chest_min_cm, chest_max_cm,
           length_min_cm, length_max_cm, shoulder_min_cm, shoulder_max_cm,
           ease_value_cm, ease_source, extra_measurements
    FROM fit_size_charts
    WHERE org_id = ${org.id}
  `

  const mappings = await sql`
    SELECT shopify_product_id, garment_type, fit_type
    FROM garment_mappings
    WHERE org_id = ${org.id}
  `

  const brandCharts = await sql`
    SELECT brand, garment_type, fit_type, size_label, chest_min_cm, chest_max_cm,
           length_min_cm, length_max_cm, shoulder_min_cm, shoulder_max_cm,
           ease_value_cm, ease_source
    FROM brand_size_charts
  `

  const [widgetConfig] = await sql`
    SELECT position, config
    FROM widget_configs
    WHERE org_id = ${org.id}
    LIMIT 1
  `

  return { org, charts, mappings, brandCharts, widgetConfig }
}

/**
 * Mirrors pushApiKeyToKV + pushChartToKV + pushMappingsToKV + pushReferenceBrandsToKV + pushWidgetConfigToKV.
 */
export function buildKvRecords({ org, charts, mappings, brandCharts, widgetConfig }) {
  const records = []

  records.push([`apikey:${org.api_key}`, {
    org_id: org.id,
    shop: org.shop,
    plan_tier: org.plan_tier,
    trial_requests_remaining: org.trial_requests_remaining,
    widget_active: org.widget_active,
    api_key: org.api_key,
  }])

  records.push([`shop:${org.shop}`, { org_id: org.id, api_key: org.api_key }])

  if (widgetConfig) {
    const cfg = typeof widgetConfig.config === 'string' ? JSON.parse(widgetConfig.config) : (widgetConfig.config || {})
    records.push([`widget_config:${org.id}`, {
      position: widgetConfig.position || cfg.position || 'below_add_to_cart',
      button_text: cfg.buttonText || cfg.button_text || 'Find Your Recommended Size',
      button_color: cfg.buttonColor || cfg.primaryColor || cfg.button_color || '#008060',
      button_text_color: cfg.buttonTextColor || cfg.button_text_color || '#ffffff',
      modal_position: cfg.modalPosition || cfg.modal_position || 'center',
      show_confidence: typeof cfg.showConfidence === 'boolean' ? cfg.showConfidence : (typeof cfg.show_confidence === 'boolean' ? cfg.show_confidence : true),
      show_reasoning: typeof cfg.showReasoning === 'boolean' ? cfg.showReasoning : (typeof cfg.show_reasoning === 'boolean' ? cfg.show_reasoning : true),
    }])
  }

  const mappingPayload = {}
  for (const m of mappings) {
    const rawId = String(m.shopify_product_id)
    const record = {
      garment_type: m.garment_type,
      fit_type: m.fit_type,
      is_active: true,
    }
    mappingPayload[rawId] = record
    mappingPayload[cleanProductId(rawId)] = record
  }
  if (Object.keys(mappingPayload).length > 0) {
    records.push([`merchant:${org.id}:mappings`, mappingPayload])
  }

  const chartGroups = new Map()
  for (const c of charts) {
    const groupKey = `${c.garment_type}:${c.fit_type}`
    if (!chartGroups.has(groupKey)) chartGroups.set(groupKey, [])
    const extra = typeof c.extra_measurements === 'string'
      ? JSON.parse(c.extra_measurements)
      : (c.extra_measurements ?? {})
    chartGroups.get(groupKey).push({
      size_label: c.size_label,
      fit_type: c.fit_type,
      chest_min_cm: num(c.chest_min_cm),
      chest_max_cm: num(c.chest_max_cm),
      length_min_cm: num(c.length_min_cm),
      length_max_cm: num(c.length_max_cm),
      shoulder_min_cm: num(c.shoulder_min_cm),
      shoulder_max_cm: num(c.shoulder_max_cm),
      ease_value_cm: num(c.ease_value_cm),
      ease_source: c.ease_source,
      guide_gender: extra.guideGender ?? 'unisex',
      show_size_guide: Boolean(extra.showOnStorefront),
    })
  }
  // Same ordering contract as pushChartToKV: normalized body-measurement order.
  const byBodyMid = (a, b) =>
    (a.chest_min_cm + a.chest_max_cm) / 2 - a.ease_value_cm -
    ((b.chest_min_cm + b.chest_max_cm) / 2 - b.ease_value_cm)
  for (const [groupKey, rows] of chartGroups) {
    records.push([`chart:${org.id}:${groupKey}`, [...rows].sort(byBodyMid)])
  }

  const brandGroups = new Map()
  for (const r of brandCharts) {
    const groupKey = `${r.brand}:${r.garment_type}:${r.fit_type}`
    if (!brandGroups.has(groupKey)) brandGroups.set(groupKey, [])
    brandGroups.get(groupKey).push({
      size_label: r.size_label,
      fit_type: r.fit_type,
      chest_min_cm: num(r.chest_min_cm),
      chest_max_cm: num(r.chest_max_cm),
      length_min_cm: num(r.length_min_cm),
      length_max_cm: num(r.length_max_cm),
      shoulder_min_cm: num(r.shoulder_min_cm),
      shoulder_max_cm: num(r.shoulder_max_cm),
      ease_value_cm: num(r.ease_value_cm),
      ease_source: r.ease_source,
    })
  }
  // Same grouping and midpoint ordering as pushReferenceBrandsToKV.
  for (const [groupKey, rows] of brandGroups) {
    const sorted = [...rows].sort((a, b) =>
      (a.chest_min_cm + a.chest_max_cm) / 2 - (b.chest_min_cm + b.chest_max_cm) / 2
    )
    records.push([`brand:${groupKey}`, sorted])
  }

  return records
}

function putKvRecord(key, value, targetNamespaceIds) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'snug-kv-'))
  const valueFile = path.join(tempDir, 'value.json')
  writeFileSync(valueFile, typeof value === 'string' ? value : JSON.stringify(value))

  try {
    for (const namespaceId of targetNamespaceIds) {
      const args = ['kv', 'key', 'put', key, '--path', valueFile, '--namespace-id', namespaceId]
      // Wrangler 4 defaults kv commands to local state; make the target explicit.
      args.push(LOCAL ? '--local' : '--remote')
      const result = spawnSync(WRANGLER_BIN, args, { cwd: WORKER_DIR, encoding: 'utf8' })
      if (result.status !== 0) {
        process.stderr.write(result.stderr || result.stdout || `wrangler exited ${result.status}\n`)
        return false
      }
    }
    return true
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  console.log(`Publishing app-config to ${LOCAL ? 'LOCAL wrangler dev KV' : 'PRODUCTION KV'}...`)
  const config = await loadConfig()

  const orgSummary = `${config.org.shop} (${config.org.plan_tier}, widget_active=${config.org.widget_active})`
  console.log(`  organization : ${orgSummary}`)
  console.log(`  size charts  : ${config.charts.length} rows`)
  console.log(`  mappings     : ${config.mappings.length} products`)
  console.log(`  brand charts : ${config.brandCharts.length} reference rows`)

  const records = buildKvRecords(config)
  const targets = LOCAL ? [PREVIEW_NAMESPACE_ID] : [NAMESPACE_ID]

  let ok = 0
  for (const [key, value] of records) {
    const success = putKvRecord(key, value, targets)
    console.log(`  ${success ? 'PUT' : 'FAILED'}  ${key} (${JSON.stringify(value).length} bytes)`)
    if (success) ok++
  }

  console.log(`\n${ok}/${records.length} keys published.`)
  if (ok !== records.length) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Publish failed:', err.message)
    process.exit(1)
  })
}
