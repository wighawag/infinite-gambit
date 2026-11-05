---
title: 'Infinite chess: simultaneous, staked, commit-reveal chess on an infinite board'
slug: infinite-chess
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked; they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The template gives us simultaneous commit-reveal play, an infinite board, and offline play (hotseat and single player), but no game. We want chess on that foundation: a persistent world where anyone can stake into an army, fight anyone nearby, grow by capturing kings, and leave with their winnings. Plain chess does not survive that move. It is sequential, it is two-player, it ends at checkmate, and its board is 8 by 8. Each of those has to be replaced by a rule that is simultaneous, many-player, staked, and open-ended, without letting the order in which reveals land on chain decide anything.

## Solution

Every player owns one or more **armies**. An army is deployed by staking a fixed amount at a hidden **spawn point**, and it is a king (which holds the stake) with fifteen pieces arranged as a rectangle ringed by pawns. Every **cycle**, every army may make one chess **move**, committed in secret and revealed together, and all moves resolve simultaneously against the board as it was at the start of the cycle. Capturing a king (actual capture; checkmate means nothing here) gives its stake to the captor's king and **merges** its army into the captor's. The only way to take a stake home is to bring the king to an **exit** square. A missed reveal **freezes** the army forever. The same rules also run as a closed **table** (fixed seats, no exits, last king standing) for offline hotseat and single-player play against a greedy bot.

## User Stories

### Joining the world

1. As a new player, I want to buy a stake with native ETH in one transaction, so that I can start without a mint/approve/stake dance.
2. As a new player, I want to choose one of the open spawn points in secret, so that nobody can prepare an attack on my army before it exists.
3. As a new player, I want to see which spawn points are open and how close the nearest armies are, so that I can choose where to fight.
4. As a new player, I want my deployment refunded if someone else deploys to the same spawn point in the same cycle, so that a collision I could not see does not cost me.
5. As a new player, I want my deployment refunded if the spawn point's footprint is no longer clear when I reveal, so that nobody can camp a spawn point to eat new armies.
6. As a player, I want a deployment that is committed and never revealed to burn its stake, so that nobody can commit a deployment, watch the reveals, and cancel for free.
7. As a new player, I want my army to appear at the end of the reveal phase and act from the next cycle, so that no move committed before my deployment can hit it.
8. As a player, I want my army laid out the same way as everyone else's, oriented by where it spawned, so that deployment is fair and I do not have to configure anything.

### Playing a cycle

9. As a player, I want to make one chess move per army per cycle, so that the game has a clear tempo.
10. As a player, I want to be allowed to pass, either by committing nothing or by committing an empty move, so that I can wait without revealing whether I am idle.
11. As a player, I want my move hidden until the reveal phase, so that opponents commit theirs without knowing mine.
12. As a player, I want my move validated against the board as it was at the start of the cycle, so that what is legal never depends on what other players do in the same cycle.
13. As a player, I want the outcome of a cycle to be the same whatever order reveals land in, so that paying more gas never decides a fight.
14. As a player, I want my move revealed for me automatically by the local revealer, so that I do not lose my army because I closed the tab.
15. As a player, I want a loud warning as the reveal deadline approaches and my reveal has not landed, so that I can act before my army freezes.

### Chess rules

