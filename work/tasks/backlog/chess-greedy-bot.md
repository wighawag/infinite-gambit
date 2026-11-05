---
title: 'Played seats: a greedy bot that captures the most valuable piece it can reach'
slug: chess-greedy-bot
spec: infinite-chess
blockedBy: [chess-freeze]
covers: [43]
---

## What to build

Machine-played seats in the offline world (the hotseat mode, where each seat is a human or the machine; online tables have no machine seats in v1) play chess. A machine seat whose army is gone (captured, exited, failed deployment) redeploys at an open spawn point. Each cycle it plays: each cycle, capture the most valuable piece reachable (king highest, then queen 9, rook 5, bishop 3, knight 3, pawn 1), otherwise make a random legal move. Scoring and legality come from the contract's own rule through the simulation route (`docs/adr/0007-rules-live-only-in-the-contract.md`). The framework's strategy seam is `$lib/game/core/strategy.ts`; the deleted reference game's `placement/strategy.ts` (in git history) shows how a `greedy` level scored moves from the bytecode. Bot logic lives in plain `.ts`.

## Acceptance criteria

- [ ] A played seat captures the most valuable reachable piece when one exists, and otherwise makes a legal move.
- [ ] A played seat whose army is gone redeploys, so the offline world always has its machine opponents.
- [ ] The bot uses the simulation route, not a TypeScript copy of the rules.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-freeze`

## Prompt

Goal: build the task above ("Played seats: a greedy bot that captures the most valuable piece it can reach"), covering user stories 43 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-greedy-bot --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-greedy-bot <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-greedy-bot.md work/tasks/done/chess-greedy-bot.md
```
