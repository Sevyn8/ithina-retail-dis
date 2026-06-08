// Live Sync connector wizard steps (Chunk 1). Single source of truth for the 8 guided
// steps the "Connect a System" surface runs behind its local StepRail chip stepper. Mirrors
// the csv-journey.ts pattern (label list + index map) so the route and its step components
// share one ordered definition with no duplicated label arrays.
export const CONNECTOR_STEPS = [
  'Source',
  'Connect',
  'Authorized',
  'Locations',
  'Data & sync',
  'AI mapping',
  'Preview',
  'Live',
] as const

export type ConnectorStep = (typeof CONNECTOR_STEPS)[number]

// Zero-based rail index per step, for <StepRail current={...} />.
export const CONNECTOR_STEP_INDEX = {
  source: 0,
  connect: 1,
  authorized: 2,
  locations: 3,
  dataSync: 4,
  mapping: 5,
  preview: 6,
  live: 7,
} as const

export const CONNECTOR_STEP_COUNT = CONNECTOR_STEPS.length

// Per-step heading + description, in step order. Rendered once by the route (not by each step
// component) so every step shares the exact same header typography and spacing - the single
// source for the consistent type scale across all 8 steps.
export type StepMeta = { title: string; description: string }

export const CONNECTOR_STEP_META: StepMeta[] = [
  {
    title: 'Pick the point-of-sale system',
    description: 'Choose the system to connect. We sync sales automatically; no file uploads.',
  },
  {
    title: 'Connect your account',
    description: 'Name this source and choose how to authenticate.',
  },
  {
    title: 'Connection verified',
    description: 'We confirmed read-only access to your account.',
  },
  {
    title: 'Map your locations',
    description: 'Choose which locations to sync and map each to a DIS store.',
  },
  {
    title: 'Choose data and cadence',
    description: 'Pick which data types to sync and how often.',
  },
  {
    title: 'Review the field mapping',
    description:
      'We mapped each source field to the canonical schema. Confirm, correct, or ignore.',
  },
  {
    title: 'Preview the canonical data',
    description: 'A sample of how your data maps to the canonical schema.',
  },
  {
    title: 'Your source is live',
    description: 'Sales now sync automatically into DIS.',
  },
]
