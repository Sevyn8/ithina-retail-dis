import { PERSONAS } from '../../auth/dev/personas'
import type { MeResponse } from './types'

// Display names keyed by tenant_id. tenant_name is the GET /me enrichment that is
// not carried in the token; PLATFORM users (no tenant_id) have no tenant_name.
const TENANT_NAMES: Record<string, string> = {
  '0190a000-0000-7000-8000-0000000000aa': 'Acme Retail',
}

// The fixture GET /me responses, DERIVED from the /dev/login personas so the two
// match exactly (same user_id, email, user_type, tenant_id, permissions). Both
// PERSONAS and these fixtures are slice-19 fixture-mode-only artifacts that go
// away when real mode and real Customer Master land.
export const ME_FIXTURES: Record<string, MeResponse> = Object.fromEntries(
  PERSONAS.map((persona) => [
    persona.user_id,
    {
      user_id: persona.user_id,
      email: persona.email,
      user_type: persona.user_type,
      tenant_id: persona.tenant_id,
      tenant_name: persona.tenant_id === null ? null : (TENANT_NAMES[persona.tenant_id] ?? null),
      permissions: persona.permissions,
    },
  ]),
)
