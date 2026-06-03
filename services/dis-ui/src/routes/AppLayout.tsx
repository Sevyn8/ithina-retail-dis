import { Outlet } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { useMe } from '../lib/dis-ui-server/me'

// Minimal authenticated shell: a header with the DIS UI brand, the signed-in
// user, and a logout control, plus the routed page body. The header is a /me
// consumer (demand list 1.1), so it reads the display email from the profile
// call, falling back to the token's userId while that loads or if it errors
// (email is not a token claim). Persona-aware sidebar nav is a later slice.
export function AppLayout() {
  const { snapshot, logout } = useAuth()
  const { data } = useMe(snapshot)

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-semibold">DIS UI</span>
        <div className="flex items-center gap-3">
          <span className="text-sm">{data?.email ?? snapshot?.userId}</span>
          <button type="button" onClick={logout} className="text-sm underline">
            Log out
          </button>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  )
}
