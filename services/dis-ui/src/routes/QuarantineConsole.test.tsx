import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as quarantine from '../lib/dis-ui-server/quarantine'
import { __resetQuarantineFixture } from '../lib/dis-ui-server/quarantine'
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
  beforeEach(() => {
    __resetQuarantineFixture()
  })
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

  it('opens the resubmit confirm with replay and fixed_file choices', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical }))
    await user.click(await screen.findByRole('button', { name: 'Resubmit' }))
    expect(screen.getByText('Resubmit this row?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /replay/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /fixed_file/i })).toBeInTheDocument()
  })

  it('confirming fixed_file calls the mutation with the 4.3 body', async () => {
    const user = userEvent.setup()
    // Spy the hook the component imports (namespace-resolved, so it intercepts) and
    // capture the body handed to mutate(). The internal postResubmit call cannot be
    // spied (same-module binding), so we assert the body at the hook boundary.
    const mutate = vi.fn()
    vi.spyOn(quarantine, 'useResubmit').mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof quarantine.useResubmit>)
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical }))
    await user.click(await screen.findByRole('button', { name: 'Resubmit' }))
    await user.click(screen.getByRole('radio', { name: /fixed_file/i }))
    await user.click(screen.getByRole('button', { name: 'Confirm resubmit' }))
    expect(mutate.mock.calls[0][0]).toEqual({
      resubmit_type: 'fixed_file',
      parent_trace_id: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical,
    })
  })

  it('reflects the new chain depth after a real resubmit (list + detail refetch)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical }))
    await user.click(await screen.findByRole('button', { name: 'Resubmit' }))
    await user.click(screen.getByRole('button', { name: 'Confirm resubmit' }))
    // detail refetched via shared-prefix invalidation: chain depth advanced to 1
    expect(await screen.findByText('Chain depth: 1')).toBeInTheDocument()
  })

  it('disables resubmit with the reason for a row at the chain-depth cap', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeNormalization }))
    const button = await screen.findByRole('button', { name: 'Resubmit' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Chain depth 3 reached/)).toBeInTheDocument()
  })

  it('does not render a Resolve action (ops-only, out of scope)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuarantineConsole />, { snapshot: tenant })
    await user.click(await screen.findByRole('button', { name: quarantine.QUARANTINE_TRACE_IDS.acmeCanonical }))
    await screen.findByRole('heading', { name: 'Row detail' })
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument()
  })
})
