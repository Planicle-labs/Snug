import { FitType, SizingInput, SizingResult, TargetSizeRow } from './types';

// ─── Ease Constants ───────────────────────────────────────────────────────────
/**
 * Standard chest ease for t-shirt category by fit type (Aldrich-calibrated, menswear knit tops).
 * These are GARMENT ease values: how many cm the garment adds over body chest.
 *
 * Range midpoints used as working values:
 *   slim:      4–6  cm  → mid 5
 *   regular:   6–10 cm  → mid 8  (polo treated as regular; runs ~1-2cm tighter but within band)
 *   relaxed:  10–14 cm  → mid 12
 *   oversized: 16–22 cm → mid 19
 *
 * Source: Winifred Aldrich "Metric Pattern Cutting for Menswear" + NIFT knit top standards.
 * These are intentionally conservative midpoints. Calibrate with real brand data over time.
 */
const TSHIRT_EASE: Record<FitType, number> = {
  slim:      5,
  regular:   8,
  relaxed:   12,
  oversized: 19,
};

// ─── Cross-Fit Penalty Matrix ─────────────────────────────────────────────────
/**
 * Confidence penalty (pts) when reference fit ≠ target fit.
 * Higher penalty = less confidence because the mapping crosses a larger ease gap.
 * Indexed as CROSS_FIT_PENALTY[refFit][targetFit].
 */
const CROSS_FIT_PENALTY: Record<FitType, Partial<Record<FitType, number>>> = {
  slim:      { regular: 5,  relaxed: 10, oversized: 15 },
  regular:   { slim: 5,     relaxed: 8,  oversized: 10 },
  relaxed:   { slim: 12,    regular: 8,  oversized: 5  },
  oversized: { slim: 20,    regular: 10, relaxed: 5    },
};

// ─── Engine ───────────────────────────────────────────────────────────────────
/**
 * Pure deterministic sizing engine.
 *
 * Runs two parallel recommendation paths:
 *
 *   PATH A — Fitted Match (direct garment delta)
 *     "What garment is physically closest to what this person already wears?"
 *     Compares reference garment midpoint directly against target garment midpoints.
 *     Best for same-fit scenarios and shoppers who want a fitted oversized look.
 *
 *   PATH B — Silhouette Match (body anchor + target ease)
 *     "What size delivers the full intended silhouette of this brand?"
 *     Recovers body chest from reference garment, then adds target brand's standard ease
 *     to find the garment size that gives the user the proper experience of the target fit.
 *     Best for cross-fit scenarios (e.g. regular polo → oversized drop tee).
 *
 * When both paths agree → single recommendation.
 * When they diverge (cross-fit) → dual recommendation surfaced to widget.
 */
