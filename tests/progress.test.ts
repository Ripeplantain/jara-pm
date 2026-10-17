import { describe, expect, it } from 'vitest'
import { calculateProgress } from '../shared/utils/progress'

describe('calculateProgress', () => {
  it('does not describe empty work as zero percent complete', () => {
    expect(calculateProgress(0, 0)).toBeNull()
  })

  it('rounds progress from underlying task completion', () => {
    expect(calculateProgress(2, 3)).toBe(67)
    expect(calculateProgress(3, 3)).toBe(100)
  })
})
