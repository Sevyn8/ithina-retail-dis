import { useQuery } from '@tanstack/react-query'

import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { SERVER_MODE } from './mode'

export type SourceStatus = 'active' | 'staged' | 'deprecated' | 'failing'

// Shape per demand list 1.3. The server response is RLS-scoped to the caller's
// tenant (no tenant_id field on the wire); the client fixtures below are keyed by
// tenant for scoping.
export type Source = {
  source_id: string
  name: string
  type: string
  store: string
  status: SourceStatus
  active_version: number
  quarantine_rate_24h: number
  last_ok_at: string
}

// Fixtures keyed by tenant id. GROUNDED on Sanjeev's slice-2 seed (fixtures.py):
// the primary tenant t_acme9k2l1mn4 has one ACTIVE config.source_mappings row,
// source_id "manual_csv_upload", store "Acme Downtown #1", mapping_rules.version 1.
// name / type / quarantine_rate_24h / last_ok_at are PROVISIONAL display values
// (not seeded). Other tenants (and the cross-tenant ops persona) have no fixtures.
export const SOURCE_FIXTURES: Record<string, Source[]> = {
  t_acme9k2l1mn4: [
    {
      source_id: 'manual_csv_upload',
      name: 'Manual CSV Upload',
      type: 'CSV',
      store: 'Acme Downtown #1',
      status: 'active',
      active_version: 1,
      quarantine_rate_24h: 0,
      last_ok_at: '2026-06-03T09:12:00Z',
    },
  ],
}

// Lists the caller's sources. Fixture mode (default) returns the tenant-scoped
// fixtures; real mode is OPEN (slice 13), mirroring me.ts - it throws rather than
// guessing the wire call.
export async function getSources(snapshot: AuthSnapshot): Promise<Source[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getSources() is not implemented (slice 13)')
  }
  return SOURCE_FIXTURES[snapshot.tenantId ?? ''] ?? []
}

export function useSources(snapshot: AuthSnapshot | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'sources', snapshot?.tenantId ?? 'none'],
    queryFn: () => getSources(snapshot as AuthSnapshot),
    enabled: snapshot !== null,
    staleTime: Infinity,
    retry: false,
  })
}
