import { expect, it } from "vitest"
import { predictSize } from "./sizing"
import { RefSizeRow, SizingInput, TargetSizeRow } from "./types"

// Helper functions for tests

// Takes as input all the fields that need to be overriden and returns the default RefSizeRow+overrides
function makeRefRow(overrides?: Partial<RefSizeRow>): RefSizeRow{
  return {
    size_label: 'M',
    chest_min_cm: 100,
    chest_max_cm: 104,
    ease_value_cm: 10,
    ease_source: 'explicit',
    fit_type: 'regular',
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm: null,
    length_max_cm: null,
    ...overrides,
  }
}

function makeTargetRow(label: string, chestMin: number, chestMax: number, ease: number): TargetSizeRow{
  return {
    size_label: label,
    chest_min_cm: chestMin,
    chest_max_cm: chestMax,
    ease_value_cm: ease,
    ease_source: 'explicit',
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm: null,
    length_max_cm: null,
  }
}

it("should predict exact size match for same-fit regular garment", () => {
  // 1. Arrange
  const refRow = makeRefRow({ chest_min_cm: 100, chest_max_cm: 104,ease_value_cm: 10, fit_type: 'regular' })
  // Ref body chest midpoint = (100+104)/2 - 10 = 92 cm
  const targetChart = [
    makeTargetRow('S', 96, 100, 10),  // body mid = (96+100)/2 - 10 = 88 cm
    makeTargetRow('M', 100, 104, 10), // body mid = (100+104)/2 - 10 = 92 cm(Delta = 0!)
    makeTargetRow('L', 104, 108, 10), // body mid = (104+108)/2 - 10 = 96 cm
  ];

  const input: SizingInput = {
    refSizeRow: refRow,
    targetChart,
    targetFitType: 'regular',
  };

  // 2. Act
  const result = predictSize(input)

  // 3. Assert
  expect(result.predicted_size).toBe('M');
  expect(result.confidence_label).toBe('high');
  expect(result.is_boundary_case).toBe(false);
})

it("should correctly map regular reference to target size S", () => {
  const refRow = makeRefRow({ chest_min_cm: 100, chest_max_cm: 104, ease_value_cm: 10, fit_type: 'regular' })
  const targetChart = [
    makeTargetRow('S', 106, 110, 16), // Target body mid = 108 - 16 = 92 cm (Delta = 0!)
    makeTargetRow('M', 112, 116, 16), // Target body mid = 114 - 16 = 98 cm
    makeTargetRow('L', 118, 122, 16), // Target body mid = 120 - 16 = 104 cm
  ]

    const input: SizingInput = {
      refSizeRow: refRow,
      targetChart,
      targetFitType: 'oversized',
    };

    // 2. Act
    const result = predictSize(input);

    // 3. Assert: Even though reference size was 'M', recommended size MUST be 'S'!
    expect(result.predicted_size).toBe('S');
})

it('should flag boundary case when body chest is within 1.5cm of size limit', () => {
  // Body chest = (101.8+105.8)/2 - 10 = 93.8 cm (near size M upper limit of 94cm)
  const refRow = makeRefRow({ chest_min_cm: 101.8, chest_max_cm: 105.8, ease_value_cm: 10 });

  const targetChart = [
    makeTargetRow('S', 96, 100, 10),  // Body mid = 88 cm
    makeTargetRow('M', 100, 104, 10), // Body mid = 92 cm, max body = 94 cm
    makeTargetRow('L', 104, 108, 10), // Body mid = 96 cm, min body = 94 cm
  ];

  const input: SizingInput = {
    refSizeRow: refRow,
    targetChart,
    targetFitType: 'regular',
  };

  const result = predictSize(input);

  expect(result.is_boundary_case).toBe(true);
  expect(result.suggested_sizes).toEqual(['M', 'L']);
});

it('should apply penalty when converting slim reference to oversized target', () => {
  const refRow = makeRefRow({ fit_type: 'slim' });
  const targetChart = [makeTargetRow('M', 100, 104, 10)];

  const matchedInput: SizingInput = { refSizeRow: refRow, targetChart, targetFitType: 'slim' };
  const mismatchedInput: SizingInput = { refSizeRow: refRow, targetChart, targetFitType: 'oversized' };

  const matchedResult = predictSize(matchedInput);
  const mismatchedResult = predictSize(mismatchedInput);

  // Slim -> Oversized penalty is -15 points
  expect(matchedResult.confidence - mismatchedResult.confidence).toBe(15);
});


it('should score explicit ease higher than inferred ease', () => {
  const targetChart = [makeTargetRow('M', 100, 104, 10)];

  const explicitInput: SizingInput = {
    refSizeRow: makeRefRow({ ease_source: 'explicit' }),
    targetChart,
    targetFitType: 'regular',
  };

  const inferredInput: SizingInput = {
    refSizeRow: makeRefRow({ ease_source: 'inferred' }),
    targetChart,
    targetFitType: 'regular',
  };

  const explicitResult = predictSize(explicitInput);
  const inferredResult = predictSize(inferredInput);

  // S3 signal for explicit (20) vs inferred (12) = 8 pt difference
  expect(explicitResult.confidence).toBeGreaterThan(inferredResult.confidence);
  expect(explicitResult.confidence - inferredResult.confidence).toBe(8);
});
