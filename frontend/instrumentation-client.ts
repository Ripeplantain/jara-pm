import posthog from "posthog-js";

/**
 * PostHog for the browser. Next.js loads this file once per page load, before application code,
 * which is what keeps initialisation out of a component and makes double-init on rerender or
 * navigation impossible.
 *
 * Analytics stay optional: with no token the SDK is never initialised, so a developer without a
 * PostHog project runs the app exactly as before. The token here is the project's public
 * ingestion token, which is designed to sit in client code; no personal API key ever does.
 */
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

/** Lifecycle links carry single-use tokens in the query string. They must never be sent. */
const SENSITIVE_QUERY_PARAMS = ["token", "proposal_token", "access_token", "code"];

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    let changed = false;
    for (const name of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(name)) {
        url.searchParams.set(name, "redacted");
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

if (token) {
  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    defaults: "2026-05-30",
    // Spelled out rather than inherited from `defaults`, because a later defaults date could
    // change them: 'history_change' listens to the History API, so an App Router navigation
    // produces exactly one pageview and no manual capture is needed, which is what would
    // otherwise double-count. Pageleave follows whatever pageview does.
    capture_pageview: "history_change",
    capture_pageleave: "if_capture_pageview",
    // No person profile until someone signs in: a visitor reading /welcome is not a user yet.
    person_profiles: "identified_only",
    // Unhandled errors and promise rejections, without waiting on project-side remote config.
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      // console.error is used for handled, expected failures here, so it is not an exception.
      capture_console_errors: false,
    },
    // Off unless a deployment opts in; the project's own sample rate then applies on top.
    disable_session_recording: process.env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY !== "true",
    session_recording: {
      // Everything a user types is customer content: card titles, comments, private pages.
      maskAllInputs: true,
      // And so is everything they read, so replays record layout and interaction, not text.
      // Relax this per element once there is a screen worth reading in full.
      maskTextSelector: "*",
    },
    before_send: (event) => {
      if (!event) return null;
      for (const [key, value] of Object.entries(event.properties ?? {})) {
        if (typeof value === "string" && value.includes("token=")) {
          event.properties[key] = scrubUrl(value);
        }
      }
      return event;
    },
  });
}
