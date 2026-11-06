---
title: 'Three piece-moves: the greedy bot and the offline world use three, and the words follow'
slug: three-piece-moves-bot-and-words
spec: three-piece-moves
blockedBy: [three-piece-moves-planner]
covers: [10, 12]
---

## What to build

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
