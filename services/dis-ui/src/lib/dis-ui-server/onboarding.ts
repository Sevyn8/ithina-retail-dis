import { SERVER_MODE } from './mode'

// Typed stub for the onboarding sample endpoints (demand list 2.1/2.2). Shape is
// PROVISIONAL; this is NOT consumed by any screen this checkpoint - Sample Upload
// and Mapping Review (Checkpoint 2) enrich it (polling, overrides, dry-run).
export type SampleStatus = 'received' | 'analyzing' | 'ready' | 'failed'

export type SampleColumn = {
  source_col: string
  inferred_type: string
  sample_values: string[]
  null_pct: number
  proposed_canonical: string
  confidence: number
  transforms: { type: string; value: string }[]
}

export type SampleAnalysis = {
  sample_id: string
  status: SampleStatus
  columns: SampleColumn[]
}

const SAMPLE_FIXTURE: SampleAnalysis = {
  sample_id: 'smp_fixture0001',
  status: 'ready',
  columns: [
    {
      source_col: 'item_code',
      inferred_type: 'string',
      sample_values: ['A123'],
      null_pct: 0,
      proposed_canonical: 'sku_id',
      confidence: 0.98,
      transforms: [],
    },
  ],
}

export async function getSample(sampleId: string): Promise<SampleAnalysis> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getSample() is not implemented (slice 13)')
  }
  return { ...SAMPLE_FIXTURE, sample_id: sampleId }
}
