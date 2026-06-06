import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearToken, writeToken } from '../../auth/storage'
import {
  CATALOG_FIXTURE,
  canonicalTargetKeys,
  getTemplateMappingFields,
} from './mapping-fields'
import type { FieldDatatype, FieldSection } from './mapping-fields'

const SECTIONS: FieldSection[] = ['sale_event', 'change_event']
const DATATYPES: FieldDatatype[] = [
  'text',
  'integer',
  'number',
  'date',
  'datetime',
  'boolean',
  'choice',
  'json',
]

// T1: the catalog fixture must match the real TemplateMappingField contract
// (services/dis-ui-server/.../schemas/mapping_fields.py) so the real-mode switch is a swap.
describe('template-mapping-fields catalog (fixture shaped to the real contract)', () => {
  it('every entry has the contract fields with valid enums', () => {
    for (const field of CATALOG_FIXTURE) {
      expect(typeof field.key).toBe('string')
      expect(typeof field.display_name).toBe('string')
      expect(SECTIONS).toContain(field.section)
      expect(typeof field.mandatory).toBe('boolean')
      expect(DATATYPES).toContain(field.datatype)
      expect(typeof field.description).toBe('string')
      // allowed_values present only for choice fields
      if (field.datatype === 'choice') {
        expect(Array.isArray(field.allowed_values)).toBe(true)
        expect(field.allowed_values?.length).toBeGreaterThan(0)
      }
      // max_length, when present, is a positive number
      if (field.max_length !== undefined) {
        expect(field.max_length).toBeGreaterThan(0)
      }
    }
  })

  it('carries the real event field set (both sections), not the old curated subset', () => {
    const sale = CATALOG_FIXTURE.filter((f) => f.section === 'sale_event').map((f) => f.key)
    const change = CATALOG_FIXTURE.filter((f) => f.section === 'change_event').map((f) => f.key)
    // real sale_event keys
    expect(sale).toEqual(expect.arrayContaining(['sku_id', 'quantity', 'source_sale_timestamp', 'currency']))
    // real change_event keys
    expect(change).toEqual(expect.arrayContaining(['event_category', 'attribute_name', 'source_event_timestamp']))
    // the catalog is event-only: legacy hot/identity targets are absent
    const allKeys = CATALOG_FIXTURE.map((f) => f.key)
    for (const absent of ['store_id', 'current_retail_price', 'product_name', 'product_description', 'tax_treatment']) {
      expect(allKeys).not.toContain(absent)
    }
  })

  it('exposes mandatory + section metadata (both sections present, some mandatory)', () => {
    expect(CATALOG_FIXTURE.some((f) => f.section === 'sale_event')).toBe(true)
    expect(CATALOG_FIXTURE.some((f) => f.section === 'change_event')).toBe(true)
    expect(CATALOG_FIXTURE.some((f) => f.mandatory)).toBe(true)
    // a known choice field carries its allowed values
    const subtype = CATALOG_FIXTURE.find((f) => f.section === 'sale_event' && f.key === 'event_subtype')
    expect(subtype?.allowed_values).toEqual(['SALE', 'RETURN', 'VOID'])
  })

  it('getter returns a copy of the catalog (fixture mode)', async () => {
    const result = await getTemplateMappingFields()
    expect(result).toHaveLength(CATALOG_FIXTURE.length)
    expect(result).not.toBe(CATALOG_FIXTURE)
  })

  it('canonicalTargetKeys de-dupes keys across sections', () => {
    const keys = canonicalTargetKeys(CATALOG_FIXTURE)
    expect(new Set(keys).size).toBe(keys.length) // no duplicates
    expect(keys).toContain('sku_id') // appears in both sections, listed once
  })
})

// T10: real-mode wiring (mocked fetch).
describe('template-mapping-fields real mode (T10)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DIS_UI_SERVER_MODE', 'real')
    vi.stubEnv('VITE_DIS_UI_SERVER_BASE_URL', 'http://test.local')
    writeToken('tok-123')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    clearToken()
  })

  it('GETs /api/v1/template-mapping-fields with a Bearer and parses the catalog', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => CATALOG_FIXTURE }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const fields = await getTemplateMappingFields()
    expect(fields).toEqual(CATALOG_FIXTURE)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://test.local/api/v1/template-mapping-fields')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-123' })
  })
})
