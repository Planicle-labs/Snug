import { expect, it } from 'vitest'
import { parsePredictRequest, parseReferenceChart, parseTargetChart, sortChartByChestMid } from './validation'

it('rejects non-string prediction fields before a handler can call trim()', () => {
  expect(parsePredictRequest({
    ref_brand: ['not-a-string'],
    ref_garment: 'shirt',
    ref_size: 'M',
    shopify_product_id: '123',
  })).toBeNull()
})

it('accepts an optional fit_intent and rejects invalid values', () => {
  expect(parsePredictRequest({
    ref_brand: 'uniqlo',
    ref_garment: 'tshirt',
    ref_size: 'M',
    shopify_product_id: '123',
    fit_intent: 'fitted',
  })).toEqual({
    ref_brand: 'uniqlo',
    ref_garment: 'tshirt',
    ref_size: 'M',
    shopify_product_id: '123',
    fit_intent: 'fitted',
  })

  expect(parsePredictRequest({
    ref_brand: 'uniqlo',
    ref_garment: 'tshirt',
    ref_size: 'M',
    shopify_product_id: '123',
    fit_intent: 'snug',
  })).toBeNull()
})

it('rejects malformed chart measurements instead of passing NaN to the algorithm', () => {
  expect(parseTargetChart([{
    size_label: 'M',
    fit_type: 'regular',
    chest_min_cm: 100,
    chest_max_cm: 'not-a-number',
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm: null,
    length_max_cm: null,
  }])).toBeNull()
})

it('parses merchant charts without requiring ease fields and extracts uniform fit type', () => {
  const parsed = parseTargetChart([
    {
      size_label: 'L',
      fit_type: 'oversized',
      chest_min_cm: 110,
      chest_max_cm: 118,
      // Legacy ease fields may still be present in KV — ignored by the engine
      ease_value_cm: 19,
      ease_source: 'inferred',
      shoulder_min_cm: null,
      shoulder_max_cm: null,
      length_min_cm: null,
      length_max_cm: null,
    },
    {
      size_label: 'M',
      fit_type: 'oversized',
      chest_min_cm: 102,
      chest_max_cm: 110,
      shoulder_min_cm: null,
      shoulder_max_cm: null,
      length_min_cm: null,
      length_max_cm: null,
    },
  ])

  expect(parsed).not.toBeNull()
  expect(parsed!.fitType).toBe('oversized')
  // Sorted S→XL by chest midpoint regardless of input order
  expect(parsed!.rows.map((row) => row.size_label)).toEqual(['M', 'L'])
  expect(parsed!.rows[0]).not.toHaveProperty('ease_value_cm')
  expect(parsed!.rows[0]).not.toHaveProperty('fit_type')
})

it('rejects merchant charts with mixed fit types', () => {
  expect(parseTargetChart([
    {
      size_label: 'M',
      fit_type: 'regular',
      chest_min_cm: 96,
      chest_max_cm: 102,
    },
    {
      size_label: 'L',
      fit_type: 'oversized',
      chest_min_cm: 104,
      chest_max_cm: 110,
    },
  ])).toBeNull()
})

it('requires fit_type on reference brand rows and accepts relaxed fit', () => {
  const parsed = parseReferenceChart([
    {
      size_label: 'M',
      fit_type: 'relaxed',
      chest_min_cm: 100,
      chest_max_cm: 108,
    },
  ])

  expect(parsed).toEqual([{
    size_label: 'M',
    fit_type: 'relaxed',
    chest_min_cm: 100,
    chest_max_cm: 108,
    shoulder_min_cm: null,
    shoulder_max_cm: null,
    length_min_cm: null,
    length_max_cm: null,
  }])
})

it('sortChartByChestMid orders by garment midpoint', () => {
  expect(sortChartByChestMid([
    { size_label: 'L', chest_min_cm: 110, chest_max_cm: 116 },
    { size_label: 'S', chest_min_cm: 90, chest_max_cm: 96 },
    { size_label: 'M', chest_min_cm: 100, chest_max_cm: 106 },
  ]).map((row) => row.size_label)).toEqual(['S', 'M', 'L'])
})
