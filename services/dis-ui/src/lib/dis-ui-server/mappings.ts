import { SERVER_MODE } from './mode'

// Typed stub for the mapping-version endpoints (demand list 3.1). Shape is
// PROVISIONAL; NOT consumed by any screen this checkpoint - Mapping Versions
// (Checkpoint 5, read-only) enriches it.
export type MappingStatus = 'active' | 'staged' | 'deprecated'

export type MappingVersion = {
  version: number
  status: MappingStatus
  created_at: string
  created_by: string
  field_count: number
  transform_count: number
  suite_version: number
  active_from: string
  active_to: string | null
}

const MAPPING_VERSION_FIXTURES: MappingVersion[] = [
  {
    version: 1,
    status: 'active',
    created_at: '2026-05-28',
    created_by: 'acme.user',
    field_count: 12,
    transform_count: 4,
    suite_version: 1,
    active_from: '2026-05-28',
    active_to: null,
  },
]

export async function getMappingVersions(sourceId: string): Promise<MappingVersion[]> {
  if (SERVER_MODE === 'real') {
    throw new Error('real-mode getMappingVersions() is not implemented (slice 13)')
  }
  // sourceId is accepted for signature parity; the fixture is source-agnostic for now.
  void sourceId
  return MAPPING_VERSION_FIXTURES
}
