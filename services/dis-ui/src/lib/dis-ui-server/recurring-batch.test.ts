import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import {
  UPLOAD_SESSION_TEMPLATE_CARRY_PROVISIONAL,
  createRecurringBatchSession,
} from './recurring-batch'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}
// mapping-templates.ts fixtures.
const SALES_TEMPLATE_ID = '0190ac10-5a00-7000-8a00-0000000000a1' // active v2, mapping_version_id 38
const PRICING_TEMPLATE_ID = '0190ac10-5a00-7000-8a00-0000000000a3' // draft only, no active version

// T4: the recurring-batch upload-session is the ONLY coupling to the PROPOSED (not-yet-built)
// upload-session template-carry shape. It is fixture-only and flagged provisional.
describe('recurring-batch upload-session (provisional, fixture)', () => {
  it('is flagged provisional', () => {
    expect(UPLOAD_SESSION_TEMPLATE_CARRY_PROVISIONAL).toBe(true)
  })

  it('resolves the template active version into the session (reuse, not re-map)', async () => {
    const result = await createRecurringBatchSession(tenant, {
      source_id: 'manual_csv_upload',
      template_id: SALES_TEMPLATE_ID,
      intent: 'recurring_batch',
    })
    // the active version that WILL be applied (Sales active v2 -> mapping_version_id 38)
    expect(result.mapping_version_id).toBe(38)
    expect(result.intent).toBe('recurring_batch')
    // honest provisional id, shaped to the real upload-session pattern
    expect(result.upload_session_id).toMatch(/^us_[a-z0-9]{12}$/)
  })

  it('rejects when the template has no active version (cannot reuse a never-activated mapping)', async () => {
    await expect(
      createRecurringBatchSession(tenant, {
        source_id: 'manual_csv_upload',
        template_id: PRICING_TEMPLATE_ID,
        intent: 'recurring_batch',
      }),
    ).rejects.toThrow(/no active version/)
  })
})
