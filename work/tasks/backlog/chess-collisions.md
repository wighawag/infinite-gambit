---
title: 'Simultaneous resolution: swerving, swaps, collisions and captures of non-king pieces'
slug: chess-collisions
spec: infinite-chess
blockedBy: [chess-deployment-collisions]
covers: [13, 22, 23, 24, 25]
needsAnswers: false
---

## What to build

Moves that interact in one cycle resolve order-free, from the accumulated counts alone (`docs/adr/0002-order-free-lazy-resolution.md`, `docs/adr/0003-collision-table-king-survives-a-crowd.md`). The non-king rows of the collision table:

| On the square | Arrivals | Outcome |
|---|---|---|
| empty | 1 piece | it lands |
| empty | 2+ pieces, no king | all die |
| a piece that stayed | 1 piece | captured |
| a piece that stayed | 2+ pieces | all arrivals die, the piece that stayed survives |

A piece that moved away is never captured on its old square (the attacker lands there: "swerving"). Swaps and crossing paths both complete. Two pieces of the same army cannot collide (one move per army); armies of the same account are different armies. King cases are the next task; until then, keep king squares behaving like any other piece so nothing is corrupted.

The client shows what happened in the cycle (pieces that died, captures).

> FORWARD-POINTER (conductor, from what `chess-moves` landed; see its `## Decisions` in `work/tasks/done/chess-moves.md`): **the contract half of this table already exists.** `chess-moves` made `ChessRules.settle` resolve a square from (standing piece, departed, arrival count, lone arriver): a lone arrival takes the square whatever stood there, two or more all fail, and the piece that stayed survives a crowd. So this task is mostly to VERIFY that against every row, swerving, a swap and a crossing path with contract tests, fix whatever a test shows to be wrong, add the order-independence replay, and build the client's "what happened this cycle" display. Do not rewrite the resolution. King squares still behave like any other square here; the king rows are `chess-king-capture-merge`'s. `chess-deployment-collisions` made a deployment's footprint fail on any arrival, so a move onto a deploying footprint is not a collision case for this task.

## Acceptance criteria

- [ ] Each row above, swerving, a swap and a crossing path each have a contract test.
- [ ] An order-independence test replays the same revealed commitments in at least two orders (forward and reverse) and asserts an identical board.
- [ ] The client shows the cycle's captures and collisions after the reveal.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-deployment-collisions`

## Prompt

Goal: build the task above ("Simultaneous resolution: swerving, swaps, collisions and captures of non-king pieces"), covering user stories 13, 22, 23, 24, 25 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-collisions --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-collisions <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-collisions.md work/tasks/done/chess-collisions.md
```

## Applied answers 2026-11-05

### q1: 'task:chess-collisions' was bounced — how should we proceed?

keep. The gate failed on an infrastructure race, not on the work: `pnpm install` runs the root `prepare` (scripts/ensure-deployments.mjs, which runs `hardhat run` and so compiles) concurrently with `contracts prepare` (`hardhat compile`), and the two compiles raced on contracts/cache/build-info (ENOENT on rename). The committed work on work/task-chess-collisions is complete: do not redo it. Check it is still green and finish.
