import { useQuery } from '@tanstack/react-query'

import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { SERVER_MODE } from './mode'

// Quarantine endpoints (demand list 4.1/4.2), tenant slice. Fixture mode (default)
// returns the inlined fixtures; real mode is OPEN (slice 13) and throws, mirroring
// sources.ts / me.ts. Shapes are PROVISIONAL pending Sanjeev's slices 15-17.

// PROVISIONAL enum (demand list 4.1).
export type FailureStage = 'source-shape' | 'canonical-shape' | 'fk' | 'normalization'
export type QuarantineStatus = 'open' | 'resolved'

// 4.1 list row. The row carries a `source` DISPLAY string, not a source_id (the
// demand list's query param is source_id but the response is by display; the UI
// filters on display). source identity is the (tenant_id, source_id) composite.
export type QuarantineRow = {
  trace_id: string
  source: string
  store: string
  error_reason: string
  failure_stage: FailureStage
  mapping_version: number
  failed_at: string
  status: QuarantineStatus
}

// 4.2 detail. PROVISIONAL: the demand list names the fields (original payload,
// error context, mapping version, chain depth) but gives NO shape. This struct
// and the original_payload contents are an invented placeholder, not canonical.
export type QuarantineDetail = {
  trace_id: string
  source: string
  store: string
  failed_at: string
  failure_stage: FailureStage
  mapping_version: number
  error_reason: string
  error_context: string
  original_payload: Record<string, unknown>
  chain_depth: number
}

// trace_ids are UUIDv7 (dis-core trace_id.py: `trace_id uuid NOT NULL`, minted via
// new_uuid7). These are synthetic UUIDv7-shaped fixtures (version nibble 7, variant
// 8); the final segment preserves the prior numbering for traceability. The
// `acmeCanonical` id is cross-referenced by the Audit fixture (audit.ts imports it),
// so the same trace appears in both the Quarantine and Audit screens.
export const QUARANTINE_TRACE_IDS = {
  acmeCanonical: '0190ac0e-1a01-7001-8a01-000000000001',
  acmeNormalization: '0190ac0e-1a01-7001-8a01-000000000002',
  shopifySourceShape: '0190ac0e-1a01-7001-8a01-000000000003',
  shopifyFk: '0190ac0e-1a01-7001-8a01-000000000004',
  acmeResolved: '0190ac0e-1a01-7001-8a01-000000000005',
} as const

// Fixtures for the primary tenant. Sources: `manual_csv_upload` is the real seeded
// source (display "Manual CSV Upload"); `shopify_pos_v2` is a schema-example
// kind-style source_id (display "Shopify POS"), NOT an invented opaque id - added
// only so the source filter has more than one option.
const QUARANTINE_FIXTURES: Record<string, QuarantineRow[]> = {
  t_acme9k2l1mn4: [
    {
      trace_id: QUARANTINE_TRACE_IDS.acmeCanonical,
      source: 'Manual CSV Upload',
      store: 'Acme Downtown #1',
      error_reason: "price '12.5o' not a valid number",
      failure_stage: 'canonical-shape',
      mapping_version: 1,
      failed_at: '2026-06-03T09:08:00Z',
      status: 'open',
    },
    {
      trace_id: QUARANTINE_TRACE_IDS.acmeNormalization,
      source: 'Manual CSV Upload',
      store: 'Acme Downtown #1',
      error_reason: 'bad date format in event_ts',
      failure_stage: 'normalization',
      mapping_version: 1,
      failed_at: '2026-06-03T09:05:00Z',
      status: 'open',
    },
    {
      trace_id: QUARANTINE_TRACE_IDS.shopifySourceShape,
      source: 'Shopify POS',
      store: 'Acme Downtown #1',
      error_reason: 'missing required column sku',
      failure_stage: 'source-shape',
      mapping_version: 2,
      failed_at: '2026-06-02T16:40:00Z',
      status: 'open',
    },
    {
      trace_id: QUARANTINE_TRACE_IDS.shopifyFk,
      source: 'Shopify POS',
      store: 'Acme Downtown #1',
      error_reason: 'store_id not found in identity_mirror',
      failure_stage: 'fk',
      mapping_version: 2,
      failed_at: '2026-05-28T11:00:00Z',
      status: 'resolved',
    },
    {
      trace_id: QUARANTINE_TRACE_IDS.acmeResolved,
      source: 'Manual CSV Upload',
      store: 'Acme Downtown #1',
      error_reason: "price '-' not a valid number",
      failure_stage: 'canonical-shape',
      mapping_version: 1,
      failed_at: '2026-05-20T08:30:00Z',
      status: 'resolved',
    },
  ],
}

const QUARANTINE_DETAIL_FIXTURES: Record<string, QuarantineDetail> = {
  [QUARANTINE_TRACE_IDS.acmeCanonical]: {
    trace_id: QUARANTINE_TRACE_IDS.acmeCanonical,
    source: 'Manual CSV Upload',
    store: 'Acme Downtown #1',
    failed_at: '2026-06-03T09:08:00Z',
    failure_stage: 'canonical-shape',
    mapping_version: 1,
    error_reason: "price '12.5o' not a valid number",
    error_context: 'canonical-shape validation: column price failed numeric cast',
    original_payload: { sku: 'A123', price: '12.5o', qty: '3', txn_date: '03-12-25' },
    chain_depth: 0,
  },
  [QUARANTINE_TRACE_IDS.shopifySourceShape]: {
    trace_id: QUARANTINE_TRACE_IDS.shopifySourceShape,
    source: 'Shopify POS',
    store: 'Acme Downtown #1',
    failed_at: '2026-06-02T16:40:00Z',
    failure_stage: 'source-shape',
    mapping_version: 2,
    error_reason: 'missing required column sku',
    error_context: 'source-shape validation: required column sku absent from payload',
    original_payload: { item: 'B456', price: '9.99', qty: '1' },
    chain_depth: 0,
  },
}

export async function getQuarantine(snapshot: AuthSnapshot): Promise<QuarantineRow[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getQuarantine() is not implemented (slice 13)')
  }
  return QUARANTINE_FIXTURES[snapshot.tenantId ?? ''] ?? []
}

export async function getQuarantineRow(traceId: string): Promise<QuarantineDetail> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getQuarantineRow() is not implemented (slice 13)')
  }
  const detail = QUARANTINE_DETAIL_FIXTURES[traceId]
  if (detail === undefined) {
    throw new Error(`no fixture quarantine detail for trace_id ${traceId}`)
  }
  return detail
}

export function useQuarantine(snapshot: AuthSnapshot | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'quarantine', snapshot?.tenantId ?? 'none'],
    queryFn: () => getQuarantine(snapshot as AuthSnapshot),
    enabled: snapshot !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useQuarantineRow(traceId: string | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'quarantine', 'detail', traceId ?? 'none'],
    queryFn: () => getQuarantineRow(traceId as string),
    enabled: traceId !== null,
    staleTime: Infinity,
    retry: false,
  })
}
