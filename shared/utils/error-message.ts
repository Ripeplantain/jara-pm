type ErrorLike = {
  name?: string
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: {
    status?: number
    statusCode?: number
    statusMessage?: string
    message?: string
  }
}

export type UserFacingErrorOptions = {
  validation?: string
  network?: string
  notFound?: string
  conflict?: string
  unprocessable?: string
  rateLimited?: string
  unavailable?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const errorLike = (error: unknown): ErrorLike => {
  if (!isRecord(error)) return {}
  const data = isRecord(error.data) ? error.data : undefined
  return {
    name: typeof error.name === 'string' ? error.name : undefined,
    status: typeof error.status === 'number' ? error.status : undefined,
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : undefined,
    statusMessage: typeof error.statusMessage === 'string' ? error.statusMessage : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
    data: data ? {
      status: typeof data.status === 'number' ? data.status : undefined,
      statusCode: typeof data.statusCode === 'number' ? data.statusCode : undefined,
      statusMessage: typeof data.statusMessage === 'string' ? data.statusMessage : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
    } : undefined,
  }
}

export const getUserFacingErrorMessage = (
  error: unknown,
  fallback: string,
  options: UserFacingErrorOptions = {},
) => {
  const normalized = errorLike(error)
  const statusCode = normalized.statusCode
    ?? normalized.status
    ?? normalized.data?.statusCode
    ?? normalized.data?.status
  const serverMessage = normalized.data?.message
    ?? normalized.data?.statusMessage
    ?? normalized.statusMessage
    ?? normalized.message
    ?? ''
  const errorMessage = normalized.message?.toLowerCase() ?? ''
  const isNetworkError = normalized.name === 'FetchError'
    || error instanceof TypeError
    || /fetch failed|failed to fetch|networkerror|network error|load failed/.test(errorMessage)

  if (statusCode === 400) return options.validation ?? 'Please check your input and try again.'
  if (statusCode === 401) return 'Your session has expired. Please sign in again.'
  if (statusCode === 404) return options.notFound ?? 'The requested item could not be found. Refresh and try again.'
  if (statusCode === 409) {
    if (serverMessage.includes('Email already registered')) {
      return 'An account with this email already exists. Try signing in instead.'
    }
    if (serverMessage.includes('already resolved')) {
      return 'This plan has already been resolved. Request a new plan if needed.'
    }
    return options.conflict ?? 'This action conflicts with existing data. Refresh and try again.'
  }
  if (statusCode === 422) return options.unprocessable ?? 'Some information is no longer valid. Refresh and try again.'
  if (statusCode === 429) return options.rateLimited ?? 'Kobi is taking a short break. Please try again in a moment.'
  if (statusCode !== undefined && statusCode >= 500) {
    return options.unavailable ?? 'Kobi is temporarily unavailable. Please try again in a moment.'
  }
  if (statusCode === undefined) {
    return isNetworkError
      ? options.network ?? 'We could not reach Kobi. Check your connection and try again.'
      : fallback
  }
  return fallback
}
