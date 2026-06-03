import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

function renderAt(path: string) {
  return renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: [path] })
}

describe('AppRoutes', () => {
  it('renders the Tenant Dashboard at the index', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('still resolves /sources', async () => {
    renderAt('/sources')
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument()
  })

  it('resolves /notifications', async () => {
    renderAt('/notifications')
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('resolves /sources/:sourceId/shadow', async () => {
    renderAt('/sources/manual_csv_upload/shadow')
    expect(await screen.findByRole('heading', { name: /Shadow review: manual_csv_upload/ })).toBeInTheDocument()
  })

  // The screens themselves are covered by their own screen tests; no placeholder
  // routes remain.

  it('renders the not-found state for an unknown route', async () => {
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
