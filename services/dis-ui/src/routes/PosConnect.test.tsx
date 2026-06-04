import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { POS_CONNECTOR_SPECS } from '../lib/dis-ui-server/pos-connectors'
import { sourceIdentity } from '../components/source-identity'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

function renderAt(path: string) {
  return renderWithProviders(<AppRoutes />, { snapshot: tenant, initialEntries: [path] })
}

// R5: the thin POS connect step is coming-soon and DISABLED for every POS type. It states
// the shared-journey handoff (framing only) and builds no POS-specific journey.
describe('PosConnect (thin, coming-soon)', () => {
  for (const key of ['shopify_pos', 'square', 'other'] as const) {
    const spec = POS_CONNECTOR_SPECS[key]
    const label = sourceIdentity(key).label

    it(`renders ${key} coming-soon with a DISABLED connect control and no faked connect`, async () => {
      renderAt(`/connect/${key}`)
      expect(await screen.findByRole('heading', { name: `Connect ${label}` })).toBeInTheDocument()
      expect(screen.getByText('Coming soon')).toBeInTheDocument()
      // FM1: the connect/authorize control is disabled - no working or faked connect
      expect(screen.getByRole('button', { name: spec.connectLabel })).toBeDisabled()
      // the credential shell inputs are disabled too
      const form = screen.getByRole('form', { name: `${label} connection` })
      for (const input of within(form).getAllByRole('textbox')) {
        expect(input).toBeDisabled()
      }
      // the one available action is notify-me
      expect(screen.getByRole('button', { name: /notify me when ready/i })).toBeEnabled()
      // FM3: the shared-journey handoff is stated (framing only)
      expect(screen.getByText(/feeds the same mapping, preview, and go-live journey as CSV/i)).toBeInTheDocument()
    })
  }

  it('notify-me shows a local coming-soon acknowledgment (no backend claim)', async () => {
    const user = userEvent.setup()
    renderAt('/connect/shopify_pos')
    await screen.findByRole('heading', { name: 'Connect Shopify POS' })
    await user.click(screen.getByRole('button', { name: /notify me when ready/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/coming soon/i)
  })

  it('renders the empty state for an unknown connector', async () => {
    renderAt('/connect/not_a_pos')
    expect(await screen.findByRole('heading', { name: 'Unknown connector' })).toBeInTheDocument()
  })
})
