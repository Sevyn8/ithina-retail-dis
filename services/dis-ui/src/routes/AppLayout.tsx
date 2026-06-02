import { Outlet } from 'react-router'

import { useAuth } from '../auth/useAuth'

// Minimal authenticated shell: a header with the DIS UI brand, the signed-in
// email, and a logout control, plus the routed page body. Persona-aware sidebar
// navigation is a later slice; this is just the shell.
export function AppLayout() {
  const { snapshot, logout } = useAuth()

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-semibold">DIS UI</span>
        <div className="flex items-center gap-3">
          <span className="text-sm">{snapshot?.email}</span>
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
