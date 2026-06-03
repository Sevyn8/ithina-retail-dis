import { approveSample, createSample, dryRunSample, getSample } from './onboarding'

describe('onboarding fixtures (fixture mode)', () => {
  it('createSample returns a sample_id and received status', async () => {
    const result = await createSample({ source_kind: 'csv', label: 'POS-CSV-Main' })
    expect(result.sample_id).toBe('smp_acme0001')
    expect(result.status).toBe('received')
    expect(result.gcs_uri).toContain('smp_acme0001')
  })

  it('getSample returns the ready analysis for a known sample', async () => {
    const analysis = await getSample('smp_acme0001')
    expect(analysis.status).toBe('ready')
    expect(analysis.columns.map((c) => c.source_col)).toContain('item_code')
    // confidence bands present: >=0.70, <0.70, <0.50
    const byCol = Object.fromEntries(analysis.columns.map((c) => [c.source_col, c.confidence]))
    expect(byCol.item_code).toBeGreaterThanOrEqual(0.7)
    expect(byCol.txn_date).toBeLessThan(0.7)
    expect(byCol.pos_terminal).toBeLessThan(0.5)
  })

  it('getSample rejects for an unknown sample id', async () => {
    await expect(getSample('smp_does_not_exist')).rejects.toThrow(/no fixture/)
  })

  it('dryRunSample returns preview rows', async () => {
    const result = await dryRunSample('smp_acme0001')
    expect(result.rows.length).toBeGreaterThan(0)
  })

  it('approveSample returns staged with the seeded source id', async () => {
    const result = await approveSample('smp_acme0001')
    expect(result).toEqual({ source_id: 'manual_csv_upload', mapping_version: 1, status: 'staged' })
  })
})
