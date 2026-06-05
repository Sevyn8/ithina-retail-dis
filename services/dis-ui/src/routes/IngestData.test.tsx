import { screen, within } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

function render(dark = false) {
  return renderWithProviders(dark ? <div className="dark"><AppRoutes /></div> : <AppRoutes />, {
    snapshot: tenant,
    initialEntries: ['/ingest'],
  })
}

// T5: Ingest Data is a FLAT list of all templates across sources, each row showing its source,
// with a per-row ingest action gated on an active version. Source CRUD stays reachable.
describe('IngestData (flat template list)', () => {
  it('lists templates across more than one source, each with its source context', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // two sources represented (manual_csv_upload + square_pos)
    expect(screen.getAllByText('manual_csv_upload').length).toBeGreaterThan(0)
    expect(screen.getByText('square_pos')).toBeInTheDocument()
    // template names from each source
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
  })

  it('offers a per-row ingest action, gated by active version', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // active templates (Sales, Inventory, Orders) -> enabled links; Pricing (no active) -> disabled
    expect(screen.getAllByRole('link', { name: 'Ingest data' }).length).toBeGreaterThanOrEqual(3)
    const disabled = screen.getByRole('button', { name: 'Ingest data' })
    expect(disabled).toBeDisabled()
    expect(disabled.getAttribute('title')).toMatch(/no active version/i)
  })

  it('keeps source management reachable via a "Manage sources" link to /sources', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    const manage = screen.getByRole('link', { name: 'Manage sources' })
    expect(manage).toHaveAttribute('href', '/sources')
  })

  it('links each row to the template detail', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    const views = screen.getAllByRole('link', { name: 'View' })
    expect(views.length).toBeGreaterThan(0)
    expect(views[0].getAttribute('href')).toMatch(/^\/sources\/[^/]+\/templates\//)
  })

  it('mounts under the dark theme class', async () => {
    const { container } = render(true)
    expect(await within(container).findByRole('heading', { name: 'Ingest Data' })).toBeInTheDocument()
  })
})
