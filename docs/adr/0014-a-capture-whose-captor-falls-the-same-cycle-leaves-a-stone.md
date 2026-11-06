---
status: accepted
---

# A capture whose captor falls in the same cycle leaves a stone that holds the stake

When a king is taken by a piece whose own army loses its king in the same cycle (taken, or leaving through an exit), the capturing piece disappears with its army and the taken king becomes a stone on its square: it holds that army's whole stake, never moves, blocks like any piece, and whoever captures it takes the stake, without promotion. Deciding it is one level deep, never a walk around a ring: a fallen king never moves, so its square is known, and each army keeps the cycle its king fell in once that square is folded (before that, the square's own facts say it), so it costs a reveal almost nothing and bounds a stake to moving through one capture per cycle (in a chain A takes B while C takes A, B becomes a stone instead of passing through A to C).

On the two-victim square (a moving king and exactly one other piece arrive where a king or a stone stayed), when the arriving piece's own king falls in the same cycle, a square still holds one stone: what stood there becomes, or stays, the stone, and the moving king's stake goes into that stone's army. The arriving piece vanishes with its army, and nothing is stranded or lost (ratified by the maintainer on 2026-11-07). The stone's army is noted as a possible taker of the moving king's stake at reveal time, so its stake reads the same before and after the square is folded. Pinned by "the two-victim square" in `contracts/test/js/KingCapture.test.ts` (a king stood there) and "the two-victim square on a stone" in `contracts/test/js/Stones.test.ts` (a stone stood there).

We rejected keeping ADR-0004's rotation of owners because it needs ring detection, the most expensive thing a reveal did (about 1.2M gas with exits). We rejected losing the stakes of a ring, which is free and unexploitable, because it takes stakes out of the game; a stone keeps them on the board as prey, and still gives an owner of both armies nothing, which was ADR-0004's reason for rejecting refunds. Supersedes ADR-0004 and ADR-0010. Spec: `work/specs/tasked/lean-rules.md`.
