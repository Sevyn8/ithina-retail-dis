import { SAMPLE_QUERIES, executeQuery } from './ops-query'

describe('ops-query stub (fixture mode)', () => {
  it('returns a dynamic multi-column cross-tenant result for the normal query', async () => {
    const result = await executeQuery({ sql: SAMPLE_QUERIES.normal })
    expect(result.columns.map((c) => c.name)).toEqual(['tenant_id', 'rows'])
    expect(result.rows.length).toBeGreaterThan(1)
    expect(result.rows[0][0]).toBe('t_acme9k2l1mn4')
  })

  it('rejects the error query with a SQL-style message', async () => {
    await expect(executeQuery({ sql: SAMPLE_QUERIES.error })).rejects.toThrow(/Catalog Error/)
  })

  it('returns columns with zero rows for the empty query', async () => {
    const result = await executeQuery({ sql: SAMPLE_QUERIES.empty })
    expect(result.columns.length).toBeGreaterThan(0)
    expect(result.rows).toEqual([])
  })
})
