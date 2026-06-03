import { Bell, Database, FileSearch, LayoutDashboard, ShieldAlert, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  label: string
  to: string
  // Visual only (slice 23): the sidebar icon shown beside the label (and alone when
  // collapsed). Does not affect routing or gating.
  icon?: LucideIcon
  // Ops-only item: rendered only when isOps(snapshot) is true. None are registered
  // this slice (no ops surface yet); the flag exists so the gate is real + testable.
  ops?: boolean
}

// Tenant navigation. Dashboard is the index (`/`); Mappings is intentionally NOT a
// top-level item (reached via a source, /sources/:sourceId/mappings). No ops items.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Sources', to: '/sources', icon: Database },
  { label: 'Upload', to: '/upload', icon: Upload },
  { label: 'Quarantine', to: '/quarantine', icon: ShieldAlert },
  { label: 'Audit', to: '/audit', icon: FileSearch },
  { label: 'Notifications', to: '/notifications', icon: Bell },
]
