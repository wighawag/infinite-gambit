---
title: 'Three piece-moves, the simulation route: the contract judges a whole move, so the client never copies the rules'
slug: three-piece-moves-simulation-route
spec: three-piece-moves
blockedBy: [three-piece-moves-in-the-contract]
covers: [5]
---

## What to build

`GameSimulation.legalMoves(board, from)` answers for one piece. Add, NEXT TO IT (keep its signature: `planning.ts`, `strategy.ts`, `attacked.ts`, `context.ts` and `offline.ts` call it), a route that judges a WHOLE move of up to three piece-moves on exactly the reveal's rules from `three-piece-moves-in-the-contract`: the cap, the refusals (two to one square, two by one piece), and "own movers count as gone". It also answers, for one piece, its legal destinations given the squares the move's other piece-moves vacate, so a planner can offer them. Rules live only in the contract (`docs/adr/0007-rules-live-only-in-the-contract.md`).

**The route reads no storage**, as `GameSimulation` today, which is what lets the client's sandbox run it, also at a table (the sandbox runs the lobby implementation's route, `web/src/lib/chess/table.ts`, with no per-table state). So the move's CAP is a PARAMETER of the route (3, or 1), not read from `gameOptions`: `three-piece-moves-table-toggle` adds the getter the client reads it from. Share the rule code with the reveal rather than duplicating it, so the two cannot drift.

Add the route to the client's ABI decoding only (`$lib/chess` wherever the simulation ABI is declared); no client behaviour changes here.

## Acceptance criteria

- [ ] The new route accepts exactly the whole moves the reveal accepts, at cap 3 and at cap 1: a property test in the style of `Moves.test.ts`'s "reveals exactly the moves the simulation route calls legal", over whole moves (including swaps, moves onto own-vacated squares, and every refusal).
- [ ] Its per-piece answer, given vacated squares, matches what the reveal would allow.
- [ ] `legalMoves` and its signature are unchanged; the web tests pass.
- [ ] `RouteSizes.test.ts` and `DeterministicDeploys.test.ts` stay green.

## Blocked by

- `three-piece-moves-in-the-contract` (the rule this route answers for).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md`, `docs/adr/0007` and `0016`, the done record `work/tasks/done/three-piece-moves-in-the-contract.md`, `contracts/src/game/routes/GameSimulation.sol` with `IGame.sol`, `ChessRules.sol`, `contracts/test/js/Simulation.test.ts`, `contracts/test/js/RouteSizes.test.ts`, and `web/src/lib/chess/table.ts` (how the sandbox runs the route at a table).

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
