import { expect, it } from "vitest"
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
