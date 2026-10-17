import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { PostHog } from 'posthog-node'

type EventProperties = Record<string, string | number | boolean | null | undefined>

let client: PostHog | null = null
let configuredToken = ''
let configuredHost = ''

const getClient = () => {
  const config = useRuntimeConfig()
  const posthog = config.public.posthog
  const token = String(posthog?.publicKey || '')
  const host = String(posthog?.host || 'https://us.i.posthog.com')
  if (!token) return null

  if (!client || configuredToken !== token || configuredHost !== host) {
    client = new PostHog(token, { host })
    configuredToken = token
    configuredHost = host
  }
  return client
}

const sessionProperties = (event: H3Event): EventProperties => {
  const sessionId = getHeader(event, 'x-posthog-session-id')
  return sessionId ? { $session_id: sessionId } : {}
}

export const captureServerEvent = (
  event: H3Event,
  distinctId: string,
  eventName: string,
  properties: EventProperties = {},
) => {
  getClient()?.capture({
    distinctId,
    event: eventName,
    properties: { ...properties, ...sessionProperties(event) },
  })
}

export const captureServerException = (
  event: H3Event,
  distinctId: string,
  error: unknown,
  properties: EventProperties = {},
) => {
  const exception = error instanceof Error ? error : new Error('Unknown server error')
  getClient()?.captureException(exception, distinctId, { ...properties, ...sessionProperties(event) })
}
