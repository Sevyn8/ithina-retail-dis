import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as opsFleet from '../lib/dis-ui-server/ops-fleet'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const ops: AuthSnapshot = {
  userId: 'u_opsdev0001',
  tenantId: null,
  storeId: null,
  roles: ['dis:ops', 'dis:read', 'dis:mapping_admin'],
}

// Rendered via AppRoutes so the ops route-guard + shell are exercised.
function renderFleet() {
  return renderWithProviders(<AppRoutes />, { snapshot: ops, initialEntries: ['/ops/fleet'] })
}

describe('OpsFleet (ops slice)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the fleet summary and per-tenant table for an ops persona', async () => {
    renderFleet()
    expect(await screen.findByRole('heading', { name: 'Ops Fleet' })).toBeInTheDocument()
    // summary metric (tenant count) + a per-tenant row with its health badge
    expect(screen.getByText('Acme Retail')).toBeInTheDocument()
    expect(screen.getByText('Delta Foods')).toBeInTheDocument()
    expect(screen.getByText('failing')).toBeInTheDocument()
  })

  it('shows the error state when the fleet query errors', () => {
    const errored = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    }
    vi.spyOn(opsFleet, 'useFleetSummary').mockReturnValue(
      errored as unknown as ReturnType<typeof opsFleet.useFleetSummary>,
    )
    vi.spyOn(opsFleet, 'useFleetTenants').mockReturnValue(
      errored as unknown as ReturnType<typeof opsFleet.useFleetTenants>,
    )
    renderFleet()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the fleet/i)
  })
})
