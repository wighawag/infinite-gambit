---
title: "A table option where a king may not move onto another king"
type: idea
status: incubating
created: 2026-11-06
---

Raised by the maintainer, 2026-11-06, while settling the "lean rules" (no merges, capturer promoted to queen).

Today a king may not move next to another army's king, measured on the start-of-cycle board, EXCEPT onto that king's own square, which is a capture (`contracts/src/game/internal/ChessRules.sol`, the comment above `SLIDER_RANGE`; `docs/adr/0003-collision-table-king-survives-a-crowd.md`). The lean rules keep that: a king that takes a king stays a king, and is not promoted.

The idea is an option, chosen per table (or per world), in which a king may NEVER move onto another king's square: kings can only be taken by other pieces. A king next to an enemy king could then never touch it, and only the rest of the army decides the fight.

What to check before specifying:
- It does NOT remove capture rings. A ring is any piece taking a king while another piece takes the first army's king in the same cycle (A's knight takes B's king, B's rook takes A's king). Kings never meet in that case, so forbidding king-takes-king leaves rings unchanged.
- The adjacency rule already makes two kings arriving on one square impossible. Check that the collision table (ADR-0003) still covers every case with this option on, in particular a king that stayed being reached by a moving king through a crowd.
- It is a rule in the contract (`docs/adr/0007-rules-live-only-in-the-contract.md`), so it is a per-game parameter the bot and the client's legal moves (`legalMoves` on the Simulation route) must read too.
