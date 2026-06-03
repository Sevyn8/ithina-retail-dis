import { useQuery } from '@tanstack/react-query'

import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { SERVER_MODE } from './mode'

// Mapping-version endpoints (demand list 3.1/3.2), tenant slice, read-only.
// Fixture mode (default) returns the inlined fixtures; real mode is OPEN (slice
// 13) and throws. Shapes are PROVISIONAL pending Sanjeev's slices 15-17.

// 3.1 list row.
export type MappingStatus = 'active' | 'staged' | 'deprecated'

export type MappingVersion = {
  version: number
  status: MappingStatus
  created_at: string
  created_by: string // PROVISIONAL: a display-ish name; schema column is created_by_user_id UUID
  field_count: number
  transform_count: number
  suite_version: number
  active_from: string | null
  active_to: string | null
}

// 3.2 full immutable definition. The demand list gives NO shape; modeled on the
// config.source_mappings.mapping_rules JSONB (rename/normalize/cast/derive). The
// contents below are PROVISIONAL/illustrative.
export type MappingRules = {
  rename: Record<string, string>
  normalize: Record<string, string>
  cast: Record<string, string>
  derive: Record<string, string>
}

export type MappingVersionDetail = MappingVersion & { mapping_rules: MappingRules }

// Single source of truth nested by tenant -> source -> version (the list view is
// the detail with mapping_rules stripped). PROVISIONAL multi-version history: the
// seeded data has one ACTIVE row; v1-deprecated / v2-active / v3-staged here
// exercises all three badges and the active-per-source uniqueness. v1-deprecated is
// consistent with the Audit/Quarantine fixtures referencing mapping_version 1.
const MAPPINGS: Record<string, Record<string, MappingVersionDetail[]>> = {
  t_acme9k2l1mn4: {
    manual_csv_upload: [
      {
        version: 3,
        status: 'staged',
        created_at: '2026-06-02',
        created_by: 'acme.user',
        field_count: 13,
        transform_count: 5,
        suite_version: 3,
        active_from: null,
        active_to: null,
        mapping_rules: {
          rename: { item_code: 'sku_id', qty: 'quantity', txn_date: 'source_sale_timestamp', pos_terminal: 'store_id' },
          normalize: { source_sale_timestamp: 'iso8601' },
          cast: { quantity: 'integer', price: 'numeric' },
          derive: {},
        },
      },
      {
        version: 2,
        status: 'active',
        created_at: '2026-05-28',
        created_by: 'acme.user',
        field_count: 12,
        transform_count: 4,
        suite_version: 2,
        active_from: '2026-05-28',
        active_to: null,
        mapping_rules: {
          rename: { item_code: 'sku_id', qty: 'quantity', txn_date: 'source_sale_timestamp' },
          normalize: { source_sale_timestamp: 'iso8601' },
          cast: { quantity: 'integer', price: 'numeric' },
          derive: {},
        },
      },
      {
        version: 1,
        status: 'deprecated',
        created_at: '2026-04-10',
        created_by: 'ops.dev',
        field_count: 10,
        transform_count: 2,
        suite_version: 1,
        active_from: '2026-04-10',
        active_to: '2026-05-28',
        mapping_rules: {
          rename: { item_code: 'sku_id', qty: 'quantity' },
          normalize: {},
          cast: { quantity: 'integer' },
          derive: {},
        },
      },
    ],
  },
}

function tenantSource(snapshot: AuthSnapshot, sourceId: string): MappingVersionDetail[] {
  return MAPPINGS[snapshot.tenantId ?? '']?.[sourceId] ?? []
}

export async function getMappingVersions(
  snapshot: AuthSnapshot,
  sourceId: string,
): Promise<MappingVersion[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getMappingVersions() is not implemented (slice 13)')
  }
  // List view drops mapping_rules (own-tenant only; unknown source -> []).
  return tenantSource(snapshot, sourceId).map((v) => ({
    version: v.version,
    status: v.status,
    created_at: v.created_at,
    created_by: v.created_by,
    field_count: v.field_count,
    transform_count: v.transform_count,
    suite_version: v.suite_version,
    active_from: v.active_from,
    active_to: v.active_to,
  }))
}

export async function getMappingVersion(
  snapshot: AuthSnapshot,
  sourceId: string,
  version: number,
): Promise<MappingVersionDetail | null> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getMappingVersion() is not implemented (slice 13)')
  }
  return tenantSource(snapshot, sourceId).find((v) => v.version === version) ?? null
}

export function useMappingVersions(snapshot: AuthSnapshot | null, sourceId: string | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'mappings', snapshot?.tenantId ?? 'none', sourceId ?? 'none'],
    queryFn: () => getMappingVersions(snapshot as AuthSnapshot, sourceId as string),
    enabled: snapshot !== null && sourceId !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useMappingVersion(
  snapshot: AuthSnapshot | null,
  sourceId: string | null,
  version: number | null,
) {
  return useQuery({
    queryKey: ['dis-ui-server', 'mappings', 'detail', snapshot?.tenantId ?? 'none', sourceId ?? 'none', version ?? 'none'],
    queryFn: () => getMappingVersion(snapshot as AuthSnapshot, sourceId as string, version as number),
    enabled: snapshot !== null && sourceId !== null && version !== null,
    staleTime: Infinity,
    retry: false,
  })
}
