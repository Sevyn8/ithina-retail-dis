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

// T6: Ingest Data lists all templates across sources GROUPED by source. Each source is a group
// heading (context) hosting a once-per-source "Manage source" link into SourceEdit; each
// template row keeps its View + active-gated Ingest action.
describe('IngestData (templates grouped by source)', () => {
  it('groups templates under their source, each source shown once for context', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // two sources represented (manual_csv_upload + square_pos), each as a group heading
    expect(screen.getByRole('heading', { name: 'manual_csv_upload' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'square_pos' })).toBeInTheDocument()
    // template names from each source
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
  })

  it('offers a per-template ingest action for FILE sources, gated by active version', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // file source (manual_csv_upload): Sales + Inventory active -> enabled links; Pricing
    // (no active) -> disabled. Orders is on an API source, so it is NOT an Ingest action.
    expect(screen.getAllByRole('link', { name: 'Ingest data' })).toHaveLength(2)
    const disabled = screen.getByRole('button', { name: 'Ingest data' })
    expect(disabled).toBeDisabled()
    expect(disabled.getAttribute('title')).toMatch(/no active version/i)
  })

  it('shows "Connected / syncing" for an API source instead of an ingest action (T8)', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // square_pos / Orders is an API/connector source: it syncs automatically, so no upload.
    expect(screen.getByText('Connected / syncing')).toBeInTheDocument()
    // the Orders row offers no link to the recurring-batch upload route (file-only). Scope to
    // template-upload routes (the sidebar "Create Template" /upload link has no /templates/).
    const uploadLinks = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
      .filter((href): href is string => href !== null && href.includes('/templates/') && href.endsWith('/upload'))
    expect(uploadLinks.length).toBe(2) // Sales + Inventory (file, active); Orders (api) has none
    expect(uploadLinks.some((href) => href.includes('square_pos'))).toBe(false)
  })

  it('offers a once-per-source "Manage source" link into SourceEdit (edit + deprecate)', async () => {
    render()
    await screen.findByRole('heading', { name: 'Ingest Data' })
    // one Manage source link per source (two sources in the fixture), not per template row
    const manage = screen.getAllByRole('link', { name: 'Manage source' })
    expect(manage).toHaveLength(2)
    const hrefs = manage.map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/sources/manual_csv_upload/edit')
    expect(hrefs).toContain('/sources/square_pos/edit')
    // the old flat-list "Manage sources" header link is gone
    expect(screen.queryByRole('link', { name: 'Manage sources' })).not.toBeInTheDocument()
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
