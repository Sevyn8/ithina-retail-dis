import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import * as sources from '../lib/dis-ui-server/sources'
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
})
