---
title: 'Three piece-moves on the client: plan up to three, see each one on the board, take any back, commit them together'
slug: three-piece-moves-planner
spec: three-piece-moves
blockedBy: [three-piece-moves-table-toggle]
covers: [1, 5, 8]
---

## What to build

> FORWARD-NOTE (conductor, after PRs #30 to #33 merged): the pieces this task wires are already in place and tested, but no screen calls them yet. The cap getter is `getMaxPieceMoves()` on the game (`IGameGetters`, 3 in the worlds, 1 at a table with the bit set); the client helpers are in `web/src/lib/chess/piece-moves.ts`: `readMaxPieceMoves(read)` reads it, and `wholeMoveRoute({call, maxPieceMoves})` gives `isLegal(board, army, moves)` (the contract's `isLegalWholeMove`) and `alongside(board, from, others)` (its `legalMovesAlongside`, a piece's destinations given the other planned piece-moves). Run them in the sandbox the same way `legalMoves` is run today (see how `createPlanning` gets `legalMoves`, and `web/src/lib/offline.ts` around its `legalMoves` call). `maxPieceMovesOf` in that file decodes the bit for the table list only: never use it as the cap. This is one of the two largest tasks: work in small steps and commit after each (`wip: <step>`), so an interrupted build keeps its progress.

A human player plans and commits a three-piece-move move (`three-piece-moves` spec, `docs/adr/0016`). Legal moves come only from the contract's simulation routes (`docs/adr/0007-rules-live-only-in-the-contract.md`): the client keeps NO copy of the "two to one square / two by one piece / own movers count as gone" rules, it asks the whole-move route (`three-piece-moves-simulation-route`), passing the cap the table-toggle getter reports (3, or 1 at a table that turned it off).

- **The planner** (`$lib/chess/planning.ts` and what the board, render and HUD read from it) lets a player plan up to the cap, shows each planned piece-move on the board, distinguishable from one another, lets the player take any one back, and submits them in ONE commitment. A piece's offered destinations account for the squares the other planned piece-moves vacate (the route's per-piece answer). A whole move the route refuses is refused before commit, with a reason.
- **The submission record does not change.** The framework's record already holds a list of actions (`web/src/lib/game/core/commit-reveal/storage.ts`), and `MOVE_STORAGE` (`$lib/chess/storage.ts`) encodes one move at a time. Keep `MOVE_STORAGE`, the storage key and every field name exactly as they are (AGENTS.md: the storage key is a wire).
- The bot, the offline world and the words are `three-piece-moves-bot-and-words`.

## Acceptance criteria

- [ ] A player can plan, see and take back up to three piece-moves (one at a table with the toggle off) and commit them in one commitment; tested in `web/test` at the store/module level.
- [ ] A whole move the contract refuses is refused before commit; the client holds no copy of those rules (its legality comes from the simulation routes).
- [ ] `MOVE_STORAGE`, the storage key and every field are unchanged; a test writes a three-piece-move submission and loads it back.
- [ ] All logic in plain `.ts`; components only render (AGENTS.md "Svelte conventions").
- [ ] The web tests pass.

## Blocked by

- `three-piece-moves-table-toggle` (the cap the client reads; the whole-move route).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary, the storage-key-is-a-wire rule), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016` and `0007`, the done records of the earlier `three-piece-moves-*` tasks, then `web/src/lib/chess/` (`planning.ts`, `view.ts`, `display-plan.ts`, `preview.ts`, `commit-reveal.ts`, `storage.ts`, `render/`, `ui/hud.ts`) and `web/src/lib/game/core/commit-reveal/storage.ts`.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **At a cap of one, a new piece-move replaces the planned one** (the game as it played before), and the route is asked with no other piece-moves. At a cap of three, a full move has to be taken back first: the route offers a fourth piece nothing. The alternative was one rule for both caps, but at cap 1 that would mean taking back before moving another piece, which changes how a one-piece-move table plays today. This touches tables with the toggle bit set.
- **The commit guard refuses when it cannot check** (board not loaded, cap unreadable, sandbox error) and says why. A refused commit costs at most a cycle without moving, while an illegal committed move makes the reveal revert (`IllegalMove`), so the army freezes. The alternative was to let the commit through when unsure. This touches the submission's own commit at the end of the phase: it can now end in an Error state carrying this reason.
- **The guard wraps the adapter's `commit` in chess code** (`refusingIllegalMoves`, enabled by a new optional `refuse` parameter on `createChessCommitReveal`), not the framework's `beforeCommit`, which never sees the actions. Nothing under `$lib/game/core` changed.
- **Refusal reasons are worked out only by asking the route:** a piece-move is named when `legalMovesAlongside` no longer offers its square alongside the others. The words say what to do ("take it back or change it") rather than which rule broke, because the client knows no rule.
- **Renamed view fields:** `LocalPlan.move` became `moves`, `BoardView.plannedMove` became `plannedMoves` (each with its `index`), and `PlanningStore.move` became `pieceMoves`, with `maxPieceMoves`, `refusal` and `takeBack` added. These are client-only in-memory shapes, not persisted. `moveOf` is kept, and a new `pieceMovesOf` is added for moves of several piece-moves.
- **New user-visible words:** the HUD's "n of N piece-moves" line, the refusal sentences, and the updated help text all use "piece-move", the spec's term. Adding it to `CONTEXT.md` is left to `three-piece-moves-bot-and-words`.
