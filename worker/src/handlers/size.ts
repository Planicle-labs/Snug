import type { Context } from 'hono'
import type { AppEnv } from '../index'

import { predictSize } from '../algorithm/sizing'
import { consumeTrialQuota, checkpointTrialUsage } from '../middleware/rateLimit'
import { logUsageEvent } from '../persistence'
import { parsePredictRequest, parseProductMappings, parseReferenceChart, parseTargetChart } from '../validation'

export async function handleSizePrediction(ctx: Context<AppEnv>) {
  const startedAt = Date.now()
  const body = parsePredictRequest(await ctx.req.json().catch(() => null))
  if (!body) {
    return ctx.json({
      error: 'Bad Request',
      message: 'Expected non-empty ref_brand, ref_garment, ref_size, and shopify_product_id strings; fit_intent must be true_silhouette or fitted when provided',
    }, 400)
  }

  const org = ctx.var.org
  const mappingsRaw = await ctx.env.KV.get(`merchant:${org.org_id}:mappings`, 'json')
  if (mappingsRaw === null) {
    return ctx.json({ error: 'Not Found', message: 'This product is not mapped to an active merchant size chart' }, 404)
  }

  const productMappings = parseProductMappings(mappingsRaw)
  if (!productMappings) {
    return ctx.json({ error: 'Unprocessable Entity', message: 'Merchant product mappings are malformed; refresh the configuration' }, 422)
  }

  const productMapping = productMappings[body.shopify_product_id]
  if (!productMapping || !productMapping.is_active) {
    return ctx.json({ error: 'Not Found', message: 'This product is not mapped to an active merchant size chart' }, 404)
  }

  const [referenceRaw, targetRaw] = await Promise.all([
    ctx.env.KV.get(`brand:${body.ref_brand}:${body.ref_garment}`, 'json'),
    ctx.env.KV.get(`chart:${org.org_id}:${productMapping.garment_type}`, 'json'),
  ])

  if (referenceRaw === null) {
    return ctx.json({ error: 'Not Found', message: `Reference brand size chart '${body.ref_brand}' for '${body.ref_garment}' is not supported` }, 404)
  }
  if (targetRaw === null) {
    return ctx.json({ error: 'Not Found', message: `Merchant size chart for '${productMapping.garment_type}' was not found` }, 404)
  }

  const referenceChart = parseReferenceChart(referenceRaw)
  const targetChart = parseTargetChart(targetRaw)
  if (!referenceChart || !targetChart) {
    return ctx.json({ error: 'Unprocessable Entity', message: 'A configured size chart contains invalid measurements or mixed fit types' }, 422)
  }

  const refSizeRow = referenceChart.find((row) => row.size_label.toUpperCase() === body.ref_size)
  if (!refSizeRow) {
    return ctx.json({ error: 'Not Found', message: `Size '${body.ref_size}' for brand '${body.ref_brand}' and garment '${body.ref_garment}' was not found` }, 404)
  }

  // Charts are already sorted S→XL by parse*; ease is inferred from fit_type inside the engine.
  const prediction = predictSize({
    refSizeRow,
    targetChart: targetChart.rows,
    targetFitType: targetChart.fitType,
    ...(body.fit_intent !== undefined ? { fitIntent: body.fit_intent } : {}),
  })

  let quota
  try {
    quota = await consumeTrialQuota(ctx.env, org)
  } catch (error) {
    console.error(JSON.stringify({ event: 'quota_check_failed', orgId: org.org_id, message: error instanceof Error ? error.message : 'Unknown error' }))
    return ctx.json({ error: 'Internal Error', message: 'Unable to verify usage quota' }, 500)
  }

  if (!quota.allowed) {
    return ctx.json({ error: 'Too Many Requests', message: 'Trial quota exhausted. Please upgrade to a paid plan.' }, 429)
  }

  const checkpoint = checkpointTrialUsage(ctx.env, org.org_id, quota)
  if (checkpoint) ctx.executionCtx.waitUntil(checkpoint)

  ctx.executionCtx.waitUntil(logUsageEvent(ctx.env.DATABASE_URL, {
    orgId: org.org_id,
    refBrand: body.ref_brand,
    refGarment: body.ref_garment,
    refSize: body.ref_size,
    predictedSize: prediction.predicted_size,
    confidence: prediction.confidence,
    isBoundaryCase: prediction.is_boundary_case,
    responseMs: Date.now() - startedAt,
  }))

  return ctx.json(prediction, 200)
}
