---
title: 'Three piece-moves: the greedy bot and the offline world use three, and the words follow'
slug: three-piece-moves-bot-and-words
spec: three-piece-moves
blockedBy: [three-piece-moves-planner]
covers: [10, 12]
---

## What to build

> FORWARD-NOTE (conductor, after PRs #30 to #34 merged): the human planner (`web/src/lib/chess/planning.ts`, `context.ts`) now reads the cap with `readMaxPieceMoves` (the game's `getMaxPieceMoves`) and asks the contract through `wholeMoveRoute({call, maxPieceMoves})` from `web/src/lib/chess/piece-moves.ts` (`isLegal` = `isLegalWholeMove`, `alongside` = `legalMovesAlongside`); reuse those for the bot rather than a second path. The bot today is `strategy.ts`, fed `legalMoves` by `web/src/lib/offline.ts` (around line 667): keep `legalMoves` and its signature (other callers use it). The planner also introduced the user-visible word "piece-move" (HUD, help text, refusal sentences), so the CONTEXT.md entry should match how it is used there. `docs/adr/0016` is accepted.

The machine players and the glossary follow `docs/adr/0016`.

- **The greedy bot** (`$lib/chess/strategy.ts`, CONTEXT "Greedy level") picks up to the cap of piece-moves by different pieces, captures first as now, each choice checked through the whole-move simulation route (`three-piece-moves-simulation-route`) with the cap the table-toggle getter reports. No copy of the rules in the client (`docs/adr/0007`).
- **The offline world** plays it: machine seats make up to three piece-moves; the world and boot tests stay green.
- **The attacked-squares overlay** (`$lib/chess/attacked.ts`) stays a view of the start-of-cycle board; say in its comment that it understates when an enemy army moves several pieces (a rook can slide through a square its own piece leaves).
- **Words.** In `CONTEXT.md` ("This game"): Move becomes "up to three piece-moves by different pieces of one army in one cycle, simultaneous; a pass is none (one where the table turns it off)"; add Piece-move ("one chess move by one piece"); check every entry that says "one move" or "one piece" (Army, Freeze, Greedy level, Deployment) and Attacked square (as the overlay, above).

## Acceptance criteria

- [ ] The greedy bot makes up to three piece-moves by different pieces (one at a table with the toggle off), unit-tested on a scene where it captures with one piece and moves others.
- [ ] The offline world tests (`web/test/lib/embedded/world.test.ts`, `web/test/lib/offline-boot.test.ts`, `web/test/lib/offline-players.test.ts`) pass with three piece-moves.
- [ ] The overlay's comment and `CONTEXT.md` (Move, Piece-move, and the entries listed) are updated.
- [ ] All logic in plain `.ts`; the web tests pass.

## Blocked by

- `three-piece-moves-planner` (it serialises the client edits; the bot shares the planner's use of the whole-move route).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md`, `CONTEXT.md` ("This game"), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016` and `0007`, the done records of the earlier `three-piece-moves-*` tasks, then `web/src/lib/chess/strategy.ts`, `attacked.ts`, and the offline world (`web/src/lib/offline*.ts`) with its tests.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **The bot's destinations come only from `legalMovesAlongside`; the bot no longer has a `legalMoves` input.** Why: the forward-note asks for the planner's path rather than a second one, and asking with no other piece-moves gives a piece's plain legal moves anyway. Alternative considered: keep `legalMoves` for the first pick. I read "keep `legalMoves` and its signature" as the contract's route, which still has other callers and is unchanged. This touches `createChessStrategy`'s parameters (now `wholeMove` and `maxPieceMoves`) and its only callers, `offline.ts` and the strategy test.
- **The seats' budget is now `config.actionsPerReveal`; the cap comes from the game.** Why: the budget means what a seat can pay for, which is one reveal transaction carrying 3 actions, and the strategy plays the smaller of that and `getMaxPieceMoves`. Alternative considered: hard-code `MAX_PIECE_MOVES`, which would repeat the game's cap in the seat loop. This touches `offline-players.ts`'s `turnFor`.
- **The bot checks its finished move with `isLegalWholeMove` and drops piece-moves from the end if it is refused.** Why: an illegal move that is committed makes the reveal revert, and the army freezes (`docs/adr/0005`). This costs one more sandbox call per cycle. Alternative considered: trust `legalMovesAlongside` alone.
- **The glossary keeps the TypeScript `Move` type's name and says in the Piece-move entry that a `Move` value is one piece-move.** Why: renaming it is out of scope, and the storage format built on it is a wire. The entry also says the order the piece-moves are listed in changes the commitment but never the outcome, to fit the framework's "Actions are ordered" entry. Alternative considered: rename the type. This touches only `CONTEXT.md`.
