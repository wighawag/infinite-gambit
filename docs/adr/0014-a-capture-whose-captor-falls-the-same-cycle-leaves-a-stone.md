---
status: proposed
---

# A capture whose captor falls in the same cycle leaves a stone that holds the stake

When a king is taken by a piece whose own army loses its king in the same cycle (taken, or leaving through an exit), the capturing piece disappears with its army and the taken king becomes a stone on its square: it holds that army's whole stake, never moves, blocks like any piece, and whoever captures it takes the stake, without promotion. Deciding it is one level deep, never a walk around a ring: a fallen king never moves, so its square is known, and each army keeps the cycle its king fell in once that square is folded (before that, the square's own facts say it), so it costs a reveal almost nothing and bounds a stake to moving through one capture per cycle (in a chain A takes B while C takes A, B becomes a stone instead of passing through A to C).

We rejected keeping ADR-0004's rotation of owners because it needs ring detection, the most expensive thing a reveal did (about 1.2M gas with exits). We rejected losing the stakes of a ring, which is free and unexploitable, because it takes stakes out of the game; a stone keeps them on the board as prey, and still gives an owner of both armies nothing, which was ADR-0004's reason for rejecting refunds. Supersedes ADR-0004 and ADR-0010. Spec: `work/specs/proposed/lean-rules.md`.
