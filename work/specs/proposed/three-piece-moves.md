---
title: 'Three piece-moves per army: a move is up to three pieces moving at once, so a chased king can strike back'
slug: three-piece-moves
---

## Problem Statement

A lone attacker can chase a king forever. Moves are simultaneous and an army moves one piece per cycle (`docs/adr/0001-one-move-per-army-merge-on-capture.md`), so a queen that lands each cycle on the square the king stands on forces the king to spend its only move running, and nothing else in its army ever moves. A piece that tries to take the queen aims at the queen's square, which the queen has already left. The attacker always wins the tempo, and on an infinite board the chase never has to end (seen in play, `work/notes/ideas/king-chase-table-modes.md`).

## Solution

- **A move is up to three piece-moves**, each by a different piece of the army: 0 (a pass), 1, 2 or 3. One move per army per cycle still holds; it is the move that grows.
- **An army's piece-moves are simultaneous**, like every other army's. Each is checked against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone, and the order the player lists them in changes nothing. So a piece may move onto, or slide through, a square its own army's piece leaves, and two pieces may swap. Refused (the whole reveal is illegal): two piece-moves to one square, and two piece-moves by one piece. Across armies nothing changes: arrivals resolve through the collision table, order-free (`docs/adr/0002`, `docs/adr/0003`).
- **The chase ends**: the king steps away while another piece lands on the square it left, where the attacker arrives, and the collision table decides that square as for any two arrivals.
- **A deployment is the whole move** of its cycle: an army that deploys moves nothing else that cycle.
- **A rules toggle.** The online and offline worlds have three piece-moves on. A table has it on or off as its creator chooses, carried as one bit of the `gameOptions` passed to `createGame` (already stored per clone by the framework, so no new storage). Off, a move is one piece-move, which is today's game.
- **One reveal carries the whole move** (the framework's `actionsPerReveal` is 3 where the toggle is on), so the "own movers count as gone" check sees all of the army's piece-moves at once.
- **Cost.** Each piece-move pays for its own two squares and path; the commit does not change. Measure a three-piece-move reveal first (`GasProfile.test.ts`, `docs/gas.md`), then set `REVEAL_GAS` / `LOBBY_REVEAL_GAS` from `GasBudget.test.ts`'s window on the worst three-piece-move reveal. Estimated from `docs/gas.md`: a plain three-piece-move reveal about 450k to 650k, the worst (captures on all three) about 1.8M, against 770k today.
- **The client and the bot.** The board lets a player plan up to three piece-moves (with A off, one), shows them, and submits them in one commitment; the planner refuses two to one square or two by one piece. Legal moves still come only from the contract's Simulation route (`docs/adr/0007-rules-live-only-in-the-contract.md`), which takes the whole move. The greedy bot picks up to three piece-moves by different pieces (captures first, as now). The table creation screen offers the toggle.
- **Words.** In `CONTEXT.md` ("This game"): Move becomes "up to three piece-moves by different pieces of one army in one cycle, simultaneous; a pass is none"; add Piece-move ("one chess move by one piece"); check every entry that says "one move" or "one piece" (Army, Freeze, Greedy level, Deployment).

## User Stories

1. As a player, I want to move up to three of my pieces in one cycle, so that my army can do more than run when it is chased.
2. As a player whose king is chased, I want to step my king away and land another piece on the square it left in the same cycle, so that the attacker landing there meets my piece.
3. As a player, I want my three piece-moves to count as simultaneous, so that the order I list them in never matters.
4. As a player, I want to move a piece onto or through a square another of my pieces leaves that cycle, and to swap two pieces.
5. As a player, I want a move that sends two of my pieces to one square, or moves one piece twice, refused before I commit, so that I never lose a reveal to it.
6. As a player, I want to pass, or move one or two pieces, as before.
7. As a player deploying an army, I want the deployment to be that army's whole move for its cycle.
8. As a table creator, I want to choose whether my table plays with three piece-moves or one.
9. As an offline player, I want the offline world and its bots to play three piece-moves, as the online world does.
10. As a player, I want the gas my client declares for a reveal priced on the measured worst three-piece-move reveal, and to see how many moves my credits still buy.
11. As a player facing the greedy bot, I want it to use its three piece-moves.

## Out of Scope

- Guarding the king's square (mode B of the idea note): dropped for now. Had it been built, the guard kills every enemy arriving on the king's square, and a king that steps away while its own piece lands there is just a vacated square.
- A number of piece-moves other than three, or chosen per table (the toggle is on or off; N = 3).
- Spreading one move over several reveals (`actionsPerReveal` below 3).
- `outcomes-report-promotion-and-stones` (staged): it touches `ChessRules.outcome`, which this spec may change, so it is built after this one.

## Further Notes

- Decided by the maintainer on 2026-11-06 and 2026-11-07, in conversation: mode A only; N = 3; a move is several piece-moves; simultaneous, with the army's own movers counted as gone (this replaces the 2026-11-06 note's "in the order the player gave them"); the worlds have it on and tables choose; a table carries it in `gameOptions`; up to three, a pass still allowed; a deployment is the whole move. The decision is `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md` (proposed).
- Before the first Sepolia deploy, so the change is a fresh deploy rather than a storage upgrade (AGENTS.md, the storage-key-is-a-wire rule).
- Order-free checks to keep in the order-replay suite: an army's three piece-moves in every listed order give the same board; across armies, every reveal order gives the same board, with a case where one army's piece lands on a square another of its own pieces vacated while an enemy arrives there.