export function predictSize(input: SizingInput): SizingResult {
  const { refSizeRow, targetChart, targetFitType, fitIntent } = input;

  if (!targetChart || targetChart.length === 0) {
    throw new Error('Target chart cannot be empty');
  }

  // ── Step 1: Recover Body Chest from Reference Garment ─────────────────────
  // We have exact garment measurements from KV (constrained widget UI — no unknown brands).
  // Strip the standard ease for the reference fit type to get estimated body chest.
  const refGarmentMid = (refSizeRow.chest_min_cm + refSizeRow.chest_max_cm) / 2;
  const bodyChest = refGarmentMid - TSHIRT_EASE[refSizeRow.fit_type];

  // ── Step 2: PATH A — Fitted Match (direct garment delta) ──────────────────
  // Compare reference garment midpoint against each target garment midpoint.
  let fittedRow: TargetSizeRow = targetChart[0];
  let fittedIndex = 0;
  let minFittedDelta = Infinity;

  targetChart.forEach((row, index) => {
    const targetMid = (row.chest_min_cm + row.chest_max_cm) / 2;
    const delta = Math.abs(refGarmentMid - targetMid);
    if (delta < minFittedDelta) {
      minFittedDelta = delta;
      fittedRow = row;
      fittedIndex = index;
    }
  });

  // ── Step 3: PATH B — Silhouette Match (body anchor + target ease) ─────────
  // body chest + target fit's standard ease = the garment size that delivers
  // the full intended silhouette experience of the target brand.
  const targetGarmentIntent = bodyChest + TSHIRT_EASE[targetFitType];

  let silhouetteRow: TargetSizeRow = targetChart[0];
  let silhouetteIndex = 0;
  let minSilhouetteDelta = Infinity;

  targetChart.forEach((row, index) => {
    const targetMid = (row.chest_min_cm + row.chest_max_cm) / 2;
    const delta = Math.abs(targetGarmentIntent - targetMid);
    if (delta < minSilhouetteDelta) {
      minSilhouetteDelta = delta;
      silhouetteRow = row;
      silhouetteIndex = index;
    }
  });

  // ── Step 4: Resolve Primary Recommendation ────────────────────────────────
  const isCrossFit = refSizeRow.fit_type !== targetFitType;
  const isDualRecommendation =
    isCrossFit && fittedRow.size_label !== silhouetteRow.size_label;

  // Default primary selection logic:
  //   Same fit   → PATH A (direct delta is exact and sufficient)
  //   Cross-fit  → PATH B (silhouette) unless user expressed 'fitted' intent
  //   fitIntent  → always overrides default
  let primaryRow: TargetSizeRow;
  let primaryIndex: number;
  let workingDelta: number;

  if (fitIntent === 'fitted') {
    primaryRow   = fittedRow;
    primaryIndex = fittedIndex;
    workingDelta = minFittedDelta;
  } else if (fitIntent === 'true_silhouette' || isCrossFit) {
    primaryRow   = silhouetteRow;
    primaryIndex = silhouetteIndex;
    workingDelta = minSilhouetteDelta;
  } else {
    // Same fit, no fitIntent → PATH A
    primaryRow   = fittedRow;
    primaryIndex = fittedIndex;
    workingDelta = minFittedDelta;
  }

  // ── Step 5: Confidence Scoring (5 signals) ────────────────────────────────

  // S1: Delta Precision (0–35 pts) — how closely does the working delta match?
  let s1: number;
  if (workingDelta <= 1)      s1 = 35;
  else if (workingDelta <= 3) s1 = 25;
  else if (workingDelta <= 6) s1 = 15;
  else                        s1 = Math.max(0, 15 - (workingDelta - 6) * 2);

  // S2: Range Tightness (0–25 pts) — how narrow is the target size band?
  // Tighter/standard bands (≤ 6cm) = full points.
  const rangeSpan = Math.max(1, primaryRow.chest_max_cm - primaryRow.chest_min_cm);
  const s2 = 25 * Math.min(1, 6 / rangeSpan);

  // S3: Data Freshness (0–20 pts) — hardcoded for v0; will come from KV metadata timestamp
  const s3 = 20;

  // S4: Secondary Measurements (0–10 pts) — shoulder and length alignment bonus
  let s4 = 0;
  if (
    refSizeRow.shoulder_min_cm && refSizeRow.shoulder_max_cm &&
    primaryRow.shoulder_min_cm && primaryRow.shoulder_max_cm
  ) {
    const refShoulderMid    = (refSizeRow.shoulder_min_cm + refSizeRow.shoulder_max_cm) / 2;
    const targetShoulderMid = (primaryRow.shoulder_min_cm + primaryRow.shoulder_max_cm) / 2;
    const shoulderDelta = Math.abs(refShoulderMid - targetShoulderMid);
    if (shoulderDelta <= 2)      s4 += 5;
    else if (shoulderDelta <= 4) s4 += 2;
  }
  if (
    refSizeRow.length_min_cm && refSizeRow.length_max_cm &&
    primaryRow.length_min_cm && primaryRow.length_max_cm
  ) {
    const refLengthMid    = (refSizeRow.length_min_cm + refSizeRow.length_max_cm) / 2;
    const targetLengthMid = (primaryRow.length_min_cm + primaryRow.length_max_cm) / 2;
    const lengthDelta = Math.abs(refLengthMid - targetLengthMid);
    if (lengthDelta <= 3)      s4 += 5;
    else if (lengthDelta <= 5) s4 += 2;
  }

  // S5: Fit Intent Clarity (0–10 pts) — explicit fitIntent removes dual ambiguity
  const s5 = fitIntent ? 10 : 0;

  const rawScore = s1 + s2 + s3 + s4 + s5;

  // ── Step 6: Cross-Fit Confidence Penalty ──────────────────────────────────
  // Lower confidence when translating between different fit philosophies.
  // Penalty is halved when fitIntent is explicitly provided (user knows what they want).
  let penalty = 0;
  if (isCrossFit) {
    penalty = CROSS_FIT_PENALTY[refSizeRow.fit_type]?.[targetFitType] ?? 8;
    if (fitIntent) penalty = Math.floor(penalty / 2);
  }

  const confidence = Math.round(Math.max(0, Math.min(100, rawScore - penalty)));

  let confidence_label: 'high' | 'medium' | 'low' = 'low';
  if (confidence >= 75)      confidence_label = 'high';
  else if (confidence >= 45) confidence_label = 'medium';

  // ── Step 7: Boundary Case Detection ──────────────────────────────────────
  // A boundary case is when the shopper's target garment measurement sits within
  // 2 cm of a size band boundary — meaning an adjacent size is almost equally valid.
  const referencePoint = isCrossFit ? targetGarmentIntent : refGarmentMid;
  const distToLower = Math.abs(referencePoint - primaryRow.chest_min_cm);
  const distToUpper = Math.abs(referencePoint - primaryRow.chest_max_cm);
  const minBoundaryDist = Math.min(distToLower, distToUpper);

  let is_boundary_case = false;
  const suggested_sizes: string[] = [primaryRow.size_label];

  if (minBoundaryDist <= 2 && targetChart.length > 1) {
    is_boundary_case = true;
    // Add the adjacent size on the side where the boundary is closer
    if (distToUpper < distToLower && primaryIndex + 1 < targetChart.length) {
      suggested_sizes.push(targetChart[primaryIndex + 1].size_label);
    } else if (distToLower < distToUpper && primaryIndex - 1 >= 0) {
      suggested_sizes.unshift(targetChart[primaryIndex - 1].size_label);
    }
  }

  // When dual recommendation, surface the secondary path size if not already included
  if (isDualRecommendation) {
    const secondaryLabel = fitIntent === 'fitted'
      ? silhouetteRow.size_label
      : fittedRow.size_label;
    if (!suggested_sizes.includes(secondaryLabel)) {
      suggested_sizes.push(secondaryLabel);
    }
  }

  // ── Step 8: Construct Reasoning String ───────────────────────────────────
  const fitLabel = refSizeRow.fit_type;
  const sizeLabel = refSizeRow.size_label;

  let reasoning =
    `Your ${fitLabel} fit ${sizeLabel} gives an estimated body chest of ${bodyChest.toFixed(1)} cm.`;

  if (!isCrossFit) {
    reasoning += ` We recommend ${primaryRow.size_label} in this brand (${workingDelta.toFixed(1)} cm delta).`;
  } else if (isDualRecommendation) {
    reasoning +=
      ` For the full ${targetFitType} silhouette (boxy, dropped shoulders), go with ${silhouetteRow.size_label}.` +
      ` For a fitted ${targetFitType} feel (closer to your body), go with ${fittedRow.size_label}.`;
  } else {
    reasoning += ` We recommend ${primaryRow.size_label} in this ${targetFitType} brand.`;
  }

  if (is_boundary_case && suggested_sizes.length > 1) {
    reasoning +=
      ` You sit near the boundary between ${suggested_sizes[0]} and ${suggested_sizes[1]}.` +
      ` Choose ${suggested_sizes[0]} for a snugger fit or ${suggested_sizes[1]} for extra room.`;
  }

  // ── Step 9: Assemble Response ─────────────────────────────────────────────
  return {
    predicted_size:       primaryRow.size_label,
    fitted_size:          fittedRow.size_label,
    silhouette_size:      silhouetteRow.size_label,
    is_dual_recommendation: isDualRecommendation,
    confidence,
    confidence_label,
    is_boundary_case,
    suggested_sizes,
    reasoning,
  };
}
