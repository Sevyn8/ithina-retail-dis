import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { SERVER_MODE } from './mode'

// Typed stub for the quarantine endpoints (demand list 4.1). Shape is PROVISIONAL;
// NOT consumed by any screen this checkpoint - Quarantine Console (Checkpoint 3,
// tenant slice) enriches it.
export type FailureStage = 'source-shape' | 'canonical-shape' | 'fk' | 'normalization'

export type QuarantineRow = {
  trace_id: string
  source: string
  store: string
  error_reason: string
  failure_stage: FailureStage
  mapping_version: number
  failed_at: string
  status: 'open' | 'resolved'
}

const QUARANTINE_FIXTURES: Record<string, QuarantineRow[]> = {
  t_acme9k2l1mn4: [
    {
      trace_id: 'tr_fixture0001',
      source: 'Manual CSV Upload',
      store: 'Acme Downtown #1',
      error_reason: 'price not a valid number',
      failure_stage: 'canonical-shape',
      mapping_version: 1,
      failed_at: '2026-06-03T09:08:00Z',
      status: 'open',
    },
  ],
}

export async function getQuarantine(snapshot: AuthSnapshot): Promise<QuarantineRow[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getQuarantine() is not implemented (slice 13)')
  }
  return QUARANTINE_FIXTURES[snapshot.tenantId ?? ''] ?? []
}
