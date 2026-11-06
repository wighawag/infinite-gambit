---
title: 'A missed reveal freezes the army; the revealer and a deadline warning protect the player'
slug: chess-freeze
spec: infinite-chess
blockedBy: [chess-exits-redeem]
covers: [14, 15, 36, 37]
---

## What to build

`_forfeit` is overridden: a missed reveal freezes the army forever. It never moves again, its king cannot exit, and it can still be captured (its pieces come back to life under the captor). See `docs/adr/0005-missed-reveal-freezes-the-army.md`. The deployment path's burn (from `chess-deployment-collisions`) lives in the same override and must keep working.

**Extend the "dead" predicate with frozen armies.** The `advanceCycle` sweep (from `chess-deployment-collisions`, run only under `Manual` and `TimedWithEarlyAdvance`) then stops waiting for them. In practice this matters at TABLES (early advance): under `Manual` (the offline world) a missed reveal cannot happen, because the base refuses to close a reveal phase while anyone who committed has not revealed; under `Timed` (the online world) nothing reads the waited-for count.

**Frozen is a definition, not just a flag.** The base only runs `_forfeit` when somebody settles the missed reveal (`forfeitMissedReveal` or `acknowledgeMissedReveal`); until then the base merely refuses the next commit. So an army counts as frozen when its frozen flag is set OR it holds an unrevealed commitment from a past cycle. Expose that as one view and use it everywhere (move refusal, exit refusal, the HUD, the waited-for set).

Client: the template's local revealer sends the player's reveal automatically; the client warns loudly as the reveal deadline approaches with the reveal not landed (including when the revealer is short of gas); frozen and idle armies stay on the board with their stakes.

> FORWARD-POINTER (conductor, from what landed through `chess-exits-redeem`; see the `## Decisions` in `work/tasks/done/` and ADRs 0009-0011):
> - **Extend the ONE `_isDead` predicate** (failed / cancelled / unrevealed deployment, captured, exited) with frozen; the `advanceCycle` sweep and `_effectiveAttendance` already use it, and a dead army's commit reverts `NotInGame`.
> - **`_forfeit` already has the deployment burn** (an army with `spawnIndexPlusOne == 0 && !cancelled`): keep it exactly, and add the freeze for every other army.
> - **A frozen king must not exit.** `_exited` (in `UsingGameBoard`) decides an exit from a king that arrived alone on an exit square. A frozen army cannot reveal a move, but check that no path (a reveal landing before the freeze is known, a settled-later missed reveal) lets a frozen army exit, and test it.
> - **Captured frozen armies**: their pieces come back to life under the captor through the existing merge pointers; a frozen army's pieces are NOT rocks (a rock is army 0: an exited root's merged pieces, or more than MAX_CHAIN captures deep).
> - The contract has moved entry points between routes for size before (`GameReveal` to `GameCommit`, a new `GameDeploymentReveal`, `GameExit`, `GameRegistry`): `RouteSizes.test.ts` must stay green.
> - **Reveal gas has no slack**: `REVEAL_GAS` is 1,345,000 against a `GasBudget.test.ts` generosity cap of 1,347,342 (three times the plainest reveal). Anything added to the reveal path will trip that test; re-measure and adjust both honestly, never paper over it.

## Acceptance criteria

- [ ] A missed reveal freezes the army: further commitments are refused, its king cannot exit, and it can be captured as usual, its pieces joining the captor.
- [ ] The army counts as frozen from the moment its reveal window closes, before anyone settles the missed reveal.
- [ ] A frozen army stops being waited for at the next `advanceCycle` under `TimedWithEarlyAdvance`, so a table can advance early again after an army freezes.
- [ ] A never-revealed deployment still burns its stake after this override lands.
- [ ] The reveal is sent by the local revealer without the player acting.
- [ ] The client warns before the reveal deadline when the reveal has not landed.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-exits-redeem`

## Prompt

Goal: build the task above ("A missed reveal freezes the army; the revealer and a deadline warning protect the player"), covering user stories 14, 15, 36, 37 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-freeze --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-freeze <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-freeze.md work/tasks/done/chess-freeze.md
```

## Decisions

- **A freeze takes nothing from the reserve on either settlement path**, even when `forfeitMissedReveal` hands `_forfeit` a bond. This keeps story 37's "stakes stay on the board as prey". The alternative was the base's default, which takes the bond out of the reserve and leaves it in the contract; that would shrink the prey. Moves bond zero today, so this only matters if a client bonds more. It touches only `_forfeit`.
- **Frozen requires a revealed deployment** (`spawnIndexPlusOne != 0`), so `isFrozen` is false for an unrevealed deployment, which stays `Unrevealed` and is burned. This follows ADR 0005 ("no army to freeze yet").
- **New `ArmyStatus.Frozen = 8`, appended**, so existing numbers keep their meaning. A frozen army that is then captured reads `Captured`, because the capture check comes first. I also added an `ArmyFrozen(army)` event on settlement, the counterpart of `StakeBurned`.
- **No explicit frozen-exit guard in `_exited` or `exit()`:** freeze and exit cannot both happen (see the argument above). A check in `_exited` would add a cold storage read per square read on the reveal path, which has no gas slack. The argument is written next to `_isFrozen` and tested.
- **The client stops playing a frozen army** (`isLive` is false for `Frozen`). The player is sent back to deployment and `lastDeployment` explains what happened. The alternative was to keep showing the frozen army as the active one. This is user-visible and touches `chooseArmy`, `needsDeployment` and the HUD.
- **Deadline warning threshold:** it fires in the last half of a timed reveal phase (`REVEAL_DEADLINE_WARNING_SHARE = 0.5`), or immediately on a failed reveal. The half matches the existing fuzd fallback, where this browser takes over a scheduled reveal at half the phase. "Not landed" means the submission still owes the reveal (committed, revealing, or failed) and fuzd does not report it confirmed, so a quiet revealer or a key with no gas warns the same way. There is no warning without a clock. The alternative was a fixed number of seconds, which would not scale between a 30-second phase and a one-hour one.
- **Committing an illegal move now freezes the army,** because it can never be revealed. This follows from ADR 0005, and the client already only offers legal moves through the simulation route.
