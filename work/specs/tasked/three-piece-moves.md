---
title: 'Three piece-moves per army: a move is up to three pieces moving at once, so a chased king can strike back'
slug: three-piece-moves
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: the `three-piece-moves-*` tasks.

## Problem Statement

A lone attacker can chase a king forever. Moves are simultaneous and an army moves one piece per cycle (`docs/adr/0001-one-move-per-army-merge-on-capture.md`), so a queen that lands each cycle on the square the king stands on forces the king to spend its only move running, and nothing else in its army ever moves. A piece that tries to take the queen aims at the queen's square, which the queen has already left. The attacker always wins the tempo, and on an infinite board the chase never has to end (seen in play, `work/notes/ideas/king-chase-table-modes.md`).

## Solution

- **A move is up to three piece-moves**, each by a different piece of the army: 0 (a pass), 1, 2 or 3. One move per army per cycle still holds; it is the move that grows. A deployment stays the whole move of its cycle.
- **An army's piece-moves are simultaneous**, like every other army's: each is judged legal against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone, and the order the player lists them in changes nothing. A piece may move onto, or slide through, a square its own army's piece leaves, and two pieces may swap; two piece-moves to one square, or two by one piece, are refused. Across armies nothing changes.
- **The chase ends in a trade:** the king steps away while another of its pieces lands on the square it left, where the attacker arrives, and the collision table kills both.
- **On in the worlds, and each table chooses**, through one bit of the framework's `gameOptions` where a set bit means off.
- **The client asks the contract** for a whole move's legality; the player plans, sees and takes back up to three piece-moves; the greedy bot uses three.
- **The reveal is priced on the measured worst three-piece-move reveal**, and players are told what it costs them.

The decision and its reasons are `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`; the implementation detail (the legality-only mask, no self-prey, the shared `actionsPerReveal`, the whole-move route, the gas window, the words) moved into the four tasks below.

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
- Tasked on 2026-11-07 into six tasks, in order: `three-piece-moves-in-the-contract` (the rule, order-free; ADR-0016 accepted), `three-piece-moves-simulation-route` (the whole-move route, its cap a parameter), `three-piece-moves-gas-limits` (profile and declared limits), `three-piece-moves-table-toggle` (the `gameOptions` bit, refused at the seat, and the creation screen), `three-piece-moves-planner` (plan, see, take back, commit), `three-piece-moves-bot-and-words` (bot, offline world, CONTEXT). A reviewer subagent checked the task set the same day; its findings are applied (the harnesses chunk at 3, a stop rule if the gas window cannot close, the seat-time refusal, the route reads no storage, the storage record is unchanged, both large tasks split). `outcomes-report-promotion-and-stones` waits on the last of them.