16. As a player, I want the pieces to move as in chess, with sliders (rook, bishop, queen) capped at 7 squares, so that it still feels like chess and no queen can strike from across the world.
17. As a player, I want pawns to advance away from their army (each pawn's forward is fixed at deployment), with the two-square first move, so that the ring of pawns protects and expands outward.
18. As a player, I want no castling, no en passant and no promotion, so that the rules stay unambiguous under simultaneous play on an infinite board.
19. As a player, I want to be allowed to move my king onto an attacked square, so that bluffing is part of the game (the attacker may move away).
20. As a player, I want kings never to become adjacent (a king may not move next to another king), so that two kings can never collide.
21. As a player, I want to see which squares are attacked, so that I do not walk into a capture by accident.

### Simultaneous resolution

22. As a player, I want a piece that moves away to escape a capture aimed at its old square (the attacker simply lands there), so that dodging is a skill.
23. As a player, I want two pieces that swap squares, or cross paths, to both complete their moves, so that resolution only cares about destinations.
24. As a player, I want every piece to die when two or more non-king pieces arrive on the same square, so that collisions are simple and symmetric.
25. As a player, I want a piece that stayed on its square to be captured if exactly one piece arrives there, and to survive if two or more arrive (they fight each other on the doorstep), so that a capture always has exactly one captor.
26. As a player, I want my moving king to survive when two or more enemy pieces arrive on the same square with it, so that a king is never lost to a crowd it could not see.
27. As a player, I want my moving king and a single enemy piece arriving on the same square to both die, with my army going to the enemy's army, so that walking into a lone piece is as fatal as being captured.

### Capture, merge and capture loops

28. As a player, I want capturing a king to add its stake to my king's and merge its pieces into my army, so that winning fights grows me.
29. As a player, I want my merged army to still make one move per cycle, so that a big empire is stretched thin and small armies can raid it.
30. As a player, I want captures that chain within one cycle (A takes B while C takes A) to resolve to the last captor owning everything, so that chains are predictable.
31. As a player caught in a capture loop (A takes B while B takes A, or longer), I want the king-capturing pieces to die, every king to survive in place, and each owner to take over the army they captured, so that every captor still gets exactly what it captured.

### Leaving

32. As a player, I want to leave with my king's whole stake by landing my king on an exit square with no collision, so that winnings are real.
33. As a player, I want my exit paid out in ETH through the same sale contract at the same fixed price, so that it is ETH in, ETH out.
34. As a player, I want my remaining pieces removed from the board when my king exits, so that the world does not fill with leftovers.
35. As a player, I want no other way to withdraw a stake, so that nobody can leave a losing fight by pressing a button.

### Missed reveals

36. As a player, I want an army whose commitment is never revealed to be frozen forever (it never moves, its king cannot exit, but it can still be captured), so that committing and then going quiet after seeing other reveals is never worth it.
37. As a player, I want frozen and idle armies to stay on the board with their stakes, so that there is always loot worth walking towards.

### Tables and offline play

38. As a player, I want to create a closed table with a fixed number of seats, so that friends can play a game that ends.
39. As a table player, I want each seat to spawn on its own spawn point on a tighter grid, so that armies meet quickly.
40. As a table player, I want no exits and the last king standing to take every stake, so that a table has a winner.
41. As a table player, I want a cycle cap after which the remaining stakes are split by remaining material, so that a table always ends.
42. As a table player, I want the next phase to start as soon as everyone has acted (with the clock as a backstop), so that hotseat and single-player games move at the speed people click.
43. As a solo player, I want machine-played seats that capture the most valuable piece they can reach and otherwise make a random legal move, so that single player punishes blunders.

### Seeing the world

44. As a player, I want the camera to follow my army by default and to pan freely, so that I can watch my fight and scout.
45. As a player, I want a minimap of the spawn spiral with exits and armies marked, so that I can find the fighting on an infinite board.
46. As a player, I want every army's king labelled with its stake, and frozen armies greyed out, so that I can judge targets at a glance.
47. As a player, I want a countdown to the end of the current phase, so that I know when to commit and when my reveal must land.
48. As a player, I want the client to fetch only the area in view, so that the world stays fast however large it grows.

### Autonomy notes

- **`humanOnly`:** not set. Tasking can be done by an agent once the open question is answered.
- **`needsAnswers`:** not set. The one open question (an unrevealed deployment's stake) was answered: it is burned.

## Implementation Decisions

### Identity and stake

- An **army is the framework's identity** (`_playerOf`): a `uint256` army id, owned by an account and acted for by its signer through the template's delegation. Not an NFT, and not NFT-shaped.
- An account may own several armies (the contract allows it); the v1 frontend shows one army per account.
- The stake is the template's **ERC20 reserve**, bought with native ETH through `StakeSale` in one transaction. A fixed stake amount is moved from the reserve into the army at deployment. `StakeSale` gains a **`redeem`** at the same fixed price so an exit returns ETH. The reserve's ordinary debit-to-leave path is **disabled**: an exit square is the only way out. ERC20 stakes beyond the game token are not in v1.
- **One commitment per army per cycle.** The commitment holds at most one move (or none, a committed pass).

### Board and armies

- Coordinates are signed integers on an unbounded grid. Storage is sparse (per-square), never an array.
- **Layout (horizontal form)**, 6 by 4 with empty corners and 12 pawns. It is 180-degree rotationally symmetric apart from the king and queen:

  ```
  . P P P P .
  P R N B Q P
  P K B N R P
  . P P P P .
  ```

- **Orientation is a function of the spawn point**: the long side faces the origin (horizontal when |y| >= |x|, else vertical), with the king's row on the side away from the origin.
- **Pawns** face outward from their side of the rectangle, fixed at deployment and kept after a merge. Every piece carries a has-moved flag for the pawn's two-square first move.

### Moves and legality

- **Every move is validated against the start-of-cycle board.** Normal chess movement; sliders capped at 7 squares with path blocking checked on the start-of-cycle board; no castling, en passant, or promotion; no check rules; a king may move onto an attacked square.
- A pawn's diagonal move requires an enemy on that square at the start of the cycle. Its straight move requires the square to be empty then.
- A king may not move to a square adjacent to another king.
- A move onto a square held by one's own piece is illegal. Two pieces of the SAME army can never collide, since an army moves at most one piece. Armies of the same account are different armies.

### Order-free, lazy resolution (no resolution transaction)

- Reveals only **accumulate order-free facts** for the cycle: per origin square the destination, per destination square an arrival count (`+=`), the identity of a lone arriver, and whether a king is among the arrivals.
- A square's state for a cycle is a **pure function** of the start-of-cycle state and those facts, so it is **computed lazily** when something next touches the square. A per-square "last touched cycle" skips idle cycles.
- Army ownership after merges is resolved lazily through a "captured into" pointer per army, followed on read. Capture loops are detected by following those pointers once the cycle is final.
- This is the template's commit-reveal rule (a reveal must not branch on state another reveal in the same cycle could change), met by deferring every comparison to lazy resolution instead of an explicit resolution step.

### The collision table

| On the square | Arrivals | Outcome |
|---|---|---|
| empty | 1 piece | it lands |
| empty | 2+ pieces, no king | all die |
| empty | a moving king + exactly 1 enemy piece | both die; the king's army merges into the enemy's army |
| empty | a moving king + 2+ enemy pieces | the king survives, the enemy pieces die |
| a piece that stayed (king or not) | 1 piece | captured |
| a piece that stayed (king or not) | 2+ pieces | all arrivals die, the piece that stayed survives |

A piece that moved away is never captured on its old square. Swaps and crossing paths both complete.

### Capture, merge, capture loops

- A captured king's stake moves to the captor army's king and its pieces join the captor army, which keeps one move per cycle.
- Chains (A takes B, C takes A) end with the last captor owning everything.
- **Capture loops** (a ring of armies each capturing the next one's king in the same cycle): the pieces that captured the kings die, every king in the loop survives where it stood, and each owner takes over the army (and stake) it captured.

### Spawn points and exits

- **World spawn grid** spacing S = 16. Only the K = 8 free spawn points nearest the origin (spiral order) are open for deployment.
- A deployment is committed (the spawn point is hidden) and revealed like a move. It fails and is refunded if two or more deployments reveal the same spawn point in the cycle, or if its footprint is not empty on the start-of-cycle board. Otherwise the army is placed at the end of the cycle and acts from the next one.
- The stake is locked at the deployment commit. A deployment that is committed and never revealed has its stake **burned**: there is no army to freeze yet, and a refund would let a player commit, watch the cycle's reveals, and cancel for free.
- **Exits** sit at the centre of each spawn-grid cell (offset S/2 on both axes). A king that lands on an exit with no collision leaves: the stake is paid out and the rest of its army is removed.

### Missed reveal

- `_forfeit` is overridden: a missed reveal **freezes the army forever**. It never moves again, its king cannot exit, and it can still be captured (its pieces come back to life under the captor). In a table, a frozen army also stops being a waited-for member.

### Clock

- The world is clock-driven. Durations are immutable per deployment: about 23h commit + 1h reveal on slow chains, about 10 min + 5 min where blocks are fast enough.
- Tables let unanimity bring the next phase forward, with the clock as a backstop.

### Tables

- Built on the template's table and lobby (fixed seats, a creator who starts the table, closed roster). The same rules contract is used as for the world.
- Seats spawn on the first N spawn points of a tighter grid (spacing about 10). Exits are disabled. The last king standing takes every stake.
- A per-table cycle cap: when it is reached, the remaining stakes are split in proportion to remaining material (pawn 1, knight 3, bishop 3, rook 5, queen 9).
- Played seats run a greedy bot: capture the most valuable piece reachable this cycle, else a random legal move.

### Client

- Everything on chain is shown (no fog). Overlays: attacked squares, the phase countdown, stake labels on kings, frozen armies greyed out.
- The camera follows the player's army and pans freely. A minimap shows the spawn spiral, exits and armies. Pieces are fetched only for the area in view.
- Per the repo's Svelte conventions, the rules (legality, resolution, the bot) live in plain `.ts` modules. Components only render.

## Testing Decisions

- **Order independence is the property that matters most**: replay the same set of revealed commitments in several orders (at least forward and reverse) and assert an identical board, ownership and stakes. The template's `Game.test.ts` does this for its reference game; keep that shape.
- Each row of the collision table, swerving, swaps, the slider path, king adjacency, chains and capture loops gets its own contract test.
- **One rules engine, two implementations, held equal**: the client's TypeScript rules (used for move legality, previews and the bot) must agree with the contract. Drive both from the same scenario fixtures.
- Lazy resolution: assert that reading a square after several idle cycles gives the same result as resolving cycle by cycle.
- Freeze, deployment collisions/footprint refunds, exit payout through `redeem`, and the disabled withdraw path each get a test.
- Prior art: `contracts/test/js/Game.test.ts` (order independence), `contracts/test/js/DeterministicDeploys.test.ts` (deploy rules), the template's offline lobby and played-seat tests.

## Out of Scope

- ERC20 stakes other than the game's own token.
- Armies as NFTs or transferable armies.
- More than one army per account in the frontend (the contract allows it).
- Fog of war (impossible on a public chain, and a courtesy fog would only handicap honest players).
- A real chess engine for played seats.
- A protocol fee: v1 is strictly zero-sum.

## Further Notes

- **Why one move per army and not per player:** a per-player tempo is defeated by opening extra wallets. A per-army tempo is neutral to that because a second army costs a second stake. Merging on capture keeps an empire to one move, which is the brake on snowballing.
- **Why freeze forever:** reveals land in order during the reveal phase, so a late revealer sees everyone else's moves first. Without a harsh cost, "commit, look, then stay silent if it went badly" is worth up to a queen or a king.
- **Why kings survive a crowd:** with "everyone dies", two players attacking one king in the same cycle leave its stake and army with two claimants. Making a contested arrival fail guarantees every captured king has exactly one captor.
- Prior simultaneous-move variants consulted: Synchronous Chess (Korolev, 1991; https://www.chessvariants.com/play/erf/Synchron.html) and SyncChess (https://www.syncchess.com/). Their "swerving" and "collision" rules are where this design starts.
- Decisions recorded as ADRs: `docs/adr/`.
