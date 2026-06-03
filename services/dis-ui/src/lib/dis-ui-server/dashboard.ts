import { useQuery } from '@tanstack/react-query'

import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { SERVER_MODE } from './mode'

// Tenant Dashboard summary (demand list 1.2), tenant slice. Fixture mode (default)
// returns the inlined fixture; real mode is OPEN (slice 13) and throws, mirroring
// sources.ts / quarantine.ts. Shapes are PROVISIONAL pending Sanjeev's slices 15-17.

// PROVISIONAL: demand list 1.2's example only shows health "healthy"; the full
// vocabulary is not enumerated. Modeled as healthy | warning | failing (the surface
// map shows healthy/warning; failing mirrors the 1.3 sources status enum).
export type SourceHealth = 'healthy' | 'warning' | 'failing'

export type DashboardSource = {
  source_id: string
  name: string
  health: SourceHealth
  rows_24h: number
  last_ok_at: string
  quarantined_open: number
}

export type LatencySnapshot = {
  p50_ms: number
  p95_ms: number
  p99_ms: number
}

export type DashboardSummary = {
  tenant_id: string
  sources: DashboardSource[]
  latency_1h: LatencySnapshot
}

// Fixture for the primary tenant, grounded on the same kind-style source_ids as the
// Quarantine fixtures (manual_csv_upload is the real seeded source; shopify_pos_v2 a
// schema-example kind-style id). No invented src_*.
const DASHBOARD_FIXTURES: Record<string, DashboardSummary> = {
  t_acme9k2l1mn4: {
    tenant_id: 't_acme9k2l1mn4',
    sources: [
      {
        source_id: 'manual_csv_upload',
        name: 'Manual CSV Upload',
        health: 'healthy',
        rows_24h: 1247,
        last_ok_at: '2026-06-03T09:12:00Z',
        quarantined_open: 0,
      },
      {
        source_id: 'shopify_pos_v2',
        name: 'Shopify POS',
        health: 'warning',
        rows_24h: 832,
        last_ok_at: '2026-06-03T08:40:00Z',
        quarantined_open: 2,
      },
    ],
    latency_1h: { p50_ms: 2100, p95_ms: 6800, p99_ms: 11200 },
  },
}

// Tenant-scoped (own-tenant only). Returns null for an unknown tenant - a
// not-found result the Dashboard renders as the empty state.
export async function getDashboardSummary(
  snapshot: AuthSnapshot,
): Promise<DashboardSummary | null> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getDashboardSummary() is not implemented (slice 13)')
  }
  return DASHBOARD_FIXTURES[snapshot.tenantId ?? ''] ?? null
}

export function useDashboardSummary(snapshot: AuthSnapshot | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'dashboard', snapshot?.tenantId ?? 'none'],
    queryFn: () => getDashboardSummary(snapshot as AuthSnapshot),
    enabled: snapshot !== null,
    staleTime: Infinity,
    retry: false,
  })
}
