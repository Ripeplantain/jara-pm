import type { EstimateScale } from '#shared/types/domain'

// Mirrors the `tasks_estimate_check` constraint in `server/db/schema.ts`.
export const MAX_ESTIMATE = 1000

// An unestimated task is worth one point. That makes weighted progress degenerate exactly to
// count-based progress when nothing in a collection is estimated, which is what keeps the
// switch to weighting a non-event for workspaces that never estimate.
export const POINTS_WHEN_UNESTIMATED = 1

export type EstimateOption = {
  /** Stored value. Estimates are always points, whatever the scale displays. */
  value: number
  label: string
}

const points = (values: number[]): EstimateOption[] =>
  values.map(value => ({ value, label: String(value) }))

// Pure data, no behaviour: the scale only decides which values a picker offers and how they
// are labelled. T-shirt sizes are stored as the fibonacci points they stand for, so switching
// between the two scales never rewrites a stored estimate.
export const ESTIMATE_SCALE_OPTIONS: Record<EstimateScale, EstimateOption[]> = {
  none: [],
  exponential: points([1, 2, 4, 8, 16]),
  fibonacci: points([1, 2, 3, 5, 8, 13, 21]),
  linear: points([1, 2, 3, 4, 5, 6, 7]),
  tshirt: [
    { value: 1, label: 'XS' },
    { value: 2, label: 'S' },
    { value: 3, label: 'M' },
    { value: 5, label: 'L' },
    { value: 8, label: 'XL' },
    { value: 13, label: 'XXL' },
    { value: 21, label: 'XXXL' },
  ],
}

export const estimateOptions = (scale: EstimateScale): EstimateOption[] => ESTIMATE_SCALE_OPTIONS[scale]

/**
 * How an estimate reads under a scale. A value the scale does not define still renders as its
 * own number rather than as nothing: a stored estimate survives a scale change, so a picker
 * must be able to show a value it would not have offered.
 */
export const estimateLabel = (scale: EstimateScale, value: number | null): string | null => {
  if (value === null) return null
  return ESTIMATE_SCALE_OPTIONS[scale].find(option => option.value === value)?.label ?? String(value)
}

export const taskPoints = (estimate: number | null): number => estimate ?? POINTS_WHEN_UNESTIMATED
