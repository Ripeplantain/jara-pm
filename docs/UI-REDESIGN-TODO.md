# Kobi UI redesign todo

Direction: combine Linear's focused, keyboard-first work surface with Notion's calm, flexible
workspace canvas. This work is visual and interaction-focused; it does not change backend
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

The implementation is complete. The remaining checkbox is an environment-dependent manual check;
the local Next.js preview was verified on the public sign-in surface, but no backend/database was
running for an authenticated board walkthrough.
