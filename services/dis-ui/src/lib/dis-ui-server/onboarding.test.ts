import { beforeEach, describe, expect, it } from 'vitest'

import type { ParsedCsv } from '../onboarding/analyze-csv'
import {
  __resetSampleStore,
  approveSample,
  assembleAnalysis,
  getSample,
  nextSampleId,
  putSampleAnalysis,
} from './onboarding'
import type { SampleAnalysis } from './onboarding'
import type { MappingSuggestionResponse } from './mapping-suggestions'

beforeEach(() => {
  __resetSampleStore()
})

const PARSED: ParsedCsv = {
  columns: [
    { name: 'item_code', inferred_datatype: 'text', null_pct: 0, sample_values: ['A123'] },
    { name: 'qty', inferred_datatype: 'integer', null_pct: 0, sample_values: ['12'] },
    { name: 'mystery', inferred_datatype: 'text', null_pct: 0.5, sample_values: ['x'] },
  ],
  sample_rows: [{ item_code: 'A123', qty: '12', mystery: 'x' }],
  row_count: 1,
}

const RESPONSE: MappingSuggestionResponse = {
  source: 'llm',
  model: 'gemini-2.5-flash',
  suggestions: [
    {
      source_column: 'item_code',
      suggested_target: 'sku_id',
      confidence: 0.95,
      reasoning: 'sku-ish',
    },
    {
      source_column: 'qty',
      suggested_target: 'quantity',
      confidence: 0.9,
      alternatives: ['unit_sale_price'],
    },
    { source_column: 'mystery', suggested_target: null, confidence: 0.1 }, // "do not map"
  ],
}

describe('onboarding analyzed-sample store (T11)', () => {
  it('round-trips an analysis through the in-memory store', async () => {
    const analysis: SampleAnalysis = assembleAnalysis(
      PARSED,
      RESPONSE,
      'smp_local_1',
      'manual_csv_upload',
      'Sales',
    )
    putSampleAnalysis(analysis)
    const got = await getSample('smp_local_1')
    expect(got).not.toBeNull()
    expect(got?.sample_id).toBe('smp_local_1')
  })

  it('returns null for an unknown sample id (store miss, not a throw)', async () => {
    expect(await getSample('smp_does_not_exist')).toBeNull()
  })

  it('mints distinct session-deterministic sample ids', () => {
    expect(nextSampleId()).not.toBe(nextSampleId())
  })
})

describe('assembleAnalysis (merge parse + suggestions)', () => {
  it('merges the profile and suggestions, carries the source/model/rows', () => {
    const analysis = assembleAnalysis(PARSED, RESPONSE, 'smp_local_1', 'manual_csv_upload', 'Sales')
    expect(analysis.source).toBe('llm')
    expect(analysis.model).toBe('gemini-2.5-flash')
    expect(analysis.source_id).toBe('manual_csv_upload')
    expect(analysis.template_name).toBe('Sales')
    expect(analysis.row_count).toBe(1)
    expect(analysis.sample_rows).toHaveLength(1)
    const byCol = Object.fromEntries(analysis.columns.map((c) => [c.source_col, c]))
    expect(byCol.item_code.proposed_canonical).toBe('sku_id')
    expect(byCol.item_code.inferred_type).toBe('text')
    expect(byCol.item_code.reasoning).toBe('sku-ish')
    expect(byCol.qty.proposed_canonical).toBe('quantity')
    expect(byCol.qty.alternatives).toEqual(['unit_sale_price'])
    // null suggested_target -> '' (column shows needs-review).
    expect(byCol.mystery.proposed_canonical).toBe('')
  })
})

describe('onboarding fixtures still pending the backend', () => {
  it('approveSample returns staged with the seeded source id (fixture)', async () => {
    const result = await approveSample('smp_local_1')
    expect(result).toEqual({ source_id: 'manual_csv_upload', mapping_version: 1, status: 'staged' })
  })
})
