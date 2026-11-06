<!-- dorfl-sidecar: item=task:chess-exits-redeem type=task slug=chess-exits-redeem allAnswered=false -->

## Q1

**'task:chess-exits-redeem' was bounced — how should we proceed?**

> Decision (2a) in the applied answer cannot be built as stated, so the exit-resolution half of chess-exits-redeem needs a new human decision before anything is written. No source change made.
>
> Why (2a) is infeasible: path squares, a king's neighbours and the 20 footprint squares of `_footprintClear` read pieces with `_rawSquareAt`, whose army is the one written on the square: for a non-king piece of a merged-in army V, that is V, not the empire root R that exited. The only link from V to R is the chain of captured-into pointers (`_walk`, about 20k gas per unfolded hop, up to MAX_CHAIN = 8). Every cheaper option I examined breaks a rule:
> - An exited flag checked on the raw army is O(1) and exact only for kings (a king on the board is never of a merged army). That covers king neighbours, but no non-king merged piece.
> - Walking only folded `capturedInto` pointers depends on whether an earlier reveal of the same cycle already touched the square: reveal-order dependent (ADR 0002).
> - Marking victims "gone" while collecting the stake (exit or collect) depends on tx order. A slider move becomes legal or illegal by ordering, so a reveal can revert, which freezes the army (ADR 0005). It also fails the acceptance criterion "exit calls and capture attempts, in either order, give the same board".
> - Leaving merged pieces on the board contradicts story 34.
> (2b), moving the victim's reserve up in `_foldCapture`, and the incremental permissionless collection for depth (3) are both buildable and order-free. They fix the payout, not the board.
>
> Pick one:
> (A) PAY THE WALK: path, footprint and non-king reads resolve the root (bounded by MAX_CHAIN, consistent with the board view). Rough worst case from earlier measurements, not re-measured: a slider move about 1.0M on top of today's about 1.04M, and a deployment reveal about 3.2M for 20 footprint squares × 8 hops. revealGas would go from 1.2M to about 3.6M, unless deployment reveals (being split onto their own route under decision 1) get their own declared gas figure.
> (B) EXIT REQUIRES A COLLECTED EMPIRE (new rule, needs an ADR): a king may exit in cycle c only if a collect that ran before cycle c started has already pointed every army R took (directly or through other captures) straight at R (`capturedInto == R`) and moved their reserves up. Then a raw piece of army X is gone iff exited(X) or exited(X.capturedInto): two O(1) reads, no walk. Costs: the player must collect (permissionlessly) at least one cycle before the exit move. The exit reveal reverts (or the king just lands, if you prefer) when the empire is not collected. A king that takes a king on the exit square cannot exit that cycle.
> (C) NARROW STORY 34: an exit removes the king and the pieces whose square-recorded army is R itself. Pieces of armies R captured stay, as frozen, capturable prey owned by nobody. Cheap and order-free, but a semantic change.
>
> Everything else in the task is unaffected and can be built as written once this is chosen: only StakeSale mints, the sale keeps its ETH, redeem at the fixed price, guarded setMinter and game-to-sale setters, deterministic deploys, test helpers buy through the sale, account reserve withdrawable and army reserve not, exit claimable once by anyone, paying `_ownerOf`, exits disabled at tables (story 40, which also means only the world Game needs the sale link), and the route split. Splitting the task into "money and route split" (buildable now) and "exit resolution" (after A/B/C) would also keep each run under the 16k output limit.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
