import type { H3Event } from 'h3'

export const inviteBaseUrl = (event: H3Event) => {
  const config = useRuntimeConfig(event)
  const configured = String(config.publicBaseUrl || '').trim()
  if (!configured && process.env.NODE_ENV === 'production') {
    throw createError({ status: 500, statusText: 'Public invite URL is not configured' })
  }
  const rawUrl = configured || getRequestURL(event).origin
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw createError({ status: 500, statusText: 'Public invite URL is invalid' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({ status: 500, statusText: 'Public invite URL is invalid' })
  }
  return url.origin
}
