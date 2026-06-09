import { screen, within } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as mappingTemplates from '../lib/dis-ui-server/mapping-templates'
import { renderWithProviders } from '../test/renderWithProviders'
import { Dashboard } from './Dashboard'

// The tenant fixture seeds four mapping templates (Sales active v2, Inventory active v1, Pricing
// draft v1, Orders active v1) -> 3 active pipelines. The dashboard is an honest skeleton: only the
// pipelines list/count and the friendly type labels are real; everything else is a placeholder.
const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const emptyTenant: AuthSnapshot = { ...tenant, tenantId: 't_nofixtures01' }

describe('Dashboard (honest skeleton)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes the Add source affordance to Connect a System', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByRole('link', { name: 'Add source' })).toHaveAttribute(
      'href',
      '/connectors/new',
    )
  })

  it('shows the REAL active-pipelines count and "Metrics pending" for the other KPIs (no numbers)', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    // REAL: 3 templates have an active version (Sales, Inventory, Orders).
    expect(screen.getByText('Active pipelines')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // The three metric tiles with no endpoint render an honest placeholder, never a number.
    expect(screen.getByText('Rows ingested (24h)')).toBeInTheDocument()
    expect(screen.getByText('Quarantine rate (24h)')).toBeInTheDocument()
    expect(screen.getByText('Freshness')).toBeInTheDocument()
    expect(screen.getAllByText('Metrics pending')).toHaveLength(3)
  })

  it('renders honest placeholders for Needs attention, Flow, and Quality (no fabricated data)', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(
      screen.getByText(/Alerts appear here once data-quality metrics are available/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(
      screen.getByText(/Per-source volume and freshness will appear here/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(
      screen.getByText(/Pass rate and rejection reasons will appear here/i),
    ).toBeInTheDocument()
  })

  it('renders the REAL pipelines table (name, friendly type, status) with no "Last received" column', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByText('Pipelines')).toBeInTheDocument()
    // template names (Sales collides with its own type label, so it is not asserted via getByText)
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
    // friendly template-type label from /template-types (proves the labeling is sourced, distinct
    // from any template name)
    expect(screen.getByText('Inventory change')).toBeInTheDocument()
    // status badges from the real lineage (Sales active v2; Pricing draft v1)
    expect(screen.getByText('Active v2')).toBeInTheDocument()
    expect(screen.getByText('Draft v1')).toBeInTheDocument()
    // names link to the template detail
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/sources/square_pos/templates/0190ac10-5a00-7000-8a00-0000000000b1',
    )
    // the column header set has no "Last received" (needs an upload-history endpoint)
    expect(screen.queryByRole('columnheader', { name: 'Last received' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Health' })).toBeInTheDocument()
  })

  it('removes the previously-fabricated metrics (no fake numbers remain)', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    // the old fixture rollup figures + section are gone
    expect(screen.queryByText('2,079')).not.toBeInTheDocument()
    expect(screen.queryByText('6800 ms')).not.toBeInTheDocument()
    expect(screen.queryByText('P95 latency')).not.toBeInTheDocument()
    expect(screen.queryByText('Where your data comes from')).not.toBeInTheDocument()
    expect(screen.queryByText('Health by source')).not.toBeInTheDocument()
  })

  it('renders the skeleton with an empty pipelines state for a tenant with no templates', async () => {
    renderWithProviders(<Dashboard />, { snapshot: emptyTenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    // active count is 0 (no fabricated data) and the pipelines panel shows its empty state
    expect(screen.getByText('Active pipelines')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText(/No pipelines yet/i)).toBeInTheDocument()
  })

  it('shows the loading state while templates are pending', () => {
    vi.spyOn(mappingTemplates, 'useMappingTemplates').mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof mappingTemplates.useMappingTemplates>)
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument()
  })

  it('shows the error state when the templates query errors', () => {
    vi.spyOn(mappingTemplates, 'useMappingTemplates').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof mappingTemplates.useMappingTemplates>)
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the dashboard/i)
  })

  it('renders under the dark theme class', async () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <Dashboard />
      </div>,
      { snapshot: tenant },
    )
    expect(await within(container).findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(within(container).getByText('Pipelines')).toBeInTheDocument()
  })
})
