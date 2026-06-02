import { useAuth } from '../auth/useAuth'

// Placeholder protected page. Checkpoint 3 rewrites this same path into the
// hello-world page that calls the stubbed dis-ui-server getMe() via TanStack
// Query and renders the response.
export function Home() {
  const { snapshot } = useAuth()

  return (
    <section>
      <h1 className="text-xl font-semibold">Home</h1>
      <p>Signed in as {snapshot?.email}. The Home page lands in Checkpoint 3.</p>
    </section>
  )
}
