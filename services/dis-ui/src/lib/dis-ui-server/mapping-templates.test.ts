import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import {
  activeTemplateVersion,
  getMappingTemplate,
  getMappingTemplates,
} from './mapping-templates'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const STATUSES = ['draft', 'staged', 'active', 'deprecated']

// T2: fixtures shaped to the real 14b mapping_templates contract.
describe('mapping-templates fixtures (shaped to the real contract)', () => {
  it('list returns lineage summaries with the contract fields', async () => {
    const list = await getMappingTemplates(tenant)
    expect(list.length).toBeGreaterThan(0)
    for (const t of list) {
      for (const key of [
        'template_id',
        'source_id',
        'template_name',
        'latest_version',
        'active_version',
        'staged_version',
        'draft_version',
        'versions_count',
        'created_at',
        'latest_version_created_at',
      ]) {
        expect(t).toHaveProperty(key)
      }
      // summary carries NO versions[] (that is detail-only)
      expect((t as Record<string, unknown>).versions).toBeUndefined()
    }
  })

  it('list filters by source_id', async () => {
    const all = await getMappingTemplates(tenant)
    const scoped = await getMappingTemplates(tenant, 'manual_csv_upload')
    expect(scoped.every((t) => t.source_id === 'manual_csv_upload')).toBe(true)
    expect(scoped.length).toBeGreaterThan(0)
    const none = await getMappingTemplates(tenant, 'no_such_source')
    expect(none).toEqual([])
    expect(all.length).toBeGreaterThanOrEqual(scoped.length)
  })

  it('detail returns the version lineage with raw-D49 mapping_rules', async () => {
    const list = await getMappingTemplates(tenant, 'manual_csv_upload')
    const sales = list.find((t) => t.template_name === 'Sales')
    expect(sales).toBeDefined()
    const detail = await getMappingTemplate(tenant, sales!.template_id)
    expect(detail.versions.length).toBe(detail.versions_count)
    for (const v of detail.versions) {
      expect(STATUSES).toContain(v.status)
      for (const key of [
        'mapping_version_id',
        'version',
        'status',
        'mapping_rules',
        'field_count',
        'transform_count',
        'predecessor_version_id',
        'created_at',
        'created_by_user_id',
        'activated_at',
        'deprecated_at',
      ]) {
        expect(v).toHaveProperty(key)
      }
      // raw D49 mapping_rules: the two concerns are present
      expect(v.mapping_rules).toHaveProperty('rename')
      expect(v.mapping_rules).toHaveProperty('normalize')
      expect(v.mapping_rules).toHaveProperty('cast')
      expect(v.mapping_rules).toHaveProperty('derive')
    }
    // the active version carries a date_format normalize + a decimal_separator (FM3 halves)
    const active = activeTemplateVersion(detail)
    expect(active?.status).toBe('active')
    expect(JSON.stringify(active?.mapping_rules.normalize)).toMatch(/date_format/)
    expect(JSON.stringify(active?.mapping_rules.normalize)).toMatch(/decimal_separator/)
    // store_id is never a field-mapping target (FM3)
    expect(Object.values(active?.mapping_rules.rename ?? {})).not.toContain('store_id')
  })

  it('detail throws for an unknown template (404 contract)', async () => {
    await expect(getMappingTemplate(tenant, 'no-such-template')).rejects.toThrow(/not found/)
  })
})
