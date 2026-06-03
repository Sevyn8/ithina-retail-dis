import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { getDashboardSummary } from './dashboard'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const otherTenant: AuthSnapshot = { ...tenant, tenantId: 't_nofixtures01' }

describe('dashboard fixtures (fixture mode)', () => {
  it('returns the tenant summary with per-source rollup and latency', async () => {
    const summary = await getDashboardSummary(tenant)
    expect(summary).not.toBeNull()
    expect(summary?.tenant_id).toBe('t_acme9k2l1mn4')
    expect(summary?.sources.map((s) => s.source_id)).toEqual(['manual_csv_upload', 'shopify_pos_v2'])
    const shopify = summary?.sources.find((s) => s.source_id === 'shopify_pos_v2')
    expect(shopify?.health).toBe('warning')
    expect(shopify?.quarantined_open).toBe(2)
    expect(summary?.latency_1h).toEqual({ p50_ms: 2100, p95_ms: 6800, p99_ms: 11200 })
  })

  it('returns null for a tenant with no data (own-tenant only)', async () => {
    expect(await getDashboardSummary(otherTenant)).toBeNull()
  })
})
