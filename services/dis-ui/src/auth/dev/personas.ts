import type { UserType } from '../AuthSnapshot'

// DEV ONLY. The personas offered at /dev/login. At minimum one TENANT and one
// PLATFORM persona, per the slice doc. Claim values are provisional fixtures:
// the user_type spelling (TENANT/PLATFORM) follows the slice doc; permissions are
// PROVISIONAL pending decisions.md D25; PLATFORM is cross-tenant (tenant_id null).

export type StubPersona = {
  id: string
  label: string
  user_id: string
  email: string
  user_type: UserType
  tenant_id: string | null
  role: string
  permissions: string[]
}

export const PERSONAS: StubPersona[] = [
  {
    id: 'tenant-admin',
    label: 'Tenant admin (Acme Retail)',
    user_id: '0190a000-0000-7000-8000-000000000001',
    email: 'tenant.admin@acme-retail.example',
    user_type: 'TENANT',
    tenant_id: '0190a000-0000-7000-8000-0000000000aa',
    role: 'tenant_admin',
    permissions: ['upload:create', 'mapping:read', 'quarantine:read', 'audit:read'],
  },
  {
    id: 'platform-ops',
    label: 'Platform ops',
    user_id: '0190a000-0000-7000-8000-000000000002',
    email: 'ops@sevyn8.example',
    user_type: 'PLATFORM',
    tenant_id: null,
    role: 'ops',
    permissions: ['mapping:read', 'mapping:write', 'quarantine:read_all', 'audit:read', 'duckdb:query'],
  },
]
