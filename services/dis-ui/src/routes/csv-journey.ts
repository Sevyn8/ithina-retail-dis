// CSV journey rail (redesign R3): the single source of truth for the four guided steps
// the CSV upload-to-go-live flow runs behind the R1 ProgressRail. Imported by both
// SampleUpload (the Upload step) and MappingReview (Review mapping / Preview / Go live)
// so the two routes render one coherent journey (no duplicated label lists).
export const CSV_JOURNEY_STEPS = ['Upload', 'Review mapping', 'Preview', 'Go live'] as const

// Zero-based rail index per step, for `<ProgressRail current={...} />`.
export const CSV_JOURNEY_STEP_INDEX = {
  upload: 0,
  review: 1,
  preview: 2,
  golive: 3,
} as const
