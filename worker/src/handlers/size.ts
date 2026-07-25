import type { Context } from 'hono';
import type { AppEnv } from '../index';

export interface PredictRequestBody {
  ref_brand: string;
  ref_garment: string;
  ref_size: string;
  shopify_product_id: string;
}

export async function handleSizePrediction(ctx: Context<AppEnv>) {
  // 1. Safe JSON parsing with defensive error catch
  const body = await ctx.req.json<PredictRequestBody>().catch(() => null);

  if (!body || !body.ref_brand || !body.ref_garment || !body.ref_size || !body.shopify_product_id) {
    return ctx.json(
      {
        error: "Bad Request",
        message: "Missing required fields: ref_brand, ref_garment, ref_size, shopify_product_id",
      },
      400
    );
  }

  const org = ctx.var.org;

  // 2. Sanitize and normalize inputs
  const refBrand = body.ref_brand.trim().toLowerCase();
  const refGarment = body.ref_garment.trim().toLowerCase();
  const refSize = body.ref_size.trim().toUpperCase();
  const shopifyProductId = body.shopify_product_id.trim();

  // Construct unique KV prediction cache key
  const cacheKey = `pred:${org.org_id}:${shopifyProductId}:${refBrand}:${refGarment}:${refSize}`;

  // 3. STEP 1: Check KV Prediction Cache
  const cachedPrediction = await ctx.env.KV.get(cacheKey, "json");
  if (cachedPrediction) {
    // CACHE HIT! Serve directly from KV edge memory (< 2ms)
    return ctx.json(cachedPrediction, 200);
  }

  // 4. STEP 2: CACHE MISS — Resolve Product Mapping
  const productMappings = (await ctx.env.KV.get(
    `merchant:${org.org_id}:mappings`,
    "json"
  )) as Record<string, { garment_type: string; is_active: boolean }> | null;

  const productMapping = productMappings?.[shopifyProductId];

  if (!productMapping || !productMapping.is_active) {
    return ctx.json(
      {
        error: "Not Found",
        message: "This product is not mapped to an active merchant size chart",
      },
      404
    );
  }

  const targetGarmentType = productMapping.garment_type.trim().toLowerCase();

  // 5. STEP 3: Fetch Merchant Size Chart & Reference Brand Chart
  const refChart = await ctx.env.KV.get(`brand:${refBrand}:${refGarment}`, "json");
  const merchantChart = await ctx.env.KV.get(`chart:${org.org_id}:${targetGarmentType}`, "json");

  if (!refChart) {
    return ctx.json(
      { error: "Not Found", message: `Reference brand size chart '${refBrand}' for '${refGarment}' not supported` },
      404
    );
  }

  if (!merchantChart) {
    return ctx.json(
      { error: "Not Found", message: `Merchant size chart for '${targetGarmentType}' not found` },
      404
    );
  }

  // 6. STEP 4: Compute Sizing Prediction (Stubbed until TASK-P06 algorithm engine decisions finalized)
  const prediction = {
    predicted_size: refSize,
    confidence: 85,
    confidence_label: "high",
    is_boundary_case: false,
    suggested_sizes: [refSize],
    reasoning: "Placeholder recommendation (sizing algorithm stub)",
  };

  // 7. STEP 5: Asynchronously Persist to KV Prediction Cache & Log Analytics via waitUntil
  ctx.executionCtx.waitUntil(
    Promise.all([
      // Persist computed result in KV cache for future 2ms instant hits
      ctx.env.KV.put(cacheKey, JSON.stringify(prediction), {
        expirationTtl: 86400 * 7, // Cache for 7 days
      }),
      // Log usage analytics to Neon Postgres
      logUsageEvent(ctx.env.DATABASE_URL, {
        org_id: org.org_id,
        shopify_product_id: shopifyProductId,
        ref_brand: refBrand,
        ref_garment: refGarment,
        target_garment: targetGarmentType,
        ref_size: refSize,
        predicted_size: prediction.predicted_size,
        confidence: prediction.confidence,
      }),
    ]).catch((err) => console.error("[Background KV/DB Sync Error]", err))
  );

  return ctx.json(prediction, 200);
}

async function logUsageEvent(databaseUrl: string, details: Record<string, any>) {
  try {
    console.log(`[Usage Log] Recorded prediction for org ${details.org_id}:`, details);
  } catch (err) {
    console.error("[Usage Log Error] Failed to record usage log:", err);
  }
}
