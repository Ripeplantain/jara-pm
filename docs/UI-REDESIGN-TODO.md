# Kobi UI redesign todo

Direction: combine Notion's calm, flexible workspace canvas with a focused, keyboard-friendly
product surface. The visual system uses warm paper neutrals, graphite text, restrained borders and
one paprika accent. This work is visual and interaction-focused; it does not change backend
contracts or product permissions.

## Foundation

- [x] Move workspace context into the sidebar and make the signed-in shell quieter and denser.
- [x] Establish a neutral, low-shadow visual language with one accent colour.
- [x] Add clearer navigation icons and collapsed-sidebar behavior.
- [x] Add a reusable command-palette action model beyond card search.

## Workspace home

- [x] Replace the large greeting hero with a compact command-center layout.
- [x] Group favourite and all boards with clearer board metadata.
- [x] Refine recent activity and empty states.

## Board experience

- [x] Redesign the board toolbar around title, view controls, filters, sprint, and actions.
- [x] Tighten column and card density while preserving keyboard and drag-and-drop behavior.
- [x] Add clearer board-level view states and responsive mobile navigation.

## Card and assistant experience

- [x] Restyle the card drawer as a document-like detail panel with property rows.
- [x] Make comments and activity easier to scan.
- [x] Move Ask Kobi toward a contextual assistant panel and command entry point.

## Product-wide polish

- [x] Apply the new visual system to My Work, Activity, Insights, Members, and Settings.
- [x] Review loading, empty, error, focus, reduced-motion, and dark-mode states.
- [ ] Manually smoke-test authenticated desktop, tablet, and narrow-screen flows once the local backend is running.
- [x] Run `./scripts/verify.sh` before closing the redesign workstream.

## Icons and typography (2026-10-15)

- [x] Replace every emoji and Unicode-glyph icon with a real icon set.
- [x] Load actual webfonts instead of relying on the OS system stack.
- [ ] Browser-verify the signed-in shell (notification bell, sidebar nav, board, card drawer)
  in light and dark themes.

**Icons.** The UI rendered 42 icon sites as text glyphs, including the `🔔` notification bell and
`💬` comment count. Those resolved to whatever face the viewer's OS supplied, so the emoji came
out in full colour against a flat, quiet palette and glyphs such as `⠿` (braille) and `◷` changed
shape per platform.

They are now Lucide icons delivered through Iconify. `@iconify/react/offline` is the build with
no API code path at all, and `scripts/build-icon-subset.mjs` generates
`components/icon-subset.json` holding only the 23 icons actually used (~6 KB), registered once
with `addCollection()`. The browser never calls Iconify. `components/icon.tsx` is the single
entry point; its `name` prop is a union generated alongside the subset, so a typo fails
`npm run typecheck` rather than rendering an empty box. Add an icon in the script's `ICONS` list
and run `npm run icons:build`.

