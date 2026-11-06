---
title: "`offline-ai.e2e.ts` still drives the placement game, and fails"
---

Observed 2026-11-06 while building `offline-world-chain-in-a-worker`.

`web/e2e/tests/offline-ai.e2e.ts` fails at `greedySeatsDecided` (expected 2 stored turns, received 0) with the world's node on the main thread as well as in a Worker, so it predates that task. It still reads the template's placement game (`getCell`, cells as stored turns, "Your placements are on the board"), the same gap `e2e-suites-still-drive-the-placement-game.md` records for the other suites, which does not list this one. `offline.e2e.ts`, `offline-hotseat.e2e.ts` and `offline-one-tab.e2e.ts` pass.
