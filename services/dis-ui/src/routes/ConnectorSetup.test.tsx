import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

// Drives the NEW "Connect a System" Live Sync wizard (/connectors/new) with userEvent. All
// backend interactions are stubbed (connectors-api), so the flow completes with no network.
// Focus: the 8-step stepper advancing + the per-row IGNORE behavior in the AI mapping step.

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

function renderWizard() {
  return renderWithProviders(<AppRoutes />, {
    snapshot: tenant,
    initialEntries: ['/connectors/new'],
  })
}

describe('ConnectorSetup (Live Sync wizard)', () => {
  it('renders the Source step with POS connector tiles and no CSV tile', async () => {
    renderWizard()
    expect(await screen.findByRole('heading', { name: 'Connect a system' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Shopify' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Square' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Clover' })).toBeInTheDocument()
    // POS only this surface: no CSV connector tile here.
    expect(screen.queryByRole('radio', { name: /csv/i })).not.toBeInTheDocument()
    // Source step cannot advance until a connector is picked.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('advances through all 8 steps to the live confirmation (stubbed, no network)', async () => {
    const user = userEvent.setup()
    renderWizard()
    await screen.findByRole('heading', { name: 'Connect a system' })

    // 1. Source
    await user.click(screen.getByRole('radio', { name: 'Shopify' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 2. Connect: name + domain, then authorize (stub advances).
    await user.type(screen.getByLabelText('Source name'), 'Shopify sales')
    await user.type(screen.getByLabelText('Shopify store domain'), 'acme.myshopify.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with Shopify' }))

    // 3. Authorized
    expect(await screen.findByText('Connected to Shopify')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // 4. Locations: check a location and map it to a DIS store.
    const checkbox = await screen.findByRole('checkbox', { name: 'Sync Downtown Flagship' })
    await user.click(checkbox)
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'DIS store for Downtown Flagship' }),
      'Acme Downtown #1',
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 5. Data & sync: 'Orders' is selected by default.
    expect(await screen.findByRole('checkbox', { name: 'Orders' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 6. AI mapping: ignore the unmapped 'gateway' field so all active fields are mapped.
    expect(await screen.findByText('order_id')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Ignore gateway' }))
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }))

    // 7. Preview: the template-type field + the canonical table.
    expect(await screen.findByLabelText('Template type')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go live' }))

    // 8. Live confirmation.
    expect(await screen.findByRole('status')).toHaveTextContent('Shopify is live')
    expect(screen.getByRole('link', { name: 'Done' })).toBeInTheDocument()
  })

  it('IGNORE toggle dims a row, badges it Ignored, and unblocks Continue', async () => {
    const user = userEvent.setup()
    renderWizard()
    await screen.findByRole('heading', { name: 'Connect a system' })

    // Fast path to the mapping step.
    await user.click(screen.getByRole('radio', { name: 'Shopify' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText('Source name'), 'Shopify sales')
    await user.type(screen.getByLabelText('Shopify store domain'), 'acme.myshopify.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with Shopify' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Sync Downtown Flagship' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'DIS store for Downtown Flagship' }),
      'Acme Downtown #1',
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))

    // At the mapping step: 'gateway' is unmapped, so Continue is blocked.
    await screen.findByText('gateway')
    const ignoreGateway = screen.getByRole('checkbox', { name: 'Ignore gateway' })
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeDisabled()
    expect(screen.queryByText('Ignored')).not.toBeInTheDocument()

    // Ignoring it badges the row Ignored and unblocks Continue.
    await user.click(ignoreGateway)
    expect(ignoreGateway).toBeChecked()
    expect(screen.getByText('Ignored')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to preview' })).toBeEnabled()
  })
})
