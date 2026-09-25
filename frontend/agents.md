# AGENTS.md - Frontend (Next.js)

Kobi board UI and AI chat panel for the Kanban MVP. Read the root [agents.md](../agents.md) first; its non-negotiable rules apply here.

Built so far: NextAuth v4 config (`lib/auth.ts`), server session helpers (`lib/session.ts`), `proxy.ts` route protection, server-only API client (`lib/api/client.ts`), sign-in/sign-up/sign-out pages, the board list page (`app/page.tsx`), the board page (`app/boards/[id]`), `components/board/*` (`board-view.tsx` owns state, the mutation queue and drag and drop; `lib/board-state.ts` holds the pure optimistic updates), the browser API client (`lib/api/browser.ts`) the same-origin proxy route (`app/api/backend/[...path]`) and the AI chat panel (`components/ai/ai-panel.tsx`, wired into `board-view.tsx`). Next 16 differs from older versions: read `node_modules/next/dist/docs/` (inside the container) before relying on memory. Running `next dev` may try to write a generated `AGENTS.md`; on macOS that name collides with this file (case-insensitive), so check this file is intact afterward.

## Intended Structure

```
frontend/
  app/            App Router routes and layouts
  components/     UI components (board, column, card, ai-panel)
  lib/api/        Typed API client for the FastAPI backend
  lib/types/      Types mirroring backend Pydantic schemas
  Dockerfile
```

## Rules

- **Talk only to the FastAPI backend.** No direct DB access, no LLM calls, no secrets in client code. Never put secrets in `NEXT_PUBLIC_` variables.
- **Authenticated by default.** Every page except sign-in and sign-up requires a session; unauthenticated users are redirected to sign-in.
- **Two base URLs.** Server-side code (Server Components, route handlers) uses the compose-network URL (`http://backend:8000`). Browser code uses the host-published URL. Keep both in env config, never hardcoded.
- **Server Components by default.** Add `"use client"` only for interactive parts: board canvas, drag and drop, inline column editing, AI chat panel.
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

## UI

- Design system tokens and component styling live in `app/globals.css`: slate canvas, elevated white surfaces, indigo/cyan accent, compact radii, and soft shadows. Reuse these tokens for new UI rather than introducing one-off visual values.
- Layouts must work on narrow screens (columns scroll horizontally).
- Interactive elements need accessible names, visible focus, and sufficient contrast.

## Commands And Checks

Run inside the container (from the repo root): `docker compose exec frontend npm run lint`, `npm run typecheck`, `npm run build`. Dev server is started by `docker compose up`. No test framework yet. The Dockerfile has `dev` and `prod` targets; prod uses Next `output: "standalone"`. Accessibility done in Phase 5: page titles, headings for columns, skip link, reduced motion, 2rem touch targets, labelled controls; not yet checked with axe or a screen reader. Do not claim checks passed without stating which command you ran.

## Assumptions To Confirm

- Decided in Phase 1: `next-auth` v4 (4.24.x). Next 16 renamed middleware to `proxy.ts`; `proxy.ts` only does optimistic redirects, `requireUser()` in `lib/session.ts` is the authoritative check. The backend token is kept out of the client-visible session on purpose; server code reads it from the httpOnly cookie via `getAccessToken()`. The session `maxAge` matches the backend token lifetime; a backend 401 sends the user to `/signout`. The session cookie name is hardcoded in `lib/session.ts` (`next-auth.session-token`, `__Secure-` prefix over HTTPS).
- Decided: the browser never calls the backend directly. Server components and server actions (`app/signup/actions.ts`) do; when Phase 3 needs client-side mutations, add Next route handlers that forward with the token. `NEXT_PUBLIC_API_URL` is unused so far.
- Package manager is npm, Node 22 (decided in Phase 0).
- Styling approach (Phase 0 scaffold has no Tailwind, plain global CSS only) (e.g. Tailwind) and component library, if any.
- Test framework.
