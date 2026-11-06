---
title: 'Three piece-moves in the contract: a move is up to three pieces moving at once, judged simultaneously'
slug: three-piece-moves-in-the-contract
spec: three-piece-moves
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7]
---

## What to build

The first slice of the `three-piece-moves` spec and `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`, in the CONTRACT's reveal. Every world and every table gets three piece-moves here. Later tasks, in order: `three-piece-moves-simulation-route` (the whole-move route the client asks), `three-piece-moves-gas-limits`, `three-piece-moves-table-toggle`, `three-piece-moves-planner`, `three-piece-moves-bot-and-words`. The client keeps submitting one piece-move, which stays legal, so the web needs no change here: one action is still one chunk, so its commitment hash, its stipend (`ceil(1/3) = 1`) and its bond do not move. Do NOT change `GameSimulation.legalMoves` or its signature here (five web callers use it).

**The rule.**

- An army's move is up to three piece-moves, each by a different piece: 0 (a pass), 1, 2 or 3. `actionsPerReveal` becomes 3 for both worlds and the Lobby (`contracts/rocketh/config.ts`), so one reveal carries the whole move. The game's own per-move check (`OneMovePerCycle` in `UsingGameInternal.sol`) caps the move at 3 and refuses a repeated from-square or a repeated to-square (two piece-moves by one piece, or two to one square): the whole reveal is illegal. KEEP its `furtherActions != bytes24(0)` refusal: with a chunk of 3 the base would accept a chained fourth action.
- The piece-moves are SIMULTANEOUS. Each is judged legal against the board at the start of the cycle, with the army's own pieces that move this cycle counted as gone: a piece may move onto, or slide through, a square its own army's piece leaves, and two pieces may swap. The order the player lists them in changes nothing.
- A deployment stays the whole move of its cycle (already enforced by the `moves.length != 1` check: keep it, and its test).
- The chase ends in a trade: the king steps away while another of its pieces lands on the square it left, where an enemy arrives; two arrivals and no king, so the collision table kills both (`docs/adr/0003`). No new collision row.

**How, order-free** (`docs/adr/0002-order-free-lazy-resolution.md`):

- **Own movers count as gone for the legality check ONLY.** `ChessRules.isLegalMove` gets the start-of-cycle contents with the army's own vacated squares masked. Everything else keeps the real start-of-cycle facts: what `_touch` records as a square's standing piece, and whether a king or stone stood there to be taken (`prey` in `_revealMove`). Masking those would let whichever reveal touches a square first decide what its record says: a branch on reveal order. The mask must not depend on the order the piece-moves are listed in.
- **An army's own piece is never its prey.** A piece arriving where its own king (or any own piece) stood notes no capture candidate for its own army: `_capturesBy` gets no self-entry.
- **The captor's fall stays one level deep.** `_captorFell` argues that a captor which moved a piece other than its king "had its king stand still"; that no longer holds, since the king may move in the same cycle. The answer is still read from where the king's last move took it (`_fellIn` through `kingTo`). Restate the reasoning in the code comment.
- The per-reveal `Reads` cache holds facts fixed at the start of the cycle; check it stays correct across three piece-moves in one reveal.

**The test harnesses chunk at 1 today, and must chunk at 3**, or every multi-piece reveal is refused for the wrong reason: `DEFAULT_ACTIONS_PER_REVEAL` in `contracts/test/js/utils/index.ts` (what `deployGameWith` uses), the hard-coded `actionsPerReveal = 1` in `utils/moves-world.ts`, and the `1n` / `1` in `utils/table-world.ts`. Make them 3 (or read it from the fixture).

**Comments and words.** Rewrite the "ONE, for chess" comment on `actionsPerReveal` in `contracts/rocketh/config.ts`, and the "at most one per cycle" comment above `_revealMove`. Add an "Amended by `docs/adr/0016`" line to ADR-0001 (a move is now up to three piece-moves) and ADR-0014 (the fall argument), and mark ADR-0016 `status: accepted`: the rule lands here.

## Acceptance criteria

- [ ] The harnesses (`utils/index.ts`, `utils/moves-world.ts`, `utils/table-world.ts`) chunk at 3.
- [ ] A reveal of 0, 1, 2 or 3 piece-moves by different pieces is accepted; a fourth piece-move (chained or in the chunk), two by one piece, or two to one square is refused.
- [ ] A piece may move onto or slide through a square its own army vacates this cycle, and two pieces may swap; tested.
- [ ] The chase trade is tested: the king steps away, its piece and an enemy land on the square it left, both die.
- [ ] A deployment is still the whole move of its cycle.
- [ ] The order-replay suite (`inEveryOrder` / `REVEAL_ORDERS`) covers: one army's three piece-moves listed in every order give the same board; across armies, every reveal order gives the same board, owners and stakes for a piece landing on a square its own piece vacated while an enemy arrives there, a swap, the chase trade, and a captor whose king moves and falls elsewhere while its rook takes a standing king (a stone).
- [ ] No self-entry in `_capturesBy` when a piece lands where its own king stood (tested).
- [ ] `GameSimulation.legalMoves` is unchanged.
- [ ] The comments above are restated; ADR-0001 and ADR-0014 carry an "Amended by `docs/adr/0016`" line; ADR-0016 is `status: accepted`.
- [ ] `GasBudget.test.ts`, `RouteSizes.test.ts`, `DeterministicDeploys.test.ts`, `StorageLayout.test.ts` and the web tests stay green (the declared figures are retuned in `three-piece-moves-gas-limits`; change them here only if the window forces it, and say so).

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016`, `0002`, `0003`, `0014`, then `contracts/src/game/internal/UsingGameInternal.sol` (the reveal loop, `OneMovePerCycle`), `UsingGameBoard.sol` (`_revealMove`, `_touch`, `_squareAt`, `Reads`, `_noteCandidate`, `_captorFell`, `_fellIn`), `ChessRules.sol` (`moveSquares`, `isLegalMove`, `settle`), `contracts/rocketh/config.ts` (`actionsPerReveal`), the harnesses `contracts/test/js/utils/index.ts`, `moves-world.ts`, `table-world.ts`, and the order-replay tests (`Moves.test.ts`, `KingCapture.test.ts`, `Stones.test.ts`).

Run `git ls-files contracts/deployments`: if anything is deployed, the change is a wire change and needs a human; route to needs-attention.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.
