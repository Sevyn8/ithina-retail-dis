import {
  createConnectorSource,
  exchangeToken,
  fetchLocations,
  fetchMappingSuggestions,
  fetchPreviewRows,
  fetchTemplateType,
  initiateOAuth,
  submitApiToken,
} from './connectors-api'
import { CATALOG_FIXTURE } from './mapping-fields'

// The connectors-api is the single STUB seam: it must resolve to the documented mock shapes
// and never touch the network. These assertions pin the shapes the step components rely on.

describe('connectors-api stub seam', () => {
  it('initiateOAuth returns an authorize URL + state', async () => {
    const init = await initiateOAuth('shopify', { shop_domain: 'acme.myshopify.com' })
    expect(init.authorizeUrl).toContain('acme.myshopify.com')
    expect(init.state).toContain('shopify')
  })

  it('exchangeToken and submitApiToken both return a read-only, token-stored account', async () => {
    const viaOauth = await exchangeToken('square', { state: 's' })
    const viaToken = await submitApiToken('clover', { api_token: 't' })
    for (const account of [viaOauth, viaToken]) {
      expect(account.readOnly).toBe(true)
      expect(account.tokenStored).toBe(true)
      expect(account.businessName.length).toBeGreaterThan(0)
    }
  })

  it('fetchLocations returns a non-empty location list', async () => {
    const locs = await fetchLocations('shopify')
    expect(locs.length).toBeGreaterThan(0)
    expect(locs[0]).toHaveProperty('id')
    expect(locs[0]).toHaveProperty('name')
  })

  it('mapping suggestions are shaped like the real response and target real catalog keys', async () => {
    const resp = await fetchMappingSuggestions('shopify', ['orders'])
    expect(resp.source).toBe('vertex')
    expect(resp.fields.length).toBeGreaterThan(0)
    const catalogKeys = new Set(CATALOG_FIXTURE.map((f) => f.key))
    for (const field of resp.fields) {
      expect(typeof field.confidence).toBe('number')
      expect('reasoning' in field).toBe(true)
      expect('detectedFormat' in field).toBe(true)
      // a suggested target is either null (unmapped) or a real catalog key
      if (field.suggestedTarget !== null) {
        expect(catalogKeys.has(field.suggestedTarget)).toBe(true)
      }
    }
  })

  it('fetchTemplateType returns a backend-provided value + label', async () => {
    const t = await fetchTemplateType()
    expect(t.value.length).toBeGreaterThan(0)
    expect(t.label.length).toBeGreaterThan(0)
  })

  it('fetchPreviewRows returns canonical-keyed rows', async () => {
    const rows = await fetchPreviewRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('sku_id')
  })

  it('createConnectorSource returns a live source echoing the input', async () => {
    const source = await createConnectorSource({
      connector: 'shopify',
      sourceName: 'Shop sales',
      authMethod: 'oauth',
      locationIds: ['loc_001'],
      dataTypes: ['orders'],
      cadence: 'daily',
      ignoredFields: [],
      templateType: 'sale_event',
    })
    expect(source.connector).toBe('shopify')
    expect(source.sourceName).toBe('Shop sales')
    expect(source.status).toBe('live')
  })
})
