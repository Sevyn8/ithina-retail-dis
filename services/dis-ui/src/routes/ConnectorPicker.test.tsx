import { screen, within } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { sourceIdentity } from '../components/source-identity'
import { renderWithProviders } from '../test/renderWithProviders'
import { ConnectorPicker } from './ConnectorPicker'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

describe('ConnectorPicker (R2, net-new)', () => {
  it('renders the CSV hero and the three coming-soon POS cards', () => {
    renderWithProviders(<ConnectorPicker />, { snapshot: tenant })
    expect(screen.getByRole('heading', { name: 'Add a source' })).toBeInTheDocument()
    expect(screen.getByText('CSV upload')).toBeInTheDocument()
    expect(screen.getByText('Shopify POS')).toBeInTheDocument()
    expect(screen.getByText('Square')).toBeInTheDocument()
    expect(screen.getByText('Other POS/ERP')).toBeInTheDocument()
  })

  it('routes the CSV hero CTA toward the journey upload entry', () => {
    renderWithProviders(<ConnectorPicker />, { snapshot: tenant })
    expect(screen.getByRole('link', { name: /upload a csv/i })).toHaveAttribute('href', '/upload')
  })

  it('shows the POS connectors as honestly coming-soon (no faked connect)', () => {
    renderWithProviders(<ConnectorPicker />, { snapshot: tenant })
    // a "Soon" marker for each POS connector
    expect(screen.getAllByText('Soon')).toHaveLength(3)
    // every Connect affordance is disabled, and none navigates anywhere
    const connects = screen.getAllByRole('button', { name: 'Connect' })
    expect(connects).toHaveLength(3)
    for (const button of connects) {
      expect(button).toBeDisabled()
    }
    // the only link on the screen is the CSV CTA; no POS/connect link exists
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/upload')
  })

  it('labels every connector from the single source-identity helper', () => {
    renderWithProviders(<ConnectorPicker />, { snapshot: tenant })
    for (const key of ['csv', 'shopify_pos', 'square', 'other'] as const) {
      expect(screen.getByText(sourceIdentity(key).label)).toBeInTheDocument()
    }
  })

  it('mounts under the dark theme class (both modes render)', () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <ConnectorPicker />
      </div>,
      { snapshot: tenant },
    )
    expect(within(container).getByText('CSV upload')).toBeInTheDocument()
    expect(within(container).getByRole('link', { name: /upload a csv/i })).toBeInTheDocument()
  })
})
