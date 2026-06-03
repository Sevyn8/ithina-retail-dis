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

describe('AppRoutes (Phase 1 skeleton)', () => {
  it('redirects the index to /sources', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument()
  })

  it.each([
    ['/upload', /Sample Upload/i],
    ['/upload/smp_1/review', /Mapping Review/i],
    ['/quarantine', /Quarantine/i],
    ['/audit', /Audit/i],
    ['/sources/manual_csv_upload/mappings', /Mapping Versions/i],
  ])('resolves placeholder route %s', async (path, heading) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('renders the not-found state for an unknown route', async () => {
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
