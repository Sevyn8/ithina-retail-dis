import { screen } from '@testing-library/react'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { PERSONAS } from '../auth/dev/personas'
import { renderWithProviders } from '../test/renderWithProviders'
import { Home } from './Home'

const tenantPersona = PERSONAS.find((p) => p.user_type === 'TENANT')!

const tenantSnapshot: AuthSnapshot = {
  user_id: tenantPersona.user_id,
  email: tenantPersona.email,
  user_type: tenantPersona.user_type,
  tenant_id: tenantPersona.tenant_id,
  role: tenantPersona.role,
  permissions: tenantPersona.permissions,
}

describe('Home', () => {
  it('renders the greeting from getMe() in fixture mode', async () => {
    renderWithProviders(<Home />, { snapshot: tenantSnapshot })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /Hello, tenant\.admin@acme-retail\.example/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Tenant: Acme Retail/)).toBeInTheDocument()
  })

  it('shows the loading state before the profile resolves', () => {
    renderWithProviders(<Home />, { snapshot: tenantSnapshot })
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it('shows the error state when the profile cannot be loaded', async () => {
    const badSnapshot: AuthSnapshot = { ...tenantSnapshot, user_id: 'no-such-user' }
    renderWithProviders(<Home />, { snapshot: badSnapshot })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your profile/i)
  })
})
