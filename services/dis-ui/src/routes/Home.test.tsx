import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { PERSONAS } from '../auth/dev/personas'
import { ME_FIXTURES } from '../lib/dis-ui-server/fixtures'
import { renderWithProviders } from '../test/renderWithProviders'
import { Home } from './Home'

const tenantPersona = PERSONAS.find((p) => p.id === 'tenant')!

const tenantSnapshot: AuthSnapshot = {
  userId: tenantPersona.sub,
  tenantId: tenantPersona.tenant_id,
  storeId: tenantPersona.store_id,
  roles: tenantPersona.roles,
}

describe('Home', () => {
  it('renders the greeting from the getMe() profile in fixture mode', async () => {
    renderWithProviders(<Home />, { snapshot: tenantSnapshot })
    const email = ME_FIXTURES[tenantPersona.sub].email
    expect(
      await screen.findByRole('heading', { level: 1, name: `Hello, ${email}` }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Tenant: Acme Retail/)).toBeInTheDocument()
  })

  it('shows the loading state before the profile resolves', () => {
    renderWithProviders(<Home />, { snapshot: tenantSnapshot })
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it('shows the error state when the profile cannot be loaded', async () => {
    const badSnapshot: AuthSnapshot = { ...tenantSnapshot, userId: 'no-such-user' }
    renderWithProviders(<Home />, { snapshot: badSnapshot })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your profile/i)
  })
})
