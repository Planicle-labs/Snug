export interface RefSizeRow{
  size_label: string,
  chest_min_cm: number,
  chest_max_cm: number,
  ease_value_cm: number,
  ease_source: "explicit" | "inferred" | "user_calibrated",
  fit_type: "slim" | "regular" | "oversized",
  shoulder_min_cm: number | null,
  shoulder_max_cm: number | null,
  length_min_cm: number | null,
  length_max_cm: number | null,
}

export interface TargetSizeRow{
  size_label: string,
  chest_min_cm: number,
  chest_max_cm: number,
  ease_value_cm: number,
  ease_source: 'explicit' | 'inferred' | 'user_calibrated',
  shoulder_min_cm: number | null,
  shoulder_max_cm: number | null,
  length_min_cm: number | null,
  length_max_cm: number | null
}

export interface SizingInput{
  refSizeRow: RefSizeRow,
  targetChart: TargetSizeRow[] ,// an array of target size rows
  targetFitType: 'slim' | 'regular' | 'oversized',
}

export interface SizingResult{
  predicted_size: string,
  confidence: number, // 0 to 100
  confidence_label: 'high' | 'medium' | 'low',
  is_boundary_case: boolean,
  suggested_sizes: string[],
  reasoning: string,
}
