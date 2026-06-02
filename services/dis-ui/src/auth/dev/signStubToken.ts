import { SignJWT } from 'jose'

import type { StubPersona } from './personas'
import { STUB_AUDIENCE, STUB_EXPIRY, STUB_ISSUER, STUB_SECRET } from './devStubSecret'

const KEY = new TextEncoder().encode(STUB_SECRET)

// DEV ONLY. Mints a local HMAC-signed stub JWT for a persona, shaped like the
// Customer Master token model (sub + email + user_type + tenant_id + role, plus a
// provisional permissions claim). It must never run in a production bundle:
// minting tokens client-side is a dev affordance, and there is no Customer Master
// here. The verify path (verifyToken.ts) is the seam that later swaps to JWKS.
export async function signStubToken(persona: StubPersona): Promise<string> {
  if (import.meta.env.PROD) {
    throw new Error('signStubToken is dev-only and must not run in a production build')
  }

  return new SignJWT({
    email: persona.email,
    user_type: persona.user_type,
    tenant_id: persona.tenant_id,
    role: persona.role,
    permissions: persona.permissions,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(persona.user_id)
    .setIssuedAt()
    .setIssuer(STUB_ISSUER)
    .setAudience(STUB_AUDIENCE)
    .setExpirationTime(STUB_EXPIRY)
    .sign(KEY)
}
