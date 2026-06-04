import {
  POS_CONNECTORS_PROVISIONAL,
  POS_CONNECTOR_SPECS,
  POS_LOCATION_MAPPING_DEFERRED,
  posConnectorSpec,
} from './pos-connectors'

// The POS credential shapes are UI-PROPOSED, provisional, Sanjeev confirms (R5, FM2); and
// the location-to-store_id mapping is recorded deferred, not built (FM4).
describe('POS connector specs (provisional)', () => {
  it('flags the credential shapes as provisional (UI-proposed, Sanjeev confirms)', () => {
    expect(POS_CONNECTORS_PROVISIONAL).toBe(true)
  })

  it('records the location-to-store_id mapping as deferred (not built)', () => {
    expect(POS_LOCATION_MAPPING_DEFERRED).toMatch(/deferred/i)
    expect(POS_LOCATION_MAPPING_DEFERRED).toMatch(/identity_mirror/)
  })

  it('has a spec with representative credential fields for each POS type', () => {
    for (const key of ['shopify_pos', 'square', 'other'] as const) {
      const spec = POS_CONNECTOR_SPECS[key]
      expect(spec.key).toBe(key)
      expect(spec.connectLabel.length).toBeGreaterThan(0)
      expect(spec.credentialFields.length).toBeGreaterThan(0)
    }
  })

  it('resolves a known key and returns null for an unknown or non-POS key', () => {
    expect(posConnectorSpec('shopify_pos')).toBe(POS_CONNECTOR_SPECS.shopify_pos)
    expect(posConnectorSpec('csv')).toBeNull()
    expect(posConnectorSpec('nope')).toBeNull()
  })
})
