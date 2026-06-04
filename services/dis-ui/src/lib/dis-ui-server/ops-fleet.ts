import { useQuery } from '@tanstack/react-query'

import { SERVER_MODE } from './mode'

// Ops Fleet endpoints (demand list 7.1-7.3), OPS slice (scope PLATFORM). Fixture mode
// (default); real mode is OPEN (slice 13) and throws. Slice 24 builds these on a
// barely-specified contract, so every shape here is PROVISIONAL and lives only in this
// containment file; the screen consumes typed values only (single reconciliation point).
//
// What the demand list pins is prose, not schemas:
//   7.1 fleet/summary: "total tenants, sources, rows/24h, overall quarantine rate, p95
//       latency". Modeled to the slice-24 build target (health counts + fleet open
//       quarantine) - a UI-owned shape; the wording divergence is flagged.
//   7.2 fleet/tenants: "tenant-level health table" with query tier/region/sort - NO row
//       shape. The `health` derivation and a `last_activity` field are underspecified;
//       modeled provisionally and flagged.
//   7.3 tenants/{id}/notify: out of scope this slice (no action surface).
//
// CROSS-TENANT READ AUTHORIZATION is NOT modeled here: whether/how an ops (PLATFORM)
// token may read across tenants, and how that isolation is enforced, is Sanjeev's RLS
// policy and is recorded as the heaviest open item for the batched message. The fixture
// simply returns a multi-tenant fleet.

export type FleetHealth = 'healthy' | 'warning' | 'failing'

// 7.1 rollup. PROVISIONAL (see header).
export type FleetSummary = {
  tenant_count: number
  healthy: number
  warning: number
  failing: number
  total_rows_24h: number
  open_quarantine: number
}

// 7.2 / 7.3 per-tenant health row. PROVISIONAL: 7.2 gives no row shape, and the health
// derivation + last_activity_at field are underspecified.
export type FleetTenant = {
  tenant_id: string
  name: string
  health: FleetHealth
  rows_24h: number
  open_quarantine: number
  last_activity_at: string
}

// Fixture fleet. Only `t_acme9k2l1mn4` ("Acme Retail") is GROUNDED - the persona tenant
// (its warning health matches its dashboard fixture). The others are PROVISIONAL display
// fixtures in the external t_* form (external<->UUID translation is OPEN, decisions.md
// D37), added so the fleet has a realistic spread (2 healthy / 2 warning / 1 failing).
const FLEET_TENANTS: FleetTenant[] = [
  {
    tenant_id: 't_acme9k2l1mn4',
    name: 'Acme Retail',
    health: 'warning',
    rows_24h: 2079,
    open_quarantine: 2,
    last_activity_at: '2026-06-04T09:12:00Z',
  },
  {
    tenant_id: 't_beta7h2k9m3n',
    name: 'Beta Stores',
    health: 'healthy',
    rows_24h: 18402,
    open_quarantine: 0,
    last_activity_at: '2026-06-04T08:55:00Z',
  },
  {
    tenant_id: 't_gamma4p1q8r6',
    name: 'Gamma Stores',
    health: 'warning',
    rows_24h: 5400,
    open_quarantine: 3,
    last_activity_at: '2026-06-04T07:40:00Z',
  },
  {
    tenant_id: 't_delta2s9t5v3',
    name: 'Delta Foods',
    health: 'failing',
    rows_24h: 120,
    open_quarantine: 47,
    last_activity_at: '2026-06-04T06:02:00Z',
  },
  {
    tenant_id: 't_echo6w3x1y8z',
    name: 'Echo Mart',
    health: 'healthy',
    rows_24h: 9800,
    open_quarantine: 0,
    last_activity_at: '2026-06-04T09:01:00Z',
  },
]

// Summary derived from the rows so the two reads stay consistent.
function deriveSummary(tenants: FleetTenant[]): FleetSummary {
  return {
    tenant_count: tenants.length,
    healthy: tenants.filter((t) => t.health === 'healthy').length,
    warning: tenants.filter((t) => t.health === 'warning').length,
    failing: tenants.filter((t) => t.health === 'failing').length,
    total_rows_24h: tenants.reduce((sum, t) => sum + t.rows_24h, 0),
    open_quarantine: tenants.reduce((sum, t) => sum + t.open_quarantine, 0),
  }
}

export async function getFleetSummary(): Promise<FleetSummary> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getFleetSummary() is not implemented (slice 13)')
  }
  return deriveSummary(FLEET_TENANTS)
}

export async function getFleetTenants(): Promise<FleetTenant[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getFleetTenants() is not implemented (slice 13)')
  }
  return FLEET_TENANTS
}

export function useFleetSummary() {
  return useQuery({
    queryKey: ['dis-ui-server', 'ops-fleet', 'summary'],
    queryFn: () => getFleetSummary(),
    staleTime: Infinity,
    retry: false,
  })
}

export function useFleetTenants() {
  return useQuery({
    queryKey: ['dis-ui-server', 'ops-fleet', 'tenants'],
    queryFn: () => getFleetTenants(),
    staleTime: Infinity,
    retry: false,
  })
}
