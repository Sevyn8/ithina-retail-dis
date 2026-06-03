export type NavItem = {
  label: string
  to: string
  // Ops-only item: rendered only when isOps(snapshot) is true. None are registered
  // this slice (no ops surface yet); the flag exists so the gate is real + testable.
  ops?: boolean
}

// Phase 1 tenant navigation. Mappings is intentionally NOT a top-level item; it is
// reached via a source (/sources/:sourceId/mappings). No ops items this slice.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Sources', to: '/sources' },
  { label: 'Upload', to: '/upload' },
  { label: 'Quarantine', to: '/quarantine' },
  { label: 'Audit', to: '/audit' },
]
