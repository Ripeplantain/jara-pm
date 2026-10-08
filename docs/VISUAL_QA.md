# Kobi visual and accessibility QA

This checklist records the completed visual QA pass and the remaining accessibility gate for the responsive SaaS shell. It is intentionally kept
separate from automated type/lint/build checks because those cannot prove rendered layout,
keyboard order, contrast, or screen-reader output.

## Automated evidence available in this environment

- The production Next build completes successfully.
- The built server returned HTTP 200 for `/welcome`, `/privacy`, `/terms`, `/invite`,
  `/verify-email`, `/forgot-password`, `/reset-password`, and `/signin` on 2026-10-08.
- Frontend lint and TypeScript checks pass.
- `scripts/visual-qa.mjs` runs a dependency-free Chrome DevTools Protocol smoke against a
  disposable staging account. The final 2026-10-08 run covered the dashboard at `1440x900`,
  `768x900` and `375x844`, plus onboarding, board/card drawer and Ask Kobi states at `375x844`,
  in forced light and dark themes where applicable.
- That run found zero missing accessible names in the inspected controls/landmarks, produced
  keyboard tab stops for the dashboard/onboarding/drawer, confirmed Escape closes the card drawer,
  and received a read-only “What is blocked?” answer from Ask Kobi.
- When `QA_AXE_PATH` points to the local `axe-core` bundle, the same smoke also records WCAG rule
  violations and passes for each inspected state. The final 2026-10-08 run reported zero axe
  violations in all 10 matrix states (dashboard 40 passes, onboarding 40, card drawer 46, Ask
  Kobi 43), zero horizontal overflow, and correct forced theme state in every result.
- Task 16.6 is complete from the live browser smoke and direct screenshot review. Human screen-reader
  verification remains intentionally open for the release gate in task 19.5.

## Staging screenshot evidence

Captured against the disposable staging stack on 2026-10-08 with headless Google Chrome at
desktop `1440x900` and narrow `375x844` viewports:

- `dashboard-browser-smoke.png` — shell, workspace navigation, briefing, metrics, signals, board
  creation and empty-state surfaces render without the dashboard error boundary.
- `board-drawer-browser-smoke.png` — card metadata,
  description, checklist and comments remain readable at narrow width.
- `onboarding-browser-smoke.png` — onboarding form labels, template choices and actions render
  at narrow width.
- `ai-browser-smoke.png` — Ask Kobi read-only response state renders after a real board query.

These screenshots are stored in `/private/tmp/kobi-visual-qa/` during verification. They are
evidence for the rendered paths only; they do not replace the keyboard, contrast or screen-reader
checks below.

To repeat the smoke locally, start the staging overlay and a disposable Chrome instance with
remote debugging, then run:

```sh
QA_BASE_URL=http://127.0.0.1:3001 \
QA_EMAIL=<disposable-staging-email> \
QA_PASSWORD=<disposable-staging-password> \
QA_AXE_PATH=frontend/node_modules/axe-core/axe.min.js \
node scripts/visual-qa.mjs
```

## Manual browser checklist

Run against the staging URL at 375px, 768px, and desktop widths, in light and dark themes:

- [ ] Welcome, sign-in, sign-up, verification, recovery and reset pages have no horizontal scroll.
- [ ] Dashboard shows briefing, metrics, signals, sprint health, activity and empty/error states.
- [ ] Sidebar collapse, workspace switcher, command/search palette, notifications and account menu
      remain reachable by keyboard and have visible focus.
- [ ] Board filters, grouping, density controls, card metadata and drawer actions remain usable at
      narrow widths; drawer focus traps and Escape close work.
- [ ] Onboarding and invite flows expose labels, validation errors and loading/success states.
- [ ] Ask Kobi preview, confirm, cancel and error states are readable in both themes.
- [ ] Contrast is acceptable for text, focus rings, status colors and disabled controls; reduced
      motion removes non-essential transitions.
- [ ] Screen reader smoke: landmarks, headings, dialog names, button names, status updates and
      form errors are announced in a sensible order.

Record browser, OS, viewport, theme, result, and screenshots before checking off plan item 16.6.
