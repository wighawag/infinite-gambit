# Collisions: arrivals that contest a square fail, and a king survives a crowd

Who survives a square depends only on how many pieces arrive, whether one stayed, and whether a moving king is among the arrivals:

| On the square | Arrivals | Outcome |
|---|---|---|
| empty | 1 piece | it lands |
| empty | 2+ pieces, no king | all die |
| empty | a moving king + exactly 1 enemy piece | both die; the king's army merges into that enemy's army |
| empty | a moving king + 2+ enemy pieces | the king survives and lands, the enemy pieces die |
| a piece that stayed | 1 piece | captured |
| a piece that stayed | 2+ pieces, no moving king | all arrivals die, the piece that stayed survives |
| a piece that stayed | a moving king + exactly 1 enemy piece | the king and that piece die, the king's army merges into that enemy's army, the piece that stayed survives |
| a piece that stayed | a moving king + 2+ enemy pieces | the king survives and captures the piece that stayed, the other arrivals die |

A piece that moved away is never captured on its old square, and swaps and crossing paths both complete.

We considered "everyone dies" (simplest, as in SyncChess) but it leaves a king hit by two players in the same cycle with two claimants for its stake and army, which cannot be split. Making contested arrivals fail, with the king rows taking priority, guarantees every captured king has exactly one captor. We rejected "stronger piece wins" (the king becomes a battering ram) and "everyone bounces back" (it breaks lazy resolution, `docs/adr/0002-order-free-lazy-resolution.md`).

**Kings never collide.** A king may not move to a square adjacent to another king's start-of-cycle square, except onto that king's own square (a capture). Any square two kings could both reach in one cycle is adjacent to both of their start squares, so it is forbidden to both. Kings can still END a cycle adjacent (from (0,0) and (3,0) to (1,0) and (2,0)); that is harmless, because the rule is checked against the start-of-cycle board each time.
