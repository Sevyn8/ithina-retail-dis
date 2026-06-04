import { screen } from '@testing-library/react'

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

  it('renders the per-source rollup and the latency snapshot', async () => {
    renderWithProviders(<Dashboard />, { snapshot: tenant })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    // rollup
    expect(screen.getByText('Manual CSV Upload')).toBeInTheDocument()
    expect(screen.getByText('Shopify POS')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText(/1,?247/)).toBeInTheDocument() // rows_24h (locale-tolerant)
    // latency now renders as metric stat cards (selector-only update for slice 23
    // craft bar; the values are unchanged)
    expect(screen.getByText('2100 ms')).toBeInTheDocument()
    expect(screen.getByText('11200 ms')).toBeInTheDocument()
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
