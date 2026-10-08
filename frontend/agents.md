# AGENTS.md - Frontend (Next.js)

Kobi's UI: boards, workspaces, people, insights and the AI chat panel. Read the root
[agents.md](../agents.md) first; its non-negotiable rules apply here.

Built so far: NextAuth v4 config (`lib/auth.ts`), server session helpers (`lib/session.ts`),
`proxy.ts` route protection, the server-only API client (`lib/api/client.ts`) and its typed reads
(`lib/api/server.ts`), the browser client (`lib/api/browser.ts`) over the same-origin proxy
(`app/api/backend/[...path]`), the app shell (`components/shell/*`: workspace switcher, nav,
notification bell, account menu, theme toggle, avatars), the dashboard, the board page
(`components/board/*` - `board-view.tsx` owns state, the mutation queue and drag and drop;
`lib/board-state.ts` holds the pure optimistic updates; `card-drawer.tsx` is the card detail),
members, settings, my work, activity, per-board insights (`components/insights/*`), and the AI
panel (`components/ai/ai-panel.tsx`). Next 16 differs from older versions: read `node_modules/next/dist/docs/` (inside the container) before relying on memory. Running `next dev` may try to write a generated `AGENTS.md`; on macOS that name collides with this file (case-insensitive), so check this file is intact afterward.

## Intended Structure

```
frontend/
  app/                 App Router routes and layouts
    api/backend/       Same-origin proxy: attaches the Bearer token, allowlists the API surface
    api/workspace/     Remembers the active workspace in a cookie
  components/
    shell/             The frame every signed-in page renders inside
    board/             Board canvas, columns, cards, drawer, filters, sprints
    insights/          Inline-SVG charts with table fallbacks
    members/ settings/ work/
  lib/api/             Typed clients: client.ts + server.ts (server), browser.ts (client)
  lib/types/           Types mirroring backend Pydantic schemas
  lib/page-data.ts     loadShell(): session, workspaces, active workspace, unread count
  Dockerfile
```

## Rules

- **Talk only to the FastAPI backend.** No direct DB access, no LLM calls, no secrets in client code. Never put secrets in `NEXT_PUBLIC_` variables.
- **Authenticated by default.** Every app page except the landing page, privacy, terms, invitation,
  email verification, password recovery, sign-in and sign-up requires a session; unauthenticated
  visitors are sent to `/welcome`.
- **Two base URLs.** Server-side code (Server Components, route handlers) uses the compose-network URL (`http://backend:8000`). Browser code uses the host-published URL. Keep both in env config, never hardcoded.
- **Server Components by default.** Add `"use client"` only for interactive parts: the board
  canvas, drag and drop, inline editing, menus, the card drawer, the AI chat panel.
- **Every authenticated page starts with `loadShell()`** (`lib/page-data.ts`) and renders inside
  `<AppShell>`. It verifies the session, loads the user's real workspaces and resolves the active
  one; a 401 from the backend sends the user to `/signout`.
- **The active workspace is a cookie hint, never an authority.** `resolveActiveWorkspace` checks
  it against the workspaces the backend returned, so a stale or forged cookie falls back to the
  first one instead of leaking anything.
- **Hide what the role cannot do, but never rely on hiding it.** `lib/types/workspace.ts` has
  `canWrite` / `canAdminister`; the backend refuses regardless, and the UI shows its message.
- **One API client and one set of types.** Types mirror the backend schemas; do not redefine shapes per component.
- Board data can be fetched server-side for first load; mutations go through the API client from client components.

## Auth (NextAuth)

- Use the `next-auth` Credentials provider with email and password, and a JWT session strategy.
- `authorize()` calls the backend login endpoint and never checks passwords itself. The frontend has no user table and no password hashing.
- The backend's access token is stored in NextAuth's session (httpOnly cookie). Attach it as a Bearer token when calling the backend from server code or a proxy route handler; do not store it in `localStorage`.
- Protect routes with middleware or a server-side session check, and also handle a 401 from the backend by signing the user out.
- Sign-up is a form that calls the backend register endpoint, then signs the user in.
- `AUTH_SECRET` and the auth URL come from server env config, set through compose from `.env`. Never expose them via `NEXT_PUBLIC_`.
- Sign-in and sign-up forms need labels, inline errors, and a generic message on failed login.
- Check the installed `next-auth` version's docs before writing config; the API differs between v4 and v5 (Auth.js).

## Cards And Card Detail

- The drawer (`components/board/card-drawer.tsx`) is fed by the board state it was opened from,
  so opening a card costs no round trip. Only comments and history, which the board does not
  hold, are fetched.
- It reads the open card **out of board state** rather than keeping its own copy, so a drawer
  edit and a board edit cannot disagree, and a card that disappears simply stops rendering.
