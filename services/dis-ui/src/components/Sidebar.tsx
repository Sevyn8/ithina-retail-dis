import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router'

import { isOps } from '../auth/AuthSnapshot'
import { useAuth } from '../auth/useAuth'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './nav'
import type { NavItem } from './nav'

// The tenant sidebar, on the admin-frontend chrome (slice 23): bg-sidebar, sidebar
// token colors, active-item chrome, and collapse (w-60 expanded / w-16 collapsed).
// Behavior is unchanged from before: items flagged `ops` render only for an ops
// snapshot (isOps), `items` is injectable so tests can verify the gate, and active-route
// highlighting uses NavLink's isActive. When collapsed, labels become sr-only so each
// link keeps its accessible name.
export function Sidebar({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { snapshot } = useAuth()
  const ops = snapshot !== null && isOps(snapshot)
  const visible = items.filter((item) => (item.ops === true ? ops : true))
  const [collapsed, setCollapsed] = useState(false)

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {visible.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground',
                  )
                }
              >
                {Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={() => setCollapsed((c) => !c)}
        className="m-2 flex h-9 items-center justify-center gap-2 rounded-md border border-border-strong bg-sidebar-accent/20 text-xs text-muted-foreground transition-colors duration-150 hover:bg-surface-raised hover:text-sidebar-foreground"
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
        )}
        <span className={cn(collapsed && 'sr-only')}>Collapse</span>
      </button>
    </nav>
  )
}
