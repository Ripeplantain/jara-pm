# Kobi UI redesign todo

Direction: combine Linear's focused, keyboard-first work surface with Notion's calm, flexible
workspace canvas. This work is visual and interaction-focused; it does not change backend
contracts or product permissions.

## Foundation

- [x] Move workspace context into the sidebar and make the signed-in shell quieter and denser.
- [x] Establish a neutral, low-shadow visual language with one accent colour.
- [x] Add clearer navigation icons and collapsed-sidebar behavior.
- [ ] Add a reusable command-palette action model beyond card search.

## Workspace home

- [ ] Replace the large greeting hero with a compact command-center layout.
- [ ] Group favourite, recent, and all boards with clearer board metadata.
- [ ] Refine recent activity and empty states.

## Board experience

- [ ] Redesign the board toolbar around title, view controls, filters, sprint, and actions.
- [ ] Tighten column and card density while preserving keyboard and drag-and-drop behavior.
- [ ] Add clearer board-level view states and responsive mobile navigation.

## Card and assistant experience

- [ ] Restyle the card drawer as a document-like detail panel with property rows.
- [ ] Make comments and activity easier to scan.
- [ ] Move Ask Kobi toward a contextual assistant panel and command entry point.

## Product-wide polish

- [ ] Apply the new visual system to My Work, Activity, Insights, Members, and Settings.
- [ ] Review loading, empty, error, focus, reduced-motion, and dark-mode states.
- [ ] Manually smoke-test desktop, tablet, and narrow-screen flows.
- [ ] Run `./scripts/verify.sh` before closing the redesign workstream.
