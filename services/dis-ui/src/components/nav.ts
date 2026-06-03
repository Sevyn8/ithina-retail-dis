export type NavItem = {
  label: string
  to: string
  // Ops-only item: rendered only when isOps(snapshot) is true. None are registered
  // this slice (no ops surface yet); the flag exists so the gate is real + testable.
  ops?: boolean
}

// Tenant navigation. Dashboard is the index (`/`); Mappings is intentionally NOT a
// top-level item (reached via a source, /sources/:sourceId/mappings). No ops items.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  { label: 'Sources', to: '/sources' },
  { label: 'Upload', to: '/upload' },
  { label: 'Quarantine', to: '/quarantine' },
  { label: 'Audit', to: '/audit' },
]
