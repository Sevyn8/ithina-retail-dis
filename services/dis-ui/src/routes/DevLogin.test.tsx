import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

import { AuthProvider } from '../auth/AuthProvider'
import { AppRoutes } from './AppRoutes'

function renderApp() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/dev/login']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('DevLogin persona switch', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('signs in as one persona, then switches to another', async () => {
    const user = userEvent.setup()
    renderApp()

    // Sign in as the TENANT persona.
    await user.click(await screen.findByRole('button', { name: /tenant admin/i }))
    expect(
      await screen.findByText(/Signed in as tenant\.admin@acme-retail\.example/),
    ).toBeInTheDocument()

    // Log out, then sign in as the PLATFORM persona; the snapshot reflects the switch.
    await user.click(screen.getByRole('button', { name: /log out/i }))
    await user.click(await screen.findByRole('button', { name: /platform ops/i }))
    expect(await screen.findByText(/Signed in as ops@sevyn8\.example/)).toBeInTheDocument()
  })
})
