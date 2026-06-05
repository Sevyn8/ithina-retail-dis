import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
    // Selector-only update for slice 23 chrome: the active marker moved from
    // `font-semibold` to the sidebar-accent chrome. The asserted behavior (the active
    // route is visually marked) is unchanged.
    expect(screen.getByRole('link', { name: 'Sources' }).className).toContain('bg-sidebar-accent')
  })

  it('shows the Ops Fleet nav item for ops and hides it for tenant (default NAV_ITEMS)', () => {
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Ops Fleet' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.getByRole('link', { name: 'Ops Fleet' })).toBeInTheDocument()
  })

  it('shows the Fleet Quarantine and Fleet Audit ops items for ops only (default NAV_ITEMS)', () => {
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Fleet Quarantine' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fleet Audit' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.getByRole('link', { name: 'Fleet Quarantine' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fleet Audit' })).toBeInTheDocument()
  })

  it('shows the Query ops item for ops only (default NAV_ITEMS)', () => {
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Query' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.getByRole('link', { name: 'Query' })).toBeInTheDocument()
  })

  it('renders the renamed tenant nav labels (Create Template, Ingest Data) and not the old ones', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.getByRole('link', { name: 'Ingest Data' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Template' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload' })).not.toBeInTheDocument()
    // The old "Sources"/"Manage Sources" top-level nav items are gone (source management is
    // reached from Ingest Data's per-source "Manage source").
    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage Sources' })).not.toBeInTheDocument()
  })

  it('renders an "Add Source" item routing to the connector picker, below "Create Template"', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    const addSource = screen.getByRole('link', { name: 'Add Source' })
    expect(addSource).toHaveAttribute('href', '/connect')
    // ordered immediately below Create Template
    const links = screen.getAllByRole('link')
    const createIdx = links.findIndex((l) => l.textContent === 'Create Template')
    const addIdx = links.findIndex((l) => l.textContent === 'Add Source')
    expect(createIdx).toBeGreaterThanOrEqual(0)
    expect(addIdx).toBe(createIdx + 1)
  })

  it('collapses and expands', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar items={ITEMS} />, { snapshot: tenantSnapshot })
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
  })
})
