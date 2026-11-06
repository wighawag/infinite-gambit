---
title: 'Three piece-moves, tables: a table creator can play one piece-move instead, through one bit of gameOptions'
slug: three-piece-moves-table-toggle
spec: three-piece-moves
blockedBy: [three-piece-moves-gas-limits]
covers: [9]
---

## What to build

The per-table toggle of `docs/adr/0016`, end to end: contract, table creation screen, tests.

- **One bit of the framework's `gameOptions`, and a SET bit means OFF.** The worlds never open a roster, so they read zero and keep three piece-moves; a table created with no options (`NO_GAME_OPTIONS` in `web/src/lib/game/lobby/table.ts`) plays three as well; a creator who sets the bit plays one piece-move per cycle, today's game. Pin the bit's position as a named constant in the contract and in the client. The game refuses a table whose `gameOptions` has any other bit set (the factory checks nothing of it, by design: `CommitRevealGameFactory.createGame`).
- **The cap reads the toggle.** The per-move check from `three-piece-moves-in-the-contract` caps a move at 1 where the bit is set, and the whole-move simulation route answers the same, so the client can take its cap from the contract (expose it in the getters the client reads, for example next to `actionsPerReveal`). `actionsPerReveal` stays 3: it is shared by every table clone and only caps a chunk.
- **Cost.** Reading `gameOptions` happens on every reveal of a world and a table: say what it costs (`docs/gas.md`), and keep the declared figures inside `GasBudget.test.ts`'s window.
- **The table creation screen** (`web/src/routes/lobby/+page.svelte` with its logic in a plain `.ts` module) offers the choice, default three piece-moves, and the table's details show which one it plays.

## Acceptance criteria

- [ ] A table created with the bit set accepts one piece-move per reveal and refuses two; a table created without it, and both worlds, accept three (tested in the contract).
- [ ] A table whose `gameOptions` carries any other bit is refused (tested).
- [ ] The client reads the cap from the contract and the creation screen sets the bit; logic in plain `.ts`, components only render (AGENTS.md "Svelte conventions"); tested in `web/test`.
- [ ] `GasBudget.test.ts`, `RouteSizes.test.ts`, `DeterministicDeploys.test.ts` and the web tests stay green.

## Blocked by

- `three-piece-moves-gas-limits` (the toggle's read is priced on the measured three-piece-move reveal; and it serialises the contract edits).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016`, `contracts/src/commit-reveal/CommitRevealGameFactory.sol`, `CommitRevealLobby.sol`, `UsingCommitReveal.sol` (`_gameOptions`), `CommitReveal.sol` (`gameOptions`, `openRoster`), the game's per-move check and simulation route as `three-piece-moves-in-the-contract` left them, `web/src/lib/game/lobby/table.ts`, `web/src/routes/lobby/+page.svelte`, and `work/tasks/done/chess-tables.md`. `contracts/src/commit-reveal/` is the framework: read its seams, prefer not to edit it.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
