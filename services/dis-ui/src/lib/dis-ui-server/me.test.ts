import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { PERSONAS } from '../../auth/dev/personas'
import type { StubPersona } from '../../auth/dev/personas'
import { ME_FIXTURES } from './fixtures'
import { getMe } from './me'

function toSnapshot(persona: StubPersona): AuthSnapshot {
  return {
    user_id: persona.user_id,
    email: persona.email,
    user_type: persona.user_type,
    tenant_id: persona.tenant_id,
    role: persona.role,
    permissions: persona.permissions,
  }
}

const tenant = PERSONAS.find((p) => p.user_type === 'TENANT')!
const platform = PERSONAS.find((p) => p.user_type === 'PLATFORM')!

describe('getMe (fixture mode)', () => {
  it('returns the tenant profile with tenant_name', async () => {
    const me = await getMe(toSnapshot(tenant))
    expect(me).toEqual({
      user_id: tenant.user_id,
      email: tenant.email,
      user_type: 'TENANT',
      tenant_id: tenant.tenant_id,
      tenant_name: 'Acme Retail',
      permissions: tenant.permissions,
    })
  })

  it('returns the platform profile with null tenant_id and tenant_name', async () => {
    const me = await getMe(toSnapshot(platform))
    expect(me.user_type).toBe('PLATFORM')
    expect(me.tenant_id).toBeNull()
    expect(me.tenant_name).toBeNull()
    expect(me.email).toBe(platform.email)
  })

  it('rejects for a user with no fixture', async () => {
    const unknown: AuthSnapshot = { ...toSnapshot(tenant), user_id: 'no-such-user' }
    await expect(getMe(unknown)).rejects.toThrow(/no fixture/)
  })
})

describe('ME_FIXTURES matches the /dev/login personas exactly', () => {
  it.each(PERSONAS.map((p) => [p.id, p] as const))('persona %s', (_id, persona) => {
    const fixture = ME_FIXTURES[persona.user_id]
    expect(fixture).toBeDefined()
    expect(fixture.email).toBe(persona.email)
    expect(fixture.user_type).toBe(persona.user_type)
    expect(fixture.tenant_id).toBe(persona.tenant_id)
    expect(fixture.permissions).toEqual(persona.permissions)
  })
})
