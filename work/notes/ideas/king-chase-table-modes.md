---
title: "Table modes so a chased king is not doomed: several pieces per move, or guarding the king's square"
type: idea
status: incubating
created: 2026-11-06
---

## The problem (seen in play, 2026-11-06)

The maintainer saw a queen chase a king, and the king's only option was to keep running. The queen was never capturable. Moves are simultaneous and an army moves ONE piece per cycle (`docs/adr/0001-one-move-per-army-merge-on-capture.md`), so each cycle the queen moves onto the square the king is on NOW. The king has to spend its single move leaving that square, and nothing else in the army ever gets to move. A piece that tries to capture the queen aims at the queen's current square, which the queen has already left. The attacker always wins the tempo, and on an infinite board the chase never has to end.

## Two candidate rules, ideally both as table modes

**A. Several pieces per move (the maintainer's preferred DEFAULT: 3).** An army's move becomes up to N moves, each by a DIFFERENT piece (N = 3 by default). The king can step away while another piece captures on the square the queen lands on, which is the king's previous square.

**B. Guard the king's square.** A piece may move onto its OWN king's square. That piece always dies as a result. If an enemy piece moves onto the king's square in the same cycle, the guard kills it and saves the king. This turns "the queen always targets where the king is" into a trap the defender can set, without adding tempo.

Both could be chosen per table (a lobby option), with A at N = 3 as the default.

## What this collides with (read before specifying)

- **A reverses ADR-0001's core trade-off.** That ADR rejected extra tempo for merged armies so that a big empire is "stretched thin": more material, no more tempo. With N moves per army, a merged empire gets N moves, so check whether the snowball ADR-0001 guards against comes back. A supersedes or amends that ADR, so it needs a new ADR, not just a task.
- **Commit-reveal budget.** One reveal carries an army's move today. N moves per reveal changes `actionsPerReveal`/`expectedActionsPerTurn`, the bond, and `GasBudget.test.ts`. The declared `revealGas` is already about 1.3M.
- **Order-free resolution (`docs/adr/0002-order-free-lazy-resolution.md`)** has to hold for N moves within one army as well as across armies: two of an army's own pieces moving to the same square, a piece moving to a square another of its own pieces just left, and so on.
- **B needs a collision rule.** It sits beside `docs/adr/0003-collision-table-king-survives-a-crowd.md`: the outcome when guard, king and attacker meet, several guards, a guard against a crowd, and whether the king itself moving away while a guard lands counts.
- **Rules live only in the contract (`docs/adr/0007-rules-live-only-in-the-contract.md`).** Either mode is a contract change: a per-table rules parameter, plus the web client and the bot (`chess-greedy-bot`) learning it.
- Vocabulary: "move" in `CONTEXT.md` is "one chess move by one piece, at most one per cycle". Mode A redefines it, so settle the words (a move of N piece-moves?) before naming anything.

## Settled by the maintainer (2026-11-06)

- **ADR-0001 may change.** Mode A amends or supersedes it; write the new ADR with the spec.
- **Within one army, the piece-moves apply in the order the player gave them.** That order is the player's own, fixed in their single commitment, so it is not the mempool order the commit-reveal rule forbids depending on. Across armies, everything stays simultaneous and order-free (ADR-0002). Still to specify: what a later piece-move of the same army sees of an earlier one (for example, moving into a square the army's own earlier piece-move just vacated, or two of its piece-moves aiming at one square).
- **Gas must be understood first.** A single-piece reveal already costs about 330,000 to 450,000 gas, and the declared limit is 1,345,000. Three piece-moves per reveal multiplies the dominant costs, so profile where a plain reveal's gas goes before sizing N (see the gas explanation given on 2026-11-06, and `contracts/test/js/GasBudget.test.ts`).

Next step: grill this into a spec (which mode first, N, how the lobby offers it), then write the ADR for A.

## Settled by the maintainer (2026-11-07)

- **A and B are two independent toggles, not one mode to choose.** A table can turn on either, both or neither.
- **N = 3** for now.
- **Words: a move is several piece-moves.** `CONTEXT.md`'s Move becomes up to N piece-moves by different pieces of one army in one cycle, and a new Piece-move entry is one chess move by one piece.
- Still open: what a piece-move sees of the same army's other piece-moves, which toggles the online and offline worlds use, and B's collision rows.

## Settled by the maintainer (2026-11-07, later)

- **Only mode A is built.** Mode B (guarding the king's square) is dropped for now. Had it been built: the guard kills every enemy arriving on the king's square, and a king that steps away while its own piece lands there is just A's vacated square.
- **An army's piece-moves are simultaneous, like everyone else's.** Each is checked against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone, and the order the player lists them in does not matter. Allowed: moving onto, or sliding through, a square the army's own piece leaves, and swapping two pieces. Refused: two of its piece-moves to one square, and two piece-moves by one piece. Across armies nothing changes (ADR-0002, the collision table). This replaces the 2026-11-06 "in the order the player gave them".
- **Where A is on:** the online and offline worlds have it on; each table chooses.
