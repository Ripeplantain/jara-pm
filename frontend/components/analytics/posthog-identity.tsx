"use client";

import { useEffect } from "react";
import { identifyUser } from "@/lib/analytics";

/**
 * Identifies the signed-in account to PostHog. Rendered by the app shell, which already has the
 * authoritative user from the server session, so the browser is never trusted for who it is.
 * Only the internal row id crosses over: never the email address.
 */
export function PostHogIdentity({ userId }: { userId: number }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);
  return null;
}
