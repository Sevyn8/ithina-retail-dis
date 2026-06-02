// DEV ONLY. These constants configure the local stub JWT minted at /dev/login.
//
// The secret guards nothing real: in this slice there is no Customer Master, no
// backend, and no canonical data behind it. In real mode the stub is replaced by
// Customer Master tokens verified against a JWKS key set (decisions.md D25), and
// this module is deleted. The signer (signStubToken.ts) refuses to run in a
// production build, so this secret can never mint a token outside dev.

export const STUB_SECRET = 'dis-ui-dev-stub-secret-not-for-production'
export const STUB_ISSUER = 'dis-ui-dev-stub'
export const STUB_AUDIENCE = 'dis-ui'
export const STUB_EXPIRY = '8h'
