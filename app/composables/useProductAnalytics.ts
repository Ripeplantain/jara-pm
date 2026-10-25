export type ProductEventName =
  | 'ask_kobi_opened'
  | 'auth_login_failed'
  | 'auth_signup_failed'
  | 'task_capture_submitted'
  | 'task_action_completed'
  | 'task_action_reopened'
  | 'task_action_rescheduled'
  | 'task_action_deleted'
  | 'task_recurrence_paused'
  | 'user_logged_out'
  | 'theme_changed'
  | 'invite_sent'
  | 'invite_resent'
  | 'invite_revoked'
  | 'invite_accepted'
  | 'member_removed'
  | 'workspace_created'
  | 'workspace_switched'
  | 'workspace_identifiers_saved'

type ProductEventProperties = Record<string, string | number | boolean | null | undefined>

export const useProductAnalytics = () => {
  const posthog = usePostHog()

  const capture = (event: ProductEventName, properties?: ProductEventProperties) => {
    posthog?.capture(event, properties)
  }

  const identify = (distinctId: string) => {
    posthog?.identify(distinctId)
  }

  const reset = () => {
    posthog?.reset()
  }

  const captureException = (error: unknown, properties?: ProductEventProperties) => {
    posthog?.captureException(error, properties)
  }

  return { capture, identify, reset, captureException }
}
