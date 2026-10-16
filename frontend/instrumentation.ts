import type { Instrumentation } from "next";

/**
 * Server-side error tracking. Next.js calls `onRequestError` when a Server Component, Route
 * Handler or Server Action throws, which is the only place the server's own stack trace can be
 * seen - the browser gets a digest and a generic error boundary.
 */
export function register(): void {
  // Nothing to initialise: the client is built lazily on the first error.
}

/**
 * Reads the distinct id the browser is already using, so a server error lands on the same
 * person as that session's client events. The cookie holds whatever `identifyUser` set, which
 * is the `user:{id}` shape agreed in `lib/analytics.ts`.
 */
function distinctIdFromCookies(cookie: string | string[] | undefined): string | undefined {
  if (!cookie) return undefined;
  const header = Array.isArray(cookie) ? cookie.join("; ") : cookie;
  const match = header.match(/ph_phc_.*?_posthog=([^;]+)/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as { distinct_id?: string };
    return parsed.distinct_id;
  } catch {
    // An unreadable cookie is not worth a log line; the error is still reported, anonymously.
    return undefined;
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // The edge runtime has no PostHog server client; nothing in this app renders there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const posthog = (await import("@/lib/posthog-server")).getPostHogServer();
  if (!posthog) return;
  try {
    await posthog.captureException(err, distinctIdFromCookies(request.headers.cookie), {
      // The route, not the full URL: lifecycle paths carry single-use tokens in the query.
      path: request.path,
      router_kind: context.routerKind,
      route_type: context.routeType,
      environment: process.env.APP_ENV ?? "development",
    });
  } catch {
    // Reporting must never be the reason a request fails to finish failing.
  }
};
