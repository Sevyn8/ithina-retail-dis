import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as sources from '../lib/dis-ui-server/sources'
import { __resetSourcesFixture } from '../lib/dis-ui-server/sources'
import { renderWithProviders } from '../test/renderWithProviders'
import { SourcesIndex } from './SourcesIndex'

const acmeSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

// A tenant with no source fixtures -> empty state.
const otherTenantSnapshot: AuthSnapshot = {
  userId: 'u_other0001',
  tenantId: 't_nofixtures01',
  storeId: null,
  roles: ['dis:read'],
}

describe('SourcesIndex', () => {
  beforeEach(() => {
    __resetSourcesFixture()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the tenant fixture sources', async () => {
    renderWithProviders(<SourcesIndex />, { snapshot: acmeSnapshot })
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByText('Manual CSV Upload')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mappings' })).toHaveAttribute(
      'href',
      '/sources/manual_csv_upload/mappings',
    )
  })

  it('shows the empty state for a tenant with no sources', async () => {
    renderWithProviders(<SourcesIndex />, { snapshot: otherTenantSnapshot })
    expect(await screen.findByRole('heading', { name: 'No sources' })).toBeInTheDocument()
  })

  it('shows the loading state on first paint', () => {
    renderWithProviders(<SourcesIndex />, { snapshot: acmeSnapshot })
    expect(screen.getByRole('status')).toHaveTextContent(/loading sources/i)
  })

  it('shows the error state when the sources query errors', () => {
    vi.spyOn(sources, 'useSources').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof sources.useSources>)
    renderWithProviders(<SourcesIndex />, { snapshot: acmeSnapshot })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load sources/i)
  })

  it('offers Create and per-row Edit/Deprecate actions, and no hard-delete control', async () => {
    renderWithProviders(<SourcesIndex />, { snapshot: acmeSnapshot })
    await screen.findByRole('heading', { name: 'Sources' })
    expect(screen.getByRole('link', { name: 'New source' })).toHaveAttribute('href', '/sources/new')
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/sources/manual_csv_upload/edit',
    )
    expect(screen.getByRole('button', { name: 'Deprecate' })).toBeInTheDocument()
    // FM1: there is no hard-delete control anywhere
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('deprecates a source via the confirm dialog (soft transition)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SourcesIndex />, { snapshot: acmeSnapshot })
    await screen.findByRole('heading', { name: 'Sources' })
    await user.click(screen.getByRole('button', { name: 'Deprecate' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm deprecate' }))
    expect(await screen.findByText('deprecated')).toBeInTheDocument()
  })
})
