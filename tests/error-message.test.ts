import { describe, expect, it } from 'vitest'
import { getUserFacingErrorMessage } from '../shared/utils/error-message'

describe('getUserFacingErrorMessage', () => {
  it('does not expose unexpected error details', () => {
    expect(getUserFacingErrorMessage(new Error('database secret'), 'Request failed'))
      .toBe('Request failed')
  })

  it('uses the validation override for a 400 response', () => {
    expect(getUserFacingErrorMessage(
      { statusCode: 400, data: { message: 'Invalid request' } },
      'Request failed',
      { validation: 'Please review the highlighted fields.' },
    )).toBe('Please review the highlighted fields.')
  })

  it('returns the session message for a 401 response', () => {
    expect(getUserFacingErrorMessage({ status: 401 }, 'Request failed'))
      .toBe('Your session has expired. Please sign in again.')
  })

  it('returns the conflict message for an already-resolved 409 response', () => {
    expect(getUserFacingErrorMessage(
      { statusCode: 409, data: { message: 'Proposal was already resolved' } },
      'Request failed',
    )).toBe('This plan has already been resolved. Request a new plan if needed.')
  })

  it('returns the rate-limit message for a 429 response', () => {
    expect(getUserFacingErrorMessage({ statusCode: 429 }, 'Request failed'))
      .toBe('Kobi is taking a short break. Please try again in a moment.')
  })

  it('returns the unavailable message for a 500 response', () => {
    expect(getUserFacingErrorMessage({ statusCode: 500 }, 'Request failed'))
      .toBe('Kobi is temporarily unavailable. Please try again in a moment.')
  })

  it('supports flow-specific unavailable messages', () => {
    expect(getUserFacingErrorMessage(
      { statusCode: 503 },
      'Request failed',
      { unavailable: 'The task could not be created right now.' },
    )).toBe('The task could not be created right now.')
  })

  it('uses the network fallback when there is no response status', () => {
    expect(getUserFacingErrorMessage(
      new Error('fetch failed'),
      'Request failed',
      { network: 'Check your connection and try again.' },
    )).toBe('Check your connection and try again.')
  })
})
