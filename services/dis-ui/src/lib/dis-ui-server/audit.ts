import { SERVER_MODE } from './mode'

// Typed stub for the audit trace lookup (demand list 5.1). Shape is PROVISIONAL;
// NOT consumed by any screen this checkpoint - Audit & Trace Lookup (Checkpoint 4,
// trace_id direct) enriches it.
export type AuditStage = {
  stage: string
  at: string
  status: string
  mapping_version_id?: number
}

export type AuditTrace = {
  trace_id: string
  tenant_id: string | null
  source_id: string
  stages: AuditStage[]
  prior_trace_id: string | null
}

const AUDIT_FIXTURE: AuditTrace = {
  trace_id: 'tr_fixture0001',
  tenant_id: 't_acme9k2l1mn4',
  source_id: 'manual_csv_upload',
  stages: [
    { stage: 'received', at: '2026-06-03T09:00:01Z', status: 'ok' },
    { stage: 'validated', at: '2026-06-03T09:00:02Z', status: 'ok' },
    { stage: 'mapped', at: '2026-06-03T09:00:03Z', status: 'ok', mapping_version_id: 1 },
    { stage: 'committed', at: '2026-06-03T09:00:04Z', status: 'ok' },
  ],
  prior_trace_id: null,
}

export async function getAuditTrace(traceId: string): Promise<AuditTrace> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getAuditTrace() is not implemented (slice 13)')
  }
  return { ...AUDIT_FIXTURE, trace_id: traceId }
}
