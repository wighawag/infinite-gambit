---
title: 'Run the chess e2e suites on the lean-rules board and fix what they find'
slug: chess-e2e-on-the-lean-rules-board
spec: lean-rules
blockedBy: []
humanOnly: true
covers: [16, 17, 18, 24]
---

## What to build

No e2e suite has run since the lean-rules tasks changed the board (the 5 by 5 army, spacing 9, 2 by 2 exits, stones, no rocks): `verify` does not run them, and the build sandbox cannot (`web/package.json` `test:e2e` runs `scripts/run-e2e-tests.sh`, which makes a git worktree and tests the committed HEAD). `lean-rules-square-army-on-a-9-grid`'s report says it did not run them.

- Run the chess e2e suites (`web/e2e/tests`: `offline`, `offline-hotseat`, and any other that draws the chess board) on current `main`, and fix what fails because of the lean-rules board.
- The suites that still drive the template's placement game (`game`, `table`, `offline-ai.e2e.ts`) are `work/notes/observations/e2e-suites-still-drive-the-placement-game.md` and `offline-ai-e2e-still-drives-the-placement-game.md`. They are out of scope here unless they turn out trivial: say which.

`humanOnly` because it has to run where `run-e2e-tests.sh` can make its worktree and start its servers, which a dorfl build sandbox cannot. A human drives it by name (`dorfl do task:chess-e2e-on-the-lean-rules-board`), or runs the suites by hand.

## Acceptance criteria

- [ ] Every chess e2e suite passes on the lean-rules board, and the run is recorded (command, date, result) in the done record.
- [ ] Anything fixed is a test or client change: the rules stay as `main` has them.
- [ ] The placement-game suites are left alone (or fixed if trivial), and the done record says which.

## Blocked by

- None: can start immediately.
