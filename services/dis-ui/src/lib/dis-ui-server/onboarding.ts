import { useQuery } from '@tanstack/react-query'

import { SERVER_MODE } from './mode'

// Onboarding endpoints (demand list 2.1-2.5). Fixture mode (default) returns the
// inlined fixtures; real mode is OPEN (slice 13) and throws, mirroring me.ts /
// sources.ts. Shapes are PROVISIONAL pending Sanjeev's slices 15-17.

// 2.2 GET /v1/onboarding/samples/{sample_id}
export type SampleStatus = 'received' | 'analyzing' | 'ready' | 'failed'

export type SampleTransform = { type: string; value: string }

export type SampleColumn = {
  source_col: string
  inferred_type: string
  sample_values: string[]
  null_pct: number
  proposed_canonical: string
  confidence: number
  transforms: SampleTransform[]
}

export type SampleAnalysis = {
  sample_id: string
  status: SampleStatus
  columns: SampleColumn[]
}

// 2.1 POST /v1/onboarding/samples. The file bytes and the attach-to-existing
// choice are UI-only: demand list 2.1 carries file / source_kind / tenant_id /
// label, with no source-instance reference, so the fixture consumes only
// source_kind + label (see SampleUpload for the attach-to UI note).
export type CreateSampleRequest = { source_kind: string; label: string }
export type CreateSampleResult = { sample_id: string; gcs_uri: string; status: 'received' }

// 2.3 PATCH .../mapping - operator overrides (partial, per column).
export type ColumnOverride = {
  source_col: string
  proposed_canonical?: string
  transforms?: SampleTransform[]
  authoritative?: boolean
}

// 2.4 POST .../dry-run. PROVISIONAL: demand list 2.4 says "10-20 canonical rows"
// with no row schema, so rows are typed loosely and the fixture values are
// provisional (keyed by the proposed canonical columns).
export type DryRunResult = { rows: Record<string, unknown>[] }

// 2.5 POST .../approve.
export type ApproveResult = { source_id: string; mapping_version: number; status: 'staged' }

const KNOWN_SAMPLE_ID = 'smp_acme0001'

// Grounded on the demand-list 2.2 example + surface-map screen-4 wireframe, so the
// confidence bands (>=0.70 / <0.70 / <0.50) are all exercised.
const SAMPLE_FIXTURES: Record<string, SampleAnalysis> = {
  [KNOWN_SAMPLE_ID]: {
    sample_id: KNOWN_SAMPLE_ID,
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
      {
        source_col: 'qty',
        inferred_type: 'integer',
        sample_values: ['12'],
        null_pct: 0,
        proposed_canonical: 'quantity',
        confidence: 0.95,
        transforms: [],
      },
      {
        source_col: 'txn_date',
        inferred_type: 'string',
        sample_values: ['03-12-25'],
        null_pct: 0.01,
        proposed_canonical: 'event_ts',
        confidence: 0.62,
        transforms: [{ type: 'date_format', value: 'DD-MM-YY' }],
      },
      {
        source_col: 'pos_terminal',
        inferred_type: 'string',
        sample_values: ['T-2A'],
        null_pct: 0,
        proposed_canonical: 'store_id',
        confidence: 0.41,
        transforms: [],
      },
    ],
  },
}

// PROVISIONAL canonical preview rows (no row schema in demand list 2.4).
const DRY_RUN_FIXTURE: DryRunResult = {
  rows: [
    { sku_id: 'A123', quantity: 12, event_ts: '2025-12-03', store_id: 'T-2A' },
    { sku_id: 'B456', quantity: 3, event_ts: '2025-12-03', store_id: 'T-2A' },
    { sku_id: 'C789', quantity: 1, event_ts: '2025-12-04', store_id: 'T-2A' },
  ],
}

function ensureFixtureMode(fn: string): void {
  if (SERVER_MODE === 'real') {
    throw new Error(`real-mode ${fn} is not implemented (slice 13)`)
  }
}

export async function createSample(_req: CreateSampleRequest): Promise<CreateSampleResult> {
  ensureFixtureMode('createSample()')
  // The fixture ignores the file bytes and request fields; it always yields the
  // one known sample so the upload -> review flow is deterministic.
  void _req
  return { sample_id: KNOWN_SAMPLE_ID, gcs_uri: `gs://onboarding-staging/${KNOWN_SAMPLE_ID}.csv`, status: 'received' }
}

export async function getSample(sampleId: string): Promise<SampleAnalysis> {
  ensureFixtureMode('getSample()')
  const fixture = SAMPLE_FIXTURES[sampleId]
  if (fixture === undefined) {
    throw new Error(`no fixture sample analysis for sample_id ${sampleId}`)
  }
  return fixture
}

export async function patchSampleMapping(
  sampleId: string,
  override: ColumnOverride,
): Promise<ColumnOverride> {
  ensureFixtureMode('patchSampleMapping()')
  // The draft lives in the screen's local state; this echoes the override for 2.3
  // contract parity.
  void sampleId
  return override
}

export async function dryRunSample(sampleId: string): Promise<DryRunResult> {
  ensureFixtureMode('dryRunSample()')
  void sampleId
  return DRY_RUN_FIXTURE
}

export async function approveSample(sampleId: string): Promise<ApproveResult> {
  ensureFixtureMode('approveSample()')
  void sampleId
  // source_id is the seeded channel/kind-style source_id (manual_csv_upload), NOT
  // a per-instance source id - no per-instance id exists in fixtures (D37 open).
  return { source_id: 'manual_csv_upload', mapping_version: 1, status: 'staged' }
}

export function useSample(sampleId: string | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'onboarding', 'sample', sampleId ?? 'none'],
    queryFn: () => getSample(sampleId as string),
    enabled: sampleId !== null,
    staleTime: Infinity,
    retry: false,
  })
}
