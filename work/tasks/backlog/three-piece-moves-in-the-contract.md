---
title: 'Three piece-moves in the contract: a move is up to three pieces moving at once, judged simultaneously, with a whole-move simulation route'
slug: three-piece-moves-in-the-contract
spec: three-piece-moves
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7]
---

## What to build

The first slice of the `three-piece-moves` spec and `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`, in the CONTRACT. Every world and every table gets three piece-moves in this task; the per-table toggle comes in `three-piece-moves-table-toggle`, the declared gas limits in `three-piece-moves-gas-limits`, and the client in `three-piece-moves-on-the-client`. The client keeps submitting one piece-move, which stays legal, so it needs no change here beyond what an ABI change forces.

**The rule.**

- An army's move is up to three piece-moves, each by a different piece: 0 (a pass), 1, 2 or 3. `actionsPerReveal` becomes 3 for both worlds and the Lobby (`contracts/rocketh/config.ts`), so one reveal carries the whole move. The game's own per-move check (today's `OneMovePerCycle` in `UsingGameInternal.sol`) caps the move at 3 and refuses a repeated from-square or a repeated to-square (two piece-moves by one piece, or two to one square): the whole reveal is illegal.
- The piece-moves are SIMULTANEOUS. Each is judged legal against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone: a piece may move onto, or slide through, a square its own army's piece leaves, and two pieces may swap. The order the player lists them in changes nothing.
- A deployment stays the whole move of its cycle (already enforced: keep it, and keep its test).
- The chase ends in a trade: the king steps away while another of its pieces lands on the square it left, where an enemy arrives; two arrivals and no king, so the collision table kills both (`docs/adr/0003`). No new collision row.

**How, order-free** (`docs/adr/0002-order-free-lazy-resolution.md`):

- **Own movers count as gone for the legality check ONLY.** `ChessRules.isLegalMove` gets the start-of-cycle contents with the army's own vacated squares masked. Everything else keeps the real start-of-cycle facts: what `_touch` records as a square's standing piece, and whether a king or stone stood there to be taken (`prey` in `_revealMove`). Masking those would let whichever reveal touches a square first decide what its record says: a branch on reveal order. The masking must also not depend on the order the piece-moves are listed in.
- **An army's own piece is never its prey.** A piece arriving where its own king (or any own piece) stood notes no capture candidate for its own army: `_capturesBy` gets no self-entry.
- **The captor's fall stays one level deep.** `_captorFell` argues that a captor which moved a piece other than its king "had its king stand still"; that no longer holds, since the king may move in the same cycle. The answer is still read from where the king's last move took it (`_fellIn` through `kingTo`). Restate the reasoning in the code comment and add the "Amended by `docs/adr/0016`" line to ADR-0014 (and to ADR-0001: a move is now up to three piece-moves).
- The per-reveal `Reads` cache holds facts fixed at the start of the cycle; check it stays correct across three piece-moves in one reveal.

**A whole-move simulation route.** `GameSimulation.legalMoves(board, from)` answers for one piece. Add a route that judges a whole move (up to three piece-moves) on the same rules, including the refusals and "own movers count as gone", so the client can ask the contract rather than copy the rules (`docs/adr/0007-rules-live-only-in-the-contract.md`). Keep `legalMoves`; if per-piece answers need to know the move's other piece-moves (a square a planned piece-move vacates), give it that input.

## Acceptance criteria

- [ ] A reveal of 0, 1, 2 or 3 piece-moves by different pieces is accepted; a fourth piece-move, two by one piece, or two to one square is refused.
- [ ] A piece may move onto or slide through a square its own army vacates this cycle, and two pieces may swap; tested.
- [ ] The chase trade is tested: the king steps away, its piece and an enemy land on the square it left, both die.
- [ ] A deployment is still the whole move of its cycle.
- [ ] The order-replay suite (`inEveryOrder` / `REVEAL_ORDERS`) covers: one army's three piece-moves listed in every order give the same board; across armies, every reveal order gives the same board, owners and stakes for a piece landing on a square its own piece vacated while an enemy arrives there, a swap, the chase trade, and a captor whose king moves and falls elsewhere while its rook takes a standing king (a stone).
- [ ] No self-entry in `_capturesBy` when a piece lands where its own king stood (tested).
- [ ] The whole-move simulation route agrees with the reveal (a property test like `Moves.test.ts`'s "reveals exactly the moves the simulation route calls legal", over whole moves).
- [ ] `_captorFell`'s comment is restated; ADR-0001 and ADR-0014 carry an "Amended by `docs/adr/0016`" line.
- [ ] `GasBudget.test.ts`, `RouteSizes.test.ts`, `DeterministicDeploys.test.ts`, `StorageLayout.test.ts` and the web tests stay green (the declared figures are retuned in `three-piece-moves-gas-limits`; change them here only if the window forces it, and say so).

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016`, `0002`, `0003`, `0007`, `0014`, then `contracts/src/game/internal/UsingGameInternal.sol` (the reveal loop, `OneMovePerCycle`), `UsingGameBoard.sol` (`_revealMove`, `_touch`, `_squareAt`, `Reads`, `_noteCandidate`, `_captorFell`, `_fellIn`), `ChessRules.sol` (`moveSquares`, `isLegalMove`, `settle`), `contracts/src/game/routes/GameSimulation.sol`, `contracts/rocketh/config.ts` (`actionsPerReveal`), and the order-replay tests (`Moves.test.ts`, `KingCapture.test.ts`, `Stones.test.ts`, `utils/moves-world.ts`).

Run `git ls-files contracts/deployments`: if anything is deployed, the change is a wire change and needs a human; route to needs-attention.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
