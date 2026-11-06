---
title: 'Three piece-moves on the client: plan up to three, see each one, take any back; the bot uses three; the words follow'
slug: three-piece-moves-on-the-client
spec: three-piece-moves
blockedBy: [three-piece-moves-table-toggle]
covers: [1, 5, 8, 10, 12]
---

## What to build

The game shows and plays three piece-moves (`three-piece-moves` spec, `docs/adr/0016`). Legal moves come only from the contract's simulation routes (`docs/adr/0007-rules-live-only-in-the-contract.md`): the client keeps NO copy of the "two to one square / two by one piece / own movers count as gone" rules, it asks the whole-move route `three-piece-moves-in-the-contract` added.

- **The planner** (`$lib/chess/planning.ts` and what the board and HUD read from it) lets a player plan up to the cap the contract reports (3, or 1 at a table that turned it off), shows each planned piece-move on the board, distinguishable from one another, lets the player take any one back, and submits them in ONE commitment. A planned piece-move the contract refuses (with the other planned ones) is refused before commit, with a reason. A piece's legal destinations account for squares the other planned piece-moves vacate.
- **The submission record.** The secret and the moves of a commitment live in the browser's submission storage (`$lib/chess/storage.ts`, `commit-reveal.ts`). Several piece-moves per commitment may change what is stored. Nothing is deployed yet (check `git ls-files contracts/deployments`), so a shape change costs nothing now, but keep the storage key and every field name stable unless it must change, and say so in the Decisions block (AGENTS.md: the storage key is a wire).
- **The greedy bot** (`$lib/chess/strategy.ts`, CONTEXT "Greedy level") picks up to the cap of piece-moves by different pieces, captures first as now, each choice checked through the whole-move route.
- **The offline world** plays it: machine seats make three piece-moves; the world and boot tests stay green.
- **The attacked-squares overlay** stays a view of the start-of-cycle board.
- **Words.** In `CONTEXT.md` ("This game"): Move becomes "up to three piece-moves by different pieces of one army in one cycle, simultaneous; a pass is none (one where the table turns it off)"; add Piece-move ("one chess move by one piece"); check every entry that says "one move" or "one piece" (Army, Freeze, Greedy level, Deployment). Mark `docs/adr/0016` `status: accepted`.

## Acceptance criteria

- [ ] A player can plan, see and take back up to three piece-moves (one at a table with the toggle off) and commit them in one commitment; tested in `web/test` at the store/module level.
- [ ] A whole move the contract refuses is refused before commit; the client holds no copy of those rules (its legality comes from the simulation routes).
- [ ] The greedy bot makes up to three piece-moves by different pieces, unit-tested on a scene where it captures with one piece and moves others.
- [ ] The offline world tests (`web/test/lib/embedded/world.test.ts`, `web/test/lib/offline-boot.test.ts`, `web/test/lib/offline-players.test.ts`) pass with three piece-moves.
- [ ] `CONTEXT.md` has Move and Piece-move as above; ADR-0016 is `status: accepted`.
- [ ] All logic in plain `.ts`; components only render (AGENTS.md "Svelte conventions").

## Blocked by

- `three-piece-moves-table-toggle` (the cap the client reads, and the whole-move route as the contract tasks left it).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary, the storage-key-is-a-wire rule), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016` and `0007`, the done records of the three earlier `three-piece-moves-*` tasks, then `web/src/lib/chess/` (`planning.ts`, `view.ts`, `display-plan.ts`, `preview.ts`, `strategy.ts`, `commit-reveal.ts`, `storage.ts`, `attacked.ts`, `render/`, `ui/hud.ts`) and the offline world (`web/src/lib/offline*.ts`).

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
