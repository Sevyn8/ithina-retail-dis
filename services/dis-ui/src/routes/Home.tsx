import { useAuth } from '../auth/useAuth'
import { useMe } from '../lib/dis-ui-server/me'

// Hello-world page. AuthBoundary guarantees an authenticated snapshot before Home
// renders; Home fetches the display profile via getMe() (TanStack Query) and
// greets from the getMe() result (AC 10). email and tenant_name are profile fields
// (not token claims); the token-derived AuthSnapshot carries only userId / tenantId
// / storeId / roles, so the greeting reads them from the profile, not the snapshot.
export function Home() {
  const { snapshot } = useAuth()
  const { data, isPending, isError } = useMe(snapshot)

  if (isPending) {
    return <p>Loading...</p>
  }
  if (isError || data === undefined) {
    return (
      <p role="alert">We could not load your profile. Please try signing in again.</p>
    )
  }

  return (
    <section>
      <h1 className="text-xl font-semibold">Hello, {data.email}</h1>
      <p className="text-sm">
        Tenant: {data.tenant_name ?? 'Platform (all tenants)'}
      </p>
    </section>
  )
}
