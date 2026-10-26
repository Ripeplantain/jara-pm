# Post-E1 checklist

Follow-ups left after Slice E1 (`c44e7f7`). Source: `docs/plans/slice-e1-plan.md` §7, §10 and
`docs/plans/linear-adoption.md` §8a.

- [ ] **1. Paid evals** — `triage` (10 calls), `reschedule` (10), `goal_plan` baseline re-run (18).
      User runs these themselves; record results here. Needs `KOBI_EVAL_API_KEY` and `KOBI_EVAL_MODEL` in the environment.
- [x] **2. `breakdown` proposal kind** — union member, provider JSON schema, accept branch against an
      existing project, project-page trigger, 6–8 eval cases, tests. L3 prompt change. No schema change.
- [x] **3. Undo for reschedule (§10.2)** — store the previous dates/status per accepted reschedule and
      add an undo action. Schema checkpoint APPROVED 2026-10-26.
- [x] **4. Local offline reschedule (§10.6)** — deterministic redistribution of overdue work by
      priority when no model is reachable. Approved 2026-10-26.
- [x] **5. Revisit Jira-style tensions (§8a)** — C1 status editor and task identifiers on every row.
      Decision 2026-10-26: leave as is, nothing reported as heavy.
