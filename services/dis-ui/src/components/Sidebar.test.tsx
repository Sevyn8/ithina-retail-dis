import { screen, within } from '@testing-library/react'
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
// ops surface this slice. T7: items carry a section (grouping is visual only).
const ITEMS: NavItem[] = [
  { label: 'Sources', to: '/sources', section: 'DATA' },
  { label: 'Ops Fleet', to: '/ops/fleet', ops: true, section: 'OPERATIONS' },
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

  it('no longer renders the retired Fleet Quarantine / Fleet Audit items (T9), even for ops', () => {
    // T9 merged the fleet views into the scope-aware Quarantine / Audit; the separate Fleet
    // items are gone for everyone.
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Fleet Quarantine' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fleet Audit' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.queryByRole('link', { name: 'Fleet Quarantine' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fleet Audit' })).not.toBeInTheDocument()
    // one scope-aware Quarantine + one Audit remain (MONITORING), for ops too
    expect(screen.getByRole('link', { name: 'Quarantine' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Audit' })).toBeInTheDocument()
  })

  it('OPERATIONS holds only Ops Fleet + Query for ops (no fleet Quarantine/Audit) (T9)', () => {
    const { container } = renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    const order = Array.from(container.querySelectorAll('h2, a')).map((el) => el.textContent)
    const opsIdx = order.indexOf('OPERATIONS')
    expect(opsIdx).toBeGreaterThanOrEqual(0)
    // everything after the OPERATIONS header is exactly Ops Fleet then Query
    expect(order.slice(opsIdx + 1)).toEqual(['Ops Fleet', 'Query'])
  })

  it('shows the Query ops item for ops only (default NAV_ITEMS)', () => {
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('link', { name: 'Query' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.getByRole('link', { name: 'Query' })).toBeInTheDocument()
  })

  it('renders the renamed tenant nav labels (Upload CSV, New CSV Template) and not the old ones', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.getByRole('link', { name: 'Upload CSV' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New CSV Template' })).toBeInTheDocument()
    // The prior labels are retired.
    expect(screen.queryByRole('link', { name: 'Ingest Data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create Template' })).not.toBeInTheDocument()
    // The old "Sources"/"Manage Sources" top-level nav items are gone (source management is
    // reached from the Upload CSV per-source "Manage source").
    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage Sources' })).not.toBeInTheDocument()
  })

  it('renders an "Add Source" item routing to the connector picker, below "New CSV Template"', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    const addSource = screen.getByRole('link', { name: 'Add Source' })
    expect(addSource).toHaveAttribute('href', '/connect')
    // ordered immediately below New CSV Template
    const links = screen.getAllByRole('link')
    const templateIdx = links.findIndex((l) => l.textContent === 'New CSV Template')
    const addIdx = links.findIndex((l) => l.textContent === 'Add Source')
    expect(templateIdx).toBeGreaterThanOrEqual(0)
    expect(addIdx).toBe(templateIdx + 1)
  })

  it('renders the brand header (DIS wordmark + DATA PLATFORM subtitle + placeholder mark)', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.getByText('DIS')).toBeInTheDocument()
    expect(screen.getByText('DATA PLATFORM')).toBeInTheDocument()
    // the placeholder mark is isolated (BrandMark); it carries the swap-point markers (T8: DIS)
    const mark = screen.getByTestId('brand-mark')
    expect(mark).toHaveAttribute('data-placeholder', 'dis-logo')
  })

  it('groups the tenant nav into OVERVIEW / DATA / MONITORING sections (no OPERATIONS)', () => {
    renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.getByRole('heading', { name: 'OVERVIEW' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'DATA' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'MONITORING' })).toBeInTheDocument()
    // OPERATIONS is ops-gated: its header auto-hides for a tenant (no visible items).
    expect(screen.queryByRole('heading', { name: 'OPERATIONS' })).not.toBeInTheDocument()
  })

  it('places each item under the right section header (DOM order)', () => {
    const { container } = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    // The DATA header is immediately followed by its three items, then MONITORING.
    const order = Array.from(container.querySelectorAll('h2, a')).map((el) => el.textContent)
    const dataIdx = order.indexOf('DATA')
    const monIdx = order.indexOf('MONITORING')
    expect(dataIdx).toBeGreaterThanOrEqual(0)
    expect(monIdx).toBeGreaterThan(dataIdx)
    expect(order.slice(dataIdx + 1, monIdx)).toEqual([
      'Upload CSV',
      'New CSV Template',
      'Add Source',
    ])
    // OVERVIEW (Dashboard) precedes DATA.
    expect(order.indexOf('OVERVIEW')).toBeLessThan(dataIdx)
  })

  it('shows the OPERATIONS section (header + items) only for an ops snapshot', () => {
    const tenantView = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    expect(screen.queryByRole('heading', { name: 'OPERATIONS' })).not.toBeInTheDocument()
    tenantView.unmount()
    renderWithProviders(<Sidebar />, { snapshot: opsSnapshot })
    expect(screen.getByRole('heading', { name: 'OPERATIONS' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ops Fleet' })).toBeInTheDocument()
  })

  it('renders thin-stroke icons on nav items', () => {
    const { container } = renderWithProviders(<Sidebar />, { snapshot: tenantSnapshot })
    // thin icons: strokeWidth 1.5 (lucide default is 2)
    const thin = container.querySelectorAll('svg[stroke-width="1.5"]')
    expect(thin.length).toBeGreaterThan(0)
  })

  it('mounts under the dark theme class', () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <Sidebar />
      </div>,
      { snapshot: tenantSnapshot },
    )
    expect(within(container).getByText('DIS')).toBeInTheDocument()
    expect(within(container).getByRole('heading', { name: 'DATA' })).toBeInTheDocument()
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
