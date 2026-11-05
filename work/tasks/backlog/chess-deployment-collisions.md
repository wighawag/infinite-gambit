---
title: 'Deployment collisions: refund on a shared spawn point or a blocked footprint, free cancel, burn an unrevealed deployment'
slug: chess-deployment-collisions
spec: infinite-chess
blockedBy: [chess-moves]
covers: [4, 5, 6]
---

## What to build

Deployments that cannot be placed are resolved order-free, and a deployment that is never revealed costs its stake. This comes after `chess-moves` because a footprint can only be blocked by pieces that move, and the arrival counts it relies on are introduced there.

- If two or more deployments reveal the same spawn point in the same cycle, all of them fail and are refunded in full. This depends only on the count of reveals per spawn point, so it is order-free.
- If a deployment's footprint is not empty on the start-of-cycle board, OR any piece arrives on a footprint square during the deployment cycle, it fails and is refunded in full (otherwise camping a spawn point eats new armies). Arrivals are known from the accumulated arrival counts, so this stays order-free.
- "Refunded" means the stake returns to the ACCOUNT's reserve, which is freely withdrawable and redeemable (`docs/adr/0006-stake-erc20-reserve-exit-only.md`), credited without making the account a member. A failed deployment's spawn point becomes free again.
- **When the refund is written.** A deployment only finally fails at the end of the cycle, and nothing runs on chain then. A public `settleDeployment(army)`, callable by anyone, writes the refund once the cycle has closed; the account's own next deployment or withdrawal calls it automatically. Until then the client shows the refund as pending.
- **Cancelling.** Cancelling a deployment commitment during the commit phase is free: the stake returns to the account reserve and the game stops waiting for that army. Nobody has revealed anything yet, so there is no option to buy. The base's `CommitReveal.cancel` refunds nothing (the bond is only a lock on the reserve, and cancel just clears the commitment), so the hook goes in the game's own `cancelCommitment` route.
- **Dead armies stop being waited for.** Define ONE game-level "dead" predicate for an army that can never act again; this task starts it with a failed or cancelled deployment, and later tasks extend it (captured in `chess-king-capture-merge`, exited in `chess-exits-redeem`, frozen in `chess-freeze`). In the game's `advanceCycle` route, before the base's `_advanceCycle`, and only under `Manual` and `TimedWithEarlyAdvance` (under `Timed` there is no advance transaction and nothing reads the waited-for count, so skip it), walk the game's waited-for armies and call `_stopWaitingFor` on every dead one. That set is bounded by the seats (offline seat count, table seat count). Without this the offline world, which advances only once every waited-for member has committed, stalls for good on a failed deployment.
- **Gas.** The account's next deployment commit settles its pending deployments automatically, so re-measure `commitGas` (it is enforced on every commit).
- A deployment that is committed and never revealed has its locked stake **burned**: a real ERC20 burn that reduces the supply, not tokens left in the contract. `GameToken` has no public burn today (only `mint`; `ERC20Base` has an internal `_burnFrom`), so add `burn(uint256)` (a holder burns its own balance) and call it from the `_forfeit` override for a deployment commitment. The penalty when the missed reveal is settled (by `forfeitMissedReveal` or `acknowledgeMissedReveal`) is the whole stake, so nothing returns to the player. See `docs/adr/0005-missed-reveal-freezes-the-army.md`.
- The client tells the player what happened to a failed or missed deployment and returns them to deployment.

> FORWARD-POINTER (conductor, from what `chess-army-deployment` and `chess-moves` landed; see their `## Decisions` in `work/tasks/done/`):
> - **Two stop-gaps to REPLACE, not extend.** `UsingGameBoard` treats a landed deployment as ONE ARRIVAL on each footprint square in its reveal cycle (so a piece arriving there makes two arrivals and both fail), and a deployment "takes" a square that is occupied when it lands. Both go: a deployment whose footprint is occupied at the start of its cycle, or receives any arrival during it, FAILS as a whole (and the arriving piece then lands on an empty square as normal). `_landedBefore` (spawn record `count == 1`) is what the open set, the registry and `_laidAt` all key on, so "landed" must become "count is one AND the footprint was clear AND nothing arrived on it", and a failed one must free its spawn point and stop laying pieces. Keep the decision a function of closed-cycle facts only, so read order and reveal order cannot change it.
> - **Missed deployment is a debit today** (`_acknowledgeMissedReveal` charges `STAKE`): this task turns it into a real burn. The client's penalty display (`web/src/lib/chess/missed-reveal.ts`, stake capped by the bond) already shows the stake for a deployment; keep it right.
> - **Tables still seat the ACCOUNT** (pass-only) until `chess-tables`; the dead-army sweep must not break that (an account seat is never "dead" by this predicate).

## Acceptance criteria

- [ ] Two deployments revealing the same spawn point in one cycle both fail and both are refunded, whatever order they reveal in (a test replays both orders).
- [ ] A deployment whose footprint is occupied at the start of the cycle, or receives an arriving piece during the cycle, fails and is refunded to the account reserve.
- [ ] A deployment never revealed burns its stake (total supply decreases), whichever settlement path is used; nothing is refunded and no army exists.
- [ ] A failed deployment frees its spawn point again, and its refund is written by `settleDeployment` (by anyone, or automatically on the account's next deployment or withdrawal).
- [ ] A cancelled deployment returns its whole stake to the account reserve and the army is no longer waited for.
- [ ] The offline world keeps advancing after a deployment fails or is cancelled (dead armies are swept in `advanceCycle` under `Manual`).
- [ ] The commit gas figure is re-measured with automatic settling and `GasBudget.test.ts` passes.
- [ ] The client shows the outcome and offers to deploy again.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-moves`

## Prompt

Goal: build the task above ("Deployment collisions: refund on a shared spawn point or a blocked footprint, free cancel, burn an unrevealed deployment"), covering user stories 4, 5, 6 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-deployment-collisions --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-deployment-collisions <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-deployment-collisions.md work/tasks/done/chess-deployment-collisions.md
```
