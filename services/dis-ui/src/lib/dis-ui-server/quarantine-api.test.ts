import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearToken, writeToken } from '../../auth/storage'
import { getQuarantineDetail, getQuarantineList } from './quarantine-api'

// Tenant Quarantine reads (GET /quarantine[/{item_id}]). Fixture mode applies the filters
// client-side and serves inlined items; real mode builds the query string + path and GETs.

describe('quarantine-api fixture mode', () => {
  it('lists held items with the filter-independent open count', async () => {
    const res = await getQuarantineList({})
    expect(res.open_count).toBe(3)
    expect(res.items.length).toBe(3)
    // every held item carries the type-tagged id + the wire fields
    expect(res.items[0].id).toMatch(/^(row|chunk):/)
  })

  it('filters by source, error type, and status (resolved yields nothing)', async () => {
    expect((await getQuarantineList({ source: 'shopify_pos_v2' })).items).toHaveLength(1)
    expect((await getQuarantineList({ errorType: 'normalization' })).items).toHaveLength(1)
    const open = await getQuarantineList({ status: 'open' })
    expect(open.items.length).toBe(3)
    // resolved has no producing path (D82) -> empty, but open_count stays filter-independent
    const resolved = await getQuarantineList({ status: 'resolved' })
    expect(resolved.items).toHaveLength(0)
    expect(resolved.open_count).toBe(3)
  })

  it('fetches a detail by its type-tagged id; original_payload is always null', async () => {
    const detail = await getQuarantineDetail('row:0190ac0e-1a01-7001-8a01-000000000001')
    expect(detail.id).toBe('row:0190ac0e-1a01-7001-8a01-000000000001')
    expect(detail.original_payload).toBeNull()
    expect(detail.chain_depth).toBe(0)
    expect(detail.mapping_version).toBe(1)
    // a chunk pre-lookup failure carries no mapping version
    const chunk = await getQuarantineDetail('chunk:0190ac0e-1a01-7001-8a01-000000000003')
    expect(chunk.mapping_version).toBeNull()
  })
})

describe('quarantine-api real mode (mocked fetch)', () => {
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

  it('GETs /quarantine with the four filters as query params + a Bearer', async () => {
    const payload = { items: [], open_count: 0 }
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    await getQuarantineList({
      source: 'manual_csv_upload',
      errorType: 'canonical-shape',
      status: 'open',
      window: '24h',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'http://test.local/api/v1/quarantine?source=manual_csv_upload&error_type=canonical-shape&status=open&window=24h',
    )
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-123' })
  })

  it('GETs /quarantine/{item_id} with the type-tagged id encoded in the path', async () => {
    const detail = {
      id: 'row:abc',
      kind: 'row',
      trace_id: 't',
      source: 's',
      failed_at: '2026-06-09T09:00:00Z',
      mapping_version: 1,
      error_reason: 'POST_VALIDATION_FAILED',
      failure_stage: 'canonical-shape',
      error_context: 'x',
      original_payload: null,
      chain_depth: 0,
    }
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => ({ ok: true, status: 200, json: async () => detail }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    await getQuarantineDetail('row:0190ac0e-1a01-7001-8a01-000000000001')
    const [url] = fetchMock.mock.calls[0]
    // the ':' in the type-tagged id is percent-encoded in the path
    expect(url).toBe(
      'http://test.local/api/v1/quarantine/row%3A0190ac0e-1a01-7001-8a01-000000000001',
    )
  })
})
