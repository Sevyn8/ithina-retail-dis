import { Outlet } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { NotificationBell } from '../components/NotificationBell'
import { Sidebar } from '../components/Sidebar'
import { Button } from '@/components/ui/button'
import { useMe } from '../lib/dis-ui-server/me'
import { ThemeToggle } from '../theme/ThemeToggle'

// Authenticated shell on the admin-frontend chrome (slice 23): a sticky top bar
// (h-14, border-b, backdrop-blur) carrying the brand, the notification bell, the theme
// toggle, the signed-in user, and a logout control; a collapsible sidebar; and the
// routed page body. The header is a /me consumer (demand list 1.1), reading the display
// email from the profile call and falling back to the token's userId (email is not a
// token claim). No behavior change from the prior shell, only chrome.
export function AppLayout() {
  const { snapshot, logout } = useAuth()
  const { data } = useMe(snapshot)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <span className="font-heading font-semibold">DIS UI</span>
        <div className="ml-auto flex items-center gap-3">
          <NotificationBell />
          <ThemeToggle />
          <span className="text-sm text-foreground-muted">{data?.email ?? snapshot?.userId}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
