---
status: proposed
---

# No merges: a captured army vanishes, its stake goes to its captor, and the capturing piece becomes a queen

Capturing a king no longer merges its army into the captor's. Every piece of the captured army disappears from the board (lazily, read the same way an exited army's pieces are), its whole stake goes to the army that took it, and the piece that took the king is promoted to a queen; a king that takes a king stays a king. A moving king that meets exactly one other piece on a square dies, and that piece lands as a queen with its stake (one row of ADR-0003's collision table changes: today both die). We dropped merges because they are what makes the game expensive and hard to read: following captured-into pointers (ADR-0009) and folding capture loops (ADR-0010) set the declared reveal limit at 1,345,000 gas, which prices every player's credits, and they brought rocks, an 8-capture chain limit and rotating owners. ADR-0001's reason for one move per army still holds, and its other half (a merged empire has more material but no more tempo) has no object any more: an army that captures grows in stake and gains one queen, not an empire. Stakes still snowball, so a big stake stays a big target.

Amends ADR-0001 (its merge half) and ADR-0003 (the moving-king-meets-one-piece row), supersedes ADR-0009, supersedes the merged-army part of ADR-0011 (an exit leaves no rocks, because there are no merged pieces), and amends ADR-0012 (a table's count has no rocks). Spec: `work/specs/proposed/lean-rules.md`.
