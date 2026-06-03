import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { getMappingVersion, getMappingVersions } from './mappings'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const otherTenant: AuthSnapshot = { ...tenant, tenantId: 't_other00001' }

describe('mapping fixtures (fixture mode)', () => {
  it('returns the source version list with exactly one active version', async () => {
    const versions = await getMappingVersions(tenant, 'manual_csv_upload')
    expect(versions.length).toBe(3)
    expect(versions.filter((v) => v.status === 'active')).toHaveLength(1)
    expect(versions.map((v) => v.status).sort()).toEqual(['active', 'deprecated', 'staged'])
  })

  it('returns an empty list for an unknown source', async () => {
    expect(await getMappingVersions(tenant, 'src_unknown')).toEqual([])
  })

  it('returns an empty list for another tenant (own-tenant only)', async () => {
    expect(await getMappingVersions(otherTenant, 'manual_csv_upload')).toEqual([])
  })

  it('returns the full definition for a known version', async () => {
    const detail = await getMappingVersion(tenant, 'manual_csv_upload', 2)
    expect(detail?.status).toBe('active')
    expect(detail?.mapping_rules.rename).toMatchObject({ item_code: 'sku_id' })
  })

  it('returns null for an unknown version', async () => {
    expect(await getMappingVersion(tenant, 'manual_csv_upload', 99)).toBeNull()
  })
})
