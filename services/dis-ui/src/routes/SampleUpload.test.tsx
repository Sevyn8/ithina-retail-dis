import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

describe('SampleUpload', () => {
  it('creates a sample and navigates to Mapping Review on ready', async () => {
    const user = userEvent.setup()
    // Rendered via the full route tree so the upload -> review navigation is real.
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })

    expect(await screen.findByRole('heading', { name: 'Sample Upload' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/source name/i), 'POS-CSV-Main')
    await user.click(screen.getByRole('button', { name: /analyze sample/i }))

    // Lands on Mapping Review (route /upload/smp_acme0001/review), columns visible.
    expect(await screen.findByRole('heading', { name: 'Mapping Review' })).toBeInTheDocument()
    expect(screen.getByText('item_code')).toBeInTheDocument()
  })
})
