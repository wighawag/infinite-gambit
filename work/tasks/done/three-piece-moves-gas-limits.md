---
title: 'Three piece-moves, cost: profile a three-piece-move reveal and declare gas limits on its worst case'
slug: three-piece-moves-gas-limits
spec: three-piece-moves
blockedBy: [three-piece-moves-simulation-route]
covers: [11]
---

## What to build

> FORWARD-NOTE (conductor, after PR #30 and PR #31 merged): the reveal now runs `ChessRules.vacatedBy` (cap and refusals) and `ChessRules.vacate` (the legality-only mask, a no-op for fewer than two piece-moves), so the mask's cost only shows in multi-piece reveals: measure those. Routers are now the VENDORED `contracts/src/vendor/router/Router10X60.sol` (fixed past 48 selectors), compiled optimised through a per-file override in `contracts/hardhat.config.ts` so its fallback costs what the package's did; keep that in mind if the profile moves. The figures before this task: `COMMIT_GAS` 410,000, `REVEAL_GAS` 770,000, `LOBBY_REVEAL_GAS` 840,000. The unoptimised `Reveal` route is 24,544 of 24,576 bytes (32 left): this task should add tests and figures, not reveal code. `three-piece-moves-table-toggle` adds a `gameOptions` read to every reveal next, so leave the window some room if you can and say how much in the Decisions block.

Price the reveal on what a three-piece-move reveal really costs, measured, not estimated (`three-piece-moves` spec).

- **Profile it.** Add three-piece-move scenes to `contracts/test/js/GasProfile.test.ts` (three plain piece-moves, fresh and touched, a mix of pawn, slider and king) and update `docs/gas.md` with the new breakdown on the test and production builds, as `lean-rules-one-slot-square-record-and-tight-gas-limits` did.
- **The worst case.** Extend `GasBudget.test.ts`'s worst reveal to three piece-moves, each as dear as the rules allow (captures, two-victim squares, the vanish check, candidate notes), for the world and for a table (a table's reveal can list up to 6 zones on first touch, not 2: price that).
- **The window.** `GENEROSITY_CEILING` stays 3. BOTH generosity checks move to a plain three-piece-move baseline: the world's (today compared against the first case's single-move `revealUsed`) and the table's (`plainest`). Declare `REVEAL_GAS` and `LOBBY_REVEAL_GAS` (and `COMMIT_GAS` if its window moves) in `contracts/rocketh/config.ts` as the measured worst plus `MINIMUM_HEADROOM_PERCENT`, rounded up to the next 10,000. **If three times the plain baseline is still below the worst plus the headroom, STOP and route this task to needs-attention with the numbers. Do NOT raise `GENEROSITY_CEILING`.** (Estimated, this may be close: worst about 2.1M, three plain about 2.1M to 2.4M.)
- **What players see.** Rewrite the comments above the figures: `creditsGasMultiplier` is `COMMIT_GAS + REVEAL_GAS`, so the credits a player is shown drop (by about 2x estimated) for everyone, at tables with the toggle off too; the fuzd prepayment rises with `revealGas`. Re-justify `EXPECTED_ACTIONS_PER_TURN` (it stays 1: a move is still one commit and one reveal) instead of "one move, because it is the rule".

## Acceptance criteria

- [ ] `docs/gas.md` shows the three-piece-move reveal (plain, test and production builds) with what each part costs.
- [ ] `GasBudget.test.ts` measures the worst three-piece-move reveal for the world and a table, both generosity checks use a plain three-piece-move baseline, `GENEROSITY_CEILING` is still 3, and it passes.
- [ ] `REVEAL_GAS`, `LOBBY_REVEAL_GAS` (and `COMMIT_GAS` if needed) are the measured worst plus the minimum headroom; the Decisions block says what each was, is, and which case sets it.
- [ ] The comments above the figures and `EXPECTED_ACTIONS_PER_TURN` describe the new cost to players honestly.
- [ ] `RouteSizes.test.ts`, `DeterministicDeploys.test.ts`, `GasProfile.test.ts` and the web tests stay green.

## Blocked by

- `three-piece-moves-simulation-route` (the contract edits are serialised; the three-piece-move reveal exists since `three-piece-moves-in-the-contract`).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016`, `docs/gas.md`, `contracts/test/js/GasProfile.test.ts` with `utils/gas-profile.ts`, `contracts/test/js/GasBudget.test.ts`, `contracts/rocketh/config.ts`, and the done records of `lean-rules-one-slot-square-record-and-tight-gas-limits`, `lean-rules-stone-on-the-two-victim-square` and `three-piece-moves-in-the-contract`.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **Gas figures** (each is the measured worst plus 10%, rounded up to the next 10,000):
  - `REVEAL_GAS`: 770,000 → **2,020,000**. Set by the world's worst three-piece-move reveal, 1,831,734. It is an upper bound built from measured parts: the plain three-piece move (676,044), plus 3 × (2 folds at 67,615 + 3 notes at 45,200), plus 22 vanish checks at 15,600.
  - `LOBBY_REVEAL_GAS`: 840,000 → **2,090,000**. Set by the table's worst, 1,899,305, which is the world's worst plus six zone listings (67,571). The table's ceiling is 3 × 743,615 = 2,230,845.
  - `COMMIT_GAS`: **410,000, unchanged**. A commit stores one hash whatever the move holds; the worst commit is 370,098.
  - These figures touch every client's gas limit, `creditsGasMultiplier` (1,180,000 → 2,430,000, so players see about half the credits), the stipend and the fuzd prepayment.
- **Room left for `three-piece-moves-table-toggle`**: the world's figure is 5,093 above what it must cover and 8,132 below the ceiling. Gas added to every reveal, like a `gameOptions` read, widens the window, because the ceiling grows three times as fast as the worst. About 4,600 added to the worst alone closes it, because the rounded figure would become 2,030,000. The table's window is wide (2,090,000 against a ceiling of 2,230,845).
- **The world baseline is the dearest plain move, not a cheap one.** I chose king + two stale 7-square sliders, which is also the move the worst is built on. The alternative was a cheaper pawn/slider/king move like the profile's; with that baseline the window would not close. "Plain" here means meeting nothing, as the old single-move baseline did.
- **The first case no longer measures single king and slider reveals.** The king's first step now happens inside the three-piece move, so its army record write from zero is included in the baseline. Only the budget test is affected: single moves are still profiled in `GasProfile.test.ts` and `docs/gas.md`.
- **Six zones are priced by arithmetic, not played.** With zones 16 wide and slides limited to 7 squares, a single move can actually touch at most four zones. So six = the measured four-zone listing + the measured cost of zones three and four again + one more fresh list slot. This is a conservative bound, as the task asked ("price 6"), and it affects only the table figure.
- **The worst-case bound stays conservative.** It does not dedupe squares shared through the per-reveal cache, and it counts every candidate note as a fresh list. I kept the existing formula's style rather than tightening it, so the comparison with the previous task's estimate still holds; the cost is a narrow world window.
