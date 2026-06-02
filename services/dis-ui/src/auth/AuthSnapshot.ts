// The in-memory identity for the signed-in user, derived by decoding the auth
// token's claims (see verifyToken.ts). This mirrors the Customer Master token
// model (tenant_id + role), not the GET /me response shape: tenant_name is a
// server-side display join that belongs to the dis-ui-server GET /me response
// (Checkpoint 3), not to a token-derived snapshot.

export type UserType = 'TENANT' | 'PLATFORM'

export type AuthSnapshot = {
  user_id: string
  email: string
  user_type: UserType
  // null for PLATFORM (ops) users, who are cross-tenant; a concrete tenant for
  // TENANT users.
  tenant_id: string | null
  // The forward-compatible authz field. The real Customer Master token carries a
  // role claim; RBAC is enforced server-side at the dis-ui-server handler level.
  role: string
  // PROVISIONAL UI-convenience field, pending decisions.md D25 (RBAC claim
  // vocabulary). No UI gates on these yet; the real server may derive them from
  // role, at which point this flat list can be dropped without reshaping callers.
  permissions: string[]
}
