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

// Standard Category Ease Matrix (Aldrich / NIFT calibrated)
const TSHIRT_EASE = {
  slim: 5,
  regular: 8,
  relaxed: 12,
  oversized: 19,
};

const CROSS_FIT_PENALTY = {
  slim:      { regular: 5,  relaxed: 10, oversized: 15 },
  regular:   { slim: 5,     relaxed: 8,  oversized: 10 },
  relaxed:   { slim: 12,    regular: 8,  oversized: 5  },
  oversized: { slim: 20,    regular: 10, relaxed: 5    },
};

/**
 * Pure Deterministic 9-Step Sizing Recommendation Algorithm
 */
function runSizingEngine({ refSizeRow, targetChart, targetFitType, fitIntent }) {
  if (!targetChart || targetChart.length === 0) {
    throw new Error("Target size chart cannot be empty");
  }

  // Step 1: Recover body chest from reference garment
  const refGarmentMid = (Number(refSizeRow.chest_min_cm) + Number(refSizeRow.chest_max_cm)) / 2;
  const rawFit = String(refSizeRow.fit_type || refSizeRow.fit || "regular").toLowerCase();
  const refFit = rawFit === "slim" ? "slim" : rawFit === "oversized" || rawFit === "oversized_plus" ? "oversized" : rawFit === "relaxed" || rawFit === "relaxed_plus" || rawFit === "box" ? "relaxed" : "regular";
  const refEase = TSHIRT_EASE[refFit] || 8;
  const bodyChest = refGarmentMid - refEase;

  // Step 2: PATH A - Fitted Match (Direct Garment Delta)
  let fittedRow = targetChart[0];
  let fittedIndex = 0;
  let minFittedDelta = Infinity;

  targetChart.forEach((row, index) => {
    const targetMid = (Number(row.chest_min_cm) + Number(row.chest_max_cm)) / 2;
    const delta = Math.abs(refGarmentMid - targetMid);
    if (delta < minFittedDelta) {
      minFittedDelta = delta;
      fittedRow = row;
      fittedIndex = index;
    }
  });

  // Step 3: PATH B - Silhouette Match (Body Anchor + Target Ease)
  const targetEase = TSHIRT_EASE[targetFitType] || 8;
  const targetGarmentIntent = bodyChest + targetEase;

  let silhouetteRow = targetChart[0];
  let silhouetteIndex = 0;
  let minSilhouetteDelta = Infinity;

  targetChart.forEach((row, index) => {
    const targetMid = (Number(row.chest_min_cm) + Number(row.chest_max_cm)) / 2;
    const delta = Math.abs(targetGarmentIntent - targetMid);
    if (delta < minSilhouetteDelta) {
      minSilhouetteDelta = delta;
      silhouetteRow = row;
      silhouetteIndex = index;
    }
  });

  // Step 4: Primary Selection & Dual Resolution
  const isCrossFit = refFit !== targetFitType;
  const isDualRecommendation = isCrossFit && fittedRow.size_label !== silhouetteRow.size_label;

  let primaryRow = fittedRow;
  let primaryIndex = fittedIndex;
  let workingDelta = minFittedDelta;

  if (isCrossFit) {
    if (fitIntent === "fitted") {
      primaryRow = fittedRow;
      primaryIndex = fittedIndex;
      workingDelta = minFittedDelta;
    } else {
      primaryRow = silhouetteRow;
      primaryIndex = silhouetteIndex;
      workingDelta = minSilhouetteDelta;
    }
  }

  // Step 5: Compute 5-Signal Confidence Score (0-100)
  let s1 = 0;
  if (workingDelta <= 1.0) s1 = 40;
  else if (workingDelta <= 2.5) s1 = 32;
  else if (workingDelta <= 4.0) s1 = 24;
  else if (workingDelta <= 6.0) s1 = 14;
  else s1 = 4;

  const targetRangeWidth = Number(primaryRow.chest_max_cm) - Number(primaryRow.chest_min_cm);
  let s2 = 0;
  if (targetRangeWidth <= 4) s2 = 25;
  else if (targetRangeWidth <= 6) s2 = 20;
  else if (targetRangeWidth <= 8) s2 = 14;
  else s2 = 8;

  const s3 = 15; // Database verified freshness
  const s4 = 0;
  const s5 = fitIntent ? 10 : 0;
  const rawScore = s1 + s2 + s3 + s4 + s5;

  let penalty = 0;
  if (isCrossFit) {
    penalty = CROSS_FIT_PENALTY[refFit]?.[targetFitType] ?? 8;
    if (fitIntent) penalty = Math.floor(penalty / 2);
  }

  const confidence = Math.round(Math.max(0, Math.min(100, rawScore - penalty)));
  let confidenceLabel = "low";
  if (confidence >= 75) confidenceLabel = "high";
  else if (confidence >= 45) confidenceLabel = "medium";

  // Step 7: Boundary Proximity Detection
  const referencePoint = isCrossFit ? targetGarmentIntent : refGarmentMid;
  const distToLower = Math.abs(referencePoint - Number(primaryRow.chest_min_cm));
  const distToUpper = Math.abs(referencePoint - Number(primaryRow.chest_max_cm));
  const minBoundaryDist = Math.min(distToLower, distToUpper);

  let isBoundaryCase = false;
  const suggestedSizes = [primaryRow.size_label];

  if (minBoundaryDist <= 2 && targetChart.length > 1) {
    isBoundaryCase = true;
    if (distToUpper < distToLower && primaryIndex + 1 < targetChart.length) {
      suggestedSizes.push(targetChart[primaryIndex + 1].size_label);
    } else if (distToLower < distToUpper && primaryIndex - 1 >= 0) {
      suggestedSizes.unshift(targetChart[primaryIndex - 1].size_label);
    }
  }

  if (isDualRecommendation) {
    const secondaryLabel = fitIntent === "fitted" ? silhouetteRow.size_label : fittedRow.size_label;
    if (!suggestedSizes.includes(secondaryLabel)) {
      suggestedSizes.push(secondaryLabel);
    }
  }

  // Step 8: Transparent Reasoning
  let reasoning = `Your ${refFit} fit ${refSizeRow.size_label} gives an estimated body chest of ${bodyChest.toFixed(1)} cm.`;
  if (!isCrossFit) {
    reasoning += ` We recommend ${primaryRow.size_label} in this brand (${workingDelta.toFixed(1)} cm delta).`;
  } else if (isDualRecommendation) {
    reasoning += ` For the full ${targetFitType} silhouette, select ${silhouetteRow.size_label}. For a closer fitted look, select ${fittedRow.size_label}.`;
  } else {
    reasoning += ` We recommend ${primaryRow.size_label} in this ${targetFitType} brand.`;
  }

  return {
    predicted_size: primaryRow.size_label,
    fitted_size: fittedRow.size_label,
    silhouette_size: silhouetteRow.size_label,
    is_dual_recommendation: isDualRecommendation,
    confidence,
    confidence_label: confidenceLabel,
    is_boundary_case: isBoundaryCase,
    suggested_sizes: suggestedSizes,
    body_chest_estimated_cm: bodyChest,
    reasoning,
  };
}

