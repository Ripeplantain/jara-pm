# Analytics and error tracking (PostHog)

Kobi reports product analytics and unhandled exceptions to [PostHog](https://posthog.com). The
whole integration is **optional**: with no project token configured, no SDK initialises, nothing
is sent, and the application behaves exactly as it did before.

There are three senders, each covering what only it can see:

| Sender | Where | Covers |
|---|---|---|
| `posthog` (Python) | `backend/app/services/posthog_client.py` | Product milestones from the service layer, and unhandled FastAPI exceptions |
| `posthog-js` | `frontend/instrumentation-client.ts` | Page views, autocapture, identity, unhandled browser errors |
| `posthog-node` | `frontend/instrumentation.ts` | Exceptions thrown while the Next.js server renders |

## Configuration

Copy the PostHog block from `.env.example` into `.env`. Nothing here is a privileged credential:
the **project token is a write-only ingestion key and is designed to sit in client code**. A
personal API key is privileged and must never be set in any of these variables.

| Variable | Read by | Notes |
|---|---|---|
| `POSTHOG_PROJECT_TOKEN` | backend | Empty disables backend capture entirely |
| `POSTHOG_HOST` | backend | Region-specific. EU projects **must** use `https://eu.i.posthog.com` |
| `APP_ENV` | backend, Next server | `development`, `staging` or `production`; rides on every event |
| `APP_RELEASE` | backend | Optional git sha, reported as `$app_version` |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | browser, Next server | Same value as above |
| `NEXT_PUBLIC_POSTHOG_HOST` | browser, Next server | Same value as above |
| `NEXT_PUBLIC_POSTHOG_SESSION_REPLAY` | browser | Replay is off unless this is exactly `true` |

**The `NEXT_PUBLIC_*` values are inlined into the client bundle at build time**, not read at run
time. They are build args in `frontend/Dockerfile` and are passed through
`docker-compose.prod.yml`, so changing one needs an image rebuild, not a restart.

Getting the region wrong is the most common setup mistake: an EU project with the US host accepts
nothing. The project's region is visible in any PostHog app URL.

## Events

Event names are `snake_case`. Every one is written from authoritative application logic — the
service function that actually performed the change — rather than from a button click, so an
action taken by the AI assistant is counted exactly like the same action taken by hand.

| Event | Written by | Properties |
|---|---|---|
| `user_registered` | `services/auth.register_user` | `invited` |
| `user_signed_in` | `services/auth.authenticate` | — |
| `onboarding_completed` | `services/onboarding` | `workspace_id` |
| `board_created` | `services/boards` | `board_id`, `workspace_id` |
| `card_created` | `services/boards` | `board_id`, `workspace_id` |
| `sprint_created` | `services/sprints` | `board_id`, `workspace_id` |
| `invitation_sent` | `services/workspaces` | `workspace_id` |
| `ai_used` | `services/ai_usage` | `provider_calls`, `workspace_id` |

`$pageview`, `$pageleave`, `$identify`, `$autocapture` and `$exception` come from the SDKs.

Six of the eight also persist a row in the local `product_events` table, which backs the
seven-day rollup on `GET /api/health/metrics`. `user_registered` and `user_signed_in` go straight
to PostHog and write no row: sign-ins are frequent, and that table is a small rollup rather than
an event store.

### Adding an event

1. Add the name to `EVENTS` in `backend/app/services/product_analytics.py`.
2. Add a matching field to `MetricsResponse` in `backend/app/schemas/health.py`, or the
   `/health/metrics` response will silently drop it.
3. Call `product_analytics.track(db, "<name>", user=..., workspace_id=..., properties={...})`
   from the **service function**, inside the transaction, before its commit.
4. Add an assertion to `backend/tests/test_posthog_analytics.py`.

Only properties whose key ends in `_id`, or that are named `count`, survive the filter in
`track()`. That is deliberate: it makes leaking a card title or a prompt into an event property
require editing the filter, not just forgetting to think about it. For an event that genuinely
needs another property, widen the filter in one place and say why.

## Transactional guarantee

`posthog_client.capture()` does not send. It queues the event on the SQLAlchemy session, and a
SQLAlchemy `after_commit` listener sends it when that session commits. `after_soft_rollback`
discards it. A product event therefore cannot describe a change that did not happen — the same
guarantee `services/activity.py` gets from running inside the transaction.

`capture_now()` exists for events that write nothing (a sign-in) and `capture_exception()` for
exceptions, which have no transaction left to ride on.

## Identity

The distinct id is `user:{internal account id}` — never an email address, never a phone number.
It is built by `user_distinct_id()` in `backend/app/services/posthog_client.py` and by
`distinctIdFor()` in `frontend/lib/analytics.ts`. **Those two must produce byte-identical
strings**, or a person's browser events and server events split into two people.

- The app shell identifies the signed-in account (`components/analytics/posthog-identity.tsx`),
  using the user the server already verified. The browser is never trusted for who it is.
- Signing out goes through `signOutAndReset()` in `frontend/lib/sign-out.ts`, which resets the
  PostHog identity and then clears the session. All four sign-out paths use it, so the next
  person at that browser starts anonymous instead of inheriting a person profile.
- `person_profiles: "identified_only"` means an anonymous visitor reading `/welcome` is tracked
  but gets no person profile until they sign in.
- `ai_used` has no acting user in `record_completion`, so it is sent against
  `workspace:{id}` with `$process_person_profile: false` rather than inventing a person for a
  workspace.

## Error tracking

- **Browser**: `capture_exceptions` catches unhandled errors and promise rejections. React error
  boundaries swallow errors, so each `app/**/error.tsx` also calls `useReportedError(error,
  "<boundary>")`, which reports once per error object and includes the Next.js `digest`.
  `console.error` is *not* treated as an exception — this codebase uses it for handled failures.
- **Next.js server**: `onRequestError` in `frontend/instrumentation.ts`. It reports the route, not
  the full URL, and reads the distinct id from PostHog's own cookie so a server error lands on the
  same person as that session's client events.
- **FastAPI**: a `try`/`except` around `call_next` in `backend/app/main.py` reports and re-raises,
  so the response the client sees is unchanged. Only genuinely unhandled exceptions reach it:
  `NotFound`, `Forbidden`, `Conflict`, `InvalidRequest` and the LLM errors are turned into
  responses further in, so **an expected refusal is never reported as a crash**.

Reporting never breaks a request. Every provider call is wrapped; a failure increments
`analytics_failures` on `/api/health/metrics` and logs a warning instead of raising.

## Session replay

Off by default, and it needs two separate switches:

1. `NEXT_PUBLIC_POSTHOG_SESSION_REPLAY=true` in the environment, and
2. session recording enabled in the PostHog project settings (**Project settings → Session
   replay**). This cannot be set through the MCP server; there is no tool for it.

When it is on, masking is maximal: `maskAllInputs: true` and `maskTextSelector: "*"`. Everything
a user types *and* everything they read is masked, because in this product all of it is customer
content — card titles, comments, private pages. Replays show layout and interaction, not text.
Relax `maskTextSelector` per element if a specific screen is worth reading in full; do not relax
it globally.

## Privacy safeguards

- No password, hash, access token, session cookie or LLM prompt is ever a property.
- No email address is sent. The distinct id is an internal integer.
- `before_send` in `instrumentation-client.ts` rewrites `token`, `proposal_token`,
  `access_token` and `code` query parameters to `redacted`. This matters because
  `/reset-password`, `/verify-email` and `/invite` carry **single-use tokens in the URL**, which
  would otherwise land in `$current_url` on every pageview.
- Backend exception properties carry the request path run through `_safe_path()`, the same
  redaction the HTTP log uses, so an invitation token never reaches PostHog.
- `capture_exception_code_variables=False` on the Python client keeps local variables out of
  captured stack traces, since a frame can hold a password.
- Only the project's write-only ingestion token is ever read by application code.

## Dashboard

**Application Health & Product Analytics** — project 264650, dashboard 1029112
(<https://eu.posthog.com/project/264650/dashboard/1029112>). Nine tiles: a context card, daily and
weekly active users, the activation funnel, weekly retention, new registrations, feature usage,
error trend by source, and the most frequent exceptions by route.

`filterTestAccounts` is off on every tile, and `environment` separates development from
production — filter on it before drawing conclusions.

The project has no Data Catalog metrics, so **every definition on that dashboard is
noncanonical**: a one-off query, not a governed metric. Promote the ones that matter with
`data-catalog-metric-create` before anyone treats them as official.

## Troubleshooting

**No events arrive at all.** Check the token is set and the region is right. The backend logs
`posthog client unavailable` if the SDK cannot be constructed, and `analytics_failures` on
`/api/health/metrics` counts provider failures. With no token, `DisabledSink` keeps the last 50
events in memory, so `posthog_client.get_sink().captured` in a shell shows what *would* have been
sent.

**Nothing arrives from a headless browser.** posthog-js refuses to capture for bot user agents,
and `HeadlessChrome` is on that list. `capture()` returns `undefined` and logs nothing. Override
the user agent (`--user-agent=...Chrome/141.0.0.0 Safari/537.36`) when driving the app for a
smoke test, or you will measure the bot filter instead of the integration.

**Events appear minutes late.** Ingestion lag is real and uneven: backend events have shown up in
5-20 seconds and `$pageview` has taken around 90. Wait before concluding an event is missing.

**`window.posthog` is undefined.** Expected. The npm module does not set a global, unlike the HTML
snippet. Read the identity from PostHog's cookie, as `frontend/instrumentation.ts` does.

**`Module not found: posthog-node`.** `instrumentation.ts` is compiled for the edge runtime too,
because `proxy.ts` runs there, and `posthog-node` has no edge build. It is listed in
`serverExternalPackages` in `frontend/next.config.ts` for exactly this reason.

**Capture queued but never sent.** Something called `capture()` and the session never committed.
Queue inside the transaction, before the commit, or use `capture_now()`.
