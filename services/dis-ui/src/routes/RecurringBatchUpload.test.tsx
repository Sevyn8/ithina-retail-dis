import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}
// mapping-templates.ts fixtures.
const SALES = '0190ac10-5a00-7000-8a00-0000000000a1' // active v2, mapping_version_id 38
const PRICING = '0190ac10-5a00-7000-8a00-0000000000a3' // draft only, no active version
const TEMPLATES = '/sources/manual_csv_upload/templates'

function render(path: string, dark = false) {
  return renderWithProviders(dark ? <div className="dark"><AppRoutes /></div> : <AppRoutes />, {
    snapshot: tenant,
    initialEntries: [path],
  })
}

// T4: a recurring batch reuses a template's ACTIVE mapping - no re-mapping, no review. The
// "Upload new batch" action is gated on an active version existing; the flow shows the active
// mapping read-only and confirms via the PROVISIONAL upload-session seam (not yet built).
describe('RecurringBatchUpload (reuse active mapping, provisional)', () => {
  // (a) the action appears and is active-version-gated
  it('offers "Upload new batch" on the template detail, enabled for an active template', async () => {
    render(`${TEMPLATES}/${SALES}`)
    await screen.findByRole('heading', { name: 'Sales' })
    expect(screen.getByRole('link', { name: 'Upload new batch' })).toBeInTheDocument()
  })

  it('disables "Upload new batch" with a reason when the template has no active version', async () => {
    render(`${TEMPLATES}/${PRICING}`)
    await screen.findByRole('heading', { name: 'Pricing' })
    expect(screen.getByRole('button', { name: 'Upload new batch' })).toBeDisabled()
    expect(screen.getByText(/No active version to reuse yet/)).toBeInTheDocument()
  })

  it('shows the action per-template in the templates list, gated by active version', async () => {
    render(TEMPLATES)
    await screen.findByRole('heading', { name: /Templates: manual_csv_upload/ })
    // Sales + Inventory are active -> enabled links; Pricing has no active -> disabled button
    expect(screen.getAllByRole('link', { name: 'Upload new batch' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Upload new batch' })).toBeDisabled()
  })

  // (b) the flow reuses the active mapping READ-ONLY and never shows the editable review
  it('shows the active version and a read-only mapping summary, not an editable review', async () => {
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Upload new batch' })
    // which version will apply
    expect(screen.getByText('Sales v2')).toBeInTheDocument()
    // read-only field mappings + format rules reused from the T2/T3 display
    expect(screen.getByText('Field mappings')).toBeInTheDocument()
    expect(screen.getByText('item_code')).toBeInTheDocument()
    expect(screen.getByText('sku_id')).toBeInTheDocument()
    expect(screen.getByText(/format=%d-%m-%Y/)).toBeInTheDocument()
    // NOT a re-map: no editable review controls
    expect(screen.queryByLabelText(/Canonical for/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Decimal separator for/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue to preview/i })).not.toBeInTheDocument()
  })

  // (c) dropzone + confirm create a recurring_batch session via the provisional fixture
  it('confirms a provisional batch session that resolves the active mapping version', async () => {
    const user = userEvent.setup()
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Upload new batch' })
    expect(screen.getByLabelText('CSV file')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /upload batch/i }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/mapping_version_id 38/)
    expect(status).toHaveTextContent(/not actually ingested/i)
  })

  // (d) honest, provisional demo banner
  it('renders a provisional demo banner (not built yet, file not ingested)', async () => {
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Upload new batch' })
    expect(screen.getByText(/Provisional demo/)).toBeInTheDocument()
    expect(screen.getByText(/has not built yet/)).toBeInTheDocument()
  })

  // (e) direct navigation to a no-active template is guarded honestly (no dropzone)
  it('guards direct navigation when the template has no active version', async () => {
    render(`${TEMPLATES}/${PRICING}/upload`)
    await screen.findByRole('heading', { name: 'Upload new batch' })
    expect(screen.getByText(/No active version yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument()
  })

  it('mounts under the dark theme class', async () => {
    const { container } = render(`${TEMPLATES}/${SALES}/upload`, true)
    expect(await within(container).findByRole('heading', { name: 'Upload new batch' })).toBeInTheDocument()
  })
})
