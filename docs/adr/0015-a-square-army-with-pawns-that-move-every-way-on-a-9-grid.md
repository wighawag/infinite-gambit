---
status: accepted
---

# A square army, pawns that move every way, spawn points 9 apart and 2 by 2 exits

An army is 5 by 5 without its corners (12 pawns around a 3 by 3 core, king in the centre, one core square empty), pawns step one square orthogonally in any direction and capture on any diagonal with no double step, spawn points are 9 apart on every grid, tables included, and an exit is the 2 by 2 block at the centre of each spawn-grid cell. On an infinite board an army can be attacked from any side, so a facing made half its pawns useless and forced two army shapes; a square army with pawns that work every way needs neither, and drops the `forward` and `moved` fields from every stored piece (a few bytes, which helps a square's record fit one storage slot once its 256-bit army ids are replaced by a compact index). A spacing of 9 gives exactly 4 empty squares between two neighbouring armies on both axes, as between the pawns of a chess opening, which a 6 by 4 army could not have with one spacing. We chose the exits where four armies meet diagonally over exits in the gap between two neighbours because they fit a 2 by 2 block exactly (the gap beside a 5-square side is odd) and because every exit is then contested by four armies.

Replaces the 6 by 4 layout facing away from the origin and the spacings of 16 (world) and 10 (tables). Spec: `work/specs/tasked/lean-rules.md`.
