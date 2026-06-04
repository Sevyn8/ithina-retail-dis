import { screen, within } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as dashboard from '../lib/dis-ui-server/dashboard'
import { renderWithProviders } from '../test/renderWithProviders'
import { Dashboard } from './Dashboard'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const emptyTenant: AuthSnapshot = { ...tenant, tenantId: 't_nofixtures01' }

describe('Dashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes the Add source affordance to the connector picker (R7)', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByRole('link', { name: 'Add source' })).toHaveAttribute('href', '/connect')
  })

  it('renders the metric cards and the per-source rollup', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    // metric cards, all from the rollup (R6): rows ingested (1247+832), active source types,
    // P95 latency. (Selector update for the richer-dashboard layout; values from the rollup.)
    expect(screen.getByText('Rows ingested (24h)')).toBeInTheDocument()
    expect(screen.getByText('2,079')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 types')).toBeInTheDocument()
    expect(screen.getByText('6800 ms')).toBeInTheDocument()
    // health-by-source rollup (Manual CSV Upload is unique to the health table; Shopify POS
    // also appears as the breakdown label, so it is non-unique now)
    expect(screen.getByText('Manual CSV Upload')).toBeInTheDocument()
    expect(screen.getAllByText('Shopify POS').length).toBeGreaterThan(0)
    expect(screen.getByText('warning')).toBeInTheDocument()
  })

  it('renders the source-type breakdown: connected types with volume, others dimmed', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByText('Where your data comes from')).toBeInTheDocument()
    // connected types show their identity label + volume from the rollup
    expect(screen.getByText('CSV upload')).toBeInTheDocument()
    expect(screen.getByText('1,247 rows (24h)')).toBeInTheDocument()
    expect(screen.getByText('832 rows (24h)')).toBeInTheDocument()
    // not-connected types (square, other) are dimmed roadmap rows, no fabricated numbers
    expect(screen.getByText('Square')).toBeInTheDocument()
    expect(screen.getByText('Other POS/ERP')).toBeInTheDocument()
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
  })

  it('uses the R1 source-type identity (literal classes) in the breakdown and rows', async () => {
    const { container } = renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(container.querySelector('.text-source-csv')).not.toBeNull()
    expect(container.querySelector('.text-source-shopify-pos')).not.toBeNull()
  })

  it('renders under the dark theme class (both modes)', async () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <Dashboard />
      </div>,
      { snapshot: tenant },
    )
    expect(await within(container).findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(within(container).getByText('Where your data comes from')).toBeInTheDocument()
  })

  it('links each source name to its mappings and the open-quarantine count to the filtered console', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    await screen.findByRole('heading', { name: 'Dashboard' })
    // source name -> that source's mappings, keyed by source_id
    expect(screen.getByRole('link', { name: 'Manual CSV Upload' })).toHaveAttribute(
      'href',
      '/sources/manual_csv_upload/mappings',
    )
    expect(screen.getByRole('link', { name: 'Shopify POS' })).toHaveAttribute(
      'href',
      '/sources/shopify_pos_v2/mappings',
    )
    // open count > 0 (shopify: 2) -> Quarantine pre-filtered by source_id
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/quarantine?source=shopify_pos_v2',
    )
    // open count 0 (manual) is plain text, not a link (FM4)
    expect(screen.queryByRole('link', { name: '0' })).not.toBeInTheDocument()
  })

  it('shows the empty state for a tenant with no data', async () => {
    renderWithProviders(<Dashboard />, { snapshot: emptyTenant })
    expect(await screen.findByRole('heading', { name: 'No dashboard data' })).toBeInTheDocument()
  })

  it('shows the error state when the summary query errors', () => {
    vi.spyOn(dashboard, 'useDashboardSummary').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof dashboard.useDashboardSummary>)
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the dashboard/i)
  })
})
