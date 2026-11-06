---
title: 'Lean rules: no merges, promotion to queen, stones, square armies, and a cheap move'
slug: lean-rules
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked; they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The game is expensive to play and harder to read than it needs to be. An ordinary move costs about 373k to 452k gas to reveal (a 7-square slider to a king step; a deployment's reveal is 332k) and about 308k to 380k to commit (380k is the paid first commit that `commitGas` is priced on), and the declared reveal limit, which is what a player's credits are priced on, is 1,345,000 (1,400,000 at tables) because of rare worst cases that come from merging armies: following chains of captured-into pointers (about 665k) and folding capture loops (about 1.2M). Merges also bring rocks, an 8-capture chain limit, ownership rotating around loops, and empires that grow by absorbing armies, all of which a player has to learn.

Play also showed that a lone attacker can chase a king forever: moves are simultaneous and an army moves one piece per cycle, so a queen landing on the king's current square every cycle forces the king to run and nothing else in its army ever moves (`work/notes/ideas/king-chase-table-modes.md`; the fix for that is a later spec, sized on the gas this one frees).

And the board does not look like chess. Armies are 6 by 4, face away from the origin, are spaced 16 apart online (10 to 12 empty squares between them) and 10 at tables, and pawns walk one way, which on a board where an army can be attacked from any side means half of them never matter.

## Solution

- **No merges.** Capturing a king kills its army: every one of its pieces disappears from the board, lazily (the same way an exited army's pieces already do), and its whole stake goes to the army that took it. The piece that took the king is PROMOTED to a queen (a king that takes a king stays a king). Stakes still snowball: whoever takes that captor later gets both stakes.
- **A moving king that meets exactly one other piece dies, and that piece lands as a queen** and takes the king's stake, capturing whatever stood on the square as a lone arrival would. This changes one row of the collision table (ADR-0003), where today both die.
- **Stones.** When a king is taken by a piece whose own army loses its king in the same cycle (taken, or leaving through an exit that cycle), the capturing piece disappears with its army, and the taken king becomes a STONE on its square. A stone holds that army's whole stake, never moves, blocks like any piece, and whoever captures it (a lone arrival, a king included) takes its stake, without promotion. When a moving king lands on a square where a king or a stone stands and exactly one other piece also arrives, that piece takes BOTH: it lands as a queen and both stakes go to its army (each becomes a stone instead if its own king falls that cycle). A stone is stored as a piece of its own kind, still labelled with the army it was (so it is never mistaken for a vanished army's piece), and attacks nothing. A stone is not a king: a king may step next to it. The greedy bot values a stone like a king, above any material, since it carries a whole stake. With one move per army, "leaving through an exit that cycle" can only happen one way: a king that lands alone on an exit square where an enemy king (or a stone) stood takes it and exits in the same move, so what it took stays a stone on the exit square, and a stone on an exit can only be taken by a piece other than a lone king. This replaces capture loops and their rotation of owners, and it bounds a capture to one army per cycle: a stake never moves through more than one capture in a cycle.
- **Pawns step and capture in every direction.** A pawn moves one square orthogonally in any of the four directions and captures on any of the four diagonals. There is no double step and no promotion. Pieces no longer have a facing.
- **A square army.** An army is 5 by 5 without its corners: 12 pawns around a 3 by 3 core with the king in the centre, one core square left EMPTY:

  ```
   .  P  P  P  .
   P  R  N  B  P
   P  Q  K  .  P
   P  B  N  R  P
   .  P  P  P  .
  ```

- **Spawn points 9 apart, everywhere** (the online world, the offline world and tables), so every two armies that are side by side or one above the other have exactly 4 empty squares between them, as in chess.
- **Exits are 2 by 2.** The four squares at the centre of each spawn-grid cell, where four armies meet diagonally, two squares off each army's corner. A king that lands ALONE on any of the four has left the world; two kings landing on different squares of the block both leave.
- **A cheap move.** The square record shrinks from four storage slots to one: a compact army index instead of the three 256-bit army ids is what makes that possible (dropping `forward` and `moved` frees a few more bytes). The declared reveal limit drops to the measured plain worst case plus its headroom, roughly 500k, re-measured by `GasBudget.test.ts`; that estimate must include the vanish check (below) on every square a reveal reads. The table reveal limit (`LOBBY_REVEAL_GAS`) drops with it.

## User Stories

### Capture

1. As a player, when one of my pieces takes an enemy king, I want that piece to become a queen, so that taking a king is rewarded on the board as well as in stake.
2. As a player, when my king takes an enemy king, I want my king to stay a king.
3. As a player, when an enemy king moves onto the same square as exactly one of my pieces, I want that king to die and my piece to land there as a queen with its stake, so that a lone piece standing in a king's way is rewarded like any king capture.
4. As a player, when I take a king, I want that army's whole stake added to my army's, so that the reward is the same as before merges went away.
5. As a player, when I take a king, I want every other piece of that army to disappear, so that the board shows who is still in the game and nobody fights pieces with no player behind them.
6. As a player whose army holds stakes it captured, I want whoever takes my king to get all of it, so that a big stake is a big target.
7. As a player, I want a captured army's pieces to stop blocking paths, footprints and exits from the cycle after the capture, exactly as an exited army's pieces do.

### Stones

8. As a player, when my piece takes a king in the same cycle that my own king is taken or leaves through an exit, I want the king I took to become a stone holding its stake, so that a mutual capture neither destroys the stakes nor hands them to an army that no longer exists.
9. As a player, I want a stone to stay on its square, never move, and block like any piece.
10. As a player, I want to take a stone's whole stake by capturing it with any piece, my king included, without that piece being promoted.
11. As a player, I want two pieces arriving on a stone in the same cycle to follow the collision table like any arrival, so that a stone is never decided by the order of reveals.
12. As the owner of two armies that take each other's king in one cycle, I want to gain nothing, so that a staged mutual capture is not a way to move a stake without an exit.

### Pawns and pieces

13. As a player, I want my pawns to step one square in any orthogonal direction and capture on any diagonal, so that every pawn of an army that can be attacked from any side is useful.
14. As a player, I want no pawn double step and no facing, so that the rules are the same in every direction.
15. As a player, I want the rest of the pieces to move as before (knight, bishop, rook, queen within the slider range, king one square, never next to another army's king except onto that king's square).

### The board

16. As a player, I want my army deployed as a 5 by 5 square with my king in the centre and one free square beside it.
17. As a player, I want every army I deploy next to have exactly 4 empty squares between us, as in chess, on both axes.
18. As a player, I want the exits to be the 2 by 2 block where four armies meet diagonally, so that leaving means getting past the neighbours, which forces competition.
19. As a table creator, I want a table's armies on the same 9-square grid, without exits.

### Cost

20. As a player, I want an ordinary move to cost as little gas as the rules allow, so that playing for long is affordable.
21. As a player, I want the gas limit my client declares for a reveal to be close to what a reveal costs, so that my credits are not priced on a worst case that no longer exists.

### Tables and offline

22. As a table player, I want the cap's material count to count a promoted queen as a queen (9), a stone as nothing, and a stone's stake to be split with the rest at the cap if nobody took it.
23. As a table player, I want the last king standing to take every stake at the table, stones' included.
24. As an offline player, I want the offline world and its bots to play these rules with no difference from the online world.

### Autonomy notes

No open questions: every question raised while drafting and reviewing (a moving king meeting one piece, a captor whose king exits the same cycle, two victims on one square, a king next to a stone, how the bot values a stone) was answered by the maintainer on 2026-11-06 and is folded into the Solution. Keep the spec in `work/specs/proposed/` until `gas-profile-of-a-plain-move` is in `work/tasks/done/`: `taskedAfter` only takes spec slugs, so that ordering is enforced by staying staged, not by a flag. The spec is not `humanOnly`. Its tasks change the contracts' storage layout and rules, which is free only because nothing is deployed yet (`git ls-files contracts/deployments` listed nothing on 2026-11-06): check that again at tasking time.

## Implementation Decisions

- **Order-free stays the law** (`docs/adr/0002-order-free-lazy-resolution.md`). Every new rule is decided from counts and identities of a cycle that is over: promotion is a property of how a square settles (a lone arrival on a king's square lands as a queen); "the captor's king fell this cycle" is decided one level deep, never by a walk.
- **The kept fact: when a king fell.** A fallen king never moves again, so `_kingAt` still locates its square. But that square's facts are wiped when the square is next touched, and today `capturedInto` deliberately keeps no cycle. So when a king's square is folded, the fold writes on the victim's army record the cycle its king fell in and its captor ("two sources, one answer", as `_exited` does with `kingMovedIn`/`kingTo` and the `exited` flag): before the fold, the square's facts answer; after it, the army record does. The stone test is then: the captor army's fall cycle (from either source) equals the victim's.
- **The vanish check.** A piece of an army whose king fell (or exited) before the cycle being read is empty, except a stone. That costs two cold reads per distinct army (its army record, and its king's square while unfolded), warm after that, on every occupied square a reveal reads (up to 9 for a king step). It belongs in the gas estimate.
- **Stakes move one capture per cycle.** A capture is folded (the victim's reserve moved into the captor's) when the victim king's square is next touched, as `_moveReserveUp` does today; a stone's reserve stays with the stone's army until the stone is captured, then folds into its taker's the same way. The capture candidate list (`_capturesBy`) is KEPT: it is how an exit payout (`_collect`) finds victims not folded yet, whatever the profile shows. A stone capture is noted as a candidate too (today `_noteCandidate` fires only on a king), and `_collect` skips a victim that became a stone (its stake is not the captor's). Exit collection stays runnable in parts (`collecting`), and the read-only stake view (`_treeStake`, `_armyView`), bounded today only by `MAX_CHAIN`, gets a bound of its own (for example a depth cap that reports a lower bound) chosen at tasking. A table claim already sums every reserve at the table and needs no walk.
- **What goes away:** merges and `capturedInto` chains (ADR-0009), `MAX_CHAIN` and rocks, capture-loop detection and rotation (ADR-0004, ADR-0010), the merged-army part of exits (ADR-0011), the rocks and "already its captor's" assumptions of the table count (ADR-0012, amended), the collision row where a moving king and one other piece both die (ADR-0003), and the `forward` and `moved` fields of a piece.
- **Storage:** a square record in ONE slot. Each army gets a compact index (for example uint32) when it is created, and square records and spawn records store that index. The army's 256-bit identity (the framework's `player`) stays what the base and the client use; the mapping between the two is one slot per army, written once at creation.
- **Footprint** is the 21 squares of the 5 by 5 without its corners, the empty core square included, so a deployment's king always has its free square.
- **Gas:** the declared `revealGas` and `commitGas` are re-measured and lowered in `contracts/rocketh/config.ts`, with `GasBudget.test.ts` still enforcing headroom and the generosity ceiling.
- **The client** (`$lib/chess`, the HUD, the camera, the bot, the attacked-squares overlay) follows the contract: legal moves still come only from the Simulation route (ADR-0007). It changes more than where it draws: the `Piece` struct it decodes loses `forward` and `moved`; `ChessRules.outcome`, which it uses to show captures, changes with `settle`; the HUD's exit text and `armies.ts` stop mentioning rocks; the bot values a stone like a king; the overlay treats a stone as attacking nothing; and it draws stones, a 5 by 5 army and 2 by 2 exits.
- **Slice order.** (1) The board (ADR-0015): the 5 by 5 layout, pawns every way, no facing, spacing 9 on every grid, 2 by 2 exits, `_spawnCovering`'s new reach of 2, the 21-square footprint in `_footprintClear` and the table tally. It removes the facing the storage task needs gone. (2) Captures (ADR-0013 and ADR-0014 together): no merges, promotion, the collision row, stones and the kept fall cycle, in ONE task, because removing capture loops without stones leaves a mutual capture undefined. (3) Storage packing, cut on the gas profile's numbers. (4) Re-measure and lower `commitGas`, `revealGas` and `LOBBY_REVEAL_GAS`. The client follows each slice in the same task.
- **ADRs** (drafted with this spec, status `proposed`, turned `accepted` by the task that builds each, and the ones they replace marked superseded then): `docs/adr/0013-no-merges-a-captured-army-vanishes-and-its-captor-is-promoted.md`, `docs/adr/0014-a-capture-whose-captor-falls-the-same-cycle-leaves-a-stone.md`, `docs/adr/0015-a-square-army-with-pawns-that-move-every-way-on-a-9-grid.md`.
- **Vocabulary** (`CONTEXT.md`, "This game"): remove Merge, Rock and Capture loop; add Promotion and Stone; rewrite the section's introduction ("absorbs its army"), Army, Capture, Collision, Exit, Footprint, Spawn point, Dead army, Freeze ("its pieces then joining the captor"), Material and Greedy level (both mention rocks), Attacked square, and Table seat ("a tighter grid") to match. `round`/`turn`/`epoch` stay unused.

## Testing Decisions

- The order-independence suite (the reveals of a cycle replayed in several orders give the same board, owners and stakes) covers every new rule: promotion, a vanishing army, a stone, a stone captured, a stone contested by two arrivals, a king capturing onto an exit (what it took stays a stone), the two-victim square (the lone arriver takes both), a moving king meeting one piece (that piece lands as a queen), and a captor whose king exits the same cycle.
- `GasBudget.test.ts` measures the new worst reveal and the new plain reveals, and pins the lowered declared figures.
- The client's world tests and the offline world test (`web/test/lib/embedded/world.test.ts`, `web/test/lib/offline-boot.test.ts`) run on the new layout and spacing; the boot's every-seat-on-its-own-spawn-point test still holds at spacing 9.
- The e2e suites that draw the board are updated for the 5 by 5 army.

## Out of Scope

- Several pieces per move, and guarding the king's square: `work/notes/ideas/king-chase-table-modes.md`, a later spec sized on the gas this one frees.
- Kings that may not move onto a king, as a table option: `work/notes/ideas/kings-may-not-capture-kings.md`.
- The greedy bot heading for an exit once its army holds a captured stake: `work/notes/ideas/greedy-bot-exits-with-a-captured-stake.md`.
- Choosing the promoted piece (the maintainer wants it later; this spec always promotes to a queen).

## Further Notes

- Decided by the maintainer on 2026-11-06, in conversation: no merges; promotion to queen (a king that takes a king stays a king); a captured king's stake goes to its captor and snowballs; a mutual capture leaves stones that hold the stakes, captured by anyone without promotion; pawns step orthogonally and capture diagonally, all four ways, no double step; a square 5 by 5 army with an empty core square; 4 empty squares between neighbours (spacing 9) on every grid, tables included; 2 by 2 exits at the cell centre (chosen over exits between two neighbours because it forces more competition).
- The gas profile (`work/tasks/backlog/gas-profile-of-a-plain-move.md`) should land BEFORE this spec is tasked, so the storage task is cut on measured numbers rather than the estimates above.
