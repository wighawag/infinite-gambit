---
title: 'Three piece-moves per army: a move is up to three pieces moving at once, so a chased king can strike back'
slug: three-piece-moves
---

## Problem Statement

A lone attacker can chase a king forever. Moves are simultaneous and an army moves one piece per cycle (`docs/adr/0001-one-move-per-army-merge-on-capture.md`), so a queen that lands each cycle on the square the king stands on forces the king to spend its only move running, and nothing else in its army ever moves. A piece that tries to take the queen aims at the queen's square, which the queen has already left. The attacker always wins the tempo, and on an infinite board the chase never has to end (seen in play, `work/notes/ideas/king-chase-table-modes.md`).

## Solution

### The rule

- **A move is up to three piece-moves**, each by a different piece of the army: 0 (a pass), 1, 2 or 3. One move per army per cycle still holds; it is the move that grows.
- **An army's piece-moves are simultaneous**, like every other army's. Each is judged legal against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone, and the order the player lists them in changes nothing. So a piece may move onto, or slide through, a square its own army's piece leaves, and two pieces may swap. Refused (the whole reveal is illegal): two piece-moves to one square, and two piece-moves by one piece. Across armies nothing changes: arrivals resolve through the collision table, order-free (`docs/adr/0002`, `docs/adr/0003`).
- **The chase ends in a trade.** The king steps away while another of its pieces lands on the square it left, where the attacker arrives: two arrivals and no king, so the collision table kills both. The chaser is stopped at the price of a piece (accepted by the maintainer).
- **A deployment is the whole move** of its cycle. This is already enforced today (`UsingGameInternal.sol`, a deployment's reveal carries one action); keep it.

### How, order-free

- **Own movers count as gone for the legality check ONLY.** `isLegalMove` gets the start-of-cycle contents with the army's own vacated squares masked. Everything else keeps the real start-of-cycle facts: what `_touch` records as the square's standing piece, and whether a king or stone stood there to be taken (`prey` in `_revealMove`). Masking those would let whichever reveal touches a square first decide what its record says, which is a branch on reveal order.
- **An army's own piece is never its prey.** A piece arriving where its own king (or any own piece) just left notes no capture candidate for its own army, so `_capturesBy` gets no self-entry.
- **The captor's fall stays one level deep.** `_captorFell`'s argument that a non-king captor "had its king stand still" no longer holds: the king may move in the same cycle. The answer is still read from where the king's last move took it (`_fellIn` through `kingTo`); restate the reasoning in the code and in ADR-0014's amendment line.
- **The order-replay suite** gains: one army's three piece-moves listed in every order give the same board; across armies, every reveal order gives the same board, owners and stakes, including a piece landing on a square its own piece vacated while an enemy arrives there, a swap, the chase trade, and a captor whose king moves and falls elsewhere while its rook takes a standing king (a stone).

### The toggle

- **One bit of the framework's `gameOptions`, and a SET bit means OFF.** The online and offline worlds never open a roster, so they read zero and play three piece-moves; a table created with no options (the client's `NO_GAME_OPTIONS`) plays three as well, and its creator sets the bit to play one. Pin the bit's position in the contract and the client, and refuse a table whose `gameOptions` has any other bit set.
- **`actionsPerReveal` is 3 on both worlds and on the Lobby.** It is one immutable value shared by every table clone, so it only caps a chunk. The game's own per-move check (today's `OneMovePerCycle`) caps a move at 3, or at 1 where the bit is set, and refuses a repeated from-square or to-square. The client takes the cap from the toggle, never from `actionsPerReveal`. One reveal carries the whole move, so the "own movers count as gone" check sees all of the army's piece-moves at once.

### The client and the bot

- **A whole-move contract route.** The Simulation route today answers for one piece (`legalMoves(board, from)`). Add a route that judges a whole move, owning the "two to one square / two by one piece / own movers count as gone" rules, so the planner and the bot only ask it (`docs/adr/0007-rules-live-only-in-the-contract.md`); the client keeps no copy of those rules.
- **The planner** lets a player plan up to the cap, shows each planned piece-move on the board (distinguishable, and removable one at a time), and submits them in one commitment. The attacked-squares overlay stays a view of the start-of-cycle board.
- **The greedy bot** picks up to three piece-moves by different pieces (captures first, as now), checked through the whole-move route.
- **The table creation screen** offers the toggle (default: three piece-moves).

### Cost

