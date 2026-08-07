/**
 * Fit types supported across garments.
 * Polo is treated as regular fit (structurally a knit top, ~1-2cm tighter than
 * a standard tee — within confidence band, no separate type needed at v1).
 */
export type FitType = 'slim' | 'regular' | 'relaxed' | 'oversized';

/**
 * Optional user-expressed silhouette intent.
 * When provided, collapses dual recommendations into a single precise answer.
 *
 * 'true_silhouette' → user wants the full intended look of the brand (boxy, dropped, etc.)
 * 'fitted'          → user wants it close to their body even in an oversized brand
 */
export type FitIntent = 'true_silhouette' | 'fitted';

/**
 * Reference brand size row. Sourced from Cloudflare KV:
 * key: brand:{slug}:{garment_type}
 *
 * Measurements are GARMENT measurements (not body measurements).
 * Ease is NOT stored here — it is inferred from fit_type via TSHIRT_EASE table.
 * This keeps the KV schema merchant-friendly (they only paste their size chart).
 */
export interface RefSizeRow {
  size_label: string;
  chest_min_cm: number;
  chest_max_cm: number;
  fit_type: FitType;
  shoulder_min_cm?: number | null;
  shoulder_max_cm?: number | null;
  length_min_cm?: number | null;
  length_max_cm?: number | null;
}

/**
 * One row of the merchant's product size chart.
 * Sourced from Cloudflare KV: key: chart:{org_id}:{garment_type}
 *
 * Merchants supply standard garment measurements only.
 * No ease metrics required — zero merchant onboarding friction.
 */
export interface TargetSizeRow {
  size_label: string;
  chest_min_cm: number;
  chest_max_cm: number;
  shoulder_min_cm?: number | null;
  shoulder_max_cm?: number | null;
  length_min_cm?: number | null;
  length_max_cm?: number | null;
}

/**
 * Input payload for the predictSize engine.
 */
export interface SizingInput {
  /** The reference brand's size row the shopper selected in the widget */
  refSizeRow: RefSizeRow;
  /** The merchant's full size chart for the current product, sorted S → XL */
  targetChart: TargetSizeRow[];
  /** The fit type of the merchant's garment */
  targetFitType: FitType;
  /**
   * Optional silhouette intent expressed by the shopper.
   * When undefined, engine defaults to true_silhouette for cross-fit scenarios.
   */
  fitIntent?: FitIntent;
}

/**
 * Output payload from the predictSize engine.
 */
export interface SizingResult {
  /** Primary recommended size label — the single best answer */
  predicted_size: string;
  /**
   * The size from Path A (direct garment delta match).
   * Answers: "what garment is physically closest to what you already wear?"
   */
  fitted_size: string;
  /**
   * The size from Path B (body anchor + target ease).
   * Answers: "what size delivers the full intended silhouette of this brand?"
   */
  silhouette_size: string;
  /**
   * True when fitted_size ≠ silhouette_size (cross-fit with meaningful divergence).
   * Widget should present both options with silhouette labels when true.
   */
  is_dual_recommendation: boolean;
  /** Deterministic confidence score 0–100 */
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low';
  /** True when shopper sits within 2 cm of a size boundary */
  is_boundary_case: boolean;
  /** All sizes to surface to the shopper, in priority order */
  suggested_sizes: string[];
  /** Human-readable explanation of the recommendation */
  reasoning: string;
}
