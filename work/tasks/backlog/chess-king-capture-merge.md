---
title: 'King capture: the stake moves to the captor and the army merges into it'
slug: chess-king-capture-merge
spec: infinite-chess
blockedBy: [chess-collisions]
covers: [26, 27, 28, 29, 30]
needsAnswers: false
---

## What to build

Capturing a king is how the game is won (checkmate means nothing). See `docs/adr/0001-one-move-per-army-merge-on-capture.md` and `docs/adr/0003-collision-table-king-survives-a-crowd.md` (the full table).

- A king captured by exactly one arriving piece: its stake (the army reserve) moves to the captor army, and its pieces join the captor's army, which still makes one move per cycle. Pawns keep their direction.
- The king rows of the collision table, which take priority over the others:
  - empty square, a moving king + exactly 1 enemy piece: both die, the king's army merges into that enemy's army;
  - empty square, a moving king + 2+ enemy pieces: the king survives and lands, they die;
  - a piece stayed, a moving king + exactly 1 enemy piece: the king and that piece die, the king's army merges into that enemy's army, the piece that stayed survives;
  - a piece stayed, a moving king + 2+ enemy pieces: the king survives and captures the piece that stayed, the other arrivals die;
  - a king that stayed and is reached by two or more pieces survives (as any piece that stayed).
- **Read order must not matter either.** Lazy resolution means a stake can depend on which squares have been resolved yet (C exits before anyone reads B's king square). Write the per-army facts a capture needs (captured into whom, in which cycle) at reveal time, and resolve an army's ownership and stake through them, so any read order gives the same answer. Bound or compress "captured into" chains so the worst-case reveal stays inside the gas budget.
- Merges are resolved lazily through a "captured into" pointer per army, followed on read. Chains within one cycle (A takes B while C takes A) end with the last captor owning everything. Capture LOOPS (A takes B while B takes A) are the next task; until then they must not corrupt state.
- **Extend the "dead" predicate** (from `chess-deployment-collisions`) with captured armies, so the `advanceCycle` sweep stops waiting for them and the offline world keeps advancing after a capture.
- The client shows the merge (the captured army changes colour/owner) and the captor's new stake.

> FORWARD-POINTER (conductor, from what landed before this task; see the `## Decisions` of `chess-moves`, `chess-deployment-collisions` and `chess-collisions` in `work/tasks/done/`):
> - **`ChessRules.settle` and `ChessRules.outcome` are one table in two functions** (`outcome` feeds the `getOutcomes` view and the client's "what happened" display). Add the king rows to BOTH, with tests on both.
> - **The registry's king is "where the army's last king move took it"** (`_kingAt`, from `kingFrom`/`kingTo`/`kingMovedIn` on the army record, written only by the army's own reveals). That now has to become the resolved truth: a king that died in a collision or was captured is no longer there, and the owner/stake of a merged army follow the "captured into" pointer.
> - **Extend the ONE `_isDead` predicate** in `UsingGameInternal.sol` (today: failed / cancelled / unrevealed deployment); `getAttendance` subtracts dead armies via `_effectiveAttendance`, and a dead army's commit reverts `NotInGame`. A captured army must stop being waited for AND be unable to commit; the captor keeps one move per cycle.
> - **Stake moves are reserve moves** (`CommitReveal.debit`/`_addToReserve` between army ids): never let a captured army's reserve be withdrawable, and never credit an account id.

## Acceptance criteria

- [ ] A lone capture of a king moves its stake to the captor king and its pieces to the captor army.
- [ ] Both king rows of the collision table have a contract test.
- [ ] A chain (A takes B, C takes A) in one cycle ends with C owning the pieces of A and B, with both captured stakes added to C's king.
- [ ] A merged army still makes at most one move per cycle.
- [ ] A test reads and resolves the affected squares and armies in different orders and gets the same board, ownership and stakes.
- [ ] The worst-case reveal with a long capture chain fits the reveal gas budget.
- [ ] The order-independence test covers king captures and chains.
- [ ] The army registry view returns each army's resolved owner and stake after captures and chains.
- [ ] The offline world keeps advancing after an army is captured.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-collisions`

## Prompt

Goal: build the task above ("King capture: the stake moves to the captor and the army merges into it"), covering user stories 26, 27, 28, 29, 30 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-king-capture-merge --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-king-capture-merge <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-king-capture-merge.md work/tasks/done/chess-king-capture-merge.md
```

## Applied answers 2026-11-05

### q1: 'task:chess-king-capture-merge' was bounced — how should we proceed?

keep. Retry the build. The previous attempt died after about 25 minutes of reading with "Response was truncated: the model reached its output token limit": one reply spent all 16,384 output tokens on reasoning before acting (the miro MCP OAuth line is harness noise, ignore it). Nothing was saved. Work in small steps: decide one piece at a time and act on it (write or edit a file, run a test) before planning the next, rather than planning the whole task in one reply. Grow large files with several edits of at most about 300 lines each, and keep the final report short (a summary plus the Decisions block).

## Applied answers 2026-11-06

### q1: 'task:chess-king-capture-merge' was bounced — how should we proceed?

keep. Continue from the saved wip commit on work/task-chess-king-capture-merge (the contract half is under way: ChessRules, UsingGameBoard, a new GameRegistry route). The previous attempt again died on "the model reached its output token limit" (a single reply spending all 16,384 output tokens on reasoning). Keep each reply small: one decision, then act on it (edit, compile, run one test file), then the next. Do not re-plan the whole task in one reply.
