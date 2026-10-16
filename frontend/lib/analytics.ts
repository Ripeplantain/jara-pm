import posthog from "posthog-js";

/**
 * The browser side of the PostHog contract. Everything the UI needs goes through here so the
 * distinct-id shape, the enabled check and the failure handling live in one place.
 *
 * Initialisation itself is in `instrumentation-client.ts`, which Next.js runs once per page
 * load. Nothing here initialises anything.
 */

/**
 * True when a project token was inlined at build time. `instrumentation-client.ts` tests the
 * same value, so this is exactly "did the SDK initialise".
 */
export const analyticsEnabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

/**
 * The person key for one account.
 *
 * It must stay byte-identical to `user_distinct_id` in
 * `backend/app/services/posthog_client.py`: the browser and the backend both report events for
 * the same person, and a different shape on either side would split them into two.
 */
export function distinctIdFor(userId: number): string {
  return `user:${userId}`;
}

/** Links the current browser identity to a signed-in account. Safe to call on every render. */
export function identifyUser(userId: number): void {
  if (!analyticsEnabled) return;
  const distinctId = distinctIdFor(userId);
  // identify() is cheap but not free, and re-identifying the same person sends a needless event.
  if (posthog.get_distinct_id() === distinctId) return;
  posthog.identify(distinctId);
}

/**
 * Clears the identity on sign-out, so the next person at this browser starts anonymous instead
 * of inheriting the previous one's person profile.
 */
export function resetIdentity(): void {
  if (!analyticsEnabled) return;
  posthog.reset();
}

/** Reports a handled exception. Never throws: analytics must not break error handling. */
export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  try {
    posthog.captureException(error, properties);
  } catch {
    // Reporting the failure to report would be the only thing left to break.
  }
}