- **Measure first.** Add a three-piece-move scene to `GasProfile.test.ts` and `docs/gas.md` before setting any figure. Estimated from `docs/gas.md`: a plain three-piece-move reveal about 0.5M to 0.8M on the test build, the worst (captures on all three) about 1.9M to 2.1M before headroom, against 770k today.
- **The declared limits.** Set `REVEAL_GAS` and `LOBBY_REVEAL_GAS` from `GasBudget.test.ts`'s window on the worst three-piece-move reveal. The window's ceiling is three times the PLAINEST reveal; measure "plainest" as a plain three-piece-move reveal where the toggle is on (the worst is a three-piece-move reveal, so the plainest of the same kind is the fair floor), for the world and for a table alike. A table's reveal can list up to 6 zones on first touch, not 2 (`contracts/rocketh/config.ts`); price that.
- **What players see.** `creditsGasMultiplier` is `COMMIT_GAS + REVEAL_GAS`, so the credits a player is shown drop by about 2x for everyone, at tables with the toggle off too. The fuzd prepayment rises with `revealGas`. Say both in the comments above the figures.
- **`EXPECTED_ACTIONS_PER_TURN` stays 1** (a move is still one commit and one reveal), but its comment ("ONE, IN CHESS, BECAUSE IT IS THE RULE: one move") is re-justified in those terms.

### Words

In `CONTEXT.md` ("This game"): Move becomes "up to three piece-moves by different pieces of one army in one cycle, simultaneous; a pass is none (one where the table turns it off)"; add Piece-move ("one chess move by one piece"); check every entry that says "one move" or "one piece" (Army, Freeze, Greedy level, Deployment). ADR-0016 is accepted once built, with ADR-0001 and ADR-0014 carrying their "Amended by" lines.

## User Stories

1. As a player, I want to move up to three of my pieces in one cycle, so that my army can do more than run when it is chased.
2. As a player whose king is chased, I want to step my king away and land another piece on the square it left in the same cycle, so that the attacker landing there dies with my piece and the chase ends.
3. As a player, I want my three piece-moves to count as simultaneous, so that the order I list them in never matters.
4. As a player, I want to move a piece onto or through a square another of my pieces leaves that cycle, and to swap two pieces.
5. As a player, I want a move that sends two of my pieces to one square, or moves one piece twice, refused before I commit, so that I never lose a reveal to it.
6. As a player, I want to pass, or move one or two pieces, as before.
7. As a player deploying an army, I want the deployment to be that army's whole move for its cycle.
8. As a player, I want to see each of my planned piece-moves on the board and take any of them back before I commit.
9. As a table creator, I want to choose whether my table plays with three piece-moves or one, with three the default.
10. As an offline player, I want the offline world and its bots to play three piece-moves, as the online world does.
11. As a player, I want the gas my client declares for a reveal priced on the measured worst three-piece-move reveal, and to see how many moves my credits still buy.
12. As a player facing the greedy bot, I want it to use its three piece-moves.

## Out of Scope

- Guarding the king's square (mode B of the idea note): dropped for now. Had it been built, the guard kills every enemy arriving on the king's square, and a king that steps away while its own piece lands there is just a vacated square.
- A number of piece-moves other than three, or other than "three or one" per table.
- Spreading one move over several reveals.
- `outcomes-report-promotion-and-stones` (staged): it touches `ChessRules.outcome`, which this spec may change, so it is built after this one.

## Further Notes

- Decided by the maintainer on 2026-11-06 and 2026-11-07, in conversation: mode A only; N = 3; a move is several piece-moves; simultaneous, with the army's own movers counted as gone (replacing the 2026-11-06 note's "in the order the player gave them"); on in the worlds, tables choose; a table carries it in `gameOptions`, a set bit meaning off; up to three, a pass still allowed; a deployment is the whole move; the chase ends in a trade; one spec, split at tasking (the contract rule and gas first, then the toggle, then the client and the bot). The decision is `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md` (proposed).
- Reviewed on 2026-11-07 by a reviewer subagent: approve with changes, all applied here (the legality-only mask, no self-prey, the shared `actionsPerReveal`, the whole-move route, the ADR-0014 amendment, the credits and table-zones cost). It confirmed against the code that reads ignore the cycle's own writes (`_squareAt`), that one square record copes with an own departure and arrival, and that the king-adjacency rule only looks at enemy kings.
- Before the first Sepolia deploy, so the change is a fresh deploy rather than a storage upgrade (AGENTS.md, the storage-key-is-a-wire rule).
