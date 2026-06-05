import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { getStoresOnboarded } from './stores'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}

// T2: OnboardedStore fixtures shaped to the real /api/v1/stores-onboarded contract.
describe('stores-onboarded fixtures (shaped to the real contract)', () => {
  it('returns the tenant stores with the contract fields', async () => {
    const stores = await getStoresOnboarded(tenant)
    expect(stores.length).toBeGreaterThan(0)
    for (const store of stores) {
      for (const key of [
        'store_id',
        'name',
        'store_code',
        'status',
        'country',
        'timezone',
        'currency',
        'tax_treatment',
      ]) {
        expect(store).toHaveProperty(key)
      }
      expect(['opening', 'active', 'inactive', 'closed']).toContain(store.status)
      expect(['inclusive', 'exclusive']).toContain(store.tax_treatment)
    }
  })

  it('serves store_code as null when absent (nullable at source, D55)', async () => {
    const stores = await getStoresOnboarded(tenant)
    expect(stores.some((s) => s.store_code === null)).toBe(true)
    expect(stores.some((s) => typeof s.store_code === 'string')).toBe(true)
  })
})
