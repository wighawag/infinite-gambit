---
title: 'Infinite chess: simultaneous, staked, commit-reveal chess on an infinite board'
slug: infinite-chess
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked; they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The template gives us simultaneous commit-reveal play, an infinite board, and offline play (hotseat and single player), but no game. We want chess on that foundation: a persistent world where anyone can stake into an army, fight anyone nearby, grow by capturing kings, and leave with their winnings. Plain chess does not survive that move. It is sequential, it is two-player, it ends at checkmate, and its board is 8 by 8. Each of those has to be replaced by a rule that is simultaneous, many-player, staked, and open-ended, without letting the order in which reveals land on chain decide anything.

## Solution

Every player owns one or more **armies**. An army is deployed by staking a fixed amount at a hidden **spawn point**, and it is a king (which holds the stake) with nineteen pieces (twelve pawns and seven others) arranged as a rectangle ringed by pawns. Every **cycle**, every army may make one chess **move**, committed in secret and revealed together, and all moves resolve simultaneously against the board as it was at the start of the cycle. Capturing a king (actual capture; checkmate means nothing here) gives its stake to the captor's king and **merges** its army into the captor's. The only way to take a stake home is to bring the king to an **exit** square. A missed reveal **freezes** the army forever. The same rules also run online as a closed **table** (fixed seats, no exits, last king standing). Offline, the world runs on an in-browser chain as the hotseat mode: each seat is a human at the same device or a machine-played seat (a greedy bot), which is how single player works.

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
42. As a table player, I want the next phase to start as soon as everyone has acted (with the clock as a backstop), so that a table moves as fast as its players act.
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

## Out of Scope

- ERC20 stakes other than the game's own token.
- Armies as NFTs or transferable armies.
- More than one army per account in the frontend (the contract allows it).
- Fog of war (impossible on a public chain, and a courtesy fog would only handicap honest players).
- A real chess engine for played seats.
- A protocol fee: v1 is strictly zero-sum.

## Further Notes

Tasked: what to build now lives in the `infinite-chess` tasks under `work/tasks/`, and the reasoning in `docs/adr/` (0001 to 0007). Prior simultaneous-move variants this design starts from: Synchronous Chess (Korolev, 1991; https://www.chessvariants.com/play/erf/Synchron.html) and SyncChess (https://www.syncchess.com/), for their "swerving" and "collision" rules.