- It is deep-linkable: `/boards/{id}?card={cardId}`, which is what notification links use.
- Escape closes it and Tab is trapped inside it while it is open.
- The card face stays compact - a column has to show several cards at once.

## Columns

- Titles edit inline: commit on blur or Enter, cancel on Escape, reject empty titles.
- Support add, rename, reorder, and delete. Deleting a column with cards requires confirmation and a choice about the cards (move or delete).
- Column edits use optimistic updates and roll back with a visible error if the API fails.

## Cards And Drag And Drop

- Persist on drop only. Send one move request (target column + position), not a series of edits while dragging.
- Update optimistically, then reconcile with the server's returned state; roll back on failure.
- Moving via keyboard (and a non-drag fallback such as a "move to column" menu) is required, not optional polish.
- Drag and drop uses `@dnd-kit` (decided in Phase 3). Drag and keyboard-drag start from a dedicated handle button; each card also has up/down buttons and a "move to column" select.

## AI Panel

- Sends the user message to the backend AI endpoint and renders the assistant's reply.
- Applies the returned list of changes to board state and makes them visible (brief highlight or a change summary) so users can tell what the AI did.
- Destructive actions proposed by the AI appear as an explicit confirm/cancel prompt; nothing is deleted until the user confirms.
- Reconcile from the server's returned state so streamed replies and optimistic UI do not fight each other.
- Show loading and error states; the AI panel failing must not break manual board editing.

## Charts

- Inline SVG, no chart library. One series per chart, so one hue and no legend; only status
  (over a WIP limit, overdue) uses the second colour.
- **Every chart ships with the same numbers as a table underneath it**, always rendered, never
  behind a toggle.
- Chart colours are `--chart-series` / `--chart-alarm`, picked separately for each theme and
  checked for contrast and colour-vision separation against that theme's surface - dark mode is
  selected, not a lightened copy.

## UI

- Design system tokens and component styling live in `app/globals.css`: slate canvas, elevated
  white surfaces, indigo/cyan accent, compact radii, and soft shadows. Reuse these tokens for new
  UI rather than introducing one-off visual values.
- **Dark mode is a redefinition of those tokens**, under both `@media (prefers-color-scheme:
  dark)` (guarded by `:root:not([data-theme="light"])`) and `:root[data-theme="dark"]`. New CSS
  that uses tokens needs no dark-mode rule; new CSS with literal colours does, so use tokens.
  `app/theme-script.tsx` applies the saved choice before first paint.
- Avatar and label colours are *names* from a fixed palette (`tint-*` classes), never raw hex
  from the API.
- `eslint-plugin-react-hooks` rejects `setState` inside an effect body. Adjust state during
  render when a prop changes, or read external stores (localStorage) with `useSyncExternalStore`.
- Layouts must work on narrow screens (columns scroll horizontally).
- Interactive elements need accessible names, visible focus, and sufficient contrast.

## Commands And Checks

Run `./scripts/verify.sh` from the repo root: it runs the backend and frontend checks together
and prefers Docker, falling back to host toolchains when the daemon is not running. Directly:
`docker compose exec frontend npm run lint`, `npm run typecheck`, `npm run build`. Dev server is
started by `docker compose up`. No test framework yet - the backend carries the test suite, and
the frontend is covered by types, lint and a production build.

Adding a route? `next build` regenerates the typed-route table; `PageProps<"/new/route">` will
not typecheck until it has run once. The Dockerfile has `dev` and `prod` targets; prod uses Next `output: "standalone"`. Accessibility done in Phase 5: page titles, headings for columns, skip link, reduced motion, 2rem touch targets, labelled controls; not yet checked with axe or a screen reader. Do not claim checks passed without stating which command you ran.

## Assumptions To Confirm

- Decided in Phase 1: `next-auth` v4 (4.24.x). Next 16 renamed middleware to `proxy.ts`; `proxy.ts` only does optimistic redirects, `requireUser()` in `lib/session.ts` is the authoritative check. The backend token is kept out of the client-visible session on purpose; server code reads it from the httpOnly cookie via `getAccessToken()`. The session `maxAge` matches the backend token lifetime; a backend 401 sends the user to `/signout`. The session cookie name is hardcoded in `lib/session.ts` (`next-auth.session-token`, `__Secure-` prefix over HTTPS).
- Decided: the browser never calls the backend directly. Server components and server actions (`app/signup/actions.ts`) do; when Phase 3 needs client-side mutations, add Next route handlers that forward with the token. `NEXT_PUBLIC_API_URL` is unused so far.
- Package manager is npm, Node 22 (decided in Phase 0).
- Styling approach (Phase 0 scaffold has no Tailwind, plain global CSS only) (e.g. Tailwind) and component library, if any.
- Test framework.

## AI workflow

Project context, rules, and task workflows for AI agents live in `.agent/`.
Start with `.agent/PROJECT.md`.
