---
title: 'Three piece-moves, tables: a table creator can play one piece-move instead, through one bit of gameOptions'
slug: three-piece-moves-table-toggle
spec: three-piece-moves
blockedBy: [three-piece-moves-gas-limits]
covers: [9]
---

## What to build

The per-table toggle of `docs/adr/0016`, end to end: contract, table creation screen, tests.

- **One bit of the framework's `gameOptions`, and a SET bit means OFF.** The worlds never open a roster, so they read zero and keep three piece-moves; a table created with no options (`NO_GAME_OPTIONS` in `web/src/lib/game/lobby/table.ts`) plays three as well; a creator who sets the bit plays one piece-move per cycle, today's game. Pin the bit's position as a named constant in the contract and in the client.
- **Refuse an unreadable table at the SEAT, never at the reveal.** A table whose `gameOptions` has any other bit set is refused in `_joinTable` (`UsingGameTable.sol`), so nobody can take a seat at it. The reveal must NEVER revert on `gameOptions`: members who already staked would then miss their reveal and freeze (`docs/adr/0005`). The framework's `initializeLobby` and the factory check nothing of the options, by design; leave `contracts/src/commit-reveal/` alone.
- **The cap reads the toggle.** The per-move check from `three-piece-moves-in-the-contract` caps a move at 1 where the bit is set. Add a game-route getter that returns the table's cap (or its `gameOptions`, read with `_gameOptions()`), and the client passes that cap to the whole-move simulation route (`three-piece-moves-simulation-route`), which reads no storage. `actionsPerReveal` stays 3: it is shared by every table clone and only caps a chunk.
- **Cost.** The `gameOptions` read happens on every reveal of a world and a table: say what it costs (`docs/gas.md`), and keep the declared figures inside `GasBudget.test.ts`'s window.
- **The table creation screen** uses the existing options seam: add `options` (`fields`, `encode`, `describe`) to `chessLobby` in `web/src/lib/chess/table.ts` (`TableLobby.options` in `web/src/lib/game/lobby/table.ts`; the lobby page already renders `fields`), a field limited to 0 or 1, default three piece-moves. Show which one a table plays by rendering `lobby.options.describe(table.gameOptions)` in the table list (it exists, nothing calls it yet).

## Acceptance criteria

- [ ] A table created with the bit set accepts one piece-move per reveal and refuses two; a table created without it, and both worlds, accept three (tested in the contract).
- [ ] Buying a seat at a table whose `gameOptions` carries any other bit reverts (tested); no reveal reverts on `gameOptions`.
- [ ] The getter returns the cap; the client reads it and passes it to the whole-move route.
- [ ] The creation screen sets the bit through `chessLobby.options`, and the table list shows `describe`; a web test checks the client's bit constant against the contract's; logic in plain `.ts`, components only render (AGENTS.md "Svelte conventions").
- [ ] `GasBudget.test.ts`, `RouteSizes.test.ts`, `DeterministicDeploys.test.ts` and the web tests stay green.

## Blocked by

- `three-piece-moves-gas-limits` (the toggle's read is priced on the measured three-piece-move reveal; and it serialises the contract edits).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016` and `0005`, `contracts/src/commit-reveal/CommitRevealGameFactory.sol`, `CommitRevealLobby.sol`, `UsingCommitReveal.sol` (`_gameOptions`), `contracts/src/game/internal/UsingGameTable.sol` (`_joinTable`), the per-move check and the simulation route as the earlier `three-piece-moves-*` tasks left them, `web/src/lib/game/lobby/table.ts` (`TableLobby.options`), `web/src/lib/chess/table.ts` (`chessLobby`), `web/src/routes/lobby/+page.svelte`, and `work/tasks/done/chess-tables.md`. `contracts/src/commit-reveal/` is the framework: read its seams, do not edit it.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
