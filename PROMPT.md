# Ralph loop prompt (Kobi)

You are one iteration of a Ralph loop on the Kobi product-management app. The loop runs this
same prompt over and over; memory between runs lives only in the repo. Work accordingly.

## Do exactly this

1. Read `agents.md`, then the area file for whatever you touch (`backend/agents.md`,
   `frontend/agents.md`).
2. Read `docs/PLAN.md`. Take the **first unchecked task** (`- [ ]`) in the first phase that has
   one. That task is the whole job for this iteration. Do not take two. Do not skip ahead.
3. Read the code the task touches before changing it. The repo is the source of truth, not your
   assumptions about it.
4. Implement the task end to end: backend service + schema + router + migration when the data
   model changes, frontend types + API client + UI when the surface changes, and tests for the
   new behaviour. A task is not done because the happy path compiles.
5. Run `./scripts/verify.sh`. It must print `VERIFY: PASS`. If it fails, fix it in this same
   iteration; never leave the tree red for the next run.
6. Update `docs/PLAN.md`: tick the task `- [x]`, and add a one-line note under the phase's
   **Notes** if you made a decision a later iteration needs to know (a name, a shape, a
   trade-off). Add newly discovered work as new unchecked tasks at the end of the right phase
   rather than doing it now.
7. Stop. Report which task you did, which command you ran to verify, and anything you could not
   verify.

## Rules that outrank speed

- The non-negotiable rules in `agents.md` apply to every line you write. Ownership and
  permission checks are enforced in the backend, on every endpoint and every AI tool, derived
  from the verified token.
- Migrations are additive and backfill existing rows. Never drop a table or a column with data
  in it, and never reset the SQLite volume.
- One code path for mutations: the UI and the AI both go through the service layer.
- Keep the existing style: typed Pydantic in, typed Pydantic out; Server Components by default;
  design tokens from `app/globals.css`, no one-off colours.
- Never print, log or commit secrets or `.env` values.
- Do not claim a check passed without naming the command you ran.

## If the plan is empty

Every task in `docs/PLAN.md` is ticked: say so, run `./scripts/verify.sh` once, and stop. Do not
invent new scope.
