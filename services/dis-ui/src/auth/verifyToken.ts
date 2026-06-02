import { errors, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'

import type { AuthSnapshot, UserType } from './AuthSnapshot'
import { STUB_AUDIENCE, STUB_ISSUER, STUB_SECRET } from './dev/devStubSecret'

export type TokenInvalidReason = 'expired' | 'malformed' | 'invalid-claims'

export class TokenInvalidError extends Error {
  readonly reason: TokenInvalidReason

  constructor(reason: TokenInvalidReason, message: string) {
    super(message)
    this.name = 'TokenInvalidError'
    this.reason = reason
  }
}

// HMAC key for the dev stub. Real-mode seam (decisions.md D25): replace this with
// a JWKS remote key set (jose createRemoteJWKSet) and the Customer Master issuer
// and audience. The claim-to-snapshot mapping below stays the same.
const KEY = new TextEncoder().encode(STUB_SECRET)

function isUserType(value: unknown): value is UserType {
  return value === 'TENANT' || value === 'PLATFORM'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function toSnapshot(payload: JWTPayload): AuthSnapshot {
  const claims = payload as Record<string, unknown>
  const sub = payload.sub

  if (typeof sub !== 'string' || sub.length === 0) {
    throw new TokenInvalidError('invalid-claims', 'Token is missing a sub claim')
  }
  if (typeof claims.email !== 'string') {
    throw new TokenInvalidError('invalid-claims', 'Token is missing an email claim')
  }
  if (!isUserType(claims.user_type)) {
    throw new TokenInvalidError('invalid-claims', 'Token has a missing or invalid user_type claim')
  }
  if (typeof claims.role !== 'string' || claims.role.length === 0) {
    throw new TokenInvalidError('invalid-claims', 'Token is missing a role claim')
  }

  const tenantId =
    claims.tenant_id === null || claims.tenant_id === undefined ? null : claims.tenant_id
  if (tenantId !== null && typeof tenantId !== 'string') {
    throw new TokenInvalidError('invalid-claims', 'Token has an invalid tenant_id claim')
  }
  // A TENANT user must be scoped to a tenant; a PLATFORM user is cross-tenant.
  if (claims.user_type === 'TENANT' && tenantId === null) {
    throw new TokenInvalidError('invalid-claims', 'TENANT user is missing tenant_id')
  }

  const permissions = claims.permissions === undefined ? [] : claims.permissions
  if (!isStringArray(permissions)) {
    throw new TokenInvalidError('invalid-claims', 'Token has an invalid permissions claim')
  }

  return {
    user_id: sub,
    email: claims.email,
    user_type: claims.user_type,
    tenant_id: tenantId,
    role: claims.role,
    permissions,
  }
}

// Verifies a raw token and returns the decoded AuthSnapshot. Throws
// TokenInvalidError on expiry, signature/format failure, or invalid claims so the
// caller (AuthContext) can clear the token and leave the user unauthenticated.
export async function verifyToken(raw: string): Promise<AuthSnapshot> {
  let payload: JWTPayload
  try {
    const result = await jwtVerify(raw, KEY, { issuer: STUB_ISSUER, audience: STUB_AUDIENCE })
    payload = result.payload
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      throw new TokenInvalidError('expired', 'Token has expired')
    }
    throw new TokenInvalidError('malformed', 'Token failed signature or format verification')
  }
  return toSnapshot(payload)
}
