import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { getQuarantine, getQuarantineRow } from './quarantine'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const otherTenant: AuthSnapshot = { ...tenant, tenantId: 't_nofixtures01' }

describe('quarantine fixtures (fixture mode)', () => {
  it('returns the tenant rows', async () => {
    const rows = await getQuarantine(tenant)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((r) => r.trace_id)).toContain('tr_acme0001')
  })

  it('returns an empty list for a tenant with no rows', async () => {
    expect(await getQuarantine(otherTenant)).toEqual([])
  })

  it('returns row detail with payload and mapping version', async () => {
    const detail = await getQuarantineRow('tr_acme0001')
    expect(detail.mapping_version).toBe(1)
    expect(detail.original_payload).toMatchObject({ sku: 'A123' })
  })

  it('rejects for an unknown trace_id', async () => {
    await expect(getQuarantineRow('tr_unknown')).rejects.toThrow(/no fixture/)
  })
})