Deliberately left as text, because they are typography rather than icons: the `⌘K` hints in the
sidebar and search trigger, and the help sentence naming the card move controls (reworded to "the
up and down controls"). The priority marker on a card face is a status swatch, not an icon, so it
became a CSS-drawn `.priority-dot` that inherits the priority colour.

Two deviations from the original plan, both made while implementing:

- The bell uses `lucide:bell` in every state rather than switching to `bell-dot` when unread. The
  dot and the numeric badge occupy the same corner, so showing both stacked two indicators on top
  of each other. The badge keeps the count, and `.bell-button.has-unread` tints the bell instead.
- `lucide:command` was dropped from the subset once the `⌘K` hints stayed as text.

**Typography.** There was no webfont at all: `--notion-font-sans` was the OS system stack, and the
serif and mono tokens named Notion's licensed `Lyon-Text` and `iawriter-mono`, which were never
loaded and silently fell back to Georgia and Menlo.

Now self-hosted through `next/font/google`, so no font CDN is called at runtime:

| Role | Face | Applied to |
|---|---|---|
| Display | Fraunces (variable, `SOFT`/`WONK`/`opsz` axes) | Page and board titles, drawer title, briefing headline, landing hero, wordmark |
| UI and body | Inter Tight | Everything else, including controls, labels and card faces |
| Mono | System stack | The one `<kbd>` shortcut hint |

The Fraunces axes are set via `--display-variation` in `globals.css`; they are what make it
characterful rather than a neutral serif. No mono webfont is loaded because no rule consumed the
token, which kept roughly 100 KB out of the build. The display block sits last in `globals.css`
and relaxes the heading tracking, because the existing rules carry tight negative letter-spacing
tuned for a geometric sans, which pinches a serif.

**Pre-existing bugs found and fixed during the visual pass**, both in the landing preview mockup
and both newly visible once the wordmark became a serif:

- `.preview-sidebar span:last-child` also matched `.kobi-logo-wordmark` (the last child of
  `.kobi-logo`) and gave the wordmark an accent box. Now scoped to `.preview-ask`.
- `.preview-sidebar span:not(.kobi-logo-wordmark)` also matched the outer `.kobi-logo` span,
  forcing `display: block` and collapsing the gap between mark and wordmark. Now a direct-child
  selector that excludes `.kobi-logo`.

**Verification, 2026-10-15.** `./scripts/verify.sh` -> `VERIFY: PASS` with 260 backend tests,
Ruff, frontend ESLint and TypeScript. The production build succeeds and emits all 24 routes. The
frontend container's `node_modules` volume was renewed (`docker compose up -d --build -V
--no-deps frontend`) so the containerised checks see the new dependencies.

Headless Chrome confirmed, on `/welcome` in light and dark: the served HTML carries two
self-hosted `.woff2` preloads and real `<svg>` icons with `aria-hidden` and `focusable="false"`,
and contains no emoji or glyph icons. During this pass the icons initially rendered as empty
`<span>`s because `addCollection()` registers the subset under its `lucide` prefix and the
component was looking up a bare name; the lookup is now fully qualified.

## Page width (2026-10-15)

Every page container inside the signed-in shell was centred with viewport maths:

```css
.page { padding: 2.2rem max(1rem, calc((100vw - 1040px) / 2)) 4rem; }
```

`.page` lives inside `.app-content`, which the sidebar has already narrowed, so padding derived
from `100vw` was computed as if the sidebar were not there. Each page was pushed right and
squeezed: at a 1512px viewport the settings page used 736px of a 1256px column and sat against
the right edge, leaving a dead band beside the sidebar. `.dashboard-page` and `.board-page`
carried the same bug. `.app-header` and `.landing-page` keep the viewport maths, which is correct
for them because they do span the viewport.

They now size to the content column with `width: 100%`, `max-width: var(--page-max)` and
`margin-inline: auto`, with `--page-gutter` and `--page-max` (1440px) as tokens. The board canvas
takes `max-width: none` so its columns use the full column.

The settings page capped at `46rem`, which left most of a wide column empty even once the
centring was fixed. It now uses the page max and lays its cards out in a two-column grid above
70rem, with the heading and the danger zone spanning the full width, so the space is used without
stretching a single form across 1440px. Insights was widened from `62rem` to the page max.

Measured with headless Chrome against the real stylesheet:

| Viewport | Page width | Gutters | Cards |
|---|---|---|---|
| 390px | 390 | 0 / 0 | stacked, 326 |
| 768px | 768 | 0 / 0 | stacked, 704 |
| 1280px | 1024 | 0 / 0 | 468 + 468, danger 960 |
| 1512px | 1256 (fills column) | 0 / 0 | 584 + 584, danger 1192 |
| 1920px | 1440 (capped) | 112 / 112 symmetric | 676 + 676, danger 1376 |

No horizontal overflow at any width.

**Not verified.** The signed-in shell was not driven in a browser: the development database holds
only a real account, and no demo credentials were seeded for it. The notification bell, sidebar
nav, board canvas and card drawer are therefore covered by types, lint and a production build,
not by a rendering check. Accessibility was not re-run with axe or a screen reader.

The implementation is complete. The public desktop entry page was visually checked after the
redesign and the production build passes. The remaining checkbox is environment-dependent: an
authenticated board walkthrough still needs the local backend/database running.