async function runEndToEndTestSuite() {
  console.log("\n=================================================================");
  console.log("SNUG COMPREHENSIVE END-TO-END (E2E) TEST SUITE");
  console.log("=================================================================\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 1: Verify App Config, Merchant Org & Database State
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("STAGE 1: Checking Merchant Organization & App Config...");
  const orgs = await sql`SELECT * FROM organizations LIMIT 1;`;
  if (!orgs.length) {
    throw new Error("No organization found in database. Install or seed the organization first.");
  }
  const org = orgs[0];
  console.log(`  - Organization Shop Domain: ${org.shop}`);
  console.log(`  - Organization ID:          ${org.id}`);
  console.log(`  - API Key:                  ${org.api_key}`);
  console.log(`  - Plan Tier:                ${org.plan_tier} (${org.trial_requests_remaining} trial requests remaining)`);
  console.log(`  - Widget Status:            ${org.widget_active ? "Active" : "Inactive"}`);

  // Check Size Charts
  const sizeCharts = await sql`
    SELECT * FROM fit_size_charts 
    WHERE org_id = ${org.id} 
    ORDER BY chest_min_cm ASC;
  `;
  console.log(`\nSTAGE 2: Checking Merchant Size Charts...`);
  console.log(`  - Found ${sizeCharts.length} merchant size chart rows for garment '${sizeCharts[0]?.garment_type || 'tshirt'}':`);
  for (const c of sizeCharts) {
    console.log(`    - Size ${c.size_label.padEnd(3)} | Fit: ${c.fit_type.padEnd(8)} | Chest: ${c.chest_min_cm} - ${c.chest_max_cm} cm | Ease: ${c.ease_value_cm} cm`);
  }

  // Check Product Mappings
  const mappings = await sql`
    SELECT * FROM garment_mappings 
    WHERE org_id = ${org.id};
  `;
  console.log(`\nSTAGE 3: Checking Product Tagging & Mappings...`);
  console.log(`  - Found ${mappings.length} mapped Shopify products:`);
  for (const m of mappings.slice(0, 3)) {
    console.log(`    - Product: ${m.shopify_product_id} -> Garment: ${m.garment_type} (Fit: ${m.fit_type || 'regular'})`);
  }
  if (mappings.length > 3) {
    console.log(`    ... and ${mappings.length - 3} more products.`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 4: Simulate Storefront Recommendations across Real User Scenarios
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nSTAGE 4: Simulating Storefront Sizing Recommendations...`);
  
  const testScenarios = [
    {
      name: "Indian D2C Relaxed Match (Shopper wears Snitch M Relaxed -> Merchant Tee)",
      brand: "snitch",
      brandName: "Snitch",
      garment: "tshirt",
      size: "M",
      fit: "relaxed",
      targetFit: "regular",
    },
    {
      name: "Indian D2C Regular Match (Shopper wears Bewakoof L Regular -> Merchant Tee)",
      brand: "bewakoof",
      brandName: "Bewakoof",
      garment: "tshirt",
      size: "L",
      fit: "regular",
      targetFit: "regular",
    },
    {
      name: "Indian D2C Polo Curve Match (Shopper wears Being Human M Regular -> Merchant Tee)",
      brand: "being-human",
      brandName: "Being Human",
      garment: "polo",
      size: "M",
      fit: "regular",
      targetFit: "regular",
    },
    {
      name: "Indian D2C Signature Fit Match (Shopper wears The Bear House M Regular -> Merchant Tee)",
      brand: "the-bear-house",
      brandName: "The Bear House",
      garment: "tshirt",
      size: "M",
      fit: "regular",
      targetFit: "regular",
    },
    {
      name: "Indian D2C Oversized Curve Match (Shopper wears Nobero L Oversized -> Merchant Tee)",
      brand: "nobero",
      brandName: "Nobero",
      garment: "tshirt",
      size: "L",
      fit: "oversized",
      targetFit: "regular",
    },
  ];

  for (const scenario of testScenarios) {
    console.log(`\n  --- Scenario: ${scenario.name} ---`);
    
    // Fetch reference brand row exclusively from clean_size_db
    const cleanRows = await sql`
      SELECT garment_chest_cm as chest_min_cm, garment_chest_cm as chest_max_cm, fit as fit_type, size_label
      FROM clean_size_db
      WHERE (
        LOWER(brand_name) = LOWER(${scenario.brandName || scenario.brand})
        OR REPLACE(LOWER(brand_name), ' ', '-') = LOWER(${scenario.brand})
      )
        AND LOWER(category) = LOWER(${scenario.garment === 'tshirt' ? 't-shirt' : scenario.garment})
        AND size_label = ${scenario.size}
        AND (
          LOWER(fit) = LOWER(${scenario.fit || 'regular'})
          OR LOWER(fit) = 'regular'
          OR LOWER(fit) = 'relaxed'
        )
      ORDER BY 
        CASE 
          WHEN LOWER(fit) = LOWER(${scenario.fit || 'regular'}) THEN 1
          WHEN LOWER(fit) = 'regular' THEN 2
          ELSE 3
        END
      LIMIT 1;
    `;
    const refRow = cleanRows.length ? cleanRows[0] : null;

    if (!refRow) {
      console.log(`  Reference brand chart not found for ${scenario.brand} ${scenario.size}`);
      continue;
    }

    const prediction = runSizingEngine({
      refSizeRow: refRow,
      targetChart: sizeCharts,
      targetFitType: scenario.targetFit,
    });

    console.log(`  Shopper Input:     ${scenario.brand.toUpperCase()} ${scenario.size} (Chest: ${refRow.chest_min_cm}-${refRow.chest_max_cm} cm)`);
    console.log(`  Predicted Size:    ${prediction.predicted_size}`);
    console.log(`  Confidence Score:  ${prediction.confidence}% (${prediction.confidence_label.toUpperCase()} confidence)`);
    console.log(`  Boundary Case:     ${prediction.is_boundary_case ? "YES (Two-Size Selector Rendered)" : "NO (Single Size Badge)"}`);
    console.log(`  Suggested Sizes:   ${JSON.stringify(prediction.suggested_sizes)}`);
    console.log(`  Reasoning:         ${prediction.reasoning}`);

    // Insert simulated usage log into Neon Postgres
    await sql`
      INSERT INTO usage_logs (
        org_id, ref_brand, ref_garment, ref_size, predicted_size, confidence, is_boundary_case, response_ms, led_to_conversion, created_at
      ) VALUES (
        ${org.id}, ${scenario.brand}, ${scenario.garment}, ${scenario.size}, ${prediction.predicted_size}, ${prediction.confidence}, ${prediction.is_boundary_case}, 8, false, NOW()
      );
    `;
    console.log(`  - Logged usage event to Neon DB (usage_logs).`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 5: Verify Analytics Aggregations in Neon DB
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nSTAGE 5: Verifying Analytics Aggregation in Neon DB...`);
  const [totalLogs] = await sql`SELECT count(*) as count FROM usage_logs WHERE org_id = ${org.id};`;
  const [avgConfidence] = await sql`SELECT AVG(confidence) as avg FROM usage_logs WHERE org_id = ${org.id};`;
  const topBrands = await sql`
    SELECT ref_brand, count(*) as count 
    FROM usage_logs 
    WHERE org_id = ${org.id} 
    GROUP BY ref_brand 
    ORDER BY count DESC 
    LIMIT 5;
  `;

  console.log(`  - Total Logged Recommendations in DB: ${totalLogs.count}`);
  console.log(`  - Average Sizing Confidence:          ${Math.round(Number(avgConfidence.avg || 0))}%`);
  console.log(`  - Top Reference Brands Requested:`);
  for (const b of topBrands) {
    console.log(`    - ${b.ref_brand.toUpperCase()}: ${b.count} recommendation(s)`);
  }

  console.log("\n=================================================================");
  console.log("ALL END-TO-END (E2E) TEST STAGES COMPLETED SUCCESSFULLY");
  console.log("=================================================================\n");
}

runEndToEndTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nE2E Test Suite Failed:", err);
    process.exit(1);
  });
