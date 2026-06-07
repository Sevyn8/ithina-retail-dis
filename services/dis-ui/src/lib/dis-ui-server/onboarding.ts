import { useQuery } from '@tanstack/react-query'

import type { ParsedCsv } from '../onboarding/analyze-csv'
import { SERVER_MODE } from './mode'
import type { MappingSuggestionResponse, SuggestionSource } from './mapping-suggestions'

// Onboarding analyze step (T11). The column profile is now produced by REAL client-side CSV
// parsing (lib/onboarding/analyze-csv.ts) and per-column suggestions come from the
// mapping-suggestions endpoint (mapping-suggestions.ts, mode-aware). The assembled analysis is
// held in an in-memory store keyed by a client-minted sample_id and read back at the Review
// step; a store miss (reload / direct nav) is a clean null, not a crash and not demo data.
// The Preview (dry-run) and Go-live (approve) steps remain fixtures (no backend yet); they are
// noted pending dis-ui-server.

export type SampleStatus = 'received' | 'analyzing' | 'ready' | 'failed'

export type SampleTransform = { type: string; value: string }

export type SampleColumn = {
  source_col: string
  inferred_type: string
  sample_values: string[]
  null_pct: number
  proposed_canonical: string // a catalog key, or '' when the suggestion is "do not map"
  confidence: number
  transforms: SampleTransform[]
  // OPTIONAL assist fields, shaped to the mapping-suggestions response. `reasoning` is the
  // assistant's note (LLM path only; the UI never fabricates it). `alternatives` are other
  // candidate canonical KEYS (server list[str]); rendered as quick-pick options.
  reasoning?: string | null
  alternatives?: string[]
}

export type SampleAnalysis = {
  sample_id: string
  status: SampleStatus
  // Honesty flag from the suggestion source: "llm" (AI) vs "fallback" (basic name match).
  source: SuggestionSource
  model?: string | null
  // The operator-supplied source id (load-bearing) and template name, carried from the upload
  // step so Go-live can build the createMappingTemplate body without re-prompting.
  source_id: string
  template_name: string
  columns: SampleColumn[]
  sample_rows: Record<string, string>[] // first 10 parsed rows, for the review preview
  row_count: number // true number of data rows
}

// 2.3 PATCH .../mapping - operator overrides (partial, per column).
export type ColumnOverride = {
  source_col: string
  proposed_canonical?: string
  transforms?: SampleTransform[]
  authoritative?: boolean
}

// Preview rows: canonical-keyed projection of the sample. Now computed CLIENT-SIDE
// (lib/onboarding/dry-run-local.ts, best-effort/non-blocking); no backend dry-run endpoint.
export type DryRunResult = { rows: Record<string, unknown>[] }

// 2.5 POST .../approve. Still a fixture (Go-live step has no backend yet).
export type ApproveResult = { source_id: string; mapping_version: number; status: 'staged' }

// In-memory analyzed-sample store (the SampleUpload -> MappingReview handoff). Survives
// client-side navigation; lost on reload, which is the correct trigger for the review
// empty-state. Mirrors the mutable-fixture pattern used elsewhere (sources.ts).
const sampleStore = new Map<string, SampleAnalysis>()
let sampleCounter = 0

// Test-only: clear the store so analyses do not bleed between tests.
export function __resetSampleStore(): void {
  sampleStore.clear()
  sampleCounter = 0
}

// A client-minted, session-deterministic sample id (no Date/random; the id only keys the
// store + the review route, it is not persisted).
export function nextSampleId(): string {
  sampleCounter += 1
  return `smp_local_${sampleCounter}`
}

// Merge the parsed profile + the suggestion response into the SampleAnalysis the Review screen
// consumes. proposed_canonical is the suggested catalog key, or '' for a "do not map" (null)
// suggestion (the column then shows as needs-review).
export function assembleAnalysis(
  parsed: ParsedCsv,
  response: MappingSuggestionResponse,
  sampleId: string,
  sourceId: string,
  templateName: string,
): SampleAnalysis {
  const byColumn = new Map(response.suggestions.map((s) => [s.source_column, s]))
  const columns: SampleColumn[] = parsed.columns.map((profile) => {
    const suggestion = byColumn.get(profile.name)
    return {
      source_col: profile.name,
      inferred_type: profile.inferred_datatype,
      sample_values: profile.sample_values,
      null_pct: profile.null_pct,
      proposed_canonical: suggestion?.suggested_target ?? '',
      confidence: suggestion?.confidence ?? 0,
      transforms: [],
      reasoning: suggestion?.reasoning ?? null,
      alternatives: suggestion?.alternatives ?? undefined,
    }
  })
  return {
    sample_id: sampleId,
    status: 'ready',
    source: response.source,
    model: response.model ?? null,
    source_id: sourceId,
    template_name: templateName,
    columns,
    sample_rows: parsed.sample_rows,
    row_count: parsed.row_count,
  }
}

export function putSampleAnalysis(analysis: SampleAnalysis): void {
  sampleStore.set(analysis.sample_id, analysis)
}

// Read an analyzed sample. Returns null on a store miss (reload / direct nav) so the screen
// shows a clean empty state rather than throwing.
export async function getSample(sampleId: string): Promise<SampleAnalysis | null> {
  return sampleStore.get(sampleId) ?? null
}

function ensureFixtureMode(fn: string): void {
  if (SERVER_MODE === 'real') {
    throw new Error(`real-mode ${fn} is not implemented (slice 13)`)
  }
}

export async function patchSampleMapping(
  sampleId: string,
  override: ColumnOverride,
): Promise<ColumnOverride> {
  // The draft lives in the screen's local state; this echoes the override for contract parity.
  void sampleId
  return override
}

export async function approveSample(sampleId: string): Promise<ApproveResult> {
  ensureFixtureMode('approveSample()')
  void sampleId
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
