import { render, screen } from '@testing-library/react'
import { SignJWT } from 'jose'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../routes/AppRoutes'
import { AuthProvider } from './AuthProvider'
import { STUB_AUDIENCE, STUB_ISSUER, STUB_SECRET } from './dev/devStubSecret'
import { PERSONAS } from './dev/personas'
import { signStubToken } from './dev/signStubToken'
import { writeToken } from './storage'

const KEY = new TextEncoder().encode(STUB_SECRET)

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  )
}

async function expiredToken(): Promise<string> {
  const past = Math.floor(Date.now() / 1000) - 60
  return new SignJWT({
    email: 'tenant.admin@acme-retail.example',
    user_type: 'TENANT',
    tenant_id: 't1',
    role: 'tenant_admin',
    permissions: [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setIssuedAt(past - 60)
    .setIssuer(STUB_ISSUER)
    .setAudience(STUB_AUDIENCE)
    .setExpirationTime(past)
    .sign(KEY)
}

describe('AuthBoundary', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the protected page when a valid token is stored', async () => {
    writeToken(await signStubToken(PERSONAS[0]))
    renderAt('/')
    expect(await screen.findByText(/Signed in as tenant\.admin@acme-retail\.example/)).toBeInTheDocument()
  })

  it('redirects to /dev/login when no token is stored', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /dev login/i })).toBeInTheDocument()
  })

  it('redirects to /dev/login when the stored token is expired', async () => {
    writeToken(await expiredToken())
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /dev login/i })).toBeInTheDocument()
  })
})
