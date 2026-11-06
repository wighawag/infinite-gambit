---
title: 'Capture loops rotate ownership'
slug: chess-capture-loops
spec: infinite-chess
blockedBy: [chess-king-capture-merge]
covers: [31]
needsAnswers: true
---

## What to build

When kings capture each other in a ring within one cycle (A takes B while B takes A, or longer), the pieces that captured the kings die, every king in the loop survives where it stood, and each owner takes over the army (and stake) it captured. See `docs/adr/0004-capture-loops-rotate-ownership.md`. Loops are detected by following the "captured into" pointers once the cycle is final, so it stays order-free. The capturing pieces die rather than bouncing back so resolution stays lazy.

> FORWARD-POINTER (conductor, from what `chess-king-capture-merge` landed; see its `## Decisions` and `docs/adr/0009-merges-resolve-through-captured-into-pointers.md`):
> - **Loops are where "captured into" pointers come back round.** `UsingGameBoard._armyOf` today stops when the walk returns to its start and treats the army as its own, and `_treeStake` counts a looped army's own reserve only. This task replaces that with the rotation of ADR 0004, still decided only from closed-cycle facts, still order-free for reveals AND for reads/folds (test both).
> - **Re-check the "a king on the board is never of a merged army" assumption.** Reveals resolve the army of the mover and its destination only; path squares and a king's neighbours are read unresolved (`_rawSquareAt`). After a loop, every king survives while its army changes owner, so a king on the board CAN belong to a merged army. Make sure the king-adjacency rule and every legality check still see the right army (resolve where needed, inside the reveal gas budget, `GasBudget.test.ts`).
> - The king-capturing pieces die: put that in both `ChessRules.settle` and `ChessRules.outcome` (one table, two functions), and keep `_isDead`/the registry consistent.

## Acceptance criteria

- [ ] A two-army loop and a three-army loop each rotate ownership and stakes, kill the king-capturing pieces, and leave every king in place.
- [ ] One account owning both armies of a loop gains nothing.
- [ ] Resolving the loop's squares and armies in different read orders gives the same result.
- [ ] The order-independence test covers a loop.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-king-capture-merge`

## Prompt

Goal: build the task above ("Capture loops rotate ownership"), covering user stories 31 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-capture-loops --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-capture-loops <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-capture-loops.md work/tasks/done/chess-capture-loops.md
```
