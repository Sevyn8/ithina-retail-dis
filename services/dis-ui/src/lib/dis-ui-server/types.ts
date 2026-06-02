import type { UserType } from '../../auth/AuthSnapshot'

// The dis-ui-server GET /me response shape (demand-list section 1.1). This is the
// BFF's enriched view of the signed-in user. It overlaps the token-derived
// AuthSnapshot but adds tenant_name, which is a server-side display join and is
// not carried in the Customer Master token.
export type MeResponse = {
  user_id: string
  email: string
  user_type: UserType
  tenant_id: string | null
  // Display name of the tenant. null for PLATFORM (ops) users, who are
  // cross-tenant and belong to no single tenant.
  tenant_name: string | null
  // PROVISIONAL pending decisions.md D25, mirrors AuthSnapshot.permissions.
  permissions: string[]
}
