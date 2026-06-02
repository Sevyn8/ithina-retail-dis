import { SignJWT } from 'jose'

import { STUB_AUDIENCE, STUB_ISSUER, STUB_SECRET } from './dev/devStubSecret'
import { PERSONAS } from './dev/personas'
import { TokenInvalidError, verifyToken } from './verifyToken'

const KEY = new TextEncoder().encode(STUB_SECRET)

type Claims = {
  sub?: string
  email?: unknown
  user_type?: unknown
  tenant_id?: unknown
  role?: unknown
  permissions?: unknown
}

// Local signer so tests can control expiry and omit claims (signStubToken always
// produces a valid, fresh token, which only covers the happy path).
async function sign(claims: Claims, expiration: string | number = '8h'): Promise<string> {
  const { sub, ...rest } = claims
  const builder = new SignJWT(rest as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(STUB_ISSUER)
    .setAudience(STUB_AUDIENCE)
    .setExpirationTime(expiration)
  if (sub !== undefined) {
    builder.setSubject(sub)
  }
  return builder.sign(KEY)
}

const tenant = PERSONAS[0]

describe('verifyToken', () => {
  it('returns a snapshot for a valid token (TENANT)', async () => {
    const token = await sign({
      sub: tenant.user_id,
      email: tenant.email,
      user_type: tenant.user_type,
      tenant_id: tenant.tenant_id,
      role: tenant.role,
      permissions: tenant.permissions,
    })
    const snapshot = await verifyToken(token)
    expect(snapshot).toEqual({
      user_id: tenant.user_id,
      email: tenant.email,
      user_type: 'TENANT',
      tenant_id: tenant.tenant_id,
      role: tenant.role,
      permissions: tenant.permissions,
    })
  })

  it('rejects a malformed token', async () => {
    await expect(verifyToken('not-a-jwt')).rejects.toBeInstanceOf(TokenInvalidError)
    await expect(verifyToken('not-a-jwt')).rejects.toMatchObject({ reason: 'malformed' })
  })

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    const token = await sign(
      {
        sub: tenant.user_id,
        email: tenant.email,
        user_type: tenant.user_type,
        tenant_id: tenant.tenant_id,
        role: tenant.role,
        permissions: tenant.permissions,
      },
      past,
    )
    await expect(verifyToken(token)).rejects.toMatchObject({ reason: 'expired' })
  })

  it('rejects a token with missing or invalid claims (unknown persona)', async () => {
    const noUserType = await sign({
      sub: 'u1',
      email: 'someone@example.com',
      role: 'tenant_admin',
      tenant_id: 't1',
      permissions: [],
    })
    await expect(verifyToken(noUserType)).rejects.toMatchObject({ reason: 'invalid-claims' })

    const tenantWithoutTenantId = await sign({
      sub: 'u2',
      email: 'someone@example.com',
      user_type: 'TENANT',
      tenant_id: null,
      role: 'tenant_admin',
      permissions: [],
    })
    await expect(verifyToken(tenantWithoutTenantId)).rejects.toMatchObject({
      reason: 'invalid-claims',
    })
  })
})
