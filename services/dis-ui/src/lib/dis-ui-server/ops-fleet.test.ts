import { getFleetSummary, getFleetTenants } from './ops-fleet'

describe('ops-fleet fixtures (fixture mode)', () => {
  it('returns a multi-tenant fleet with health values', async () => {
    const tenants = await getFleetTenants()
    expect(tenants.length).toBeGreaterThan(1)
    expect(tenants.map((t) => t.tenant_id)).toContain('t_acme9k2l1mn4')
    expect(tenants.every((t) => ['healthy', 'warning', 'failing'].includes(t.health))).toBe(true)
  })

  it('returns a summary consistent with the tenant rows', async () => {
    const [summary, tenants] = [await getFleetSummary(), await getFleetTenants()]
    expect(summary.tenant_count).toBe(tenants.length)
    expect(summary.healthy).toBe(tenants.filter((t) => t.health === 'healthy').length)
    expect(summary.warning).toBe(tenants.filter((t) => t.health === 'warning').length)
    expect(summary.failing).toBe(tenants.filter((t) => t.health === 'failing').length)
    expect(summary.total_rows_24h).toBe(tenants.reduce((sum, t) => sum + t.rows_24h, 0))
    expect(summary.open_quarantine).toBe(tenants.reduce((sum, t) => sum + t.open_quarantine, 0))
  })
})
