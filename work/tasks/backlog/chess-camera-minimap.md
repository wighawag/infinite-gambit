---
title: 'Camera follows my army, and a minimap of the spawn spiral finds the fighting'
slug: chess-camera-minimap
spec: infinite-chess
blockedBy: [chess-collisions]
covers: [44, 45]
needsAnswers: true
---

## What to build

On an infinite board, finding the fight is the UX problem. The camera follows the player's army by default and pans freely (the template's camera and gestures in `$lib/game/render`). A minimap shows the spawn spiral and every army (exit markers are added by `chess-exits-redeem`) (from the contract's army registry view: no indexer, per `docs/adr/0007-rules-live-only-in-the-contract.md`), and clicking it moves the camera. Fetching stays limited to the area in view.

## Acceptance criteria

- [ ] The camera centres on the player's army by default and can be panned away and back.
- [ ] The minimap shows spawn points and armies, and navigates the camera.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-collisions`

## Prompt

Goal: build the task above ("Camera follows my army, and a minimap of the spawn spiral finds the fighting"), covering user stories 44, 45 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-camera-minimap --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-camera-minimap <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-camera-minimap.md work/tasks/done/chess-camera-minimap.md
```
