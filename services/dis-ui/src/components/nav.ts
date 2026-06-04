import {
  Bell,
  Building2,
  Database,
  FileSearch,
  LayoutDashboard,
  ScanSearch,
  ShieldAlert,
  Terminal,
  Upload,
} from 'lucide-react'
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
// top-level item (reached via a source, /sources/:sourceId/mappings). The ops-flagged
// items render only for an ops persona (Sidebar filters on isOps); Ops Fleet (slice 24)
// is the first such destination.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Sources', to: '/sources', icon: Database },
  { label: 'Upload', to: '/upload', icon: Upload },
  { label: 'Quarantine', to: '/quarantine', icon: ShieldAlert },
  { label: 'Audit', to: '/audit', icon: FileSearch },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Ops Fleet', to: '/ops/fleet', icon: Building2, ops: true },
  // Distinct labels from the tenant Quarantine/Audit items (an ops persona sees both
  // groups) so accessible names stay unique. These are the cross-tenant (fleet) modes.
  { label: 'Fleet Quarantine', to: '/ops/quarantine', icon: ShieldAlert, ops: true },
  { label: 'Fleet Audit', to: '/ops/audit', icon: ScanSearch, ops: true },
  { label: 'Query', to: '/ops/query', icon: Terminal, ops: true },
]
