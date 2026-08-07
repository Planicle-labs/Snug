import { expect, it, describe } from 'vitest';
import { predictSize } from './sizing';
import { FitType, RefSizeRow, SizingInput, TargetSizeRow } from './types';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeRefRow(overrides?: Partial<RefSizeRow>): RefSizeRow {
  return {
    size_label:      'M',
    chest_min_cm:    96,
    chest_max_cm:    102,
    fit_type:        'regular',
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm:   null,
    length_max_cm:   null,
    ...overrides,
  };
}

function makeTargetRow(
  label: string,
  chestMin: number,
  chestMax: number,
  overrides?: Partial<TargetSizeRow>
): TargetSizeRow {
  return {
    size_label:      label,
    chest_min_cm:    chestMin,
    chest_max_cm:    chestMax,
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm:   null,
    length_max_cm:   null,
    ...overrides,
  };
}

// ─── Same-Fit Scenarios ───────────────────────────────────────────────────────

describe('Same-fit recommendation (PATH A)', () => {

  it('should recommend exact same size when ref and target garments match perfectly', () => {
    // Ref: regular M garment mid = (96+102)/2 = 99 cm
    // Target M garment mid = (97+103)/2 = 100 cm → delta 1cm → best match
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S',  90,  96),
        makeTargetRow('M',  97, 103), // delta to ref mid (99cm): 1cm
        makeTargetRow('L', 104, 110),
      ],
      targetFitType: 'regular',
    };

    const result = predictSize(input);

    expect(result.predicted_size).toBe('M');
    expect(result.fitted_size).toBe('M');
    expect(result.silhouette_size).toBe('M');
    expect(result.is_dual_recommendation).toBe(false);
    expect(result.confidence_label).toBe('high');
  });

  it('should recommend S when ref garment is smaller than target M', () => {
    // Ref: regular S garment mid = (88+94)/2 = 91 cm
    // Target: S mid = 92cm (delta 1cm), M mid = 98cm (delta 7cm)
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 88, chest_max_cm: 94, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S', 90, 94),
        makeTargetRow('M', 96, 100),
        makeTargetRow('L', 102, 106),
      ],
      targetFitType: 'regular',
    };

    const result = predictSize(input);

    expect(result.predicted_size).toBe('S');
    expect(result.is_dual_recommendation).toBe(false);
  });

});

// ─── Cross-Fit Scenarios ──────────────────────────────────────────────────────

describe('Cross-fit recommendation (PATH B — silhouette match)', () => {

  it('should recommend via silhouette path for regular → oversized (polo M → Overlays)', () => {
    // Ref: Ralph Lauren / Polo M, regular fit
    //   garment mid = (96+102)/2 = 99 cm
    //   body chest  = 99 - 8 (regular ease) = 91 cm
    //
    // PATH B (silhouette): body(91) + oversized ease(19) = 110 cm target garment
    //   S mid = 103 cm  | delta = 7 cm
    //   M mid = 109 cm  | delta = 1 cm  ← SILHOUETTE BEST
    //   L mid = 115 cm  | delta = 5 cm
    //
    // PATH A (fitted): ref garment (99 cm) vs:
    //   S mid = 103 cm  | delta = 4 cm  ← FITTED BEST
    //   M mid = 109 cm  | delta = 10 cm
    //
    // → Dual: silhouette = M, fitted = S
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S', 100, 106),
        makeTargetRow('M', 106, 112),
        makeTargetRow('L', 112, 118),
      ],
      targetFitType: 'oversized',
    };

    const result = predictSize(input);

    expect(result.silhouette_size).toBe('M');
    expect(result.fitted_size).toBe('S');
    expect(result.predicted_size).toBe('M');   // silhouette is primary for cross-fit
    expect(result.is_dual_recommendation).toBe(true);
    expect(result.suggested_sizes).toContain('M');
    expect(result.suggested_sizes).toContain('S');
  });

  it('fitIntent:fitted should make fitted path primary and halve penalty', () => {
    const baseInput: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S', 100, 106),
        makeTargetRow('M', 106, 112),
        makeTargetRow('L', 112, 118),
      ],
      targetFitType: 'oversized',
    };

    const withSilhouette = predictSize({ ...baseInput, fitIntent: 'true_silhouette' });
    const withFitted      = predictSize({ ...baseInput, fitIntent: 'fitted' });

    expect(withFitted.predicted_size).toBe('S');
    expect(withSilhouette.predicted_size).toBe('M');
    // fitIntent provided for silhouette path → penalty halved + intent bonus → higher confidence than default
    expect(withSilhouette.confidence).toBeGreaterThan(
      predictSize(baseInput).confidence
    );
  });

  it('fitIntent:true_silhouette should make silhouette path primary', () => {
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S', 100, 106),
        makeTargetRow('M', 106, 112),
        makeTargetRow('L', 112, 118),
      ],
      targetFitType: 'oversized',
      fitIntent: 'true_silhouette',
    };

    const result = predictSize(input);

    expect(result.predicted_size).toBe('M');
    expect(result.predicted_size).toBe(result.silhouette_size);
  });

  it('should not produce dual recommendation when both paths point to same size', () => {
    // Ref: slim S, target: slim S — same fit, paths always agree
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 84, chest_max_cm: 90, fit_type: 'slim' }),
      targetChart: [
        makeTargetRow('S', 84, 90),
        makeTargetRow('M', 90, 96),
        makeTargetRow('L', 96, 102),
      ],
      targetFitType: 'slim',
    };

    const result = predictSize(input);

    expect(result.is_dual_recommendation).toBe(false);
    expect(result.fitted_size).toBe(result.silhouette_size);
  });

});

