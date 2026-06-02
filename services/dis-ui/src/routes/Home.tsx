import { useAuth } from '../auth/useAuth'
import { useMe } from '../lib/dis-ui-server/me'

// Hello-world page. AuthBoundary guarantees an authenticated snapshot before Home
// renders; Home fetches the profile via getMe() (TanStack Query) and renders the
// greeting from the getMe() result (AC 10). The email also appears in the
// AppLayout header from the token-derived snapshot; that overlap is intentional.
// tenant_name is shown here because it is a getMe-only field the token lacks.
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
