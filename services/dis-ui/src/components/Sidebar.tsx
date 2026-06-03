import { NavLink } from 'react-router'

import { isOps } from '../auth/AuthSnapshot'
import { useAuth } from '../auth/useAuth'
import { NAV_ITEMS } from './nav'
import type { NavItem } from './nav'

// The tenant sidebar. Items flagged `ops` render only for an ops snapshot
// (isOps), the single Phase-1 gate; no ops items are registered by default this
// slice. `items` is injectable so tests can verify the gate. Active-route
// highlighting via NavLink's isActive callback.
export function Sidebar({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { snapshot } = useAuth()
  const ops = snapshot !== null && isOps(snapshot)
  const visible = items.filter((item) => (item.ops === true ? ops : true))

  return (
    <nav aria-label="Primary" className="w-48 border-r p-3">
      <ul className="flex flex-col gap-1">
        {visible.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `block rounded px-2 py-1 text-sm ${isActive ? 'bg-gray-200 font-semibold' : ''}`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
