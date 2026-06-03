import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { Sidebar } from './Sidebar'
import type { NavItem } from './nav'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}
const opsSnapshot: AuthSnapshot = {
  userId: 'u_opsdev0001',
  tenantId: null,
  storeId: null,
  roles: ['dis:ops', 'dis:read'],
}

// Inject an ops-flagged item so the gate is exercised without registering a real
// ops surface this slice.
const ITEMS: NavItem[] = [
  { label: 'Sources', to: '/sources' },
  { label: 'Ops Fleet', to: '/ops/fleet', ops: true },
]

describe('Sidebar nav gating', () => {
  it('always renders tenant items', () => {
    renderWithProviders(<Sidebar items={ITEMS} />, { snapshot: tenantSnapshot })
    expect(screen.getByRole('link', { name: 'Sources' })).toBeInTheDocument()
  })

  it('hides ops items from a tenant snapshot', () => {
    renderWithProviders(<Sidebar items={ITEMS} />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Ops Fleet' })).not.toBeInTheDocument()
  })

  it('shows ops items for an ops snapshot', () => {
    renderWithProviders(<Sidebar items={ITEMS} />, { snapshot: opsSnapshot })
    expect(screen.getByRole('link', { name: 'Ops Fleet' })).toBeInTheDocument()
  })

  it('marks the active route', () => {
    renderWithProviders(<Sidebar items={ITEMS} />, {
      snapshot: tenantSnapshot,
      initialEntries: ['/sources'],
    })
    expect(screen.getByRole('link', { name: 'Sources' }).className).toContain('font-semibold')
  })
})
