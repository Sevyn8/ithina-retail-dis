import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as quarantine from '../lib/dis-ui-server/quarantine'
import { renderWithProviders } from '../test/renderWithProviders'
import { QuarantineConsole } from './QuarantineConsole'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:read'],
}
const emptyTenant: AuthSnapshot = { ...tenant, tenantId: 't_nofixtures01' }

describe('QuarantineConsole (tenant slice)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the fixture rows', async () => {
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    expect(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.shopifySourceShape })).toBeInTheDocument()
    expect(screen.getAllByText('Manual CSV Upload').length).toBeGreaterThan(0)
  })

  it('narrows the list by source', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical })
    await user.selectOptions(screen.getByLabelText('Source filter'), 'Shopify POS')
    expect(screen.getByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.shopifySourceShape })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical })).not.toBeInTheDocument()
  })

  it('narrows the list by status', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical })
    await user.selectOptions(screen.getByLabelText('Status filter'), 'resolved')
    expect(screen.getByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.shopifyFk })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical })).not.toBeInTheDocument()
  })

  it('opens row detail with payload and mapping version', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical }))
    expect(await screen.findByRole('heading', { name: 'Row detail' })).toBeInTheDocument()
    expect(screen.getByText(/A123/)).toBeInTheDocument() // original payload
    expect(screen.getByText(/· v1/)).toBeInTheDocument() // processing mapping version
  })

  it('shows the empty state for a tenant with no rows', async () => {
    renderWithProviders(<QuarantineConsole />, { snapshot: emptyTenant })
    expect(await screen.findByRole('heading', { name: 'No quarantined rows' })).toBeInTheDocument()
  })

  it('shows the error state when the list query errors', () => {
    vi.spyOn(quarantine, 'useQuarantine').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof quarantine.useQuarantine>)
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load quarantined rows/i)
  })
})
