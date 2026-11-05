---
title: 'Several e2e suites still drive the deleted placement game'
---

Observed 2026-11-05 while building `chess-army-deployment`.

`chess-army-deployment` replaced the template's placement game with chess and ported the two OFFLINE suites that exercise it (`web/e2e/tests/offline.e2e.ts`, `web/e2e/tests/offline-hotseat.e2e.ts`, both green against a build), but the suites that need a local node were not run and still drive cells: `web/e2e/fixtures/game.ts` (clicks cells, reads `view.cells`, presses "Commit now", reads `getStakeOnCell`) and the suites built on it, `game.e2e.ts`, `fuzd.e2e.ts`, `fuzd-fallback.e2e.ts`, `out-of-gas.e2e.ts` and `table.e2e.ts`. They are outside `verify`, so nothing fails today, and they will fail when `scripts/run-e2e-tests.sh` is next run. `table.e2e.ts` cannot pass until `chess-tables` seats armies at a table (a table still seats the buying ACCOUNT, which can only pass).
