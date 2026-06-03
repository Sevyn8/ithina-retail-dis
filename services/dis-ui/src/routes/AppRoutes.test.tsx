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

describe('AppRoutes (Phase 1)', () => {
  it('redirects the index to /sources', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument()
  })

  // All five Phase-1 screens are now real (Checkpoints 2-5) and are covered by
  // their own screen tests; no placeholder routes remain.

  it('renders the not-found state for an unknown route', async () => {
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
