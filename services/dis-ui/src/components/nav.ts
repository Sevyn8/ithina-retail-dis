import {
  Bell,
  Building2,
  Database,
  FileSearch,
  LayoutDashboard,
  Plug,
  Plus,
  ShieldAlert,
  Terminal,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// T7: nav items are grouped into labeled sections (Ithina-console look). The section is a
// visual/structural grouping only; it changes no route, target, label, icon, or ops-gating.
export type NavSection = 'OVERVIEW' | 'DATA' | 'MONITORING' | 'OPERATIONS'

// Render order of the section groups. OPERATIONS is last; its header auto-hides for tenants
// because all its items are ops-gated (the Sidebar drops a section with no visible items).
export const NAV_SECTION_ORDER: NavSection[] = ['OVERVIEW', 'DATA', 'MONITORING', 'OPERATIONS']

export type NavItem = {
  label: string
  to: string
  // The labeled section this item lives under (T7). Grouping/visual only.
  section: NavSection
  // Visual only (slice 23): the sidebar icon shown beside the label (and alone when
  // collapsed). Does not affect routing or gating.
  icon?: LucideIcon
  // Ops-only item: rendered only when isOps(snapshot) is true. The flag is the single
  // gate; the OPERATIONS section header derives its visibility from having ops items.
  ops?: boolean
}

// Tenant navigation. Dashboard is the index (`/`); Mappings is intentionally NOT a
// top-level item (reached via a source, /sources/:sourceId/mappings). The ops-flagged
// items render only for an ops persona (Sidebar filters on isOps); Ops Fleet (slice 24)
// is the first such destination. T7 tags each item with its section; routes/labels/gating
// are unchanged from T6.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, section: 'OVERVIEW' },
  // DATA: the source/template lifecycle, action-first. "Upload CSV" is the flat template list
  // (/ingest) grouped by source with a per-template upload action; "New CSV Template" is the
  // onboarding journey (/upload); "Add Source" promotes the connector picker (/connect).
  { label: 'Upload CSV', to: '/ingest', icon: Database, section: 'DATA' },
  { label: 'New CSV Template', to: '/upload', icon: Upload, section: 'DATA' },
  { label: 'Add Source', to: '/connect', icon: Plus, section: 'DATA' },
  // "Connect a System" (Chunk 1): the NEW Live Sync connector wizard (/connectors/new) for POS
  // (Shopify/Square/Clover). Sits beside the existing "Add Source" (unchanged); separate route.
  { label: 'Connect a System', to: '/connectors/new', icon: Plug, section: 'DATA' },
  // MONITORING: Quarantine and Audit are scope-aware (T9): a tenant sees their own tenant
  // (scope locked, no tenant filter); an ops user sees the fleet-wide view with a tenant
  // filter, via the SAME route/screen (the component branches on isOps). Always visible.
  { label: 'Quarantine', to: '/quarantine', icon: ShieldAlert, section: 'MONITORING' },
  { label: 'Audit', to: '/audit', icon: FileSearch, section: 'MONITORING' },
  { label: 'Notifications', to: '/notifications', icon: Bell, section: 'MONITORING' },
  // OPERATIONS: ops-only surfaces with no tenant equivalent. T9 retired the separate Fleet
  // Quarantine / Fleet Audit items - the fleet views now live in the scope-aware MONITORING
  // Quarantine / Audit (ops mode), so OPERATIONS holds only Ops Fleet + Query.
  { label: 'Ops Fleet', to: '/ops/fleet', icon: Building2, ops: true, section: 'OPERATIONS' },
  { label: 'Query', to: '/ops/query', icon: Terminal, ops: true, section: 'OPERATIONS' },
]
