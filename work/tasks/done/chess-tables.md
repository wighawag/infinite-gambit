---
title: 'Tables: closed games with a tighter grid, no exits, and a winner'
slug: chess-tables
spec: infinite-chess
blockedBy: [chess-freeze]
covers: [38, 39, 40, 41, 42]
---

## What to build

The same rules as a closed ONLINE game, on the template's table and lobby (fixed seats via `_openRoster`, a creator who starts it, a closed roster, one clone per table from the factory). Offline play is NOT this: the offline world is the hotseat mode (each seat a human at the device or a machine-played seat) and runs on world rules.

- **At a table the seat IS the army.** Buying into a table credits a NEW ARMY id directly, owned by the buyer and acted for through the template's delegation: the game's `addToReserve` for a roster game turns the purchase (`purchaseAt` passes the owner's address id) into "create an army for this owner". That purchase is the deployment; there is no deployment commit at a table and accounts are not seated. This is what makes the two-reserve model work under a roster: before the start nobody is waited for (so a deployment commit would revert `NotInGame`), and after it `seat` reverts `GameAlreadyStarted`.
- **Spawn points come from a counter that only increases**, not from seat order (the base reorders its members whenever someone leaves): each purchase takes the next spawn point of a tighter grid (spacing about 10, a table parameter), and a leaver just leaves a gap. There are no deployment collisions at a table. Exits are disabled.
- **The armies appear when the table starts, with no start hook.** The lobby's `start()` calls no game code, so the pieces are written at purchase and are INERT and hidden until the roster has started, resolved lazily like everything else. The lobby is not modified.
- **Payout.** The last king standing takes every stake; at a per-table cycle cap, the remaining stakes are split in proportion to remaining material (pawn 1, knight 3, bishop 3, rook 5, queen 9). Each winner claims their share and receives ETH through `redeem`.
- **Early advance.** Unanimity (`TimedWithEarlyAdvance`) brings the next phase forward, with the clock as a backstop, so a table moves as fast as its players act. At a table a pass must be an EMPTY COMMITMENT, because committing nothing never counts as having acted. Captured and frozen armies stop being waited for through the mechanism `chess-freeze` adds in the `advanceCycle` route.
- **Leaving.** Before the table starts, the owner may withdraw their army's whole reserve, which frees the seat (`_leaveSeat`) and removes the inert army. This is the one exception to "an army reserve is never withdrawn directly" (`docs/adr/0006-stake-erc20-reserve-exit-only.md`). Once the table has started, the normal rule applies.
- **No machine-played seats at online tables in v1**: someone's browser would have to run them. Tables are humans only; bots are the offline world's.

> FORWARD-POINTER (conductor, from what landed through `chess-exits-redeem`):
> - **Exits are still ACCEPTED at a table today** (`chess-exits-redeem` decisions): `_exited` must say no under a roster, with a test.
> - **The table seat is still the ACCOUNT** (pass-only), kept since `chess-army-deployment` so the lobby stayed tested; this task replaces that with the army seat as described. `table.e2e.ts` and the client at a table follow.
> - **Payouts go through `StakeSale.redeem`** via the token's minter (`IMintedToken(TOKENS).minter()`), the way `GameExit` pays, to the army's CURRENT owner (`_ownerOf`, ADR 0010), debiting what it pays, claimable once.
> - **Material at the cap**: rocks (army 0) and an exited root's vanished pieces count for nobody.
> - **Reveal gas has no slack**: `REVEAL_GAS` is 1,345,000 against a `GasBudget.test.ts` generosity cap of 1,347,342 (three times the plainest reveal). Anything added to the reveal path will trip that test; re-measure and adjust both honestly, never paper over it.

## Acceptance criteria

- [ ] A table can be created, seated and started; buying a seat creates its army, and each seat gets its own spawn point on the table grid.
- [ ] Exits do nothing on a table.
- [ ] The last king standing receives every stake; at the cycle cap the stakes are split by material.
- [ ] A table advances as soon as every live seat has acted, including after an army has been captured or frozen.
- [ ] A seated player can withdraw their army reserve and leave before the table starts, and cannot once it has.
- [ ] Pieces of a table's armies are inert and hidden until the table starts, and a leaver's gap does not shift anyone else's spawn point.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-freeze`

## Prompt

Goal: build the task above ("Tables: closed games with a tighter grid, no exits, and a winner"), covering user stories 38, 39, 40, 41, 42 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-tables --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-tables <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-tables.md work/tasks/done/chess-tables.md
```

## Decisions

- **`addToReserve` moved to a new `GameTable` route**, which also holds `leaveTable`, `tally`, `claim`, `getTableOutcome` and `getTableShare`. Creating an army at a table did not fit in `GameCommit`, which had 407 bytes left. `addToReserve` now lives in its own interface, `IGameStake`, and `StakeSale` names that type. The combined ABI is unchanged. The new route was added to both deploy scripts and the test helper. The alternative was a self-call from `GameCommit` guarded by `msg.sender == address(this)`, which I rejected as fragile.
- **The table spacing is set per deployment, not per table:** `data.Lobby.spawnSpacing` = 10, since every table is a clone of one implementation. Passing it in `gameOptions` per table would have meant decoding options in every route.
- **How material is found at the cap (ADR 0012, new):** at a table, the first time a reveal touches a 16×16 zone, that zone is added to a list. The world reads the roster only when a never-touched zone is touched, so its reveals never pay for the list. The count walks the untouched footprint squares plus every touched square in the listed zones. I rejected keeping a running count during reveals (it would break the rule that reveal order cannot matter), listing every touched square (too much reveal gas), and scanning a bounding box (no upper bound on cost).
- **Tables declare their own reveal gas**, `LOBBY_REVEAL_GAS` = 1,400,000, because the world's figure had no room for the zone list. This affects the table client's gas budget.
- **A seat costs exactly one stake.** Any other amount reverts with a new error, `WrongStake`, and each purchase creates a new army, so one account may hold several seats.
- **New errors** for the new paths:
  - `NotArmyOwner`: someone other than the owner tries to leave.
  - `TableNotOver`: a claim or tally before the table is over.
  - `NothingToClaim`: an army that is owed nothing.
- **New events:** `TableSeatTaken`, `TableLeft`, `TableSettled`, `TablePaid`.
- **Leaving pays tokens back, not ETH,** like `withdrawFromReserve`; the player can redeem them at the sale. The left army shows as `Cancelled` and its spawn record is cleared.
- **"Hidden" before the start:** a table army reads as `Deploying` (no king shown), and the board read returns nothing until the start. The spawn point stays visible in the registry, since it is fixed by seat order anyway.
- **Who gets a share at the cap:** a frozen king still counts as standing, so a frozen army gets a share by its material, and it also prevents a "last king standing" win. If no standing army has any material left, the standing kings split evenly. Shares round down, so a few wei of dust can stay in the game.
- **When the outcome is fixed:** the first `claim` writes the outcome and collects every reserve into the pot. After an early win the game keeps running, but there is nothing left to win.
- **A missed reveal at a table freezes the army**, exactly as in the world. The creator's `forfeitMember` frees the seat but leaves the army on the board.
- **Client at a table:**
  - The played army is the latest one that has not left the table (`chooseSeat`), even if it was captured or frozen, so the player keeps the table screen.
  - The HUD's exit-payout slot is reused: at a table its button sends `claim` instead of `exit`.
  - Before the first claim the HUD cannot show the amount, only "Collect your share" or "Collect every stake".
- **`CONTEXT.md`:** added "Table seat" and "Material", and the Exit entry now says tables have none. ADR 0006 already described the leave-before-start exception, so it needed no change.
