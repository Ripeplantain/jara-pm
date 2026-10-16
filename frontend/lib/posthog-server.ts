import "server-only";
import { PostHog } from "posthog-node";

/**
 * PostHog for the Next.js server runtime. This covers only what the Node server itself throws
 * while rendering: Server Components, Route Handlers and Server Actions. The FastAPI backend
 * reports its own exceptions through `backend/app/services/posthog_client.py`.
 *
 * One client for the process, because it batches on a timer.
 */
let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  if (!client) {
    client = new PostHog(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      // Render errors arrive one at a time and are worth knowing about immediately.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}
