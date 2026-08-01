import { SizingInput, SizingResult, TargetSizeRow } from './types';

/**
 * Pure 9-step deterministic sizing algorithm engine.
 * Converts reference brand size & garment specs into target merchant size recommendation
 * with 5-signal confidence scoring, cross-fit penalties, and boundary case detection.
 */
export function predictSize(input: SizingInput): SizingResult {
  const { refSizeRow, targetChart, targetFitType } = input;

  if (!targetChart || targetChart.length === 0) {
    throw new Error('Target chart cannot be empty');
  }

  // Step 1 & 2: Deduct Reference Ease to recover estimated Body Chest
  const refChestMid = (refSizeRow.chest_min_cm + refSizeRow.chest_max_cm) / 2;
  const bodyChest = refChestMid - refSizeRow.ease_value_cm;

  // Step 3: NIFT Anthropometric Validation (Stubbed for v0)

  // Step 4 & 5: Find Target Size Row with Minimum Delta in Body Space
  let bestRow: TargetSizeRow = targetChart[0];
  let bestIndex = 0;
  let minDelta = Infinity;

  targetChart.forEach((row, index) => {
    const targetBodyMid = (row.chest_min_cm + row.chest_max_cm) / 2 - row.ease_value_cm;
    const delta = Math.abs(bodyChest - targetBodyMid);

    if (delta < minDelta) {
      minDelta = delta;
      bestRow = row;
      bestIndex = index;
    }
  });

  // Step 6: Compute 5-Signal Confidence Score
  // S1: Range Match Precision (0 - 30 pts)
  const s1 = 30 * Math.max(0, 1 - minDelta / 3);

  // S2: Range Tightness (0 - 25 pts)
  const rangeSpan = Math.max(1, bestRow.chest_max_cm - bestRow.chest_min_cm);
  const s2 = 25 * Math.min(1, 4 / rangeSpan);

  // S3: Ease Source Trust (0 - 20 pts)
  let s3 = 12; // default for inferred
  if (refSizeRow.ease_source === 'explicit') {
    s3 = 20;
  } else if (refSizeRow.ease_source === 'user_calibrated') {
    s3 = 17;
  }

  // S4: Data Freshness (0 - 15 pts) - Hardcoded for v0
  const s4 = 15;

  // S5: Secondary Alignment (0 - 10 pts)
  let s5 = 0;
  if (refSizeRow.shoulder_min_cm && refSizeRow.shoulder_max_cm && bestRow.shoulder_min_cm && bestRow.shoulder_max_cm) {
    const refShoulderMid = (refSizeRow.shoulder_min_cm + refSizeRow.shoulder_max_cm) / 2;
    const targetShoulderMid = (bestRow.shoulder_min_cm + bestRow.shoulder_max_cm) / 2;
    if (Math.abs(refShoulderMid - targetShoulderMid) <= 2) {
      s5 += 5;
    }
  }
  if (refSizeRow.length_min_cm && refSizeRow.length_max_cm && bestRow.length_min_cm && bestRow.length_max_cm) {
    const refLengthMid = (refSizeRow.length_min_cm + refSizeRow.length_max_cm) / 2;
    const targetLengthMid = (bestRow.length_min_cm + bestRow.length_max_cm) / 2;
    if (Math.abs(refLengthMid - targetLengthMid) <= 3) {
      s5 += 5;
    }
  }

  const rawScore = s1 + s2 + s3 + s4 + s5;

  // Step 7: Cross-Fit Penalty Engine
  const refFit = refSizeRow.fit_type;
  let penalty = 0;
  if (refFit !== targetFitType) {
    if (refFit === 'slim' && targetFitType === 'oversized') {
      penalty = 15;
    } else if (refFit === 'oversized' && targetFitType === 'slim') {
      penalty = 20;
    } else if (refFit === 'regular') {
      penalty = 8;
    } else {
      penalty = 5;
    }
  }

  const confidence = Math.round(Math.max(0, Math.min(100, rawScore - penalty)));

  let confidence_label: 'high' | 'medium' | 'low' = 'low';
  if (confidence >= 75) {
    confidence_label = 'high';
  } else if (confidence >= 45) {
    confidence_label = 'medium';
  }

  // Step 8: Boundary Case Proximity Detection
  const targetBodyMin = bestRow.chest_min_cm - bestRow.ease_value_cm;
  const targetBodyMax = bestRow.chest_max_cm - bestRow.ease_value_cm;

  const distToMin = Math.abs(bodyChest - targetBodyMin);
  const distToMax = Math.abs(bodyChest - targetBodyMax);
  const minBoundaryDist = Math.min(distToMin, distToMax);

  let is_boundary_case = false;
  const suggested_sizes: string[] = [bestRow.size_label];

  if (minBoundaryDist <= 1.5 && targetChart.length > 1) {
    is_boundary_case = true;
    if (distToMax < distToMin && bestIndex + 1 < targetChart.length) {
      suggested_sizes.push(targetChart[bestIndex + 1].size_label);
    } else if (distToMin < distToMax && bestIndex - 1 >= 0) {
      suggested_sizes.unshift(targetChart[bestIndex - 1].size_label);
    }
  }

  // Step 9: Assemble Response Payload
  let reasoning = `Recommended size ${bestRow.size_label} based on body chest estimation of ${bodyChest.toFixed(1)}cm.`;
  if (is_boundary_case && suggested_sizes.length > 1) {
    reasoning += ` You sit near the boundary between ${suggested_sizes.join(' and ')}. Choose ${suggested_sizes[0]} for a snugger fit or ${suggested_sizes[1]} for extra room.`;
  }

  return {
    predicted_size: bestRow.size_label,
    confidence,
    confidence_label,
    is_boundary_case,
    suggested_sizes,
    reasoning,
  };
}