// ─── Confidence Scoring ───────────────────────────────────────────────────────

describe('Confidence scoring', () => {

  it('cross-fit should have lower confidence than same-fit for identical measurements', () => {
    const targetChart = [makeTargetRow('M', 96, 102)];
    const refRow = makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' });

    const sameFit  = predictSize({ refSizeRow: refRow, targetChart, targetFitType: 'regular' });
    const crossFit = predictSize({ refSizeRow: refRow, targetChart, targetFitType: 'oversized' });

    expect(sameFit.confidence).toBeGreaterThan(crossFit.confidence);
  });

  it('slim → oversized should apply a larger penalty than regular → oversized', () => {
    const targetChart = [makeTargetRow('M', 100, 106)];
    const slimRef    = makeRefRow({ fit_type: 'slim' });
    const regularRef = makeRefRow({ fit_type: 'regular' });

    const slimToOversize    = predictSize({ refSizeRow: slimRef,    targetChart, targetFitType: 'oversized' });
    const regularToOversize = predictSize({ refSizeRow: regularRef, targetChart, targetFitType: 'oversized' });

    // slim → oversized penalty (15) > regular → oversized (10)
    expect(regularToOversize.confidence).toBeGreaterThan(slimToOversize.confidence);
  });

  it('providing fitIntent should increase confidence for cross-fit (penalty halved)', () => {
    const targetChart = [makeTargetRow('M', 106, 112)];
    const refRow = makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' });

    const noIntent   = predictSize({ refSizeRow: refRow, targetChart, targetFitType: 'oversized' });
    const withIntent = predictSize({ refSizeRow: refRow, targetChart, targetFitType: 'oversized', fitIntent: 'true_silhouette' });

    expect(withIntent.confidence).toBeGreaterThan(noIntent.confidence);
  });

});

// ─── Boundary Case Detection ──────────────────────────────────────────────────

describe('Boundary case detection', () => {

  it('should flag boundary case and return two sizes when ref sits within 2cm of size edge', () => {
    // Same-fit scenario: refGarmentMid = (100+106)/2 = 103 cm
    // Target M band: 102–108 cm — ref is at 103 cm, distToLower = |103-102| = 1 cm → boundary
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 100, chest_max_cm: 106, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S',  96, 102),
        makeTargetRow('M', 102, 108),
        makeTargetRow('L', 108, 114),
      ],
      targetFitType: 'regular',
    };

    const result = predictSize(input);

    expect(result.is_boundary_case).toBe(true);
    expect(result.suggested_sizes.length).toBeGreaterThan(1);
    expect(result.suggested_sizes).toContain('M');
  });

  it('should NOT flag boundary case when ref sits comfortably inside a size band', () => {
    // refGarmentMid = 99 cm. Target M band: 96–102. distToLower = 3cm, distToUpper = 3cm → no boundary
    const input: SizingInput = {
      refSizeRow: makeRefRow({ chest_min_cm: 96, chest_max_cm: 102, fit_type: 'regular' }),
      targetChart: [
        makeTargetRow('S',  90,  96),
        makeTargetRow('M',  96, 102),
        makeTargetRow('L', 102, 108),
      ],
      targetFitType: 'regular',
    };

    const result = predictSize(input);

    expect(result.is_boundary_case).toBe(false);
  });

});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {

  it('should throw when targetChart is empty', () => {
    const input: SizingInput = {
      refSizeRow: makeRefRow(),
      targetChart: [],
      targetFitType: 'regular',
    };

    expect(() => predictSize(input)).toThrow('Target chart cannot be empty');
  });

  it('should work with a single-size target chart without throwing', () => {
    const input: SizingInput = {
      refSizeRow: makeRefRow(),
      targetChart: [makeTargetRow('ONE_SIZE', 90, 120)],
      targetFitType: 'regular',
    };

    const result = predictSize(input);

    expect(result.predicted_size).toBe('ONE_SIZE');
    expect(result.is_boundary_case).toBe(false);
  });

  it('should include shoulder bonus in confidence when shoulder data is present', () => {
    const targetChart = [
      makeTargetRow('M', 96, 102, { shoulder_min_cm: 44, shoulder_max_cm: 46 }),
    ];
    const refWithShoulder    = makeRefRow({ shoulder_min_cm: 44, shoulder_max_cm: 46 });
    const refWithoutShoulder = makeRefRow();

    const withShoulder    = predictSize({ refSizeRow: refWithShoulder,    targetChart, targetFitType: 'regular' });
    const withoutShoulder = predictSize({ refSizeRow: refWithoutShoulder, targetChart, targetFitType: 'regular' });

    expect(withShoulder.confidence).toBeGreaterThan(withoutShoulder.confidence);
  });

});

