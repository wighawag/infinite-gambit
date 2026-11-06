---
title: 'Three piece-moves on the client: plan up to three, see each one on the board, take any back, commit them together'
slug: three-piece-moves-planner
spec: three-piece-moves
blockedBy: [three-piece-moves-table-toggle]
covers: [1, 5, 8]
---

## What to build

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
